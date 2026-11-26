import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createCliporaDatabase, type CliporaDatabase } from '../../server/db/database.ts';
import { createApiRouter } from '../../server/routes/api.ts';

describe('Public Contact Inquiry API (/api/contact)', () => {
  let server: Server;
  let baseUrl: string;
  let db: CliporaDatabase;

  before(async () => {
    db = createCliporaDatabase(':memory:');
    const app = express();
    app.use(express.json());
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

  it('rejects invalid email and too-short messages with HTTP 400', async () => {
    const badEmailResp = await fetch(`${baseUrl}/api/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Creator Test',
        email: 'not-an-email',
        topic: 'Account Approval',
        message: 'Checking approval status for my creator workspace.',
      }),
    });
    assert.equal(badEmailResp.status, 400);

    const shortMsgResp = await fetch(`${baseUrl}/api/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Creator Test',
        email: 'creator@studio.example',
        topic: 'Account Approval',
        message: 'Too short',
      }),
    });
    assert.equal(shortMsgResp.status, 400);
  });

  it('persists valid contact inquiries in SQLite and returns HTTP 201', async () => {
    const resp = await fetch(`${baseUrl}/api/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Jordan Rivera',
        email: 'JORDAN@EXAMPLE.COM',
        topic: 'Workspace & Storage Limits',
        message: 'We would like higher project limits for our weekly podcast clip pipeline.',
      }),
    });

    assert.equal(resp.status, 201);
    const body = (await resp.json()) as { ok: boolean; inquiryId: string; createdAt: string };
    assert.equal(body.ok, true);
    assert.ok(body.inquiryId.startsWith('inq_'));
    assert.ok(typeof body.createdAt === 'string' && !Number.isNaN(Date.parse(body.createdAt)));

    const stored = db.listContactInquiries(10);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].inquiryId, body.inquiryId);
    assert.equal(stored[0].email, 'jordan@example.com');
    assert.equal(stored[0].topic, 'Workspace & Storage Limits');
  });
});
