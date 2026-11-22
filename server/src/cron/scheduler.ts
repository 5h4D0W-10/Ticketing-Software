import cron from 'node-cron';
import { TicketService } from '../domain/ticketService.js';

export function initScheduler(ticketService: TicketService): { stop: () => void } {
  // Idempotent auto-close sweep every 5 minutes: '*/5 * * * *'
  const task = cron.schedule('*/5 * * * *', async () => {
    try {
      const closed = await ticketService.sweepAutoCloseTickets();
      if (closed.length > 0) {
        console.log(`[Auto-Close Sweep] Auto-closed ${closed.length} inactive ticket(s): ${closed.join(', ')}`);
      }
    } catch (err) {
      console.error('[Auto-Close Sweep] Error running periodic sweep:', err);
    }
  });

  return {
    stop: () => task.stop(),
  };
}

