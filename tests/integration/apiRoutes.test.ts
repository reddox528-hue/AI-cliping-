import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { apiRouter } from '../../server/routes/api.ts';
import { createRateLimiter } from '../../server/middleware/rateLimit.ts';

describe('Express API Integration & Auth Gates', () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/api', apiRouter);

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('returns public capability health without exposing secrets', async () => {
    const resp = await fetch(`${baseUrl}/api/health`);
    assert.equal(resp.status, 200);
    const body = (await resp.json()) as Record<string, unknown>;
    assert.equal(body.ok, true);
    assert.equal(typeof body.geminiConfigured, 'boolean');
    assert.equal(typeof body.r2Configured, 'boolean');
    assert.equal(typeof body.emailConfigured, 'boolean');
    assert.equal('bootstrapSecretConfigured' in body, false);
    assert.equal('geminiApiKey' in body, false);
  });

  it('rejects unauthenticated requests on all protected endpoints with 401', async () => {
    const protectedEndpoints: Array<{ method: 'GET' | 'POST' | 'PUT'; path: string; body?: unknown }> = [
      { method: 'POST', path: '/api/videos/probe-url', body: { url: 'https://93.184.216.34/video.mp4' } },
      { method: 'POST', path: '/api/ai/transcribe', body: { audioBase64: 'AA==', mimeType: 'audio/mp3' } },
      { method: 'POST', path: '/api/ai/analyze-clips', body: { transcriptText: 'hi', videoDuration: 30 } },
      { method: 'POST', path: '/api/storage/presign-upload', body: { fileName: 'clip.mp4' } },
      { method: 'POST', path: '/api/storage/presign-download', body: { objectKey: 'users/u1/uploads/a.mp4' } },
      { method: 'GET', path: '/api/admin/session' },
      { method: 'GET', path: '/api/admin/dashboard' },
      { method: 'GET', path: '/api/admin/users' },
      { method: 'PUT', path: '/api/admin/settings', body: { settingId: 'limits', settingValue: {} } },
    ];

    for (const ep of protectedEndpoints) {
      const resp = await fetch(`${baseUrl}${ep.path}`, {
        method: ep.method,
        headers: { 'Content-Type': 'application/json' },
        ...(ep.body ? { body: JSON.stringify(ep.body) } : {}),
      });
      assert.equal(resp.status, 401, `Expected 401 for unauthenticated ${ep.method} ${ep.path}`);
    }
  });

  it('rejects malformed Bearer tokens cleanly with 401', async () => {
    const resp = await fetch(`${baseUrl}/api/videos/probe-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer not-a-valid-firebase-jwt',
      },
      body: JSON.stringify({ url: 'https://93.184.216.34/video.mp4' }),
    });
    assert.equal(resp.status, 401);
  });

  it('enforces per-user sliding-window rate limits with HTTP 429', () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      maxRequests: 2,
      keyPrefix: 'test_limit',
    });

    const invoke = () => {
      let statusCode = 200;
      let nextCalled = false;
      const headers: Record<string, string> = {};
      const req = {
        auth: { uid: 'user_abc' },
        ip: '127.0.0.1',
      } as Parameters<typeof limiter>[0];
      const res = {
        setHeader(k: string, v: string) {
          headers[k] = v;
        },
        status(code: number) {
          statusCode = code;
          return {
            json() {
              return res;
            },
          };
        },
      } as unknown as Parameters<typeof limiter>[1];
      limiter(req, res, () => {
        nextCalled = true;
      });
      return { statusCode, nextCalled, headers };
    };

    assert.equal(invoke().nextCalled, true);
    assert.equal(invoke().nextCalled, true);
    const blocked = invoke();
    assert.equal(blocked.nextCalled, false);
    assert.equal(blocked.statusCode, 429);
    assert.ok(Number(blocked.headers['Retry-After']) >= 1);
  });
});
