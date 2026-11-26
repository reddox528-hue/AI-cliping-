import type { NextFunction, Request, Response } from 'express';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { env } from '../config/env.ts';
import {
  ALL_ADMIN_PERMISSIONS,
  BOOTSTRAP_OWNER_EMAIL,
  hasAdminPermission,
  isApprovedAdminCaller,
  isSuperAdminCaller,
  normalizePermissions,
  type AccountStatus,
  type AdminPermission,
  type TrustedCaller,
  type UserRole,
} from '../security/rbac.ts';
import { getFirestoreDocument } from '../services/firestoreRest.ts';
import { logSecurityEvent, type SecurityEventAction } from '../services/securityMonitor.ts';

export interface DecodedFirebaseIdentity {
  uid: string;
  email?: string;
  emailVerified: boolean;
  claimsRole?: string;
  claimsPermissions?: unknown;
}

export interface AdminAuthRequest extends Request {
  caller?: TrustedCaller;
}

export interface AdminAuthDeps {
  verifyToken: (idToken: string) => Promise<DecodedFirebaseIdentity>;
  fetchUserRecord: (
    idToken: string,
    uid: string
  ) => Promise<Record<string, unknown> | null>;
  recordSecurityEvent: (params: {
    actorId: string;
    action: SecurityEventAction;
    targetId: string;
    metadata?: Record<string, unknown>;
    idToken?: string;
  }) => Promise<unknown>;
}

function getFirebaseAdminAuth() {
  if (!env.firebaseProjectId || env.firebaseProjectId === 'remixed-project-id') {
    throw new Error('Firebase project is not configured.');
  }
  const app = getApps().length
    ? getApp()
    : initializeApp({ projectId: env.firebaseProjectId });
  return getAuth(app);
}

export const defaultAdminAuthDeps: AdminAuthDeps = {
  async verifyToken(idToken: string): Promise<DecodedFirebaseIdentity> {
    const adminAuth = getFirebaseAdminAuth();
    const decoded = await adminAuth.verifyIdToken(idToken);
    return {
      uid: decoded.uid,
      email: typeof decoded.email === 'string' ? decoded.email : undefined,
      emailVerified: Boolean(decoded.email_verified),
      claimsRole: typeof decoded.role === 'string' ? decoded.role : undefined,
      claimsPermissions: decoded.permissions,
    };
  },
  async fetchUserRecord(idToken: string, uid: string) {
    return getFirestoreDocument(idToken, `users/${uid}`);
  },
  recordSecurityEvent: logSecurityEvent,
};

function parseRole(raw: unknown): UserRole {
  if (raw === 'SUPER_ADMIN' || raw === 'ADMIN' || raw === 'CUSTOMER') {
    return raw;
  }
  return 'CUSTOMER';
}

function parseAccountStatus(raw: unknown): AccountStatus {
  if (raw === 'APPROVED' || raw === 'PENDING' || raw === 'REJECTED' || raw === 'SUSPENDED') {
    return raw;
  }
  return 'PENDING';
}

