import { GoogleGenAI, Type } from '@google/genai';
import { env, isGeminiConfigured } from '../config/env.ts';

const ALLOWED_TEXT_MODELS = new Set([
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
]);

function getGeminiClient(): GoogleGenAI {
  if (!isGeminiConfigured()) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Add your Gemini API key in Settings > Secrets or use manual transcript/clip creation.'
    );
  }
  return new GoogleGenAI({
    apiKey: env.geminiApiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface TimestampedSegment {
  id: string;
  start: number;
  end: number;
  text: string;
}

export interface ClipCandidateInput {
  transcriptText: string;
  timestampedSegments: TimestampedSegment[];
  frames: Array<{ timestamp: number; base64Jpeg: string }>;
  videoDuration: number;
  minDuration: number;
  maxDuration: number;
  maxClips: number;
  analysisInstructions?: string;
  modelId?: string;
}

export interface GeneratedClipCandidate {
  startTime: number;
  endTime: number;
  duration: number;
  title: string;
  description: string;
  hook: string;
  topic: string;
  score: number;
  reason: string;
}

export async function transcribeAudioWithGemini(params: {
  audioBase64: string;
  mimeType: string;
  videoDuration: number;
  languageHint?: string;
}): Promise<{
  transcriptText: string;
  segments: TimestampedSegment[];
  language: string;
}> {
  const ai = getGeminiClient();

  const transcribeResp = await ai.models.generateContent({
    model: 'gemini-3.5-transcribe',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: params.mimeType,
            data: params.audioBase64,
          },
        },
        {
          text: `Transcribe all spoken dialogue accurately${
            params.languageHint ? ` (language hint: ${params.languageHint})` : ''
          }. Return clean verbatim text.`,
        },
      ],
    },
  });

  const rawText = (transcribeResp.text || '').trim();
  if (!rawText) {
    throw new Error(
      'No intelligible speech was detected in the audio track. Try uploading an SRT/VTT file or entering a transcript manually.'
    );
  }

  // Segment the transcript with approximate sentence boundaries bounded by videoDuration
  const sentences = rawText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const safeDuration = Math.max(1, params.videoDuration);
  const totalChars = Math.max(1, sentences.reduce((sum, s) => sum + s.length, 0));

  let cursor = 0;
  const segments: TimestampedSegment[] = sentences.map((sentence, idx) => {
    const share = (sentence.length / totalChars) * safeDuration;
    const start = Number(cursor.toFixed(2));
    const end =
      idx === sentences.length - 1
        ? Number(safeDuration.toFixed(2))
        : Number(Math.min(safeDuration, cursor + Math.max(0.8, share)).toFixed(2));
    cursor = end;
    return {
      id: `seg_${idx + 1}`,
      start,
      end: Math.max(start + 0.4, end),
      text: sentence,
    };
  });

  return {
    transcriptText: rawText,
    segments,
    language: params.languageHint || 'en',
  };
}

export async function analyzeVideoMomentsWithGemini(
  input: ClipCandidateInput
): Promise<GeneratedClipCandidate[]> {
  const ai = getGeminiClient();

  const selectedModel =
    input.modelId && ALLOWED_TEXT_MODELS.has(input.modelId)
      ? input.modelId
      : 'gemini-4-hydrogen';

  const formattedTranscript =
    input.timestampedSegments.length > 0
      ? input.timestampedSegments
          .map((seg) => `[${seg.start.toFixed(1)}s - ${seg.end.toFixed(1)}s] ${seg.text}`)
          .join('\n')
      : input.transcriptText;

  const promptText = [
    `You are an expert short-form video editor selecting standalone, engaging moments from a ${input.videoDuration.toFixed(
      1
    )}-second video.`,
    `Select up to ${input.maxClips} distinct, non-overlapping clips.`,
    `Duration constraints: each clip MUST have startTime >= 0, endTime <= ${input.videoDuration.toFixed(
      1
    )}, and duration between ${input.minDuration}s and ${input.maxDuration}s.`,
    `Quality rules:`,
    `- Never cut sentences in half; start at a natural opening hook and end at a complete thought.`,
    `- Avoid dead air or repetitive clips covering the exact same point.`,
    `- Score each clip 0-100 as an estimated engagement quality score (hook strength, clarity, story completeness, educational/emotional value). Never claim guaranteed virality.`,
    input.analysisInstructions
      ? `Additional administrator instructions: ${input.analysisInstructions}`
      : '',
    `Timestamped Transcript:\n${formattedTranscript.slice(0, 60000)}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const parts: Array<
    | { text: string }
    | { inlineData: { mimeType: string; data: string } }
  > = [{ text: promptText }];

  for (const frame of input.frames.slice(0, 6)) {
    if (frame.base64Jpeg) {
      parts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: frame.base64Jpeg,
        },
      });
    }
  }

  const response = await ai.models.generateContent({
    model: selectedModel,
    contents: { parts },
    config: {
      systemInstruction:
        'Return strictly valid JSON matching the requested schema. Every clip timestamp must lie within the video duration and reflect genuine transcript moments.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            startTime: { type: Type.NUMBER, description: 'Clip start in seconds.' },
            endTime: { type: Type.NUMBER, description: 'Clip end in seconds.' },
            title: { type: Type.STRING, description: 'Concise descriptive title.' },
            description: { type: Type.STRING, description: 'Short 1-2 sentence summary.' },
            hook: { type: Type.STRING, description: 'Opening hook phrase.' },
            topic: { type: Type.STRING, description: 'Primary subject topic.' },
            score: { type: Type.INTEGER, description: 'Estimated engagement quality score 0-100.' },
            reason: { type: Type.STRING, description: 'Why this moment works as a standalone clip.' },
          },
          required: ['startTime', 'endTime', 'title', 'description', 'hook', 'topic', 'score', 'reason'],
        },
      },
    },
  });

  const rawJson = (response.text || '[]').trim();
  const parsed = JSON.parse(rawJson) as Array<Partial<GeneratedClipCandidate>>;
  if (!Array.isArray(parsed)) {
    throw new Error('Gemini returned an unexpected clip format.');
  }

  const sanitized: GeneratedClipCandidate[] = [];
  for (const item of parsed) {
    const startTime = Math.max(0, Number(item.startTime ?? 0));
    const endTime = Math.min(input.videoDuration, Number(item.endTime ?? 0));
    const duration = Number((endTime - startTime).toFixed(2));
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || duration < 3) {
      continue;
    }

    // Check against duplicates (>75% overlap with existing clip)
    const overlaps = sanitized.some((existing) => {
      const interStart = Math.max(existing.startTime, startTime);
      const interEnd = Math.min(existing.endTime, endTime);
      const inter = Math.max(0, interEnd - interStart);
      return inter / Math.min(existing.duration, duration) > 0.75;
    });
    if (overlaps) continue;

    sanitized.push({
      startTime: Number(startTime.toFixed(2)),
      endTime: Number(endTime.toFixed(2)),
      duration,
      title: String(item.title || 'Selected Clip').slice(0, 180),
      description: String(item.description || '').slice(0, 1000),
      hook: String(item.hook || '').slice(0, 350),
      topic: String(item.topic || 'General').slice(0, 100),
      score: Math.max(0, Math.min(100, Math.round(Number(item.score ?? 70)))),
      reason: String(item.reason || '').slice(0, 750),
    });
  }

  return sanitized.slice(0, input.maxClips);
}
