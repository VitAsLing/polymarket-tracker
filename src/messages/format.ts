/**
 * Message formatting for Telegram notifications
 */

import { formatUSD, formatTimestamp, escapeMarkdown } from '../utils/format.js';
import type { Activity } from '../types/index.js';

export function formatBuyMessage(activity: Activity, displayName: string, address: string): string {
  const price = (activity.price * 100).toFixed(1);
  const cost = formatUSD(activity.usdcSize);
  const size = activity.size?.toFixed(1) || '0';
  const potentialProfit = activity.size ? formatUSD(activity.size - activity.usdcSize) : '$0';
  const potentialPct = activity.size && activity.usdcSize
    ? `+${(((activity.size / activity.usdcSize) - 1) * 100).toFixed(1)}%`
    : '';
  const profileUrl = `https://polymarket.com/profile/${address}`;

  return `🟢 *BUY* | [${escapeMarkdown(displayName)}](${profileUrl})

📊 ${escapeMarkdown(activity.title || 'Unknown')}
🎯 *${escapeMarkdown(activity.outcome || '')}* @ ${price}%

💵 Cost: ${cost}
🎫 Shares: ${size}
✨ If Win: ${potentialProfit} (${potentialPct})

⏰ ${formatTimestamp(activity.timestamp)}
🔗 [Market](https://polymarket.com/event/${activity.eventSlug || activity.slug}) | [Tx](https://polygonscan.com/tx/${activity.transactionHash})`;
}

export function formatSellMessage(activity: Activity, displayName: string, address: string): string {
  const price = (activity.price * 100).toFixed(1);
  const received = formatUSD(activity.usdcSize);
  const size = activity.size?.toFixed(1) || '0';
  const profileUrl = `https://polymarket.com/profile/${address}`;

  return `🔴 *SELL* | [${escapeMarkdown(displayName)}](${profileUrl})

📊 ${escapeMarkdown(activity.title || 'Unknown')}
🎯 *${escapeMarkdown(activity.outcome || '')}* @ ${price}%

💵 Received: ${received}
🎫 Shares: ${size}

⏰ ${formatTimestamp(activity.timestamp)}
🔗 [Market](https://polymarket.com/event/${activity.eventSlug || activity.slug}) | [Tx](https://polygonscan.com/tx/${activity.transactionHash})`;
}

export function formatRedeemMessage(activity: Activity, displayName: string, address: string): string {
  const redeemed = formatUSD(activity.usdcSize);
  const profileUrl = `https://polymarket.com/profile/${address}`;

  return `✅ *REDEEM* | [${escapeMarkdown(displayName)}](${profileUrl})

📊 ${escapeMarkdown(activity.title || 'Unknown')}
💵 Redeemed: ${redeemed}

⏰ ${formatTimestamp(activity.timestamp)}
🔗 [Market](https://polymarket.com/event/${activity.eventSlug || activity.slug}) | [Tx](https://polygonscan.com/tx/${activity.transactionHash})`;
}

export function formatActivityMessage(activity: Activity, displayName: string, address: string): string | null {
  if (activity.type === 'TRADE') {
    if (activity.side === 'BUY') {
      return formatBuyMessage(activity, displayName, address);
    } else {
      return formatSellMessage(activity, displayName, address);
    }
  } else if (activity.type === 'REDEEM') {
    return formatRedeemMessage(activity, displayName, address);
  }
  return null;
}