export function createAdminMiddleware(deps: AdminAuthDeps = defaultAdminAuthDeps) {
  /**
   * Authenticates caller via Firebase ID token and resolves trusted role/status/permissions
   * from server-side Firestore lookup & verified token claims (never from browser payload).
   */
  const requireAuthenticatedCaller = async (
    req: AdminAuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      await deps.recordSecurityEvent({
        actorId: 'anonymous',
        action: 'UNAUTHORIZED_ADMIN_API_REQUEST',
        targetId: req.originalUrl || req.path,
        metadata: { reason: 'missing_bearer_token', ip: req.ip },
      });
      res.status(401).json({ error: 'Authentication required. Missing Bearer token.' });
      return;
    }

    const idToken = authHeader.slice('Bearer '.length).trim();
    if (!idToken || idToken.length > 8192) {
      await deps.recordSecurityEvent({
        actorId: 'anonymous',
        action: 'FAILED_ADMIN_LOGIN',
        targetId: req.originalUrl || req.path,
        metadata: { reason: 'malformed_token', ip: req.ip },
      });
      res.status(401).json({ error: 'Invalid authentication token format.' });
      return;
    }

    let decoded: DecodedFirebaseIdentity;
    try {
      decoded = await deps.verifyToken(idToken);
    } catch (err) {
      await deps.recordSecurityEvent({
        actorId: 'anonymous',
        action: 'FAILED_ADMIN_LOGIN',
        targetId: req.originalUrl || req.path,
        metadata: {
          reason: err instanceof Error ? err.message : 'token_verification_failed',
          ip: req.ip,
        },
      });
      res.status(401).json({ error: 'Unauthorized: invalid or expired authentication token.' });
      return;
    }

    const isBootstrapOwner =
      Boolean(decoded.emailVerified) &&
      typeof decoded.email === 'string' &&
      decoded.email.toLowerCase() === BOOTSTRAP_OWNER_EMAIL;

    let userRecord: Record<string, unknown> | null = null;
    try {
      userRecord = await deps.fetchUserRecord(idToken, decoded.uid);
    } catch (err) {
      res.status(503).json({
        error: err instanceof Error ? err.message : 'Unable to verify user authorization state.',
      });
      return;
    }

    // Trusted role resolution: verified custom claims or server-fetched Firestore profile;
    // NEVER read role/status/permissions from browser headers or body.
    const storedRole = parseRole(userRecord?.role ?? decoded.claimsRole);
    const storedStatus = parseAccountStatus(userRecord?.accountStatus);
    const storedPermissions = normalizePermissions(
      userRecord?.permissions ?? decoded.claimsPermissions
    );

    const effectiveRole: UserRole = isBootstrapOwner ? 'SUPER_ADMIN' : storedRole;
    const effectiveStatus: AccountStatus = isBootstrapOwner ? 'APPROVED' : storedStatus;
    const effectivePermissions: AdminPermission[] =
      effectiveRole === 'SUPER_ADMIN'
        ? [...ALL_ADMIN_PERMISSIONS]
        : effectiveRole === 'ADMIN'
        ? storedPermissions
        : [];

    req.caller = {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: decoded.emailVerified,
      role: effectiveRole,
      accountStatus: effectiveStatus,
      permissions: effectivePermissions,
      isBootstrapOwner,
      idToken,
    };

    next();
  };

  /**
   * Requires caller to be an APPROVED ADMIN or SUPER_ADMIN.
   */
  const requireAdminAccess = async (
    req: AdminAuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const caller = req.caller;
    if (!caller) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    if (!isApprovedAdminCaller(caller)) {
      await deps.recordSecurityEvent({
        actorId: caller.uid,
        action: 'UNAUTHORIZED_ADMIN_API_REQUEST',
        targetId: req.originalUrl || req.path,
        metadata: {
          callerRole: caller.role,
          accountStatus: caller.accountStatus,
          ip: req.ip,
        },
        idToken: caller.idToken,
      });
      res.status(403).json({
        error: 'Forbidden: Administrator authorization and approved account status required.',
      });
      return;
    }

    next();
  };

  /**
   * Requires a specific granular AdminPermission (SUPER_ADMIN always passes).
   */
  const requirePermission = (permission: AdminPermission) => {
    return async (
      req: AdminAuthRequest,
      res: Response,
      next: NextFunction
    ): Promise<void> => {
      const caller = req.caller;
      if (!caller) {
        res.status(401).json({ error: 'Authentication required.' });
        return;
      }
      if (!hasAdminPermission(caller, permission)) {
        await deps.recordSecurityEvent({
          actorId: caller.uid,
          action: 'UNAUTHORIZED_ADMIN_API_REQUEST',
          targetId: req.originalUrl || req.path,
          metadata: {
            requiredPermission: permission,
            callerRole: caller.role,
          },
          idToken: caller.idToken,
        });
        res.status(403).json({
          error: `Forbidden: Missing required administrator permission (${permission}).`,
        });
        return;
      }
      next();
    };
  };

  /**
   * Strictly requires SUPER_ADMIN role. Standard ADMINs receive HTTP 403.
   */
  const requireSuperAdmin = async (
    req: AdminAuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const caller = req.caller;
    if (!caller) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!isSuperAdminCaller(caller)) {
      await deps.recordSecurityEvent({
        actorId: caller.uid,
        action: 'UNAUTHORIZED_ADMIN_API_REQUEST',
        targetId: req.originalUrl || req.path,
        metadata: {
          reason: 'super_admin_only',
          callerRole: caller.role,
        },
        idToken: caller.idToken,
      });
      res.status(403).json({
        error: 'Forbidden: SUPER_ADMIN authorization required for this operation.',
      });
      return;
    }
    next();
  };

  return {
    requireAuthenticatedCaller,
    requireAdminAccess,
    requirePermission,
    requireSuperAdmin,
  };
}
