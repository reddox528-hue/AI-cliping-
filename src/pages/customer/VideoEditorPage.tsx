import React, { useEffect, useRef, useState } from 'react';
import {
  Captions,
  Copy,
  Crop,
  Download,
  Loader2,
  Maximize2,
  Palette,
  Pause,
  Play,
  Redo2,
  Save,
  Scissors,
  Trash2,
  Undo2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  CAPTION_PRESETS,
  drawCaptionOverlayOnCanvas,
  drawVideoFrameWithReframe,
  drawWatermarkOnCanvas,
} from '../../services/captions/captionPresets';
import {
  createClipRecord,
  createExportRecord,
  createNotification,
  deleteClipRecord,
  makeId,
  recordUsage,
  updateClipRecord,
  updateExportRecord,
  updateTranscriptSegments,
} from '../../services/data/workspaceService';
import {
  resolveMediaBlob,
  saveLocalMediaBlob,
  uploadBlobToR2IfConfigured,
} from '../../services/storage/localMediaStore';
import { renderClipWithFFmpeg, triggerBlobDownload } from '../../services/video/ffmpegEngine';
import {
  exportSegmentsToSRT,
  exportSegmentsToVTT,
  formatTimecode,
} from '../../services/video/videoAnalysis';
import {
  DEFAULT_CAPTION_STYLE,
  DEFAULT_REFRAME_CONFIG,
  type AspectRatioOption,
  type BrandKitRecord,
  type CaptionStyleConfig,
  type ClipRecord,
  type ExportResolution,
  type ReframeConfig,
  type SourceVideoRecord,
  type TranscriptRecord,
  type TranscriptSegment,
  type WatermarkConfig,
} from '../../types/clipora';

interface EditorSnapshot {
  title: string;
  startTime: number;
  endTime: number;
  aspectRatio: AspectRatioOption;
  reframe: ReframeConfig;
  captionStyle: CaptionStyleConfig;
  watermark: WatermarkConfig;
  volume: number;
  muted: boolean;
  segments: TranscriptSegment[];
}

interface VideoEditorPageProps {
  clips: ClipRecord[];
  videos: SourceVideoRecord[];
  transcripts: TranscriptRecord[];
  brandKits: BrandKitRecord[];
  activeClip: ClipRecord | null;
  onSelectClip: (clip: ClipRecord | null) => void;
  onReload: () => Promise<void>;
}

