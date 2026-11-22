import { Router, Request, Response } from 'express';
import { pool } from '../db/connection.js';
import { comparePassword, signToken } from '../auth/jwt.js';
import { requireAuth, AuthenticatedRequest } from '../auth/middleware.js';
import { DbClient } from '../db/transaction.js';

export function createAuthRouter(db: DbClient = pool): Router {
  const router = Router();

  router.post('/login', async (req: Request, res: Response) => {
    const { email, password } = req.body || {};

    if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    try {
      const userRes = await db.query<{
        id: string;
        name: string;
        email: string;
        password_hash: string;
        role: 'agent' | 'lead';
      }>(
        'SELECT id, name, email, password_hash, role FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1;',
        [email.trim()]
      );

      if (userRes.rows.length === 0) {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }

      const user = userRes.rows[0];
      const passwordValid = await comparePassword(password, user.password_hash);

      if (!passwordValid) {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }

      const token = signToken({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      });

      res.status(200).json({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Login error: ${message}` });
    }
  });

  router.get('/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    res.status(200).json({ user: req.user });
  });

  return router;
}
