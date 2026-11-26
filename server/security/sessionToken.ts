import crypto from 'crypto';
import type { Request } from 'express';
import { env } from '../config/env.ts';

export const SESSION_COOKIE_NAME = 'clipora_session';
const TOKEN_VERSION = 'v1';
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface SessionTokenPayload {
  uid: string;
  iat: number;
  exp: number;
}

function toBase64Url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function fromBase64Url(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

export function signSessionToken(
  uid: string,
  secret: string = env.sessionSecret,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload: SessionTokenPayload = {
    uid,
    iat: nowSec,
    exp: nowSec + ttlSeconds,
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signingInput = `${TOKEN_VERSION}.${encodedPayload}`;
  const sig = crypto.createHmac('sha256', secret).update(signingInput).digest('base64url');
  return `${signingInput}.${sig}`;
}

export function verifySessionToken(
  token: string,
  secret: string = env.sessionSecret
): SessionTokenPayload | null {
  if (!token || typeof token !== 'string' || token.length > 2048) {
    return null;
  }
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) {
    return null;
  }
  const [version, encodedPayload, sig] = parts;
  if (!encodedPayload || !sig) return null;

  const signingInput = `${version}.${encodedPayload}`;
  const expectedSig = crypto.createHmac('sha256', secret).update(signingInput).digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fromBase64Url(encodedPayload)) as Partial<SessionTokenPayload>;
    if (!parsed.uid || typeof parsed.uid !== 'string') return null;
    if (typeof parsed.exp !== 'number' || typeof parsed.iat !== 'number') return null;
    const nowSec = Math.floor(Date.now() / 1000);
    if (parsed.exp <= nowSec) return null;
    return { uid: parsed.uid, iat: parsed.iat, exp: parsed.exp };
  } catch {
    return null;
  }
}

export function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx <= 0) continue;
    const key = pair.slice(0, idx).trim();
    const rawVal = pair.slice(idx + 1).trim();
    try {
      cookies[key] = decodeURIComponent(rawVal);
    } catch {
      cookies[key] = rawVal;
    }
  }
  return cookies;
}

export function isHttpsRequest(req: Request): boolean {
  const proto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  return Boolean(req.secure || proto.includes('https'));
}

export function buildSessionCookieHeader(token: string, isHttps: boolean): string {
  const base = `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Max-Age=${DEFAULT_TTL_SECONDS}`;
  if (isHttps) {
    return `${base}; Secure; SameSite=None; Partitioned`;
  }
  return `${base}; SameSite=Lax`;
}

export function buildClearSessionCookieHeader(isHttps: boolean): string {
  const base = `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`;
  if (isHttps) {
    return `${base}; Secure; SameSite=None; Partitioned`;
  }
  return `${base}; SameSite=Lax`;
}
