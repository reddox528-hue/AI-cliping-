import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, Lock, Mail, Shield } from 'lucide-react';
import { ThemeToggle } from '../../components/common/ThemeToggle';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
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
  const { firebaseUser, loading, signInWithEmail, signInWithGoogle, resetPassword } = useAuth();
  const { notify } = useToast();

  const [session, setSession] = useState<AdminSessionInfo | null>(null);
  const [verifying, setVerifying] = useState(true);
  const [activeRoute, setActiveRoute] = useState<AdminRoute>('admin-overview');
  const loggedLoginUidRef = useRef<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resetMode, setResetMode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const verify = async () => {
      if (loading) return;
      if (!firebaseUser) {
        loggedLoginUidRef.current = null;
        if (!cancelled) {
          setSession(null);
          setVerifying(false);
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
  }, [firebaseUser, loading, notify, onRedirectCustomerHome]);

  if (loading || (firebaseUser && verifying)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#070B14] text-slate-600 dark:text-slate-300 text-sm">
        Verifying session authorization...
      </div>
    );
  }

  // Unauthenticated visitor: render dedicated sign-in & password recovery screen (NO public registration)
  if (!firebaseUser) {
    const handleEmailLogin = async (e: React.FormEvent) => {
      e.preventDefault();
      setErrorMsg(null);
      setResetMessage(null);
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

    const handleGoogleLogin = async () => {
      setErrorMsg(null);
      setResetMessage(null);
      setSubmitting(true);
      try {
        await signInWithGoogle();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Google sign-in failed.';
        await reportFailedAdminLogin('google_oauth', msg);
        setErrorMsg(msg);
      } finally {
        setSubmitting(false);
      }
    };

    const handlePasswordReset = async (e: React.FormEvent) => {
      e.preventDefault();
      setErrorMsg(null);
      setResetMessage(null);
      if (!email.trim()) {
        setErrorMsg('Enter your administrator email address.');
        return;
      }
      setSubmitting(true);
      try {
        await reportAdminPasswordResetRequest(email);
        await resetPassword(email);
      } catch {
        // Deliberately swallow enumeration hints; keep response uniform
      } finally {
        setResetMessage(
          'If an authorized administrator account matches that email, a password reset link has been sent.'
        );
        setSubmitting(false);
      }
    };

    return (
      <div className="min-h-screen bg-slate-50 dark:bg-[#070B14] text-slate-900 dark:text-slate-100 flex flex-col">
        <header className="px-6 h-16 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B101D]">
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
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E1424] p-7 shadow-sm">
            <div className="w-11 h-11 rounded-xl bg-purple-600/10 text-purple-600 dark:text-purple-400 flex items-center justify-center mb-4">
              <Shield className="w-5 h-5" />
            </div>
            <h1 className="font-display text-2xl font-bold text-slate-950 dark:text-white">
              {resetMode ? 'Recover Administrator Password' : 'Administrator Sign In'}
            </h1>
            <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400">
              {resetMode
                ? 'Enter your administrator email address to receive a Firebase password reset link.'
                : 'Authorized administrators only. Public registration is disabled on this route.'}
            </p>

            {errorMsg && (
              <div className="mt-4 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            {resetMessage && (
              <div className="mt-4 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-xs text-emerald-700 dark:text-emerald-300 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{resetMessage}</span>
              </div>
            )}

            {resetMode ? (
              <form onSubmit={handlePasswordReset} className="mt-5 space-y-4">
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
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold transition-colors disabled:opacity-60"
                >
                  {submitting ? 'Sending Reset Link...' : 'Send Password Reset Email'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setResetMode(false);
                    setErrorMsg(null);
                  }}
                  className="w-full text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                >
                  Return to Administrator Sign In
                </button>
              </form>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={submitting}
                  className="mt-5 w-full flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-semibold transition-colors disabled:opacity-60"
                >
                  Sign in with Google
                </button>

                <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
                  <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
                  <span>or administrator email</span>
                  <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
                </div>

                <form onSubmit={handleEmailLogin} className="space-y-4">
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
                        className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-semibold">Password</label>
                      <button
                        type="button"
                        onClick={() => {
                          setResetMode(true);
                          setErrorMsg(null);
                          setResetMessage(null);
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
                        className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
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
              </>
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
