import { Request, Response, NextFunction } from 'express';

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60 * 1000; // 1 minute window
const MAX_REQUESTS_PER_WINDOW = 60; // 60 requests per minute

const ipBuckets = new Map<string, RateLimitRecord>();

// Clean up stale buckets periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of ipBuckets.entries()) {
    if (now > record.resetAt) {
      ipBuckets.delete(ip);
    }
  }
}, 5 * 60 * 1000).unref();

export function publicRateLimiter(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket?.remoteAddress || '127.0.0.1';
  const now = Date.now();

  const record = ipBuckets.get(ip);
  if (!record || now > record.resetAt) {
    ipBuckets.set(ip, {
      count: 1,
      resetAt: now + WINDOW_MS,
    });
    next();
    return;
  }

  if (record.count >= MAX_REQUESTS_PER_WINDOW) {
    res.status(429).json({
      error: 'Too many requests. Please slow down and try again shortly.',
      retryAfterSeconds: Math.ceil((record.resetAt - now) / 1000),
    });
    return;
  }

  record.count += 1;
  next();
}
