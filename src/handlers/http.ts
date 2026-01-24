/**
 * HTTP request router
 */

import { getSubscriptions } from '../storage/kv.js';
import { handleWebhook } from './webhook.js';
import { checkSubscriptions } from './scheduler.js';
import type { Env } from '../types/index.js';

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // Telegram Webhook
  if (path === '/webhook' && request.method === 'POST') {
    return handleWebhook(request, env);
  }

  // Manual trigger
  if (path === '/check') {
    const results = await checkSubscriptions(env);
    return Response.json(results);
  }

  // Health check
  if (path === '/health') {
    return Response.json({ status: 'ok', timestamp: Date.now() });
  }

  // View subscriptions
  if (path === '/subscriptions') {
    const subscriptions = await getSubscriptions(env.POLYMARKET_KV);
    return Response.json(subscriptions);
  }

  // Default response
  return Response.json({
    name: 'Polymarket Tracker Bot',
    version: '2.2.0',
    endpoints: {
      'POST /webhook': 'Telegram webhook',
      'GET /check': 'Manually trigger check',
      'GET /health': 'Health check',
      'GET /subscriptions': 'View subscriptions',
    },
  });
}
