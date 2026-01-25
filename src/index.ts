/**
 * Polymarket Smart Money Tracker v2.4
 *
 * Features:
 * - Subscribe/manage addresses via Telegram Bot
 * - Auto push trading activities (BUY/SELL/REDEEM)
 * - Query positions, PnL, rankings
 * - Durable Objects for 10-second interval checks
 *
 * Environment:
 * - TG_BOT_TOKEN: Telegram Bot Token
 *
 * KV Storage:
 * - sub:{chatId}: User subscriptions
 * - config:{chatId}: User configs (lang, threshold)
 *
 * DO Storage:
 * - lastActivities: Address activity timestamps
 */

import { handleRequest } from './handlers/http.js';
import type { Env } from './types/index.js';

// Export Durable Object class
export { SchedulerDO } from './durable-objects/SchedulerDO.js';

/**
 * Ensure DO alarm is running
 */
async function ensureDORunning(env: Env): Promise<void> {
  const id = env.SCHEDULER_DO.idFromName('main');
  const stub = env.SCHEDULER_DO.get(id);
  await stub.fetch('http://do/ensure');
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env, ctx);
  },

  // Cron heartbeat: ensure DO alarm is running (every 5 minutes)
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(ensureDORunning(env));
  },
};
