import { ALL_ADMIN_PERMISSIONS, BOOTSTRAP_OWNER_EMAIL } from '../security/rbac.ts';
import {
  createFirestoreDocument,
  getFirestoreDocument,
  listFirestoreCollection,
  setFirestoreDocument,
} from './firestoreRest.ts';
import {
  sendVerificationEmail,
  signInWithEmailPassword,
  signUpWithEmailPassword,
  type IdentityAuthResult,
} from './firebaseIdentityToolkit.ts';
import { logSecurityEvent } from './securityMonitor.ts';

export class DuplicateSuperAdminError extends Error {
  constructor(message = 'Initial Super Admin account already exists. Duplicate Super Admin creation is blocked.') {
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
  signUp: (params: { email: string; password: string; displayName?: string }) => Promise<IdentityAuthResult>;
  signIn: (params: { email: string; password: string }) => Promise<IdentityAuthResult>;
  sendVerification: (idToken: string) => Promise<void>;
  getDoc: (idToken: string, docPath: string) => Promise<Record<string, unknown> | null>;
  listCol: (idToken: string, col: string) => Promise<Array<Record<string, unknown>>>;
  createDoc: (
    idToken: string,
    col: string,
    docId: string,
    data: Record<string, unknown>,
    serverTimeFields?: string[]
  ) => Promise<void>;
  setDoc: (
    idToken: string,
    docPath: string,
    data: Record<string, unknown>,
    serverTimeFields?: string[]
  ) => Promise<void>;
  recordEvent: typeof logSecurityEvent;
}

const defaultDeps: SuperAdminSetupDeps = {
  expectedOwnerEmail: BOOTSTRAP_OWNER_EMAIL,
  bootstrapSecret: process.env.SUPER_ADMIN_BOOTSTRAP_SECRET || '',
  signUp: signUpWithEmailPassword,
  signIn: signInWithEmailPassword,
  sendVerification: sendVerificationEmail,
  getDoc: getFirestoreDocument,
  listCol: (token, col) => listFirestoreCollection(token, col, 100),
  createDoc: createFirestoreDocument,
  setDoc: setFirestoreDocument,
  recordEvent: logSecurityEvent,
};

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
  emailVerified: boolean;
  verificationEmailSent: boolean;
  profileInitialized: boolean;
}

/**
 * Executes the Google AI Studio-only initial Super Admin setup.
 * Prevents duplicate Super Admins, enforces strong credentials, and never stores secrets in client code.
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
  const deps: SuperAdminSetupDeps = { ...defaultDeps, ...customDeps };

  const normalizedEmail = String(input.email || '').trim().toLowerCase();
  const displayName = String(input.displayName || 'REDDOX Super Admin').trim().slice(0, 120) || 'REDDOX Super Admin';

  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new InvalidSetupInputError('Provide a valid Super Admin email address.');
  }

  validateSuperAdminPassword(input.password);

  if (deps.bootstrapSecret && input.setupSecret !== deps.bootstrapSecret) {
    throw new InvalidSetupInputError('Invalid SUPER_ADMIN_BOOTSTRAP_SECRET.');
  }

  if (normalizedEmail !== deps.expectedOwnerEmail.toLowerCase()) {
    throw new InvalidSetupInputError(
      `Initial Super Admin email must match the configured owner email (${deps.expectedOwnerEmail}).`
    );
  }

  // Establish or authenticate the Firebase Auth user
  let authRes: IdentityAuthResult;
  let isNewAuthAccount = false;
  try {
    authRes = await deps.signUp({
      email: normalizedEmail,
      password: input.password,
      displayName,
    });
    isNewAuthAccount = true;
  } catch (err) {
    const code = (err as { code?: string }).code || '';
    if (!code.includes('EMAIL_EXISTS')) {
      throw err;
    }
    // Existing Firebase Auth user: authenticate with password to verify ownership before checking lock
    authRes = await deps.signIn({
      email: normalizedEmail,
      password: input.password,
    });
  }

  // Duplicate Super Admin guard (checks both lock document and existing SUPER_ADMIN records)
  const existingInitLock = await deps
    .getDoc(authRes.idToken, 'systemSettings/superAdminInit')
    .catch(() => null);
  if (existingInitLock) {
    throw new DuplicateSuperAdminError();
  }

  const existingUsers = await deps.listCol(authRes.idToken, 'users').catch(() => []);
  const existingSuper = existingUsers.find((u) => u.role === 'SUPER_ADMIN');
  if (existingSuper) {
    throw new DuplicateSuperAdminError(
      `A Super Admin account (${String(existingSuper.email || existingSuper.uid)}) already exists.`
    );
  }

  const existingSelf = await deps.getDoc(authRes.idToken, `users/${authRes.uid}`).catch(() => null);
  if (existingSelf?.role === 'SUPER_ADMIN') {
    throw new DuplicateSuperAdminError();
  }

  let verificationEmailSent = false;
  if (!authRes.emailVerified) {
    await deps.sendVerification(authRes.idToken).then(
      () => {
        verificationEmailSent = true;
      },
      () => {
        verificationEmailSent = false;
      }
    );
  }

  let profileInitialized = false;
  if (authRes.emailVerified) {
    if (!existingSelf) {
      await deps.createDoc(
        authRes.idToken,
        'users',
        authRes.uid,
        {
          uid: authRes.uid,
          displayName,
          email: normalizedEmail,
          role: 'SUPER_ADMIN',
          accountStatus: 'APPROVED',
          permissions: [...ALL_ADMIN_PERMISSIONS],
          approvedBy: authRes.uid,
          themePreference: 'system',
        },
        ['createdAt', 'updatedAt', 'approvedAt', 'lastLoginAt']
      );
    }

    await deps.setDoc(
      authRes.idToken,
      'systemSettings/superAdminInit',
      {
        settingId: 'superAdminInit',
        settingValue: {
          initialized: true,
          superAdminUid: authRes.uid,
          superAdminEmail: normalizedEmail,
        },
        updatedBy: authRes.uid,
      },
      ['updatedAt']
    );

    await deps.recordEvent({
      actorId: authRes.uid,
      action: 'SUPER_ADMIN_INITIALIZED',
      targetId: authRes.uid,
      metadata: { email: normalizedEmail, isNewAuthAccount },
      idToken: authRes.idToken,
    });
    profileInitialized = true;
  } else {
    // Email not yet verified: seed safe least-privilege profile; Firestore rules will elevate strictly after email verification
    if (!existingSelf) {
      await deps.createDoc(
        authRes.idToken,
        'users',
        authRes.uid,
        {
          uid: authRes.uid,
          displayName,
          email: normalizedEmail,
          role: 'CUSTOMER',
          accountStatus: 'PENDING',
          themePreference: 'system',
        },
        ['createdAt', 'updatedAt', 'lastLoginAt']
      );
    }
    await deps.recordEvent({
      actorId: authRes.uid,
      action: 'SUPER_ADMIN_INITIALIZED',
      targetId: authRes.uid,
      metadata: { email: normalizedEmail, pendingEmailVerification: true },
      idToken: authRes.idToken,
    });
  }

  return {
    uid: authRes.uid,
    email: normalizedEmail,
    role: 'SUPER_ADMIN',
    emailVerified: authRes.emailVerified,
    verificationEmailSent,
    profileInitialized,
  };
}
