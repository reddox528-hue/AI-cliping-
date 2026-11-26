import { Router, type Response } from 'express';
import { isGeminiConfigured, isR2Configured } from '../config/env.ts';
import { requireFirebaseAuth, type AuthenticatedRequest } from '../middleware/auth.ts';
import { createRateLimiter } from '../middleware/rateLimit.ts';
import { validatePublicVideoUrl } from '../security/ssrf.ts';
import {
  analyzeVideoMomentsWithGemini,
  transcribeAudioWithGemini,
} from '../services/geminiService.ts';
import {
  createPresignedDownloadUrl,
  createPresignedUploadUrl,
} from '../services/r2Service.ts';
import { createAdminApiRouter } from './adminApi.ts';
import { logSecurityEvent } from '../services/securityMonitor.ts';

export const apiRouter = Router();

apiRouter.use('/admin', createAdminApiRouter());

const aiRateLimit = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 12,
  keyPrefix: 'ai',
});

const probeRateLimit = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 20,
  keyPrefix: 'probe',
});

const storageRateLimit = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 30,
  keyPrefix: 'r2',
});

apiRouter.get('/health', (_req, res: Response) => {
  res.json({
    ok: true,
    geminiConfigured: isGeminiConfigured(),
    r2Configured: isR2Configured(),
    emailConfigured: false,
  });
});

apiRouter.post(
  '/videos/probe-url',
  requireFirebaseAuth,
  probeRateLimit,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const rawUrl = typeof req.body?.url === 'string' ? req.body.url : '';
      const validation = await validatePublicVideoUrl(rawUrl);
      if (!validation.ok || !validation.parsed) {
        res.status(400).json({ ok: false, error: validation.reason });
        return;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      let headResp: globalThis.Response;
      try {
        headResp = await fetch(validation.parsed.toString(), {
          method: 'HEAD',
          redirect: 'manual',
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (headResp.status >= 300 && headResp.status < 400) {
        res.status(400).json({
          ok: false,
          error: 'Redirecting URLs are blocked. Provide the direct final media URL.',
        });
        return;
      }

      if (!headResp.ok) {
        res.status(400).json({
          ok: false,
          error: `Remote server returned HTTP ${headResp.status}. Ensure the URL is publicly accessible or authorized.`,
        });
        return;
      }

      const contentType = (headResp.headers.get('content-type') || '').toLowerCase();
      const contentLength = Number(headResp.headers.get('content-length') || 0);
      const allowOrigin = headResp.headers.get('access-control-allow-origin') || '';

      const isVideoMime =
        contentType.startsWith('video/') ||
        contentType === 'application/octet-stream';

      if (!isVideoMime) {
        res.status(400).json({
          ok: false,
          error: `URL returned "${contentType || 'unknown'}" instead of a direct video stream.`,
        });
        return;
      }

      res.json({
        ok: true,
        url: validation.parsed.toString(),
        contentType,
        contentLength,
        corsReadable: allowOrigin === '*' || Boolean(allowOrigin),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to probe video URL.';
      res.status(400).json({ ok: false, error: msg });
    }
  }
);

apiRouter.post(
  '/ai/transcribe',
  requireFirebaseAuth,
  aiRateLimit,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const audioBase64 = typeof req.body?.audioBase64 === 'string' ? req.body.audioBase64 : '';
      const mimeType = typeof req.body?.mimeType === 'string' ? req.body.mimeType : 'audio/mp3';
      const videoDuration = Number(req.body?.videoDuration || 0);
      const languageHint = typeof req.body?.languageHint === 'string' ? req.body.languageHint : undefined;

      if (!audioBase64 || audioBase64.length > 20 * 1024 * 1024) {
        res.status(400).json({
          error: 'Audio payload missing or exceeds 15MB server-relay limit. Upload an SRT/VTT transcript for very long videos.',
        });
        return;
      }

      if (!['audio/mp3', 'audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg', 'audio/mp4'].includes(mimeType)) {
        res.status(400).json({ error: `Unsupported audio MIME type: ${mimeType}` });
        return;
      }

      const result = await transcribeAudioWithGemini({
        audioBase64,
        mimeType,
        videoDuration: Math.max(1, videoDuration),
        languageHint,
      });

      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Transcription failed.';
      const status = message.includes('429') || message.includes('RESOURCE_EXHAUSTED') ? 429 : 500;
      res.status(status).json({ error: message });
    }
  }
);

apiRouter.post(
  '/ai/analyze-clips',
  requireFirebaseAuth,
  aiRateLimit,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const transcriptText = typeof req.body?.transcriptText === 'string' ? req.body.transcriptText : '';
      const timestampedSegments = Array.isArray(req.body?.timestampedSegments)
        ? req.body.timestampedSegments
        : [];
      const frames = Array.isArray(req.body?.frames) ? req.body.frames : [];
      const videoDuration = Number(req.body?.videoDuration || 0);
      const minDuration = Math.max(3, Number(req.body?.minDuration || 15));
      const maxDuration = Math.min(videoDuration || 600, Math.max(minDuration, Number(req.body?.maxDuration || 60)));
      const maxClips = Math.min(12, Math.max(1, Number(req.body?.maxClips || 5)));
      const analysisInstructions =
        typeof req.body?.analysisInstructions === 'string'
          ? req.body.analysisInstructions.slice(0, 1000)
          : undefined;
      const modelId = typeof req.body?.modelId === 'string' ? req.body.modelId : undefined;

      if (!Number.isFinite(videoDuration) || videoDuration <= 3) {
        res.status(400).json({ error: 'Video duration must be greater than 3 seconds.' });
        return;
      }

      if (!transcriptText.trim() && frames.length === 0) {
        res.status(400).json({ error: 'Provide either a transcript or representative video frames for AI analysis.' });
        return;
      }

      const clips = await analyzeVideoMomentsWithGemini({
        transcriptText,
        timestampedSegments,
        frames,
        videoDuration,
        minDuration,
        maxDuration,
        maxClips,
        analysisInstructions,
        modelId,
      });

      res.json({ clips });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI analysis failed.';
      const status = message.includes('429') || message.includes('RESOURCE_EXHAUSTED') ? 429 : 500;
      res.status(status).json({ error: message });
    }
  }
);

