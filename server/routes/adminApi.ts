import crypto from 'crypto';
import { Router, type Response } from 'express';
import { isGeminiConfigured, isR2Configured } from '../config/env.ts';
import {
  createAdminMiddleware,
  defaultAdminAuthDeps,
  type AdminAuthDeps,
  type AdminAuthRequest,
} from '../middleware/adminAuth.ts';
import { createRateLimiter } from '../middleware/rateLimit.ts';
import {
  ALL_ADMIN_PERMISSIONS,
  canManageTargetAccount,
  DEFAULT_ADMIN_PERMISSIONS,
  isSuperAdminCaller,
  normalizePermissions,
  type AccountStatus,
  type AdminPermission,
  type UserRole,
} from '../security/rbac.ts';
import {
  sendPasswordResetEmailApi,
  sendVerificationEmail,
  signUpWithEmailPassword,
  type IdentityAuthResult,
} from '../services/firebaseIdentityToolkit.ts';
import {
  createFirestoreDocument,
  deleteFirestoreDocument,
  getFirestoreDocument,
  listFirestoreCollection,
  patchFirestoreDocument,
  setFirestoreDocument,
} from '../services/firestoreRest.ts';
import {
  getRecentSecurityEvents,
  logSecurityEvent,
  type SecurityEventAction,
} from '../services/securityMonitor.ts';

export interface AdminFirestoreStore {
  getDoc: (idToken: string, docPath: string) => Promise<Record<string, unknown> | null>;
  listCol: (idToken: string, collectionName: string) => Promise<Array<Record<string, unknown>>>;
  createDoc: (
    idToken: string,
    collectionName: string,
    docId: string,
    data: Record<string, unknown>,
    serverTimeFields?: string[]
  ) => Promise<void>;
  patchDoc: (
    idToken: string,
    docPath: string,
    data: Record<string, unknown>,
    serverTimeFields?: string[]
  ) => Promise<void>;
  setDoc: (
    idToken: string,
    docPath: string,
    data: Record<string, unknown>,
    serverTimeFields?: string[]
  ) => Promise<void>;
  deleteDoc: (idToken: string, docPath: string) => Promise<void>;
}

const defaultAdminStore: AdminFirestoreStore = {
  getDoc: getFirestoreDocument,
  listCol: (token, col) => listFirestoreCollection(token, col, 400),
  createDoc: createFirestoreDocument,
  patchDoc: patchFirestoreDocument,
  setDoc: setFirestoreDocument,
  deleteDoc: deleteFirestoreDocument,
};

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

function isValidId(id: string): boolean {
  return VALID_ID_REGEX.test(id);
}

