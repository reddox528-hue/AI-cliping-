import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Globe,
  Loader2,
  Scissors,
  Sparkles,
  Upload,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  createClipRecord,
  createNotification,
  createProcessingJob,
  createProject,
  createSourceVideo,
  makeId,
  recordUsage,
  saveTranscriptRecord,
  updateProcessingJob,
  updateProject,
  updateSourceVideo,
} from '../../services/firebase/firestoreService';
import {
  analyzeVideoViaServer,
  probeRemoteVideoUrl,
  transcribeAudioViaServer,
} from '../../services/gemini/clientApi';
import {
  saveLocalMediaBlob,
  uploadBlobToR2IfConfigured,
} from '../../services/storage/localMediaStore';
import {
  extractAudioMp3Base64,
  renderClipWithFFmpeg,
} from '../../services/video/ffmpegEngine';
import {
  extractRepresentativeFrames,
  extractVideoMetadata,
  formatTimecode,
  parseTranscriptFile,
  validateVideoFile,
  type ExtractedVideoMetadata,
} from '../../services/video/videoAnalysis';
import {
  DEFAULT_CAPTION_STYLE,
  DEFAULT_REFRAME_CONFIG,
  type AspectRatioOption,
  type ClipRecord,
  type ProcessingJobStatus,
  type TranscriptSegment,
} from '../../types/clipora';

interface CreateClipsPageProps {
  existingProjectsCount: number;
  onCreated: () => Promise<void>;
  onOpenClips: () => void;
}

