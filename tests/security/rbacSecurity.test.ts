import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createCliporaDatabase, type CliporaDatabase } from '../../server/db/database.ts';
import { createAdminApiRouter } from '../../server/routes/adminApi.ts';
import { hashPassword, verifyPassword } from '../../server/security/password.ts';
import { ALL_ADMIN_PERMISSIONS } from '../../server/security/rbac.ts';
import { signSessionToken } from '../../server/security/sessionToken.ts';

describe('End-to-End RBAC, Hidden Admin Isolation & Server API Security Suite', () => {
  let server: Server;
  let baseUrl: string;
  let db: CliporaDatabase;

  let tokSuper = '';
  let tokAdmin = '';
  let tokSuspendedAdmin = '';
  let tokCustomer = '';

  before(async () => {
    db = createCliporaDatabase(':memory:');

    db.createUser({
      uid: 'super_uid',
      displayName: 'Super Owner',
      email: 'reddox528@gmail.com',
      passwordHash: hashPassword('SuperOwnerPass#2026'),
      role: 'SUPER_ADMIN',
      accountStatus: 'APPROVED',
      permissions: [...ALL_ADMIN_PERMISSIONS],
      approvedBy: 'super_uid',
    });

    db.createUser({
      uid: 'admin_uid',
      displayName: 'Moderator Admin',
      email: 'moderator@clipora.local',
      passwordHash: hashPassword('ModeratorPass#2026'),
      role: 'ADMIN',
      accountStatus: 'APPROVED',
      permissions: ['VIEW_DASHBOARD', 'MANAGE_CUSTOMERS', 'REVIEW_APPROVALS'],
      approvedBy: 'super_uid',
    });

    db.createUser({
      uid: 'suspended_admin_uid',
      displayName: 'Suspended Admin',
      email: 'suspended@clipora.local',
      passwordHash: hashPassword('SuspendedPass#2026'),
      role: 'ADMIN',
      accountStatus: 'SUSPENDED',
      permissions: ['VIEW_DASHBOARD', 'MANAGE_CUSTOMERS'],
      approvedBy: 'super_uid',
    });

    db.createUser({
      uid: 'cust_a_uid',
      displayName: 'Customer Alpha',
      email: 'alpha@creator.local',
      passwordHash: hashPassword('CustomerPass#2026'),
      role: 'CUSTOMER',
      accountStatus: 'APPROVED',
      permissions: [],
      approvedBy: 'super_uid',
    });

    db.createUser({
      uid: 'pending_uid',
      displayName: 'Pending Creator',
      email: 'pending@creator.local',
      passwordHash: hashPassword('PendingPass#2026'),
      role: 'CUSTOMER',
      accountStatus: 'PENDING',
      permissions: [],
    });

    db.createProject({
      projectId: 'proj_1',
      ownerId: 'cust_a_uid',
      projectName: 'Alpha Podcast',
    });

    tokSuper = signSessionToken('super_uid');
    tokAdmin = signSessionToken('admin_uid');
    tokSuspendedAdmin = signSessionToken('suspended_admin_uid');
    tokCustomer = signSessionToken('cust_a_uid');

    const app = express();
    app.use(express.json());
    app.use('/api/admin', createAdminApiRouter({ db }));

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

  it('discreet Admin Access appears only in LandingPage footer; customer nav, mobile drawer & dashboard stay isolated', () => {
    const root = process.cwd();
    const customerFiles = [
      'src/layouts/DashboardLayout.tsx',
      'src/pages/auth/AuthPages.tsx',
      'src/pages/customer/CustomerOverview.tsx',
      'src/pages/customer/BrandKitExportsPages.tsx',
    ];
    for (const rel of customerFiles) {
      const content = fs.readFileSync(path.join(root, rel), 'utf8');
      assert.equal(content.includes('/secure-control-panel'), false, `${rel} exposed admin route`);
      assert.equal(content.includes('AdminDashboard'), false, `${rel} referenced AdminDashboard`);
      assert.equal(content.includes('ADMIN_NAV'), false, `${rel} referenced ADMIN_NAV`);
      assert.equal(content.includes('workspaceMode'), false, `${rel} exposed workspaceMode switcher`);
    }

    const landing = fs.readFileSync(path.join(root, 'src/pages/public/LandingPage.tsx'), 'utf8');
    const footerStart = landing.indexOf('<footer');
    assert.ok(footerStart > 0);
    const beforeFooter = landing.slice(0, footerStart);
    const footerHtml = landing.slice(footerStart);
    assert.equal(beforeFooter.includes('/secure-control-panel'), false, 'Header/body must not contain admin link');
    assert.equal(beforeFooter.includes('Admin Access'), false, 'Header/mobile menu must not contain Admin Access');
    assert.match(footerHtml, /Admin Access/);
    assert.match(footerHtml, /\/secure-control-panel/);

    const layout = fs.readFileSync(path.join(root, 'src/layouts/DashboardLayout.tsx'), 'utf8');
    assert.match(layout, /CUSTOMER_NAV\.map/);

    const gate = fs.readFileSync(path.join(root, 'src/pages/admin/SecureAdminGate.tsx'), 'utf8');
    assert.equal(gate.includes('registerWithEmail'), false);
    assert.equal(gate.includes('signInWithGoogle'), false);
  });

  it('logged-out visitor receives HTTP 401 on all admin routes', async () => {
    const endpoints: Array<[string, string]> = [
      ['GET', '/api/admin/session'],
      ['GET', '/api/admin/dashboard'],
      ['GET', '/api/admin/users'],
      ['GET', '/api/admin/approvals'],
      ['GET', '/api/admin/settings'],
      ['GET', '/api/admin/audit-logs'],
    ];
    for (const [method, endpoint] of endpoints) {
      const resp = await fetch(`${baseUrl}${endpoint}`, { method });
      assert.equal(resp.status, 401, `Expected 401 for unauthenticated ${method} ${endpoint}`);
    }
  });

  it('customer tokens & manipulated role headers/bodies receive 403 across all admin APIs', async () => {
    const requests: Array<{ method: string; path: string; body?: unknown }> = [
      { method: 'GET', path: '/api/admin/session' },
      { method: 'POST', path: '/api/admin/session/login-event' },
      { method: 'GET', path: '/api/admin/dashboard' },
      { method: 'GET', path: '/api/admin/users' },
      { method: 'GET', path: '/api/admin/approvals' },
      { method: 'POST', path: '/api/admin/approvals/pending_uid', body: { accountStatus: 'APPROVED' } },
      { method: 'POST', path: '/api/admin/users/provision-admin', body: { email: 'alpha@creator.local' } },
      { method: 'POST', path: '/api/admin/users/admin_uid/password-reset' },
      { method: 'PATCH', path: '/api/admin/users/cust_a_uid/role', body: { role: 'ADMIN' } },
      { method: 'PATCH', path: '/api/admin/users/cust_a_uid/role', body: { role: 'SUPER_ADMIN' } },
      { method: 'DELETE', path: '/api/admin/users/pending_uid' },
      { method: 'GET', path: '/api/admin/projects' },
      { method: 'GET', path: '/api/admin/processing' },
      { method: 'GET', path: '/api/admin/storage' },
      { method: 'GET', path: '/api/admin/settings' },
      { method: 'PUT', path: '/api/admin/settings', body: { settingId: 'limits', settingValue: { maxFileSizeMb: 9999 } } },
      { method: 'GET', path: '/api/admin/audit-logs' },
    ];

    for (const r of requests) {
      const resp = await fetch(`${baseUrl}${r.path}`, {
        method: r.method,
        headers: {
          Authorization: `Bearer ${tokCustomer}`,
          'Content-Type': 'application/json',
          'X-User-Role': 'SUPER_ADMIN',
          'X-Account-Status': 'APPROVED',
        },
        body: r.body ? JSON.stringify(r.body) : undefined,
      });
      assert.equal(resp.status, 403, `Expected 403 for customer ${r.method} ${r.path}`);
    }

    const suspResp = await fetch(`${baseUrl}/api/admin/dashboard`, {
      headers: { Authorization: `Bearer ${tokSuspendedAdmin}` },
    });
    assert.equal(suspResp.status, 403);

    const logs = db.listAuditLogs();
    assert.ok(
      logs.some((e) => e.action === 'UNAUTHORIZED_ADMIN_API_REQUEST' && e.actorId === 'cust_a_uid'),
      'Expected unauthorized customer API attempt to be logged'
    );
  });

  it('standard ADMIN cannot create admins or touch Super Admin ops unless explicitly granted CREATE_ADMINS', async () => {
    const dashResp = await fetch(`${baseUrl}/api/admin/dashboard`, {
      headers: { Authorization: `Bearer ${tokAdmin}` },
    });
    assert.equal(dashResp.status, 200);

    const usersResp = await fetch(`${baseUrl}/api/admin/users`, {
      headers: { Authorization: `Bearer ${tokAdmin}` },
    });
    assert.equal(usersResp.status, 200);
    const usersPayload = (await usersResp.json()) as { users: Array<{ role: string }> };
    assert.ok(usersPayload.users.every((u) => u.role === 'CUSTOMER'));

    const unpermitted = await fetch(`${baseUrl}/api/admin/processing`, {
      headers: { Authorization: `Bearer ${tokAdmin}` },
    });
    assert.equal(unpermitted.status, 403);

    const blockedSuperOps: Array<{ method: string; path: string; body?: unknown }> = [
      { method: 'PATCH', path: '/api/admin/users/admin_uid/role', body: { role: 'SUPER_ADMIN' } },
      { method: 'POST', path: '/api/admin/approvals/admin_uid', body: { accountStatus: 'APPROVED' } },
      { method: 'POST', path: '/api/admin/approvals/super_uid', body: { accountStatus: 'SUSPENDED' } },
      { method: 'POST', path: '/api/admin/users/provision-admin', body: { email: 'alpha@creator.local' } },
      { method: 'POST', path: '/api/admin/users/admin_uid/password-reset' },
      { method: 'DELETE', path: '/api/admin/users/pending_uid' },
      { method: 'GET', path: '/api/admin/settings' },
      { method: 'PUT', path: '/api/admin/settings', body: { settingId: 'limits', settingValue: { maxFileSizeMb: 100 } } },
      { method: 'GET', path: '/api/admin/audit-logs' },
    ];
    for (const op of blockedSuperOps) {
      const resp = await fetch(`${baseUrl}${op.path}`, {
        method: op.method,
        headers: {
          Authorization: `Bearer ${tokAdmin}`,
          'Content-Type': 'application/json',
        },
        body: op.body ? JSON.stringify(op.body) : undefined,
      });
      assert.equal(resp.status, 403, `Expected 403 for ADMIN calling ${op.method} ${op.path}`);
    }

    // Grant CREATE_ADMINS explicitly via SUPER_ADMIN
    const grantResp = await fetch(`${baseUrl}/api/admin/users/admin_uid/role`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokSuper}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        permissions: ['VIEW_DASHBOARD', 'MANAGE_CUSTOMERS', 'REVIEW_APPROVALS', 'CREATE_ADMINS'],
      }),
    });
    assert.equal(grantResp.status, 200);

    // Attempting to escalate by granting CREATE_ADMINS from non-Super-Admin must return 403
    const escalateResp = await fetch(`${baseUrl}/api/admin/users/provision-admin`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokAdmin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'alpha@creator.local',
        permissions: ['VIEW_DASHBOARD', 'CREATE_ADMINS'],
      }),
    });
    assert.equal(escalateResp.status, 403);

    // Creating a new admin with permitted scope succeeds
    const delegateCreate = await fetch(`${baseUrl}/api/admin/users/provision-admin`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokAdmin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: 'Delegated Moderator',
        email: 'delegated@clipora.local',
        initialPassword: 'StrongTempPass#2026',
        permissions: ['VIEW_DASHBOARD'],
      }),
    });
    assert.equal(delegateCreate.status, 200);
    const delPayload = (await delegateCreate.json()) as { role: string; createdNewAuthAccount: boolean };
    assert.equal(delPayload.role, 'ADMIN');
    assert.equal(delPayload.createdNewAuthAccount, true);
  });

  it('authorized SUPER_ADMIN creates admins, resets passwords with scrypt, blocks duplicate SUPER_ADMIN, and logs events', async () => {
    const sessResp = await fetch(`${baseUrl}/api/admin/session`, {
      headers: { Authorization: `Bearer ${tokSuper}` },
    });
    assert.equal(sessResp.status, 200);
    const sessData = (await sessResp.json()) as { authorized: boolean; isSuperAdmin: boolean };
    assert.equal(sessData.authorized, true);
    assert.equal(sessData.isSuperAdmin, true);

    const loginEv = await fetch(`${baseUrl}/api/admin/session/login-event`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokSuper}` },
    });
    assert.equal(loginEv.status, 202);

    const dupSuper = await fetch(`${baseUrl}/api/admin/users/pending_uid/role`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokSuper}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'SUPER_ADMIN' }),
    });
    assert.equal(dupSuper.status, 403);

    const approveResp = await fetch(`${baseUrl}/api/admin/approvals/pending_uid`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokSuper}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountStatus: 'APPROVED' }),
    });
    assert.equal(approveResp.status, 200);

    const createNewResp = await fetch(`${baseUrl}/api/admin/users/provision-admin`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokSuper}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: 'Operations Admin',
        email: 'ops@clipora.local',
        initialPassword: 'SecureOpsPassword#99',
        permissions: ['VIEW_DASHBOARD', 'MONITOR_PROJECTS'],
      }),
    });
    assert.equal(createNewResp.status, 200);
    const createdBody = (await createNewResp.json()) as { uid: string; role: string; createdNewAuthAccount: boolean };
    assert.equal(createdBody.role, 'ADMIN');
    assert.equal(createdBody.createdNewAuthAccount, true);

    const resetResp = await fetch(`${baseUrl}/api/admin/users/${createdBody.uid}/password-reset`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokSuper}` },
    });
    assert.equal(resetResp.status, 200);
    const resetBody = (await resetResp.json()) as { temporaryPassword: string };
    assert.ok(resetBody.temporaryPassword.length >= 12);

    const storedOps = db.getUserAuthByUid(createdBody.uid)!;
    assert.equal(verifyPassword(resetBody.temporaryPassword, storedOps.passwordHash), true);

    const setResp = await fetch(`${baseUrl}/api/admin/settings`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokSuper}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ settingId: 'limits', settingValue: { maxFileSizeMb: 450 } }),
    });
    assert.equal(setResp.status, 200);

    const logsResp = await fetch(`${baseUrl}/api/admin/audit-logs`, {
      headers: { Authorization: `Bearer ${tokSuper}` },
    });
    assert.equal(logsResp.status, 200);
    const logsData = (await logsResp.json()) as { auditLogs: Array<{ action: string }> };
    assert.ok(logsData.auditLogs.some((l) => l.action === 'ADMIN_LOGIN'));
    assert.ok(logsData.auditLogs.some((l) => l.action === 'ACCOUNT_APPROVED'));
    assert.ok(logsData.auditLogs.some((l) => l.action === 'ADMIN_CREATED'));
    assert.ok(logsData.auditLogs.some((l) => l.action === 'ADMIN_PASSWORD_RESET_REQUESTED'));
    assert.ok(logsData.auditLogs.some((l) => l.action === 'SYSTEM_SETTINGS_UPDATED'));

    const gateSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/pages/admin/SecureAdminGate.tsx'),
      'utf8'
    );
    assert.equal(gateSrc.includes('localStorage'), false);
    assert.equal(gateSrc.includes('sessionStorage'), false);
    assert.match(gateSrc, /verifyAdminSessionOnServer/);
  });
});
