/**
 * Message formatting for Telegram notifications
 */

import { formatUSD, formatTimestamp, escapeMarkdown } from '../utils/format.js';
import { t } from '../i18n/index.js';
import type { Activity, Lang } from '../types/index.js';

export function formatBuyMessage(activity: Activity, displayName: string, address: string, lang: Lang): string {
  const price = (activity.price * 100).toFixed(1);
  const cost = formatUSD(activity.usdcSize);
  const size = activity.size?.toFixed(1) || '0';
  const potentialProfit = activity.size ? formatUSD(activity.size - activity.usdcSize) : '$0';
  const potentialPct = activity.size && activity.usdcSize
    ? `+${(((activity.size / activity.usdcSize) - 1) * 100).toFixed(1)}%`
    : '';
  const profileUrl = `https://polymarket.com/profile/${address}`;

  return `${t(lang, 'push.buy')} | [${escapeMarkdown(displayName)}](${profileUrl})

📊 ${escapeMarkdown(activity.title || t(lang, 'pos.unknown'))}
🎯 *${escapeMarkdown(activity.outcome || '')}* @ ${price}%

💵 ${t(lang, 'push.cost')}: ${cost}
🎫 ${t(lang, 'push.shares')}: ${size}
✨ ${t(lang, 'push.ifWin')}: ${potentialProfit} (${potentialPct})

⏰ ${formatTimestamp(activity.timestamp)}
🔗 [${t(lang, 'push.market')}](https://polymarket.com/event/${activity.eventSlug || activity.slug}) | [${t(lang, 'push.tx')}](https://polygonscan.com/tx/${activity.transactionHash})`;
}

export function formatSellMessage(activity: Activity, displayName: string, address: string, lang: Lang): string {
  const price = (activity.price * 100).toFixed(1);
  const received = formatUSD(activity.usdcSize);
  const size = activity.size?.toFixed(1) || '0';
  const profileUrl = `https://polymarket.com/profile/${address}`;

  return `${t(lang, 'push.sell')} | [${escapeMarkdown(displayName)}](${profileUrl})

📊 ${escapeMarkdown(activity.title || t(lang, 'pos.unknown'))}
🎯 *${escapeMarkdown(activity.outcome || '')}* @ ${price}%

💵 ${t(lang, 'push.received')}: ${received}
🎫 ${t(lang, 'push.shares')}: ${size}

⏰ ${formatTimestamp(activity.timestamp)}
🔗 [${t(lang, 'push.market')}](https://polymarket.com/event/${activity.eventSlug || activity.slug}) | [${t(lang, 'push.tx')}](https://polygonscan.com/tx/${activity.transactionHash})`;
}

export function formatRedeemMessage(activity: Activity, displayName: string, address: string, lang: Lang): string {
  const redeemed = formatUSD(activity.usdcSize);
  const profileUrl = `https://polymarket.com/profile/${address}`;

  return `${t(lang, 'push.redeem')} | [${escapeMarkdown(displayName)}](${profileUrl})

📊 ${escapeMarkdown(activity.title || t(lang, 'pos.unknown'))}
💵 ${t(lang, 'push.redeemed')}: ${redeemed}

⏰ ${formatTimestamp(activity.timestamp)}
🔗 [${t(lang, 'push.market')}](https://polymarket.com/event/${activity.eventSlug || activity.slug}) | [${t(lang, 'push.tx')}](https://polygonscan.com/tx/${activity.transactionHash})`;
}

export function formatActivityMessage(activity: Activity, displayName: string, address: string, lang: Lang): string | null {
  if (activity.type === 'TRADE') {
    if (activity.side === 'BUY') {
      return formatBuyMessage(activity, displayName, address, lang);
    } else {
      return formatSellMessage(activity, displayName, address, lang);
    }
  } else if (activity.type === 'REDEEM') {
    return formatRedeemMessage(activity, displayName, address, lang);
  }
  return null;
}
