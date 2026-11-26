import React, { useState } from 'react';
import {
  Bell,
  Download,
  Film,
  FolderKanban,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Menu,
  Palette,
  PlusCircle,
  Scissors,
  Settings,
  Sliders,
  X,
} from 'lucide-react';
import { ThemeToggle } from '../components/common/ThemeToggle';
import { useAuth } from '../contexts/AuthContext';

export type CustomerRoute =
  | 'overview'
  | 'create'
  | 'projects'
  | 'videos'
  | 'clips'
  | 'editor'
  | 'brand-kit'
  | 'exports'
  | 'settings'
  | 'help';

interface DashboardLayoutProps {
  activeRoute: CustomerRoute;
  onSelectRoute: (route: CustomerRoute) => void;
  children: React.ReactNode;
}

const CUSTOMER_NAV: Array<{
  id: CustomerRoute;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'create', label: 'Create New Clips', icon: PlusCircle },
  { id: 'projects', label: 'My Projects', icon: FolderKanban },
  { id: 'videos', label: 'My Videos', icon: Film },
  { id: 'clips', label: 'Generated Clips', icon: Scissors },
  { id: 'editor', label: 'Video Editor', icon: Sliders },
  { id: 'brand-kit', label: 'Brand Kit', icon: Palette },
  { id: 'exports', label: 'Export History', icon: Download },
  { id: 'settings', label: 'Account Settings', icon: Settings },
  { id: 'help', label: 'Help and Support', icon: HelpCircle },
];

export function DashboardLayout({
  activeRoute,
  onSelectRoute,
  children,
}: DashboardLayoutProps) {
  const { profile, notifications, markNotificationAsRead, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const activeNav = CUSTOMER_NAV.find((item) => item.id === activeRoute) || CUSTOMER_NAV[0];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0D0F17] text-slate-900 dark:text-slate-100 flex">
      {/* Mobile Sidebar Backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Customer Sidebar (strictly customer-facing items only) */}
      <aside
        className={`fixed lg:sticky top-0 left-0 z-50 h-screen w-64 shrink-0 border-r border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#121521] flex flex-col transition-transform duration-200 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="h-16 px-5 border-b border-slate-200 dark:border-[#24283B] flex items-center justify-between">
          <span className="font-display font-bold text-base tracking-tight text-slate-950 dark:text-white whitespace-nowrap flex items-center gap-2">
            <span className="w-6 h-6 rounded-md bg-purple-600 text-white inline-flex items-center justify-center text-[11px] font-bold">
              R
            </span>
            <span>REDDOX Clipora AI</span>
          </span>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
            className="lg:hidden p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {CUSTOMER_NAV.map((item) => {
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
                    ? 'bg-purple-600/12 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300 font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#1A1E2E] hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-200 dark:border-[#24283B]">
          <div className="flex items-center gap-3 px-2 py-2">
            <img
              src={profile?.photoURL || '/src/assets/images/avatar_reddox_creator_1795653051009.jpg'}
              alt={profile?.displayName || 'Creator avatar'}
              referrerPolicy="no-referrer"
              className="w-9 h-9 rounded-full object-cover border border-purple-500/30 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                {profile?.displayName}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {profile?.email || 'Creator Studio'}
              </p>
            </div>
            <button
              type="button"
              onClick={logout}
              title="Sign Out"
              aria-label="Sign Out"
              className="p-2 rounded-lg text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-[#1A1E2E]"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 h-16 px-4 sm:px-6 border-b border-slate-200 dark:border-[#24283B] bg-white/90 dark:bg-[#121521]/90 backdrop-blur-md flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2.5 rounded-xl border border-slate-200 dark:border-[#24283B] text-slate-600 dark:text-slate-300"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-400 hidden sm:inline">Creator Studio</span>
              <span className="text-slate-400 hidden sm:inline">/</span>
              <span className="font-semibold text-slate-900 dark:text-white truncate">
                {activeNav.label}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0 relative">
            <ThemeToggle />

            <button
              type="button"
              onClick={() => setNotifOpen((v) => !v)}
              aria-label="Notifications"
              className="relative inline-flex items-center justify-center w-10 h-10 rounded-xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1E2233]"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-purple-600 text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                  {unreadCount}
                </span>
              )}
            </button>

            {notifOpen && (
              <div className="absolute right-0 top-12 w-80 sm:w-96 rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] shadow-xl p-4 z-50">
                <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-[#24283B]">
                  <span className="text-sm font-bold">Notifications</span>
                  <button
                    type="button"
                    onClick={() => setNotifOpen(false)}
                    className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white"
                  >
                    Close
                  </button>
                </div>
                <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-[#24283B]">
                  {notifications.length === 0 ? (
                    <p className="py-8 text-center text-xs text-slate-500">
                      No notifications yet.
                    </p>
                  ) : (
                    notifications.slice(0, 15).map((n) => (
                      <button
                        key={n.notificationId}
                        type="button"
                        onClick={() => {
                          if (!n.read) void markNotificationAsRead(n.notificationId);
                        }}
                        className={`w-full text-left py-3 px-2 rounded-lg transition-colors ${
                          n.read ? 'opacity-70' : 'bg-purple-500/8 hover:bg-purple-500/12'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-900 dark:text-white">
                            {n.title}
                          </span>
                          {!n.read && (
                            <span className="text-[10px] font-semibold text-purple-600 dark:text-purple-400">
                              New
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                          {n.message}
                        </p>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
