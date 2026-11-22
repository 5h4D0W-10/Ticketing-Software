import { Request, Response, NextFunction } from 'express';
import { verifyToken, TokenPayload } from './jwt.js';

export interface AuthenticatedRequest extends Request {
  user?: TokenPayload;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Authentication required. Missing or malformed authorization header.',
    });
    return;
  }

  const token = authHeader.substring(7).trim();

  try {
    const payload = verifyToken(token);
    req.user = payload;
    next();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid or expired token';
    res.status(401).json({ error: `Authentication failed: ${message}` });
  }
}

export function requireRole(role: 'lead') {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (req.user.role !== role) {
      res.status(403).json({ error: `Forbidden: requires ${role} role` });
      return;
    }

    next();
  };
}
