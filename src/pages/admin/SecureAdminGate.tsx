import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, KeyRound, Lock, Mail, Shield, User as UserIcon } from 'lucide-react';
import { ThemeToggle } from '../../components/common/ThemeToggle';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  checkSuperAdminInitialized,
  recordAdminLoginEvent,
  reportAdminPasswordResetRequest,
  reportFailedAdminLogin,
  reportUnauthorizedRouteAccess,
  verifyAdminSessionOnServer,
  type AdminSessionInfo,
} from '../../services/admin/adminApiClient';
import { AdminControlPanelLayout, type AdminRoute } from './AdminControlPanelLayout';
import { AdminDashboard } from './AdminDashboard';

function resolveDefaultAdminRoute(session: AdminSessionInfo): AdminRoute {
  if (session.isSuperAdmin || session.permissions.includes('VIEW_DASHBOARD')) {
    return 'admin-overview';
  }
  if (session.permissions.includes('MANAGE_CUSTOMERS')) return 'admin-users';
  if (session.permissions.includes('REVIEW_APPROVALS')) return 'admin-approvals';
  if (session.permissions.includes('CREATE_ADMINS')) return 'admin-roles';
  if (session.permissions.includes('MONITOR_PROJECTS')) return 'admin-projects';
  if (session.permissions.includes('MANAGE_PROCESSING')) return 'admin-jobs';
  if (session.permissions.includes('MONITOR_USAGE_STORAGE')) return 'admin-storage';
  return 'admin-overview';
}

