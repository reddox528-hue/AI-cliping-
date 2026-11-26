import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

interface FirebaseAppletConfig {
  projectId?: string;
  firestoreDatabaseId?: string;
  apiKey?: string;
}

let firebaseConfig: FirebaseAppletConfig = {};
try {
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as FirebaseAppletConfig;
  }
} catch {
  firebaseConfig = {};
}

export const env = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  superAdminBootstrapSecret: process.env.SUPER_ADMIN_BOOTSTRAP_SECRET || '',
  superAdminEmail: (process.env.SUPER_ADMIN_EMAIL || 'reddox528@gmail.com').trim().toLowerCase(),
  firebaseProjectId: firebaseConfig.projectId || process.env.FIREBASE_PROJECT_ID || '',
  firebaseDatabaseId: firebaseConfig.firestoreDatabaseId || process.env.FIREBASE_DATABASE_ID || '(default)',
  firebaseApiKey: firebaseConfig.apiKey || process.env.FIREBASE_API_KEY || '',
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
