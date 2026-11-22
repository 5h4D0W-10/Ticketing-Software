import { Router, Request, Response } from 'express';
import { pool } from '../db/connection.js';
import { DbClient } from '../db/transaction.js';
import { Clock, SystemClock } from '../time/clock.js';
import { TicketService } from '../domain/ticketService.js';

const INTERNAL_SECRET =
  process.env.INTERNAL_SWEEP_SECRET || 'frontdesk-internal-sweep-secret-key-arvo-2026';

export function createInternalRouter(
  db: DbClient = pool,
  clock: Clock = new SystemClock()
): Router {
  const router = Router();
  const ticketService = new TicketService(db, clock);

  router.post('/sweep', async (req: Request, res: Response) => {
    const providedSecret =
      req.headers['x-internal-secret'] || (req.query.secret as string);

    if (!providedSecret || providedSecret !== INTERNAL_SECRET) {
      res.status(401).json({ error: 'Unauthorized: Invalid or missing internal secret header' });
      return;
    }

    try {
      const closedTicketIds = await ticketService.sweepAutoCloseTickets();
      res.status(200).json({
        success: true,
        closedCount: closedTicketIds.length,
        closedTicketIds,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Sweep execution failed: ${message}` });
    }
  });

  return router;
}

