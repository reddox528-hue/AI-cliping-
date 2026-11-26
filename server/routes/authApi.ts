import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import { getDatabase, type CliporaDatabase } from '../db/database.ts';
import { createAuthMiddleware, type AuthenticatedRequest } from '../middleware/auth.ts';
import { createRateLimiter } from '../middleware/rateLimit.ts';
import { hashPassword, verifyPassword } from '../security/password.ts';
import {
  buildClearSessionCookieHeader,
  buildSessionCookieHeader,
  isHttpsRequest,
  signSessionToken,
} from '../security/sessionToken.ts';
import { logSecurityEvent } from '../services/securityMonitor.ts';
import {
  DuplicateSuperAdminError,
  initializeSuperAdmin,
  InvalidSetupInputError,
} from '../services/superAdminSetup.ts';
import { env } from '../config/env.ts';

const authRateLimit = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 25,
  keyPrefix: 'auth_endpoints',
});

export function createAuthApiRouter(dbOverride?: CliporaDatabase) {
  const router = Router();
  const resolveDb = () => dbOverride ?? getDatabase();
  const { requireAuth } = createAuthMiddleware(dbOverride);

  // Indicates whether the initial Super Admin has been configured yet (no secret/email exposed)
  router.get('/super-admin-status', (_req: Request, res: Response) => {
    const db = resolveDb();
    res.json({ initialized: db.hasSuperAdmin() });
  });

  // One-time first-run Super Admin initialization via /secure-control-panel when !initialized
  router.post('/setup-super-admin', authRateLimit, async (req: Request, res: Response) => {
    try {
      const db = resolveDb();
      const email = typeof req.body?.email === 'string' ? req.body.email : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const displayName = typeof req.body?.displayName === 'string' ? req.body.displayName : '';
      const setupSecret = typeof req.body?.setupSecret === 'string' ? req.body.setupSecret : undefined;

      const result = await initializeSuperAdmin(
        { email, password, displayName, setupSecret },
        {
          expectedOwnerEmail: env.superAdminEmail,
          bootstrapSecret: env.superAdminBootstrapSecret,
          db,
        }
      );

      const user = db.getPublicUserByUid(result.uid);
      const token = signSessionToken(result.uid);
      res.setHeader('Set-Cookie', buildSessionCookieHeader(token, isHttpsRequest(req)));
      res.status(201).json({ token, user });
    } catch (err) {
      if (err instanceof DuplicateSuperAdminError) {
        res.status(409).json({ error: err.message });
        return;
      }
      if (err instanceof InvalidSetupInputError) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : 'Super Admin setup failed.' });
    }
  });

  // Public customer registration (ALWAYS creates role=CUSTOMER, accountStatus=PENDING)
  router.post('/register', authRateLimit, async (req: Request, res: Response) => {
    try {
      const db = resolveDb();
      const displayName = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : '';
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';

      if (!displayName || displayName.length > 120) {
        res.status(400).json({ error: 'Enter a valid name (1 to 120 characters).' });
        return;
      }
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        res.status(400).json({ error: 'Enter a valid email address.' });
        return;
      }
      if (password.length < 8) {
        res.status(400).json({ error: 'Password must be at least 8 characters.' });
        return;
      }

      const existing = db.getUserAuthByEmail(email);
      if (existing) {
        res.status(409).json({ error: 'An account with this email already exists. Try signing in instead.' });
        return;
      }

      const uid = `usr_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
      const user = db.createUser({
        uid,
        displayName,
        email,
        passwordHash: hashPassword(password),
        role: 'CUSTOMER',
        accountStatus: 'PENDING',
        permissions: [],
      });

      db.createNotification({
        ownerId: uid,
        type: 'ACCOUNT_STATUS',
        title: 'Registration Received',
        message: 'Your account has been registered and is awaiting administrator approval.',
      });

      await logSecurityEvent({
        actorId: uid,
        action: 'USER_REGISTERED',
        targetId: uid,
        metadata: { email, role: 'CUSTOMER' },
        db,
      });

      const token = signSessionToken(uid);
      res.setHeader('Set-Cookie', buildSessionCookieHeader(token, isHttpsRequest(req)));
      res.status(201).json({ token, user });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Registration failed.' });
    }
  });

  // Email + password login
  router.post('/login', authRateLimit, (req: Request, res: Response) => {
    try {
      const db = resolveDb();
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';

      if (!email || !password) {
        res.status(400).json({ error: 'Email and password are required.' });
        return;
      }

      const userRow = db.getUserAuthByEmail(email);
      if (!userRow || !verifyPassword(password, userRow.passwordHash)) {
        res.status(401).json({ error: 'Invalid email or password.' });
        return;
      }

      db.touchUserLogin(userRow.uid);
      const user = db.getPublicUserByUid(userRow.uid);
      const token = signSessionToken(userRow.uid);

      res.setHeader('Set-Cookie', buildSessionCookieHeader(token, isHttpsRequest(req)));
      res.json({ token, user });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Sign-in failed.' });
    }
  });

  router.post('/logout', (req: Request, res: Response) => {
    res.setHeader('Set-Cookie', buildClearSessionCookieHeader(isHttpsRequest(req)));
    res.json({ ok: true });
  });

  // Returns current session profile, notifications, and workspace settings
  router.get('/session', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const db = resolveDb();
    const uid = req.auth!.uid;
    const user = db.getPublicUserByUid(uid);
    if (!user) {
      res.status(401).json({ error: 'Session account not found.' });
      return;
    }
    const notifications = db.listNotificationsByOwner(uid);
    const limits = db.getSystemSetting('limits');
    const aiConfig = db.getSystemSetting('aiConfig');

    res.json({
      user,
      token: req.auth!.token,
      notifications,
      settings: { limits, aiConfig },
    });
  });

  // Update own displayName / themePreference (never role/status/permissions)
  router.patch('/profile', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const db = resolveDb();
    const uid = req.auth!.uid;
    const displayName = typeof req.body?.displayName === 'string' ? req.body.displayName : undefined;
    const photoURL = typeof req.body?.photoURL === 'string' ? req.body.photoURL : undefined;
    const themePreference =
      req.body?.themePreference === 'light' ||
      req.body?.themePreference === 'dark' ||
      req.body?.themePreference === 'system'
        ? req.body.themePreference
        : undefined;

    const updated = db.updateUserProfile(uid, { displayName, photoURL, themePreference });
    if (!updated) {
      res.status(404).json({ error: 'User profile not found.' });
      return;
    }
    res.json({ user: updated });
  });

  // Authenticated self-service password change
  router.post('/change-password', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const db = resolveDb();
    const uid = req.auth!.uid;
    const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

    const userRow = db.getUserAuthByUid(uid);
    if (!userRow || !verifyPassword(currentPassword, userRow.passwordHash)) {
      res.status(401).json({ error: 'Current password is incorrect.' });
      return;
    }

    const minLength = userRow.role === 'CUSTOMER' ? 8 : 12;
    if (newPassword.length < minLength) {
      res.status(400).json({ error: `New password must be at least ${minLength} characters.` });
      return;
    }

    db.updateUserPasswordHash(uid, hashPassword(newPassword));
    res.json({ ok: true });
  });

  return router;
}
