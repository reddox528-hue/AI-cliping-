import crypto from 'crypto';
import { createFirestoreDocument } from './firestoreRest.ts';

export type SecurityEventAction =
  | 'ADMIN_LOGIN'
  | 'FAILED_ADMIN_LOGIN'
  | 'ADMIN_PASSWORD_RESET_REQUESTED'
  | 'SUPER_ADMIN_INITIALIZED'
  | 'UNAUTHORIZED_ADMIN_ROUTE_ACCESS'
  | 'UNAUTHORIZED_ADMIN_API_REQUEST'
  | 'ROLE_CHANGED'
  | 'ACCOUNT_APPROVED'
  | 'ACCOUNT_REJECTED'
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_REACTIVATED'
  | 'ADMIN_CREATED'
  | 'ADMIN_PERMISSIONS_CHANGED'
  | 'SYSTEM_SETTINGS_UPDATED'
  | 'USER_DELETED';

export interface SecurityEventEntry {
  logId: string;
  actorId: string;
  action: SecurityEventAction;
  targetId: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}

const MAX_RECENT_EVENTS = 500;
const recentSecurityEvents: SecurityEventEntry[] = [];

export function getRecentSecurityEvents(): SecurityEventEntry[] {
  return [...recentSecurityEvents];
}

export async function logSecurityEvent(params: {
  actorId: string;
  action: SecurityEventAction;
  targetId: string;
  metadata?: Record<string, unknown>;
  idToken?: string;
}): Promise<SecurityEventEntry> {
  const logId = `sec_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
  const entry: SecurityEventEntry = {
    logId,
    actorId: params.actorId.slice(0, 128) || 'anonymous',
    action: params.action,
    targetId: params.targetId.slice(0, 128) || 'unknown',
    timestamp: new Date().toISOString(),
    metadata: params.metadata || {},
  };

  recentSecurityEvents.unshift(entry);
  if (recentSecurityEvents.length > MAX_RECENT_EVENTS) {
    recentSecurityEvents.length = MAX_RECENT_EVENTS;
  }

  console.warn(
    `[SECURITY_EVENT] action=${entry.action} actor=${entry.actorId} target=${entry.targetId}`
  );

  // Persist to immutable Firestore auditLogs when a verified caller token is present
  if (params.idToken) {
    try {
      await createFirestoreDocument(
        params.idToken,
        'auditLogs',
        logId,
        {
          logId,
          actorId: entry.actorId,
          action: entry.action,
          targetId: entry.targetId,
          metadata: entry.metadata,
        },
        ['timestamp']
      );
    } catch (err) {
      // Never crash request handling if persistence fails in tests or unapproved state
      if (process.env.NODE_ENV !== 'test') {
        console.warn('Firestore security audit log write skipped:', err);
      }
    }
  }

  return entry;
}
