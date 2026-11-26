import crypto from 'crypto';
import { Router, type Response } from 'express';
import { isGeminiConfigured, isR2Configured } from '../config/env.ts';
import { getDatabase, type CliporaDatabase } from '../db/database.ts';
import {
  createAdminMiddleware,
  createDefaultAdminAuthDeps,
  type AdminAuthDeps,
  type AdminAuthRequest,
} from '../middleware/adminAuth.ts';
import { createRateLimiter } from '../middleware/rateLimit.ts';
import { hashPassword } from '../security/password.ts';
import {
  canManageTargetAccount,
  DEFAULT_ADMIN_PERMISSIONS,
  isSuperAdminCaller,
  normalizePermissions,
  type AccountStatus,
  type AdminPermission,
  type UserRole,
} from '../security/rbac.ts';
import {
  getRecentSecurityEvents,
  type SecurityEventAction,
} from '../services/securityMonitor.ts';

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

function isValidId(id: string): boolean {
  return VALID_ID_REGEX.test(id);
}

function generateTempPassword(): string {
  // Meets >=12 chars with uppercase, lowercase, and digit without ambiguous characters
  const raw = crypto.randomBytes(9).toString('base64url');
  return `Rd!9${raw}`;
}

export function createAdminApiRouter(options?: {
  db?: CliporaDatabase;
  authDeps?: AdminAuthDeps;
}) {
  const router = Router();
  const resolveDb = () => options?.db ?? getDatabase();
  const authDeps = options?.authDeps ?? createDefaultAdminAuthDeps(options?.db);
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

  router.use(requireAuthenticatedCaller, adminRateLimit);

  // Record unauthorized route navigation before client redirect
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
    });
    res.status(202).json({ recorded: true });
  });

  // Verify admin session & return trusted server-resolved role & permissions
  router.get('/session', requireAdminAccess, (req: AdminAuthRequest, res: Response) => {
    const caller = req.caller!;
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
    });
    res.status(202).json({ recorded: true });
  });

  // Dashboard metrics
  router.get(
    '/dashboard',
    requireAdminAccess,
    requirePermission('VIEW_DASHBOARD'),
    (req: AdminAuthRequest, res: Response) => {
      try {
        const caller = req.caller!;
        const db = resolveDb();
        const users = db.listUsersPublic();
        const projects = db.listProjects();
        const videos = db.listSourceVideos();
        const clips = db.listClips();
        const exportsList = db.listExports();
        const jobs = db.listProcessingJobs();

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
    (req: AdminAuthRequest, res: Response) => {
      try {
        const caller = req.caller!;
        const users = resolveDb().listUsersPublic();
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
    (_req: AdminAuthRequest, res: Response) => {
      try {
        const pending = resolveDb()
          .listUsersPublic()
          .filter((u) => u.accountStatus === 'PENDING');
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
        const db = resolveDb();
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

        const targetDoc = db.getPublicUserByUid(targetUid);
        if (!targetDoc) {
          res.status(404).json({ error: 'Target user not found.' });
          return;
        }

        if (!canManageTargetAccount(caller, targetUid, targetDoc.role)) {
          await authDeps.recordSecurityEvent({
            actorId: caller.uid,
            action: 'UNAUTHORIZED_ADMIN_API_REQUEST',
            targetId: targetUid,
            metadata: {
              reason: 'cannot_modify_self_or_higher_privilege_account',
              callerRole: caller.role,
              targetRole: targetDoc.role,
            },
          });
          res.status(403).json({
            error: 'Forbidden: You cannot modify your own privileges or manage administrator accounts.',
          });
          return;
        }

        const previousStatus = targetDoc.accountStatus;
        db.updateUserAdminFields(targetUid, {
          accountStatus: nextStatus,
          ...(nextStatus === 'APPROVED' ? { approvedBy: caller.uid } : {}),
        });

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
          metadata: { previousStatus, nextStatus, targetRole: targetDoc.role },
        });

        const statusTitles: Record<AccountStatus, { title: string; message: string }> = {
          APPROVED: {
            title: 'Account Approved',
            message: 'Your NEXORATECH Clipora AI account has been approved by an administrator.',
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
        db.createNotification({
          ownerId: targetUid,
          type: 'ACCOUNT_STATUS',
          title: statusTitles[nextStatus].title,
          message: statusTitles[nextStatus].message,
        });

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
        const db = resolveDb();
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

        let target = uid
          ? db.getPublicUserByUid(uid)
          : email
          ? (() => {
              const row = db.getUserAuthByEmail(email);
              return row ? db.getPublicUserByUid(row.uid) : null;
            })()
          : null;

        let createdNewAuthAccount = false;

        if (!target) {
          if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            res.status(400).json({ error: 'Provide a valid email address for the new administrator.' });
            return;
          }
          if (!initialPassword) {
            res.status(404).json({
              error:
                'User account not found. Provide an initial temporary password (min 10 chars) to create their account directly, or have them register first.',
            });
            return;
          }
          if (initialPassword.length < 10) {
            res.status(400).json({
              error: 'Temporary administrator password must be at least 10 characters long.',
            });
            return;
          }

          const newUid = `usr_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
          target = db.createUser({
            uid: newUid,
            displayName,
            email,
            passwordHash: hashPassword(initialPassword),
            role: 'ADMIN',
            accountStatus: 'APPROVED',
            permissions,
            approvedBy: caller.uid,
          });
          createdNewAuthAccount = true;
        } else {
          if (target.uid === caller.uid) {
            res.status(403).json({ error: 'Cannot alter your own account privileges.' });
            return;
          }
          if (!isSuperAdminCaller(caller) && target.role !== 'CUSTOMER') {
            res.status(403).json({
              error: 'Forbidden: Only SUPER_ADMIN can modify existing administrator accounts.',
            });
            return;
          }
          if (target.role === 'SUPER_ADMIN') {
            res.status(403).json({ error: 'Forbidden: Cannot alter Super Admin account.' });
            return;
          }
          db.updateUserAdminFields(target.uid, {
            role: 'ADMIN',
            accountStatus: 'APPROVED',
            permissions,
            approvedBy: caller.uid,
          });
        }

        await authDeps.recordSecurityEvent({
          actorId: caller.uid,
          action: 'ADMIN_CREATED',
          targetId: target.uid,
          metadata: {
            email: target.email,
            permissions,
            createdNewAuthAccount,
          },
        });

        res.json({
          ok: true,
          uid: target.uid,
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

  // SUPER_ADMIN ONLY: Issue a fresh temporary password for an administrator
  router.post(
    '/users/:targetUid/password-reset',
    requireAdminAccess,
    requireSuperAdmin,
    async (req: AdminAuthRequest, res: Response) => {
      try {
        const caller = req.caller!;
        const db = resolveDb();
        const targetUid = String(req.params.targetUid || '');
        if (!isValidId(targetUid)) {
          res.status(400).json({ error: 'Invalid target UID.' });
          return;
        }
        const targetDoc = db.getPublicUserByUid(targetUid);
        if (!targetDoc) {
          res.status(404).json({ error: 'Target user not found.' });
          return;
        }

        const requestedPassword =
          typeof req.body?.newPassword === 'string' && req.body.newPassword.length >= 10
            ? req.body.newPassword
            : generateTempPassword();

        db.updateUserPasswordHash(targetUid, hashPassword(requestedPassword));

        await authDeps.recordSecurityEvent({
          actorId: caller.uid,
          action: 'ADMIN_PASSWORD_RESET_REQUESTED',
          targetId: targetUid,
          metadata: { triggeredBySuperAdmin: caller.uid },
        });

        res.json({
          ok: true,
          uid: targetUid,
          temporaryPassword: requestedPassword,
        });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Password reset failed.' });
      }
    }
  );

  // SUPER_ADMIN ONLY: Assign or revoke roles & granular permissions
  router.patch(
    '/users/:targetUid/role',
    requireAdminAccess,
    requireSuperAdmin,
    async (req: AdminAuthRequest, res: Response) => {
      try {
        const caller = req.caller!;
        const db = resolveDb();
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
            error: 'Forbidden: Only the initial platform setup process can establish the Super Admin.',
          });
          return;
        }
        if (nextRole && !['CUSTOMER', 'ADMIN'].includes(nextRole)) {
          res.status(400).json({ error: 'Invalid role value.' });
          return;
        }

        const targetDoc = db.getPublicUserByUid(targetUid);
        if (!targetDoc) {
          res.status(404).json({ error: 'Target user not found.' });
          return;
        }
        if (targetDoc.role === 'SUPER_ADMIN') {
          res.status(403).json({ error: 'Forbidden: Cannot alter another Super Admin account.' });
          return;
        }

        const resolvedRole = nextRole || targetDoc.role;
        const resolvedPermissions =
          resolvedRole === 'CUSTOMER'
            ? []
            : nextPermissions !== undefined
            ? nextPermissions
            : targetDoc.permissions;

        db.updateUserAdminFields(targetUid, {
          role: resolvedRole,
          permissions: resolvedPermissions,
        });

        if (nextRole && nextRole !== targetDoc.role) {
          await authDeps.recordSecurityEvent({
            actorId: caller.uid,
            action: 'ROLE_CHANGED',
            targetId: targetUid,
            metadata: { previousRole: targetDoc.role, nextRole: resolvedRole },
          });
        }
        if (hasPermsInput) {
          await authDeps.recordSecurityEvent({
            actorId: caller.uid,
            action: 'ADMIN_PERMISSIONS_CHANGED',
            targetId: targetUid,
            metadata: { role: resolvedRole, permissions: resolvedPermissions },
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
        const db = resolveDb();
        const targetUid = String(req.params.targetUid || '');
        if (!isValidId(targetUid)) {
          res.status(400).json({ error: 'Invalid user ID.' });
          return;
        }
        if (targetUid === caller.uid) {
          res.status(403).json({ error: 'Super Admin cannot delete their own account.' });
          return;
        }
        const target = db.getPublicUserByUid(targetUid);
        if (!target) {
          res.status(404).json({ error: 'Target user not found.' });
          return;
        }
        if (target.role === 'SUPER_ADMIN') {
          res.status(403).json({ error: 'Cannot delete a Super Admin account.' });
          return;
        }
        db.deleteUser(targetUid);
        await authDeps.recordSecurityEvent({
          actorId: caller.uid,
          action: 'USER_DELETED',
          targetId: targetUid,
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
    (_req: AdminAuthRequest, res: Response) => {
      try {
        const db = resolveDb();
        res.json({ projects: db.listProjects(), clips: db.listClips() });
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
    (_req: AdminAuthRequest, res: Response) => {
      try {
        res.json({ jobs: resolveDb().listProcessingJobs() });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load jobs.' });
      }
    }
  );

  router.patch(
    '/processing/:jobId',
    requireAdminAccess,
    requirePermission('MANAGE_PROCESSING'),
    (req: AdminAuthRequest, res: Response) => {
      try {
        const jobId = String(req.params.jobId || '');
        const status = typeof req.body?.status === 'string' ? req.body.status : '';
        if (!isValidId(jobId) || !['CANCELLED', 'FAILED'].includes(status)) {
          res.status(400).json({ error: 'Invalid jobId or status update.' });
          return;
        }
        const ok = resolveDb().updateProcessingJob(jobId, null, {
          status,
          currentStage:
            status === 'CANCELLED' ? 'Cancelled by administrator' : 'Marked failed by administrator',
        });
        if (!ok) {
          res.status(404).json({ error: 'Processing job not found.' });
          return;
        }
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
    (_req: AdminAuthRequest, res: Response) => {
      try {
        const db = resolveDb();
        const videos = db.listSourceVideos();
        const exportsList = db.listExports();
        const usageRecords = db.listUsageRecords();
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
    (_req: AdminAuthRequest, res: Response) => {
      try {
        const db = resolveDb();
        res.json({
          limits: db.getSystemSetting('limits'),
          aiConfig: db.getSystemSetting('aiConfig'),
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
        const db = resolveDb();
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

        db.setSystemSetting(settingId, settingValue as Record<string, unknown>, caller.uid);

        await authDeps.recordSecurityEvent({
          actorId: caller.uid,
          action: 'SYSTEM_SETTINGS_UPDATED',
          targetId: settingId,
          metadata: settingValue as Record<string, unknown>,
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
    (_req: AdminAuthRequest, res: Response) => {
      try {
        const persisted = resolveDb().listAuditLogs(250);
        const inMemory = getRecentSecurityEvents();

        const seen = new Set<string>();
        const merged: Array<Record<string, unknown>> = [];
        for (const row of [...inMemory, ...persisted]) {
          if (row.logId && !seen.has(row.logId)) {
            seen.add(row.logId);
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
