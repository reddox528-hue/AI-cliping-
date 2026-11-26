import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Check,
  Cpu,
  Download,
  Film,
  FolderKanban,
  HardDrive,
  Scissors,
  Search,
  Shield,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  deleteUserApi,
  fetchAdminAuditLogs,
  fetchAdminDashboard,
  fetchAdminProcessingJobs,
  fetchAdminProjectsAndClips,
  fetchAdminSettingsApi,
  fetchAdminStorageMetrics,
  fetchAdminUsers,
  fetchPendingApprovals,
  provisionAdminApi,
  saveAdminSettingApi,
  sendAdminPasswordResetApi,
  updateAdminProcessingJobApi,
  updateApprovalStatusApi,
  updateUserRoleAndPermissionsApi,
  type AdminDashboardPayload,
  type AdminSessionInfo,
} from '../../services/admin/adminApiClient';
import {
  DEFAULT_ADMIN_PERMISSIONS,
  type AccountStatus,
  type AdminPermission,
  type AIConfig,
  type AuditLogRecord,
  type ClipRecord,
  type ProcessingJobRecord,
  type ProjectRecord,
  type SystemLimitsConfig,
  type UserProfile,
  type UserRole,
} from '../../types/clipora';
import type { AdminRoute } from './AdminControlPanelLayout';

const PERMISSION_LABELS: Array<{ id: AdminPermission; label: string; superAdminAssignOnly?: boolean }> = [
  { id: 'VIEW_DASHBOARD', label: 'View Dashboard' },
  { id: 'MANAGE_CUSTOMERS', label: 'Manage Customers' },
  { id: 'REVIEW_APPROVALS', label: 'Review Registrations' },
  { id: 'MONITOR_PROJECTS', label: 'Monitor Projects & Clips' },
  { id: 'MANAGE_PROCESSING', label: 'Manage Processing Jobs' },
  { id: 'MONITOR_USAGE_STORAGE', label: 'Monitor Usage & Storage' },
  { id: 'CREATE_ADMINS', label: 'Create Additional Admins', superAdminAssignOnly: true },
];