export function VideoEditorPage({
  clips,
  videos,
  transcripts,
  brandKits,
  activeClip,
  onSelectClip,
  onReload,
}: VideoEditorPageProps) {
  const { profile, limits } = useAuth();
  const { notify } = useToast();

  const selectedClip = activeClip || clips[0] || null;
  const sourceVideo = selectedClip
    ? videos.find((v) => v.videoId === selectedClip.sourceVideoId) || null
    : null;
  const sourceTranscript = selectedClip
    ? transcripts.find((t) => t.sourceVideoId === selectedClip.sourceVideoId) || null
    : null;

  const [sourceBlob, setSourceBlob] = useState<Blob | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [sourceDuration, setSourceDuration] = useState<number>(60);

  const [editorState, setEditorState] = useState<EditorSnapshot>({
    title: selectedClip?.title || 'Clip Project',
    startTime: selectedClip?.startTime || 0,
    endTime: selectedClip?.endTime || 30,
    aspectRatio: selectedClip?.aspectRatio || '9:16',
    reframe: DEFAULT_REFRAME_CONFIG,
    captionStyle: DEFAULT_CAPTION_STYLE,
    watermark: { enabled: false, text: 'NEXORATECH Clipora AI', position: 'bottom-right', opacity: 0.7 },
    volume: 1,
    muted: false,
    segments: [],
  });

  const [historyPast, setHistoryPast] = useState<EditorSnapshot[]>([]);
  const [historyFuture, setHistoryFuture] = useState<EditorSnapshot[]>([]);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [activeTab, setActiveTab] = useState<'trim' | 'reframe' | 'captions' | 'brand'>('captions');

  const [exportResolution, setExportResolution] = useState<ExportResolution>('720p');
  const [rendering, setRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderStage, setRenderStage] = useState('');
  const [saving, setSaving] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const dragHandleRef = useRef<'start' | 'end' | 'playhead' | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Sync when selected clip changes
  useEffect(() => {
    if (!selectedClip) return;
    const initSnapshot: EditorSnapshot = {
      title: selectedClip.title,
      startTime: selectedClip.startTime,
      endTime: selectedClip.endTime,
      aspectRatio: selectedClip.aspectRatio,
      reframe: DEFAULT_REFRAME_CONFIG,
      captionStyle: DEFAULT_CAPTION_STYLE,
      watermark: { enabled: false, text: 'NEXORATECH Clipora AI', position: 'bottom-right', opacity: 0.7 },
      volume: 1,
      muted: false,
      segments: sourceTranscript?.timestampedSegments || [],
    };
    setEditorState(initSnapshot);
    setHistoryPast([]);
    setHistoryFuture([]);
    setCurrentTime(selectedClip.startTime);
    setPlaying(false);
  }, [selectedClip?.clipId, sourceTranscript?.transcriptId]);

  // Load source video blob (fallback to clip blob if source missing)
  useEffect(() => {
    let active = true;
    let objUrl: string | null = null;
    if (!selectedClip) return;

    void (async () => {
      let blob: Blob | null = null;
      if (sourceVideo) {
        blob = await resolveMediaBlob(sourceVideo.storagePath, `video_${sourceVideo.videoId}`);
      }
      if (!blob) {
        blob = await resolveMediaBlob(selectedClip.clipStoragePath, `clip_${selectedClip.clipId}`);
      }
      if (!active || !blob) return;
      setSourceBlob(blob);
      objUrl = URL.createObjectURL(blob);
      setVideoUrl(objUrl);
      setSourceDuration(sourceVideo?.duration || selectedClip.endTime || 60);
    })();

    return () => {
      active = false;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [selectedClip?.clipId, sourceVideo?.videoId]);

  const commitChange = (updater: (prev: EditorSnapshot) => EditorSnapshot) => {
    setEditorState((prev) => {
      const next = updater(prev);
      setHistoryPast((past) => [...past.slice(-24), prev]);
      setHistoryFuture([]);
      return next;
    });
  };

  const handleUndo = () => {
    if (historyPast.length === 0) return;
    const previous = historyPast[historyPast.length - 1];
    setHistoryPast((p) => p.slice(0, -1));
    setHistoryFuture((f) => [editorState, ...f]);
    setEditorState(previous);
  };

  const handleRedo = () => {
    if (historyFuture.length === 0) return;
    const next = historyFuture[0];
    setHistoryFuture((f) => f.slice(1));
    setHistoryPast((p) => [...p, editorState]);
    setEditorState(next);
  };

  // Keyboard Undo/Redo shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          e.preventDefault();
          handleRedo();
        } else {
          e.preventDefault();
          handleUndo();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Real-time Canvas composition loop
  useEffect(() => {
    let rafId = 0;
    const renderFrame = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState >= 2) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const targetW =
            editorState.aspectRatio === '9:16'
              ? 360
              : editorState.aspectRatio === '1:1'
              ? 480
              : 640;
          const targetH =
            editorState.aspectRatio === '9:16'
              ? 640
              : editorState.aspectRatio === '1:1'
              ? 480
              : 360;
          if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
          }

          drawVideoFrameWithReframe({
            ctx,
            video,
            canvasWidth: targetW,
            canvasHeight: targetH,
            reframe: editorState.reframe,
          });

          const activeSeg = editorState.segments.find(
            (s) => video.currentTime >= s.start && video.currentTime <= s.end
          );
          if (activeSeg) {
            drawCaptionOverlayOnCanvas({
              ctx,
              width: targetW,
              height: targetH,
              segment: activeSeg,
              currentTimeSec: video.currentTime,
              style: editorState.captionStyle,
            });
          }

          drawWatermarkOnCanvas({
            ctx,
            width: targetW,
            height: targetH,
            watermark: editorState.watermark,
          });
        }
      }
      rafId = requestAnimationFrame(renderFrame);
    };
    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, [editorState]);

  // Sync audio volume/mute and loop inside clip trim range
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = editorState.muted;
    video.volume = Math.max(0, Math.min(1, editorState.volume));
  }, [editorState.muted, editorState.volume]);

  const togglePlay = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      if (video.currentTime < editorState.startTime || video.currentTime >= editorState.endTime) {
        video.currentTime = editorState.startTime;
      }
      await video.play();
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
  };

  const seekTo = (t: number) => {
    const clamped = Math.max(0, Math.min(sourceDuration, t));
    setCurrentTime(clamped);
    if (videoRef.current) {
      videoRef.current.currentTime = clamped;
    }
  };

  // Interactive draggable timeline handles
  const handleTimelinePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragHandleRef.current || !timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const sec = Number((ratio * sourceDuration).toFixed(2));

    if (dragHandleRef.current === 'playhead') {
      seekTo(sec);
    } else if (dragHandleRef.current === 'start') {
      commitChange((prev) => ({
        ...prev,
        startTime: Math.min(sec, prev.endTime - 1),
      }));
    } else if (dragHandleRef.current === 'end') {
      commitChange((prev) => ({
        ...prev,
        endTime: Math.max(sec, prev.startTime + 1),
      }));
    }
  };

  const handleSplitAtPlayhead = async () => {
    if (!selectedClip || !profile) return;
    if (currentTime <= editorState.startTime + 1 || currentTime >= editorState.endTime - 1) {
      notify('warning', 'Move playhead inside the clip range', 'Leave at least 1 second on both sides of the split.');
      return;
    }

    const firstEnd = Number(currentTime.toFixed(2));
    const secondStart = firstEnd;
    const secondEnd = editorState.endTime;

    commitChange((prev) => ({ ...prev, endTime: firstEnd }));

    const newClipId = makeId('clip');
    await createClipRecord({
      clipId: newClipId,
      ownerId: profile.uid,
      projectId: selectedClip.projectId,
      sourceVideoId: selectedClip.sourceVideoId,
      startTime: secondStart,
      endTime: secondEnd,
      duration: Number((secondEnd - secondStart).toFixed(2)),
      title: `${editorState.title} (Part 2)`,
      description: selectedClip.description,
      score: selectedClip.score,
      clipStoragePath: selectedClip.clipStoragePath,
      aspectRatio: editorState.aspectRatio,
      status: 'EDITING',
    });
    await onReload();
    notify('success', 'Clip split at playhead', 'Created Part 2 in your clip list.');
  };

  const handleSaveProjectChanges = async () => {
    if (!selectedClip) return;
    setSaving(true);
    try {
      await updateClipRecord(selectedClip.clipId, {
        title: editorState.title,
        startTime: editorState.startTime,
        endTime: editorState.endTime,
        duration: Number((editorState.endTime - editorState.startTime).toFixed(2)),
        aspectRatio: editorState.aspectRatio,
        status: 'EDITING',
      });
      if (sourceTranscript) {
        await updateTranscriptSegments(
          sourceTranscript.transcriptId,
          editorState.segments,
          editorState.segments.map((s) => s.text).join(' ')
        );
      }
      await onReload();
      notify('success', 'Changes saved to workspace');
    } catch (err) {
      notify('error', 'Save failed', err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicateClip = async () => {
    if (!selectedClip || !profile) return;
    const newId = makeId('clip');
    await createClipRecord({
      clipId: newId,
      ownerId: profile.uid,
      projectId: selectedClip.projectId,
      sourceVideoId: selectedClip.sourceVideoId,
      startTime: editorState.startTime,
      endTime: editorState.endTime,
      duration: Number((editorState.endTime - editorState.startTime).toFixed(2)),
      title: `${editorState.title} (Copy)`,
      description: selectedClip.description,
      score: selectedClip.score,
      clipStoragePath: selectedClip.clipStoragePath,
      aspectRatio: editorState.aspectRatio,
      status: 'EDITING',
    });
    await onReload();
    notify('success', 'Clip duplicated');
  };

  const handleDeleteCurrentClip = async () => {
    if (!selectedClip) return;
    await deleteClipRecord(selectedClip.clipId);
    onSelectClip(null);
    await onReload();
    notify('success', 'Clip removed');
  };

  const handleExportRenderedMp4 = async () => {
    if (!selectedClip || !profile || !sourceBlob) {
      notify('error', 'Source media unavailable', 'Upload or reload the source video first.');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setRendering(true);
    setRenderProgress(5);
    setRenderStage('Initializing FFmpeg.wasm export...');

    const exportId = makeId('exp');
    await createExportRecord({
      exportId,
      ownerId: profile.uid,
      clipId: selectedClip.clipId,
      format: 'MP4',
      resolution: exportResolution,
      aspectRatio: editorState.aspectRatio,
      storagePath: `local://export_${exportId}`,
      fileSize: 0,
      status: 'RENDERING',
    });

    try {
      const result = await renderClipWithFFmpeg({
        sourceBlob,
        startTime: editorState.startTime,
        endTime: editorState.endTime,
        aspectRatio: editorState.aspectRatio,
        resolution: exportResolution,
        reframe: editorState.reframe,
        muted: editorState.muted,
        volume: editorState.volume,
        captions: editorState.segments,
        captionStyle: editorState.captionStyle,
        watermark: editorState.watermark,
        signal: controller.signal,
        onProgress: (pct, stage) => {
          setRenderProgress(pct);
          setRenderStage(stage);
        },
      });

      const localKey = `export_${exportId}`;
      await saveLocalMediaBlob(localKey, result.blob);
      const uploaded = await uploadBlobToR2IfConfigured({
        blob: result.blob,
        fileName: `${editorState.title.replace(/[^a-zA-Z0-9_-]/g, '_')}_${exportResolution}.mp4`,
        contentType: 'video/mp4',
        folder: 'exports',
        localKey,
      });

      await updateExportRecord(exportId, {
        storagePath: uploaded.storagePath,
        fileSize: result.blob.size,
        status: 'COMPLETED',
      });
      await updateClipRecord(selectedClip.clipId, {
        clipStoragePath: uploaded.storagePath,
        status: 'EXPORTED',
      });
      await recordUsage({
        ownerId: profile.uid,
        operation: 'EDITOR_EXPORT',
        resourceType: 'EXPORT',
        resourceAmount: 1,
      });
      await createNotification({
        ownerId: profile.uid,
        type: 'EXPORT_COMPLETED',
        title: 'Export Completed',
        message: `"${editorState.title}" rendered (${exportResolution} MP4, ${(
          result.blob.size /
          (1024 * 1024)
        ).toFixed(1)} MB).`,
      });

      triggerBlobDownload(
        result.blob,
        `${editorState.title.replace(/[^a-zA-Z0-9_-]/g, '_')}_${exportResolution}.mp4`
      );
      await onReload();
      notify('success', 'MP4 rendered and downloaded');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export rendering failed.';
      await updateExportRecord(exportId, { status: 'FAILED', errorMessage: msg }).catch(() => {});
      notify('error', 'Export failed', msg);
    } finally {
      setRendering(false);
    }
  };

  if (!selectedClip) {
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] p-12 text-center">
        <Scissors className="w-9 h-9 text-slate-400 mx-auto mb-3" />
        <h2 className="font-bold text-lg text-slate-900 dark:text-white">
          Select a clip to launch the Video Editor
        </h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Generate clips from a source video first, then open any clip here for trimming, reframing, caption styling, and MP4 export.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] p-3.5">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <select
            value={selectedClip.clipId}
            onChange={(e) => {
              const found = clips.find((c) => c.clipId === e.target.value) || null;
              onSelectClip(found);
            }}
            className="max-w-xs px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold truncate"
          >
            {clips.map((c) => (
              <option key={c.clipId} value={c.clipId}>
                {c.title} ({c.aspectRatio})
              </option>
            ))}
          </select>

          <input
            type="text"
            value={editorState.title}
            onChange={(e) => commitChange((p) => ({ ...p, title: e.target.value }))}
            className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold min-w-[160px]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleUndo}
            disabled={historyPast.length === 0}
            title="Undo"
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={historyFuture.length === 0}
            title="Redo"
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Redo2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleDuplicateClip}
            title="Duplicate clip"
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Copy className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleDeleteCurrentClip}
            title="Delete clip"
            className="p-2 rounded-lg border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleSaveProjectChanges}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Saving...' : 'Save'}
          </button>

          <select
            value={exportResolution}
            onChange={(e) => setExportResolution(e.target.value as ExportResolution)}
            className="px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold"
          >
            <option value="720p">720p MP4</option>
            {limits.allow1080pExport && <option value="1080p">1080p MP4</option>}
          </select>

          <button
            type="button"
            onClick={handleExportRenderedMp4}
            disabled={rendering}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold disabled:opacity-60"
          >
            {rendering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            {rendering ? `Exporting ${renderProgress}%` : 'Export MP4'}
          </button>
        </div>
      </div>

      {rendering && (
        <div className="rounded-xl border border-purple-200 dark:border-purple-900/60 bg-purple-50/70 dark:bg-purple-950/30 p-3 flex items-center justify-between gap-4 text-xs">
          <span>{renderStage}</span>
          <div className="flex items-center gap-3">
            <span className="font-mono font-bold tabular-nums">{renderProgress}%</span>
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="text-red-600 dark:text-red-400 font-semibold hover:underline"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Main Split Workspace: Canvas Preview + Inspector */}
      <div className="grid lg:grid-cols-12 gap-5">
        {/* Video Canvas Preview */}
        <div
          ref={previewContainerRef}
          className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-[#24283B] bg-slate-950 p-4 flex flex-col justify-between min-h-[430px]"
        >
          <div className="flex-1 flex items-center justify-center relative overflow-hidden">
            {videoUrl ? (
              <>
                <video
                  ref={videoRef}
                  src={videoUrl}
                  playsInline
                  onTimeUpdate={() => {
                    const v = videoRef.current;
                    if (!v) return;
                    setCurrentTime(v.currentTime);
                    if (v.currentTime >= editorState.endTime && !v.paused) {
                      v.pause();
                      v.currentTime = editorState.startTime;
                      setPlaying(false);
                    }
                  }}
                  onEnded={() => setPlaying(false)}
                  className="hidden"
                />
                <canvas
                  ref={canvasRef}
                  className="max-h-[380px] max-w-full rounded-xl border border-white/10 shadow-2xl"
                />
              </>
            ) : (
              <p className="text-xs text-slate-400">
                Loading source media from local cache / storage...
              </p>
            )}
          </div>

          {/* Playback Controls */}
          <div className="mt-4 pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-3 text-white">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={togglePlay}
                className="w-9 h-9 rounded-lg bg-purple-600 hover:bg-purple-700 flex items-center justify-center"
              >
                {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>
              <span className="font-mono text-xs tabular-nums">
                {formatTimecode(currentTime)} / {formatTimecode(sourceDuration)}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => commitChange((p) => ({ ...p, muted: !p.muted }))}
                className="p-1.5 rounded-lg hover:bg-white/10"
              >
                {editorState.muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={editorState.muted ? 0 : editorState.volume}
                onChange={(e) =>
                  commitChange((p) => ({ ...p, muted: false, volume: Number(e.target.value) }))
                }
                className="w-24 accent-purple-500"
              />
              <button
                type="button"
                onClick={() => previewContainerRef.current?.requestFullscreen?.()}
                title="Fullscreen preview"
                className="p-1.5 rounded-lg hover:bg-white/10"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Editing Inspector */}
        <div className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] flex flex-col overflow-hidden">
          <div className="grid grid-cols-4 border-b border-slate-200 dark:border-[#24283B] text-xs font-semibold">
            {(
              [
                { id: 'captions', label: 'Captions', icon: Captions },
                { id: 'reframe', label: 'Reframe', icon: Crop },
                { id: 'trim', label: 'Trim', icon: Scissors },
                { id: 'brand', label: 'Brand', icon: Palette },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`py-3 flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
                    activeTab === tab.id
                      ? 'border-purple-600 text-purple-600 dark:text-purple-400'
                      : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          <div className="p-4 space-y-4 overflow-y-auto max-h-[430px]">
            {activeTab === 'captions' && (
              <>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs font-semibold">
                    <input
                      type="checkbox"
                      checked={editorState.captionStyle.enabled}
                      onChange={(e) =>
                        commitChange((p) => ({
                          ...p,
                          captionStyle: { ...p.captionStyle, enabled: e.target.checked },
                        }))
                      }
                    />
                    Enable Captions
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        triggerBlobDownload(
                          new Blob([exportSegmentsToSRT(editorState.segments)], { type: 'text/plain' }),
                          `${editorState.title}.srt`
                        )
                      }
                      className="text-[11px] font-semibold text-purple-600 dark:text-purple-400 hover:underline"
                    >
                      Export SRT
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        triggerBlobDownload(
                          new Blob([exportSegmentsToVTT(editorState.segments)], { type: 'text/vtt' }),
                          `${editorState.title}.vtt`
                        )
                      }
                      className="text-[11px] font-semibold text-purple-600 dark:text-purple-400 hover:underline"
                    >
                      Export VTT
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">
                    Caption Preset
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {CAPTION_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() =>
                          commitChange((p) => ({
                            ...p,
                            captionStyle: { ...preset.config, enabled: true },
                          }))
                        }
                        className={`px-2.5 py-2 rounded-lg border text-left text-xs font-medium ${
                          editorState.captionStyle.preset === preset.id
                            ? 'border-purple-600 bg-purple-500/10 text-purple-600 dark:text-purple-300'
                            : 'border-slate-200 dark:border-[#24283B]'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Font Size</label>
                    <input
                      type="number"
                      min={18}
                      max={64}
                      value={editorState.captionStyle.fontSize}
                      onChange={(e) =>
                        commitChange((p) => ({
                          ...p,
                          captionStyle: { ...p.captionStyle, fontSize: Number(e.target.value) },
                        }))
                      }
                      className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Text Color</label>
                    <input
                      type="color"
                      value={editorState.captionStyle.textColor}
                      onChange={(e) =>
                        commitChange((p) => ({
                          ...p,
                          captionStyle: { ...p.captionStyle, textColor: e.target.value },
                        }))
                      }
                      className="w-full h-8 rounded-lg border border-slate-300 dark:border-slate-700"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Highlight</label>
                    <input
                      type="color"
                      value={editorState.captionStyle.highlightColor}
                      onChange={(e) =>
                        commitChange((p) => ({
                          ...p,
                          captionStyle: { ...p.captionStyle, highlightColor: e.target.value },
                        }))
                      }
                      className="w-full h-8 rounded-lg border border-slate-300 dark:border-slate-700"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Position</label>
                    <select
                      value={editorState.captionStyle.positionY}
                      onChange={(e) =>
                        commitChange((p) => ({
                          ...p,
                          captionStyle: {
                            ...p.captionStyle,
                            positionY: e.target.value as CaptionStyleConfig['positionY'],
                          },
                        }))
                      }
                      className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                    >
                      <option value="bottom">Bottom</option>
                      <option value="middle">Center</option>
                      <option value="top">Top</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Font Family</label>
                    <select
                      value={editorState.captionStyle.fontFamily}
                      onChange={(e) =>
                        commitChange((p) => ({
                          ...p,
                          captionStyle: { ...p.captionStyle, fontFamily: e.target.value },
                        }))
                      }
                      className="w-full px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                    >
                      <option value="Plus Jakarta Sans">Plus Jakarta Sans</option>
                      <option value="Bricolage Grotesque">Bricolage Grotesque</option>
                      <option value="JetBrains Mono">JetBrains Mono</option>
                    </select>
                  </div>
                </div>

                {/* Subtitle Segments Editor */}
                <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-[#24283B]">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">Transcript Lines</span>
                    <button
                      type="button"
                      onClick={() =>
                        commitChange((p) => ({
                          ...p,
                          segments: [
                            ...p.segments,
                            {
                              id: `seg_${Date.now()}`,
                              start: Number(currentTime.toFixed(2)),
                              end: Number(Math.min(sourceDuration, currentTime + 3).toFixed(2)),
                              text: 'New subtitle line',
                            },
                          ],
                        }))
                      }
                      className="text-[11px] font-semibold text-purple-600 dark:text-purple-400 hover:underline"
                    >
                      + Add Line
                    </button>
                  </div>
                  {editorState.segments.map((seg, idx) => (
                    <div
                      key={seg.id}
                      className="p-2 rounded-lg border border-slate-200 dark:border-[#24283B] space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-[11px] font-mono text-slate-500">
                        <span>
                          {formatTimecode(seg.start)} → {formatTimecode(seg.end)}
                        </span>
                        <button
                          type="button"
                          onClick={() => seekTo(seg.start)}
                          className="text-purple-600 dark:text-purple-400 hover:underline"
                        >
                          Jump
                        </button>
                      </div>
                      <input
                        type="text"
                        value={seg.text}
                        onChange={(e) =>
                          commitChange((p) => ({
                            ...p,
                            segments: p.segments.map((item, i) =>
                              i === idx ? { ...item, text: e.target.value } : item
                            ),
                          }))
                        }
                        className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                      />
                    </div>
                  ))}
                </div>
              </>
            )}

            {activeTab === 'reframe' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">
                    Aspect Ratio
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['9:16', '16:9', '1:1'] as AspectRatioOption[]).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => commitChange((p) => ({ ...p, aspectRatio: r }))}
                        className={`py-2 rounded-lg border text-xs font-semibold tabular-nums ${
                          editorState.aspectRatio === r
                            ? 'border-purple-600 bg-purple-500/10 text-purple-600 dark:text-purple-300'
                            : 'border-slate-200 dark:border-[#24283B]'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">
                    Framing Mode
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        { id: 'fill', label: 'Fill Frame (Crop)' },
                        { id: 'fit', label: 'Fit Frame + Blur' },
                        { id: 'center', label: 'Center Crop' },
                        { id: 'custom', label: 'Manual Position' },
                      ] as const
                    ).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() =>
                          commitChange((p) => ({
                            ...p,
                            reframe: { ...p.reframe, mode: m.id },
                          }))
                        }
                        className={`py-2 px-2.5 rounded-lg border text-xs font-medium ${
                          editorState.reframe.mode === m.id
                            ? 'border-purple-600 bg-purple-500/10 text-purple-600 dark:text-purple-300'
                            : 'border-slate-200 dark:border-[#24283B]'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="flex justify-between text-[11px] text-slate-500 mb-1">
                    <span>Zoom</span>
                    <span className="font-mono">{editorState.reframe.zoom.toFixed(2)}×</span>
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={2.4}
                    step={0.05}
                    value={editorState.reframe.zoom}
                    onChange={(e) =>
                      commitChange((p) => ({
                        ...p,
                        reframe: { ...p.reframe, zoom: Number(e.target.value) },
                      }))
                    }
                    className="w-full accent-purple-600"
                  />
                </div>

                <div>
                  <label className="flex justify-between text-[11px] text-slate-500 mb-1">
                    <span>Manual Subject Horizontal Offset</span>
                    <span className="font-mono">{editorState.reframe.offsetX}%</span>
                  </label>
                  <input
                    type="range"
                    min={-50}
                    max={50}
                    step={1}
                    value={editorState.reframe.offsetX}
                    onChange={(e) =>
                      commitChange((p) => ({
                        ...p,
                        reframe: { ...p.reframe, mode: 'custom', offsetX: Number(e.target.value) },
                      }))
                    }
                    className="w-full accent-purple-600"
                  />
                </div>

                <div>
                  <label className="flex justify-between text-[11px] text-slate-500 mb-1">
                    <span>Manual Subject Vertical Offset</span>
                    <span className="font-mono">{editorState.reframe.offsetY}%</span>
                  </label>
                  <input
                    type="range"
                    min={-50}
                    max={50}
                    step={1}
                    value={editorState.reframe.offsetY}
                    onChange={(e) =>
                      commitChange((p) => ({
                        ...p,
                        reframe: { ...p.reframe, mode: 'custom', offsetY: Number(e.target.value) },
                      }))
                    }
                    className="w-full accent-purple-600"
                  />
                </div>

                <label className="flex items-center gap-2 text-xs font-medium">
                  <input
                    type="checkbox"
                    checked={editorState.reframe.backgroundBlur}
                    onChange={(e) =>
                      commitChange((p) => ({
                        ...p,
                        reframe: { ...p.reframe, backgroundBlur: e.target.checked },
                      }))
                    }
                  />
                  Enable Blurred Pillarboxes (when Fit mode is active)
                </label>
              </div>
            )}

            {activeTab === 'trim' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Start (sec)</label>
                    <input
                      type="number"
                      step={0.1}
                      min={0}
                      max={editorState.endTime - 0.5}
                      value={editorState.startTime}
                      onChange={(e) =>
                        commitChange((p) => ({
                          ...p,
                          startTime: Math.max(0, Math.min(Number(e.target.value), p.endTime - 0.5)),
                        }))
                      }
                      className="w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">End (sec)</label>
                    <input
                      type="number"
                      step={0.1}
                      min={editorState.startTime + 0.5}
                      max={sourceDuration}
                      value={editorState.endTime}
                      onChange={(e) =>
                        commitChange((p) => ({
                          ...p,
                          endTime: Math.min(sourceDuration, Math.max(Number(e.target.value), p.startTime + 0.5)),
                        }))
                      }
                      className="w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleSplitAtPlayhead}
                  className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold"
                >
                  <Scissors className="w-4 h-4" />
                  Split Clip at Playhead ({formatTimecode(currentTime)})
                </button>
              </div>
            )}

            {activeTab === 'brand' && (
              <div className="space-y-4">
                {brandKits.length > 0 && (
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">
                      Apply Saved Brand Kit
                    </label>
                    <div className="space-y-1.5">
                      {brandKits.map((kit) => (
                        <button
                          key={kit.brandKitId}
                          type="button"
                          onClick={() => {
                            commitChange((p) => ({
                              ...p,
                              captionStyle: { ...kit.captionSettings },
                              watermark: { ...kit.watermarkSettings },
                            }));
                            notify('success', `Applied "${kit.name}" Brand Kit`);
                          }}
                          className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-slate-200 dark:border-[#24283B] hover:bg-slate-50 dark:hover:bg-slate-900 text-xs font-semibold"
                        >
                          <span>{kit.name}</span>
                          <span className="text-purple-600 dark:text-purple-400">Apply</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <label className="flex items-center gap-2 text-xs font-semibold">
                  <input
                    type="checkbox"
                    checked={editorState.watermark.enabled}
                    onChange={(e) =>
                      commitChange((p) => ({
                        ...p,
                        watermark: { ...p.watermark, enabled: e.target.checked },
                      }))
                    }
                  />
                  Show Custom Watermark
                </label>

                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">Watermark Text</label>
                  <input
                    type="text"
                    value={editorState.watermark.text}
                    onChange={(e) =>
                      commitChange((p) => ({
                        ...p,
                        watermark: { ...p.watermark, text: e.target.value },
                      }))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">Position</label>
                  <select
                    value={editorState.watermark.position}
                    onChange={(e) =>
                      commitChange((p) => ({
                        ...p,
                        watermark: {
                          ...p.watermark,
                          position: e.target.value as WatermarkConfig['position'],
                        },
                      }))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                  >
                    <option value="top-left">Top Left</option>
                    <option value="top-right">Top Right</option>
                    <option value="bottom-left">Bottom Left</option>
                    <option value="bottom-right">Bottom Right</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Multi-Track Interactive Timeline */}
      <div className="rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-4 font-mono tabular-nums text-slate-600 dark:text-slate-300">
            <span>In: {formatTimecode(editorState.startTime)}</span>
            <span>Out: {formatTimecode(editorState.endTime)}</span>
            <span>Duration: {(editorState.endTime - editorState.startTime).toFixed(1)}s</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-500">Timeline Zoom</span>
            <input
              type="range"
              min={1}
              max={4}
              step={0.25}
              value={timelineZoom}
              onChange={(e) => setTimelineZoom(Number(e.target.value))}
              className="w-24 accent-purple-600"
            />
          </div>
        </div>

        <div className="overflow-x-auto pb-2">
          <div
            ref={timelineRef}
            onPointerMove={handleTimelinePointerMove}
            onPointerUp={() => {
              dragHandleRef.current = null;
            }}
            onPointerLeave={() => {
              dragHandleRef.current = null;
            }}
            style={{ width: `${timelineZoom * 100}%`, minWidth: '100%' }}
            className="relative select-none space-y-2 rounded-xl bg-slate-100 dark:bg-slate-900/80 p-3 border border-slate-200 dark:border-[#24283B]"
          >
            {/* Video Track with Draggable Trim Boundaries */}
            <div className="relative h-12 rounded-lg bg-slate-200 dark:bg-slate-800 overflow-hidden">
              <div
                style={{
                  left: `${(editorState.startTime / Math.max(1, sourceDuration)) * 100}%`,
                  width: `${
                    ((editorState.endTime - editorState.startTime) / Math.max(1, sourceDuration)) *
                    100
                  }%`,
                }}
                className="absolute top-0 bottom-0 bg-purple-600/25 border-y-2 border-purple-600 flex items-center justify-between"
              >
                <div
                  onPointerDown={() => {
                    dragHandleRef.current = 'start';
                  }}
                  title="Drag start trim"
                  className="w-3 h-full bg-purple-600 cursor-ew-resize shrink-0"
                />
                <span className="text-[11px] font-semibold text-purple-950 dark:text-purple-100 truncate px-2">
                  Video Track · {editorState.title}
                </span>
                <div
                  onPointerDown={() => {
                    dragHandleRef.current = 'end';
                  }}
                  title="Drag end trim"
                  className="w-3 h-full bg-purple-600 cursor-ew-resize shrink-0"
                />
              </div>
            </div>

            {/* Audio Track */}
            <div className="relative h-8 rounded-lg bg-slate-200/80 dark:bg-slate-800/70 flex items-center px-3 text-[11px] text-slate-500">
              <span>
                Audio Track ({editorState.muted ? 'Muted' : `${Math.round(editorState.volume * 100)}% gain`})
              </span>
            </div>

            {/* Caption Track */}
            <div className="relative h-9 rounded-lg bg-slate-200/80 dark:bg-slate-800/70 overflow-hidden">
              {editorState.segments.map((seg) => (
                <button
                  key={seg.id}
                  type="button"
                  onClick={() => seekTo(seg.start)}
                  style={{
                    left: `${(seg.start / Math.max(1, sourceDuration)) * 100}%`,
                    width: `${Math.max(2, ((seg.end - seg.start) / Math.max(1, sourceDuration)) * 100)}%`,
                  }}
                  title={seg.text}
                  className="absolute top-1 bottom-1 rounded bg-purple-600/25 border border-purple-500/50 text-[10px] px-1 truncate text-purple-900 dark:text-purple-200 text-left"
                >
                  {seg.text}
                </button>
              ))}
            </div>

            {/* Draggable Playhead Cursor */}
            <div
              onPointerDown={() => {
                dragHandleRef.current = 'playhead';
              }}
              style={{
                left: `${(currentTime / Math.max(1, sourceDuration)) * 100}%`,
              }}
              className="absolute top-0 bottom-0 w-0.5 bg-red-500 cursor-ew-resize z-10"
            >
              <div className="w-3 h-3 -ml-[5px] rounded-full bg-red-500" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
