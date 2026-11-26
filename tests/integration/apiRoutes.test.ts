import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createCliporaDatabase, type CliporaDatabase } from '../../server/db/database.ts';
import { createApiRouter } from '../../server/routes/api.ts';
import { createRateLimiter } from '../../server/middleware/rateLimit.ts';

describe('Express API Integration, Auth & Workspace Owner Isolation', () => {
  let server: Server;
  let baseUrl: string;
  let db: CliporaDatabase;

  before(async () => {
    db = createCliporaDatabase(':memory:');
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/api', createApiRouter(db));

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
    db.close();
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
    assert.equal('sessionSecret' in body, false);
  });

  it('rejects unauthenticated requests on all protected endpoints with 401', async () => {
    const protectedEndpoints: Array<{ method: 'GET' | 'POST' | 'PUT'; path: string; body?: unknown }> = [
      { method: 'GET', path: '/api/auth/session' },
      { method: 'GET', path: '/api/workspace/projects' },
      { method: 'POST', path: '/api/workspace/projects', body: { projectName: 'Test' } },
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
        Authorization: 'Bearer not-a-valid-session-token',
      },
      body: JSON.stringify({ url: 'https://93.184.216.34/video.mp4' }),
    });
    assert.equal(resp.status, 401);
  });

  it('enforces PENDING customer isolation, approval workflow, and cross-owner workspace isolation', async () => {
    // 1. Initialize Super Admin
    const statusBefore = await fetch(`${baseUrl}/api/auth/super-admin-status`);
    assert.equal(((await statusBefore.json()) as { initialized: boolean }).initialized, false);

    const setupResp = await fetch(`${baseUrl}/api/auth/setup-super-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: 'Owner',
        email: 'reddox528@gmail.com',
        password: 'SuperOwnerPass#2026',
      }),
    });
    assert.equal(setupResp.status, 201);
    const superData = (await setupResp.json()) as { token: string; user: { role: string } };
    assert.equal(superData.user.role, 'SUPER_ADMIN');

    // 2. Register Customer A and Customer B -> both must start CUSTOMER + PENDING
    const regA = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: 'Creator A',
        email: 'creatorA@studio.local',
        password: 'Password123!',
      }),
    });
    assert.equal(regA.status, 201);
    const custA = (await regA.json()) as { token: string; user: { uid: string; role: string; accountStatus: string } };
    assert.equal(custA.user.role, 'CUSTOMER');
    assert.equal(custA.user.accountStatus, 'PENDING');

    const regB = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: 'Creator B',
        email: 'creatorB@studio.local',
        password: 'Password123!',
      }),
    });
    const custB = (await regB.json()) as { token: string; user: { uid: string } };

    // PENDING customer cannot create workspace projects (403)
    const pendingCreate = await fetch(`${baseUrl}/api/workspace/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${custA.token}` },
      body: JSON.stringify({ projectName: 'Blocked Until Approved' }),
    });
    assert.equal(pendingCreate.status, 403);

    // Super Admin approves Customer A & B
    for (const uid of [custA.user.uid, custB.user.uid]) {
      const appResp = await fetch(`${baseUrl}/api/admin/approvals/${uid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superData.token}` },
        body: JSON.stringify({ accountStatus: 'APPROVED' }),
      });
      assert.equal(appResp.status, 200);
    }

    // Approved Customer A creates a project
    const createProjA = await fetch(`${baseUrl}/api/workspace/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${custA.token}` },
      body: JSON.stringify({ projectId: 'proj_a_1', projectName: 'A Project' }),
    });
    assert.equal(createProjA.status, 201);

    // Approved Customer B cannot modify or delete Customer A's project
    const crossPatch = await fetch(`${baseUrl}/api/workspace/projects/proj_a_1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${custB.token}` },
      body: JSON.stringify({ projectName: 'Hijacked' }),
    });
    assert.equal(crossPatch.status, 404);

    const crossDel = await fetch(`${baseUrl}/api/workspace/projects/proj_a_1`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${custB.token}` },
    });
    assert.equal(crossDel.status, 404);

    const listB = await fetch(`${baseUrl}/api/workspace/projects`, {
      headers: { Authorization: `Bearer ${custB.token}` },
    });
    const listBJson = (await listB.json()) as { projects: unknown[] };
    assert.equal(listBJson.projects.length, 0);
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