export function AdminDashboard({
  session,
  activeRoute,
  onSelectRoute,
}: {
  session: AdminSessionInfo;
  activeRoute: AdminRoute;
  onSelectRoute: (r: AdminRoute) => void;
}) {
  const { limits, aiConfig, reloadSettings } = useAuth();
  const { notify } = useToast();

  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState<AdminDashboardPayload | null>(null);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [pendingUsers, setPendingUsers] = useState<UserProfile[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [clips, setClips] = useState<ClipRecord[]>([]);
  const [jobs, setJobs] = useState<ProcessingJobRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [storageMetrics, setStorageMetrics] = useState<{
    r2Configured: boolean;
    totalStorageMb: number;
    sourceVideoCount: number;
    exportCount: number;
    usageEventsCount: number;
  } | null>(null);

  const [userSearch, setUserSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | AccountStatus>('ALL');
  const [limitsDraft, setLimitsDraft] = useState<SystemLimitsConfig>(limits);
  const [aiDraft, setAiDraft] = useState<AIConfig>(aiConfig);
  const [savingSettings, setSavingSettings] = useState(false);

  // Admin creation/provisioning state (SUPER_ADMIN or explicitly authorized CREATE_ADMINS)
  const [provisionDisplayName, setProvisionDisplayName] = useState('');
  const [provisionEmail, setProvisionEmail] = useState('');
  const [provisionPassword, setProvisionPassword] = useState('');
  const [provisionPermissions, setProvisionPermissions] = useState<AdminPermission[]>(
    DEFAULT_ADMIN_PERMISSIONS
  );
  const [provisioning, setProvisioning] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserProfile | null>(null);
  const [issuedResetInfo, setIssuedResetInfo] = useState<{ email: string; tempPassword: string } | null>(null);

  const canPerm = useCallback(
    (perm: AdminPermission) => session.isSuperAdmin || session.permissions.includes(perm),
    [session]
  );

  const loadRouteData = useCallback(async () => {
    setLoading(true);
    try {
      const tasks: Promise<unknown>[] = [];

      if (activeRoute === 'admin-overview' && canPerm('VIEW_DASHBOARD')) {
        tasks.push(fetchAdminDashboard().then(setDashboard));
      }
      if (
        (activeRoute === 'admin-users' || activeRoute === 'admin-roles') &&
        (canPerm('MANAGE_CUSTOMERS') || canPerm('CREATE_ADMINS') || session.isSuperAdmin)
      ) {
        tasks.push(fetchAdminUsers().then(setUsers));
      }
      if (activeRoute === 'admin-approvals' && canPerm('REVIEW_APPROVALS')) {
        tasks.push(fetchPendingApprovals().then(setPendingUsers));
      }
      if (activeRoute === 'admin-projects' && canPerm('MONITOR_PROJECTS')) {
        tasks.push(
          fetchAdminProjectsAndClips().then((res) => {
            setProjects(res.projects);
            setClips(res.clips);
          })
        );
      }
      if (activeRoute === 'admin-jobs' && canPerm('MANAGE_PROCESSING')) {
        tasks.push(fetchAdminProcessingJobs().then(setJobs));
      }
      if (activeRoute === 'admin-storage' && canPerm('MONITOR_USAGE_STORAGE')) {
        tasks.push(fetchAdminStorageMetrics().then(setStorageMetrics));
      }
      if (
        (activeRoute === 'admin-usage' ||
          activeRoute === 'admin-ai' ||
          activeRoute === 'admin-platform') &&
        session.isSuperAdmin
      ) {
        tasks.push(
          fetchAdminSettingsApi().then((res) => {
            if (res.limits) setLimitsDraft(res.limits);
            if (res.aiConfig) setAiDraft(res.aiConfig);
          })
        );
      }
      if (activeRoute === 'admin-logs' && session.isSuperAdmin) {
        tasks.push(fetchAdminAuditLogs().then(setAuditLogs));
      }

      await Promise.all(tasks);
    } catch (err) {
      notify('error', 'Authorization or fetch error', err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [activeRoute, canPerm, notify, session.isSuperAdmin]);

  useEffect(() => {
    void loadRouteData();
  }, [loadRouteData]);

  const handleStatusChange = async (target: UserProfile, accountStatus: AccountStatus) => {
    try {
      await updateApprovalStatusApi(target.uid, accountStatus);
      await loadRouteData();
      notify('success', `Updated ${target.displayName} to ${accountStatus}`);
    } catch (err) {
      notify('error', 'Action denied', err instanceof Error ? err.message : String(err));
    }
  };

  const handleRoleChange = async (target: UserProfile, role: UserRole) => {
    try {
      const permissions =
        role === 'ADMIN'
          ? target.permissions?.length
            ? target.permissions
            : DEFAULT_ADMIN_PERMISSIONS
          : undefined;
      await updateUserRoleAndPermissionsApi({ targetUid: target.uid, role, permissions });
      await loadRouteData();
      notify('success', `Updated ${target.displayName} role to ${role}`);
    } catch (err) {
      notify('error', 'Role update denied', err instanceof Error ? err.message : String(err));
    }
  };

  const handleToggleTargetPermission = async (target: UserProfile, perm: AdminPermission) => {
    const current = new Set<AdminPermission>(target.permissions || []);
    if (current.has(perm)) {
      current.delete(perm);
    } else {
      current.add(perm);
    }
    try {
      await updateUserRoleAndPermissionsApi({
        targetUid: target.uid,
        permissions: Array.from(current),
      });
      await loadRouteData();
      notify('success', 'Administrator permissions updated');
    } catch (err) {
      notify('error', 'Permission update denied', err instanceof Error ? err.message : String(err));
    }
  };

  const handleProvisionAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!provisionEmail.trim()) return;
    setProvisioning(true);
    try {
      const res = await provisionAdminApi({
        displayName: provisionDisplayName.trim() || undefined,
        email: provisionEmail.trim(),
        initialPassword: provisionPassword || undefined,
        permissions: provisionPermissions,
      });
      setProvisionDisplayName('');
      setProvisionEmail('');
      setProvisionPassword('');
      await loadRouteData();
      notify(
        'success',
        res.createdNewAuthAccount ? 'New administrator created' : 'Administrator provisioned',
        res.createdNewAuthAccount
          ? 'Administrator account created and ADMIN permissions saved.'
          : 'Role and permissions saved on server.'
      );
    } catch (err) {
      notify('error', 'Provisioning failed', err instanceof Error ? err.message : String(err));
    } finally {
      setProvisioning(false);
    }
  };

  const handleSendAdminPasswordReset = async (target: UserProfile) => {
    try {
      const res = await sendAdminPasswordResetApi(target.uid);
      if (res.temporaryPassword) {
        setIssuedResetInfo({ email: target.email, tempPassword: res.temporaryPassword });
      }
      notify('success', 'Temporary password issued', `Updated credentials for ${target.email}.`);
    } catch (err) {
      notify('error', 'Password reset failed', err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteTarget) return;
    try {
      await deleteUserApi(deleteTarget.uid);
      setDeleteTarget(null);
      await loadRouteData();
      notify('success', 'User account removed');
    } catch (err) {
      notify('error', 'Delete denied', err instanceof Error ? err.message : String(err));
    }
  };

  const handleSaveLimits = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      await saveAdminSettingApi('limits', limitsDraft as unknown as Record<string, unknown>);
      await reloadSettings();
      await loadRouteData();
      notify('success', 'System limits saved');
    } catch (err) {
      notify('error', 'Failed to save limits', err instanceof Error ? err.message : String(err));
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSaveAiConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      await saveAdminSettingApi('aiConfig', aiDraft as unknown as Record<string, unknown>);
      await reloadSettings();
      await loadRouteData();
      notify('success', 'AI configuration saved');
    } catch (err) {
      notify('error', 'Failed to save AI config', err instanceof Error ? err.message : String(err));
    } finally {
      setSavingSettings(false);
    }
  };

  const handleCancelJob = async (jobId: string) => {
    try {
      await updateAdminProcessingJobApi(jobId, 'CANCELLED');
      await loadRouteData();
      notify('success', 'Processing job cancelled');
    } catch (err) {
      notify('error', 'Job update failed', err instanceof Error ? err.message : String(err));
    }
  };

  if (activeRoute === 'admin-overview') {
    const m = dashboard?.metrics;
    const stats = [
      { label: 'Managed Users', value: m?.totalUsers ?? 0, icon: Users },
      { label: 'Approved Accounts', value: m?.approvedUsers ?? 0, icon: Check },
      { label: 'Pending Approvals', value: m?.pendingApprovals ?? 0, icon: Users },
      { label: 'Suspended Accounts', value: m?.suspendedUsers ?? 0, icon: X },
      { label: 'Total Projects', value: m?.totalProjects ?? 0, icon: FolderKanban },
      { label: 'Source Videos', value: m?.totalVideos ?? 0, icon: Film },
      { label: 'Generated Clips', value: m?.totalClips ?? 0, icon: Scissors },
      { label: 'Completed Exports', value: m?.completedExports ?? 0, icon: Download },
      { label: 'Failed Jobs', value: m?.failedJobs ?? 0, icon: Activity },
      { label: 'Tracked Storage', value: `${m?.totalStorageMb ?? 0} MB`, icon: HardDrive },
    ];

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-950 dark:text-white">
              Control Overview
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Server-verified administration metrics, approvals, and processing health.
            </p>
          </div>
          {canPerm('REVIEW_APPROVALS') && (m?.pendingApprovals ?? 0) > 0 && (
            <button
              type="button"
              onClick={() => onSelectRoute('admin-approvals')}
              className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold"
            >
              Review {m?.pendingApprovals} Pending Registration{m!.pendingApprovals > 1 ? 's' : ''}
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {stats.map((s) => {
            const Icon = s.icon;
            return (
              <div
                key={s.label}
                className="rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] p-4"
              >
                <div className="flex items-center justify-between text-slate-400 mb-2">
                  <span className="text-xs text-slate-500 dark:text-slate-400">{s.label}</span>
                  <Icon className="w-4 h-4" />
                </div>
                <p className="text-2xl font-bold tabular-nums text-slate-950 dark:text-white">
                  {loading ? '—' : s.value}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (activeRoute === 'admin-users' || activeRoute === 'admin-approvals' || activeRoute === 'admin-roles') {
    if (activeRoute === 'admin-roles' && !canPerm('CREATE_ADMINS')) {
      return (
        <div className="rounded-2xl border border-red-200 dark:border-red-900 bg-white dark:bg-[#161926] p-8 text-center">
          <Shield className="w-7 h-7 text-red-500 mx-auto mb-2" />
          <p className="text-sm font-semibold">Administrator creation permission required.</p>
        </div>
      );
    }

    const baseList = activeRoute === 'admin-approvals' ? pendingUsers : users;
    const filteredUsers = baseList.filter((u) => {
      const q = userSearch.toLowerCase();
      const matchesSearch =
        u.displayName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
      const matchesStatus = statusFilter === 'ALL' || u.accountStatus === statusFilter;
      return matchesSearch && matchesStatus;
    });

    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-950 dark:text-white">
            {activeRoute === 'admin-approvals'
              ? 'Pending Approvals'
              : activeRoute === 'admin-roles'
              ? 'Admin Provisioning & Role Permissions'
              : 'User Accounts'}
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {activeRoute === 'admin-roles'
              ? 'Create or promote administrator accounts and assign least-privilege permissions.'
              : 'Approve, reject, suspend, or reactivate user accounts.'}
          </p>
        </div>

        {activeRoute === 'admin-roles' && canPerm('CREATE_ADMINS') && (
          <form
            onSubmit={handleProvisionAdmin}
            className="rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] p-6 space-y-4"
          >
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
              <UserPlus className="w-4 h-4 text-purple-600" />
              Create or Provision Administrator Account
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Create a new administrator account by providing a temporary password (min 10 chars), or leave password blank to promote an already-registered user.
            </p>
            <div className="grid sm:grid-cols-3 gap-3">
              <input
                type="text"
                value={provisionDisplayName}
                onChange={(e) => setProvisionDisplayName(e.target.value)}
                placeholder="Display Name (optional)"
                className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-[#24283B] bg-white dark:bg-[#121521] text-sm"
              />
              <input
                type="email"
                required
                value={provisionEmail}
                onChange={(e) => setProvisionEmail(e.target.value)}
                placeholder="new-admin@domain.com"
                className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-[#24283B] bg-white dark:bg-[#121521] text-sm"
              />
              <input
                type="password"
                minLength={10}
                value={provisionPassword}
                onChange={(e) => setProvisionPassword(e.target.value)}
                placeholder="Temporary password (for new user)"
                className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-[#24283B] bg-white dark:bg-[#121521] text-sm"
              />
            </div>
            <div className="grid sm:grid-cols-3 gap-2 pt-1">
              {PERMISSION_LABELS.filter((p) => session.isSuperAdmin || (!p.superAdminAssignOnly && canPerm(p.id))).map((perm) => {
                const checked = provisionPermissions.includes(perm.id);
                return (
                  <label key={perm.id} className="flex items-center gap-2 text-xs font-medium">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        setProvisionPermissions((prev) =>
                          e.target.checked ? [...prev, perm.id] : prev.filter((p) => p !== perm.id)
                        );
                      }}
                    />
                    {perm.label}
                  </label>
                );
              })}
            </div>
            <button
              type="submit"
              disabled={provisioning}
              className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold disabled:opacity-60"
            >
              {provisioning ? 'Creating Admin...' : 'Create / Provision Admin'}
            </button>
          </form>
        )}

        {issuedResetInfo && (
          <div className="rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div>
              <p className="font-semibold text-amber-900 dark:text-amber-200">
                Temporary password issued for {issuedResetInfo.email}
              </p>
              <p className="mt-1 font-mono select-all text-amber-800 dark:text-amber-300">
                {issuedResetInfo.tempPassword}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIssuedResetInfo(null)}
              className="px-3 py-1 rounded-lg border border-amber-400 dark:border-amber-700 font-semibold"
            >
              Dismiss
            </button>
          </div>
        )}

        {activeRoute !== 'admin-approvals' && (
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Search by name or email..."
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-300 dark:border-[#24283B] bg-white dark:bg-[#161926] text-sm"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="px-3 py-2 rounded-xl border border-slate-300 dark:border-[#24283B] bg-white dark:bg-[#161926] text-sm"
            >
              <option value="ALL">All Statuses</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="SUSPENDED">Suspended</option>
            </select>
          </div>
        )}

        <div className="rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-[#24283B] text-xs text-slate-500">
              <tr>
                <th className="py-3 px-4 font-semibold">User</th>
                <th className="py-3 px-4 font-semibold">Role</th>
                <th className="py-3 px-4 font-semibold">Status</th>
                {activeRoute === 'admin-roles' && (
                  <th className="py-3 px-4 font-semibold">Assigned Permissions</th>
                )}
                <th className="py-3 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-[#24283B]">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={activeRoute === 'admin-roles' ? 5 : 4} className="py-10 text-center text-xs text-slate-500">
                    {loading ? 'Loading accounts...' : 'No matching accounts.'}
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const canManageTarget =
                    u.uid !== session.uid && (session.isSuperAdmin || u.role === 'CUSTOMER');
                  return (
                    <tr key={u.uid}>
                      <td className="py-3 px-4">
                        <p className="font-semibold text-slate-900 dark:text-white">{u.displayName}</p>
                        <p className="text-xs text-slate-500">{u.email}</p>
                      </td>
                      <td className="py-3 px-4">
                        {session.isSuperAdmin && u.uid !== session.uid && u.role !== 'SUPER_ADMIN' ? (
                          <select
                            value={u.role}
                            onChange={(e) => handleRoleChange(u, e.target.value as UserRole)}
                            className="px-2 py-1 rounded-lg border border-slate-300 dark:border-[#24283B] bg-white dark:bg-[#121521] text-xs font-mono"
                          >
                            <option value="CUSTOMER">CUSTOMER</option>
                            <option value="ADMIN">ADMIN</option>
                          </select>
                        ) : (
                          <span className="text-xs font-mono">{u.role}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono">{u.accountStatus}</td>
                      {activeRoute === 'admin-roles' && (
                        <td className="py-3 px-4">
                          {u.role === 'SUPER_ADMIN' ? (
                            <span className="text-xs font-mono text-purple-600 dark:text-purple-400">
                              All Platform Permissions
                            </span>
                          ) : u.role === 'ADMIN' && u.uid !== session.uid && session.isSuperAdmin ? (
                            <div className="flex flex-wrap gap-2">
                              {PERMISSION_LABELS.map((perm) => (
                                <label key={perm.id} className="inline-flex items-center gap-1 text-[11px]">
                                  <input
                                    type="checkbox"
                                    checked={(u.permissions || []).includes(perm.id)}
                                    onChange={() => handleToggleTargetPermission(u, perm.id)}
                                  />
                                  {perm.label}
                                </label>
                              ))}
                            </div>
                          ) : u.role === 'ADMIN' ? (
                            <span className="text-xs text-slate-500">Super Admin manages admin permissions</span>
                          ) : (
                            <span className="text-xs text-slate-400">Customer scope only</span>
                          )}
                        </td>
                      )}
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-2">
                          {canManageTarget && u.accountStatus !== 'APPROVED' && (
                            <button
                              type="button"
                              onClick={() => handleStatusChange(u, 'APPROVED')}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
                            >
                              Approve
                            </button>
                          )}
                          {canManageTarget && u.accountStatus === 'PENDING' && (
                            <button
                              type="button"
                              onClick={() => handleStatusChange(u, 'REJECTED')}
                              className="px-2.5 py-1 rounded-lg border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 text-xs font-semibold"
                            >
                              Reject
                            </button>
                          )}
                          {canManageTarget && u.accountStatus === 'APPROVED' && (
                            <button
                              type="button"
                              onClick={() => handleStatusChange(u, 'SUSPENDED')}
                              className="px-2.5 py-1 rounded-lg border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-xs font-semibold"
                            >
                              Suspend
                            </button>
                          )}
                          {session.isSuperAdmin && u.role === 'ADMIN' && (
                            <button
                              type="button"
                              onClick={() => handleSendAdminPasswordReset(u)}
                              className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              Reset Password
                            </button>
                          )}
                          {session.isSuperAdmin && u.uid !== session.uid && u.role !== 'SUPER_ADMIN' && (
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(u)}
                              title="Delete account"
                              className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <ConfirmDialog
          open={Boolean(deleteTarget)}
          title="Delete User Profile"
          description={`Remove ${deleteTarget?.email}? This action cannot be undone.`}
          confirmLabel="Delete Account"
          destructive
          onConfirm={handleDeleteUser}
          onCancel={() => setDeleteTarget(null)}
        />
      </div>
    );
  }

  if (activeRoute === 'admin-projects') {
    return (
      <div className="space-y-6">
        <h1 className="font-display text-2xl font-bold">Projects &amp; Clips</h1>
        <div className="rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-[#24283B] text-xs text-slate-500">
              <tr>
                <th className="py-3 px-4">Project</th>
                <th className="py-3 px-4">Owner UID</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Clips</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-[#24283B]">
              {projects.map((p) => (
                <tr key={p.projectId}>
                  <td className="py-3 px-4 font-medium">{p.projectName}</td>
                  <td className="py-3 px-4 font-mono text-xs">{p.ownerId}</td>
                  <td className="py-3 px-4 font-mono text-xs">{p.status}</td>
                  <td className="py-3 px-4 font-mono text-xs tabular-nums">
                    {clips.filter((c) => c.projectId === p.projectId).length}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (activeRoute === 'admin-jobs') {
    return (
      <div className="space-y-6">
        <h1 className="font-display text-2xl font-bold">Processing Jobs</h1>
        <div className="rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-[#24283B] text-xs text-slate-500">
              <tr>
                <th className="py-3 px-4">Job ID</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Progress</th>
                <th className="py-3 px-4">Stage</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-[#24283B]">
              {jobs.map((j) => (
                <tr key={j.jobId}>
                  <td className="py-3 px-4 font-mono text-xs">{j.jobId}</td>
                  <td className="py-3 px-4 font-mono text-xs">{j.status}</td>
                  <td className="py-3 px-4 font-mono text-xs tabular-nums">{j.progress}%</td>
                  <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-400">
                    {j.errorMessage || j.currentStage}
                  </td>
                  <td className="py-3 px-4 text-right">
                    {!['COMPLETED', 'FAILED', 'CANCELLED'].includes(j.status) && (
                      <button
                        type="button"
                        onClick={() => handleCancelJob(j.jobId)}
                        className="px-2.5 py-1 rounded-lg border border-red-300 dark:border-red-800 text-red-600 text-xs font-semibold"
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (activeRoute === 'admin-storage') {
    return (
      <div className="space-y-6 max-w-3xl">
        <h1 className="font-display text-2xl font-bold">Storage &amp; Usage</h1>
        <div className="rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] p-6 space-y-4 text-sm">
          <div className="flex items-center justify-between">
            <span>Cloudflare R2 Presigned Storage</span>
            <span className="font-mono font-semibold">
              {storageMetrics?.r2Configured ? 'Configured' : 'Local Browser Cache Mode'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>Tracked Media Volume</span>
            <span className="font-mono font-semibold tabular-nums">
              {storageMetrics?.totalStorageMb ?? 0} MB
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>Source Videos / Exports / Usage Events</span>
            <span className="font-mono text-xs tabular-nums">
              {storageMetrics?.sourceVideoCount ?? 0} / {storageMetrics?.exportCount ?? 0} /{' '}
              {storageMetrics?.usageEventsCount ?? 0}
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (activeRoute === 'admin-usage') {
    return (
      <div className="space-y-6 max-w-3xl">
        <h1 className="font-display text-2xl font-bold">System Limits</h1>
        <form
          onSubmit={handleSaveLimits}
          className="rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] p-6 space-y-4"
        >
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1">Max Video File Size (MB)</label>
              <input
                type="number"
                min={10}
                max={4096}
                value={limitsDraft.maxFileSizeMb}
                onChange={(e) =>
                  setLimitsDraft({ ...limitsDraft, maxFileSizeMb: Number(e.target.value) })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-[#24283B] bg-white dark:bg-[#121521] text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Max Video Duration (sec)</label>
              <input
                type="number"
                min={30}
                max={14400}
                value={limitsDraft.maxVideoDurationSec}
                onChange={(e) =>
                  setLimitsDraft({ ...limitsDraft, maxVideoDurationSec: Number(e.target.value) })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-[#24283B] bg-white dark:bg-[#121521] text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Max Projects Per User</label>
              <input
                type="number"
                min={1}
                max={500}
                value={limitsDraft.maxProjectsPerUser}
                onChange={(e) =>
                  setLimitsDraft({ ...limitsDraft, maxProjectsPerUser: Number(e.target.value) })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-[#24283B] bg-white dark:bg-[#121521] text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Daily AI Request Allowance</label>
              <input
                type="number"
                min={1}
                max={1000}
                value={limitsDraft.dailyAiRequestAllowance}
                onChange={(e) =>
                  setLimitsDraft({ ...limitsDraft, dailyAiRequestAllowance: Number(e.target.value) })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-[#24283B] bg-white dark:bg-[#121521] text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Storage Allowance (MB)</label>
              <input
                type="number"
                min={50}
                max={50000}
                value={limitsDraft.storageAllowanceMb}
                onChange={(e) =>
                  setLimitsDraft({ ...limitsDraft, storageAllowanceMb: Number(e.target.value) })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-[#24283B] bg-white dark:bg-[#121521] text-sm tabular-nums"
              />
            </div>
            <div className="flex items-center pt-5">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={limitsDraft.allow1080pExport}
                  onChange={(e) =>
                    setLimitsDraft({ ...limitsDraft, allow1080pExport: e.target.checked })
                  }
                />
                Allow 1080p MP4 Exports
              </label>
            </div>
          </div>

          <button
            type="submit"
            disabled={savingSettings}
            className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold"
          >
            {savingSettings ? 'Saving...' : 'Save Usage Limits'}
          </button>
        </form>
      </div>
    );
  }

  if (activeRoute === 'admin-ai') {
    return (
      <div className="space-y-6 max-w-3xl">
        <h1 className="font-display text-2xl font-bold">AI Configuration</h1>
        <form
          onSubmit={handleSaveAiConfig}
          className="rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] p-6 space-y-4"
        >
          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 text-xs">
            <span className="flex items-center gap-2 font-medium">
              <Cpu className="w-4 h-4 text-purple-600" />
              Server Gemini API Status
            </span>
            <span className="font-mono font-semibold">Active</span>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1">Gemini Model Identifier</label>
              <select
                value={aiDraft.modelId}
                onChange={(e) =>
                  setAiDraft({ ...aiDraft, modelId: e.target.value as AIConfig['modelId'] })
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-[#24283B] bg-white dark:bg-[#121521] text-sm font-mono"
              >
                <option value="gemini-4-hydrogen">gemini-4-hydrogen (Free Tier)</option>
                <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Free Tier)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Max Clips Per Analysis</label>
              <input
                type="number"
                min={1}
                max={12}
                value={aiDraft.maxClipsPerRun}
                onChange={(e) => setAiDraft({ ...aiDraft, maxClipsPerRun: Number(e.target.value) })}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-[#24283B] bg-white dark:bg-[#121521] text-sm tabular-nums"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1">Analysis &amp; Scoring Instructions</label>
            <textarea
              rows={4}
              value={aiDraft.analysisInstructions}
              onChange={(e) => setAiDraft({ ...aiDraft, analysisInstructions: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-[#24283B] bg-white dark:bg-[#121521] text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={savingSettings}
            className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold"
          >
            {savingSettings ? 'Saving...' : 'Save AI Configuration'}
          </button>
        </form>
      </div>
    );
  }

  if (activeRoute === 'admin-platform') {
    return (
      <div className="space-y-6 max-w-3xl">
        <h1 className="font-display text-2xl font-bold">Platform Security Status</h1>
        <div className="rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] p-6 space-y-3 text-sm">
          <div className="flex justify-between">
            <span>Public Registration Default</span>
            <span className="font-mono font-semibold">CUSTOMER + PENDING</span>
          </div>
          <div className="flex justify-between">
            <span>Server-Side Role Verification</span>
            <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
              Enforced on /api/admin/*
            </span>
          </div>
          <div className="flex justify-between">
            <span>Private Control Route</span>
            <span className="font-mono text-xs">/secure-control-panel</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold">Security &amp; Audit Logs</h1>
      <div className="rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 dark:border-[#24283B] text-xs text-slate-500">
            <tr>
              <th className="py-3 px-4">Timestamp</th>
              <th className="py-3 px-4">Actor</th>
              <th className="py-3 px-4">Security Event / Action</th>
              <th className="py-3 px-4">Target</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-[#24283B]">
            {auditLogs.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-10 text-center text-xs text-slate-500">
                  {loading ? 'Loading security logs...' : 'No security events logged yet.'}
                </td>
              </tr>
            ) : (
              auditLogs.map((log) => (
                <tr key={log.logId}>
                  <td className="py-3 px-4 text-xs font-mono tabular-nums">
                    {new Date(log.timestamp).toLocaleString()}
                  </td>
                  <td className="py-3 px-4 text-xs font-mono">{log.actorId}</td>
                  <td className="py-3 px-4 text-xs font-semibold">{log.action}</td>
                  <td className="py-3 px-4 text-xs font-mono">{log.targetId}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
