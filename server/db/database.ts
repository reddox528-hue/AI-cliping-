import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { env } from '../config/env.ts';
import {
  ALL_ADMIN_PERMISSIONS,
  normalizePermissions,
  type AccountStatus,
  type AdminPermission,
  type UserRole,
} from '../security/rbac.ts';

export interface StoredUserRow {
  uid: string;
  displayName: string;
  email: string;
  passwordHash: string;
  photoURL?: string;
  role: UserRole;
  accountStatus: AccountStatus;
  permissions: AdminPermission[];
  themePreference: 'light' | 'dark' | 'system';
  approvedAt?: string;
  approvedBy?: string;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type PublicUserRecord = Omit<StoredUserRow, 'passwordHash'>;

export const DEFAULT_LIMITS_SETTING = {
  maxFileSizeMb: 500,
  maxVideoDurationSec: 3600,
  maxProjectsPerUser: 25,
  maxConcurrentBrowserJobs: 1,
  dailyAiRequestAllowance: 30,
  storageAllowanceMb: 1024,
  allow1080pExport: true,
};

export const DEFAULT_AI_SETTING = {
  modelId: 'gemini-4-hydrogen',
  maxClipsPerRun: 5,
  defaultMinClipSec: 15,
  defaultMaxClipSec: 60,
  analysisInstructions:
    'Prioritize standalone insights, compelling hooks, clear explanations, and complete stories with clean openings and closings.',
  prioritizeHooks: true,
};

function safeParseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toPublicUser(row: StoredUserRow): PublicUserRecord {
  const { passwordHash: _ignored, ...pub } = row;
  return pub;
}

function mapRawUserRow(r: Record<string, unknown>): StoredUserRow {
  const role =
    r.role === 'SUPER_ADMIN' || r.role === 'ADMIN' || r.role === 'CUSTOMER'
      ? (r.role as UserRole)
      : 'CUSTOMER';
  const accountStatus =
    r.accountStatus === 'APPROVED' ||
    r.accountStatus === 'PENDING' ||
    r.accountStatus === 'REJECTED' ||
    r.accountStatus === 'SUSPENDED'
      ? (r.accountStatus as AccountStatus)
      : 'PENDING';
  const rawPerms = safeParseJson<unknown[]>(r.permissionsJson, []);
  const permissions =
    role === 'SUPER_ADMIN' ? [...ALL_ADMIN_PERMISSIONS] : normalizePermissions(rawPerms);

  return {
    uid: String(r.uid),
    displayName: String(r.displayName || 'Creator'),
    email: String(r.email || '').toLowerCase(),
    passwordHash: String(r.passwordHash || ''),
    photoURL: typeof r.photoURL === 'string' && r.photoURL ? r.photoURL : undefined,
    role,
    accountStatus,
    permissions,
    themePreference:
      r.themePreference === 'light' || r.themePreference === 'dark' ? r.themePreference : 'system',
    approvedAt: typeof r.approvedAt === 'string' && r.approvedAt ? r.approvedAt : undefined,
    approvedBy: typeof r.approvedBy === 'string' && r.approvedBy ? r.approvedBy : undefined,
    lastLoginAt: typeof r.lastLoginAt === 'string' && r.lastLoginAt ? r.lastLoginAt : undefined,
    createdAt: String(r.createdAt || ''),
    updatedAt: String(r.updatedAt || ''),
  };
}

export class CliporaDatabase {
  public readonly sqlite: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    this.sqlite = new DatabaseSync(dbPath);
    if (dbPath !== ':memory:') {
      this.sqlite.exec('PRAGMA journal_mode = WAL;');
    }
    this.sqlite.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
    this.seedDefaults();
  }