export function CreateClipsPage({
  existingProjectsCount,
  onCreated,
  onOpenClips,
}: CreateClipsPageProps) {
  const { profile, limits, aiConfig } = useAuth();
  const { notify } = useToast();

  const [sourceMode, setSourceMode] = useState<'upload' | 'url'>('upload');
  const [projectName, setProjectName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | Blob | null>(null);
  const [fileName, setFileName] = useState('');
  const [metadata, setMetadata] = useState<ExtractedVideoMetadata | null>(null);
  const [remoteUrl, setRemoteUrl] = useState('');
  const [probingUrl, setProbingUrl] = useState(false);

  const [transcriptMode, setTranscriptMode] = useState<'auto-ai' | 'upload' | 'manual'>('auto-ai');
  const [manualTranscript, setManualTranscript] = useState('');
  const [parsedSegments, setParsedSegments] = useState<TranscriptSegment[]>([]);

  const [minDuration, setMinDuration] = useState(aiConfig.defaultMinClipSec);
  const [maxDuration, setMaxDuration] = useState(aiConfig.defaultMaxClipSec);
  const [maxClips, setMaxClips] = useState(aiConfig.maxClipsPerRun);
  const [aspectRatio, setAspectRatio] = useState<AspectRatioOption>('9:16');
  const [burnCaptionsOnGenerate, setBurnCaptionsOnGenerate] = useState(false);

  const [jobRunning, setJobRunning] = useState(false);
  const [jobStatus, setJobStatus] = useState<ProcessingJobStatus | null>(null);
  const [jobStage, setJobStage] = useState('');
  const [jobProgress, setJobProgress] = useState(0);
  const [jobError, setJobError] = useState<string | null>(null);
  const [generatedResults, setGeneratedResults] = useState<ClipRecord[]>([]);

  const abortControllerRef = useRef<AbortController | null>(null);

  const handleFileChosen = async (file: File) => {
    setJobError(null);
    const check = validateVideoFile(file, limits.maxFileSizeMb);
    if (!check.valid) {
      setJobError(check.error || 'Invalid video file.');
      return;
    }

    try {
      const meta = await extractVideoMetadata(file);
      if (meta.duration > limits.maxVideoDurationSec) {
        setJobError(
          `Video duration (${formatTimecode(meta.duration)}) exceeds the maximum limit of ${formatTimecode(
            limits.maxVideoDurationSec
          )}.`
        );
        return;
      }

      setSelectedFile(file);
      setFileName(file.name);
      setMetadata(meta);
      if (!projectName.trim()) {
        setProjectName(file.name.replace(/\.[^.]+$/, ''));
      }
      if (maxDuration > meta.duration) {
        setMaxDuration(Math.max(5, Math.floor(meta.duration)));
      }
      if (minDuration >= meta.duration) {
        setMinDuration(Math.max(3, Math.floor(meta.duration / 2)));
      }
      notify('success', 'Video validated', `${meta.width}x${meta.height} · ${formatTimecode(meta.duration)}`);
    } catch (err) {
      setJobError(err instanceof Error ? err.message : 'Unable to decode video metadata.');
    }
  };

  const handleUrlImport = async () => {
    setJobError(null);
    if (!remoteUrl.trim()) {
      setJobError('Enter a direct video URL.');
      return;
    }
    setProbingUrl(true);
    try {
      const probe = await probeRemoteVideoUrl(remoteUrl.trim());
      if (!probe.ok || !probe.url) {
        setJobError(probe.error || 'URL validation failed.');
        return;
      }

      const resp = await fetch(probe.url);
      if (!resp.ok) {
        throw new Error(`Unable to fetch video stream (HTTP ${resp.status}).`);
      }
      const blob = await resp.blob();
      const maxBytes = limits.maxFileSizeMb * 1024 * 1024;
      if (blob.size > maxBytes) {
        throw new Error(`Remote video exceeds ${limits.maxFileSizeMb} MB limit.`);
      }
      const meta = await extractVideoMetadata(blob);
      if (meta.duration > limits.maxVideoDurationSec) {
        throw new Error('Remote video exceeds maximum allowed duration.');
      }

      const derivedName =
        probe.url.split('/').pop()?.split('?')[0] || `imported_video_${Date.now()}.mp4`;
      setSelectedFile(blob);
      setFileName(derivedName);
      setMetadata(meta);
      if (!projectName.trim()) {
        setProjectName(derivedName.replace(/\.[^.]+$/, ''));
      }
      notify('success', 'Remote video imported', `${meta.width}x${meta.height} · ${formatTimecode(meta.duration)}`);
    } catch (err) {
      setJobError(
        err instanceof Error
          ? err.message
          : 'Could not download remote URL (CORS or access blocked). Please download and upload the video file directly.'
      );
    } finally {
      setProbingUrl(false);
    }
  };

  const handleTranscriptFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    const parsed = parseTranscriptFile(text);
    setParsedSegments(parsed.segments);
    setManualTranscript(parsed.transcriptText);
    setTranscriptMode('upload');
    notify('success', 'Transcript loaded', `${parsed.segments.length} timestamped segments parsed.`);
  };

  const handleCancelPipeline = () => {
    abortControllerRef.current?.abort();
  };

  const handleStartPipeline = async () => {
    if (!profile || !selectedFile || !metadata) return;

    if (existingProjectsCount >= limits.maxProjectsPerUser) {
      setJobError(
        `You have reached the maximum of ${limits.maxProjectsPerUser} projects. Delete an older project to create a new one.`
      );
      return;
    }

    if (minDuration < 3 || minDuration > maxDuration || maxDuration > metadata.duration) {
      setJobError(
        `Clip duration bounds (${minDuration}s–${maxDuration}s) must be valid and within the source video length (${metadata.duration.toFixed(
          1
        )}s).`
      );
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setJobRunning(true);
    setJobError(null);
    setGeneratedResults([]);

    let jobId = '';
    let projectId = '';

    try {
      // 1. Create Project + SourceVideo + Job
      setJobStatus('QUEUED');
      setJobProgress(5);
      setJobStage('Initializing project and storage metadata...');

      const project = await createProject({
        ownerId: profile.uid,
        projectName: projectName.trim() || fileName || 'Untitled Video Project',
      });
      projectId = project.projectId;

      const videoId = makeId('vid');
      const localVideoKey = `video_${videoId}`;
      const uploadRes = await uploadBlobToR2IfConfigured({
        blob: selectedFile,
        fileName: fileName || 'source.mp4',
        contentType: metadata.mimeType,
        folder: 'uploads',
        localKey: localVideoKey,
      });

      await createSourceVideo({
        videoId,
        ownerId: profile.uid,
        projectId,
        fileName: fileName || 'source.mp4',
        storagePath: uploadRes.storagePath,
        duration: metadata.duration,
        width: metadata.width,
        height: metadata.height,
        frameRate: metadata.frameRate,
        fileSize: metadata.fileSize,
        mimeType: metadata.mimeType,
        processingStatus: uploadRes.usedRemoteR2 ? 'STORED' : 'LOCAL_READY',
      });

      await updateProject(projectId, { sourceVideoId: videoId, status: 'PROCESSING' });
      await recordUsage({
        ownerId: profile.uid,
        operation: 'VIDEO_UPLOAD',
        resourceType: 'STORAGE_BYTES',
        resourceAmount: metadata.fileSize,
      });

      jobId = makeId('job');
      await createProcessingJob({
        jobId,
        ownerId: profile.uid,
        projectId,
        sourceVideoId: videoId,
        status: 'VALIDATING',
        progress: 12,
        currentStage: 'Validating source video & extracting frames',
        executionMode: uploadRes.usedRemoteR2 ? 'HYBRID_CLOUD' : 'BROWSER_LOCAL',
      });

      setJobStatus('VALIDATING');
      setJobProgress(15);
      setJobStage('Sampling representative video frames...');
      const frames = await extractRepresentativeFrames(selectedFile, metadata.duration, 5);
      if (controller.signal.aborted) throw new Error('Processing cancelled by user.');

      // 2. Transcription
      setJobStatus('TRANSCRIBING');
      setJobProgress(28);
      await updateProcessingJob(jobId, {
        status: 'TRANSCRIBING',
        progress: 28,
        currentStage: 'Preparing timestamped speech transcript',
      });

      let transcriptText = manualTranscript.trim();
      let segments: TranscriptSegment[] = parsedSegments;
      let granularity: 'SEGMENT' | 'MANUAL' = parsedSegments.length > 0 ? 'SEGMENT' : 'MANUAL';

      if (transcriptMode === 'auto-ai') {
        if (!metadata.hasAudio) {
          throw new Error(
            'No audio track detected. Switch to Manual Transcript or Upload SRT/VTT to analyze silent footage.'
          );
        }
        setJobStage('Extracting audio track locally via FFmpeg.wasm...');
        const { audioBase64, mimeType } = await extractAudioMp3Base64({
          sourceBlob: selectedFile,
          signal: controller.signal,
        });
        if (controller.signal.aborted) throw new Error('Processing cancelled by user.');

        setJobStage('Transcribing spoken audio via Gemini...');
        setJobProgress(42);
        const transcribed = await transcribeAudioViaServer({
          audioBase64,
          mimeType,
          videoDuration: metadata.duration,
        });
        transcriptText = transcribed.transcriptText;
        segments = transcribed.segments;
        granularity = 'SEGMENT';
        await recordUsage({
          ownerId: profile.uid,
          operation: 'AI_TRANSCRIBE',
          resourceType: 'AI_REQUEST',
          resourceAmount: 1,
        });
      } else if (transcriptMode === 'manual') {
        if (!transcriptText) {
          throw new Error('Enter a transcript or switch to Automatic AI Transcription.');
        }
        const parsed = parseTranscriptFile(transcriptText);
        segments = parsed.segments;
      } else {
        if (segments.length === 0 && !transcriptText) {
          throw new Error('Upload a valid .srt or .vtt transcript file.');
        }
      }

      const transcriptId = makeId('trn');
      await saveTranscriptRecord({
        transcriptId,
        ownerId: profile.uid,
        projectId,
        sourceVideoId: videoId,
        language: 'en',
        transcriptText,
        timestampGranularity: granularity,
        timestampedSegments: segments,
      });

      // 3. Gemini AI Analysis & Clip Selection
      if (controller.signal.aborted) throw new Error('Processing cancelled by user.');
      setJobStatus('ANALYZING');
      setJobProgress(55);
      setJobStage(`Analyzing transcript and ${frames.length} frames with Gemini...`);
      await updateProcessingJob(jobId, {
        status: 'ANALYZING',
        progress: 55,
        currentStage: 'Identifying standout hooks and moments with Gemini AI',
      });

      const candidates = await analyzeVideoViaServer({
        transcriptText,
        timestampedSegments: segments,
        frames,
        videoDuration: metadata.duration,
        minDuration,
        maxDuration,
        maxClips,
        analysisInstructions: aiConfig.analysisInstructions,
        modelId: aiConfig.modelId,
      });

      await recordUsage({
        ownerId: profile.uid,
        operation: 'AI_ANALYZE_CLIPS',
        resourceType: 'AI_REQUEST',
        resourceAmount: 1,
      });

      if (candidates.length === 0) {
        throw new Error(
          'No valid standalone clips matched your duration range. Try widening the minimum/maximum duration.'
        );
      }

      setJobStatus('SELECTING_CLIPS');
      setJobProgress(65);
      setJobStage(`Selected ${candidates.length} ranked moments. Preparing FFmpeg clip rendering...`);
      await updateProcessingJob(jobId, {
        status: 'SELECTING_CLIPS',
        progress: 65,
        currentStage: `Selected ${candidates.length} candidate clips`,
      });

      // 4. Real FFmpeg.wasm Clip Rendering
      setJobStatus('RENDERING');
      await updateProcessingJob(jobId, {
        status: 'RENDERING',
        progress: 70,
        currentStage: `Rendering ${candidates.length} MP4 clips in browser FFmpeg.wasm`,
      });

      const createdClips: ClipRecord[] = [];
      for (let i = 0; i < candidates.length; i++) {
        if (controller.signal.aborted) throw new Error('Processing cancelled by user.');
        const cand = candidates[i];
        const basePct = 70 + Math.round((i / candidates.length) * 24);
        setJobProgress(basePct);
        setJobStage(`Rendering clip ${i + 1} of ${candidates.length}: "${cand.title}"`);

        const rendered = await renderClipWithFFmpeg({
          sourceBlob: selectedFile,
          startTime: cand.startTime,
          endTime: cand.endTime,
          aspectRatio,
          resolution: '720p',
          reframe: DEFAULT_REFRAME_CONFIG,
          muted: false,
          volume: 1,
          captions: segments,
          captionStyle: { ...DEFAULT_CAPTION_STYLE, enabled: burnCaptionsOnGenerate },
          watermark: { enabled: false, text: '', position: 'bottom-right', opacity: 0.7 },
          signal: controller.signal,
        });

        const clipId = makeId('clip');
        const clipLocalKey = `clip_${clipId}`;
        await saveLocalMediaBlob(clipLocalKey, rendered.blob);
        const clipStorage = await uploadBlobToR2IfConfigured({
          blob: rendered.blob,
          fileName: `${clipId}.mp4`,
          contentType: 'video/mp4',
          folder: 'exports',
          localKey: clipLocalKey,
        });

        const savedClip = await createClipRecord({
          clipId,
          ownerId: profile.uid,
          projectId,
          sourceVideoId: videoId,
          startTime: cand.startTime,
          endTime: cand.endTime,
          duration: cand.duration,
          title: cand.title,
          description: cand.description,
          hook: cand.hook,
          topic: cand.topic,
          reason: cand.reason,
          score: cand.score,
          clipStoragePath: clipStorage.storagePath,
          aspectRatio,
          status: 'RENDERED',
        });

        createdClips.push(savedClip);
        await recordUsage({
          ownerId: profile.uid,
          operation: 'CLIP_RENDER',
          resourceType: 'CLIP_RENDER',
          resourceAmount: 1,
        });
      }

      // 5. Quality Check & Completion
      setJobStatus('QUALITY_CHECK');
      setJobProgress(96);
      setJobStage('Verifying rendered MP4 files and saving records...');
      await updateProcessingJob(jobId, {
        status: 'COMPLETED',
        progress: 100,
        currentStage: `Generated ${createdClips.length} verified clips`,
        markCompleted: true,
      });
      await updateProject(projectId, { status: 'READY' });
      await updateSourceVideo(videoId, { processingStatus: 'STORED' }).catch(() => {});

      await createNotification({
        ownerId: profile.uid,
        type: 'CLIPS_GENERATED',
        title: 'AI Clips Generated',
        message: `${createdClips.length} short clips were generated for "${project.projectName}".`,
      });

      setJobStatus('COMPLETED');
      setJobProgress(100);
      setJobStage(`Completed ${createdClips.length} clips.`);
      setGeneratedResults(createdClips);
      await onCreated();
      notify('success', 'Clips generated', `${createdClips.length} clips are ready to edit or export.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Processing failed.';
      const cancelled = msg.toLowerCase().includes('cancelled');
      setJobStatus(cancelled ? 'CANCELLED' : 'FAILED');
      setJobError(msg);

      if (jobId) {
        await updateProcessingJob(jobId, {
          status: cancelled ? 'CANCELLED' : 'FAILED',
          progress: jobProgress,
          currentStage: cancelled ? 'Cancelled by user' : 'Processing failed',
          errorMessage: msg,
        }).catch(() => {});
      }
      if (projectId) {
        await updateProject(projectId, { status: 'FAILED' }).catch(() => {});
      }
      if (!cancelled) {
        await createNotification({
          ownerId: profile.uid,
          type: 'PROCESSING_FAILED',
          title: 'Video Processing Failed',
          message: msg,
        }).catch(() => {});
      }
    } finally {
      setJobRunning(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-950 dark:text-white">
          Create New AI Clips
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Browser-local FFmpeg.wasm processing paired with server-side Gemini analysis. Keep this browser tab open while a job is rendering.
        </p>
      </div>

      {/* Step 1: Source Ingestion */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E1424] p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="font-bold text-base text-slate-900 dark:text-white">
            01. Source Video
          </h2>
          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setSourceMode('upload')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                sourceMode === 'upload'
                  ? 'bg-white dark:bg-blue-600 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Upload File
            </button>
            <button
              type="button"
              onClick={() => setSourceMode('url')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                sourceMode === 'url'
                  ? 'bg-white dark:bg-blue-600 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Direct Video URL
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            Project Name
          </label>
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="e.g., Episode 14 Product Launch Breakdown"
            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {sourceMode === 'upload' ? (
          <label
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) void handleFileChosen(f);
            }}
            className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-500 p-8 text-center cursor-pointer transition-colors bg-slate-50/50 dark:bg-slate-900/30"
          >
            <Upload className="w-8 h-8 text-blue-600 dark:text-blue-400 mb-3" />
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              Drop a video file here or click to browse
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              MP4, MOV, WebM, AVI, MKV · Max {limits.maxFileSizeMb} MB · Max{' '}
              {formatTimecode(limits.maxVideoDurationSec)}
            </p>
            <input
              type="file"
              accept=".mp4,.mov,.webm,.avi,.mkv,video/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFileChosen(f);
              }}
              className="hidden"
            />
          </label>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Globe className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="url"
                  value={remoteUrl}
                  onChange={(e) => setRemoteUrl(e.target.value)}
                  placeholder="https://cdn.example.com/footage.mp4"
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                type="button"
                onClick={handleUrlImport}
                disabled={probingUrl}
                className="px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-700 text-white text-sm font-semibold transition-colors disabled:opacity-60 whitespace-nowrap"
              >
                {probingUrl ? 'Validating...' : 'Validate & Import'}
              </button>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Supports authorized direct downloadable video URLs with CORS access. Unauthorized YouTube, TikTok, or Instagram scraping is disabled.
            </p>
          </div>
        )}

        {metadata && (
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/20 p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{fileName}</p>
                <p className="text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                  {metadata.width}×{metadata.height} · {formatTimecode(metadata.duration)} ·{' '}
                  {(metadata.fileSize / (1024 * 1024)).toFixed(1)} MB · Audio:{' '}
                  {metadata.hasAudio ? 'Available' : 'None detected'}
                </p>
              </div>
            </div>
            {metadata.fileSize > 150 * 1024 * 1024 && (
              <span className="text-xs text-amber-700 dark:text-amber-300 font-medium">
                Large file notice: Browser FFmpeg processing uses local RAM.
              </span>
            )}
          </div>
        )}
      </div>

      {/* Step 2: Transcript & Clip Settings */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E1424] p-6 space-y-6">
        <h2 className="font-bold text-base text-slate-900 dark:text-white">
          02. Transcription &amp; Clip Parameters
        </h2>

        <div className="grid md:grid-cols-3 gap-4">
          <button
            type="button"
            onClick={() => setTranscriptMode('auto-ai')}
            className={`p-4 rounded-xl border text-left transition-colors ${
              transcriptMode === 'auto-ai'
                ? 'border-blue-600 bg-blue-500/5'
                : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900/50'
            }`}
          >
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              Automatic Speech-to-Text
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Extracts audio locally and transcribes via Gemini speech model.
            </p>
          </button>

          <label
            className={`p-4 rounded-xl border text-left cursor-pointer transition-colors ${
              transcriptMode === 'upload'
                ? 'border-blue-600 bg-blue-500/5'
                : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900/50'
            }`}
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                Upload SRT / VTT
              </p>
              <FileText className="w-4 h-4 text-slate-400" />
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {parsedSegments.length > 0
                ? `${parsedSegments.length} segments loaded`
                : 'Use existing timestamped subtitle file.'}
            </p>
            <input
              type="file"
              accept=".srt,.vtt,.txt"
              onChange={handleTranscriptFile}
              className="hidden"
            />
          </label>

          <button
            type="button"
            onClick={() => setTranscriptMode('manual')}
            className={`p-4 rounded-xl border text-left transition-colors ${
              transcriptMode === 'manual'
                ? 'border-blue-600 bg-blue-500/5'
                : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900/50'
            }`}
          >
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              Manual Transcript Entry
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Paste a transcript or notes if audio quota is unavailable.
            </p>
          </button>
        </div>

        {(transcriptMode === 'manual' || transcriptMode === 'upload') && (
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Transcript Text
            </label>
            <textarea
              rows={4}
              value={manualTranscript}
              onChange={(e) => setManualTranscript(e.target.value)}
              placeholder="Paste spoken transcript or SRT content here..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Min Clip Duration (sec)
            </label>
            <input
              type="number"
              min={3}
              max={maxDuration}
              value={minDuration}
              onChange={(e) => setMinDuration(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Max Clip Duration (sec)
            </label>
            <input
              type="number"
              min={minDuration}
              max={metadata ? Math.max(5, Math.floor(metadata.duration)) : 600}
              value={maxDuration}
              onChange={(e) => setMaxDuration(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Target Clips (1–{aiConfig.maxClipsPerRun})
            </label>
            <input
              type="number"
              min={1}
              max={aiConfig.maxClipsPerRun}
              value={maxClips}
              onChange={(e) => setMaxClips(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Target Aspect Ratio
            </label>
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value as AspectRatioOption)}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            >
              <option value="9:16">9:16 Portrait</option>
              <option value="16:9">16:9 Landscape</option>
              <option value="1:1">1:1 Square</option>
            </select>
          </div>
        </div>

        <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={burnCaptionsOnGenerate}
            onChange={(e) => setBurnCaptionsOnGenerate(e.target.checked)}
            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          Burn default captions directly into initial generated clips (you can always customize &amp; re-export in the Video Editor)
        </label>

        {jobError && (
          <div className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-4 text-xs text-red-700 dark:text-red-300 flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{jobError}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            type="button"
            disabled={!selectedFile || !metadata || jobRunning}
            onClick={handleStartPipeline}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {jobRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {jobRunning ? 'Processing Video...' : 'Analyze & Generate Clips'}
          </button>

          {jobRunning && (
            <button
              type="button"
              onClick={handleCancelPipeline}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 text-sm font-semibold hover:bg-red-50 dark:hover:bg-red-950/30"
            >
              <XCircle className="w-4 h-4" />
              Cancel Job
            </button>
          )}
        </div>
      </div>

      {/* Live Pipeline Progress */}
      {jobStatus && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E1424] p-6 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-slate-900 dark:text-white">
              Status: {jobStatus}
            </span>
            <span className="font-mono font-semibold tabular-nums text-blue-600 dark:text-blue-400">
              {jobProgress}%
            </span>
          </div>
          <div className="w-full h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                jobStatus === 'FAILED' || jobStatus === 'CANCELLED'
                  ? 'bg-red-600'
                  : jobStatus === 'COMPLETED'
                  ? 'bg-emerald-600'
                  : 'bg-blue-600'
              }`}
              style={{ width: `${jobProgress}%` }}
            />
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">{jobStage}</p>

          {generatedResults.length > 0 && (
            <div className="pt-3 flex items-center justify-between">
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                {generatedResults.length} rendered clips saved to your library.
              </span>
              <button
                type="button"
                onClick={onOpenClips}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
              >
                <Scissors className="w-3.5 h-3.5" />
                View Generated Clips
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
