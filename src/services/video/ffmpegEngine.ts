import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import JSZip from 'jszip';
import type {
  AspectRatioOption,
  CaptionStyleConfig,
  ExportResolution,
  ReframeConfig,
  TranscriptSegment,
  WatermarkConfig,
} from '../../types/clipora';
import {
  drawCaptionOverlayOnCanvas,
  drawWatermarkOnCanvas,
} from '../captions/captionPresets';

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoadingPromise: Promise<FFmpeg> | null = null;

export async function getLoadedFFmpeg(
  onStatus?: (msg: string) => void
): Promise<FFmpeg> {
  if (ffmpegInstance && ffmpegInstance.loaded) {
    return ffmpegInstance;
  }
  if (ffmpegLoadingPromise) {
    return ffmpegLoadingPromise;
  }

  ffmpegLoadingPromise = (async () => {
    const ffmpeg = new FFmpeg();
    onStatus?.('Loading browser FFmpeg.wasm video engine...');
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  try {
    return await ffmpegLoadingPromise;
  } catch (err) {
    ffmpegLoadingPromise = null;
    throw new Error(
      `Failed to initialize FFmpeg.wasm in browser: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

export async function extractAudioMp3Base64(params: {
  sourceBlob: Blob;
  onProgress?: (pct: number) => void;
  signal?: AbortSignal;
}): Promise<{ audioBase64: string; mimeType: string }> {
  const ffmpeg = await getLoadedFFmpeg();
  if (params.signal?.aborted) throw new Error('Operation cancelled.');

  const inputName = 'input_source.mp4';
  const outputName = 'extracted_audio.mp3';

  const progressHandler = ({ progress }: { progress: number }) => {
    params.onProgress?.(Math.max(0, Math.min(100, Math.round(progress * 100))));
  };
  ffmpeg.on('progress', progressHandler);

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(params.sourceBlob));
    const exitCode = await ffmpeg.exec([
      '-i',
      inputName,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-b:a',
      '32k',
      '-t',
      '1800',
      outputName,
    ]);

    if (exitCode !== 0) {
      throw new Error('Could not extract an audio track from this video.');
    }

    const data = await ffmpeg.readFile(outputName);
    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
    if (bytes.byteLength === 0) {
      throw new Error('Extracted audio track was empty.');
    }

    // Convert Uint8Array to base64 safely in chunks
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return { audioBase64: btoa(binary), mimeType: 'audio/mp3' };
  } finally {
    ffmpeg.off('progress', progressHandler);
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});
  }
}

function getOutputDimensions(
  aspectRatio: AspectRatioOption,
  resolution: ExportResolution
): { width: number; height: number } {
  const high = resolution === '1080p';
  if (aspectRatio === '9:16') {
    return high ? { width: 1080, height: 1920 } : { width: 720, height: 1280 };
  }
  if (aspectRatio === '1:1') {
    return high ? { width: 1080, height: 1080 } : { width: 720, height: 720 };
  }
  return high ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
}

async function renderTransparentOverlayPng(params: {
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D) => void;
}): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = params.width;
  canvas.height = params.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');
  ctx.clearRect(0, 0, params.width, params.height);
  params.draw(ctx);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to generate overlay PNG.'))),
      'image/png'
    );
  });
  return new Uint8Array(await blob.arrayBuffer());
}

export async function renderClipWithFFmpeg(params: {
  sourceBlob: Blob;
  startTime: number;
  endTime: number;
  aspectRatio: AspectRatioOption;
  resolution: ExportResolution;
  reframe: ReframeConfig;
  muted: boolean;
  volume: number; // 0..2
  captions: TranscriptSegment[];
  captionStyle: CaptionStyleConfig;
  watermark: WatermarkConfig;
  onProgress?: (pct: number, stage: string) => void;
  signal?: AbortSignal;
}): Promise<{ blob: Blob; width: number; height: number }> {
  const ffmpeg = await getLoadedFFmpeg((msg) => params.onProgress?.(5, msg));
  if (params.signal?.aborted) throw new Error('Rendering cancelled.');

  const { width, height } = getOutputDimensions(params.aspectRatio, params.resolution);
  const clipDuration = Math.max(0.5, params.endTime - params.startTime);

  const inputName = 'render_input.mp4';
  const outputName = 'render_output.mp4';
  const overlayFiles: string[] = [];

  const progressHandler = ({ progress }: { progress: number }) => {
    const pct = Math.max(15, Math.min(96, Math.round(15 + progress * 80)));
    params.onProgress?.(pct, 'Encoding MP4 video clip...');
  };
  ffmpeg.on('progress', progressHandler);

  try {
    params.onProgress?.(10, 'Preparing source media in FFmpeg.wasm...');
    await ffmpeg.writeFile(inputName, await fetchFile(params.sourceBlob));

    if (params.signal?.aborted) throw new Error('Rendering cancelled.');

    // Build video filter pipeline for aspect ratio + reframe
    const zoom = Math.max(1, Math.min(2.5, params.reframe.zoom));
    let baseFilter = '';

    if (params.reframe.mode === 'fit') {
      if (params.reframe.backgroundBlur) {
        baseFilter =
          `[0:v]split=2[bg][fg];` +
          `[bg]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=18:2[bgb];` +
          `[fg]scale=${Math.round(width * zoom)}:${Math.round(
            height * zoom
          )}:force_original_aspect_ratio=decrease[fgs];` +
          `[bgb][fgs]overlay=(W-w)/2:(H-h)/2[base]`;
      } else {
        baseFilter = `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=#070B14[base]`;
      }
    } else {
      // Fill / center / custom position crop
      const scaledW = Math.round(width * zoom);
      const scaledH = Math.round(height * zoom);
      const xExpr = `max(0,min(iw-ow,(iw-ow)/2+(${(params.reframe.offsetX / 50).toFixed(
        3
      )})*(iw-ow)/2))`;
      const yExpr = `max(0,min(ih-oh,(ih-oh)/2+(${(params.reframe.offsetY / 50).toFixed(
        3
      )})*(ih-oh)/2))`;
      baseFilter = `[0:v]scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${width}:${height}:${xExpr}:${yExpr}[base]`;
    }

    // Prepare caption + watermark transparent PNG overlays (bounded to 18 overlays for browser RAM safety)
    const extraInputs: string[] = [];
    let currentLabel = '[base]';
    const overlaySteps: string[] = [];

    if (params.captionStyle.enabled) {
      const relevantCaptions = params.captions
        .filter((s) => s.end > params.startTime && s.start < params.endTime)
        .slice(0, 18);

      for (let i = 0; i < relevantCaptions.length; i++) {
        const seg = relevantCaptions[i];
        const relStart = Math.max(0, seg.start - params.startTime);
        const relEnd = Math.min(clipDuration, seg.end - params.startTime);
        if (relEnd <= relStart) continue;

        const pngBytes = await renderTransparentOverlayPng({
          width,
          height,
          draw: (ctx) =>
            drawCaptionOverlayOnCanvas({
              ctx,
              width,
              height,
              segment: seg,
              currentTimeSec: (seg.start + seg.end) / 2,
              style: params.captionStyle,
            }),
        });
        const fname = `cap_${i}.png`;
        overlayFiles.push(fname);
        await ffmpeg.writeFile(fname, pngBytes);
        const inputIdx = extraInputs.length / 2 + 1;
        extraInputs.push('-i', fname);
        const nextLabel = `[vcap${i}]`;
        overlaySteps.push(
          `${currentLabel}[${inputIdx}:v]overlay=0:0:enable='between(t,${relStart.toFixed(
            2
          )},${relEnd.toFixed(2)})'${nextLabel}`
        );
        currentLabel = nextLabel;
      }
    }

    if (params.watermark.enabled && (params.watermark.text.trim() || params.watermark.logoDataUrl)) {
      let logoImg: HTMLImageElement | null = null;
      if (params.watermark.logoDataUrl) {
        logoImg = new Image();
        logoImg.src = params.watermark.logoDataUrl;
        await new Promise<void>((res) => {
          logoImg!.onload = () => res();
          logoImg!.onerror = () => res();
        });
      }
      const wmBytes = await renderTransparentOverlayPng({
        width,
        height,
        draw: (ctx) =>
          drawWatermarkOnCanvas({
            ctx,
            width,
            height,
            watermark: params.watermark,
            logoImage: logoImg,
          }),
      });
      const wmName = 'watermark.png';
      overlayFiles.push(wmName);
      await ffmpeg.writeFile(wmName, wmBytes);
      const inputIdx = extraInputs.length / 2 + 1;
      extraInputs.push('-i', wmName);
      const nextLabel = '[vwm]';
      overlaySteps.push(`${currentLabel}[${inputIdx}:v]overlay=0:0${nextLabel}`);
      currentLabel = nextLabel;
    }

    const filterComplex = [baseFilter, ...overlaySteps].join(';');

    const args: string[] = [
      '-ss',
      params.startTime.toFixed(2),
      '-t',
      clipDuration.toFixed(2),
      '-i',
      inputName,
      ...extraInputs,
      '-filter_complex',
      filterComplex,
      '-map',
      currentLabel,
    ];

    if (params.muted) {
      args.push('-an');
    } else {
      args.push('-map', '0:a?');
      if (Math.abs(params.volume - 1) > 0.05) {
        args.push('-filter:a', `volume=${params.volume.toFixed(2)}`);
      }
      args.push('-c:a', 'aac', '-b:a', '128k');
    }

    args.push(
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      outputName
    );

    params.onProgress?.(18, 'Running FFmpeg.wasm clip render...');
    const exitCode = await ffmpeg.exec(args);
    if (exitCode !== 0) {
      throw new Error(`FFmpeg encoding exited with code ${exitCode}.`);
    }

    const outData = await ffmpeg.readFile(outputName);
    const bytes = outData instanceof Uint8Array ? outData : new TextEncoder().encode(String(outData));
    if (bytes.byteLength < 1024) {
      throw new Error('Rendered MP4 output was unexpectedly empty or corrupted.');
    }

    params.onProgress?.(100, 'Completed MP4 render');
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return {
      blob: new Blob([copy.buffer], { type: 'video/mp4' }),
      width,
      height,
    };
  } finally {
    ffmpeg.off('progress', progressHandler);
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});
    for (const f of overlayFiles) {
      await ffmpeg.deleteFile(f).catch(() => {});
    }
  }
}

export async function bundleClipsAsZip(
  items: Array<{ fileName: string; blob: Blob; srtText?: string }>
): Promise<Blob> {
  const zip = new JSZip();
  for (const item of items) {
    zip.file(item.fileName, item.blob);
    if (item.srtText) {
      const srtName = item.fileName.replace(/\.mp4$/i, '.srt');
      zip.file(srtName, item.srtText);
    }
  }
  return zip.generateAsync({ type: 'blob' });
}

export function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
