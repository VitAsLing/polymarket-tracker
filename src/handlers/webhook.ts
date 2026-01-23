/**
 * Telegram Webhook handler
 */

import { sendTelegram } from '../api/telegram.js';
import { handleCommand } from '../commands/index.js';
import type { Env } from '../types/index.js';

interface TelegramUpdate {
  message?: {
    chat: { id: number };
    text?: string;
  };
}

export async function handleWebhook(request: Request, env: Env): Promise<Response> {
  try {
    const update = await request.json() as TelegramUpdate;
    const message = update.message;
    if (!message || !message.text) return new Response('OK');

    const chatId = message.chat.id;
    const text = message.text.trim();
    if (!text.startsWith('/')) return new Response('OK');

    const parts = text.split(/\s+/);
    const command = parts[0].split('@')[0].toLowerCase();
    const args = parts.slice(1);

    const response = await handleCommand(command, args, chatId, env);
    if (response) {
      await sendTelegram(env.TG_BOT_TOKEN, chatId, response);
    }

    return new Response('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    return new Response('Error', { status: 500 });
  }
}
