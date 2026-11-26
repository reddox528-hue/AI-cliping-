import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  CheckSquare,
  Download,
  Play,
  Scissors,
  Search,
  Sliders,
  Square,
  Trash2,
} from 'lucide-react';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  createExportRecord,
  deleteClipRecord,
  makeId,
  recordUsage,
  updateExportRecord,
} from '../../services/firebase/firestoreService';
import {
  deleteLocalMediaBlob,
  resolveMediaBlob,
  saveLocalMediaBlob,
  uploadBlobToR2IfConfigured,
} from '../../services/storage/localMediaStore';
import { bundleClipsAsZip, triggerBlobDownload } from '../../services/video/ffmpegEngine';
import { exportSegmentsToSRT, formatTimecode } from '../../services/video/videoAnalysis';
import type { ClipRecord, TranscriptRecord } from '../../types/clipora';

type SortOption = 'score' | 'shortest' | 'longest' | 'newest' | 'oldest';

interface GeneratedClipsPageProps {
  clips: ClipRecord[];
  transcripts: TranscriptRecord[];
  onReload: () => Promise<void>;
  onOpenEditor: (clip: ClipRecord) => void;
  onGoCreate: () => void;
}

export function GeneratedClipsPage({
  clips,
  transcripts,
  onReload,
  onOpenEditor,
  onGoCreate,
}: GeneratedClipsPageProps) {
  const { profile } = useAuth();
  const { notify } = useToast();

  const [search, setSearch] = useState('');
  const [ratioFilter, setRatioFilter] = useState<'ALL' | '9:16' | '16:9' | '1:1'>('ALL');
  const [sortBy, setSortBy] = useState<SortOption>('score');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [previewClip, setPreviewClip] = useState<ClipRecord | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ClipRecord | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    let url: string | null = null;
    if (!previewClip) {
      setPreviewUrl(null);
      return;
    }
    void (async () => {
      const blob = await resolveMediaBlob(
        previewClip.clipStoragePath,
        `clip_${previewClip.clipId}`
      );
      if (!active || !blob) return;
      url = URL.createObjectURL(blob);
      setPreviewUrl(url);
    })();
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [previewClip]);

  const sortedClips = useMemo(() => {
    const filtered = clips.filter((c) => {
      const matchesSearch =
        c.title.toLowerCase().includes(search.toLowerCase()) ||
        (c.topic || '').toLowerCase().includes(search.toLowerCase()) ||
        c.description.toLowerCase().includes(search.toLowerCase());
      const matchesRatio = ratioFilter === 'ALL' || c.aspectRatio === ratioFilter;
      return matchesSearch && matchesRatio;
    });

    return [...filtered].sort((a, b) => {
      if (sortBy === 'score') return b.score - a.score;
      if (sortBy === 'shortest') return a.duration - b.duration;
      if (sortBy === 'longest') return b.duration - a.duration;
      if (sortBy === 'oldest') return a.createdAt.localeCompare(b.createdAt);
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [clips, search, ratioFilter, sortBy]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDownloadSingle = async (clip: ClipRecord) => {
    if (!profile) return;
    setBusy(true);
    try {
      const blob = await resolveMediaBlob(clip.clipStoragePath, `clip_${clip.clipId}`);
      if (!blob) {
        notify('error', 'Clip media not found locally', 'Re-render this clip inside the Video Editor.');
        return;
      }

      const exportId = makeId('exp');
      const localKey = `export_${exportId}`;
      await saveLocalMediaBlob(localKey, blob);
      const stored = await uploadBlobToR2IfConfigured({
        blob,
        fileName: `${clip.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.mp4`,
        contentType: 'video/mp4',
        folder: 'exports',
        localKey,
      });

      await createExportRecord({
        exportId,
        ownerId: profile.uid,
        clipId: clip.clipId,
        format: 'MP4',
        resolution: '720p',
        aspectRatio: clip.aspectRatio,
        storagePath: stored.storagePath,
        fileSize: blob.size,
        status: 'COMPLETED',
      });
      await recordUsage({
        ownerId: profile.uid,
        operation: 'EXPORT_CLIP',
        resourceType: 'EXPORT',
        resourceAmount: 1,
      });

      triggerBlobDownload(blob, `${clip.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.mp4`);
      await onReload();
      notify('success', 'MP4 exported & downloaded');
    } catch (err) {
      notify('error', 'Export failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadZip = async (targetClips: ClipRecord[]) => {
    if (!profile || targetClips.length === 0) return;
    setBusy(true);
    try {
      const zipItems: Array<{ fileName: string; blob: Blob; srtText?: string }> = [];
      for (const clip of targetClips) {
        const blob = await resolveMediaBlob(clip.clipStoragePath, `clip_${clip.clipId}`);
        if (!blob) continue;

        const transcript = transcripts.find((t) => t.sourceVideoId === clip.sourceVideoId);
        const relSegments = transcript
          ? transcript.timestampedSegments
              .filter((s) => s.end > clip.startTime && s.start < clip.endTime)
              .map((s) => ({
                ...s,
                start: Math.max(0, s.start - clip.startTime),
                end: Math.min(clip.duration, s.end - clip.startTime),
              }))
          : [];

        const exportId = makeId('exp');
        await createExportRecord({
          exportId,
          ownerId: profile.uid,
          clipId: clip.clipId,
          format: 'MP4',
          resolution: '720p',
          aspectRatio: clip.aspectRatio,
          storagePath: clip.clipStoragePath,
          fileSize: blob.size,
          status: 'COMPLETED',
        });

        zipItems.push({
          fileName: `${clip.title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)}_${clip.clipId.slice(-6)}.mp4`,
          blob,
          srtText: relSegments.length ? exportSegmentsToSRT(relSegments) : undefined,
        });
      }

      if (zipItems.length === 0) {
        notify('error', 'No cached MP4 blobs found for selected clips.');
        return;
      }

      const zipBlob = await bundleClipsAsZip(zipItems);
      triggerBlobDownload(zipBlob, `reddox_clipora_clips_${Date.now()}.zip`);
      await onReload();
      notify('success', 'ZIP archive downloaded', `${zipItems.length} clips packaged with SRT subtitles.`);
    } catch (err) {
      await updateExportRecord(makeId('exp'), { status: 'FAILED' }).catch(() => {});
      notify('error', 'ZIP packaging failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await deleteClipRecord(deleteTarget.clipId);
      await deleteLocalMediaBlob(`clip_${deleteTarget.clipId}`).catch(() => {});
      setDeleteTarget(null);
      if (previewClip?.clipId === deleteTarget.clipId) setPreviewClip(null);
      await onReload();
      notify('success', 'Clip deleted');
    } catch (err) {
      notify('error', 'Delete failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const selectedList = sortedClips.filter((c) => selectedIds.has(c.clipId));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-950 dark:text-white">
            Generated Clips
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Ranked by estimated engagement quality score (0–100). Open any clip in the editor or batch export as ZIP.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {selectedList.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => handleDownloadZip(selectedList)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold disabled:opacity-60"
            >
              <Archive className="w-4 h-4" />
              Download Selected ZIP ({selectedList.length})
            </button>
          )}
          {sortedClips.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => handleDownloadZip(sortedClips)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold disabled:opacity-60"
            >
              <Download className="w-4 h-4" />
              Download All ZIP
            </button>
          )}
        </div>
      </div>

      {/* Filters & Sort */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clip title, topic, or hook..."
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0E1424] text-sm"
          />
        </div>

        <select
          value={ratioFilter}
          onChange={(e) => setRatioFilter(e.target.value as typeof ratioFilter)}
          className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0E1424] text-sm"
        >
          <option value="ALL">All Aspect Ratios</option>
          <option value="9:16">9:16 Portrait</option>
          <option value="16:9">16:9 Landscape</option>
          <option value="1:1">1:1 Square</option>
        </select>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortOption)}
          className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0E1424] text-sm"
        >
          <option value="score">Sort: Highest Quality Score</option>
          <option value="shortest">Sort: Shortest Duration</option>
          <option value="longest">Sort: Longest Duration</option>
          <option value="newest">Sort: Newest</option>
          <option value="oldest">Sort: Oldest</option>
        </select>
      </div>

      {previewClip && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E1424] p-5 grid md:grid-cols-12 gap-6 items-center">
          <div className="md:col-span-5 bg-slate-950 rounded-xl overflow-hidden flex items-center justify-center max-h-80">
            {previewUrl ? (
              <video src={previewUrl} controls autoPlay className="max-h-80 w-auto" />
            ) : (
              <div className="py-16 text-xs text-slate-400">Loading clip preview...</div>
            )}
          </div>
          <div className="md:col-span-7 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-bold text-lg text-slate-900 dark:text-white">
                {previewClip.title}
              </h2>
              <button
                type="button"
                onClick={() => setPreviewClip(null)}
                className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white"
              >
                Close Preview
              </button>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {formatTimecode(previewClip.startTime)}–{formatTimecode(previewClip.endTime)} ({previewClip.duration.toFixed(1)}s) · {previewClip.aspectRatio} · Estimated Quality Score {previewClip.score}/100
            </p>
            {previewClip.hook && (
              <p className="text-sm text-slate-700 dark:text-slate-300">
                <span className="font-semibold">Opening hook:</span> {previewClip.hook}
              </p>
            )}
            {previewClip.reason && (
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {previewClip.reason}
              </p>
            )}
            <div className="pt-2 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => onOpenEditor(previewClip)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
              >
                <Sliders className="w-3.5 h-3.5" />
                Open in Video Editor
              </button>
              <button
                type="button"
                onClick={() => handleDownloadSingle(previewClip)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold"
              >
                <Download className="w-3.5 h-3.5" />
                Export MP4
              </button>
            </div>
          </div>
        </div>
      )}

      {sortedClips.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E1424] p-12 text-center">
          <Scissors className="w-8 h-8 text-slate-400 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-900 dark:text-white">
            No generated clips yet
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Upload a video and run AI moment detection to generate clips.
          </p>
          <button
            type="button"
            onClick={onGoCreate}
            className="mt-4 px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-semibold"
          >
            Create New Clips
          </button>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {sortedClips.map((clip) => {
            const checked = selectedIds.has(clip.clipId);
            return (
              <div
                key={clip.clipId}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E1424] p-5 flex flex-col justify-between gap-4"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => toggleSelect(clip.clipId)}
                      aria-label={`Select ${clip.title}`}
                      className="text-slate-400 hover:text-blue-600 mt-0.5 shrink-0"
                    >
                      {checked ? (
                        <CheckSquare className="w-4 h-4 text-blue-600" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-sm text-slate-900 dark:text-white leading-snug">
                        {clip.title}
                      </h3>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                        {formatTimecode(clip.startTime)}–{formatTimecode(clip.endTime)} ·{' '}
                        {clip.duration.toFixed(1)}s · {clip.aspectRatio}
                      </p>
                    </div>
                    <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400 tabular-nums shrink-0">
                      {clip.score}/100
                    </span>
                  </div>

                  <p className="mt-3 text-xs text-slate-600 dark:text-slate-400 leading-relaxed line-clamp-3">
                    {clip.description || clip.reason}
                  </p>
                </div>

                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPreviewClip(clip)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold"
                    >
                      <Play className="w-3 h-3" />
                      Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenEditor(clip)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
                    >
                      <Sliders className="w-3 h-3" />
                      Edit
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleDownloadSingle(clip)}
                      title="Export MP4"
                      className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(clip)}
                      title="Delete clip"
                      className="p-1.5 rounded-lg border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Generated Clip"
        description={`Delete "${deleteTarget?.title}" and remove its cached MP4 file?`}
        confirmLabel="Delete"
        destructive
        loading={busy}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
