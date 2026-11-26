import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
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
  const { signInWithEmail, registerWithEmail } = useAuth();
  const { notify } = useToast();

  const [mode, setMode] = useState<'signin' | 'register'>(initialMode);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!email.trim() || !email.includes('@')) {
      setErrorMsg('Enter a valid email address.');
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
      setErrorMsg(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0D0F17] text-slate-900 dark:text-slate-100 flex flex-col">
      <header className="px-4 sm:px-8 h-16 flex items-center justify-between border-b border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#121521]">
        <button
          type="button"
          onClick={onBackHome}
          className="inline-flex items-center gap-2 min-h-[40px] text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          REDDOX Clipora AI
        </button>
        <ThemeToggle />
      </header>

      <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] p-6 sm:p-8 shadow-sm">
          <div className="flex items-center gap-2.5 mb-5">
            <span className="w-7 h-7 rounded-lg bg-purple-600 text-white inline-flex items-center justify-center text-xs font-bold">
              R
            </span>
            <span className="font-display font-bold text-sm text-slate-900 dark:text-white">
              REDDOX Clipora AI
            </span>
          </div>
          <h1 className="font-display text-2xl font-bold text-slate-950 dark:text-white">
            {mode === 'signin' ? 'Sign in to Clipora AI' : 'Request creator access'}
          </h1>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            {mode === 'signin'
              ? 'Access your projects, generated clips, and video editor.'
              : 'New accounts require administrator approval before workspace access is activated.'}
          </p>

          {errorMsg && (
            <div className="mt-5 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-3.5 text-xs text-red-700 dark:text-red-300 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <p>{errorMsg}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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
                    className="w-full min-h-[44px] pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 dark:border-[#2A2F45] bg-white dark:bg-[#0D0F17] text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
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
                  className="w-full min-h-[44px] pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 dark:border-[#2A2F45] bg-white dark:bg-[#0D0F17] text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  required
                  className="w-full min-h-[44px] pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 dark:border-[#2A2F45] bg-white dark:bg-[#0D0F17] text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
            </div>

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
                    className="w-full min-h-[44px] pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 dark:border-[#2A2F45] bg-white dark:bg-[#0D0F17] text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold transition-colors disabled:opacity-60"
            >
              {submitting
                ? 'Please wait...'
                : mode === 'signin'
                ? 'Sign In'
                : 'Create Account'}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-200 dark:border-[#24283B] text-center text-xs text-slate-600 dark:text-slate-400">
            {mode === 'signin' ? (
              <>
                Need an account?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg(null);
                    setMode('register');
                  }}
                  className="font-semibold text-purple-600 dark:text-purple-400 hover:underline"
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
                  className="font-semibold text-purple-600 dark:text-purple-400 hover:underline"
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
  const { profile, refreshProfile, logout } = useAuth();
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);

  if (!profile) return null;

  const isPending = profile.accountStatus === 'PENDING';
  const isRejected = profile.accountStatus === 'REJECTED';

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
    <div className="min-h-screen bg-slate-50 dark:bg-[#0D0F17] text-slate-900 dark:text-slate-100 flex flex-col">
      <header className="px-6 h-16 flex items-center justify-between border-b border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#121521]">
        <span className="font-display font-bold text-lg">REDDOX Clipora AI</span>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <button
            type="button"
            onClick={logout}
            className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-[#2A2F45] text-xs font-semibold hover:bg-slate-100 dark:hover:bg-[#1E2233]"
          >
            Sign Out
          </button>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-lg w-full rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] p-8 shadow-sm">
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

          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            {isPending
              ? `Your registration for ${profile.email} has been received and assigned PENDING status. An administrator must approve your account before you can upload videos, run AI analysis, or access the editing studio.`
              : isRejected
              ? `Your application for ${profile.email} was declined by a platform administrator.`
              : `Access for ${profile.email} is currently suspended. Contact your platform administrator to reactivate your account.`}
          </p>

          <div className="mt-6 p-4 rounded-xl border border-slate-200 dark:border-[#24283B] bg-slate-50 dark:bg-[#121521] space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400">Approval Status</span>
              <span className="font-mono font-semibold">{profile.accountStatus}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400">Account Role</span>
              <span className="font-mono font-semibold">{profile.role}</span>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={busy}
              className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold transition-colors disabled:opacity-60"
            >
              <RefreshCw className="w-4 h-4" />
              Check Approval Status
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
