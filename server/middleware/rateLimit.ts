import type { NextFunction, Response } from 'express';
import type { AuthenticatedRequest } from './auth.ts';

interface RateWindow {
  count: number;
  resetAt: number;
}

export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
}) {
  const store = new Map<string, RateWindow>();

  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const identity = req.auth?.uid || req.ip || 'anonymous';
    const key = `${options.keyPrefix}:${identity}`;
    const now = Date.now();

    const entry = store.get(key);
    if (!entry || entry.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    if (entry.count >= options.maxRequests) {
      const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error: `Rate limit exceeded. Please wait ${retryAfterSec}s before retrying to stay within free-tier quotas.`,
      });
      return;
    }

    entry.count += 1;
    next();
  };
}
