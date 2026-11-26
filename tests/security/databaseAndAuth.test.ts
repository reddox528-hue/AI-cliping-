import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createCliporaDatabase } from '../../server/db/database.ts';
import { createApiRouter } from '../../server/routes/api.ts';
import { hashPassword, verifyPassword } from '../../server/security/password.ts';
import {
  buildSessionCookieHeader,
  parseCookieHeader,
  signSessionToken,
  verifySessionToken,
} from '../../server/security/sessionToken.ts';

function walkDir(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full));
    } else if (/\.(ts|tsx|js|mjs|json)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

describe('Zero-Firebase, Password Hashing, Session Token & CSRF Security Suite', () => {
  it('verifies zero Firebase dependencies, configs, or imports remain in codebase', () => {
    const root = process.cwd();
    assert.equal(fs.existsSync(path.join(root, 'firebase-applet-config.json')), false);
    assert.equal(fs.existsSync(path.join(root, 'firebase-blueprint.json')), false);
    assert.equal(fs.existsSync(path.join(root, 'firestore.rules')), false);

    const pkg = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
    assert.equal(/firebase/i.test(pkg), false, 'package.json must not contain Firebase packages');

    const files = [
      ...walkDir(path.join(root, 'src')),
      ...walkDir(path.join(root, 'server')),
      ...walkDir(path.join(root, 'scripts')),
    ];
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      assert.equal(
        /firebase|firestore/i.test(content),
        false,
        `Unexpected Firebase/Firestore reference in ${path.relative(root, file)}`
      );
    }
  });

  it('hashes passwords with unique per-user scrypt salts and verifies safely', () => {
    const hashA = hashPassword('MySecurePass123!');
    const hashB = hashPassword('MySecurePass123!');
    assert.notEqual(hashA, hashB);
    assert.ok(hashA.startsWith('scrypt$'));
    assert.equal(verifyPassword('MySecurePass123!', hashA), true);
    assert.equal(verifyPassword('WrongPass123!', hashA), false);
    assert.equal(verifyPassword('MySecurePass123!', 'malformed'), false);
  });

  it('rejects tampered or expired HMAC session tokens', () => {
    const secret = 'test-signing-secret-32-chars-minimum';
    const valid = signSessionToken('usr_123', secret, 300);
    const decoded = verifySessionToken(valid, secret);
    assert.equal(decoded?.uid, 'usr_123');

    const tampered = `${valid.slice(0, -4)}AAAA`;
    assert.equal(verifySessionToken(tampered, secret), null);
    assert.equal(verifySessionToken(valid, 'different-secret'), null);

    const expired = signSessionToken('usr_123', secret, -5);
    assert.equal(verifySessionToken(expired, secret), null);
  });

  it('enforces anti-CSRF header on cookie-authenticated state-changing endpoints', async () => {
    const db = createCliporaDatabase(':memory:');
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(db));

    let server!: Server;
    let baseUrl = '';
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    try {
      db.createUser({
        uid: 'u_cookie',
        displayName: 'Cookie User',
        email: 'cookie@studio.local',
        passwordHash: hashPassword('CookiePass#2026'),
        role: 'CUSTOMER',
        accountStatus: 'APPROVED',
      });
      const token = signSessionToken('u_cookie');
      const cookieHeader = `clipora_session=${encodeURIComponent(token)}`;

      // Verify cookie serializer builds HttpOnly + SameSite=None; Partitioned when HTTPS
      const httpsCookie = buildSessionCookieHeader(token, true);
      assert.match(httpsCookie, /HttpOnly/);
      assert.match(httpsCookie, /Secure/);
      assert.match(httpsCookie, /SameSite=None/);
      assert.match(httpsCookie, /Partitioned/);
      assert.equal(parseCookieHeader(cookieHeader).clipora_session, token);

      // Mutation with cookie ONLY and NO X-Requested-With header must fail with 403
      const blocked = await fetch(`${baseUrl}/api/workspace/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
        body: JSON.stringify({ projectName: 'CSRF Attempt' }),
      });
      assert.equal(blocked.status, 403);

      // Mutation with cookie + X-Requested-With: CliporaApp succeeds
      const allowed = await fetch(`${baseUrl}/api/workspace/projects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieHeader,
          'X-Requested-With': 'CliporaApp',
        },
        body: JSON.stringify({ projectName: 'Legit Cookie Create' }),
      });
      assert.equal(allowed.status, 201);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      db.close();
    }
  });
});
