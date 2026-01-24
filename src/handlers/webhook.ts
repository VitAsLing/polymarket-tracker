/**
 * Telegram Webhook handler
 */

import { sendTelegram, answerCallbackQuery, editMessageText } from '../api/telegram.js';
import { handleCommand } from '../commands/index.js';
import { setLang } from '../storage/kv.js';
import { t, getLangName } from '../i18n/index.js';
import type { Env, Lang } from '../types/index.js';

interface TelegramUpdate {
  message?: {
    chat: { id: number };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number };
    message?: {
      chat: { id: number };
      message_id: number;
    };
    data?: string;
  };
}

export async function handleWebhook(request: Request, env: Env): Promise<Response> {
  try {
    const update = await request.json() as TelegramUpdate;

    // Handle callback query (button click)
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query, env);
      return new Response('OK');
    }

    // Handle message
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
      if (typeof response === 'string') {
        await sendTelegram(env.TG_BOT_TOKEN, chatId, response);
      } else {
        await sendTelegram(env.TG_BOT_TOKEN, chatId, response.text, {
          reply_markup: response.reply_markup,
        });
      }
    }

    return new Response('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    // 始终返回 200，防止 Telegram 重试导致重复执行
    return new Response('OK');
  }
}

async function handleCallbackQuery(
  callbackQuery: NonNullable<TelegramUpdate['callback_query']>,
  env: Env
): Promise<void> {
  const { id, from, message, data } = callbackQuery;
  if (!data || !message) {
    await answerCallbackQuery(env.TG_BOT_TOKEN, id);
    return;
  }

  const chatId = message.chat.id;
  const messageId = message.message_id;

  // Handle language switch
  if (data.startsWith('lang:')) {
    const newLang = data.split(':')[1] as Lang;
    if (newLang === 'en' || newLang === 'zh') {
      await setLang(env.POLYMARKET_KV, from.id, newLang);
      const text = t(newLang, 'lang.switched', { lang: getLangName(newLang) });
      await editMessageText(env.TG_BOT_TOKEN, chatId, messageId, text);
      await answerCallbackQuery(env.TG_BOT_TOKEN, id);
      return;
    }
  }

  // Handle commands with address selection (pos, pnl, value, rank, unsub)
  const queryCommands = ['pos', 'pnl', 'value', 'rank', 'unsub'];
  const [action, address] = data.split(':');
  if (queryCommands.includes(action) && address) {
    await answerCallbackQuery(env.TG_BOT_TOKEN, id);
    const response = await handleCommand(`/${action}`, [address], chatId, env);
    if (response) {
      const text = typeof response === 'string' ? response : response.text;
      await editMessageText(env.TG_BOT_TOKEN, chatId, messageId, text);
    }
    return;
  }

  await answerCallbackQuery(env.TG_BOT_TOKEN, id);
}
