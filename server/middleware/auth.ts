import type { NextFunction, Request, Response } from 'express';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { env } from '../config/env.ts';

export interface AuthenticatedRequest extends Request {
  auth?: {
    uid: string;
    email?: string;
    emailVerified: boolean;
  };
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

export async function requireFirebaseAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required. Missing Bearer token.' });
      return;
    }

    const idToken = authHeader.slice('Bearer '.length).trim();
    if (!idToken || idToken.length > 8192) {
      res.status(401).json({ error: 'Invalid authentication token format.' });
      return;
    }

    const adminAuth = getFirebaseAdminAuth();
    const decoded = await adminAuth.verifyIdToken(idToken);

    req.auth = {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: Boolean(decoded.email_verified),
    };

    next();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Token verification failed';
    res.status(401).json({ error: `Unauthorized: ${message}` });
  }
}
