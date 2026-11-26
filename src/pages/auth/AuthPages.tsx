import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Lock,
  Mail,
  RefreshCw,
  ShieldAlert,
  User as UserIcon,
} from 'lucide-react';
import { ThemeToggle } from '../../components/common/ThemeToggle';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';

interface AuthPagesProps {
  initialMode: 'signin' | 'register';
  onBackHome: () => void;
}

export function AuthPage({ initialMode, onBackHome }: AuthPagesProps) {
  const { signInWithEmail, signInWithGoogle, registerWithEmail, resetPassword } = useAuth();
  const { notify } = useToast();

  const [mode, setMode] = useState<'signin' | 'register' | 'forgot'>(initialMode);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [providerHelp, setProviderHelp] = useState(false);

  const handleError = (err: unknown) => {
    const raw = err instanceof Error ? err.message : String(err);
    if (raw.includes('auth/operation-not-allowed')) {
      setProviderHelp(true);
      setErrorMsg(
        'Email/Password sign-in is not yet enabled in the Firebase Console. You can sign in with Google immediately, or enable Email/Password under Authentication > Sign-in method.'
      );
      return;
    }
    if (raw.includes('auth/popup-closed-by-user')) {
      setErrorMsg('Google sign-in popup was closed before completing.');
      return;
    }
    if (raw.includes('auth/invalid-credential') || raw.includes('auth/wrong-password')) {
      setErrorMsg('Invalid email or password.');
      return;
    }
    if (raw.includes('auth/email-already-in-use')) {
      setErrorMsg('An account with this email already exists. Try signing in instead.');
      return;
    }
    setErrorMsg(raw);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setProviderHelp(false);

    if (!email.trim() || !email.includes('@')) {
      setErrorMsg('Enter a valid email address.');
      return;
    }

    if (mode === 'forgot') {
      setSubmitting(true);
      try {
        await resetPassword(email);
        notify('success', 'Reset link sent', 'Check your inbox for a password reset link.');
        setMode('signin');
      } catch (err) {
        handleError(err);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (password.length < 8) {
      setErrorMsg('Password must be at least 8 characters.');
      return;
    }

    if (mode === 'register') {
      if (!displayName.trim()) {
        setErrorMsg('Enter your full name or studio name.');
        return;
      }
      if (password !== confirmPassword) {
        setErrorMsg('Passwords do not match.');
        return;
      }
    }

    setSubmitting(true);
    try {
      if (mode === 'signin') {
        await signInWithEmail(email, password);
        notify('success', 'Signed in');
      } else {
        await registerWithEmail(displayName, email, password);
        notify(
          'info',
          'Registration received',
          'Your account has been created and is awaiting administrator approval.'
        );
      }
    } catch (err) {
      handleError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setErrorMsg(null);
    setProviderHelp(false);
    setSubmitting(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      handleError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#070B14] text-slate-900 dark:text-slate-100 flex flex-col">
      <header className="px-4 sm:px-8 h-16 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B101D]">
        <button
          type="button"
          onClick={onBackHome}
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white"
        >
          <ArrowLeft className="w-4 h-4" />
          REDDOX Clipora AI
        </button>
        <ThemeToggle />
      </header>

      <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E1424] p-6 sm:p-8 shadow-sm">
          <h1 className="font-display text-2xl font-bold text-slate-950 dark:text-white">
            {mode === 'signin'
              ? 'Sign in to Clipora AI'
              : mode === 'register'
              ? 'Request creator access'
              : 'Reset your password'}
          </h1>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
            {mode === 'signin'
              ? 'Access your projects, generated clips, and video editor.'
              : mode === 'register'
              ? 'New accounts require administrator approval before workspace access is activated.'
              : 'Enter your email address to receive a password reset link.'}
          </p>

          {errorMsg && (
            <div className="mt-5 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-3.5 text-xs text-red-700 dark:text-red-300 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-1.5">
                <p>{errorMsg}</p>
                {providerHelp && (
                  <p className="text-slate-600 dark:text-slate-400">
                    Firebase Console → Authentication → Sign-in method → Enable Email/Password.
                  </p>
                )}
              </div>
            </div>
          )}

          {mode !== 'forgot' && (
            <>
              <button
                type="button"
                onClick={handleGoogle}
                disabled={submitting}
                className="mt-6 w-full flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-semibold transition-colors disabled:opacity-60"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                  />
                </svg>
                Continue with Google
              </button>

              <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
                <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
                <span>or with email</span>
                <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Full Name or Studio
                </label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Alex Morgan"
                    required
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@studio.com"
                  required
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {mode !== 'forgot' && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Password
                  </label>
                  {mode === 'signin' && (
                    <button
                      type="button"
                      onClick={() => {
                        setErrorMsg(null);
                        setMode('forgot');
                      }}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 8 characters"
                    required
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            )}

            {mode === 'register' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Confirm Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat password"
                    required
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors disabled:opacity-60"
            >
              {submitting
                ? 'Please wait...'
                : mode === 'signin'
                ? 'Sign In'
                : mode === 'register'
                ? 'Create Account'
                : 'Send Reset Email'}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-800 text-center text-xs text-slate-600 dark:text-slate-400">
            {mode === 'signin' ? (
              <>
                Need an account?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg(null);
                    setMode('register');
                  }}
                  className="font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Request access
                </button>
              </>
            ) : (
              <>
                Already registered?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg(null);
                    setMode('signin');
                  }}
                  className="font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Sign in
                </button>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export function AccountStatusGate() {
  const { firebaseUser, profile, resendVerification, refreshProfile, logout } = useAuth();
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);

  if (!profile) return null;

  const isPending = profile.accountStatus === 'PENDING';
  const isRejected = profile.accountStatus === 'REJECTED';

  const handleResend = async () => {
    setBusy(true);
    try {
      await resendVerification();
      notify('success', 'Verification email sent', 'Check your inbox and click the verification link.');
    } catch (err) {
      notify('error', 'Could not send email', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRefresh = async () => {
    setBusy(true);
    try {
      await refreshProfile();
      notify('info', 'Status refreshed');
    } catch (err) {
      notify('error', 'Refresh failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#070B14] text-slate-900 dark:text-slate-100 flex flex-col">
      <header className="px-6 h-16 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B101D]">
        <span className="font-display font-bold text-lg">REDDOX Clipora AI</span>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <button
            type="button"
            onClick={logout}
            className="px-3.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Sign Out
          </button>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-lg w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E1424] p-8 shadow-sm">
          <div
            className={`w-12 h-12 rounded-xl flex items-center justify-center mb-5 ${
              isPending
                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                : 'bg-red-500/10 text-red-600 dark:text-red-400'
            }`}
          >
            {isPending ? <Clock className="w-6 h-6" /> : <ShieldAlert className="w-6 h-6" />}
          </div>

          <h1 className="font-display text-2xl font-bold text-slate-950 dark:text-white">
            {isPending
              ? 'Account Awaiting Administrator Approval'
              : isRejected
              ? 'Account Application Declined'
              : 'Account Suspended'}
          </h1>

          <p className="mt-3 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            {isPending
              ? `Your registration for ${profile.email} has been received and assigned PENDING status. An administrator must approve your account before you can upload videos, run AI analysis, or access the editing studio.`
              : isRejected
              ? `Your application for ${profile.email} was declined by a platform administrator.`
              : `Access for ${profile.email} is currently suspended. Contact your platform administrator to reactivate your account.`}
          </p>

          <div className="mt-6 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400">Approval Status</span>
              <span className="font-mono font-semibold">{profile.accountStatus}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400">Email Verification</span>
              <span className="inline-flex items-center gap-1 font-medium">
                {firebaseUser?.emailVerified ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    Verified
                  </>
                ) : (
                  'Unverified'
                )}
              </span>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={busy}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors disabled:opacity-60"
            >
              <RefreshCw className="w-4 h-4" />
              Check Approval Status
            </button>

            {firebaseUser && !firebaseUser.emailVerified && (
              <button
                type="button"
                onClick={handleResend}
                disabled={busy}
                className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Resend Verification Email
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
