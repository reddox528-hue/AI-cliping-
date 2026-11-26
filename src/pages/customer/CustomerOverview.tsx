import {
  Activity,
  ArrowRight,
  Download,
  Film,
  FolderKanban,
  PlusCircle,
  Scissors,
  Sliders,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import type { CustomerRoute } from '../../layouts/DashboardLayout';
import { formatTimecode } from '../../services/video/videoAnalysis';
import type {
  ClipRecord,
  ExportRecord,
  ProcessingJobRecord,
  ProjectRecord,
  SourceVideoRecord,
  UsageRecord,
} from '../../types/clipora';

interface CustomerOverviewProps {
  projects: ProjectRecord[];
  videos: SourceVideoRecord[];
  clips: ClipRecord[];
  exportsList: ExportRecord[];
  jobs: ProcessingJobRecord[];
  usageRecords: UsageRecord[];
  loading: boolean;
  onNavigate: (route: CustomerRoute) => void;
  onOpenClipInEditor: (clip: ClipRecord) => void;
}

export function CustomerOverview({
  projects,
  videos,
  clips,
  exportsList,
  jobs,
  usageRecords,
  loading,
  onNavigate,
  onOpenClipInEditor,
}: CustomerOverviewProps) {
  const { profile, limits } = useAuth();

  const completedExports = exportsList.filter((e) => e.status === 'COMPLETED').length;
  const activeJobs = jobs.filter(
    (j) => !['COMPLETED', 'FAILED', 'CANCELLED'].includes(j.status)
  ).length;

  const todayPrefix = new Date().toISOString().slice(0, 10);
  const aiRequestsToday = usageRecords
    .filter((u) => u.resourceType === 'AI_REQUEST' && u.createdAt.startsWith(todayPrefix))
    .reduce((sum, u) => sum + u.resourceAmount, 0);
  const remainingAiToday = Math.max(0, limits.dailyAiRequestAllowance - aiRequestsToday);

  const statCards = [
    { label: 'Total Projects', value: projects.length, icon: FolderKanban },
    { label: 'Videos Uploaded', value: videos.length, icon: Film },
    { label: 'Clips Generated', value: clips.length, icon: Scissors },
    { label: 'Completed Exports', value: completedExports, icon: Download },
    { label: 'Active Jobs', value: activeJobs, icon: Activity },
    {
      label: 'AI Requests Left Today',
      value: `${remainingAiToday} / ${limits.dailyAiRequestAllowance}`,
      icon: PlusCircle,
    },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-950 dark:text-white">
            Welcome back, {profile?.displayName}
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            All metrics reflect your live Firestore workspace records and daily processing allowance.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('create')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors whitespace-nowrap"
          >
            <PlusCircle className="w-4 h-4" />
            Create New Clips
          </button>
          <button
            type="button"
            onClick={() => onNavigate('editor')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-semibold transition-colors whitespace-nowrap"
          >
            <Sliders className="w-4 h-4" />
            Open Video Editor
          </button>
        </div>
      </div>

      {/* Real Database Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E1424] p-4"
            >
              <div className="flex items-center justify-between text-slate-400 mb-3">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  {card.label}
                </span>
                <Icon className="w-4 h-4 shrink-0" />
              </div>
              <p className="text-2xl font-bold tabular-nums text-slate-950 dark:text-white">
                {loading ? '—' : card.value}
              </p>
            </div>
          );
        })}
      </div>

      <div className="grid lg:grid-cols-12 gap-6">
        {/* Recent Projects */}
        <div className="lg:col-span-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E1424] p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-base text-slate-900 dark:text-white">
              Recent Projects
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('projects')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
            >
              View all
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 rounded-xl bg-slate-100 dark:bg-slate-800/60 animate-pulse" />
              ))}
            </div>
          ) : projects.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No projects yet. Upload a video or import a direct URL to begin.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('create')}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold"
              >
                Start First Project
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {projects.slice(0, 5).map((proj) => (
                <div key={proj.projectId} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                      {proj.projectName}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {proj.status} · Updated {new Date(proj.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate('clips')}
                    className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline shrink-0"
                  >
                    Open
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Generated Clips */}
        <div className="lg:col-span-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E1424] p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-base text-slate-900 dark:text-white">
              Recent Generated Clips
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('clips')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
            >
              View all
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 rounded-xl bg-slate-100 dark:bg-slate-800/60 animate-pulse" />
              ))}
            </div>
          ) : clips.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Generated clips will appear here after running AI analysis and FFmpeg rendering.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {clips.slice(0, 5).map((clip) => (
                <div key={clip.clipId} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                      {clip.title}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                      {formatTimecode(clip.startTime)}–{formatTimecode(clip.endTime)} · {clip.aspectRatio} · Quality Score {clip.score}/100
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenClipInEditor(clip)}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                  >
                    Edit
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
