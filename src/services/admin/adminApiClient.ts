import type {
  AccountStatus,
  AdminPermission,
  AIConfig,
  AuditLogRecord,
  ClipRecord,
  ProcessingJobRecord,
  ProjectRecord,
  SystemLimitsConfig,
  UserProfile,
  UserRole,
} from '../../types/clipora';
import { apiFetch } from '../auth/sessionStore';

export interface AdminSessionInfo {
  authorized: boolean;
  uid: string;
  email: string;
  role: UserRole;
  accountStatus: AccountStatus;
  permissions: AdminPermission[];
  isSuperAdmin: boolean;
}

export interface AdminDashboardPayload {
  metrics: {
    totalUsers: number;
    approvedUsers: number;
    pendingApprovals: number;
    suspendedUsers: number;
    totalProjects: number;
    totalVideos: number;
    totalClips: number;
    completedExports: number;
    failedJobs: number;
    totalStorageMb: number;
  };
  capabilities: {
    geminiConfigured: boolean;
    r2Configured: boolean;
    emailConfigured: boolean;
  };
}

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return apiFetch<T>(`/api/admin${path}`, init);
}

export async function checkSuperAdminInitialized(): Promise<{ initialized: boolean }> {
  return apiFetch<{ initialized: boolean }>('/api/auth/super-admin-status');
}

export async function verifyAdminSessionOnServer(): Promise<AdminSessionInfo> {
  return adminFetch<AdminSessionInfo>('/session');
}

export async function recordAdminLoginEvent(): Promise<void> {
  try {
    await adminFetch('/session/login-event', { method: 'POST' });
  } catch {
    // Non-fatal
  }
}

export async function reportUnauthorizedRouteAccess(path: string): Promise<void> {
  try {
    await adminFetch('/security-events', {
      method: 'POST',
      body: JSON.stringify({
        action: 'UNAUTHORIZED_ADMIN_ROUTE_ACCESS',
        path,
      }),
    });
  } catch {
    // Non-fatal
  }
}

export async function reportFailedAdminLogin(email: string, reason: string): Promise<void> {
  try {
    await fetch('/api/security/failed-admin-login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'CliporaApp',
      },
      body: JSON.stringify({ email, reason }),
    });
  } catch {
    // Non-fatal
  }
}

export async function reportAdminPasswordResetRequest(email: string): Promise<void> {
  try {
    await fetch('/api/security/admin-password-reset', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'CliporaApp',
      },
      body: JSON.stringify({ email }),
    });
  } catch {
    // Non-fatal
  }
}

export async function fetchAdminDashboard(): Promise<AdminDashboardPayload> {
  return adminFetch<AdminDashboardPayload>('/dashboard');
}

export async function fetchAdminUsers(): Promise<UserProfile[]> {
  const res = await adminFetch<{ users: UserProfile[] }>('/users');
  return res.users || [];
}

export async function fetchPendingApprovals(): Promise<UserProfile[]> {
  const res = await adminFetch<{ pendingUsers: UserProfile[] }>('/approvals');
  return res.pendingUsers || [];
}

export async function updateApprovalStatusApi(
  targetUid: string,
  accountStatus: AccountStatus
): Promise<void> {
  await adminFetch(`/approvals/${encodeURIComponent(targetUid)}`, {
    method: 'POST',
    body: JSON.stringify({ accountStatus }),
  });
}

export async function provisionAdminApi(params: {
  email?: string;
  uid?: string;
  displayName?: string;
  initialPassword?: string;
  permissions: AdminPermission[];
}): Promise<{ createdNewAuthAccount?: boolean }> {
  return adminFetch<{ createdNewAuthAccount?: boolean }>('/users/provision-admin', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function sendAdminPasswordResetApi(
  targetUid: string
): Promise<{ ok: boolean; uid: string; temporaryPassword?: string }> {
  return adminFetch<{ ok: boolean; uid: string; temporaryPassword?: string }>(
    `/users/${encodeURIComponent(targetUid)}/password-reset`,
    {
      method: 'POST',
    }
  );
}

export async function updateUserRoleAndPermissionsApi(params: {
  targetUid: string;
  role?: UserRole;
  permissions?: AdminPermission[];
}): Promise<void> {
  await adminFetch(`/users/${encodeURIComponent(params.targetUid)}/role`, {
    method: 'PATCH',
    body: JSON.stringify({
      role: params.role,
      permissions: params.permissions,
    }),
  });
}

export async function deleteUserApi(targetUid: string): Promise<void> {
  await adminFetch(`/users/${encodeURIComponent(targetUid)}`, {
    method: 'DELETE',
  });
}

export async function fetchAdminProjectsAndClips(): Promise<{
  projects: ProjectRecord[];
  clips: ClipRecord[];
}> {
  return adminFetch<{ projects: ProjectRecord[]; clips: ClipRecord[] }>('/projects');
}

export async function fetchAdminProcessingJobs(): Promise<ProcessingJobRecord[]> {
  const res = await adminFetch<{ jobs: ProcessingJobRecord[] }>('/processing');
  return res.jobs || [];
}

export async function updateAdminProcessingJobApi(
  jobId: string,
  status: 'CANCELLED' | 'FAILED'
): Promise<void> {
  await adminFetch(`/processing/${encodeURIComponent(jobId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function fetchAdminStorageMetrics(): Promise<{
  r2Configured: boolean;
  totalStorageMb: number;
  sourceVideoCount: number;
  exportCount: number;
  usageEventsCount: number;
}> {
  return adminFetch('/storage');
}

export async function fetchAdminSettingsApi(): Promise<{
  limits: SystemLimitsConfig | null;
  aiConfig: AIConfig | null;
  geminiConfigured: boolean;
  r2Configured: boolean;
}> {
  return adminFetch('/settings');
}

export async function saveAdminSettingApi(
  settingId: 'limits' | 'aiConfig',
  settingValue: Record<string, unknown>
): Promise<void> {
  await adminFetch('/settings', {
    method: 'PUT',
    body: JSON.stringify({ settingId, settingValue }),
  });
}

export async function fetchAdminAuditLogs(): Promise<AuditLogRecord[]> {
  const res = await adminFetch<{ auditLogs: AuditLogRecord[] }>('/audit-logs');
  return res.auditLogs || [];
}
