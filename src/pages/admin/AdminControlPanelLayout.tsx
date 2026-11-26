import React, { useState } from 'react';
import {
  Activity,
  ArrowLeft,
  Cpu,
  FileText,
  FolderKanban,
  HardDrive,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Shield,
  Sliders,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { ThemeToggle } from '../../components/common/ThemeToggle';
import { useAuth } from '../../contexts/AuthContext';
import type { AdminSessionInfo } from '../../services/admin/adminApiClient';
import type { AdminPermission } from '../../types/clipora';

export type AdminRoute =
  | 'admin-overview'
  | 'admin-users'
  | 'admin-approvals'
  | 'admin-roles'
  | 'admin-projects'
  | 'admin-jobs'
  | 'admin-usage'
  | 'admin-storage'
  | 'admin-ai'
  | 'admin-platform'
  | 'admin-logs';

interface AdminNavItem {
  id: AdminRoute;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  superAdminOnly?: boolean;
  requiredPermission?: AdminPermission;
}

const ADMIN_NAV: AdminNavItem[] = [
  { id: 'admin-overview', label: 'Control Overview', icon: LayoutDashboard, requiredPermission: 'VIEW_DASHBOARD' },
  { id: 'admin-users', label: 'User Accounts', icon: Users, requiredPermission: 'MANAGE_CUSTOMERS' },
  { id: 'admin-approvals', label: 'Pending Approvals', icon: UserCheck, requiredPermission: 'REVIEW_APPROVALS' },
  { id: 'admin-roles', label: 'Admin Provisioning & Roles', icon: Shield, requiredPermission: 'CREATE_ADMINS' },
  { id: 'admin-projects', label: 'Projects & Clips', icon: FolderKanban, requiredPermission: 'MONITOR_PROJECTS' },
  { id: 'admin-jobs', label: 'Processing Jobs', icon: Activity, requiredPermission: 'MANAGE_PROCESSING' },
  { id: 'admin-storage', label: 'Storage & Usage', icon: HardDrive, requiredPermission: 'MONITOR_USAGE_STORAGE' },
  { id: 'admin-usage', label: 'System Limits', icon: Sliders, superAdminOnly: true },
  { id: 'admin-ai', label: 'AI Configuration', icon: Cpu, superAdminOnly: true },
  { id: 'admin-platform', label: 'Platform Status', icon: Settings, superAdminOnly: true },
  { id: 'admin-logs', label: 'Security & Audit Logs', icon: FileText, superAdminOnly: true },
];

export function AdminControlPanelLayout({
  session,
  activeRoute,
  onSelectRoute,
  onReturnCreatorApp,
  children,
}: {
  session: AdminSessionInfo;
  activeRoute: AdminRoute;
  onSelectRoute: (route: AdminRoute) => void;
  onReturnCreatorApp: () => void;
  children: React.ReactNode;
}) {
  const { profile, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const visibleNav = ADMIN_NAV.filter((item) => {
    if (session.isSuperAdmin) return true;
    if (item.superAdminOnly) return false;
    if (item.requiredPermission) {
      return session.permissions.includes(item.requiredPermission);
    }
    return true;
  });

  const activeNav = visibleNav.find((item) => item.id === activeRoute) || visibleNav[0];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0D0F17] text-slate-900 dark:text-slate-100 flex overflow-x-hidden">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-xs lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed lg:sticky top-0 left-0 z-50 h-screen w-68 shrink-0 border-r border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#121521] flex flex-col transition-transform duration-200 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="h-16 px-5 border-b border-slate-200 dark:border-[#24283B] flex items-center justify-between">
          <div>
            <span className="font-display font-bold text-sm tracking-tight text-slate-950 dark:text-white block">
              REDDOX Clipora AI
            </span>
            <span className="text-[11px] font-mono text-purple-600 dark:text-purple-400">
              Secure Control Panel
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
            className="lg:hidden text-slate-500 hover:text-slate-900 dark:hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const active = activeRoute === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectRoute(item.id);
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left ${
                  active
                    ? 'bg-purple-600/12 text-purple-700 dark:text-purple-300 font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-200 dark:border-[#24283B] space-y-2">
          <button
            type="button"
            onClick={onReturnCreatorApp}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 dark:border-[#24283B] text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#161926]"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Creator Studio
          </button>

          <div className="flex items-center gap-3 px-2 py-2">
            <img
              src={profile?.photoURL || '/src/assets/images/avatar_reddox_creator_1795653051009.jpg'}
              alt={profile?.displayName || 'Administrator'}
              referrerPolicy="no-referrer"
              className="w-9 h-9 rounded-full object-cover border border-purple-500/40 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                {profile?.displayName || session.email}
              </p>
              <p className="text-[11px] font-mono text-purple-600 dark:text-purple-400 truncate">
                {session.role}
              </p>
            </div>
            <button
              type="button"
              onClick={logout}
              title="Sign Out"
              aria-label="Sign Out"
              className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 h-16 px-4 sm:px-6 border-b border-slate-200 dark:border-[#24283B] bg-white/90 dark:bg-[#121521]/90 backdrop-blur-md flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open admin navigation"
              className="lg:hidden w-10 h-10 inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-[#24283B] text-slate-600 dark:text-slate-300"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-purple-600 dark:text-purple-400 font-semibold hidden sm:inline">
                Control Panel
              </span>
              <span className="text-slate-400 hidden sm:inline">/</span>
              <span className="font-semibold text-slate-900 dark:text-white truncate">
                {activeNav?.label || 'Overview'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <span className="text-xs font-mono px-2.5 py-1 rounded-lg bg-purple-600/10 text-purple-700 dark:text-purple-300 border border-purple-500/20">
              {session.role}
            </span>
            <ThemeToggle />
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
