import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ToastProvider } from './contexts/ToastContext';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { DashboardLayout, type CustomerRoute } from './layouts/DashboardLayout';
import { AccountStatusGate, AuthPage } from './pages/auth/AuthPages';
import {
  AccountSettingsPage,
  BrandKitPage,
  ExportHistoryPage,
  HelpSupportPage,
} from './pages/customer/BrandKitExportsPages';
import { CreateClipsPage } from './pages/customer/CreateClipsPage';
import { CustomerOverview } from './pages/customer/CustomerOverview';
import { GeneratedClipsPage } from './pages/customer/GeneratedClipsPage';
import { ProjectsPage, VideosPage } from './pages/customer/ProjectsVideosPages';
import { VideoEditorPage } from './pages/customer/VideoEditorPage';
import { LandingPage } from './pages/public/LandingPage';
import {
  listBrandKitsByOwner,
  listClipsByOwner,
  listExportsByOwner,
  listProcessingJobsByOwner,
  listProjectsByOwner,
  listSourceVideosByOwner,
  listTranscriptsByOwner,
  listUsageByOwner,
} from './services/firebase/firestoreService';
import type {
  BrandKitRecord,
  ClipRecord,
  ExportRecord,
  ProcessingJobRecord,
  ProjectRecord,
  SourceVideoRecord,
  TranscriptRecord,
  UsageRecord,
} from './types/clipora';

const SecureAdminGate = React.lazy(() => import('./pages/admin/SecureAdminGate'));

function isControlPanelPath(pathname: string): boolean {
  const clean = pathname.replace(/\/+$/, '') || '/';
  return clean === '/secure-control-panel';
}

function CustomerWorkspaceApp({
  onNavigateAdminAccess,
}: {
  onNavigateAdminAccess: () => void;
}) {
  const { firebaseUser, profile, loading } = useAuth();
  const [publicView, setPublicView] = useState<'landing' | 'signin' | 'register'>('landing');
  const [customerRoute, setCustomerRoute] = useState<CustomerRoute>('overview');

  const [dataLoading, setDataLoading] = useState(false);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [videos, setVideos] = useState<SourceVideoRecord[]>([]);
  const [clips, setClips] = useState<ClipRecord[]>([]);
  const [transcripts, setTranscripts] = useState<TranscriptRecord[]>([]);
  const [exportsList, setExportsList] = useState<ExportRecord[]>([]);
  const [jobs, setJobs] = useState<ProcessingJobRecord[]>([]);
  const [brandKits, setBrandKits] = useState<BrandKitRecord[]>([]);
  const [usageRecords, setUsageRecords] = useState<UsageRecord[]>([]);
  const [editorClip, setEditorClip] = useState<ClipRecord | null>(null);

  const loadCustomerWorkspace = useCallback(async () => {
    if (!profile || profile.accountStatus !== 'APPROVED') return;
    setDataLoading(true);
    try {
      const [p, v, c, t, e, j, bk, u] = await Promise.all([
        listProjectsByOwner(profile.uid),
        listSourceVideosByOwner(profile.uid),
        listClipsByOwner(profile.uid),
        listTranscriptsByOwner(profile.uid),
        listExportsByOwner(profile.uid),
        listProcessingJobsByOwner(profile.uid),
        listBrandKitsByOwner(profile.uid),
        listUsageByOwner(profile.uid),
      ]);
      setProjects(p);
      setVideos(v);
      setClips(c);
      setTranscripts(t);
      setExportsList(e);
      setJobs(j);
      setBrandKits(bk);
      setUsageRecords(u);
    } finally {
      setDataLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    void loadCustomerWorkspace();
  }, [loadCustomerWorkspace]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#070B14] text-slate-600 dark:text-slate-300 text-sm">
        Initializing REDDOX Clipora AI...
      </div>
    );
  }

  if (!firebaseUser || !profile) {
    if (publicView === 'landing') {
      return (
        <LandingPage
          onNavigateAuth={(mode) => setPublicView(mode)}
          onNavigateAdminAccess={onNavigateAdminAccess}
        />
      );
    }
    return (
      <AuthPage
        initialMode={publicView}
        onBackHome={() => setPublicView('landing')}
      />
    );
  }

  if (profile.accountStatus !== 'APPROVED') {
    return <AccountStatusGate />;
  }

  const handleOpenClipInEditor = (clip: ClipRecord) => {
    setEditorClip(clip);
    setCustomerRoute('editor');
  };

  return (
    <DashboardLayout
      activeRoute={customerRoute}
      onSelectRoute={setCustomerRoute}
    >
      {customerRoute === 'overview' ? (
        <CustomerOverview
          projects={projects}
          videos={videos}
          clips={clips}
          exportsList={exportsList}
          jobs={jobs}
          usageRecords={usageRecords}
          loading={dataLoading}
          onNavigate={setCustomerRoute}
          onOpenClipInEditor={handleOpenClipInEditor}
        />
      ) : customerRoute === 'create' ? (
        <CreateClipsPage
          existingProjectsCount={projects.length}
          onCreated={loadCustomerWorkspace}
          onOpenClips={() => setCustomerRoute('clips')}
        />
      ) : customerRoute === 'projects' ? (
        <ProjectsPage
          projects={projects}
          onReload={loadCustomerWorkspace}
          onGoCreate={() => setCustomerRoute('create')}
          onGoClips={() => setCustomerRoute('clips')}
        />
      ) : customerRoute === 'videos' ? (
        <VideosPage
          videos={videos}
          onReload={loadCustomerWorkspace}
          onGoCreate={() => setCustomerRoute('create')}
        />
      ) : customerRoute === 'clips' ? (
        <GeneratedClipsPage
          clips={clips}
          transcripts={transcripts}
          onReload={loadCustomerWorkspace}
          onOpenEditor={handleOpenClipInEditor}
          onGoCreate={() => setCustomerRoute('create')}
        />
      ) : customerRoute === 'editor' ? (
        <VideoEditorPage
          clips={clips}
          videos={videos}
          transcripts={transcripts}
          brandKits={brandKits}
          activeClip={editorClip}
          onSelectClip={setEditorClip}
          onReload={loadCustomerWorkspace}
        />
      ) : customerRoute === 'brand-kit' ? (
        <BrandKitPage brandKits={brandKits} onReload={loadCustomerWorkspace} />
      ) : customerRoute === 'exports' ? (
        <ExportHistoryPage exportsList={exportsList} />
      ) : customerRoute === 'settings' ? (
        <AccountSettingsPage />
      ) : (
        <HelpSupportPage />
      )}
    </DashboardLayout>
  );
}

function AppRouter() {
  const [pathname, setPathname] = useState<string>(() => window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const redirectToCustomerHome = useCallback(() => {
    if (window.location.pathname !== '/') {
      window.history.replaceState(null, '', '/');
    }
    setPathname('/');
  }, []);

  const navigateToAdminAccess = useCallback(() => {
    if (window.location.pathname !== '/secure-control-panel') {
      window.history.pushState(null, '', '/secure-control-panel');
    }
    setPathname('/secure-control-panel');
  }, []);

  if (isControlPanelPath(pathname)) {
    return (
      <Suspense
        fallback={
          <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#070B14] text-slate-600 dark:text-slate-300 text-sm">
            Verifying session authorization...
          </div>
        }
      >
        <SecureAdminGate onRedirectCustomerHome={redirectToCustomerHome} />
      </Suspense>
    );
  }

  return <CustomerWorkspaceApp onNavigateAdminAccess={navigateToAdminAccess} />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <AppRouter />
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
