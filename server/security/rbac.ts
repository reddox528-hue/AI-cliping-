export type UserRole = 'CUSTOMER' | 'ADMIN' | 'SUPER_ADMIN';
export type AccountStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export type AdminPermission =
  | 'VIEW_DASHBOARD'
  | 'MANAGE_CUSTOMERS'
  | 'REVIEW_APPROVALS'
  | 'MONITOR_PROJECTS'
  | 'MANAGE_PROCESSING'
  | 'MONITOR_USAGE_STORAGE'
  | 'CREATE_ADMINS';

export const ALL_ADMIN_PERMISSIONS: readonly AdminPermission[] = [
  'VIEW_DASHBOARD',
  'MANAGE_CUSTOMERS',
  'REVIEW_APPROVALS',
  'MONITOR_PROJECTS',
  'MANAGE_PROCESSING',
  'MONITOR_USAGE_STORAGE',
  'CREATE_ADMINS',
] as const;

export const DEFAULT_ADMIN_PERMISSIONS: readonly AdminPermission[] = [
  'VIEW_DASHBOARD',
  'MANAGE_CUSTOMERS',
  'REVIEW_APPROVALS',
  'MONITOR_PROJECTS',
  'MANAGE_PROCESSING',
  'MONITOR_USAGE_STORAGE',
] as const;

export const BOOTSTRAP_OWNER_EMAIL = (process.env.SUPER_ADMIN_EMAIL || 'reddox528@gmail.com')
  .trim()
  .toLowerCase();

export interface TrustedCaller {
  uid: string;
  email?: string;
  emailVerified: boolean;
  role: UserRole;
  accountStatus: AccountStatus;
  permissions: AdminPermission[];
  isBootstrapOwner: boolean;
  idToken: string;
}

export function normalizePermissions(input: unknown): AdminPermission[] {
  if (!Array.isArray(input)) return [];
  const valid = new Set<string>(ALL_ADMIN_PERMISSIONS);
  const out: AdminPermission[] = [];
  for (const item of input) {
    if (typeof item === 'string' && valid.has(item) && !out.includes(item as AdminPermission)) {
      out.push(item as AdminPermission);
    }
  }
  return out;
}

export function isApprovedAdminCaller(caller: TrustedCaller): boolean {
  if (caller.isBootstrapOwner) return true;
  if (caller.accountStatus !== 'APPROVED') return false;
  return caller.role === 'ADMIN' || caller.role === 'SUPER_ADMIN';
}

export function isSuperAdminCaller(caller: TrustedCaller): boolean {
  if (caller.isBootstrapOwner) return true;
  return caller.accountStatus === 'APPROVED' && caller.role === 'SUPER_ADMIN';
}

export function hasAdminPermission(caller: TrustedCaller, permission: AdminPermission): boolean {
  if (!isApprovedAdminCaller(caller)) return false;
  if (isSuperAdminCaller(caller)) return true;
  return caller.permissions.includes(permission);
}

export function canManageTargetAccount(
  actor: TrustedCaller,
  targetUid: string,
  targetRole: UserRole
): boolean {
  if (!isApprovedAdminCaller(actor)) return false;
  // Nobody can escalate or alter their own privileged status/role via admin endpoints
  if (actor.uid === targetUid) return false;
  if (isSuperAdminCaller(actor)) return true;
  // Standard ADMIN may only manage CUSTOMER accounts
  return targetRole === 'CUSTOMER';
}
