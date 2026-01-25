/**
 * HTTP request router
 */

import { handleWebhook } from './webhook.js';
import type { Env } from '../types/index.js';

/**
 * Ensure DO alarm is running
 */
async function ensureDORunning(env: Env): Promise<void> {
  try {
    const id = env.SCHEDULER_DO.idFromName('main');
    const stub = env.SCHEDULER_DO.get(id);
    await stub.fetch('http://do/ensure');
  } catch (error) {
    console.error('[ensureDORunning] Error:', error);
  }
}

export async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // Ensure DO is running on every request
  ctx.waitUntil(ensureDORunning(env));

  // Telegram Webhook
  if (path === '/webhook' && request.method === 'POST') {
    return handleWebhook(request, env, ctx);
  }

  // Health check
  if (path === '/health') {
    return Response.json({ status: 'ok', timestamp: Date.now() });
  }

  // Default response
  return Response.json({
    name: 'Polymarket Tracker Bot',
    version: '2.4.0',
  });
}