export default function SecureAdminGate({
  onRedirectCustomerHome,
}: {
  onRedirectCustomerHome: () => void;
}) {
  const { user, loading, signInWithEmail, setupInitialSuperAdmin } = useAuth();
  const { notify } = useToast();

  const [session, setSession] = useState<AdminSessionInfo | null>(null);
  const [verifying, setVerifying] = useState(true);
  const [superAdminInitialized, setSuperAdminInitialized] = useState<boolean | null>(null);
  const [activeRoute, setActiveRoute] = useState<AdminRoute>('admin-overview');
  const loggedLoginUidRef = useRef<string | null>(null);

  const [displayName, setDisplayName] = useState('REDDOX Super Admin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [setupSecret, setSetupSecret] = useState('');
  const [resetHelpOpen, setResetHelpOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const verify = async () => {
      if (loading) return;

      if (!user) {
        loggedLoginUidRef.current = null;
        if (!cancelled) {
          setSession(null);
        }
        try {
          const status = await checkSuperAdminInitialized();
          if (!cancelled) setSuperAdminInitialized(status.initialized);
        } catch {
          if (!cancelled) setSuperAdminInitialized(true);
        } finally {
          if (!cancelled) setVerifying(false);
        }
        return;
      }

      setVerifying(true);
      try {
        const verified = await verifyAdminSessionOnServer();
        if (!cancelled) {
          if (verified.authorized && (verified.role === 'ADMIN' || verified.role === 'SUPER_ADMIN')) {
            setSession(verified);
            setActiveRoute(resolveDefaultAdminRoute(verified));
            setVerifying(false);
            if (loggedLoginUidRef.current !== verified.uid) {
              loggedLoginUidRef.current = verified.uid;
              void recordAdminLoginEvent();
            }
          } else {
            await reportUnauthorizedRouteAccess('/secure-control-panel');
            onRedirectCustomerHome();
          }
        }
      } catch {
        if (!cancelled) {
          await reportUnauthorizedRouteAccess('/secure-control-panel');
          notify('error', 'Access denied', 'You are not authorized to access the control panel.');
          onRedirectCustomerHome();
        }
      }
    };

    void verify();
    return () => {
      cancelled = true;
    };
  }, [user, loading, notify, onRedirectCustomerHome]);

  if (loading || verifying) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0D0F17] text-slate-600 dark:text-slate-300 text-sm">
        Verifying session authorization...
      </div>
    );
  }

  // Unauthenticated visitor: show one-time Super Admin first-run setup OR dedicated Admin Sign In (no public customer signup)
  if (!user) {
    const isSetupMode = superAdminInitialized === false;

    const handleEmailLogin = async (e: React.FormEvent) => {
      e.preventDefault();
      setErrorMsg(null);
      setInfoMsg(null);
      setSubmitting(true);
      try {
        await signInWithEmail(email, password);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Authentication failed.';
        await reportFailedAdminLogin(email, msg);
        setErrorMsg('Invalid administrator credentials or account not authorized.');
      } finally {
        setSubmitting(false);
      }
    };

    const handleInitialSetup = async (e: React.FormEvent) => {
      e.preventDefault();
      setErrorMsg(null);
      setInfoMsg(null);
      if (password !== confirmPassword) {
        setErrorMsg('Passwords do not match.');
        return;
      }
      setSubmitting(true);
      try {
        await setupInitialSuperAdmin({
          displayName: displayName.trim() || 'REDDOX Super Admin',
          email: email.trim(),
          password,
          setupSecret: setupSecret.trim() || undefined,
        });
        setSuperAdminInitialized(true);
        notify('success', 'Super Admin initialized', 'You are now signed into the Control Panel.');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Super Admin setup failed.';
        setErrorMsg(msg);
      } finally {
        setSubmitting(false);
      }
    };

    const handleRecoveryRequest = async (e: React.FormEvent) => {
      e.preventDefault();
      setErrorMsg(null);
      if (!email.trim()) {
        setErrorMsg('Enter your administrator email address.');
        return;
      }
      setSubmitting(true);
      try {
        await reportAdminPasswordResetRequest(email);
      } finally {
        setInfoMsg(
          'Password reset request recorded. Contact your Super Admin inside Control Panel → Admin & Roles to issue a temporary password.'
        );
        setSubmitting(false);
      }
    };

    return (
      <div className="min-h-screen bg-slate-50 dark:bg-[#0D0F17] text-slate-900 dark:text-slate-100 flex flex-col">
        <header className="px-4 sm:px-6 h-16 flex items-center justify-between border-b border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#121521]">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={onRedirectCustomerHome}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to Website
            </button>
            <span className="font-display font-bold text-base">REDDOX Clipora AI</span>
          </div>
          <ThemeToggle />
        </header>

        <main className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] p-7 shadow-sm">
            <div className="w-11 h-11 rounded-xl bg-purple-600/12 border border-purple-500/20 text-purple-600 dark:text-purple-400 flex items-center justify-center mb-4">
              <Shield className="w-5 h-5" />
            </div>
            <h1 className="font-display text-2xl font-bold text-slate-950 dark:text-white">
              {isSetupMode
                ? 'Initialize Super Admin'
                : resetHelpOpen
                ? 'Administrator Password Recovery'
                : 'Administrator Sign In'}
            </h1>
            <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400">
              {isSetupMode
                ? 'One-time setup for the configured platform owner email. This form locks permanently after completion.'
                : resetHelpOpen
                ? 'Administrators receive temporary reset passwords directly from the Super Admin.'
                : 'Authorized administrators only. Public registration is disabled on this route.'}
            </p>

            {errorMsg && (
              <div className="mt-4 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            {infoMsg && (
              <div className="mt-4 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-xs text-emerald-700 dark:text-emerald-300 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{infoMsg}</span>
              </div>
            )}

            {isSetupMode ? (
              <form onSubmit={handleInitialSetup} className="mt-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold mb-1.5">Display Name</label>
                  <div className="relative">
                    <UserIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 dark:border-[#24283B] bg-white dark:bg-[#121521] text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5">Owner Email Address</label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="owner@domain.com"
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 dark:border-[#24283B] bg-white dark:bg-[#121521] text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5">
                    Password (min 12 chars, upper + lower + number)
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="password"
                      required
                      minLength={12}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Strong Super Admin password"
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 dark:border-[#24283B] bg-white dark:bg-[#121521] text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5">Confirm Password</label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="password"
                      required
                      minLength={12}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Repeat password"
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 dark:border-[#24283B] bg-white dark:bg-[#121521] text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5">
                    Bootstrap Secret (only if configured in server env)
                  </label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="password"
                      value={setupSecret}
                      onChange={(e) => setSetupSecret(e.target.value)}
                      placeholder="Optional SUPER_ADMIN_BOOTSTRAP_SECRET"
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 dark:border-[#24283B] bg-white dark:bg-[#121521] text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold transition-colors disabled:opacity-60"
                >
                  {submitting ? 'Establishing Super Admin...' : 'Complete Initial Super Admin Setup'}
                </button>
              </form>
            ) : resetHelpOpen ? (
              <form onSubmit={handleRecoveryRequest} className="mt-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold mb-1.5">Administrator Email</label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="admin@studio.com"
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 dark:border-[#24283B] bg-white dark:bg-[#121521] text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold transition-colors disabled:opacity-60"
                >
                  {submitting ? 'Logging Request...' : 'Notify Super Admin'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setResetHelpOpen(false);
                    setErrorMsg(null);
                    setInfoMsg(null);
                  }}
                  className="w-full text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                >
                  Return to Administrator Sign In
                </button>
              </form>
            ) : (
              <form onSubmit={handleEmailLogin} className="mt-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold mb-1.5">Email Address</label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="admin@studio.com"
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 dark:border-[#24283B] bg-white dark:bg-[#121521] text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500"
                    />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold">Password</label>
                    <button
                      type="button"
                      onClick={() => {
                        setResetHelpOpen(true);
                        setErrorMsg(null);
                        setInfoMsg(null);
                      }}
                      className="text-xs font-semibold text-purple-600 dark:text-purple-400 hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Password"
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 dark:border-[#24283B] bg-white dark:bg-[#121521] text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold transition-colors disabled:opacity-60"
                >
                  {submitting ? 'Verifying...' : 'Sign In to Control Panel'}
                </button>
              </form>
            )}
          </div>
        </main>
      </div>
    );
  }

  if (!session || !session.authorized) {
    return null;
  }

  return (
    <AdminControlPanelLayout
      session={session}
      activeRoute={activeRoute}
      onSelectRoute={setActiveRoute}
      onReturnCreatorApp={onRedirectCustomerHome}
    >
      <AdminDashboard
        session={session}
        activeRoute={activeRoute}
        onSelectRoute={setActiveRoute}
      />
    </AdminControlPanelLayout>
  );
}
