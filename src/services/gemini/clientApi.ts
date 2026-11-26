import type { ClipRecord, TranscriptSegment } from '../../types/clipora';
import { auth } from '../firebase/client';

export async function getAuthHeaders(forceRefresh = false): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('You must be signed in to perform this action.');
  }
  const token = await user.getIdToken(forceRefresh);
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export interface ServerCapabilities {
  ok: boolean;
  geminiConfigured: boolean;
  r2Configured: boolean;
  emailConfigured: boolean;
}

export async function fetchServerCapabilities(): Promise<ServerCapabilities> {
  const res = await fetch('/api/health');
  if (!res.ok) {
    throw new Error('Backend server is unreachable.');
  }
  return res.json();
}

export async function probeRemoteVideoUrl(url: string): Promise<{
  ok: boolean;
  url?: string;
  contentType?: string;
  contentLength?: number;
  corsReadable?: boolean;
  error?: string;
}> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/videos/probe-url', {
    method: 'POST',
    headers,
    body: JSON.stringify({ url }),
  });
  return res.json();
}

export async function transcribeAudioViaServer(params: {
  audioBase64: string;
  mimeType: string;
  videoDuration: number;
  languageHint?: string;
}): Promise<{
  transcriptText: string;
  segments: TranscriptSegment[];
  language: string;
}> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/ai/transcribe', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Transcription request failed.');
  }
  return data;
}

export async function analyzeVideoViaServer(params: {
  transcriptText: string;
  timestampedSegments: TranscriptSegment[];
  frames: Array<{ timestamp: number; base64Jpeg: string }>;
  videoDuration: number;
  minDuration: number;
  maxDuration: number;
  maxClips: number;
  analysisInstructions?: string;
  modelId?: string;
}): Promise<
  Array<
    Pick<
      ClipRecord,
      'startTime' | 'endTime' | 'duration' | 'title' | 'description' | 'hook' | 'topic' | 'score' | 'reason'
    >
  >
> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/ai/analyze-clips', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Gemini AI clip analysis failed.');
  }
  return data.clips || [];
}
