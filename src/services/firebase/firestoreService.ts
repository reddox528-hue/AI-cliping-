import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  DEFAULT_AI_CONFIG,
  DEFAULT_LIMITS_CONFIG,
  type AIConfig,
  type AccountStatus,
  type AppNotification,
  type AuditLogRecord,
  type BrandKitRecord,
  type ClipRecord,
  type ExportRecord,
  type ProcessingJobRecord,
  type ProjectRecord,
  type SourceVideoRecord,
  type SystemLimitsConfig,
  type ThemePreference,
  type TranscriptRecord,
  type UsageRecord,
  type UserProfile,
  type UserRole,
} from '../../types/clipora';
import { auth, db, handleFirestoreError, OperationType } from './client';

export const BOOTSTRAP_OWNER_EMAIL = 'reddox528@gmail.com';
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export function makeId(prefix: string): string {
  const randomPart =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 14)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${Date.now()}_${randomPart}`;
}

function assertValidId(id: string, label: string): void {
  if (!ID_PATTERN.test(id)) {
    throw new Error(`Invalid ${label} identifier.`);
  }
}

function toIso(value: unknown): string {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return new Date().toISOString();
}

function mapUserDoc(data: Record<string, unknown>): UserProfile {
  return {
    uid: String(data.uid || ''),
    displayName: String(data.displayName || 'Creator'),
    email: String(data.email || ''),
    photoURL: data.photoURL ? String(data.photoURL) : undefined,
    role: (data.role as UserRole) || 'CUSTOMER',
    accountStatus: (data.accountStatus as AccountStatus) || 'PENDING',
    permissions: Array.isArray(data.permissions)
      ? (data.permissions as UserProfile['permissions'])
      : undefined,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    approvedAt: data.approvedAt ? toIso(data.approvedAt) : undefined,
    approvedBy: data.approvedBy ? String(data.approvedBy) : undefined,
    lastLoginAt: data.lastLoginAt ? toIso(data.lastLoginAt) : undefined,
    themePreference: (data.themePreference as ThemePreference) || 'system',
  };
}

export async function ensureUserProfile(params: {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  emailVerified: boolean;
}): Promise<UserProfile> {
  assertValidId(params.uid, 'uid');
  const path = `users/${params.uid}`;
  const ref = doc(db, 'users', params.uid);

  let existingSnap;
  try {
    existingSnap = await getDoc(ref);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }

  const isBootstrap =
    params.email.toLowerCase() === BOOTSTRAP_OWNER_EMAIL && params.emailVerified;

  if (!existingSnap.exists()) {
    const safeName = (params.displayName || params.email.split('@')[0] || 'Creator').slice(0, 120);
    const payload: Record<string, unknown> = {
      uid: params.uid,
      displayName: safeName,
      email: params.email.slice(0, 254),
      role: isBootstrap ? 'SUPER_ADMIN' : 'CUSTOMER',
      accountStatus: isBootstrap ? 'APPROVED' : 'PENDING',
      themePreference: 'system',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
    };
    if (params.photoURL) {
      payload.photoURL = params.photoURL.slice(0, 1024);
    }
    if (isBootstrap) {
      payload.approvedAt = serverTimestamp();
      payload.approvedBy = params.uid;
      payload.permissions = [
        'VIEW_DASHBOARD',
        'MANAGE_CUSTOMERS',
        'REVIEW_APPROVALS',
        'MONITOR_PROJECTS',
        'MANAGE_PROCESSING',
        'MONITOR_USAGE_STORAGE',
        'CREATE_ADMINS',
      ];
    }

    try {
      await setDoc(ref, payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }

    await createNotification({
      ownerId: params.uid,
      type: 'ACCOUNT_STATUS',
      title: isBootstrap ? 'Super Admin Workspace Ready' : 'Registration Received',
      message: isBootstrap
        ? 'Your bootstrap Super Admin account is active and approved.'
        : 'Your account has been registered and is awaiting administrator approval.',
    });

    await createAuditLog({
      actorId: params.uid,
      action: 'USER_REGISTERED',
      targetId: params.uid,
      metadata: { email: params.email, role: payload.role },
    });

    const fresh = await getDoc(ref);
    return mapUserDoc(fresh.data() as Record<string, unknown>);
  }

  const existing = mapUserDoc(existingSnap.data() as Record<string, unknown>);

  // Update lastLoginAt (and auto-elevate bootstrap owner if needed)
  try {
    if (isBootstrap && (existing.role !== 'SUPER_ADMIN' || existing.accountStatus !== 'APPROVED')) {
      await updateDoc(ref, {
        role: 'SUPER_ADMIN',
        accountStatus: 'APPROVED',
        permissions: [
          'VIEW_DASHBOARD',
          'MANAGE_CUSTOMERS',
          'REVIEW_APPROVALS',
          'MONITOR_PROJECTS',
          'MANAGE_PROCESSING',
          'MONITOR_USAGE_STORAGE',
          'CREATE_ADMINS',
        ],
        approvedAt: serverTimestamp(),
        approvedBy: params.uid,
        lastLoginAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        lastLoginAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    const updatedSnap = await getDoc(ref);
    return mapUserDoc(updatedSnap.data() as Record<string, unknown>);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function updateOwnProfile(
  uid: string,
  updates: { displayName?: string; photoURL?: string; themePreference?: ThemePreference }
): Promise<void> {
  assertValidId(uid, 'uid');
  const path = `users/${uid}`;
  const clean: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (updates.displayName !== undefined) {
    clean.displayName = updates.displayName.trim().slice(0, 120) || 'Creator';
  }
  if (updates.photoURL !== undefined) {
    clean.photoURL = updates.photoURL.slice(0, 1024);
  }
  if (updates.themePreference !== undefined) {
    clean.themePreference = updates.themePreference;
  }
  try {
    await updateDoc(doc(db, 'users', uid), clean);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function listAllUsers(): Promise<UserProfile[]> {
  try {
    const snap = await getDocs(collection(db, 'users'));
    return snap.docs.map((d) => mapUserDoc(d.data() as Record<string, unknown>));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'users');
  }
}

export async function adminUpdateUserAccount(params: {
  targetUid: string;
  actorUid: string;
  accountStatus?: AccountStatus;
  role?: UserRole;
}): Promise<void> {
  assertValidId(params.targetUid, 'targetUid');
  const path = `users/${params.targetUid}`;
  const patch: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (params.accountStatus) {
    patch.accountStatus = params.accountStatus;
    if (params.accountStatus === 'APPROVED') {
      patch.approvedAt = serverTimestamp();
      patch.approvedBy = params.actorUid;
    }
  }
  if (params.role) {
    patch.role = params.role;
  }

  try {
    await updateDoc(doc(db, 'users', params.targetUid), patch);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }

  if (params.accountStatus) {
    const statusMap: Record<AccountStatus, { title: string; message: string }> = {
      APPROVED: {
        title: 'Account Approved',
        message: 'Your REDDOX Clipora AI account has been approved. Full workspace access is now enabled.',
      },
      REJECTED: {
        title: 'Account Application Declined',
        message: 'Your account registration was declined by an administrator.',
      },
      SUSPENDED: {
        title: 'Account Suspended',
        message: 'Your account has been suspended by an administrator. Contact support for details.',
      },
      PENDING: {
        title: 'Account Under Review',
        message: 'Your account status was returned to pending administrator review.',
      },
    };
    const info = statusMap[params.accountStatus];
    await createNotification({
      ownerId: params.targetUid,
      type: 'ACCOUNT_STATUS',
      title: info.title,
      message: info.message,
    });
  }

  await createAuditLog({
    actorId: params.actorUid,
    action: params.role ? 'ADMIN_UPDATED_USER_ROLE' : `ADMIN_SET_STATUS_${params.accountStatus}`,
    targetId: params.targetUid,
    metadata: {
      ...(params.accountStatus ? { accountStatus: params.accountStatus } : {}),
      ...(params.role ? { role: params.role } : {}),
    },
  });
}

// ---------------------------------------------------------
// Projects
// ---------------------------------------------------------
export async function createProject(params: {
  ownerId: string;
  projectName: string;
}): Promise<ProjectRecord> {
  const projectId = makeId('proj');
  const cleanName = params.projectName.trim().slice(0, 160) || 'Untitled Video Project';
  const path = `projects/${projectId}`;
  try {
    await setDoc(doc(db, 'projects', projectId), {
      projectId,
      ownerId: params.ownerId,
      projectName: cleanName,
      status: 'DRAFT',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const snap = await getDoc(doc(db, 'projects', projectId));
    const d = snap.data() as Record<string, unknown>;
    return {
      projectId,
      ownerId: String(d.ownerId),
      projectName: String(d.projectName),
      sourceVideoId: d.sourceVideoId ? String(d.sourceVideoId) : undefined,
      status: d.status as ProjectRecord['status'],
      createdAt: toIso(d.createdAt),
      updatedAt: toIso(d.updatedAt),
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateProject(
  projectId: string,
  updates: Partial<Pick<ProjectRecord, 'projectName' | 'sourceVideoId' | 'status'>>
): Promise<void> {
  assertValidId(projectId, 'projectId');
  const patch: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (updates.projectName !== undefined) patch.projectName = updates.projectName.trim().slice(0, 160);
  if (updates.sourceVideoId !== undefined) patch.sourceVideoId = updates.sourceVideoId.slice(0, 128);
  if (updates.status !== undefined) patch.status = updates.status;

  try {
    await updateDoc(doc(db, 'projects', projectId), patch);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `projects/${projectId}`);
  }
}

export async function deleteProjectRecord(projectId: string): Promise<void> {
  assertValidId(projectId, 'projectId');
  try {
    await deleteDoc(doc(db, 'projects', projectId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `projects/${projectId}`);
  }
}

export async function listProjectsByOwner(ownerId: string): Promise<ProjectRecord[]> {
  try {
    const q = query(collection(db, 'projects'), where('ownerId', '==', ownerId));
    const snap = await getDocs(q);
    return snap.docs
      .map((docSnap) => {
        const d = docSnap.data() as Record<string, unknown>;
        return {
          projectId: String(d.projectId),
          ownerId: String(d.ownerId),
          projectName: String(d.projectName),
          sourceVideoId: d.sourceVideoId ? String(d.sourceVideoId) : undefined,
          status: d.status as ProjectRecord['status'],
          createdAt: toIso(d.createdAt),
          updatedAt: toIso(d.updatedAt),
        };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'projects');
  }
}

export async function listAllProjectsAdmin(): Promise<ProjectRecord[]> {
  try {
    const snap = await getDocs(collection(db, 'projects'));
    return snap.docs
      .map((docSnap) => {
        const d = docSnap.data() as Record<string, unknown>;
        return {
          projectId: String(d.projectId),
          ownerId: String(d.ownerId),
          projectName: String(d.projectName),
          sourceVideoId: d.sourceVideoId ? String(d.sourceVideoId) : undefined,
          status: d.status as ProjectRecord['status'],
          createdAt: toIso(d.createdAt),
          updatedAt: toIso(d.updatedAt),
        };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'projects');
  }
}

// ---------------------------------------------------------
// Source Videos
// ---------------------------------------------------------
export async function createSourceVideo(
  input: Omit<SourceVideoRecord, 'createdAt'>
): Promise<SourceVideoRecord> {
  assertValidId(input.videoId, 'videoId');
  const path = `sourceVideos/${input.videoId}`;
  try {
    await setDoc(doc(db, 'sourceVideos', input.videoId), {
      videoId: input.videoId,
      ownerId: input.ownerId,
      projectId: input.projectId,
      fileName: input.fileName.slice(0, 255),
      storagePath: input.storagePath.slice(0, 1024),
      duration: Number(input.duration.toFixed(2)),
      width: Math.round(input.width),
      height: Math.round(input.height),
      frameRate: Number(input.frameRate.toFixed(2)),
      fileSize: Math.round(input.fileSize),
      mimeType: input.mimeType.slice(0, 120),
      processingStatus: input.processingStatus,
      createdAt: serverTimestamp(),
    });
    return { ...input, createdAt: new Date().toISOString() };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateSourceVideo(
  videoId: string,
  updates: Partial<Pick<SourceVideoRecord, 'storagePath' | 'processingStatus'>>
): Promise<void> {
  assertValidId(videoId, 'videoId');
  try {
    await updateDoc(doc(db, 'sourceVideos', videoId), updates);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `sourceVideos/${videoId}`);
  }
}

export async function deleteSourceVideo(videoId: string): Promise<void> {
  assertValidId(videoId, 'videoId');
  try {
    await deleteDoc(doc(db, 'sourceVideos', videoId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `sourceVideos/${videoId}`);
  }
}

export async function listSourceVideosByOwner(ownerId: string): Promise<SourceVideoRecord[]> {
  try {
    const snap = await getDocs(
      query(collection(db, 'sourceVideos'), where('ownerId', '==', ownerId))
    );
    return snap.docs
      .map((docSnap) => {
        const d = docSnap.data() as Record<string, unknown>;
        return {
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
          processingStatus: d.processingStatus as SourceVideoRecord['processingStatus'],
          createdAt: toIso(d.createdAt),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'sourceVideos');
  }
}

export async function listAllSourceVideosAdmin(): Promise<SourceVideoRecord[]> {
  try {
    const snap = await getDocs(collection(db, 'sourceVideos'));
    return snap.docs.map((docSnap) => {
      const d = docSnap.data() as Record<string, unknown>;
      return {
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
        processingStatus: d.processingStatus as SourceVideoRecord['processingStatus'],
        createdAt: toIso(d.createdAt),
      };
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'sourceVideos');
  }
}

// ---------------------------------------------------------
// Processing Jobs
// ---------------------------------------------------------
export async function createProcessingJob(
  input: Omit<ProcessingJobRecord, 'createdAt' | 'updatedAt'>
): Promise<ProcessingJobRecord> {
  assertValidId(input.jobId, 'jobId');
  try {
    await setDoc(doc(db, 'processingJobs', input.jobId), {
      jobId: input.jobId,
      ownerId: input.ownerId,
      projectId: input.projectId,
      sourceVideoId: input.sourceVideoId,
      status: input.status,
      progress: Math.max(0, Math.min(100, Math.round(input.progress))),
      currentStage: input.currentStage.slice(0, 200),
      executionMode: input.executionMode,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const now = new Date().toISOString();
    return { ...input, createdAt: now, updatedAt: now };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `processingJobs/${input.jobId}`);
  }
}

export async function updateProcessingJob(
  jobId: string,
  updates: Partial<Pick<ProcessingJobRecord, 'status' | 'progress' | 'currentStage' | 'errorMessage'>> & {
    markCompleted?: boolean;
  }
): Promise<void> {
  assertValidId(jobId, 'jobId');
  const patch: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (updates.status !== undefined) patch.status = updates.status;
  if (updates.progress !== undefined) {
    patch.progress = Math.max(0, Math.min(100, Math.round(updates.progress)));
  }
  if (updates.currentStage !== undefined) patch.currentStage = updates.currentStage.slice(0, 200);
  if (updates.errorMessage !== undefined) patch.errorMessage = updates.errorMessage.slice(0, 1000);
  if (updates.markCompleted) patch.completedAt = serverTimestamp();

  try {
    await updateDoc(doc(db, 'processingJobs', jobId), patch);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `processingJobs/${jobId}`);
  }
}

export async function listProcessingJobsByOwner(ownerId: string): Promise<ProcessingJobRecord[]> {
  try {
    const snap = await getDocs(
      query(collection(db, 'processingJobs'), where('ownerId', '==', ownerId))
    );
    return snap.docs
      .map((docSnap) => {
        const d = docSnap.data() as Record<string, unknown>;
        return {
          jobId: String(d.jobId),
          ownerId: String(d.ownerId),
          projectId: String(d.projectId),
          sourceVideoId: String(d.sourceVideoId),
          status: d.status as ProcessingJobRecord['status'],
          progress: Number(d.progress || 0),
          currentStage: String(d.currentStage || ''),
          errorMessage: d.errorMessage ? String(d.errorMessage) : undefined,
          executionMode: (d.executionMode as 'BROWSER_LOCAL' | 'HYBRID_CLOUD') || 'BROWSER_LOCAL',
          createdAt: toIso(d.createdAt),
          updatedAt: toIso(d.updatedAt),
          completedAt: d.completedAt ? toIso(d.completedAt) : undefined,
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'processingJobs');
  }
}

export async function listAllProcessingJobsAdmin(): Promise<ProcessingJobRecord[]> {
  try {
    const snap = await getDocs(collection(db, 'processingJobs'));
    return snap.docs
      .map((docSnap) => {
        const d = docSnap.data() as Record<string, unknown>;
        return {
          jobId: String(d.jobId),
          ownerId: String(d.ownerId),
          projectId: String(d.projectId),
          sourceVideoId: String(d.sourceVideoId),
          status: d.status as ProcessingJobRecord['status'],
          progress: Number(d.progress || 0),
          currentStage: String(d.currentStage || ''),
          errorMessage: d.errorMessage ? String(d.errorMessage) : undefined,
          executionMode: (d.executionMode as 'BROWSER_LOCAL' | 'HYBRID_CLOUD') || 'BROWSER_LOCAL',
          createdAt: toIso(d.createdAt),
          updatedAt: toIso(d.updatedAt),
          completedAt: d.completedAt ? toIso(d.completedAt) : undefined,
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'processingJobs');
  }
}

// ---------------------------------------------------------
// Clips
// ---------------------------------------------------------
export async function createClipRecord(
  input: Omit<ClipRecord, 'createdAt' | 'updatedAt'>
): Promise<ClipRecord> {
  assertValidId(input.clipId, 'clipId');
  try {
    const payload: Record<string, unknown> = {
      clipId: input.clipId,
      ownerId: input.ownerId,
      projectId: input.projectId,
      sourceVideoId: input.sourceVideoId,
      startTime: Number(input.startTime.toFixed(2)),
      endTime: Number(input.endTime.toFixed(2)),
      duration: Number(Math.max(0.5, input.endTime - input.startTime).toFixed(2)),
      title: input.title.slice(0, 200),
      description: (input.description || '').slice(0, 1200),
      score: Math.max(0, Math.min(100, Math.round(input.score))),
      clipStoragePath: input.clipStoragePath.slice(0, 1024),
      aspectRatio: input.aspectRatio,
      status: input.status,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (input.hook) payload.hook = input.hook.slice(0, 400);
    if (input.topic) payload.topic = input.topic.slice(0, 120);
    if (input.reason) payload.reason = input.reason.slice(0, 800);

    await setDoc(doc(db, 'clips', input.clipId), payload);
    const now = new Date().toISOString();
    return { ...input, createdAt: now, updatedAt: now };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `clips/${input.clipId}`);
  }
}

export async function updateClipRecord(
  clipId: string,
  updates: Partial<
    Pick<
      ClipRecord,
      'startTime' | 'endTime' | 'duration' | 'title' | 'description' | 'clipStoragePath' | 'aspectRatio' | 'status'
    >
  >
): Promise<void> {
  assertValidId(clipId, 'clipId');
  const patch: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (updates.startTime !== undefined) patch.startTime = Number(updates.startTime.toFixed(2));
  if (updates.endTime !== undefined) patch.endTime = Number(updates.endTime.toFixed(2));
  if (updates.duration !== undefined) patch.duration = Number(updates.duration.toFixed(2));
  if (updates.title !== undefined) patch.title = updates.title.trim().slice(0, 200) || 'Clip';
  if (updates.description !== undefined) patch.description = updates.description.slice(0, 1200);
  if (updates.clipStoragePath !== undefined) patch.clipStoragePath = updates.clipStoragePath.slice(0, 1024);
  if (updates.aspectRatio !== undefined) patch.aspectRatio = updates.aspectRatio;
  if (updates.status !== undefined) patch.status = updates.status;

  try {
    await updateDoc(doc(db, 'clips', clipId), patch);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `clips/${clipId}`);
  }
}

export async function deleteClipRecord(clipId: string): Promise<void> {
  assertValidId(clipId, 'clipId');
  try {
    await deleteDoc(doc(db, 'clips', clipId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `clips/${clipId}`);
  }
}

export async function listClipsByOwner(ownerId: string): Promise<ClipRecord[]> {
  try {
    const snap = await getDocs(query(collection(db, 'clips'), where('ownerId', '==', ownerId)));
    return snap.docs
      .map((docSnap) => {
        const d = docSnap.data() as Record<string, unknown>;
        return {
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
          aspectRatio: (d.aspectRatio as ClipRecord['aspectRatio']) || '9:16',
          status: (d.status as ClipRecord['status']) || 'CANDIDATE',
          createdAt: toIso(d.createdAt),
          updatedAt: toIso(d.updatedAt),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'clips');
  }
}

export async function listAllClipsAdmin(): Promise<ClipRecord[]> {
  try {
    const snap = await getDocs(collection(db, 'clips'));
    return snap.docs
      .map((docSnap) => {
        const d = docSnap.data() as Record<string, unknown>;
        return {
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
          aspectRatio: (d.aspectRatio as ClipRecord['aspectRatio']) || '9:16',
          status: (d.status as ClipRecord['status']) || 'CANDIDATE',
          createdAt: toIso(d.createdAt),
          updatedAt: toIso(d.updatedAt),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'clips');
  }
}

// ---------------------------------------------------------
// Transcripts
// ---------------------------------------------------------
export async function saveTranscriptRecord(
  input: Omit<TranscriptRecord, 'createdAt'>
): Promise<TranscriptRecord> {
  assertValidId(input.transcriptId, 'transcriptId');
  try {
    await setDoc(doc(db, 'transcripts', input.transcriptId), {
      transcriptId: input.transcriptId,
      ownerId: input.ownerId,
      projectId: input.projectId,
      sourceVideoId: input.sourceVideoId,
      language: input.language.slice(0, 32),
      transcriptText: input.transcriptText.slice(0, 200000),
      timestampGranularity: input.timestampGranularity,
      timestampedSegments: input.timestampedSegments.slice(0, 1000),
      createdAt: serverTimestamp(),
    });
    return { ...input, createdAt: new Date().toISOString() };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `transcripts/${input.transcriptId}`);
  }
}

export async function updateTranscriptSegments(
  transcriptId: string,
  segments: TranscriptRecord['timestampedSegments'],
  transcriptText: string
): Promise<void> {
  assertValidId(transcriptId, 'transcriptId');
  try {
    await updateDoc(doc(db, 'transcripts', transcriptId), {
      timestampedSegments: segments.slice(0, 1000),
      transcriptText: transcriptText.slice(0, 200000),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `transcripts/${transcriptId}`);
  }
}

export async function listTranscriptsByOwner(ownerId: string): Promise<TranscriptRecord[]> {
  try {
    const snap = await getDocs(
      query(collection(db, 'transcripts'), where('ownerId', '==', ownerId))
    );
    return snap.docs.map((docSnap) => {
      const d = docSnap.data() as Record<string, unknown>;
      return {
        transcriptId: String(d.transcriptId),
        ownerId: String(d.ownerId),
        projectId: String(d.projectId),
        sourceVideoId: String(d.sourceVideoId),
        language: String(d.language || 'en'),
        transcriptText: String(d.transcriptText || ''),
        timestampGranularity:
          (d.timestampGranularity as TranscriptRecord['timestampGranularity']) || 'SEGMENT',
        timestampedSegments: Array.isArray(d.timestampedSegments)
          ? (d.timestampedSegments as TranscriptRecord['timestampedSegments'])
          : [],
        createdAt: toIso(d.createdAt),
      };
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'transcripts');
  }
}

// ---------------------------------------------------------
// Exports
// ---------------------------------------------------------
export async function createExportRecord(
  input: Omit<ExportRecord, 'createdAt'>
): Promise<ExportRecord> {
  assertValidId(input.exportId, 'exportId');
  const payload: Record<string, unknown> = {
    exportId: input.exportId,
    ownerId: input.ownerId,
    clipId: input.clipId,
    format: input.format,
    resolution: input.resolution,
    aspectRatio: input.aspectRatio,
    storagePath: input.storagePath.slice(0, 1024),
    fileSize: Math.max(0, Math.round(input.fileSize)),
    status: input.status,
    createdAt: serverTimestamp(),
  };
  if (input.errorMessage) payload.errorMessage = input.errorMessage.slice(0, 1000);

  try {
    await setDoc(doc(db, 'exports', input.exportId), payload);
    return { ...input, createdAt: new Date().toISOString() };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `exports/${input.exportId}`);
  }
}

export async function updateExportRecord(
  exportId: string,
  updates: Partial<Pick<ExportRecord, 'storagePath' | 'fileSize' | 'status' | 'errorMessage'>>
): Promise<void> {
  assertValidId(exportId, 'exportId');
  const patch: Record<string, unknown> = {};
  if (updates.storagePath !== undefined) patch.storagePath = updates.storagePath.slice(0, 1024);
  if (updates.fileSize !== undefined) patch.fileSize = Math.max(0, Math.round(updates.fileSize));
  if (updates.status !== undefined) patch.status = updates.status;
  if (updates.errorMessage !== undefined) patch.errorMessage = updates.errorMessage.slice(0, 1000);

  try {
    await updateDoc(doc(db, 'exports', exportId), patch);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `exports/${exportId}`);
  }
}

export async function listExportsByOwner(ownerId: string): Promise<ExportRecord[]> {
  try {
    const snap = await getDocs(
      query(collection(db, 'exports'), where('ownerId', '==', ownerId))
    );
    return snap.docs
      .map((docSnap) => {
        const d = docSnap.data() as Record<string, unknown>;
        return {
          exportId: String(d.exportId),
          ownerId: String(d.ownerId),
          clipId: String(d.clipId),
          format: 'MP4' as const,
          resolution: (d.resolution as ExportRecord['resolution']) || '1080p',
          aspectRatio: (d.aspectRatio as ExportRecord['aspectRatio']) || '9:16',
          storagePath: String(d.storagePath || ''),
          fileSize: Number(d.fileSize || 0),
          status: (d.status as ExportRecord['status']) || 'RENDERING',
          errorMessage: d.errorMessage ? String(d.errorMessage) : undefined,
          createdAt: toIso(d.createdAt),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'exports');
  }
}

export async function listAllExportsAdmin(): Promise<ExportRecord[]> {
  try {
    const snap = await getDocs(collection(db, 'exports'));
    return snap.docs.map((docSnap) => {
      const d = docSnap.data() as Record<string, unknown>;
      return {
        exportId: String(d.exportId),
        ownerId: String(d.ownerId),
        clipId: String(d.clipId),
        format: 'MP4' as const,
        resolution: (d.resolution as ExportRecord['resolution']) || '1080p',
        aspectRatio: (d.aspectRatio as ExportRecord['aspectRatio']) || '9:16',
        storagePath: String(d.storagePath || ''),
        fileSize: Number(d.fileSize || 0),
        status: (d.status as ExportRecord['status']) || 'RENDERING',
        errorMessage: d.errorMessage ? String(d.errorMessage) : undefined,
        createdAt: toIso(d.createdAt),
      };
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'exports');
  }
}

// ---------------------------------------------------------
// Brand Kits
// ---------------------------------------------------------
export async function saveBrandKit(
  input: Omit<BrandKitRecord, 'createdAt' | 'updatedAt'>,
  isNew: boolean
): Promise<BrandKitRecord> {
  assertValidId(input.brandKitId, 'brandKitId');
  const path = `brandKits/${input.brandKitId}`;
  try {
    if (isNew) {
      await setDoc(doc(db, 'brandKits', input.brandKitId), {
        brandKitId: input.brandKitId,
        ownerId: input.ownerId,
        name: input.name.slice(0, 120),
        logoPath: input.logoPath.slice(0, 1024),
        primaryColor: input.primaryColor.slice(0, 32),
        secondaryColor: input.secondaryColor.slice(0, 32),
        captionSettings: input.captionSettings,
        watermarkSettings: input.watermarkSettings,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(doc(db, 'brandKits', input.brandKitId), {
        name: input.name.slice(0, 120),
        logoPath: input.logoPath.slice(0, 1024),
        primaryColor: input.primaryColor.slice(0, 32),
        secondaryColor: input.secondaryColor.slice(0, 32),
        captionSettings: input.captionSettings,
        watermarkSettings: input.watermarkSettings,
        updatedAt: serverTimestamp(),
      });
    }
    const now = new Date().toISOString();
    return { ...input, createdAt: now, updatedAt: now };
  } catch (err) {
    handleFirestoreError(err, isNew ? OperationType.CREATE : OperationType.UPDATE, path);
  }
}

export async function listBrandKitsByOwner(ownerId: string): Promise<BrandKitRecord[]> {
  try {
    const snap = await getDocs(
      query(collection(db, 'brandKits'), where('ownerId', '==', ownerId))
    );
    return snap.docs.map((docSnap) => {
      const d = docSnap.data() as Record<string, unknown>;
      return {
        brandKitId: String(d.brandKitId),
        ownerId: String(d.ownerId),
        name: String(d.name),
        logoPath: String(d.logoPath || ''),
        primaryColor: String(d.primaryColor || '#2563EB'),
        secondaryColor: String(d.secondaryColor || '#7C3AED'),
        captionSettings: d.captionSettings as BrandKitRecord['captionSettings'],
        watermarkSettings: d.watermarkSettings as BrandKitRecord['watermarkSettings'],
        createdAt: toIso(d.createdAt),
        updatedAt: toIso(d.updatedAt),
      };
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'brandKits');
  }
}

export async function deleteBrandKit(brandKitId: string): Promise<void> {
  assertValidId(brandKitId, 'brandKitId');
  try {
    await deleteDoc(doc(db, 'brandKits', brandKitId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `brandKits/${brandKitId}`);
  }
}

// ---------------------------------------------------------
// Usage Records
// ---------------------------------------------------------
export async function recordUsage(params: {
  ownerId: string;
  operation: string;
  resourceType: UsageRecord['resourceType'];
  resourceAmount: number;
}): Promise<void> {
  const recordId = makeId('usg');
  try {
    await setDoc(doc(db, 'usageRecords', recordId), {
      recordId,
      ownerId: params.ownerId,
      operation: params.operation.slice(0, 80),
      resourceType: params.resourceType,
      resourceAmount: Math.max(0, Number(params.resourceAmount)),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `usageRecords/${recordId}`);
  }
}

export async function listUsageByOwner(ownerId: string): Promise<UsageRecord[]> {
  try {
    const snap = await getDocs(
      query(collection(db, 'usageRecords'), where('ownerId', '==', ownerId))
    );
    return snap.docs.map((docSnap) => {
      const d = docSnap.data() as Record<string, unknown>;
      return {
        recordId: String(d.recordId),
        ownerId: String(d.ownerId),
        operation: String(d.operation),
        resourceType: d.resourceType as UsageRecord['resourceType'],
        resourceAmount: Number(d.resourceAmount || 0),
        createdAt: toIso(d.createdAt),
      };
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'usageRecords');
  }
}

// ---------------------------------------------------------
// System Settings
// ---------------------------------------------------------
export async function getSystemSettings(): Promise<{
  limits: SystemLimitsConfig;
  aiConfig: AIConfig;
}> {
  try {
    const [limitsSnap, aiSnap] = await Promise.all([
      getDoc(doc(db, 'systemSettings', 'limits')),
      getDoc(doc(db, 'systemSettings', 'aiConfig')),
    ]);
    const limits = limitsSnap.exists()
      ? ({ ...DEFAULT_LIMITS_CONFIG, ...(limitsSnap.data().settingValue as Partial<SystemLimitsConfig>) })
      : DEFAULT_LIMITS_CONFIG;
    const aiConfig = aiSnap.exists()
      ? ({ ...DEFAULT_AI_CONFIG, ...(aiSnap.data().settingValue as Partial<AIConfig>) })
      : DEFAULT_AI_CONFIG;
    return { limits, aiConfig };
  } catch {
    return { limits: DEFAULT_LIMITS_CONFIG, aiConfig: DEFAULT_AI_CONFIG };
  }
}

export async function saveSystemSetting(params: {
  settingId: 'limits' | 'aiConfig';
  settingValue: Record<string, unknown>;
  updatedBy: string;
}): Promise<void> {
  assertValidId(params.settingId, 'settingId');
  const path = `systemSettings/${params.settingId}`;
  try {
    await setDoc(doc(db, 'systemSettings', params.settingId), {
      settingId: params.settingId,
      settingValue: params.settingValue,
      updatedAt: serverTimestamp(),
      updatedBy: params.updatedBy,
    });
    await createAuditLog({
      actorId: params.updatedBy,
      action: `UPDATED_SETTING_${params.settingId.toUpperCase()}`,
      targetId: params.settingId,
      metadata: params.settingValue,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

// ---------------------------------------------------------
// Audit Logs & Notifications
// ---------------------------------------------------------
export async function createAuditLog(params: {
  actorId: string;
  action: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!auth.currentUser) return;
  const logId = makeId('log');
  try {
    await setDoc(doc(db, 'auditLogs', logId), {
      logId,
      actorId: params.actorId,
      action: params.action.slice(0, 120),
      targetId: params.targetId.slice(0, 128),
      timestamp: serverTimestamp(),
      metadata: params.metadata || {},
    });
  } catch (err) {
    // Non-fatal if audit log write denied for unapproved state
    console.warn('Audit log write skipped:', err);
  }
}

export async function listAuditLogsAdmin(): Promise<AuditLogRecord[]> {
  try {
    const q = query(collection(db, 'auditLogs'), orderBy('timestamp', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((docSnap) => {
      const d = docSnap.data() as Record<string, unknown>;
      return {
        logId: String(d.logId),
        actorId: String(d.actorId),
        action: String(d.action),
        targetId: String(d.targetId),
        timestamp: toIso(d.timestamp),
        metadata: (d.metadata as Record<string, unknown>) || {},
      };
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'auditLogs');
  }
}

export async function createNotification(params: {
  ownerId: string;
  type: AppNotification['type'];
  title: string;
  message: string;
}): Promise<void> {
  if (!auth.currentUser) return;
  const notificationId = makeId('notif');
  try {
    await setDoc(doc(db, 'notifications', notificationId), {
      notificationId,
      ownerId: params.ownerId,
      type: params.type,
      title: params.title.slice(0, 160),
      message: params.message.slice(0, 500),
      read: false,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('Notification creation skipped:', err);
  }
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  assertValidId(notificationId, 'notificationId');
  try {
    await updateDoc(doc(db, 'notifications', notificationId), { read: true });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `notifications/${notificationId}`);
  }
}
