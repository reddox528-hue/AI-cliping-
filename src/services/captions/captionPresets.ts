import type {
  CaptionPresetId,
  CaptionStyleConfig,
  ReframeConfig,
  TranscriptSegment,
  WatermarkConfig,
} from '../../types/clipora';

export interface CaptionPresetMeta {
  id: CaptionPresetId;
  label: string;
  description: string;
  config: CaptionStyleConfig;
}

export const CAPTION_PRESETS: CaptionPresetMeta[] = [
  {
    id: 'modern-bold',
    label: 'Modern Bold',
    description: 'High-impact geometric sans with dark backdrop plate.',
    config: {
      enabled: true,
      preset: 'modern-bold',
      fontFamily: 'Bricolage Grotesque',
      fontSize: 36,
      textColor: '#FFFFFF',
      highlightColor: '#3B82F6',
      backgroundColor: '#090D16',
      backgroundOpacity: 0.78,
      positionY: 'bottom',
      uppercase: false,
    },
  },
  {
    id: 'creator-style',
    label: 'Creator Style',
    description: 'Uppercase punchy phrases with electric violet accent.',
    config: {
      enabled: true,
      preset: 'creator-style',
      fontFamily: 'Plus Jakarta Sans',
      fontSize: 38,
      textColor: '#F8FAFC',
      highlightColor: '#8B5CF6',
      backgroundColor: '#0F172A',
      backgroundOpacity: 0.65,
      positionY: 'middle',
      uppercase: true,
    },
  },
  {
    id: 'minimal-clean',
    label: 'Minimal Clean',
    description: 'Subtle translucent pill-free caption with soft shadow.',
    config: {
      enabled: true,
      preset: 'minimal-clean',
      fontFamily: 'Plus Jakarta Sans',
      fontSize: 28,
      textColor: '#F8FAFC',
      highlightColor: '#60A5FA',
      backgroundColor: '#000000',
      backgroundOpacity: 0.35,
      positionY: 'bottom',
      uppercase: false,
    },
  },
  {
    id: 'karaoke-highlight',
    label: 'Karaoke Highlight',
    description: 'Word-progress accent tint when word timestamps are available.',
    config: {
      enabled: true,
      preset: 'karaoke-highlight',
      fontFamily: 'Bricolage Grotesque',
      fontSize: 36,
      textColor: '#FFFFFF',
      highlightColor: '#FACC15',
      backgroundColor: '#0B1120',
      backgroundOpacity: 0.82,
      positionY: 'bottom',
      uppercase: false,
    },
  },
  {
    id: 'professional-subtitle',
    label: 'Professional Subtitle',
    description: 'Broadcast-grade lower-third subtitle strip.',
    config: {
      enabled: true,
      preset: 'professional-subtitle',
      fontFamily: 'Plus Jakarta Sans',
      fontSize: 26,
      textColor: '#F1F5F9',
      highlightColor: '#38BDF8',
      backgroundColor: '#020617',
      backgroundOpacity: 0.85,
      positionY: 'bottom',
      uppercase: false,
    },
  },
  {
    id: 'high-contrast',
    label: 'High Contrast',
    description: 'WCAG AAA contrast block for noisy backgrounds.',
    config: {
      enabled: true,
      preset: 'high-contrast',
      fontFamily: 'Plus Jakarta Sans',
      fontSize: 32,
      textColor: '#090D16',
      highlightColor: '#2563EB',
      backgroundColor: '#FFFFFF',
      backgroundOpacity: 0.96,
      positionY: 'bottom',
      uppercase: false,
    },
  },
];

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return `rgba(11, 17, 32, ${alpha})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

export function drawCaptionOverlayOnCanvas(params: {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  segment: TranscriptSegment;
  currentTimeSec: number;
  style: CaptionStyleConfig;
}): void {
  const { ctx, width, height, segment, currentTimeSec, style } = params;
  if (!style.enabled || !segment.text.trim()) return;

  const scaleFactor = width / 720;
  const fontSize = Math.round(style.fontSize * Math.max(0.65, scaleFactor));
  ctx.save();
  ctx.font = `700 ${fontSize}px "${style.fontFamily}", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  const displayText = style.uppercase ? segment.text.toUpperCase() : segment.text;
  const maxWidth = width * 0.84;
  const lines = wrapLines(ctx, displayText, maxWidth);
  if (!lines.length) {
    ctx.restore();
    return;
  }

  const lineHeight = fontSize * 1.28;
  const blockHeight = lines.length * lineHeight + fontSize * 0.6;
  const widestLine = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const boxWidth = Math.min(width * 0.9, widestLine + fontSize * 1.1);

  let centerY = height * 0.82;
  if (style.positionY === 'top') centerY = height * 0.16;
  if (style.positionY === 'middle') centerY = height * 0.52;

  const boxX = (width - boxWidth) / 2;
  const boxY = centerY - blockHeight / 2;

  if (style.backgroundOpacity > 0.02) {
    ctx.fillStyle = hexToRgba(style.backgroundColor, style.backgroundOpacity);
    const radius = Math.round(10 * Math.max(0.65, scaleFactor));
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxWidth, blockHeight, radius);
    ctx.fill();
  }

  // Karaoke or progressive word highlight when word timestamps or segment progress exist
  const words = displayText.split(/\s+/).filter(Boolean);
  const segDur = Math.max(0.2, segment.end - segment.start);
  const progress = Math.max(0, Math.min(1, (currentTimeSec - segment.start) / segDur));
  const activeWordIdx =
    segment.words && segment.words.length > 0
      ? segment.words.findIndex((w) => currentTimeSec >= w.start && currentTimeSec <= w.end)
      : Math.floor(progress * words.length);

  let globalWordIndex = 0;
  lines.forEach((line, lineIdx) => {
    const y = boxY + fontSize * 0.3 + lineHeight * (lineIdx + 0.5);
    if (style.preset === 'karaoke-highlight' || style.preset === 'creator-style') {
      const lineWords = line.split(' ');
      const totalW = ctx.measureText(line).width;
      let cursorX = width / 2 - totalW / 2;
      ctx.textAlign = 'left';
      for (let w = 0; w < lineWords.length; w++) {
        const wordStr = lineWords[w] + (w < lineWords.length - 1 ? ' ' : '');
        const isHighlighted = globalWordIndex === activeWordIdx;
        ctx.fillStyle = isHighlighted ? style.highlightColor : style.textColor;
        ctx.fillText(wordStr, cursorX, y);
        cursorX += ctx.measureText(wordStr).width;
        globalWordIndex += 1;
      }
      ctx.textAlign = 'center';
    } else {
      ctx.fillStyle = style.textColor;
      ctx.fillText(line, width / 2, y);
    }
  });

  ctx.restore();
}

