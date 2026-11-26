import dns from 'dns/promises';
import net from 'net';

const DISALLOWED_SOCIAL_HOSTS = [
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'tiktok.com',
  'www.tiktok.com',
  'vm.tiktok.com',
  'instagram.com',
  'www.instagram.com',
  'facebook.com',
  'www.facebook.com',
  'fb.watch',
  'twitter.com',
  'x.com',
  'vimeo.com',
];

function isPrivateOrReservedIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateOrReservedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('fe80:')) return true;
  if (lower.startsWith('::ffff:')) {
    const v4 = lower.slice('::ffff:'.length);
    if (net.isIPv4(v4)) {
      return isPrivateOrReservedIPv4(v4);
    }
  }
  return false;
}

export function isBlockedIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateOrReservedIPv4(ip);
  if (version === 6) return isPrivateOrReservedIPv6(ip);
  return true;
}

export async function validatePublicVideoUrl(rawUrl: string): Promise<{
  ok: boolean;
  parsed?: URL;
  reason?: string;
}> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { ok: false, reason: 'Enter a valid URL starting with https:// or http://.' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: 'Only HTTPS and HTTP direct video URLs are supported.' };
  }

  const host = parsed.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    return { ok: false, reason: 'Local or internal network URLs are not permitted.' };
  }

  if (DISALLOWED_SOCIAL_HOSTS.some((d) => host === d || host.endsWith(`.${d}`))) {
    return {
      ok: false,
      reason:
        'Third-party streaming platforms (YouTube, TikTok, Instagram, X) do not permit direct unauthorized downloading. Please upload your legally obtained video file or use a direct downloadable MP4/WebM/MOV URL.',
    };
  }

  if (net.isIP(host)) {
    if (isBlockedIp(host)) {
      return { ok: false, reason: 'Private or reserved IP addresses are not permitted.' };
    }
    return { ok: true, parsed };
  }

  try {
    const records = await dns.lookup(host, { all: true });
    if (!records.length || records.some((r) => isBlockedIp(r.address))) {
      return { ok: false, reason: 'Resolved host points to a restricted network address.' };
    }
  } catch {
    return { ok: false, reason: 'Unable to resolve the video host domain.' };
  }

  return { ok: true, parsed };
}
