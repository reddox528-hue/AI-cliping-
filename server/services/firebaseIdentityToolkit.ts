import { env } from '../config/env.ts';

export interface IdentityAuthResult {
  uid: string;
  email: string;
  idToken: string;
  emailVerified: boolean;
}

function getApiKey(): string {
  if (!env.firebaseApiKey || env.firebaseApiKey === 'remixed-api-key') {
    throw new Error('Firebase Web API key is not configured in firebase-applet-config.json.');
  }
  return env.firebaseApiKey;
}

async function identityRequest<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const apiKey = getApiKey();
  const url = `https://identitytoolkit.googleapis.com/v1/${endpoint}?key=${encodeURIComponent(apiKey)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown> & {
    error?: { message?: string };
  };
  if (!resp.ok) {
    const code = data?.error?.message || `HTTP_${resp.status}`;
    const err = new Error(`Firebase Auth API error (${code})`) as Error & { code?: string };
    err.code = code;
    throw err;
  }
  return data as T;
}

export async function signUpWithEmailPassword(params: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<IdentityAuthResult> {
  const res = await identityRequest<{
    localId: string;
    email: string;
    idToken: string;
  }>('accounts:signUp', {
    email: params.email.trim(),
    password: params.password,
    returnSecureToken: true,
  });

  if (params.displayName?.trim()) {
    await identityRequest('accounts:update', {
      idToken: res.idToken,
      displayName: params.displayName.trim().slice(0, 120),
      returnSecureToken: false,
    }).catch(() => {});
  }

  return {
    uid: res.localId,
    email: res.email,
    idToken: res.idToken,
    emailVerified: false,
  };
}

export async function signInWithEmailPassword(params: {
  email: string;
  password: string;
}): Promise<IdentityAuthResult> {
  const res = await identityRequest<{
    localId: string;
    email: string;
    idToken: string;
  }>('accounts:signInWithPassword', {
    email: params.email.trim(),
    password: params.password,
    returnSecureToken: true,
  });

  const info = await lookupAccount(res.idToken);
  return {
    uid: res.localId,
    email: res.email,
    idToken: res.idToken,
    emailVerified: info.emailVerified,
  };
}

export async function lookupAccount(idToken: string): Promise<{ emailVerified: boolean }> {
  const res = await identityRequest<{
    users?: Array<{ emailVerified?: boolean }>;
  }>('accounts:lookup', { idToken });
  const user = Array.isArray(res.users) ? res.users[0] : undefined;
  return {
    emailVerified: Boolean(user?.emailVerified),
  };
}

export async function sendVerificationEmail(idToken: string): Promise<void> {
  await identityRequest('accounts:sendOobCode', {
    requestType: 'VERIFY_EMAIL',
    idToken,
  });
}

export async function sendPasswordResetEmailApi(email: string): Promise<void> {
  await identityRequest('accounts:sendOobCode', {
    requestType: 'PASSWORD_RESET',
    email: email.trim(),
  });
}