export function drawWatermarkOnCanvas(params: {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  watermark: WatermarkConfig;
  logoImage?: HTMLImageElement | null;
}): void {
  const { ctx, width, height, watermark, logoImage } = params;
  if (!watermark.enabled) return;

  ctx.save();
  ctx.globalAlpha = Math.max(0.1, Math.min(1, watermark.opacity));
  const pad = Math.round(width * 0.04);

  if (logoImage && logoImage.complete && logoImage.naturalWidth > 0) {
    const logoW = Math.round(width * 0.16);
    const logoH = Math.round((logoImage.naturalHeight / logoImage.naturalWidth) * logoW);
    const x = watermark.position.includes('right') ? width - logoW - pad : pad;
    const y = watermark.position.includes('bottom') ? height - logoH - pad : pad;
    ctx.drawImage(logoImage, x, y, logoW, logoH);
  } else if (watermark.text.trim()) {
    const fontSize = Math.max(14, Math.round(width * 0.028));
    ctx.font = `600 ${fontSize}px "Bricolage Grotesque", sans-serif`;
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 6;
    const textW = ctx.measureText(watermark.text).width;
    const x = watermark.position.includes('right') ? width - textW - pad : pad;
    const y = watermark.position.includes('bottom') ? height - pad : pad + fontSize;
    ctx.fillText(watermark.text, x, y);
  }
  ctx.restore();
}

export function drawVideoFrameWithReframe(params: {
  ctx: CanvasRenderingContext2D;
  video: HTMLVideoElement;
  canvasWidth: number;
  canvasHeight: number;
  reframe: ReframeConfig;
}): void {
  const { ctx, video, canvasWidth, canvasHeight, reframe } = params;
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.fillStyle = '#070B14';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  if (reframe.mode === 'fit') {
    if (reframe.backgroundBlur) {
      ctx.save();
      ctx.filter = 'blur(22px) brightness(0.5)';
      const bgScale = Math.max(canvasWidth / vw, canvasHeight / vh);
      const bgW = vw * bgScale;
      const bgH = vh * bgScale;
      ctx.drawImage(video, (canvasWidth - bgW) / 2, (canvasHeight - bgH) / 2, bgW, bgH);
      ctx.restore();
    }
    const fitScale = Math.min(canvasWidth / vw, canvasHeight / vh) * reframe.zoom;
    const drawW = vw * fitScale;
    const drawH = vh * fitScale;
    const dx = (canvasWidth - drawW) / 2 + (reframe.offsetX / 100) * canvasWidth * 0.35;
    const dy = (canvasHeight - drawH) / 2 + (reframe.offsetY / 100) * canvasHeight * 0.35;
    ctx.drawImage(video, dx, dy, drawW, drawH);
    return;
  }

  // Fill / Center / Custom crop
  const fillScale = Math.max(canvasWidth / vw, canvasHeight / vh) * reframe.zoom;
  const drawW = vw * fillScale;
  const drawH = vh * fillScale;
  const maxShiftX = Math.max(0, (drawW - canvasWidth) / 2);
  const maxShiftY = Math.max(0, (drawH - canvasHeight) / 2);
  const shiftX = (reframe.offsetX / 50) * maxShiftX;
  const shiftY = (reframe.offsetY / 50) * maxShiftY;
  const dx = (canvasWidth - drawW) / 2 - shiftX;
  const dy = (canvasHeight - drawH) / 2 - shiftY;

  ctx.drawImage(video, dx, dy, drawW, drawH);
}
