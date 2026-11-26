import crypto from 'crypto';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

// Ephemeral in-memory fallback per process if SESSION_SECRET is not provided in env
const runtimeSessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

export const env = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  superAdminBootstrapSecret: process.env.SUPER_ADMIN_BOOTSTRAP_SECRET || '',
  superAdminEmail: (process.env.SUPER_ADMIN_EMAIL || 'reddox528@gmail.com').trim().toLowerCase(),
  sessionSecret: runtimeSessionSecret,
  dbPath: process.env.CLIPORA_DB_PATH || path.resolve(process.cwd(), 'data/clipora.db'),
  r2: {
    accountId: process.env.R2_ACCOUNT_ID || '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    bucketName: process.env.R2_BUCKET_NAME || '',
    publicUrl: process.env.R2_PUBLIC_URL || '',
  },
};

export function isR2Configured(): boolean {
  return Boolean(
    env.r2.accountId &&
      env.r2.accessKeyId &&
      env.r2.secretAccessKey &&
      env.r2.bucketName
  );
}

export function isGeminiConfigured(): boolean {
  return Boolean(env.geminiApiKey && env.geminiApiKey !== 'MY_GEMINI_API_KEY');
}
