let activeToken: string | null = null;

export function setSessionToken(token: string | null): void {
  activeToken = token;
}

export function getSessionToken(): string | null {
  return activeToken;
}

export function clearSessionToken(): void {
  activeToken = null;
}

export function buildAuthHeaders(extra?: HeadersInit): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'CliporaApp',
  };
  if (activeToken) {
    headers.Authorization = `Bearer ${activeToken}`;
  }
  if (extra) {
    const normalized = new Headers(extra);
    normalized.forEach((value, key) => {
      headers[key] = value;
    });
  }
  return headers;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: buildAuthHeaders(init?.headers),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      typeof data?.error === 'string' ? data.error : `Request rejected (HTTP ${res.status})`
    ) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data as T;
}
