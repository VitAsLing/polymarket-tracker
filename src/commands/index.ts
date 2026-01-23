/**
 * Bot command handlers
 */

import { shortenAddress, formatUSD, formatPercent, escapeMarkdown } from '../utils/format.js';
import {
  getUserActivity,
  getUserPositions,
  getUserValue,
  getClosedPositions,
  getLeaderboardRank,
} from '../api/polymarket.js';
import {
  getSubscriptions,
  saveSubscriptions,
  setLastActivity,
  resolveAddressArg,
} from '../storage/kv.js';
import type { Env, LeaderboardEntry } from '../types/index.js';

export async function handleCommand(
  command: string,
  args: string[],
  chatId: number,
  env: Env
): Promise<string | null> {
  const kv = env.POLYMARKET_KV;

  switch (command) {
    case '/start':
    case '/help':
      return `🤖 *Polymarket Tracker Bot*

*Subscription:*
/subscribe <address> [alias] - Subscribe
/unsubscribe <address> - Unsubscribe
/list - List subscriptions
/alias <address> <new\\_alias> - Update alias

*Query:*
/pos [address/alias] - Positions
/pnl [address/alias] - Realized PnL
/value [address/alias] - Portfolio value
/rank [address/alias] - Leaderboard

_Address format: 0x..._`;

    case '/subscribe': {
      if (!args[0]) {
        return '❌ Please provide address: /subscribe 0x... [alias]';
      }
      const address = args[0].toLowerCase();
      if (!address.startsWith('0x') || address.length !== 42) {
        return '❌ Invalid address format';
      }

      const subscriptions = await getSubscriptions(kv);
      const existing = subscriptions.find((s) => s.address === address && s.chatId === chatId);
      if (existing) {
        return `⚠️ Already subscribed: ${existing.alias || shortenAddress(address)}`;
      }

      let defaultAlias = args.slice(1).join(' ');
      if (!defaultAlias) {
        try {
          const activities = await getUserActivity(address, { limit: 1 });
          if (activities.length > 0 && activities[0].name) {
            defaultAlias = activities[0].name;
          }
        } catch (e) {
          console.error('Failed to get name:', e);
        }
      }

      subscriptions.push({
        address,
        alias: defaultAlias || '',
        chatId,
        addedAt: Date.now(),
      });
      await saveSubscriptions(kv, subscriptions);

      await setLastActivity(kv, address, Math.floor(Date.now() / 1000));

      const displayName = defaultAlias || shortenAddress(address);
      const profileUrl = `https://polymarket.com/profile/${address}`;
      return `✅ Subscribed: [${escapeMarkdown(displayName)}](${profileUrl})\nAddress: \`${address}\``;
    }

    case '/unsubscribe': {
      if (!args[0]) {
        return '❌ Please provide address: /unsubscribe 0x...';
      }
      const address = args[0].toLowerCase();
      const subscriptions = await getSubscriptions(kv);
      const index = subscriptions.findIndex((s) => s.address === address && s.chatId === chatId);

      if (index === -1) {
        return '❌ Subscription not found';
      }

      const removed = subscriptions.splice(index, 1)[0];
      await saveSubscriptions(kv, subscriptions);

      return `✅ Unsubscribed: ${removed.alias || shortenAddress(address)}`;
    }

    case '/list': {
      const allSubscriptions = await getSubscriptions(kv);
      const subscriptions = allSubscriptions.filter((s) => s.chatId === chatId);
      if (subscriptions.length === 0) {
        return '📋 No subscriptions\n\nUse /subscribe to add';
      }

      let msg = '📋 *Subscriptions:*\n\n';
      subscriptions.forEach((sub, i) => {
        const name = sub.alias || shortenAddress(sub.address);
        const profileUrl = `https://polymarket.com/profile/${sub.address}`;
        msg += `${i + 1}. [${escapeMarkdown(name)}](${profileUrl})\n   \`${sub.address}\`\n\n`;
      });
      return msg;
    }

    case '/alias': {
      if (!args[0] || !args[1]) {
        return '❌ Usage: /alias 0x... new\\_alias';
      }
      const address = args[0].toLowerCase();
      const newAlias = args.slice(1).join(' ');

      const subscriptions = await getSubscriptions(kv);
      const sub = subscriptions.find((s) => s.address === address && s.chatId === chatId);
      if (!sub) {
        return '❌ Subscription not found';
      }

      sub.alias = newAlias;
      await saveSubscriptions(kv, subscriptions);
      return `✅ Alias updated: *${escapeMarkdown(newAlias)}*`;
    }

    case '/pos': {
      const { address, displayName } = await resolveAddressArg(args[0], kv, chatId);
      if (!address) {
        return '❌ Please provide address or alias: /pos 0x...';
      }

      try {
        const positions = await getUserPositions(address);
        if (!positions || positions.length === 0) {
          const profileUrl = `https://polymarket.com/profile/${address}`;
          return `📊 [${escapeMarkdown(displayName)}](${profileUrl}) has no positions`;
        }

        const profileUrl = `https://polymarket.com/profile/${address}`;
        let msg = `📊 [${escapeMarkdown(displayName)}](${profileUrl}) Positions:\n\n`;
        positions.slice(0, 20).forEach((pos, i) => {
          const curPrice = (pos.curPrice * 100).toFixed(1);
          const avgPrice = (pos.avgPrice * 100).toFixed(1);
          const currentValue = formatUSD(pos.currentValue);
          const initialValue = formatUSD(pos.initialValue);
          const pnlPct = formatPercent(pos.percentPnl / 100);
          const size = pos.size?.toLocaleString('en-US', { maximumFractionDigits: 0 }) || '0';

          // Status emoji: ❌ lost (price near 0), ✅ redeemable (won), empty otherwise
          let statusEmoji = '';
          if (pos.curPrice <= 0.01) {
            statusEmoji = '❌ ';
          } else if (pos.redeemable) {
            statusEmoji = '✅ ';
          }

          const marketUrl = pos.eventSlug || pos.slug
            ? `https://polymarket.com/event/${pos.eventSlug || pos.slug}`
            : null;

          msg += `${i + 1}. ${statusEmoji}*${escapeMarkdown((pos.title || 'Unknown').substring(0, 50))}*\n`;
          msg += `   🎯 ${escapeMarkdown(pos.outcome || '')} @ ${curPrice}% (Avg: ${avgPrice}%)\n`;
          msg += `   💵 Current: ${currentValue} | Cost: ${initialValue} (${pnlPct})\n`;
          msg += `   🎫 ${size} shares\n`;
          if (marketUrl) {
            msg += `   🔗 [Market](${marketUrl})\n`;
          }
          msg += '\n';
        });
        return msg;
      } catch (e) {
        console.error('Error getting positions:', e);
        return '❌ Failed to get positions';
      }
    }

    case '/pnl': {
      const { address, displayName } = await resolveAddressArg(args[0], kv, chatId);
      if (!address) {
        return '❌ Please provide address or alias: /pnl 0x...';
      }

      try {
        const closed = await getClosedPositions(address);
        if (!closed || closed.length === 0) {
          const profileUrl = `https://polymarket.com/profile/${address}`;
          return `📈 [${escapeMarkdown(displayName)}](${profileUrl}) has no closed positions`;
        }

        const profileUrl = `https://polymarket.com/profile/${address}`;
        let totalPnl = 0;
        let msg = `📈 [${escapeMarkdown(displayName)}](${profileUrl}) Realized PnL:\n\n`;
        closed.slice(0, 20).forEach((pos, i) => {
          const pnl = pos.realizedPnl || 0;
          totalPnl += pnl;
          const statusEmoji = pnl >= 0 ? '✅ ' : '❌ ';
          const pnlEmoji = pnl >= 0 ? '🟢' : '🔴';
          const pnlSign = pnl >= 0 ? '+' : '';
          const pnlStr = `${pnlSign}${formatUSD(pnl)}`;
          const avgPrice = ((pos.avgPrice || 0) * 100).toFixed(1);
          const date = pos.timestamp ? new Date(pos.timestamp * 1000).toISOString().substring(0, 10) : '';

          msg += `${i + 1}. ${statusEmoji}*${escapeMarkdown((pos.title || 'Unknown').substring(0, 50))}*\n`;
          msg += `   🎯 ${escapeMarkdown(pos.outcome || '')} @ ${avgPrice}%\n`;
          msg += `   ${pnlEmoji} ${pnlStr}\n`;
          if (date) msg += `   📅 ${date}\n`;
          msg += '\n';
        });
        const totalSign = totalPnl >= 0 ? '+' : '';
        msg += `💰 *Total: ${totalSign}${formatUSD(totalPnl)}*`;
        return msg;
      } catch (e) {
        console.error('Error getting closed positions:', e);
        return '❌ Failed to get PnL';
      }
    }

    case '/value': {
      const { address, displayName } = await resolveAddressArg(args[0], kv, chatId);
      if (!address) {
        return '❌ Please provide address or alias: /value 0x...';
      }

      try {
        const result = await getUserValue(address);
        const value = formatUSD(result.value);
        const profileUrl = `https://polymarket.com/profile/${address}`;
        return `💰 [${escapeMarkdown(displayName)}](${profileUrl}) Portfolio Value:\n\n*${value}*`;
      } catch (e) {
        console.error('Error getting value:', e);
        return '❌ Failed to get value';
      }
    }

    case '/rank': {
      const { address, displayName } = await resolveAddressArg(args[0], kv, chatId);
      if (!address) {
        return '❌ Please provide address or alias: /rank 0x...';
      }

      try {
        const [dayRank, weekRank, monthRank, allRank] = await Promise.all([
          getLeaderboardRank(address, 'DAY'),
          getLeaderboardRank(address, 'WEEK'),
          getLeaderboardRank(address, 'MONTH'),
          getLeaderboardRank(address, 'ALL'),
        ]);

        const profileUrl = `https://polymarket.com/profile/${address}`;
        let msg = `🏆 [${escapeMarkdown(displayName)}](${profileUrl}) Leaderboard:\n\n`;

        const formatRank = (data: LeaderboardEntry[], period: string): string => {
          if (!data || data.length === 0) return `*${period}:* Not ranked\n\n`;
          const r = data[0];
          return `*${period}:*\n   🥇 #${r.rank}\n   💵 PnL: ${formatUSD(r.pnl)}\n   📊 Volume: ${formatUSD(r.vol)}\n\n`;
        };

        msg += formatRank(dayRank, 'Today');
        msg += formatRank(weekRank, 'This Week');
        msg += formatRank(monthRank, 'This Month');
        msg += formatRank(allRank, 'All Time');

        return msg;
      } catch (e) {
        console.error('Error getting rank:', e);
        return '❌ Failed to get rank';
      }
    }

    default:
      return null;
  }
}
