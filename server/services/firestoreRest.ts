import { env } from '../config/env.ts';

type FirestoreValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { timestampValue: string }
  | { stringValue: string }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

interface FirestoreDocument {
  name?: string;
  fields?: Record<string, FirestoreValue>;
  createTime?: string;
  updateTime?: string;
}

function getBaseUrl(): string {
  const projectId = env.firebaseProjectId;
  const databaseId = env.firebaseDatabaseId || '(default)';
  if (!projectId) {
    throw new Error('Firebase project ID is not configured on the server.');
  }
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/${encodeURIComponent(databaseId)}/documents`;
}

export function fromFirestoreValue(val: FirestoreValue | undefined): unknown {
  if (!val || 'nullValue' in val) return null;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('timestampValue' in val) return val.timestampValue;
  if ('stringValue' in val) return val.stringValue;
  if ('arrayValue' in val) {
    return (val.arrayValue.values || []).map((v) => fromFirestoreValue(v));
  }
  if ('mapValue' in val) {
    const out: Record<string, unknown> = {};
    const fields = val.mapValue.fields || {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = fromFirestoreValue(v);
    }
    return out;
  }
  return null;
}

export function toFirestoreValue(val: unknown): FirestoreValue {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (val instanceof Date) return { timestampValue: val.toISOString() };
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map((item) => toFirestoreValue(item)) } };
  }
  if (typeof val === 'object') {
    const fields: Record<string, FirestoreValue> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v !== undefined) {
        fields[k] = toFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

export function docToRecord(doc: FirestoreDocument): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const fields = doc.fields || {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = fromFirestoreValue(v);
  }
  return out;
}

export class FirestoreRestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function getFirestoreDocument(
  idToken: string,
  docPath: string
): Promise<Record<string, unknown> | null> {
  const cleanPath = docPath.replace(/^\/+/, '');
  const resp = await fetch(`${getBaseUrl()}/${cleanPath}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (resp.status === 404) return null;
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new FirestoreRestError(resp.status, text || `Firestore GET failed (${resp.status})`);
  }
  const doc = (await resp.json()) as FirestoreDocument;
  return docToRecord(doc);
}

export async function listFirestoreCollection(
  idToken: string,
  collectionName: string,
  pageSize = 300
): Promise<Array<Record<string, unknown>>> {
  const cleanCol = collectionName.replace(/^\/+/, '');
  const resp = await fetch(
    `${getBaseUrl()}/${cleanCol}?pageSize=${Math.min(500, Math.max(1, pageSize))}`,
    {
      headers: { Authorization: `Bearer ${idToken}` },
    }
  );
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new FirestoreRestError(resp.status, text || `Firestore LIST failed (${resp.status})`);
  }
  const json = (await resp.json()) as { documents?: FirestoreDocument[] };
  return (json.documents || []).map(docToRecord);
}

export async function createFirestoreDocument(
  idToken: string,
  collectionName: string,
  documentId: string,
  data: Record<string, unknown>,
  serverTimeFields: string[] = []
): Promise<void> {
  const cleanCol = collectionName.replace(/^\/+/, '');
  const fields: Record<string, FirestoreValue> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined && !serverTimeFields.includes(k)) {
      fields[k] = toFirestoreValue(v);
    }
  }

  if (serverTimeFields.length === 0) {
    const resp = await fetch(
      `${getBaseUrl()}/${cleanCol}?documentId=${encodeURIComponent(documentId)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields }),
      }
    );
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new FirestoreRestError(resp.status, text || `Firestore CREATE failed (${resp.status})`);
    }
    return;
  }

  // Use commit endpoint so request.time server timestamps match Firestore rules
  const projectId = env.firebaseProjectId;
  const databaseId = env.firebaseDatabaseId || '(default)';
  const fullDocName = `projects/${projectId}/databases/${databaseId}/documents/${cleanCol}/${documentId}`;
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/${encodeURIComponent(databaseId)}/documents:commit`;

  const resp = await fetch(commitUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      writes: [
        {
          currentDocument: { exists: false },
          update: { name: fullDocName, fields },
          transform: {
            document: fullDocName,
            fieldTransforms: serverTimeFields.map((fieldPath) => ({
              fieldPath,
              setToServerValue: 'REQUEST_TIME',
            })),
          },
        },
      ],
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new FirestoreRestError(resp.status, text || `Firestore COMMIT CREATE failed (${resp.status})`);
  }
}

export async function patchFirestoreDocument(
  idToken: string,
  docPath: string,
  data: Record<string, unknown>,
  serverTimeFields: string[] = []
): Promise<void> {
  const cleanPath = docPath.replace(/^\/+/, '');
  const projectId = env.firebaseProjectId;
  const databaseId = env.firebaseDatabaseId || '(default)';
  const fullDocName = `projects/${projectId}/databases/${databaseId}/documents/${cleanPath}`;
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/${encodeURIComponent(databaseId)}/documents:commit`;

  const fields: Record<string, FirestoreValue> = {};
  const updateMaskPaths: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined && !serverTimeFields.includes(k)) {
      fields[k] = toFirestoreValue(v);
      updateMaskPaths.push(k);
    }
  }

  const writeOp: Record<string, unknown> = {
    currentDocument: { exists: true },
    update: { name: fullDocName, fields },
    updateMask: { fieldPaths: updateMaskPaths },
  };
  if (serverTimeFields.length > 0) {
    writeOp.transform = {
      document: fullDocName,
      fieldTransforms: serverTimeFields.map((fieldPath) => ({
        fieldPath,
        setToServerValue: 'REQUEST_TIME',
      })),
    };
  }

  const resp = await fetch(commitUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ writes: [writeOp] }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new FirestoreRestError(resp.status, text || `Firestore PATCH failed (${resp.status})`);
  }
}

export async function setFirestoreDocument(
  idToken: string,
  docPath: string,
  data: Record<string, unknown>,
  serverTimeFields: string[] = []
): Promise<void> {
  const cleanPath = docPath.replace(/^\/+/, '');
  const projectId = env.firebaseProjectId;
  const databaseId = env.firebaseDatabaseId || '(default)';
  const fullDocName = `projects/${projectId}/databases/${databaseId}/documents/${cleanPath}`;
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/${encodeURIComponent(databaseId)}/documents:commit`;

  const fields: Record<string, FirestoreValue> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined && !serverTimeFields.includes(k)) {
      fields[k] = toFirestoreValue(v);
    }
  }

  const writeOp: Record<string, unknown> = {
    update: { name: fullDocName, fields },
  };
  if (serverTimeFields.length > 0) {
    writeOp.transform = {
      document: fullDocName,
      fieldTransforms: serverTimeFields.map((fieldPath) => ({
        fieldPath,
        setToServerValue: 'REQUEST_TIME',
      })),
    };
  }

  const resp = await fetch(commitUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ writes: [writeOp] }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new FirestoreRestError(resp.status, text || `Firestore SET failed (${resp.status})`);
  }
}

export async function deleteFirestoreDocument(
  idToken: string,
  docPath: string
): Promise<void> {
  const cleanPath = docPath.replace(/^\/+/, '');
  const resp = await fetch(`${getBaseUrl()}/${cleanPath}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!resp.ok && resp.status !== 404) {
    const text = await resp.text().catch(() => '');
    throw new FirestoreRestError(resp.status, text || `Firestore DELETE failed (${resp.status})`);
  }
}