export interface AdminIdentityProvider {
  signUp: (params: {
    email: string;
    password: string;
    displayName?: string;
  }) => Promise<IdentityAuthResult>;
  sendVerification: (idToken: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
}

const defaultIdentityProvider: AdminIdentityProvider = {
  signUp: signUpWithEmailPassword,
  sendVerification: sendVerificationEmail,
  sendPasswordReset: sendPasswordResetEmailApi,
};

export function createAdminApiRouter(options?: {
  authDeps?: AdminAuthDeps;
  store?: AdminFirestoreStore;
  identity?: AdminIdentityProvider;
}) {
  const router = Router();
  const authDeps = options?.authDeps ?? defaultAdminAuthDeps;
  const store = options?.store ?? defaultAdminStore;
  const identity = options?.identity ?? defaultIdentityProvider;
  const {
    requireAuthenticatedCaller,
    requireAdminAccess,
    requirePermission,
    requireSuperAdmin,
  } = createAdminMiddleware(authDeps);

  const adminRateLimit = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 90,
    keyPrefix: 'admin_api',
  });

  // Any authenticated user hitting an admin route or session check passes through token verification first
  router.use(requireAuthenticatedCaller, adminRateLimit);

  // Endpoint allowing authenticated client route guard to report unauthorized route navigation before redirect
  router.post('/security-events', async (req: AdminAuthRequest, res: Response) => {
    const caller = req.caller!;
    const rawAction = typeof req.body?.action === 'string' ? req.body.action : '';
    const allowedClientEvents = new Set<SecurityEventAction>([
      'FAILED_ADMIN_LOGIN',
      'UNAUTHORIZED_ADMIN_ROUTE_ACCESS',
    ]);
    const action: SecurityEventAction = allowedClientEvents.has(rawAction as SecurityEventAction)
      ? (rawAction as SecurityEventAction)
      : 'UNAUTHORIZED_ADMIN_ROUTE_ACCESS';

    await authDeps.recordSecurityEvent({
      actorId: caller.uid,
      action,
      targetId: typeof req.body?.path === 'string' ? req.body.path.slice(0, 128) : '/secure-control-panel',
      metadata: {
        callerRole: caller.role,
        accountStatus: caller.accountStatus,
        ip: req.ip,
      },
      idToken: caller.idToken,
    });
    res.status(202).json({ recorded: true });
  });

  // Verify admin session & return trusted server-resolved role & permissions
  router.get('/session', requireAdminAccess, async (req: AdminAuthRequest, res: Response) => {
    const caller = req.caller!;
    if (caller.isBootstrapOwner && caller.email) {
      try {
        const existing = await store.getDoc(caller.idToken, `users/${caller.uid}`);
        if (!existing) {
          await store.createDoc(
            caller.idToken,
            'users',
            caller.uid,
            {
              uid: caller.uid,
              displayName: caller.email.split('@')[0] || 'REDDOX Super Admin',
              email: caller.email.toLowerCase(),
              role: 'SUPER_ADMIN',
              accountStatus: 'APPROVED',
              permissions: [...ALL_ADMIN_PERMISSIONS],
              approvedBy: caller.uid,
              themePreference: 'system',
            },
            ['createdAt', 'updatedAt', 'approvedAt', 'lastLoginAt']
          );
        } else if (existing.role !== 'SUPER_ADMIN' || existing.accountStatus !== 'APPROVED') {
          await store.patchDoc(
            caller.idToken,
            `users/${caller.uid}`,
            {
              role: 'SUPER_ADMIN',
              accountStatus: 'APPROVED',
              permissions: [...ALL_ADMIN_PERMISSIONS],
              approvedBy: caller.uid,
            },
            ['updatedAt', 'approvedAt']
          );
        }
      } catch {
        // Non-fatal; bootstrap owner claim already grants verified SUPER_ADMIN session
      }
    }
    res.json({
      authorized: true,
      uid: caller.uid,
      email: caller.email || '',
      role: caller.role,
      accountStatus: caller.accountStatus,
      permissions: caller.permissions,
      isSuperAdmin: isSuperAdminCaller(caller),
    });
  });

  // Record explicit administrator login event in audit logs
  router.post('/session/login-event', requireAdminAccess, async (req: AdminAuthRequest, res: Response) => {
    const caller = req.caller!;
    await authDeps.recordSecurityEvent({
      actorId: caller.uid,
      action: 'ADMIN_LOGIN',
      targetId: '/secure-control-panel',
      metadata: {
        email: caller.email || '',
        role: caller.role,
        ip: req.ip,
      },
      idToken: caller.idToken,
    });
    res.status(202).json({ recorded: true });
  });

  // Dashboard metrics
  router.get(
    '/dashboard',
    requireAdminAccess,
    requirePermission('VIEW_DASHBOARD'),
    async (req: AdminAuthRequest, res: Response) => {
      try {
        const caller = req.caller!;
        const [users, projects, videos, clips, exportsList, jobs] = await Promise.all([
          store.listCol(caller.idToken, 'users'),
          store.listCol(caller.idToken, 'projects'),
          store.listCol(caller.idToken, 'sourceVideos'),
          store.listCol(caller.idToken, 'clips'),
          store.listCol(caller.idToken, 'exports'),
          store.listCol(caller.idToken, 'processingJobs'),
        ]);

        const visibleUsers = isSuperAdminCaller(caller)
          ? users
          : users.filter((u) => u.role === 'CUSTOMER');

        const totalStorageBytes =
          videos.reduce((s, v) => s + Number(v.fileSize || 0), 0) +
          exportsList.reduce((s, e) => s + Number(e.fileSize || 0), 0);

        res.json({
          metrics: {
            totalUsers: visibleUsers.length,
            approvedUsers: visibleUsers.filter((u) => u.accountStatus === 'APPROVED').length,
            pendingApprovals: users.filter((u) => u.accountStatus === 'PENDING').length,
            suspendedUsers: visibleUsers.filter((u) => u.accountStatus === 'SUSPENDED').length,
            totalProjects: projects.length,
            totalVideos: videos.length,
            totalClips: clips.length,
            completedExports: exportsList.filter((e) => e.status === 'COMPLETED').length,
            failedJobs: jobs.filter((j) => j.status === 'FAILED').length,
            totalStorageMb: Number((totalStorageBytes / (1024 * 1024)).toFixed(2)),
          },
          capabilities: {
            geminiConfigured: isGeminiConfigured(),
            r2Configured: isR2Configured(),
            emailConfigured: false,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load admin dashboard.';
        res.status(500).json({ error: message });
      }
    }
  );

  // List users (SUPER_ADMIN sees all accounts; standard ADMIN sees customers only)
  router.get(
    '/users',
    requireAdminAccess,
    requirePermission('MANAGE_CUSTOMERS'),
    async (req: AdminAuthRequest, res: Response) => {
      try {
        const caller = req.caller!;
        const users = await store.listCol(caller.idToken, 'users');
        const filtered = isSuperAdminCaller(caller)
          ? users
          : users.filter((u) => u.role === 'CUSTOMER');
        res.json({ users: filtered });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load users.' });
      }
    }
  );

  // List pending registrations
  router.get(
    '/approvals',
    requireAdminAccess,
    requirePermission('REVIEW_APPROVALS'),
    async (req: AdminAuthRequest, res: Response) => {
      try {
        const caller = req.caller!;
        const users = await store.listCol(caller.idToken, 'users');
        const pending = users.filter((u) => u.accountStatus === 'PENDING');
        res.json({ pendingUsers: pending });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load approvals.' });
      }
    }
  );

  // Approve / reject / suspend / reactivate a user
  router.post(
    '/approvals/:targetUid',
    requireAdminAccess,
    requirePermission('REVIEW_APPROVALS'),
    async (req: AdminAuthRequest, res: Response) => {
      try {
        const caller = req.caller!;
        const targetUid = String(req.params.targetUid || '');
        const nextStatus = req.body?.accountStatus as AccountStatus;

        if (!isValidId(targetUid)) {
          res.status(400).json({ error: 'Invalid target user identifier.' });
          return;
        }
        if (!['APPROVED', 'REJECTED', 'SUSPENDED', 'PENDING'].includes(nextStatus)) {
          res.status(400).json({ error: 'Invalid accountStatus value.' });
          return;
        }

        const targetDoc = await store.getDoc(caller.idToken, `users/${targetUid}`);
        if (!targetDoc) {
          res.status(404).json({ error: 'Target user not found.' });
          return;
        }

        const targetRole = (targetDoc.role as UserRole) || 'CUSTOMER';
        if (!canManageTargetAccount(caller, targetUid, targetRole)) {
          await authDeps.recordSecurityEvent({
            actorId: caller.uid,
            action: 'UNAUTHORIZED_ADMIN_API_REQUEST',
            targetId: targetUid,
            metadata: {
              reason: 'cannot_modify_self_or_higher_privilege_account',
              callerRole: caller.role,
              targetRole,
            },
            idToken: caller.idToken,
          });
          res.status(403).json({
            error: 'Forbidden: You cannot modify your own privileges or manage administrator accounts.',
          });
          return;
        }

        const previousStatus = String(targetDoc.accountStatus || 'PENDING');
        const patchFields: Record<string, unknown> = {
          accountStatus: nextStatus,
        };
        if (nextStatus === 'APPROVED') {
          patchFields.approvedBy = caller.uid;
        }

        const serverTimeFields =
          nextStatus === 'APPROVED' ? ['updatedAt', 'approvedAt'] : ['updatedAt'];

        await store.patchDoc(
          caller.idToken,
          `users/${targetUid}`,
          patchFields,
          serverTimeFields
        );

        const actionMap: Record<AccountStatus, SecurityEventAction> = {
          APPROVED: previousStatus === 'SUSPENDED' ? 'ACCOUNT_REACTIVATED' : 'ACCOUNT_APPROVED',
          REJECTED: 'ACCOUNT_REJECTED',
          SUSPENDED: 'ACCOUNT_SUSPENDED',
          PENDING: 'ACCOUNT_REACTIVATED',
        };
        await authDeps.recordSecurityEvent({
          actorId: caller.uid,
          action: actionMap[nextStatus],
          targetId: targetUid,
          metadata: { previousStatus, nextStatus, targetRole },
          idToken: caller.idToken,
        });

        const notifId = `notif_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const statusTitles: Record<AccountStatus, { title: string; message: string }> = {
          APPROVED: {
            title: 'Account Approved',
            message: 'Your REDDOX Clipora AI account has been approved by an administrator.',
          },
          REJECTED: {
            title: 'Account Application Declined',
            message: 'Your account registration was declined by an administrator.',
          },
          SUSPENDED: {
            title: 'Account Suspended',
            message: 'Your account access has been suspended by an administrator.',
          },
          PENDING: {
            title: 'Account Status Updated',
            message: 'Your account status was returned to pending review.',
          },
        };
        await store
          .createDoc(
            caller.idToken,
            'notifications',
            notifId,
            {
              notificationId: notifId,
              ownerId: targetUid,
              type: 'ACCOUNT_STATUS',
              title: statusTitles[nextStatus].title,
              message: statusTitles[nextStatus].message,
              read: false,
            },
            ['createdAt']
          )
          .catch(() => {});

        res.json({ ok: true, uid: targetUid, accountStatus: nextStatus });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Status update failed.' });
      }
    }
  );

  // SUPER_ADMIN or explicitly authorized ADMIN (CREATE_ADMINS): Create or provision an administrator
  router.post(
    '/users/provision-admin',
    requireAdminAccess,
    requirePermission('CREATE_ADMINS'),
    async (req: AdminAuthRequest, res: Response) => {
      try {
        const caller = req.caller!;
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        const uid = typeof req.body?.uid === 'string' ? req.body.uid.trim() : '';
        const displayName =
          typeof req.body?.displayName === 'string' && req.body.displayName.trim()
            ? req.body.displayName.trim().slice(0, 120)
            : email.split('@')[0] || 'Administrator';
        const initialPassword =
          typeof req.body?.initialPassword === 'string' ? req.body.initialPassword : '';
        const requestedPermissions = normalizePermissions(req.body?.permissions);

        if (!email && !uid) {
          res.status(400).json({ error: 'Provide the user email or UID to create or provision.' });
          return;
        }

        // Ordinary ADMINs with CREATE_ADMINS can never grant CREATE_ADMINS or exceed their own permissions
        if (!isSuperAdminCaller(caller) && requestedPermissions.includes('CREATE_ADMINS')) {
          res.status(403).json({
            error: 'Forbidden: Only SUPER_ADMIN can grant the CREATE_ADMINS capability.',
          });
          return;
        }

        const safeDefaultPerms: AdminPermission[] = isSuperAdminCaller(caller)
          ? [...DEFAULT_ADMIN_PERMISSIONS]
          : caller.permissions.filter((p) => p !== 'CREATE_ADMINS');
        const permissions: AdminPermission[] =
          requestedPermissions.length > 0
            ? isSuperAdminCaller(caller)
              ? requestedPermissions
              : requestedPermissions.filter(
                  (p) => p !== 'CREATE_ADMINS' && caller.permissions.includes(p)
                )
            : safeDefaultPerms;

        const allUsers = await store.listCol(caller.idToken, 'users');
        let target = allUsers.find(
          (u) =>
            (uid && u.uid === uid) ||
            (email && String(u.email || '').toLowerCase() === email)
        );
        let createdNewAuthAccount = false;

        if (!target) {
          if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            res.status(400).json({ error: 'Provide a valid email address for the new administrator.' });
            return;
          }
          if (!initialPassword) {
            res.status(404).json({
              error:
                'User account not found. Provide an initial temporary password (min 10 chars) to create their Firebase Auth account directly, or have them register first.',
            });
            return;
          }
          if (initialPassword.length < 10) {
            res.status(400).json({
              error: 'Temporary administrator password must be at least 10 characters long.',
            });
            return;
          }

          const authRes = await identity.signUp({
            email,
            password: initialPassword,
            displayName,
          });
          await identity.sendVerification(authRes.idToken).catch(() => {});

          // Step 1: Seed base user doc as new owner (CUSTOMER + PENDING) per Firestore rules
          await store.createDoc(
            authRes.idToken,
            'users',
            authRes.uid,
            {
              uid: authRes.uid,
              displayName,
              email,
              role: 'CUSTOMER',
              accountStatus: 'PENDING',
              themePreference: 'system',
            },
            ['createdAt', 'updatedAt', 'lastLoginAt']
          );

          target = { uid: authRes.uid, email, role: 'CUSTOMER', accountStatus: 'PENDING' };
          createdNewAuthAccount = true;
        }

        const targetUid = String(target.uid);
        if (targetUid === caller.uid) {
          res.status(403).json({ error: 'Cannot alter your own account privileges.' });
          return;
        }

        if (!isSuperAdminCaller(caller) && target.role !== 'CUSTOMER') {
          res.status(403).json({
            error: 'Forbidden: Only SUPER_ADMIN can modify existing administrator accounts.',
          });
          return;
        }

        await store.patchDoc(
          caller.idToken,
          `users/${targetUid}`,
          {
            role: 'ADMIN',
            accountStatus: 'APPROVED',
            permissions,
            approvedBy: caller.uid,
          },
          ['updatedAt', 'approvedAt']
        );

        await authDeps.recordSecurityEvent({
          actorId: caller.uid,
          action: 'ADMIN_CREATED',
          targetId: targetUid,
          metadata: {
            email: target.email || email,
            permissions,
            createdNewAuthAccount,
          },
          idToken: caller.idToken,
        });

        res.json({
          ok: true,
          uid: targetUid,
          role: 'ADMIN',
          accountStatus: 'APPROVED',
          permissions,
          createdNewAuthAccount,
        });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Admin provisioning failed.' });
      }
    }
  );

  // SUPER_ADMIN ONLY: Send password reset email to an administrator
  router.post(
    '/users/:targetUid/password-reset',
    requireAdminAccess,
    requireSuperAdmin,
    async (req: AdminAuthRequest, res: Response) => {
      try {
        const caller = req.caller!;
        const targetUid = String(req.params.targetUid || '');
        if (!isValidId(targetUid)) {
          res.status(400).json({ error: 'Invalid target UID.' });
          return;
        }
        const targetDoc = await store.getDoc(caller.idToken, `users/${targetUid}`);
        if (!targetDoc || typeof targetDoc.email !== 'string') {
          res.status(404).json({ error: 'Target user email not found.' });
          return;
        }
        await identity.sendPasswordReset(targetDoc.email);
        await authDeps.recordSecurityEvent({
          actorId: caller.uid,
          action: 'ADMIN_PASSWORD_RESET_REQUESTED',
          targetId: targetUid,
          metadata: { triggeredBySuperAdmin: caller.uid },
          idToken: caller.idToken,
        });
        res.json({ ok: true, uid: targetUid });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Password reset dispatch failed.' });
      }
    }
  );

  // SUPER_ADMIN ONLY: Assign or revoke roles & granular permissions (prevents duplicate SUPER_ADMIN creation)
  router.patch(
    '/users/:targetUid/role',
    requireAdminAccess,
    requireSuperAdmin,
    async (req: AdminAuthRequest, res: Response) => {
      try {
        const caller = req.caller!;
        const targetUid = String(req.params.targetUid || '');
        const nextRole = req.body?.role as UserRole | undefined;
        const hasPermsInput = req.body?.permissions !== undefined;
        const nextPermissions = hasPermsInput
          ? normalizePermissions(req.body.permissions)
          : undefined;

        if (!isValidId(targetUid)) {
          res.status(400).json({ error: 'Invalid target UID.' });
          return;
        }
        if (targetUid === caller.uid) {
          res.status(403).json({ error: 'Cannot modify your own role or permissions.' });
          return;
        }
        if (nextRole === 'SUPER_ADMIN') {
          res.status(403).json({
            error: 'Forbidden: Only the initial Google AI Studio setup process can establish the Super Admin.',
          });
          return;
        }
        if (nextRole && !['CUSTOMER', 'ADMIN'].includes(nextRole)) {
          res.status(400).json({ error: 'Invalid role value.' });
          return;
        }

        const targetDoc = await store.getDoc(caller.idToken, `users/${targetUid}`);
        if (!targetDoc) {
          res.status(404).json({ error: 'Target user not found.' });
          return;
        }
        if (targetDoc.role === 'SUPER_ADMIN') {
          res.status(403).json({ error: 'Forbidden: Cannot alter another Super Admin account.' });
          return;
        }

        const resolvedRole = nextRole || ((targetDoc.role as UserRole) || 'CUSTOMER');
        const resolvedPermissions =
          resolvedRole === 'CUSTOMER'
            ? []
            : nextPermissions !== undefined
            ? nextPermissions
            : normalizePermissions(targetDoc.permissions);

        await store.patchDoc(
          caller.idToken,
          `users/${targetUid}`,
          {
            role: resolvedRole,
            permissions: resolvedPermissions,
          },
          ['updatedAt']
        );

        if (nextRole && nextRole !== targetDoc.role) {
          await authDeps.recordSecurityEvent({
            actorId: caller.uid,
            action: 'ROLE_CHANGED',
            targetId: targetUid,
            metadata: { previousRole: targetDoc.role, nextRole: resolvedRole },
            idToken: caller.idToken,
          });
        }
        if (hasPermsInput) {
          await authDeps.recordSecurityEvent({
            actorId: caller.uid,
            action: 'ADMIN_PERMISSIONS_CHANGED',
            targetId: targetUid,
            metadata: { role: resolvedRole, permissions: resolvedPermissions },
            idToken: caller.idToken,
          });
        }

        res.json({ ok: true, uid: targetUid, role: resolvedRole, permissions: resolvedPermissions });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Role update failed.' });
      }
    }
  );

  // SUPER_ADMIN ONLY: Delete user profile
  router.delete(
    '/users/:targetUid',
    requireAdminAccess,
    requireSuperAdmin,
    async (req: AdminAuthRequest, res: Response) => {
      try {
        const caller = req.caller!;
        const targetUid = String(req.params.targetUid || '');
        if (!isValidId(targetUid)) {
          res.status(400).json({ error: 'Invalid user ID.' });
          return;
        }
        if (targetUid === caller.uid) {
          res.status(403).json({ error: 'Super Admin cannot delete their own account.' });
          return;
        }
        await store.deleteDoc(caller.idToken, `users/${targetUid}`);
        await authDeps.recordSecurityEvent({
          actorId: caller.uid,
          action: 'USER_DELETED',
          targetId: targetUid,
          idToken: caller.idToken,
        });
        res.json({ ok: true, uid: targetUid });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Delete user failed.' });
      }
    }
  );

  // Monitor projects & generated clips
  router.get(
    '/projects',
    requireAdminAccess,
    requirePermission('MONITOR_PROJECTS'),
    async (req: AdminAuthRequest, res: Response) => {
      try {
        const caller = req.caller!;
        const [projects, clips] = await Promise.all([
          store.listCol(caller.idToken, 'projects'),
          store.listCol(caller.idToken, 'clips'),
        ]);
        res.json({ projects, clips });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load projects.' });
      }
    }
  );

  // Monitor & manage processing jobs
  router.get(
    '/processing',
    requireAdminAccess,
    requirePermission('MANAGE_PROCESSING'),
    async (req: AdminAuthRequest, res: Response) => {
      try {
        const caller = req.caller!;
        const jobs = await store.listCol(caller.idToken, 'processingJobs');
        res.json({ jobs });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load jobs.' });
      }
    }
  );

  router.patch(
    '/processing/:jobId',
    requireAdminAccess,
    requirePermission('MANAGE_PROCESSING'),
    async (req: AdminAuthRequest, res: Response) => {
      try {
        const caller = req.caller!;
        const jobId = String(req.params.jobId || '');
        const status = typeof req.body?.status === 'string' ? req.body.status : '';
        if (!isValidId(jobId) || !['CANCELLED', 'FAILED'].includes(status)) {
          res.status(400).json({ error: 'Invalid jobId or status update.' });
          return;
        }
        await store.patchDoc(
          caller.idToken,
          `processingJobs/${jobId}`,
          {
            status,
            currentStage: status === 'CANCELLED' ? 'Cancelled by administrator' : 'Marked failed by administrator',
          },
          ['updatedAt']
        );
        res.json({ ok: true, jobId, status });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update job.' });
      }
    }
  );

  // Monitor storage & usage records
  router.get(
    '/storage',
    requireAdminAccess,
    requirePermission('MONITOR_USAGE_STORAGE'),
    async (req: AdminAuthRequest, res: Response) => {
      try {
        const caller = req.caller!;
        const [videos, exportsList, usageRecords] = await Promise.all([
          store.listCol(caller.idToken, 'sourceVideos'),
          store.listCol(caller.idToken, 'exports'),
          store.listCol(caller.idToken, 'usageRecords'),
        ]);
        const totalBytes =
          videos.reduce((s, v) => s + Number(v.fileSize || 0), 0) +
          exportsList.reduce((s, e) => s + Number(e.fileSize || 0), 0);

        res.json({
          r2Configured: isR2Configured(),
          totalStorageMb: Number((totalBytes / (1024 * 1024)).toFixed(2)),
          sourceVideoCount: videos.length,
          exportCount: exportsList.length,
          usageEventsCount: usageRecords.length,
        });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load storage metrics.' });
      }
    }
  );

  // Settings (SUPER_ADMIN ONLY)
  router.get(
    '/settings',
    requireAdminAccess,
    requireSuperAdmin,
    async (req: AdminAuthRequest, res: Response) => {
      try {
        const caller = req.caller!;
        const [limitsDoc, aiDoc] = await Promise.all([
          store.getDoc(caller.idToken, 'systemSettings/limits'),
          store.getDoc(caller.idToken, 'systemSettings/aiConfig'),
        ]);
        res.json({
          limits: limitsDoc?.settingValue || null,
          aiConfig: aiDoc?.settingValue || null,
          geminiConfigured: isGeminiConfigured(),
          r2Configured: isR2Configured(),
        });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load settings.' });
      }
    }
  );

  router.put(
    '/settings',
    requireAdminAccess,
    requireSuperAdmin,
    async (req: AdminAuthRequest, res: Response) => {
      try {
        const caller = req.caller!;
        const settingId = req.body?.settingId;
        const settingValue = req.body?.settingValue;
        if (
          (settingId !== 'limits' && settingId !== 'aiConfig') ||
          !settingValue ||
          typeof settingValue !== 'object' ||
          Array.isArray(settingValue)
        ) {
          res.status(400).json({ error: 'settingId must be "limits" or "aiConfig" with an object payload.' });
          return;
        }

        await store.setDoc(
          caller.idToken,
          `systemSettings/${settingId}`,
          {
            settingId,
            settingValue,
            updatedBy: caller.uid,
          },
          ['updatedAt']
        );

        await authDeps.recordSecurityEvent({
          actorId: caller.uid,
          action: 'SYSTEM_SETTINGS_UPDATED',
          targetId: settingId,
          metadata: settingValue as Record<string, unknown>,
          idToken: caller.idToken,
        });

        res.json({ ok: true, settingId });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save settings.' });
      }
    }
  );

  // Audit & Security Monitoring Logs (SUPER_ADMIN ONLY)
  router.get(
    '/audit-logs',
    requireAdminAccess,
    requireSuperAdmin,
    async (req: AdminAuthRequest, res: Response) => {
      try {
        const caller = req.caller!;
        const persisted = await store.listCol(caller.idToken, 'auditLogs');
        const inMemory = getRecentSecurityEvents();

        // Merge & deduplicate by logId, sorting newest first
        const seen = new Set<string>();
        const merged: Array<Record<string, unknown>> = [];
        for (const row of [...inMemory, ...persisted]) {
          const id = String(row.logId || '');
          if (id && !seen.has(id)) {
            seen.add(id);
            merged.push({ ...row });
          }
        }
        merged.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
        res.json({ auditLogs: merged.slice(0, 250) });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load audit logs.' });
      }
    }
  );

  return router;
}
