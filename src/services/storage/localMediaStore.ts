import { getAuthHeaders } from '../gemini/clientApi';

const DB_NAME = 'reddox_clipora_media_v1';
const STORE_NAME = 'media_blobs';

function openMediaDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB unavailable.'));
  });
}

export async function saveLocalMediaBlob(key: string, blob: Blob): Promise<void> {
  const db = await openMediaDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to cache local media.'));
  });
  db.close();
}

export async function loadLocalMediaBlob(key: string): Promise<Blob | null> {
  const db = await openMediaDb();
  const result = await new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
    req.onerror = () => reject(req.error || new Error('Failed to read cached media.'));
  });
  db.close();
  return result;
}

export async function deleteLocalMediaBlob(key: string): Promise<void> {
  const db = await openMediaDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to delete cached media.'));
  });
  db.close();
}

export async function uploadBlobToR2IfConfigured(params: {
  blob: Blob;
  fileName: string;
  contentType: string;
  folder: 'uploads' | 'exports' | 'logos';
  localKey: string;
  onProgress?: (pct: number) => void;
}): Promise<{ storagePath: string; usedRemoteR2: boolean }> {
  // Always keep a local copy for instant zero-latency browser editing
  await saveLocalMediaBlob(params.localKey, params.blob);

  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/storage/presign-upload', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        fileName: params.fileName,
        contentType: params.contentType,
        folder: params.folder,
      }),
    });

    if (!res.ok) {
      return { storagePath: `local://${params.localKey}`, usedRemoteR2: false };
    }

    const data = (await res.json()) as {
      configured: boolean;
      uploadUrl?: string;
      objectKey?: string;
    };

    if (!data.configured || !data.uploadUrl || !data.objectKey) {
      return { storagePath: `local://${params.localKey}`, usedRemoteR2: false };
    }

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', data.uploadUrl!);
      xhr.setRequestHeader('Content-Type', params.contentType);
      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable && params.onProgress) {
          params.onProgress(Math.round((evt.loaded / evt.total) * 100));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`R2 upload returned HTTP ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error('R2 upload network error'));
      xhr.send(params.blob);
    });

    return { storagePath: `r2://${data.objectKey}`, usedRemoteR2: true };
  } catch {
    return { storagePath: `local://${params.localKey}`, usedRemoteR2: false };
  }
}

export async function resolveMediaBlob(storagePath: string, fallbackLocalKey?: string): Promise<Blob | null> {
  if (storagePath.startsWith('local://')) {
    return loadLocalMediaBlob(storagePath.slice('local://'.length));
  }
  if (fallbackLocalKey) {
    const cached = await loadLocalMediaBlob(fallbackLocalKey);
    if (cached) return cached;
  }
  if (storagePath.startsWith('r2://')) {
    const objectKey = storagePath.slice('r2://'.length);
    const headers = await getAuthHeaders();
    const res = await fetch('/api/storage/presign-download', {
      method: 'POST',
      headers,
      body: JSON.stringify({ objectKey }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { configured: boolean; downloadUrl?: string };
    if (!data.configured || !data.downloadUrl) return null;
    const fileRes = await fetch(data.downloadUrl);
    if (!fileRes.ok) return null;
    return fileRes.blob();
  }
  if (storagePath.startsWith('https://') || storagePath.startsWith('http://')) {
    const fileRes = await fetch(storagePath);
    if (!fileRes.ok) return null;
    return fileRes.blob();
  }
  return null;
}
