export type UserRole = 'CUSTOMER' | 'ADMIN' | 'SUPER_ADMIN';
export type AccountStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
export type ThemePreference = 'light' | 'dark' | 'system';

export type AdminPermission =
  | 'VIEW_DASHBOARD'
  | 'MANAGE_CUSTOMERS'
  | 'REVIEW_APPROVALS'
  | 'MONITOR_PROJECTS'
  | 'MANAGE_PROCESSING'
  | 'MONITOR_USAGE_STORAGE'
  | 'CREATE_ADMINS';

export const DEFAULT_ADMIN_PERMISSIONS: AdminPermission[] = [
  'VIEW_DASHBOARD',
  'MANAGE_CUSTOMERS',
  'REVIEW_APPROVALS',
  'MONITOR_PROJECTS',
  'MANAGE_PROCESSING',
  'MONITOR_USAGE_STORAGE',
];

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string;
  role: UserRole;
  accountStatus: AccountStatus;
  permissions?: AdminPermission[];
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  approvedBy?: string;
  lastLoginAt?: string;
  themePreference: ThemePreference;
}

export type ProjectStatus = 'DRAFT' | 'PROCESSING' | 'READY' | 'ARCHIVED' | 'FAILED';

export interface ProjectRecord {
  projectId: string;
  ownerId: string;
  projectName: string;
  sourceVideoId?: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export type VideoProcessingStatus = 'LOCAL_READY' | 'UPLOADING' | 'STORED' | 'FAILED';

export interface SourceVideoRecord {
  videoId: string;
  ownerId: string;
  projectId: string;
  fileName: string;
  storagePath: string;
  duration: number;
  width: number;
  height: number;
  frameRate: number;
  fileSize: number;
  mimeType: string;
  processingStatus: VideoProcessingStatus;
  createdAt: string;
}

export type ProcessingJobStatus =
  | 'QUEUED'
  | 'VALIDATING'
  | 'TRANSCRIBING'
  | 'ANALYZING'
  | 'SELECTING_CLIPS'
  | 'RENDERING'
  | 'QUALITY_CHECK'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface ProcessingJobRecord {
  jobId: string;
  ownerId: string;
  projectId: string;
  sourceVideoId: string;
  status: ProcessingJobStatus;
  progress: number;
  currentStage: string;
  errorMessage?: string;
  executionMode: 'BROWSER_LOCAL' | 'HYBRID_CLOUD';
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export type AspectRatioOption = '9:16' | '16:9' | '1:1';
export type ClipStatus = 'CANDIDATE' | 'EDITING' | 'RENDERED' | 'EXPORTED';

export interface ClipRecord {
  clipId: string;
  ownerId: string;
  projectId: string;
  sourceVideoId: string;
  startTime: number;
  endTime: number;
  duration: number;
  title: string;
  description: string;
  hook?: string;
  topic?: string;
  reason?: string;
  score: number;
  clipStoragePath: string;
  aspectRatio: AspectRatioOption;
  status: ClipStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TranscriptSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  words?: Array<{ word: string; start: number; end: number }>;
}

export interface TranscriptRecord {
  transcriptId: string;
  ownerId: string;
  projectId: string;
  sourceVideoId: string;
  language: string;
  transcriptText: string;
  timestampGranularity: 'WORD' | 'SEGMENT' | 'MANUAL';
  timestampedSegments: TranscriptSegment[];
  createdAt: string;
}

export type ExportResolution = '720p' | '1080p';
export type ExportStatus = 'RENDERING' | 'COMPLETED' | 'FAILED';

export interface ExportRecord {
  exportId: string;
  ownerId: string;
  clipId: string;
  format: 'MP4';
  resolution: ExportResolution;
  aspectRatio: AspectRatioOption;
  storagePath: string;
  fileSize: number;
  status: ExportStatus;
  errorMessage?: string;
  createdAt: string;
}

export type CaptionPresetId =
  | 'modern-bold'
  | 'creator-style'
  | 'minimal-clean'
  | 'karaoke-highlight'
  | 'professional-subtitle'
  | 'high-contrast';

export interface CaptionStyleConfig {
  enabled: boolean;
  preset: CaptionPresetId;
  fontFamily: string;
  fontSize: number;
  textColor: string;
  highlightColor: string;
  backgroundColor: string;
  backgroundOpacity: number;
  positionY: 'top' | 'middle' | 'bottom';
  uppercase: boolean;
}

export interface ReframeConfig {
  mode: 'center' | 'custom' | 'fit' | 'fill';
  offsetX: number; // -50 to 50 %
  offsetY: number; // -50 to 50 %
  zoom: number; // 1.0 to 2.5
  backgroundBlur: boolean;
}

export interface WatermarkConfig {
  enabled: boolean;
  text: string;
  logoDataUrl?: string;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  opacity: number;
}

export interface BrandKitRecord {
  brandKitId: string;
  ownerId: string;
  name: string;
  logoPath: string;
  primaryColor: string;
  secondaryColor: string;
  captionSettings: CaptionStyleConfig;
  watermarkSettings: WatermarkConfig;
  createdAt: string;
  updatedAt: string;
}

export interface UsageRecord {
  recordId: string;
  ownerId: string;
  operation: string;
  resourceType: 'AI_REQUEST' | 'VIDEO_UPLOAD' | 'CLIP_RENDER' | 'EXPORT' | 'STORAGE_BYTES';
  resourceAmount: number;
  createdAt: string;
}

export interface SystemLimitsConfig {
  maxFileSizeMb: number;
  maxVideoDurationSec: number;
  maxProjectsPerUser: number;
  maxConcurrentBrowserJobs: number;
  dailyAiRequestAllowance: number;
  storageAllowanceMb: number;
  allow1080pExport: boolean;
}

export interface AIConfig {
  modelId: 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite';
  maxClipsPerRun: number;
  defaultMinClipSec: number;
  defaultMaxClipSec: number;
  analysisInstructions: string;
  prioritizeHooks: boolean;
}

export interface AuditLogRecord {
  logId: string;
  actorId: string;
  action: string;
  targetId: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}

export interface AppNotification {
  notificationId: string;
  ownerId: string;
  type:
    | 'ACCOUNT_STATUS'
    | 'VIDEO_UPLOAD'
    | 'AI_ANALYSIS'
    | 'CLIPS_GENERATED'
    | 'EXPORT_COMPLETED'
    | 'PROCESSING_FAILED';
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export const DEFAULT_CAPTION_STYLE: CaptionStyleConfig = {
  enabled: true,
  preset: 'modern-bold',
  fontFamily: 'Plus Jakarta Sans',
  fontSize: 34,
  textColor: '#FFFFFF',
  highlightColor: '#3B82F6',
  backgroundColor: '#0B1120',
  backgroundOpacity: 0.72,
  positionY: 'bottom',
  uppercase: false,
};

export const DEFAULT_REFRAME_CONFIG: ReframeConfig = {
  mode: 'fill',
  offsetX: 0,
  offsetY: 0,
  zoom: 1.0,
  backgroundBlur: true,
};

export const DEFAULT_LIMITS_CONFIG: SystemLimitsConfig = {
  maxFileSizeMb: 500,
  maxVideoDurationSec: 3600,
  maxProjectsPerUser: 25,
  maxConcurrentBrowserJobs: 1,
  dailyAiRequestAllowance: 30,
  storageAllowanceMb: 1024,
  allow1080pExport: true,
};

export const DEFAULT_AI_CONFIG: AIConfig = {
  modelId: 'gemini-4-hydrogen',
  maxClipsPerRun: 5,
  defaultMinClipSec: 15,
  defaultMaxClipSec: 60,
  analysisInstructions:
    'Prioritize standalone insights, compelling hooks, clear explanations, and complete stories with clean openings and closings.',
  prioritizeHooks: true,
};
