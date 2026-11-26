import crypto from 'crypto';
import { Router, type Response } from 'express';
import { getDatabase, type CliporaDatabase } from '../db/database.ts';
import { createAuthMiddleware, type AuthenticatedRequest } from '../middleware/auth.ts';

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

function isValidId(id: string): boolean {
  return VALID_ID_REGEX.test(id);
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
}

export function createWorkspaceApiRouter(dbOverride?: CliporaDatabase) {
  const router = Router();
  const resolveDb = () => dbOverride ?? getDatabase();
  const { requireAuth, requireApprovedUser } = createAuthMiddleware(dbOverride);

  // Settings & notifications are readable by any signed-in user (including PENDING status gate)
  router.get('/settings', requireAuth, (_req: AuthenticatedRequest, res: Response) => {
    const db = resolveDb();
    res.json({
      limits: db.getSystemSetting('limits'),
      aiConfig: db.getSystemSetting('aiConfig'),
    });
  });

  router.get('/notifications', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const db = resolveDb();
    res.json({ notifications: db.listNotificationsByOwner(req.auth!.uid) });
  });

  router.post('/notifications', requireAuth, requireApprovedUser, (req: AuthenticatedRequest, res: Response) => {
    const db = resolveDb();
    const type = typeof req.body?.type === 'string' ? req.body.type : 'ACCOUNT_STATUS';
    const title = typeof req.body?.title === 'string' ? req.body.title : '';
    const message = typeof req.body?.message === 'string' ? req.body.message : '';
    if (!title.trim() || !message.trim()) {
      res.status(400).json({ error: 'Notification title and message are required.' });
      return;
    }
    db.createNotification({
      ownerId: req.auth!.uid,
      type,
      title,
      message,
    });
    res.status(201).json({ ok: true });
  });

  router.post('/notifications/:id/read', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const db = resolveDb();
    const id = String(req.params.id || '');
    if (!isValidId(id)) {
      res.status(400).json({ error: 'Invalid notification ID.' });
      return;
    }
    const ok = db.markNotificationRead(id, req.auth!.uid);
    if (!ok) {
      res.status(404).json({ error: 'Notification not found.' });
      return;
    }
    res.json({ ok: true });
  });

  // All studio workspace data requires APPROVED status
  router.use(requireAuth, requireApprovedUser);

  // Projects
  router.get('/projects', (req: AuthenticatedRequest, res: Response) => {
    res.json({ projects: resolveDb().listProjects(req.auth!.uid) });
  });

  router.post('/projects', (req: AuthenticatedRequest, res: Response) => {
    const projectName = typeof req.body?.projectName === 'string' ? req.body.projectName : 'Untitled Video Project';
    const projectId =
      typeof req.body?.projectId === 'string' && isValidId(req.body.projectId)
        ? req.body.projectId
        : makeId('proj');
    const created = resolveDb().createProject({
      projectId,
      ownerId: req.auth!.uid,
      projectName,
    });
    res.status(201).json({ project: created });
  });

  router.patch('/projects/:projectId', (req: AuthenticatedRequest, res: Response) => {
    const projectId = String(req.params.projectId || '');
    if (!isValidId(projectId)) {
      res.status(400).json({ error: 'Invalid projectId.' });
      return;
    }
    const updated = resolveDb().updateProject(projectId, req.auth!.uid, {
      projectName: typeof req.body?.projectName === 'string' ? req.body.projectName : undefined,
      sourceVideoId: typeof req.body?.sourceVideoId === 'string' ? req.body.sourceVideoId : undefined,
      status: typeof req.body?.status === 'string' ? req.body.status : undefined,
    });
    if (!updated) {
      res.status(404).json({ error: 'Project not found or access denied.' });
      return;
    }
    res.json({ ok: true });
  });

  router.delete('/projects/:projectId', (req: AuthenticatedRequest, res: Response) => {
    const projectId = String(req.params.projectId || '');
    if (!isValidId(projectId)) {
      res.status(400).json({ error: 'Invalid projectId.' });
      return;
    }
    const deleted = resolveDb().deleteProject(projectId, req.auth!.uid);
    if (!deleted) {
      res.status(404).json({ error: 'Project not found or access denied.' });
      return;
    }
    res.json({ ok: true });
  });

  // Source Videos
  router.get('/videos', (req: AuthenticatedRequest, res: Response) => {
    res.json({ videos: resolveDb().listSourceVideos(req.auth!.uid) });
  });

  router.post('/videos', (req: AuthenticatedRequest, res: Response) => {
    const videoId =
      typeof req.body?.videoId === 'string' && isValidId(req.body.videoId)
        ? req.body.videoId
        : makeId('vid');
    const created = resolveDb().createSourceVideo({
      ...req.body,
      videoId,
      ownerId: req.auth!.uid,
    });
    res.status(201).json({ video: created });
  });

  router.patch('/videos/:videoId', (req: AuthenticatedRequest, res: Response) => {
    const videoId = String(req.params.videoId || '');
    if (!isValidId(videoId)) {
      res.status(400).json({ error: 'Invalid videoId.' });
      return;
    }
    const updated = resolveDb().updateSourceVideo(videoId, req.auth!.uid, {
      storagePath: typeof req.body?.storagePath === 'string' ? req.body.storagePath : undefined,
      processingStatus: typeof req.body?.processingStatus === 'string' ? req.body.processingStatus : undefined,
    });
    if (!updated) {
      res.status(404).json({ error: 'Video not found or access denied.' });
      return;
    }
    res.json({ ok: true });
  });

  router.delete('/videos/:videoId', (req: AuthenticatedRequest, res: Response) => {
    const videoId = String(req.params.videoId || '');
    if (!isValidId(videoId)) {
      res.status(400).json({ error: 'Invalid videoId.' });
      return;
    }
    const deleted = resolveDb().deleteSourceVideo(videoId, req.auth!.uid);
    if (!deleted) {
      res.status(404).json({ error: 'Video not found or access denied.' });
      return;
    }
    res.json({ ok: true });
  });

  // Processing Jobs
  router.get('/jobs', (req: AuthenticatedRequest, res: Response) => {
    res.json({ jobs: resolveDb().listProcessingJobs(req.auth!.uid) });
  });

  router.post('/jobs', (req: AuthenticatedRequest, res: Response) => {
    const jobId =
      typeof req.body?.jobId === 'string' && isValidId(req.body.jobId)
        ? req.body.jobId
        : makeId('job');
    const created = resolveDb().createProcessingJob({
      ...req.body,
      jobId,
      ownerId: req.auth!.uid,
    });
    res.status(201).json({ job: created });
  });

  router.patch('/jobs/:jobId', (req: AuthenticatedRequest, res: Response) => {
    const jobId = String(req.params.jobId || '');
    if (!isValidId(jobId)) {
      res.status(400).json({ error: 'Invalid jobId.' });
      return;
    }
    const updated = resolveDb().updateProcessingJob(jobId, req.auth!.uid, {
      status: typeof req.body?.status === 'string' ? req.body.status : undefined,
      progress: typeof req.body?.progress === 'number' ? req.body.progress : undefined,
      currentStage: typeof req.body?.currentStage === 'string' ? req.body.currentStage : undefined,
      errorMessage: typeof req.body?.errorMessage === 'string' ? req.body.errorMessage : undefined,
      markCompleted: Boolean(req.body?.markCompleted),
    });
    if (!updated) {
      res.status(404).json({ error: 'Processing job not found or access denied.' });
      return;
    }
    res.json({ ok: true });
  });

  // Clips
  router.get('/clips', (req: AuthenticatedRequest, res: Response) => {
    res.json({ clips: resolveDb().listClips(req.auth!.uid) });
  });

  router.post('/clips', (req: AuthenticatedRequest, res: Response) => {
    const clipId =
      typeof req.body?.clipId === 'string' && isValidId(req.body.clipId)
        ? req.body.clipId
        : makeId('clip');
    const created = resolveDb().createClip({
      ...req.body,
      clipId,
      ownerId: req.auth!.uid,
    });
    res.status(201).json({ clip: created });
  });

  router.patch('/clips/:clipId', (req: AuthenticatedRequest, res: Response) => {
    const clipId = String(req.params.clipId || '');
    if (!isValidId(clipId)) {
      res.status(400).json({ error: 'Invalid clipId.' });
      return;
    }
    const updated = resolveDb().updateClip(clipId, req.auth!.uid, req.body || {});
    if (!updated) {
      res.status(404).json({ error: 'Clip not found or access denied.' });
      return;
    }
    res.json({ ok: true });
  });

  router.delete('/clips/:clipId', (req: AuthenticatedRequest, res: Response) => {
    const clipId = String(req.params.clipId || '');
    if (!isValidId(clipId)) {
      res.status(400).json({ error: 'Invalid clipId.' });
      return;
    }
    const deleted = resolveDb().deleteClip(clipId, req.auth!.uid);
    if (!deleted) {
      res.status(404).json({ error: 'Clip not found or access denied.' });
      return;
    }
    res.json({ ok: true });
  });

  // Transcripts
  router.get('/transcripts', (req: AuthenticatedRequest, res: Response) => {
    res.json({ transcripts: resolveDb().listTranscriptsByOwner(req.auth!.uid) });
  });

  router.post('/transcripts', (req: AuthenticatedRequest, res: Response) => {
    const transcriptId =
      typeof req.body?.transcriptId === 'string' && isValidId(req.body.transcriptId)
        ? req.body.transcriptId
        : makeId('tr');
    const saved = resolveDb().saveTranscript({
      ...req.body,
      transcriptId,
      ownerId: req.auth!.uid,
    });
    res.status(201).json({ transcript: saved });
  });

  router.patch('/transcripts/:transcriptId', (req: AuthenticatedRequest, res: Response) => {
    const transcriptId = String(req.params.transcriptId || '');
    if (!isValidId(transcriptId)) {
      res.status(400).json({ error: 'Invalid transcriptId.' });
      return;
    }
    const segments = Array.isArray(req.body?.timestampedSegments) ? req.body.timestampedSegments : [];
    const transcriptText = typeof req.body?.transcriptText === 'string' ? req.body.transcriptText : '';
    const updated = resolveDb().updateTranscriptSegments(
      transcriptId,
      req.auth!.uid,
      segments,
      transcriptText
    );
    if (!updated) {
      res.status(404).json({ error: 'Transcript not found or access denied.' });
      return;
    }
    res.json({ ok: true });
  });

  // Exports
  router.get('/exports', (req: AuthenticatedRequest, res: Response) => {
    res.json({ exports: resolveDb().listExports(req.auth!.uid) });
  });

  router.post('/exports', (req: AuthenticatedRequest, res: Response) => {
    const exportId =
      typeof req.body?.exportId === 'string' && isValidId(req.body.exportId)
        ? req.body.exportId
        : makeId('exp');
    const created = resolveDb().createExport({
      ...req.body,
      exportId,
      ownerId: req.auth!.uid,
    });
    res.status(201).json({ exportRecord: created });
  });

  router.patch('/exports/:exportId', (req: AuthenticatedRequest, res: Response) => {
    const exportId = String(req.params.exportId || '');
    if (!isValidId(exportId)) {
      res.status(400).json({ error: 'Invalid exportId.' });
      return;
    }
    const updated = resolveDb().updateExport(exportId, req.auth!.uid, req.body || {});
    if (!updated) {
      res.status(404).json({ error: 'Export record not found or access denied.' });
      return;
    }
    res.json({ ok: true });
  });

  // Brand Kits
  router.get('/brand-kits', (req: AuthenticatedRequest, res: Response) => {
    res.json({ brandKits: resolveDb().listBrandKitsByOwner(req.auth!.uid) });
  });

  router.post('/brand-kits', (req: AuthenticatedRequest, res: Response) => {
    const brandKitId =
      typeof req.body?.brandKitId === 'string' && isValidId(req.body.brandKitId)
        ? req.body.brandKitId
        : makeId('kit');
    try {
      const saved = resolveDb().saveBrandKit({ ...req.body, brandKitId }, req.auth!.uid);
      res.status(201).json({ brandKit: saved });
    } catch {
      res.status(403).json({ error: 'Access denied to brand kit.' });
    }
  });

  router.delete('/brand-kits/:brandKitId', (req: AuthenticatedRequest, res: Response) => {
    const brandKitId = String(req.params.brandKitId || '');
    if (!isValidId(brandKitId)) {
      res.status(400).json({ error: 'Invalid brandKitId.' });
      return;
    }
    const deleted = resolveDb().deleteBrandKit(brandKitId, req.auth!.uid);
    if (!deleted) {
      res.status(404).json({ error: 'Brand kit not found or access denied.' });
      return;
    }
    res.json({ ok: true });
  });

  // Usage Records
  router.get('/usage', (req: AuthenticatedRequest, res: Response) => {
    res.json({ usageRecords: resolveDb().listUsageRecords(req.auth!.uid) });
  });

  router.post('/usage', (req: AuthenticatedRequest, res: Response) => {
    const operation = typeof req.body?.operation === 'string' ? req.body.operation : 'OP';
    const resourceType = typeof req.body?.resourceType === 'string' ? req.body.resourceType : 'AI_REQUEST';
    const resourceAmount = Number(req.body?.resourceAmount || 0);
    resolveDb().recordUsage({
      ownerId: req.auth!.uid,
      operation,
      resourceType,
      resourceAmount,
    });
    res.status(201).json({ ok: true });
  });

  return router;
}