apiRouter.post(
  '/storage/presign-upload',
  requireFirebaseAuth,
  storageRateLimit,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!isR2Configured()) {
        res.json({ configured: false });
        return;
      }

      const uid = req.auth!.uid;
      const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName : 'video.mp4';
      const contentType = typeof req.body?.contentType === 'string' ? req.body.contentType : 'video/mp4';
      const folder = req.body?.folder === 'exports' || req.body?.folder === 'logos' ? req.body.folder : 'uploads';

      const safeBase = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
      const objectKey = `users/${uid}/${folder}/${Date.now()}_${safeBase}`;

      const presigned = await createPresignedUploadUrl({ objectKey, contentType });
      res.json({ configured: true, ...presigned });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Presign upload failed.';
      res.status(500).json({ error: message });
    }
  }
);

apiRouter.post(
  '/storage/presign-download',
  requireFirebaseAuth,
  storageRateLimit,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!isR2Configured()) {
        res.json({ configured: false });
        return;
      }

      const uid = req.auth!.uid;
      const objectKey = typeof req.body?.objectKey === 'string' ? req.body.objectKey : '';
      if (!objectKey.startsWith(`users/${uid}/`)) {
        res.status(403).json({ error: 'Access denied to requested storage object.' });
        return;
      }

      const presigned = await createPresignedDownloadUrl({ objectKey });
      res.json({ configured: true, ...presigned });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Presign download failed.';
      res.status(500).json({ error: message });
    }
  }
);

const securityLogLimit = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 15,
  keyPrefix: 'sec_fail_login',
});

apiRouter.post('/security/failed-admin-login', securityLogLimit, async (req, res: Response) => {
  const emailAttempt =
    typeof req.body?.email === 'string'
      ? req.body.email.trim().slice(0, 120).replace(/(?<=.{2}).(?=[^@]*@)/g, '*')
      : 'unknown';
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 120) : 'auth_failed';

  await logSecurityEvent({
    actorId: 'unauthenticated_visitor',
    action: 'FAILED_ADMIN_LOGIN',
    targetId: '/secure-control-panel',
    metadata: { emailAttempt, reason, ip: req.ip },
  });
  res.status(202).json({ recorded: true });
});

apiRouter.post('/security/admin-password-reset', securityLogLimit, async (req, res: Response) => {
  const emailAttempt =
    typeof req.body?.email === 'string'
      ? req.body.email.trim().slice(0, 120).replace(/(?<=.{2}).(?=[^@]*@)/g, '*')
      : 'unknown';

  await logSecurityEvent({
    actorId: 'unauthenticated_visitor',
    action: 'ADMIN_PASSWORD_RESET_REQUESTED',
    targetId: '/secure-control-panel',
    metadata: { emailAttempt, ip: req.ip },
  });
  res.status(202).json({ recorded: true });
});
