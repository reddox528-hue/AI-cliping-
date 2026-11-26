import type { NextFunction, Request, Response } from 'express';
import { getDatabase, type CliporaDatabase } from '../db/database.ts';
import type { AccountStatus, UserRole } from '../security/rbac.ts';
import {
  parseCookieHeader,
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from '../security/sessionToken.ts';

export interface AuthenticatedRequest extends Request {
  auth?: {
    uid: string;
    email: string;
    role: UserRole;
    accountStatus: AccountStatus;
    token: string;
  };
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function extractRequestToken(req: Request): {
  token: string | null;
  viaCookie: boolean;
} {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice('Bearer '.length).trim();
    if (bearer) return { token: bearer, viaCookie: false };
  }

  const cookies = parseCookieHeader(req.headers.cookie);
  const cookieToken = cookies[SESSION_COOKIE_NAME];
  if (cookieToken) {
    return { token: cookieToken, viaCookie: true };
  }

  return { token: null, viaCookie: false };
}

export function createAuthMiddleware(db?: CliporaDatabase) {
  const resolveDb = () => db ?? getDatabase();

  const requireAuth = (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): void => {
    const { token, viaCookie } = extractRequestToken(req);
    if (!token) {
      res.status(401).json({ error: 'Authentication required. Please sign in.' });
      return;
    }

    // CSRF defense when relying solely on HttpOnly cookies for state-changing requests
    if (viaCookie && MUTATING_METHODS.has(req.method.toUpperCase())) {
      const xrw = String(req.headers['x-requested-with'] || '');
      if (xrw !== 'CliporaApp') {
        res.status(403).json({ error: 'Forbidden: missing anti-CSRF request header.' });
        return;
      }
    }

    const payload = verifySessionToken(token);
    if (!payload) {
      res.status(401).json({ error: 'Unauthorized: invalid or expired session.' });
      return;
    }

    const user = resolveDb().getUserAuthByUid(payload.uid);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized: account no longer exists.' });
      return;
    }

    req.auth = {
      uid: user.uid,
      email: user.email,
      role: user.role,
      accountStatus: user.accountStatus,
      token,
    };

    next();
  };

  const requireApprovedUser = (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): void => {
    if (!req.auth) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (req.auth.accountStatus !== 'APPROVED') {
      res.status(403).json({
        error: 'Your account must be approved by an administrator before using workspace features.',
      });
      return;
    }
    next();
  };

  return { requireAuth, requireApprovedUser };
}

const defaultMiddlewares = createAuthMiddleware();
export const requireAuth = defaultMiddlewares.requireAuth;
export const requireApprovedUser = defaultMiddlewares.requireApprovedUser;
