import type { NextFunction, Request, Response } from 'express';
import { getDatabase, type CliporaDatabase, type StoredUserRow } from '../db/database.ts';
import {
  ALL_ADMIN_PERMISSIONS,
  hasAdminPermission,
  isApprovedAdminCaller,
  isSuperAdminCaller,
  normalizePermissions,
  type AdminPermission,
  type TrustedCaller,
} from '../security/rbac.ts';
import { verifySessionToken } from '../security/sessionToken.ts';
import { logSecurityEvent, type SecurityEventAction } from '../services/securityMonitor.ts';
import { extractRequestToken } from './auth.ts';

export interface AdminAuthRequest extends Request {
  caller?: TrustedCaller;
}

export interface AdminAuthDeps {
  verifyToken: (token: string) => Promise<{ uid: string }>;
  fetchUserRecord: (uid: string) => Promise<StoredUserRow | null>;
  recordSecurityEvent: (params: {
    actorId: string;
    action: SecurityEventAction;
    targetId: string;
    metadata?: Record<string, unknown>;
  }) => Promise<unknown>;
}

export function createDefaultAdminAuthDeps(db?: CliporaDatabase): AdminAuthDeps {
  const resolveDb = () => db ?? getDatabase();
  return {
    async verifyToken(token: string) {
      const verified = verifySessionToken(token);
      if (!verified) {
        throw new Error('Invalid or expired session token.');
      }
      return { uid: verified.uid };
    },
    async fetchUserRecord(uid: string) {
      return resolveDb().getUserAuthByUid(uid);
    },
    async recordSecurityEvent(params) {
      return logSecurityEvent({ ...params, db: resolveDb() });
    },
  };
}

export const defaultAdminAuthDeps: AdminAuthDeps = createDefaultAdminAuthDeps();

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function createAdminMiddleware(deps: AdminAuthDeps = defaultAdminAuthDeps) {
  /**
   * Authenticates caller via signed session token (Bearer header or HttpOnly cookie)
   * and resolves trusted role/status/permissions from server-side database lookup.
   */
  const requireAuthenticatedCaller = async (
    req: AdminAuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const { token, viaCookie } = extractRequestToken(req);
    if (!token) {
      await deps.recordSecurityEvent({
        actorId: 'anonymous',
        action: 'UNAUTHORIZED_ADMIN_API_REQUEST',
        targetId: req.originalUrl || req.path,
        metadata: { reason: 'missing_session_token', ip: req.ip },
      });
      res.status(401).json({ error: 'Authentication required. Please sign in.' });
      return;
    }

    if (viaCookie && MUTATING_METHODS.has(req.method.toUpperCase())) {
      const xrw = String(req.headers['x-requested-with'] || '');
      if (xrw !== 'CliporaApp') {
        res.status(403).json({ error: 'Forbidden: missing anti-CSRF request header.' });
        return;
      }
    }

    let identity: { uid: string };
    try {
      identity = await deps.verifyToken(token);
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
      res.status(401).json({ error: 'Unauthorized: invalid or expired session.' });
      return;
    }

    const userRecord = await deps.fetchUserRecord(identity.uid);
    if (!userRecord) {
      res.status(401).json({ error: 'Unauthorized: account record not found.' });
      return;
    }

    const effectivePermissions: AdminPermission[] =
      userRecord.role === 'SUPER_ADMIN'
        ? [...ALL_ADMIN_PERMISSIONS]
        : userRecord.role === 'ADMIN'
        ? normalizePermissions(userRecord.permissions)
        : [];

    req.caller = {
      uid: userRecord.uid,
      email: userRecord.email,
      emailVerified: true,
      role: userRecord.role,
      accountStatus: userRecord.accountStatus,
      permissions: effectivePermissions,
      isBootstrapOwner: userRecord.role === 'SUPER_ADMIN' && userRecord.accountStatus === 'APPROVED',
      idToken: token,
    };

    next();
  };

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
      });
      res.status(403).json({
        error: 'Forbidden: Administrator authorization and approved account status required.',
      });
      return;
    }

    next();
  };

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
        });
        res.status(403).json({
          error: `Forbidden: Missing required administrator permission (${permission}).`,
        });
        return;
      }
      next();
    };
  };

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