  private migrate(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS users (
        uid TEXT PRIMARY KEY,
        displayName TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        passwordHash TEXT NOT NULL,
        photoURL TEXT,
        role TEXT NOT NULL DEFAULT 'CUSTOMER',
        accountStatus TEXT NOT NULL DEFAULT 'PENDING',
        permissionsJson TEXT NOT NULL DEFAULT '[]',
        themePreference TEXT NOT NULL DEFAULT 'system',
        approvedAt TEXT,
        approvedBy TEXT,
        lastLoginAt TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        projectId TEXT PRIMARY KEY,
        ownerId TEXT NOT NULL,
        projectName TEXT NOT NULL,
        sourceVideoId TEXT,
        status TEXT NOT NULL DEFAULT 'DRAFT',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS source_videos (
        videoId TEXT PRIMARY KEY,
        ownerId TEXT NOT NULL,
        projectId TEXT NOT NULL,
        fileName TEXT NOT NULL,
        storagePath TEXT NOT NULL,
        duration REAL NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        frameRate REAL NOT NULL,
        fileSize INTEGER NOT NULL,
        mimeType TEXT NOT NULL,
        processingStatus TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS processing_jobs (
        jobId TEXT PRIMARY KEY,
        ownerId TEXT NOT NULL,
        projectId TEXT NOT NULL,
        sourceVideoId TEXT NOT NULL,
        status TEXT NOT NULL,
        progress INTEGER NOT NULL,
        currentStage TEXT NOT NULL,
        errorMessage TEXT,
        executionMode TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        completedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS clips (
        clipId TEXT PRIMARY KEY,
        ownerId TEXT NOT NULL,
        projectId TEXT NOT NULL,
        sourceVideoId TEXT NOT NULL,
        startTime REAL NOT NULL,
        endTime REAL NOT NULL,
        duration REAL NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        hook TEXT,
        topic TEXT,
        reason TEXT,
        score INTEGER NOT NULL,
        clipStoragePath TEXT NOT NULL,
        aspectRatio TEXT NOT NULL,
        status TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS transcripts (
        transcriptId TEXT PRIMARY KEY,
        ownerId TEXT NOT NULL,
        projectId TEXT NOT NULL,
        sourceVideoId TEXT NOT NULL,
        language TEXT NOT NULL,
        transcriptText TEXT NOT NULL,
        timestampGranularity TEXT NOT NULL,
        timestampedSegmentsJson TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS exports (
        exportId TEXT PRIMARY KEY,
        ownerId TEXT NOT NULL,
        clipId TEXT NOT NULL,
        format TEXT NOT NULL,
        resolution TEXT NOT NULL,
        aspectRatio TEXT NOT NULL,
        storagePath TEXT NOT NULL,
        fileSize INTEGER NOT NULL,
        status TEXT NOT NULL,
        errorMessage TEXT,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS brand_kits (
        brandKitId TEXT PRIMARY KEY,
        ownerId TEXT NOT NULL,
        name TEXT NOT NULL,
        logoPath TEXT NOT NULL,
        primaryColor TEXT NOT NULL,
        secondaryColor TEXT NOT NULL,
        captionSettingsJson TEXT NOT NULL,
        watermarkSettingsJson TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS usage_records (
        recordId TEXT PRIMARY KEY,
        ownerId TEXT NOT NULL,
        operation TEXT NOT NULL,
        resourceType TEXT NOT NULL,
        resourceAmount REAL NOT NULL,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS system_settings (
        settingId TEXT PRIMARY KEY,
        settingValueJson TEXT NOT NULL,
        updatedBy TEXT,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        logId TEXT PRIMARY KEY,
        actorId TEXT NOT NULL,
        action TEXT NOT NULL,
        targetId TEXT NOT NULL,
        metadataJson TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS notifications (
        notificationId TEXT PRIMARY KEY,
        ownerId TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        read INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS contact_inquiries (
        inquiryId TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        topic TEXT NOT NULL,
        message TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(ownerId);
      CREATE INDEX IF NOT EXISTS idx_videos_owner ON source_videos(ownerId);
      CREATE INDEX IF NOT EXISTS idx_jobs_owner ON processing_jobs(ownerId);
      CREATE INDEX IF NOT EXISTS idx_clips_owner ON clips(ownerId);
      CREATE INDEX IF NOT EXISTS idx_transcripts_owner ON transcripts(ownerId);
      CREATE INDEX IF NOT EXISTS idx_exports_owner ON exports(ownerId);
      CREATE INDEX IF NOT EXISTS idx_brandkits_owner ON brand_kits(ownerId);
      CREATE INDEX IF NOT EXISTS idx_usage_owner ON usage_records(ownerId);
      CREATE INDEX IF NOT EXISTS idx_notifications_owner ON notifications(ownerId);
    `);
  }

  private seedDefaults(): void {
    const now = new Date().toISOString();
    const stmt = this.sqlite.prepare(
      'INSERT OR IGNORE INTO system_settings (settingId, settingValueJson, updatedBy, updatedAt) VALUES (?, ?, ?, ?)'
    );
    stmt.run('limits', JSON.stringify(DEFAULT_LIMITS_SETTING), 'system', now);
    stmt.run('aiConfig', JSON.stringify(DEFAULT_AI_SETTING), 'system', now);
  }

  public close(): void {
    this.sqlite.close();
  }

  // -------------------------------------------------------
  // Users
  // -------------------------------------------------------
  public getUserAuthByUid(uid: string): StoredUserRow | null {
    const row = this.sqlite
      .prepare('SELECT * FROM users WHERE uid = ? LIMIT 1')
      .get(uid) as Record<string, unknown> | undefined;
    return row ? mapRawUserRow(row) : null;
  }

  public getUserAuthByEmail(email: string): StoredUserRow | null {
    const normalized = email.trim().toLowerCase();
    const row = this.sqlite
      .prepare('SELECT * FROM users WHERE email = ? LIMIT 1')
      .get(normalized) as Record<string, unknown> | undefined;
    return row ? mapRawUserRow(row) : null;
  }

  public getPublicUserByUid(uid: string): PublicUserRecord | null {
    const u = this.getUserAuthByUid(uid);
    return u ? toPublicUser(u) : null;
  }

  public listUsersPublic(): PublicUserRecord[] {
    const rows = this.sqlite
      .prepare('SELECT * FROM users ORDER BY createdAt DESC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => toPublicUser(mapRawUserRow(r)));
  }

  public hasSuperAdmin(): boolean {
    const row = this.sqlite
      .prepare("SELECT uid FROM users WHERE role = 'SUPER_ADMIN' LIMIT 1")
      .get() as Record<string, unknown> | undefined;
    if (row) return true;
    const initSetting = this.getSystemSetting('superAdminInit');
    return Boolean(initSetting && initSetting.initialized);
  }

  public createUser(params: {
    uid: string;
    displayName: string;
    email: string;
    passwordHash: string;
    role?: UserRole;
    accountStatus?: AccountStatus;
    permissions?: AdminPermission[];
    approvedBy?: string;
    approvedAt?: string;
    themePreference?: 'light' | 'dark' | 'system';
  }): PublicUserRecord {
    const now = new Date().toISOString();
    const role: UserRole = params.role || 'CUSTOMER';
    const accountStatus: AccountStatus = params.accountStatus || 'PENDING';
    const permissions =
      role === 'SUPER_ADMIN'
        ? [...ALL_ADMIN_PERMISSIONS]
        : role === 'ADMIN'
        ? normalizePermissions(params.permissions)
        : [];

    this.sqlite
      .prepare(
        `INSERT INTO users (
          uid, displayName, email, passwordHash, photoURL, role, accountStatus,
          permissionsJson, themePreference, approvedAt, approvedBy, lastLoginAt, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        params.uid,
        params.displayName.trim().slice(0, 120) || 'Creator',
        params.email.trim().toLowerCase().slice(0, 254),
        params.passwordHash,
        null,
        role,
        accountStatus,
        JSON.stringify(permissions),
        params.themePreference || 'system',
        params.approvedAt || (accountStatus === 'APPROVED' ? now : null),
        params.approvedBy || null,
        now,
        now,
        now
      );

    return this.getPublicUserByUid(params.uid)!;
  }

  public updateUserProfile(
    uid: string,
    updates: { displayName?: string; photoURL?: string; themePreference?: 'light' | 'dark' | 'system' }
  ): PublicUserRecord | null {
    const current = this.getUserAuthByUid(uid);
    if (!current) return null;
    const now = new Date().toISOString();
    this.sqlite
      .prepare(
        'UPDATE users SET displayName = ?, photoURL = ?, themePreference = ?, updatedAt = ? WHERE uid = ?'
      )
      .run(
        updates.displayName !== undefined
          ? updates.displayName.trim().slice(0, 120) || current.displayName
          : current.displayName,
        updates.photoURL !== undefined ? updates.photoURL.slice(0, 1024) : current.photoURL ?? null,
        updates.themePreference !== undefined ? updates.themePreference : current.themePreference,
        now,
        uid
      );
    return this.getPublicUserByUid(uid);
  }

  public updateUserPasswordHash(uid: string, passwordHash: string): void {
    this.sqlite
      .prepare('UPDATE users SET passwordHash = ?, updatedAt = ? WHERE uid = ?')
      .run(passwordHash, new Date().toISOString(), uid);
  }

  public touchUserLogin(uid: string): void {
    const now = new Date().toISOString();
    this.sqlite
      .prepare('UPDATE users SET lastLoginAt = ?, updatedAt = ? WHERE uid = ?')
      .run(now, now, uid);
  }

  public updateUserAdminFields(
    uid: string,
    fields: {
      role?: UserRole;
      accountStatus?: AccountStatus;
      permissions?: AdminPermission[];
      approvedBy?: string;
    }
  ): PublicUserRecord | null {
    const current = this.getUserAuthByUid(uid);
    if (!current) return null;
    const now = new Date().toISOString();
    const nextRole = fields.role ?? current.role;
    const nextStatus = fields.accountStatus ?? current.accountStatus;
    const nextPermissions =
      nextRole === 'SUPER_ADMIN'
        ? [...ALL_ADMIN_PERMISSIONS]
        : nextRole === 'CUSTOMER'
        ? []
        : fields.permissions !== undefined
        ? normalizePermissions(fields.permissions)
        : current.permissions;
    const nextApprovedAt =
      fields.accountStatus === 'APPROVED' ? now : current.approvedAt ?? null;
    const nextApprovedBy =
      fields.approvedBy !== undefined ? fields.approvedBy : current.approvedBy ?? null;

    this.sqlite
      .prepare(
        `UPDATE users
         SET role = ?, accountStatus = ?, permissionsJson = ?, approvedAt = ?, approvedBy = ?, updatedAt = ?
         WHERE uid = ?`
      )
      .run(
        nextRole,
        nextStatus,
        JSON.stringify(nextPermissions),
        nextApprovedAt,
        nextApprovedBy,
        now,
        uid
      );

    return this.getPublicUserByUid(uid);
  }

  public deleteUser(uid: string): void {
    this.sqlite.prepare('DELETE FROM users WHERE uid = ?').run(uid);
  }

  // -------------------------------------------------------
  // System Settings
  // -------------------------------------------------------
  public getSystemSetting(settingId: string): Record<string, unknown> | null {
    const row = this.sqlite
      .prepare('SELECT settingValueJson FROM system_settings WHERE settingId = ? LIMIT 1')
      .get(settingId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return safeParseJson<Record<string, unknown> | null>(row.settingValueJson, null);
  }

  public setSystemSetting(
    settingId: string,
    settingValue: Record<string, unknown>,
    updatedBy: string
  ): void {
    const now = new Date().toISOString();
    this.sqlite
      .prepare(
        `INSERT INTO system_settings (settingId, settingValueJson, updatedBy, updatedAt)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(settingId) DO UPDATE SET
           settingValueJson = excluded.settingValueJson,
           updatedBy = excluded.updatedBy,
           updatedAt = excluded.updatedAt`
      )
      .run(settingId, JSON.stringify(settingValue), updatedBy, now);
  }

  // -------------------------------------------------------
  // Audit Logs
  // -------------------------------------------------------
  public insertAuditLog(entry: {
    logId: string;
    actorId: string;
    action: string;
    targetId: string;
    metadata: Record<string, unknown>;
    timestamp: string;
  }): void {
    this.sqlite
      .prepare(
        'INSERT INTO audit_logs (logId, actorId, action, targetId, metadataJson, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(
        entry.logId,
        entry.actorId.slice(0, 128),
        entry.action.slice(0, 120),
        entry.targetId.slice(0, 128),
        JSON.stringify(entry.metadata || {}),
        entry.timestamp
      );
  }

  public listAuditLogs(limit = 250): Array<{
    logId: string;
    actorId: string;
    action: string;
    targetId: string;
    timestamp: string;
    metadata: Record<string, unknown>;
  }> {
    const rows = this.sqlite
      .prepare('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ?')
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      logId: String(r.logId),
      actorId: String(r.actorId),
      action: String(r.action),
      targetId: String(r.targetId),
      timestamp: String(r.timestamp),
      metadata: safeParseJson<Record<string, unknown>>(r.metadataJson, {}),
    }));
  }

  // -------------------------------------------------------
  // Notifications
  // -------------------------------------------------------
  public createNotification(input: {
    notificationId?: string;
    ownerId: string;
    type: string;
    title: string;
    message: string;
  }): void {
    const id = input.notificationId || `notif_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();
    this.sqlite
      .prepare(
        'INSERT INTO notifications (notificationId, ownerId, type, title, message, read, createdAt) VALUES (?, ?, ?, ?, ?, 0, ?)'
      )
      .run(id, input.ownerId, input.type, input.title.slice(0, 160), input.message.slice(0, 500), now);
  }

  public listNotificationsByOwner(ownerId: string): Array<Record<string, unknown>> {
    const rows = this.sqlite
      .prepare('SELECT * FROM notifications WHERE ownerId = ? ORDER BY createdAt DESC LIMIT 50')
      .all(ownerId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      notificationId: String(r.notificationId),
      ownerId: String(r.ownerId),
      type: String(r.type),
      title: String(r.title),
      message: String(r.message),
      read: Boolean(r.read),
      createdAt: String(r.createdAt),
    }));
  }

  public markNotificationRead(notificationId: string, ownerId: string): boolean {
    const res = this.sqlite
      .prepare('UPDATE notifications SET read = 1 WHERE notificationId = ? AND ownerId = ?')
      .run(notificationId, ownerId);
    return Number(res.changes) > 0;
  }

  // -------------------------------------------------------
  // Projects
  // -------------------------------------------------------
  public createProject(input: { projectId: string; ownerId: string; projectName: string }) {
    const now = new Date().toISOString();
    const cleanName = input.projectName.trim().slice(0, 160) || 'Untitled Video Project';
    this.sqlite
      .prepare(
        'INSERT INTO projects (projectId, ownerId, projectName, sourceVideoId, status, createdAt, updatedAt) VALUES (?, ?, ?, NULL, ?, ?, ?)'
      )
      .run(input.projectId, input.ownerId, cleanName, 'DRAFT', now, now);
    return {
      projectId: input.projectId,
      ownerId: input.ownerId,
      projectName: cleanName,
      status: 'DRAFT',
      createdAt: now,
      updatedAt: now,
    };
  }

  public updateProject(
    projectId: string,
    ownerId: string,
    updates: { projectName?: string; sourceVideoId?: string; status?: string }
  ): boolean {
    const existing = this.sqlite
      .prepare('SELECT * FROM projects WHERE projectId = ? AND ownerId = ? LIMIT 1')
      .get(projectId, ownerId) as Record<string, unknown> | undefined;
    if (!existing) return false;
    const now = new Date().toISOString();
    this.sqlite
      .prepare(
        'UPDATE projects SET projectName = ?, sourceVideoId = ?, status = ?, updatedAt = ? WHERE projectId = ? AND ownerId = ?'
      )
      .run(
        updates.projectName !== undefined
          ? updates.projectName.trim().slice(0, 160) || String(existing.projectName)
          : String(existing.projectName),
        updates.sourceVideoId !== undefined
          ? updates.sourceVideoId.slice(0, 128)
          : (existing.sourceVideoId as string | null),
        updates.status !== undefined ? updates.status : String(existing.status),
        now,
        projectId,
        ownerId
      );
    return true;
  }

  public deleteProject(projectId: string, ownerId: string): boolean {
    const res = this.sqlite
      .prepare('DELETE FROM projects WHERE projectId = ? AND ownerId = ?')
      .run(projectId, ownerId);
    return Number(res.changes) > 0;
  }

  public listProjects(ownerId?: string): Array<Record<string, unknown>> {
    const rows = ownerId
      ? (this.sqlite
          .prepare('SELECT * FROM projects WHERE ownerId = ? ORDER BY updatedAt DESC')
          .all(ownerId) as Array<Record<string, unknown>>)
      : (this.sqlite
          .prepare('SELECT * FROM projects ORDER BY updatedAt DESC LIMIT 500')
          .all() as Array<Record<string, unknown>>);
    return rows.map((d) => ({
      projectId: String(d.projectId),
      ownerId: String(d.ownerId),
      projectName: String(d.projectName),
      sourceVideoId: d.sourceVideoId ? String(d.sourceVideoId) : undefined,
      status: String(d.status),
      createdAt: String(d.createdAt),
      updatedAt: String(d.updatedAt),
    }));
  }

  // -------------------------------------------------------
  // Source Videos
  // -------------------------------------------------------
  public createSourceVideo(input: Record<string, unknown>) {
    const now = new Date().toISOString();
    this.sqlite
      .prepare(
        `INSERT INTO source_videos (
          videoId, ownerId, projectId, fileName, storagePath, duration, width, height, frameRate, fileSize, mimeType, processingStatus, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        String(input.videoId),
        String(input.ownerId),
        String(input.projectId),
        String(input.fileName).slice(0, 255),
        String(input.storagePath).slice(0, 1024),
        Number(Number(input.duration || 0).toFixed(2)),
        Math.round(Number(input.width || 0)),
        Math.round(Number(input.height || 0)),
        Number(Number(input.frameRate || 30).toFixed(2)),
        Math.round(Number(input.fileSize || 0)),
        String(input.mimeType || 'video/mp4').slice(0, 120),
        String(input.processingStatus || 'LOCAL_READY'),
        now
      );
    return { ...input, createdAt: now };
  }

  public updateSourceVideo(
    videoId: string,
    ownerId: string,
    updates: { storagePath?: string; processingStatus?: string }
  ): boolean {
    const existing = this.sqlite
      .prepare('SELECT * FROM source_videos WHERE videoId = ? AND ownerId = ? LIMIT 1')
      .get(videoId, ownerId) as Record<string, unknown> | undefined;
    if (!existing) return false;
    this.sqlite
      .prepare(
        'UPDATE source_videos SET storagePath = ?, processingStatus = ? WHERE videoId = ? AND ownerId = ?'
      )
      .run(
        updates.storagePath !== undefined ? updates.storagePath.slice(0, 1024) : String(existing.storagePath),
        updates.processingStatus !== undefined ? updates.processingStatus : String(existing.processingStatus),
        videoId,
        ownerId
      );
    return true;
  }

  public deleteSourceVideo(videoId: string, ownerId: string): boolean {
    const res = this.sqlite
      .prepare('DELETE FROM source_videos WHERE videoId = ? AND ownerId = ?')
      .run(videoId, ownerId);
    return Number(res.changes) > 0;
  }

  public listSourceVideos(ownerId?: string): Array<Record<string, unknown>> {
    const rows = ownerId
      ? (this.sqlite
          .prepare('SELECT * FROM source_videos WHERE ownerId = ? ORDER BY createdAt DESC')
          .all(ownerId) as Array<Record<string, unknown>>)
      : (this.sqlite
          .prepare('SELECT * FROM source_videos ORDER BY createdAt DESC LIMIT 500')
          .all() as Array<Record<string, unknown>>);
    return rows.map((d) => ({
      videoId: String(d.videoId),
      ownerId: String(d.ownerId),
      projectId: String(d.projectId),
      fileName: String(d.fileName),
      storagePath: String(d.storagePath),
      duration: Number(d.duration || 0),
      width: Number(d.width || 0),
      height: Number(d.height || 0),
      frameRate: Number(d.frameRate || 30),
      fileSize: Number(d.fileSize || 0),
      mimeType: String(d.mimeType),
      processingStatus: String(d.processingStatus),
      createdAt: String(d.createdAt),
    }));
  }

  // -------------------------------------------------------
  // Processing Jobs
  // -------------------------------------------------------
  public createProcessingJob(input: Record<string, unknown>) {
    const now = new Date().toISOString();
    const progress = Math.max(0, Math.min(100, Math.round(Number(input.progress || 0))));
    this.sqlite
      .prepare(
        `INSERT INTO processing_jobs (
          jobId, ownerId, projectId, sourceVideoId, status, progress, currentStage, errorMessage, executionMode, createdAt, updatedAt, completedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL)`
      )
      .run(
        String(input.jobId),
        String(input.ownerId),
        String(input.projectId),
        String(input.sourceVideoId),
        String(input.status || 'QUEUED'),
        progress,
        String(input.currentStage || '').slice(0, 200),
        String(input.executionMode || 'BROWSER_LOCAL'),
        now,
        now
      );
    return { ...input, progress, createdAt: now, updatedAt: now };
  }

  public updateProcessingJob(
    jobId: string,
    ownerId: string | null,
    updates: {
      status?: string;
      progress?: number;
      currentStage?: string;
      errorMessage?: string;
      markCompleted?: boolean;
    }
  ): boolean {
    const existing = ownerId
      ? (this.sqlite
          .prepare('SELECT * FROM processing_jobs WHERE jobId = ? AND ownerId = ? LIMIT 1')
          .get(jobId, ownerId) as Record<string, unknown> | undefined)
      : (this.sqlite
          .prepare('SELECT * FROM processing_jobs WHERE jobId = ? LIMIT 1')
          .get(jobId) as Record<string, unknown> | undefined);
    if (!existing) return false;
    const now = new Date().toISOString();
    this.sqlite
      .prepare(
        `UPDATE processing_jobs
         SET status = ?, progress = ?, currentStage = ?, errorMessage = ?, updatedAt = ?, completedAt = ?
         WHERE jobId = ?`
      )
      .run(
        updates.status !== undefined ? updates.status : String(existing.status),
        updates.progress !== undefined
          ? Math.max(0, Math.min(100, Math.round(updates.progress)))
          : Number(existing.progress),
        updates.currentStage !== undefined
          ? updates.currentStage.slice(0, 200)
          : String(existing.currentStage || ''),
        updates.errorMessage !== undefined
          ? updates.errorMessage.slice(0, 1000)
          : (existing.errorMessage as string | null),
        now,
        updates.markCompleted ? now : (existing.completedAt as string | null),
        jobId
      );
    return true;
  }

  public listProcessingJobs(ownerId?: string): Array<Record<string, unknown>> {
    const rows = ownerId
      ? (this.sqlite
          .prepare('SELECT * FROM processing_jobs WHERE ownerId = ? ORDER BY createdAt DESC')
          .all(ownerId) as Array<Record<string, unknown>>)
      : (this.sqlite
          .prepare('SELECT * FROM processing_jobs ORDER BY createdAt DESC LIMIT 500')
          .all() as Array<Record<string, unknown>>);
    return rows.map((d) => ({
      jobId: String(d.jobId),
      ownerId: String(d.ownerId),
      projectId: String(d.projectId),
      sourceVideoId: String(d.sourceVideoId),
      status: String(d.status),
      progress: Number(d.progress || 0),
      currentStage: String(d.currentStage || ''),
      errorMessage: d.errorMessage ? String(d.errorMessage) : undefined,
      executionMode: String(d.executionMode || 'BROWSER_LOCAL'),
      createdAt: String(d.createdAt),
      updatedAt: String(d.updatedAt),
      completedAt: d.completedAt ? String(d.completedAt) : undefined,
    }));
  }

  // -------------------------------------------------------
  // Clips
  // -------------------------------------------------------
  public createClip(input: Record<string, unknown>) {
    const now = new Date().toISOString();
    const startTime = Number(Number(input.startTime || 0).toFixed(2));
    const endTime = Number(Number(input.endTime || 0).toFixed(2));
    const duration = Number(Math.max(0.5, endTime - startTime).toFixed(2));
    this.sqlite
      .prepare(
        `INSERT INTO clips (
          clipId, ownerId, projectId, sourceVideoId, startTime, endTime, duration,
          title, description, hook, topic, reason, score, clipStoragePath, aspectRatio, status, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        String(input.clipId),
        String(input.ownerId),
        String(input.projectId),
        String(input.sourceVideoId),
        startTime,
        endTime,
        duration,
        String(input.title || 'Clip').slice(0, 200),
        String(input.description || '').slice(0, 1200),
        input.hook ? String(input.hook).slice(0, 400) : null,
        input.topic ? String(input.topic).slice(0, 120) : null,
        input.reason ? String(input.reason).slice(0, 800) : null,
        Math.max(0, Math.min(100, Math.round(Number(input.score || 0)))),
        String(input.clipStoragePath || '').slice(0, 1024),
        String(input.aspectRatio || '9:16'),
        String(input.status || 'CANDIDATE'),
        now,
        now
      );
    return { ...input, startTime, endTime, duration, createdAt: now, updatedAt: now };
  }

  public updateClip(clipId: string, ownerId: string, updates: Record<string, unknown>): boolean {
    const existing = this.sqlite
      .prepare('SELECT * FROM clips WHERE clipId = ? AND ownerId = ? LIMIT 1')
      .get(clipId, ownerId) as Record<string, unknown> | undefined;
    if (!existing) return false;
    const now = new Date().toISOString();
    this.sqlite
      .prepare(
        `UPDATE clips
         SET startTime = ?, endTime = ?, duration = ?, title = ?, description = ?,
             clipStoragePath = ?, aspectRatio = ?, status = ?, updatedAt = ?
         WHERE clipId = ? AND ownerId = ?`
      )
      .run(
        updates.startTime !== undefined ? Number(Number(updates.startTime).toFixed(2)) : Number(existing.startTime),
        updates.endTime !== undefined ? Number(Number(updates.endTime).toFixed(2)) : Number(existing.endTime),
        updates.duration !== undefined ? Number(Number(updates.duration).toFixed(2)) : Number(existing.duration),
        updates.title !== undefined
          ? String(updates.title).trim().slice(0, 200) || 'Clip'
          : String(existing.title),
        updates.description !== undefined
          ? String(updates.description).slice(0, 1200)
          : String(existing.description),
        updates.clipStoragePath !== undefined
          ? String(updates.clipStoragePath).slice(0, 1024)
          : String(existing.clipStoragePath),
        updates.aspectRatio !== undefined ? String(updates.aspectRatio) : String(existing.aspectRatio),
        updates.status !== undefined ? String(updates.status) : String(existing.status),
        now,
        clipId,
        ownerId
      );
    return true;
  }

  public deleteClip(clipId: string, ownerId: string): boolean {
    const res = this.sqlite
      .prepare('DELETE FROM clips WHERE clipId = ? AND ownerId = ?')
      .run(clipId, ownerId);
    return Number(res.changes) > 0;
  }

  public listClips(ownerId?: string): Array<Record<string, unknown>> {
    const rows = ownerId
      ? (this.sqlite
          .prepare('SELECT * FROM clips WHERE ownerId = ? ORDER BY createdAt DESC')
          .all(ownerId) as Array<Record<string, unknown>>)
      : (this.sqlite
          .prepare('SELECT * FROM clips ORDER BY createdAt DESC LIMIT 500')
          .all() as Array<Record<string, unknown>>);
    return rows.map((d) => ({
      clipId: String(d.clipId),
      ownerId: String(d.ownerId),
      projectId: String(d.projectId),
      sourceVideoId: String(d.sourceVideoId),
      startTime: Number(d.startTime || 0),
      endTime: Number(d.endTime || 0),
      duration: Number(d.duration || 0),
      title: String(d.title || 'Clip'),
      description: String(d.description || ''),
      hook: d.hook ? String(d.hook) : undefined,
      topic: d.topic ? String(d.topic) : undefined,
      reason: d.reason ? String(d.reason) : undefined,
      score: Number(d.score || 0),
      clipStoragePath: String(d.clipStoragePath || ''),
      aspectRatio: String(d.aspectRatio || '9:16'),
      status: String(d.status || 'CANDIDATE'),
      createdAt: String(d.createdAt),
      updatedAt: String(d.updatedAt),
    }));
  }

  // -------------------------------------------------------
  // Transcripts
  // -------------------------------------------------------
  public saveTranscript(input: Record<string, unknown>) {
    const now = new Date().toISOString();
    const segments = Array.isArray(input.timestampedSegments)
      ? input.timestampedSegments.slice(0, 1000)
      : [];
    this.sqlite
      .prepare(
        `INSERT INTO transcripts (
          transcriptId, ownerId, projectId, sourceVideoId, language, transcriptText, timestampGranularity, timestampedSegmentsJson, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(transcriptId) DO UPDATE SET
          transcriptText = excluded.transcriptText,
          timestampedSegmentsJson = excluded.timestampedSegmentsJson`
      )
      .run(
        String(input.transcriptId),
        String(input.ownerId),
        String(input.projectId),
        String(input.sourceVideoId),
        String(input.language || 'en').slice(0, 32),
        String(input.transcriptText || '').slice(0, 200000),
        String(input.timestampGranularity || 'SEGMENT'),
        JSON.stringify(segments),
        now
      );
    return { ...input, timestampedSegments: segments, createdAt: now };
  }

  public updateTranscriptSegments(
    transcriptId: string,
    ownerId: string,
    segments: unknown[],
    transcriptText: string
  ): boolean {
    const res = this.sqlite
      .prepare(
        'UPDATE transcripts SET timestampedSegmentsJson = ?, transcriptText = ? WHERE transcriptId = ? AND ownerId = ?'
      )
      .run(
        JSON.stringify(segments.slice(0, 1000)),
        transcriptText.slice(0, 200000),
        transcriptId,
        ownerId
      );
    return Number(res.changes) > 0;
  }

  public listTranscriptsByOwner(ownerId: string): Array<Record<string, unknown>> {
    const rows = this.sqlite
      .prepare('SELECT * FROM transcripts WHERE ownerId = ? ORDER BY createdAt DESC')
      .all(ownerId) as Array<Record<string, unknown>>;
    return rows.map((d) => ({
      transcriptId: String(d.transcriptId),
      ownerId: String(d.ownerId),
      projectId: String(d.projectId),
      sourceVideoId: String(d.sourceVideoId),
      language: String(d.language || 'en'),
      transcriptText: String(d.transcriptText || ''),
      timestampGranularity: String(d.timestampGranularity || 'SEGMENT'),
      timestampedSegments: safeParseJson<unknown[]>(d.timestampedSegmentsJson, []),
      createdAt: String(d.createdAt),
    }));
  }

  // -------------------------------------------------------
  // Exports
  // -------------------------------------------------------
  public createExport(input: Record<string, unknown>) {
    const now = new Date().toISOString();
    this.sqlite
      .prepare(
        `INSERT INTO exports (
          exportId, ownerId, clipId, format, resolution, aspectRatio, storagePath, fileSize, status, errorMessage, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        String(input.exportId),
        String(input.ownerId),
        String(input.clipId),
        'MP4',
        String(input.resolution || '1080p'),
        String(input.aspectRatio || '9:16'),
        String(input.storagePath || '').slice(0, 1024),
        Math.max(0, Math.round(Number(input.fileSize || 0))),
        String(input.status || 'RENDERING'),
        input.errorMessage ? String(input.errorMessage).slice(0, 1000) : null,
        now
      );
    return { ...input, createdAt: now };
  }

  public updateExport(exportId: string, ownerId: string, updates: Record<string, unknown>): boolean {
    const existing = this.sqlite
      .prepare('SELECT * FROM exports WHERE exportId = ? AND ownerId = ? LIMIT 1')
      .get(exportId, ownerId) as Record<string, unknown> | undefined;
    if (!existing) return false;
    this.sqlite
      .prepare(
        'UPDATE exports SET storagePath = ?, fileSize = ?, status = ?, errorMessage = ? WHERE exportId = ? AND ownerId = ?'
      )
      .run(
        updates.storagePath !== undefined ? String(updates.storagePath).slice(0, 1024) : String(existing.storagePath),
        updates.fileSize !== undefined ? Math.max(0, Math.round(Number(updates.fileSize))) : Number(existing.fileSize),
        updates.status !== undefined ? String(updates.status) : String(existing.status),
        updates.errorMessage !== undefined
          ? String(updates.errorMessage).slice(0, 1000)
          : (existing.errorMessage as string | null),
        exportId,
        ownerId
      );
    return true;
  }

  public listExports(ownerId?: string): Array<Record<string, unknown>> {
    const rows = ownerId
      ? (this.sqlite
          .prepare('SELECT * FROM exports WHERE ownerId = ? ORDER BY createdAt DESC')
          .all(ownerId) as Array<Record<string, unknown>>)
      : (this.sqlite
          .prepare('SELECT * FROM exports ORDER BY createdAt DESC LIMIT 500')
          .all() as Array<Record<string, unknown>>);
    return rows.map((d) => ({
      exportId: String(d.exportId),
      ownerId: String(d.ownerId),
      clipId: String(d.clipId),
      format: 'MP4',
      resolution: String(d.resolution || '1080p'),
      aspectRatio: String(d.aspectRatio || '9:16'),
      storagePath: String(d.storagePath || ''),
      fileSize: Number(d.fileSize || 0),
      status: String(d.status || 'RENDERING'),
      errorMessage: d.errorMessage ? String(d.errorMessage) : undefined,
      createdAt: String(d.createdAt),
    }));
  }

  // -------------------------------------------------------
  // Brand Kits
  // -------------------------------------------------------
  public saveBrandKit(input: Record<string, unknown>, ownerId: string) {
    const now = new Date().toISOString();
    const existing = this.sqlite
      .prepare('SELECT ownerId, createdAt FROM brand_kits WHERE brandKitId = ? LIMIT 1')
      .get(String(input.brandKitId)) as Record<string, unknown> | undefined;
    if (existing && String(existing.ownerId) !== ownerId) {
      throw new Error('Forbidden');
    }
    this.sqlite
      .prepare(
        `INSERT INTO brand_kits (
          brandKitId, ownerId, name, logoPath, primaryColor, secondaryColor, captionSettingsJson, watermarkSettingsJson, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(brandKitId) DO UPDATE SET
          name = excluded.name,
          logoPath = excluded.logoPath,
          primaryColor = excluded.primaryColor,
          secondaryColor = excluded.secondaryColor,
          captionSettingsJson = excluded.captionSettingsJson,
          watermarkSettingsJson = excluded.watermarkSettingsJson,
          updatedAt = excluded.updatedAt`
      )
      .run(
        String(input.brandKitId),
        ownerId,
        String(input.name || 'Brand Kit').slice(0, 120),
        String(input.logoPath || '').slice(0, 1024),
        String(input.primaryColor || '#2563EB').slice(0, 32),
        String(input.secondaryColor || '#7C3AED').slice(0, 32),
        JSON.stringify(input.captionSettings || {}),
        JSON.stringify(input.watermarkSettings || {}),
        existing ? String(existing.createdAt) : now,
        now
      );
    return { ...input, ownerId, createdAt: existing ? String(existing.createdAt) : now, updatedAt: now };
  }

  public listBrandKitsByOwner(ownerId: string): Array<Record<string, unknown>> {
    const rows = this.sqlite
      .prepare('SELECT * FROM brand_kits WHERE ownerId = ? ORDER BY updatedAt DESC')
      .all(ownerId) as Array<Record<string, unknown>>;
    return rows.map((d) => ({
      brandKitId: String(d.brandKitId),
      ownerId: String(d.ownerId),
      name: String(d.name),
      logoPath: String(d.logoPath || ''),
      primaryColor: String(d.primaryColor || '#2563EB'),
      secondaryColor: String(d.secondaryColor || '#7C3AED'),
      captionSettings: safeParseJson<Record<string, unknown>>(d.captionSettingsJson, {}),
      watermarkSettings: safeParseJson<Record<string, unknown>>(d.watermarkSettingsJson, {}),
      createdAt: String(d.createdAt),
      updatedAt: String(d.updatedAt),
    }));
  }

  public deleteBrandKit(brandKitId: string, ownerId: string): boolean {
    const res = this.sqlite
      .prepare('DELETE FROM brand_kits WHERE brandKitId = ? AND ownerId = ?')
      .run(brandKitId, ownerId);
    return Number(res.changes) > 0;
  }

  // -------------------------------------------------------
  // Usage Records
  // -------------------------------------------------------
  public recordUsage(input: {
    recordId?: string;
    ownerId: string;
    operation: string;
    resourceType: string;
    resourceAmount: number;
  }): void {
    const id = input.recordId || `usg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();
    this.sqlite
      .prepare(
        'INSERT INTO usage_records (recordId, ownerId, operation, resourceType, resourceAmount, createdAt) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(
        id,
        input.ownerId,
        input.operation.slice(0, 80),
        input.resourceType,
        Math.max(0, Number(input.resourceAmount)),
        now
      );
  }

  public listUsageRecords(ownerId?: string): Array<Record<string, unknown>> {
    const rows = ownerId
      ? (this.sqlite
          .prepare('SELECT * FROM usage_records WHERE ownerId = ? ORDER BY createdAt DESC')
          .all(ownerId) as Array<Record<string, unknown>>)
      : (this.sqlite
          .prepare('SELECT * FROM usage_records ORDER BY createdAt DESC LIMIT 1000')
          .all() as Array<Record<string, unknown>>);
    return rows.map((d) => ({
      recordId: String(d.recordId),
      ownerId: String(d.ownerId),
      operation: String(d.operation),
      resourceType: String(d.resourceType),
      resourceAmount: Number(d.resourceAmount || 0),
      createdAt: String(d.createdAt),
    }));
  }

  public createContactInquiry(input: {
    name: string;
    email: string;
    topic: string;
    message: string;
  }): { inquiryId: string; createdAt: string } {
    const inquiryId = `inq_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const createdAt = new Date().toISOString();
    this.sqlite
      .prepare(
        'INSERT INTO contact_inquiries (inquiryId, name, email, topic, message, createdAt) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(
        inquiryId,
        input.name.trim().slice(0, 120),
        input.email.trim().toLowerCase().slice(0, 254),
        input.topic.trim().slice(0, 120),
        input.message.trim().slice(0, 2000),
        createdAt
      );
    return { inquiryId, createdAt };
  }

  public listContactInquiries(limit = 100): Array<{
    inquiryId: string;
    name: string;
    email: string;
    topic: string;
    message: string;
    createdAt: string;
  }> {
    const rows = this.sqlite
      .prepare('SELECT * FROM contact_inquiries ORDER BY createdAt DESC LIMIT ?')
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      inquiryId: String(r.inquiryId),
      name: String(r.name),
      email: String(r.email),
      topic: String(r.topic),
      message: String(r.message),
      createdAt: String(r.createdAt),
    }));
  }
}

let sharedDb: CliporaDatabase | null = null;

export function getDatabase(): CliporaDatabase {
  if (!sharedDb) {
    sharedDb = new CliporaDatabase(env.dbPath);
  }
  return sharedDb;
}

export function createCliporaDatabase(dbPath = ':memory:'): CliporaDatabase {
  return new CliporaDatabase(dbPath);
}
