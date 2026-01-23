/**
 * Polymarket Smart Money Tracker v2.1
 *
 * Features:
 * - Subscribe/manage addresses via Telegram Bot
 * - Auto push trading activities (BUY/SELL/REDEEM)
 * - Query positions, PnL, rankings
 *
 * Environment:
 * - TG_BOT_TOKEN: Telegram Bot Token
 *
 * KV Storage:
 * - subscriptions: [{address, alias, chatId, addedAt}]
 * - last_activity:{address}: Last processed activity timestamp
 */

import { handleRequest } from './handlers/http.js';
import { checkSubscriptions } from './handlers/scheduler.js';
import type { Env } from './types/index.js';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(checkSubscriptions(env));
  },
};
