import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createCliporaDatabase } from '../../server/db/database.ts';
import { verifyPassword } from '../../server/security/password.ts';
import {
  DuplicateSuperAdminError,
  initializeSuperAdmin,
  InvalidSetupInputError,
} from '../../server/services/superAdminSetup.ts';

describe('Initial Super Admin Setup Security (SQLite)', () => {
  it('rejects weak passwords and non-owner emails', async () => {
    const db = createCliporaDatabase(':memory:');
    try {
      await assert.rejects(
        () =>
          initializeSuperAdmin(
            { email: 'reddox528@gmail.com', password: 'short' },
            { expectedOwnerEmail: 'reddox528@gmail.com', bootstrapSecret: '', db }
          ),
        InvalidSetupInputError
      );

      await assert.rejects(
        () =>
          initializeSuperAdmin(
            { email: 'attacker@gmail.com', password: 'StrongPassword#2026' },
            { expectedOwnerEmail: 'reddox528@gmail.com', bootstrapSecret: '', db }
          ),
        InvalidSetupInputError
      );
    } finally {
      db.close();
    }
  });

  it('establishes the first Super Admin cleanly, hashes password with scrypt, and blocks duplicate initialization', async () => {
    const db = createCliporaDatabase(':memory:');
    try {
      const result = await initializeSuperAdmin(
        {
          email: 'reddox528@gmail.com',
          password: 'StrongPassword#2026',
          displayName: 'NEXORATECH Owner',
        },
        { expectedOwnerEmail: 'reddox528@gmail.com', bootstrapSecret: '', db }
      );

      assert.equal(result.email, 'reddox528@gmail.com');
      assert.equal(result.role, 'SUPER_ADMIN');
      assert.equal(result.profileInitialized, true);

      const saved = db.getUserAuthByUid(result.uid);
      assert.ok(saved);
      assert.equal(saved.role, 'SUPER_ADMIN');
      assert.equal(saved.accountStatus, 'APPROVED');
      assert.equal(verifyPassword('StrongPassword#2026', saved.passwordHash), true);
      assert.equal(verifyPassword('WrongPassword#2026', saved.passwordHash), false);
      assert.equal(db.hasSuperAdmin(), true);

      await assert.rejects(
        () =>
          initializeSuperAdmin(
            {
              email: 'reddox528@gmail.com',
              password: 'StrongPassword#2026',
            },
            { expectedOwnerEmail: 'reddox528@gmail.com', bootstrapSecret: '', db }
          ),
        DuplicateSuperAdminError
      );
    } finally {
      db.close();
    }
  });
});
