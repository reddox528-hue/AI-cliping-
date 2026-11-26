import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../services/firebase/client';
import { ensureUserProfile, getSystemSettings } from '../services/firebase/firestoreService';
import {
  DEFAULT_AI_CONFIG,
  DEFAULT_LIMITS_CONFIG,
  type AIConfig,
  type AppNotification,
  type SystemLimitsConfig,
  type UserProfile,
} from '../types/clipora';

interface AuthContextValue {
  firebaseUser: User | null;
  profile: UserProfile | null;
  notifications: AppNotification[];
  limits: SystemLimitsConfig;
  aiConfig: AIConfig;
  loading: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (displayName: string, email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  reloadSettings: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [limits, setLimits] = useState<SystemLimitsConfig>(DEFAULT_LIMITS_CONFIG);
  const [aiConfig, setAiConfig] = useState<AIConfig>(DEFAULT_AI_CONFIG);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const reloadSettings = useCallback(async () => {
    const res = await getSystemSettings();
    setLimits(res.limits);
    setAiConfig(res.aiConfig);
  }, []);

  const syncProfile = useCallback(async (user: User) => {
    const synced = await ensureUserProfile({
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || user.email?.split('@')[0] || 'Creator',
      photoURL: user.photoURL || undefined,
      emailVerified: user.emailVerified,
    });
    setProfile(synced);
    if (synced.accountStatus === 'APPROVED') {
      await reloadSettings();
    }
  }, [reloadSettings]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      setAuthError(null);

      if (!user) {
        setProfile(null);
        setNotifications([]);
        setLoading(false);
        return;
      }

      try {
        await syncProfile(user);
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'Unable to load user profile.');
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, [syncProfile]);

  // Real-time listener on user profile & notifications once signed in
  useEffect(() => {
    if (!firebaseUser) return;

    const userUnsub = onSnapshot(
      doc(db, 'users', firebaseUser.uid),
      (snap) => {
        if (snap.exists()) {
          const d = snap.data() as Record<string, unknown>;
          setProfile((prev) => ({
            uid: String(d.uid || firebaseUser.uid),
            displayName: String(d.displayName || prev?.displayName || 'Creator'),
            email: String(d.email || prev?.email || ''),
            photoURL: d.photoURL ? String(d.photoURL) : undefined,
            role: (d.role as UserProfile['role']) || 'CUSTOMER',
            accountStatus: (d.accountStatus as UserProfile['accountStatus']) || 'PENDING',
            permissions: Array.isArray(d.permissions)
              ? (d.permissions as UserProfile['permissions'])
              : undefined,
            createdAt: prev?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            themePreference: (d.themePreference as UserProfile['themePreference']) || 'system',
          }));
        }
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, `users/${firebaseUser.uid}`);
      }
    );

    const notifQuery = query(
      collection(db, 'notifications'),
      where('ownerId', '==', firebaseUser.uid)
    );
    const notifUnsub = onSnapshot(
      notifQuery,
      (snap) => {
        const items: AppNotification[] = snap.docs.map((docSnap) => {
          const d = docSnap.data() as Record<string, unknown>;
          return {
            notificationId: String(d.notificationId),
            ownerId: String(d.ownerId),
            type: d.type as AppNotification['type'],
            title: String(d.title || ''),
            message: String(d.message || ''),
            read: Boolean(d.read),
            createdAt:
              d.createdAt && typeof (d.createdAt as { toDate?: () => Date }).toDate === 'function'
                ? (d.createdAt as { toDate: () => Date }).toDate().toISOString()
                : new Date().toISOString(),
          };
        });
        items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setNotifications(items);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'notifications');
      }
    );

    return () => {
      userUnsub();
      notifUnsub();
    };
  }, [firebaseUser]);

  const signInWithGoogle = async () => {
    setAuthError(null);
    await signInWithPopup(auth, googleProvider);
  };

  const signInWithEmail = async (email: string, password: string) => {
    setAuthError(null);
    await signInWithEmailAndPassword(auth, email.trim(), password);
  };

  const registerWithEmail = async (displayName: string, email: string, password: string) => {
    setAuthError(null);
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
    await updateProfile(cred.user, { displayName: displayName.trim() });
    await sendEmailVerification(cred.user).catch(() => {});
    await syncProfile(cred.user);
  };

  const resetPassword = async (email: string) => {
    setAuthError(null);
    await sendPasswordResetEmail(auth, email.trim());
  };

  const resendVerification = async () => {
    if (!auth.currentUser) throw new Error('Not signed in.');
    await sendEmailVerification(auth.currentUser);
  };

  const logout = async () => {
    await signOut(auth);
  };

  const refreshProfile = async () => {
    if (!auth.currentUser) return;
    await auth.currentUser.reload();
    await syncProfile(auth.currentUser);
  };

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        notifications,
        limits,
        aiConfig,
        loading,
        authError,
        signInWithGoogle,
        signInWithEmail,
        registerWithEmail,
        resetPassword,
        resendVerification,
        logout,
        refreshProfile,
        reloadSettings,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
