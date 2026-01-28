/**
 * Telegram Bot API wrapper
 */

interface TelegramResponse {
  ok: boolean;
  description?: string;
}

interface SendMessageOptions {
  reply_markup?: object;
  [key: string]: unknown;
}

export async function sendTelegram(
  botToken: string,
  chatId: number,
  text: string,
  options: SendMessageOptions = {}
): Promise<boolean> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      ...options,
    }),
  });

  const result = await response.json() as TelegramResponse;
  if (!result.ok) {
    const preview = text.slice(0, 50).replace(/\n/g, ' ');
    console.error(`[Telegram] Failed chatId=${chatId}: ${result.description} | msg: ${preview}...`);
    return false;
  }
  return true;
}

export async function answerCallbackQuery(
  botToken: string,
  callbackQueryId: string,
  text?: string
): Promise<boolean> {
  const url = `https://api.telegram.org/bot${botToken}/answerCallbackQuery`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      text,
    }),
  });

  const result = await response.json() as TelegramResponse;
  return result.ok;
}

export async function editMessageText(
  botToken: string,
  chatId: number,
  messageId: number,
  text: string,
  options: SendMessageOptions = {}
): Promise<boolean> {
  const url = `https://api.telegram.org/bot${botToken}/editMessageText`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      ...options,
    }),
  });

  const result = await response.json() as TelegramResponse;
  if (!result.ok) {
    console.error('Telegram error:', result.description);
    return false;
  }
  return true;
}
