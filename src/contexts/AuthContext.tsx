import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  apiFetch,
  clearSessionToken,
  setSessionToken,
} from '../services/auth/sessionStore';
import { getSystemSettings, markNotificationRead } from '../services/data/workspaceService';
import {
  DEFAULT_AI_CONFIG,
  DEFAULT_LIMITS_CONFIG,
  type AIConfig,
  type AppNotification,
  type SystemLimitsConfig,
  type UserProfile,
} from '../types/clipora';

interface AuthSessionResponse {
  user: UserProfile;
  token?: string;
  notifications?: AppNotification[];
  settings?: {
    limits?: Partial<SystemLimitsConfig> | null;
    aiConfig?: Partial<AIConfig> | null;
  };
}

interface AuthContextValue {
  user: UserProfile | null;
  profile: UserProfile | null;
  notifications: AppNotification[];
  limits: SystemLimitsConfig;
  aiConfig: AIConfig;
  loading: boolean;
  authError: string | null;
  signInWithEmail: (email: string, password: string) => Promise<UserProfile>;
  registerWithEmail: (displayName: string, email: string, password: string) => Promise<UserProfile>;
  setupInitialSuperAdmin: (params: {
    displayName?: string;
    email: string;
    password: string;
    setupSecret?: string;
  }) => Promise<UserProfile>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  markNotificationAsRead: (notificationId: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  reloadSettings: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
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

  const refreshProfile = useCallback(async () => {
    try {
      const data = await apiFetch<AuthSessionResponse>('/api/auth/session');
      if (data.token) {
        setSessionToken(data.token);
      }
      setProfile(data.user);
      setNotifications(data.notifications || []);
      if (data.settings?.limits) {
        setLimits({ ...DEFAULT_LIMITS_CONFIG, ...data.settings.limits });
      }
      if (data.settings?.aiConfig) {
        setAiConfig({ ...DEFAULT_AI_CONFIG, ...data.settings.aiConfig });
      }
      setAuthError(null);
    } catch {
      clearSessionToken();
      setProfile(null);
      setNotifications([]);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const init = async () => {
      try {
        await refreshProfile();
      } finally {
        if (active) setLoading(false);
      }
    };
    void init();
    return () => {
      active = false;
    };
  }, [refreshProfile]);

  const signInWithEmail = async (email: string, password: string): Promise<UserProfile> => {
    setAuthError(null);
    const data = await apiFetch<{ token: string; user: UserProfile }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: email.trim(), password }),
    });
    setSessionToken(data.token);
    setProfile(data.user);
    await refreshProfile();
    return data.user;
  };

  const registerWithEmail = async (
    displayName: string,
    email: string,
    password: string
  ): Promise<UserProfile> => {
    setAuthError(null);
    const data = await apiFetch<{ token: string; user: UserProfile }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        displayName: displayName.trim(),
        email: email.trim(),
        password,
      }),
    });
    setSessionToken(data.token);
    setProfile(data.user);
    await refreshProfile();
    return data.user;
  };

  const setupInitialSuperAdmin = async (params: {
    displayName?: string;
    email: string;
    password: string;
    setupSecret?: string;
  }): Promise<UserProfile> => {
    setAuthError(null);
    const data = await apiFetch<{ token: string; user: UserProfile }>(
      '/api/auth/setup-super-admin',
      {
        method: 'POST',
        body: JSON.stringify(params),
      }
    );
    setSessionToken(data.token);
    setProfile(data.user);
    await refreshProfile();
    return data.user;
  };

  const changePassword = async (currentPassword: string, newPassword: string): Promise<void> => {
    await apiFetch('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  };

  const markNotificationAsRead = async (notificationId: string): Promise<void> => {
    await markNotificationRead(notificationId);
    setNotifications((prev) =>
      prev.map((n) => (n.notificationId === notificationId ? { ...n, read: true } : n))
    );
  };

  const logout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore logout network error
    }
    clearSessionToken();
    setProfile(null);
    setNotifications([]);
  };

  return (
    <AuthContext.Provider
      value={{
        user: profile,
        profile,
        notifications,
        limits,
        aiConfig,
        loading,
        authError,
        signInWithEmail,
        registerWithEmail,
        setupInitialSuperAdmin,
        changePassword,
        markNotificationAsRead,
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
