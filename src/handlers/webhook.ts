/**
 * Telegram Webhook handler
 */

import { sendTelegram, answerCallbackQuery, editMessageText } from '../api/telegram.js';
import { handleCommand, getPositionsPage, getPnlPage } from '../commands/index.js';
import { setLang, getLang, resolveAddressArg } from '../storage/kv.js';
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
  // Verify Telegram secret token if configured
  if (env.WEBHOOK_SECRET) {
    const token = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (token !== env.WEBHOOK_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

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
  const kv = env.POLYMARKET_KV;

  // Handle noop (page number button)
  if (data === 'noop') {
    await answerCallbackQuery(env.TG_BOT_TOKEN, id);
    return;
  }

  // Handle language switch
  if (data.startsWith('lang:')) {
    const newLang = data.split(':')[1] as Lang;
    if (newLang === 'en' || newLang === 'zh') {
      await setLang(kv, from.id, newLang);
      const text = t(newLang, 'lang.switched', { lang: getLangName(newLang) });
      await editMessageText(env.TG_BOT_TOKEN, chatId, messageId, text);
      await answerCallbackQuery(env.TG_BOT_TOKEN, id);
      return;
    }
  }

  const parts = data.split(':');
  const action = parts[0];
  const address = parts[1];
  const page = parts[2] ? parseInt(parts[2], 10) : undefined;

  // Handle pagination for pos and pnl
  if ((action === 'pos' || action === 'pnl') && address && page !== undefined) {
    await answerCallbackQuery(env.TG_BOT_TOKEN, id);
    const lang = await getLang(kv, chatId);
    const { displayName } = await resolveAddressArg(address, kv, chatId);
    const name = displayName || address.slice(0, 6) + '...' + address.slice(-4);

    try {
      const response = action === 'pos'
        ? await getPositionsPage(address, name, page, lang)
        : await getPnlPage(address, name, page, lang);

      await editMessageText(env.TG_BOT_TOKEN, chatId, messageId, response.text, {
        reply_markup: response.reply_markup,
      });
    } catch (e) {
      console.error(`Error getting ${action} page:`, e);
    }
    return;
  }

  // Handle commands with address selection (pos, pnl, value, rank, unsub)
  const queryCommands = ['pos', 'pnl', 'value', 'rank', 'unsub'];
  if (queryCommands.includes(action) && address) {
    await answerCallbackQuery(env.TG_BOT_TOKEN, id);
    const response = await handleCommand(`/${action}`, [address], chatId, env);
    if (response) {
      const text = typeof response === 'string' ? response : response.text;
      const reply_markup = typeof response === 'string' ? undefined : response.reply_markup;
      await editMessageText(env.TG_BOT_TOKEN, chatId, messageId, text, { reply_markup });
    }
    return;
  }

  await answerCallbackQuery(env.TG_BOT_TOKEN, id);
}
