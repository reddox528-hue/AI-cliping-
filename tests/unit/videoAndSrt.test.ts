import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  exportSegmentsToSRT,
  exportSegmentsToVTT,
  formatTimecode,
  parseTranscriptFile,
  validateVideoFile,
} from '../../src/services/video/videoAnalysis.ts';
import { isBlockedIp, validatePublicVideoUrl } from '../../server/security/ssrf.ts';
import type { TranscriptSegment } from '../../src/types/clipora.ts';

describe('Video & Transcript Utilities', () => {
  const sampleSegments: TranscriptSegment[] = [
    { id: 'seg_1', start: 0, end: 4.5, text: 'Welcome to REDDOX Clipora AI.' },
    { id: 'seg_2', start: 4.5, end: 11.25, text: 'Turn long videos into vertical clips.' },
  ];

  it('formats timecodes accurately for short and multi-hour durations', () => {
    assert.equal(formatTimecode(0), '00:00');
    assert.equal(formatTimecode(65), '01:05');
    assert.equal(formatTimecode(3665), '1:01:05');
  });

  it('exports valid SRT and WebVTT subtitles and round-trips via parser', () => {
    const srt = exportSegmentsToSRT(sampleSegments);
    assert.match(srt, /1\n00:00:00,000 --> 00:00:04,500\nWelcome to REDDOX Clipora AI\./);
    assert.match(srt, /2\n00:00:04,500 --> 00:00:11,250\nTurn long videos into vertical clips\./);

    const parsedFromSrt = parseTranscriptFile(srt);
    assert.equal(parsedFromSrt.segments.length, 2);
    assert.equal(parsedFromSrt.segments[0].start, 0);
    assert.equal(parsedFromSrt.segments[1].end, 11.25);

    const vtt = exportSegmentsToVTT(sampleSegments);
    assert.ok(vtt.startsWith('WEBVTT\n\n'));
    const parsedFromVtt = parseTranscriptFile(vtt);
    assert.equal(parsedFromVtt.segments.length, 2);
    assert.equal(parsedFromVtt.segments[1].text, 'Turn long videos into vertical clips.');
  });

  it('supports plain-text fallback when transcript has no timecodes', () => {
    const parsed = parseTranscriptFile('First key takeaway.\nSecond key insight.');
    assert.equal(parsed.segments.length, 2);
    assert.equal(parsed.segments[0].start, 0);
    assert.equal(parsed.segments[0].end, 5);
    assert.equal(parsed.segments[1].text, 'Second key insight.');
  });

  it('validates supported video files and enforces size caps', () => {
    const ok = validateVideoFile(
      { name: 'podcast.mp4', type: 'video/mp4', size: 1024 * 1024 } as File,
      500
    );
    assert.equal(ok.valid, true);

    const tooLarge = validateVideoFile(
      { name: 'huge.mov', type: 'video/quicktime', size: 600 * 1024 * 1024 } as File,
      500
    );
    assert.equal(tooLarge.valid, false);
    assert.match(tooLarge.error || '', /exceeds the platform limit/i);

    const badFormat = validateVideoFile(
      { name: 'notes.pdf', type: 'application/pdf', size: 1024 } as File,
      500
    );
    assert.equal(badFormat.valid, false);
  });
});

describe('SSRF & Media URL Security Validation', () => {
  it('detects private, loopback, link-local, and multicast IPs', () => {
    assert.equal(isBlockedIp('127.0.0.1'), true);
    assert.equal(isBlockedIp('10.0.0.1'), true);
    assert.equal(isBlockedIp('192.168.1.10'), true);
    assert.equal(isBlockedIp('172.16.5.4'), true);
    assert.equal(isBlockedIp('169.254.169.254'), true);
    assert.equal(isBlockedIp('::1'), true);
    assert.equal(isBlockedIp('::ffff:127.0.0.1'), true);
    assert.equal(isBlockedIp('1.1.1.1'), false);
    assert.equal(isBlockedIp('93.184.216.34'), false);
  });

  it('blocks internal URLs, cloud metadata, and unauthorized third-party streaming platforms', async () => {
    const blockedUrls = [
      'http://localhost:3000/video.mp4',
      'http://127.0.0.1/video.mp4',
      'http://169.254.169.254/latest/meta-data/',
      'file:///etc/passwd',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.tiktok.com/@creator/video/123',
      'https://www.instagram.com/reel/abc/',
      'https://x.com/user/status/123',
    ];

    for (const url of blockedUrls) {
      const res = await validatePublicVideoUrl(url);
      assert.equal(res.ok, false, `Expected URL to be blocked: ${url}`);
    }
  });

  it('allows direct public IP HTTPS media URLs', async () => {
    const res = await validatePublicVideoUrl('https://93.184.216.34/sample.mp4');
    assert.equal(res.ok, true);
    assert.equal(res.parsed?.hostname, '93.184.216.34');
  });
});
