/**
 * HTTP request router
 */

import { getSubscriptions } from '../storage/kv.js';
import { handleWebhook } from './webhook.js';
import { checkSubscriptions } from './scheduler.js';
import type { Env } from '../types/index.js';

interface SetWebhookResponse {
  ok: boolean;
  description?: string;
}

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

  // Set Webhook
  if (path === '/setWebhook') {
    const webhookUrl = url.searchParams.get('url');
    if (!webhookUrl) {
      return Response.json({ error: 'Missing url parameter' }, { status: 400 });
    }

    const response = await fetch(
      `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/setWebhook`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: webhookUrl }),
      }
    );
    const result = await response.json() as SetWebhookResponse;
    return Response.json(result);
  }

  // View subscriptions
  if (path === '/subscriptions') {
    const subscriptions = await getSubscriptions(env.POLYMARKET_KV);
    return Response.json(subscriptions);
  }

  // Default response
  return Response.json({
    name: 'Polymarket Tracker Bot',
    version: '2.1.0',
    endpoints: {
      'POST /webhook': 'Telegram webhook',
      'GET /check': 'Manually trigger check',
      'GET /health': 'Health check',
      'GET /setWebhook?url=': 'Set Telegram webhook URL',
      'GET /subscriptions': 'View subscriptions',
    },
  });
}
