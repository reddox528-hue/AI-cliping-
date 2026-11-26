import { useState } from 'react';
import { Copy, Film, FolderKanban, PlusCircle, Search, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  createProject,
  deleteProjectRecord,
  deleteSourceVideo,
  updateProject,
} from '../../services/firebase/firestoreService';
import { deleteLocalMediaBlob } from '../../services/storage/localMediaStore';
import { formatTimecode } from '../../services/video/videoAnalysis';
import type { ProjectRecord, SourceVideoRecord } from '../../types/clipora';

export function ProjectsPage({
  projects,
  onReload,
  onGoCreate,
  onGoClips,
}: {
  projects: ProjectRecord[];
  onReload: () => Promise<void>;
  onGoCreate: () => void;
  onGoClips: () => void;
}) {
  const { profile } = useAuth();
  const { notify } = useToast();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [deleteTarget, setDeleteTarget] = useState<ProjectRecord | null>(null);
  const [busy, setBusy] = useState(false);

  const filtered = projects.filter((p) => {
    const matchesSearch = p.projectName.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'ALL' || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleDuplicate = async (proj: ProjectRecord) => {
    if (!profile) return;
    try {
      await createProject({
        ownerId: profile.uid,
        projectName: `${proj.projectName} (Copy)`,
      });
      await onReload();
      notify('success', 'Project duplicated');
    } catch (err) {
      notify('error', 'Duplicate failed', err instanceof Error ? err.message : String(err));
    }
  };

  const handleRename = async (proj: ProjectRecord) => {
    const next = proj.projectName.endsWith('Edited')
      ? proj.projectName
      : `${proj.projectName} · Edited`;
    try {
      await updateProject(proj.projectId, { projectName: next });
      await onReload();
      notify('success', 'Project updated');
    } catch (err) {
      notify('error', 'Update failed', err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await deleteProjectRecord(deleteTarget.projectId);
      setDeleteTarget(null);
      await onReload();
      notify('success', 'Project deleted');
    } catch (err) {
      notify('error', 'Delete failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-950 dark:text-white">
            My Projects
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Organize, duplicate, and revisit your video clipping workspaces.
          </p>
        </div>
        <button
          type="button"
          onClick={onGoCreate}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shrink-0"
        >
          <PlusCircle className="w-4 h-4" />
          New Project
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects..."
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0E1424] text-sm"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0E1424] text-sm"
        >
          <option value="ALL">All Statuses</option>
          <option value="READY">Ready</option>
          <option value="PROCESSING">Processing</option>
          <option value="DRAFT">Draft</option>
          <option value="FAILED">Failed</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E1424] p-12 text-center">
          <FolderKanban className="w-8 h-8 text-slate-400 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-900 dark:text-white">No projects found</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Create a new project by uploading a long-form video.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E1424] overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
              <tr>
                <th className="py-3 px-4 font-semibold">Project Name</th>
                <th className="py-3 px-4 font-semibold">Status</th>
                <th className="py-3 px-4 font-semibold">Updated</th>
                <th className="py-3 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((proj) => (
                <tr key={proj.projectId} className="hover:bg-slate-50/70 dark:hover:bg-slate-900/40">
                  <td className="py-3 px-4 font-medium text-slate-900 dark:text-white">
                    {proj.projectName}
                  </td>
                  <td className="py-3 px-4 text-xs font-mono">{proj.status}</td>
                  <td className="py-3 px-4 text-xs text-slate-500 tabular-nums">
                    {new Date(proj.updatedAt).toLocaleString()}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={onGoClips}
                        className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        Clips
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRename(proj)}
                        className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        Mark Edited
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDuplicate(proj)}
                        title="Duplicate project"
                        className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(proj)}
                        title="Delete project"
                        className="p-1.5 rounded-lg border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Project"
        description={`Delete "${deleteTarget?.projectName}"? Metadata will be removed from Firestore.`}
        confirmLabel="Delete"
        destructive
        loading={busy}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export function VideosPage({
  videos,
  onReload,
  onGoCreate,
}: {
  videos: SourceVideoRecord[];
  onReload: () => Promise<void>;
  onGoCreate: () => void;
}) {
  const { notify } = useToast();
  const [deleteTarget, setDeleteTarget] = useState<SourceVideoRecord | null>(null);
  const [busy, setBusy] = useState(false);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await deleteSourceVideo(deleteTarget.videoId);
      await deleteLocalMediaBlob(`video_${deleteTarget.videoId}`).catch(() => {});
      setDeleteTarget(null);
      await onReload();
      notify('success', 'Source video deleted');
    } catch (err) {
      notify('error', 'Delete failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-950 dark:text-white">
            My Videos
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Uploaded and imported source footage metadata and storage locations.
          </p>
        </div>
        <button
          type="button"
          onClick={onGoCreate}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shrink-0"
        >
          <PlusCircle className="w-4 h-4" />
          Upload Video
        </button>
      </div>

      {videos.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E1424] p-12 text-center">
          <Film className="w-8 h-8 text-slate-400 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-900 dark:text-white">No source videos yet</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E1424] overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
              <tr>
                <th className="py-3 px-4 font-semibold">File Name</th>
                <th className="py-3 px-4 font-semibold">Resolution</th>
                <th className="py-3 px-4 font-semibold">Duration</th>
                <th className="py-3 px-4 font-semibold">Size</th>
                <th className="py-3 px-4 font-semibold">Storage</th>
                <th className="py-3 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {videos.map((v) => (
                <tr key={v.videoId} className="hover:bg-slate-50/70 dark:hover:bg-slate-900/40">
                  <td className="py-3 px-4 font-medium text-slate-900 dark:text-white">
                    {v.fileName}
                  </td>
                  <td className="py-3 px-4 text-xs font-mono tabular-nums">
                    {v.width}×{v.height}
                  </td>
                  <td className="py-3 px-4 text-xs font-mono tabular-nums">
                    {formatTimecode(v.duration)}
                  </td>
                  <td className="py-3 px-4 text-xs font-mono tabular-nums">
                    {(v.fileSize / (1024 * 1024)).toFixed(1)} MB
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-500">
                    {v.storagePath.startsWith('r2://') ? 'Cloudflare R2' : 'Local Browser Cache'}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(v)}
                      className="p-1.5 rounded-lg border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Source Video"
        description={`Remove "${deleteTarget?.fileName}" from your library and clear its local browser cache?`}
        confirmLabel="Delete"
        destructive
        loading={busy}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
