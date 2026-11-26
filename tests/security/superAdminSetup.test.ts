import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DuplicateSuperAdminError,
  initializeSuperAdmin,
  InvalidSetupInputError,
  type SuperAdminSetupDeps,
} from '../../server/services/superAdminSetup.ts';

describe('Google AI Studio Initial Super Admin Setup Security', () => {
  function createMockDeps(initialState?: {
    superAdminExists?: boolean;
    lockExists?: boolean;
    emailVerified?: boolean;
  }): {
    deps: Partial<SuperAdminSetupDeps>;
    users: Map<string, Record<string, unknown>>;
    settings: Map<string, Record<string, unknown>>;
    events: string[];
  } {
    const users = new Map<string, Record<string, unknown>>();
    const settings = new Map<string, Record<string, unknown>>();
    const events: string[] = [];

    if (initialState?.superAdminExists) {
      users.set('uid_super', {
        uid: 'uid_super',
        email: 'reddox528@gmail.com',
        role: 'SUPER_ADMIN',
        accountStatus: 'APPROVED',
      });
    }
    if (initialState?.lockExists) {
      settings.set('superAdminInit', {
        settingId: 'superAdminInit',
        settingValue: { initialized: true, superAdminUid: 'uid_super' },
      });
    }

    const deps: Partial<SuperAdminSetupDeps> = {
      expectedOwnerEmail: 'reddox528@gmail.com',
      bootstrapSecret: '',
      async signUp({ email }) {
        return {
          uid: 'uid_super',
          email,
          idToken: 'tok_super',
          emailVerified: Boolean(initialState?.emailVerified),
        };
      },
      async signIn({ email }) {
        return {
          uid: 'uid_super',
          email,
          idToken: 'tok_super',
          emailVerified: Boolean(initialState?.emailVerified),
        };
      },
      async sendVerification() {},
      async getDoc(_t, docPath) {
        const [col, id] = docPath.split('/');
        if (col === 'users') return users.get(id) || null;
        if (col === 'systemSettings') return settings.get(id) || null;
        return null;
      },
      async listCol(_t, col) {
        if (col === 'users') return Array.from(users.values());
        return [];
      },
      async createDoc(_t, col, docId, data) {
        if (col === 'users') users.set(docId, { ...data });
      },
      async setDoc(_t, docPath, data) {
        const [col, id] = docPath.split('/');
        if (col === 'systemSettings') settings.set(id, { ...data });
      },
      async recordEvent(params) {
        events.push(params.action);
        return {
          logId: 'log_1',
          actorId: params.actorId,
          action: params.action,
          targetId: params.targetId,
          timestamp: new Date().toISOString(),
          metadata: {},
        };
      },
    };

    return { deps, users, settings, events };
  }

  it('rejects weak passwords and non-owner emails', async () => {
    const { deps } = createMockDeps();
    await assert.rejects(
      () =>
        initializeSuperAdmin(
          { email: 'reddox528@gmail.com', password: 'short' },
          deps
        ),
      InvalidSetupInputError
    );

    await assert.rejects(
      () =>
        initializeSuperAdmin(
          { email: 'attacker@gmail.com', password: 'StrongPassword#2026' },
          deps
        ),
      InvalidSetupInputError
    );
  });

  it('establishes the first Super Admin cleanly, creates lock, and blocks duplicate initialization', async () => {
    const { deps, users, settings, events } = createMockDeps({ emailVerified: true });

    const result = await initializeSuperAdmin(
      {
        email: 'reddox528@gmail.com',
        password: 'StrongPassword#2026',
        displayName: 'REDDOX Owner',
      },
      deps
    );

    assert.equal(result.uid, 'uid_super');
    assert.equal(result.role, 'SUPER_ADMIN');
    assert.equal(result.profileInitialized, true);
    assert.equal(users.get('uid_super')?.role, 'SUPER_ADMIN');
    assert.ok(settings.has('superAdminInit'));
    assert.ok(events.includes('SUPER_ADMIN_INITIALIZED'));

    // Second run must be blocked to prevent duplicate Super Admin creation
    await assert.rejects(
      () =>
        initializeSuperAdmin(
          {
            email: 'reddox528@gmail.com',
            password: 'StrongPassword#2026',
          },
          deps
        ),
      DuplicateSuperAdminError
    );
  });

  it('prevents duplicate setup even if lock is absent when a SUPER_ADMIN already exists', async () => {
    const { deps } = createMockDeps({ superAdminExists: true, emailVerified: true });
    await assert.rejects(
      () =>
        initializeSuperAdmin(
          {
            email: 'reddox528@gmail.com',
            password: 'StrongPassword#2026',
          },
          deps
        ),
      DuplicateSuperAdminError
    );
  });
});
