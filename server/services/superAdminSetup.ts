import crypto from 'crypto';
import { getDatabase, type CliporaDatabase } from '../db/database.ts';
import { hashPassword } from '../security/password.ts';
import { ALL_ADMIN_PERMISSIONS, BOOTSTRAP_OWNER_EMAIL } from '../security/rbac.ts';
import { logSecurityEvent } from './securityMonitor.ts';

export class DuplicateSuperAdminError extends Error {
  constructor(
    message = 'Initial Super Admin account already exists. Duplicate Super Admin creation is blocked.'
  ) {
    super(message);
    this.name = 'DuplicateSuperAdminError';
  }
}

export class InvalidSetupInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSetupInputError';
  }
}

export interface SuperAdminSetupDeps {
  expectedOwnerEmail: string;
  bootstrapSecret?: string;
  db?: CliporaDatabase;
  recordEvent?: typeof logSecurityEvent;
}

export function validateSuperAdminPassword(password: string): void {
  if (typeof password !== 'string' || password.length < 12) {
    throw new InvalidSetupInputError('Password must be at least 12 characters long.');
  }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new InvalidSetupInputError(
      'Password must include uppercase letters, lowercase letters, and at least one number.'
    );
  }
}

export interface SuperAdminSetupResult {
  uid: string;
  email: string;
  role: 'SUPER_ADMIN';
  profileInitialized: boolean;
}

/**
 * Establishes the single initial Super Admin account in the server SQLite database.
 * Permanently locks after the first Super Admin is initialized.
 */
export async function initializeSuperAdmin(
  input: {
    email: string;
    password: string;
    displayName?: string;
    setupSecret?: string;
  },
  customDeps?: Partial<SuperAdminSetupDeps>
): Promise<SuperAdminSetupResult> {
  const expectedOwnerEmail = (
    customDeps?.expectedOwnerEmail ?? BOOTSTRAP_OWNER_EMAIL
  ).toLowerCase();
  const bootstrapSecret =
    customDeps?.bootstrapSecret ?? (process.env.SUPER_ADMIN_BOOTSTRAP_SECRET || '');
  const db = customDeps?.db ?? getDatabase();
  const recordEvent = customDeps?.recordEvent ?? logSecurityEvent;

  const normalizedEmail = String(input.email || '').trim().toLowerCase();
  const displayName =
    String(input.displayName || 'NEXORATECH Super Admin').trim().slice(0, 120) ||
    'NEXORATECH Super Admin';

  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new InvalidSetupInputError('Provide a valid Super Admin email address.');
  }

  validateSuperAdminPassword(input.password);

  if (bootstrapSecret && input.setupSecret !== bootstrapSecret) {
    throw new InvalidSetupInputError('Invalid SUPER_ADMIN_BOOTSTRAP_SECRET.');
  }

  if (normalizedEmail !== expectedOwnerEmail) {
    throw new InvalidSetupInputError(
      `Initial Super Admin email must match the configured owner email (${expectedOwnerEmail}).`
    );
  }

  if (db.hasSuperAdmin()) {
    throw new DuplicateSuperAdminError();
  }

  const passwordHash = hashPassword(input.password);
  const existingByEmail = db.getUserAuthByEmail(normalizedEmail);
  let uid: string;

  if (existingByEmail) {
    uid = existingByEmail.uid;
    db.updateUserPasswordHash(uid, passwordHash);
    db.updateUserAdminFields(uid, {
      role: 'SUPER_ADMIN',
      accountStatus: 'APPROVED',
      permissions: [...ALL_ADMIN_PERMISSIONS],
      approvedBy: uid,
    });
  } else {
    uid = `usr_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    db.createUser({
      uid,
      displayName,
      email: normalizedEmail,
      passwordHash,
      role: 'SUPER_ADMIN',
      accountStatus: 'APPROVED',
      permissions: [...ALL_ADMIN_PERMISSIONS],
      approvedBy: uid,
    });
  }

  db.setSystemSetting(
    'superAdminInit',
    {
      initialized: true,
      superAdminUid: uid,
      superAdminEmail: normalizedEmail,
    },
    uid
  );

  await recordEvent({
    actorId: uid,
    action: 'SUPER_ADMIN_INITIALIZED',
    targetId: uid,
    metadata: { email: normalizedEmail, existingPromoted: Boolean(existingByEmail) },
    db,
  });

  return {
    uid,
    email: normalizedEmail,
    role: 'SUPER_ADMIN',
    profileInitialized: true,
  };
}
