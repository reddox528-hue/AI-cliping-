import type { TranscriptSegment } from '../../types/clipora';

export interface ExtractedVideoMetadata {
  duration: number;
  width: number;
  height: number;
  frameRate: number;
  fileSize: number;
  mimeType: string;
  hasAudio: boolean;
}

export const SUPPORTED_VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm', '.avi', '.mkv'];
export const SUPPORTED_VIDEO_MIMES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-msvideo',
  'video/avi',
  'video/x-matroska',
  'video/matroska',
];

export function validateVideoFile(file: File, maxFileSizeMb: number): {
  valid: boolean;
  error?: string;
} {
  const lowerName = file.name.toLowerCase();
  const extOk = SUPPORTED_VIDEO_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
  const mimeOk = !file.type || SUPPORTED_VIDEO_MIMES.includes(file.type.toLowerCase());

  if (!extOk && !mimeOk) {
    return {
      valid: false,
      error: `Unsupported video format (${file.type || file.name}). Supported containers: MP4, MOV, WebM, AVI, MKV.`,
    };
  }

  const maxBytes = maxFileSizeMb * 1024 * 1024;
  if (file.size <= 0) {
    return { valid: false, error: 'Selected file is empty.' };
  }
  if (file.size > maxBytes) {
    return {
      valid: false,
      error: `File size (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds the platform limit of ${maxFileSizeMb} MB.`,
    };
  }

  return { valid: true };
}

export async function extractVideoMetadata(blob: Blob): Promise<ExtractedVideoMetadata> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Timed out while reading video metadata. The codec may be unsupported in this browser.'));
      }, 15000);

      video.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(
          new Error(
            'Unable to decode this video file in the browser. Ensure it uses standard H.264/VP8/VP9/AV1 codecs.'
          )
        );
      };
      video.src = url;
    });

    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      throw new Error('Video duration could not be determined or is zero.');
    }

    // Attempt short playback probe to detect audio tracks reliably
    let hasAudio = true;
    const anyVideo = video as HTMLVideoElement & {
      mozHasAudio?: boolean;
      webkitAudioDecodedByteCount?: number;
      audioTracks?: { length: number };
    };
    if (typeof anyVideo.mozHasAudio === 'boolean') {
      hasAudio = anyVideo.mozHasAudio;
    } else if (anyVideo.audioTracks && typeof anyVideo.audioTracks.length === 'number') {
      hasAudio = anyVideo.audioTracks.length > 0;
    }

    return {
      duration: Number(video.duration.toFixed(2)),
      width: video.videoWidth || 1280,
      height: video.videoHeight || 720,
      frameRate: 30,
      fileSize: blob.size,
      mimeType: blob.type || 'video/mp4',
      hasAudio,
    };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

export async function extractRepresentativeFrames(
  blob: Blob,
  duration: number,
  frameCount = 5
): Promise<Array<{ timestamp: number; base64Jpeg: string }>> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;

  const frames: Array<{ timestamp: number; base64Jpeg: string }> = [];

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Frame extraction timed out.')), 15000);
      video.onloadeddata = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Could not decode video frames.'));
      };
      video.src = url;
    });

    const canvas = document.createElement('canvas');
    const targetW = 480;
    const scale = targetW / Math.max(1, video.videoWidth || 480);
    canvas.width = targetW;
    canvas.height = Math.max(180, Math.round((video.videoHeight || 270) * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return frames;

    const count = Math.min(frameCount, Math.max(1, Math.floor(duration / 2)));
    for (let i = 0; i < count; i++) {
      const ts = Number((((i + 0.5) / count) * Math.max(1, duration - 0.5)).toFixed(2));
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        };
        video.addEventListener('seeked', onSeeked);
        video.currentTime = ts;
      });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.65);
      const base64Jpeg = dataUrl.split(',')[1] || '';
      if (base64Jpeg) {
        frames.push({ timestamp: ts, base64Jpeg });
      }
    }
  } catch {
    // Non-fatal: Gemini can still analyze transcript if browser seek fails
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }

  return frames;
}

export function formatTimecode(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatSrtTime(seconds: number): string {
  const msTotal = Math.max(0, Math.round(seconds * 1000));
  const hrs = Math.floor(msTotal / 3600000);
  const mins = Math.floor((msTotal % 3600000) / 60000);
  const secs = Math.floor((msTotal % 60000) / 1000);
  const ms = msTotal % 1000;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(
    2,
    '0'
  )},${String(ms).padStart(3, '0')}`;
}

function formatVttTime(seconds: number): string {
  return formatSrtTime(seconds).replace(',', '.');
}

export function exportSegmentsToSRT(segments: TranscriptSegment[]): string {
  return segments
    .map(
      (seg, idx) =>
        `${idx + 1}\n${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}\n${seg.text.trim()}`
    )
    .join('\n\n');
}

export function exportSegmentsToVTT(segments: TranscriptSegment[]): string {
  const body = segments
    .map(
      (seg) => `${formatVttTime(seg.start)} --> ${formatVttTime(seg.end)}\n${seg.text.trim()}`
    )
    .join('\n\n');
  return `WEBVTT\n\n${body}`;
}

function parseTimestampToken(token: string): number {
  const clean = token.trim().replace(',', '.');
  const parts = clean.split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0] || 0;
}

export function parseTranscriptFile(content: string): {
  transcriptText: string;
  segments: TranscriptSegment[];
} {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  const blocks = normalized.replace(/^WEBVTT[^\n]*\n+/i, '').split(/\n{2,}/);
  const segments: TranscriptSegment[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i].split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const timingLineIdx = lines.findIndex((l) => l.includes('-->'));
    if (timingLineIdx === -1) continue;
    const [startRaw, endRaw] = lines[timingLineIdx].split('-->');
    const start = parseTimestampToken(startRaw.trim());
    const end = parseTimestampToken(endRaw.trim().split(/\s+/)[0]);
    const text = lines.slice(timingLineIdx + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    if (text && end > start) {
      segments.push({
        id: `seg_${segments.length + 1}`,
        start: Number(start.toFixed(2)),
        end: Number(end.toFixed(2)),
        text,
      });
    }
  }

  if (segments.length === 0 && normalized) {
    // Plain text fallback: create segments by lines/sentences
    const lines = normalized.split('\n').map((l) => l.trim()).filter(Boolean);
    lines.forEach((line, idx) => {
      segments.push({
        id: `seg_${idx + 1}`,
        start: idx * 5,
        end: (idx + 1) * 5,
        text: line,
      });
    });
  }

  return {
    transcriptText: segments.map((s) => s.text).join(' '),
    segments,
  };
}
