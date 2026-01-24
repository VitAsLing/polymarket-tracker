/**
 * Bot command handlers
 */

import { shortenAddress, formatUSD, escapeMarkdown, formatPnL, getMagnitude } from '../utils/format.js';
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
  getLastActivity,
  setLastActivity,
  deleteLastActivity,
  resolveAddressArg,
  getLang,
  getThreshold,
  setThreshold,
} from '../storage/kv.js';
import { t } from '../i18n/index.js';
import type { Env, Subscription, LeaderboardEntry, CommandResponse } from '../types/index.js';

// 生成订阅选择的 inline keyboard
function buildSubscriptionKeyboard(subscriptions: Subscription[], action: string) {
  // 每行 1 个按钮
  const rows = subscriptions.map((sub) => [{
    text: sub.alias || `${sub.address.slice(0, 6)}...${sub.address.slice(-4)}`,
    callback_data: `${action}:${sub.address}`,
  }]);
  return { inline_keyboard: rows };
}

const MAX_SUBSCRIPTIONS = 10;

export async function handleCommand(
  command: string,
  args: string[],
  chatId: number,
  env: Env
): Promise<string | CommandResponse | null> {
  const kv = env.POLYMARKET_KV;
  const lang = await getLang(kv, chatId);

  switch (command) {
    case '/start':
    case '/help':
      return t(lang, 'cmd.help');

    case '/sub': {
      if (!args[0]) {
        return t(lang, 'error.provideAddress');
      }
      const address = args[0].toLowerCase();
      if (!address.startsWith('0x') || address.length !== 42) {
        return t(lang, 'error.invalidAddress');
      }

      const subscriptions = await getSubscriptions(kv);
      const existing = subscriptions.find((s) => s.address === address && s.chatId === chatId);
      if (existing) {
        return `${t(lang, 'cmd.alreadySubscribed')}: ${existing.alias || shortenAddress(address)}`;
      }

      // 检查订阅数量限制
      const userSubscriptions = subscriptions.filter((s) => s.chatId === chatId);
      if (userSubscriptions.length >= MAX_SUBSCRIPTIONS) {
        return t(lang, 'error.maxSubscriptions');
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

      // 只在地址首次被订阅时设置 lastActivity，避免覆盖其他用户的进度
      const existingLastActivity = await getLastActivity(kv, address);
      if (existingLastActivity === 0) {
        await setLastActivity(kv, address, Math.floor(Date.now() / 1000));
      }

      const displayName = defaultAlias || shortenAddress(address);
      const profileUrl = `https://polymarket.com/profile/${address}`;
      return `${t(lang, 'cmd.subscribed')}: [${escapeMarkdown(displayName)}](${profileUrl})\nAddress: \`${address}\``;
    }

    case '/unsub': {
      if (!args[0]) {
        const allSubs = await getSubscriptions(kv);
        const userSubs = allSubs.filter((s) => s.chatId === chatId);
        if (userSubs.length === 0) {
          return t(lang, 'cmd.noSubscriptions');
        }
        return {
          text: t(lang, 'select.unsubscribe'),
          reply_markup: buildSubscriptionKeyboard(userSubs, 'unsub'),
        };
      }
      const address = args[0].toLowerCase();
      const subscriptions = await getSubscriptions(kv);
      const index = subscriptions.findIndex((s) => s.address === address && s.chatId === chatId);

      if (index === -1) {
        return t(lang, 'error.notFound');
      }

      const removed = subscriptions.splice(index, 1)[0];
      await saveSubscriptions(kv, subscriptions);

      // 如果没有其他用户订阅该地址，清理 lastActivity
      const othersSubscribed = subscriptions.some((s) => s.address === address);
      if (!othersSubscribed) {
        await deleteLastActivity(kv, address);
      }

      return `${t(lang, 'cmd.unsubscribed')}: ${removed.alias || shortenAddress(address)}`;
    }

    case '/list': {
      const allSubscriptions = await getSubscriptions(kv);
      const subscriptions = allSubscriptions.filter((s) => s.chatId === chatId);
      if (subscriptions.length === 0) {
        return t(lang, 'cmd.noSubscriptions');
      }

      let msg = `${t(lang, 'cmd.subscriptionsList')}\n\n`;
      subscriptions.forEach((sub, i) => {
        const name = sub.alias || shortenAddress(sub.address);
        const profileUrl = `https://polymarket.com/profile/${sub.address}`;
        msg += `${i + 1}. [${escapeMarkdown(name)}](${profileUrl})\n   \`${sub.address}\`\n\n`;
      });
      return msg;
    }

    case '/alias': {
      if (!args[0] || !args[1]) {
        return t(lang, 'error.aliasUsage');
      }
      const address = args[0].toLowerCase();
      const newAlias = args.slice(1).join(' ');

      const subscriptions = await getSubscriptions(kv);
      const sub = subscriptions.find((s) => s.address === address && s.chatId === chatId);
      if (!sub) {
        return t(lang, 'error.notFound');
      }

      sub.alias = newAlias;
      await saveSubscriptions(kv, subscriptions);
      return `${t(lang, 'cmd.aliasUpdated')}: *${escapeMarkdown(newAlias)}*`;
    }

    case '/pos': {
      // 如果没有参数，检查是否需要显示选择列表
      if (!args[0]) {
        const allSubs = await getSubscriptions(kv);
        const userSubs = allSubs.filter((s) => s.chatId === chatId);
        if (userSubs.length === 0) {
          return t(lang, 'cmd.noSubscriptions');
        }
        if (userSubs.length > 1) {
          return {
            text: t(lang, 'select.address'),
            reply_markup: buildSubscriptionKeyboard(userSubs, 'pos'),
          };
        }
      }
      const { address, displayName } = await resolveAddressArg(args[0], kv, chatId);
      if (!address) {
        return `${t(lang, 'error.provideAddressOrAlias')}: /pos 0x...`;
      }

      try {
        const positions = await getUserPositions(address);
        if (!positions || positions.length === 0) {
          const profileUrl = `https://polymarket.com/profile/${address}`;
          return `📋 [${escapeMarkdown(displayName!)}](${profileUrl}) ${t(lang, 'cmd.noPositions')}`;
        }

        const profileUrl = `https://polymarket.com/profile/${address}`;
        let msg = `📋 [${escapeMarkdown(displayName!)}](${profileUrl}) ${t(lang, 'cmd.positions')}\n\n`;
        positions.slice(0, 20).forEach((pos, i) => {
          const curPrice = (pos.curPrice * 100).toFixed(1);
          const avgPrice = (pos.avgPrice * 100).toFixed(1);
          const currentValue = formatUSD(pos.currentValue);
          const initialValue = formatUSD(pos.initialValue);
          const pnlAmount = pos.currentValue - pos.initialValue;
          const pnlPct = pos.percentPnl / 100;
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

          msg += `${i + 1}. ${statusEmoji}*${escapeMarkdown((pos.title || t(lang, 'pos.unknown')).substring(0, 50))}*\n`;
          msg += `   🎯 ${escapeMarkdown(pos.outcome || '')} @ ${curPrice}% (${t(lang, 'pos.avg')}: ${avgPrice}%)\n`;
          msg += `   💵 ${currentValue} ← ${initialValue}\n`;
          msg += `   ${formatPnL(pnlAmount, pnlPct)}\n`;
          msg += `   🎫 ${size} ${t(lang, 'pos.shares')}\n`;
          if (marketUrl) {
            msg += `   🔗 [${t(lang, 'push.market')}](${marketUrl})\n`;
          }
          msg += '\n';
        });
        return msg;
      } catch (e) {
        console.error('Error getting positions:', e);
        return t(lang, 'error.failedPositions');
      }
    }

    case '/pnl': {
      if (!args[0]) {
        const allSubs = await getSubscriptions(kv);
        const userSubs = allSubs.filter((s) => s.chatId === chatId);
        if (userSubs.length === 0) {
          return t(lang, 'cmd.noSubscriptions');
        }
        if (userSubs.length > 1) {
          return {
            text: t(lang, 'select.address'),
            reply_markup: buildSubscriptionKeyboard(userSubs, 'pnl'),
          };
        }
      }
      const { address, displayName } = await resolveAddressArg(args[0], kv, chatId);
      if (!address) {
        return `${t(lang, 'error.provideAddressOrAlias')}: /pnl 0x...`;
      }

      try {
        const closed = await getClosedPositions(address);
        if (!closed || closed.length === 0) {
          const profileUrl = `https://polymarket.com/profile/${address}`;
          return `📋 [${escapeMarkdown(displayName!)}](${profileUrl}) ${t(lang, 'cmd.noClosedPositions')}`;
        }

        const profileUrl = `https://polymarket.com/profile/${address}`;
        let totalPnl = 0;
        let msg = `📋 [${escapeMarkdown(displayName!)}](${profileUrl}) ${t(lang, 'cmd.realizedPnl')}\n\n`;
        closed.slice(0, 20).forEach((pos, i) => {
          const pnl = pos.realizedPnl || 0;
          totalPnl += pnl;
          const statusEmoji = pnl >= 0 ? '✅ ' : '❌ ';
          const avgPrice = ((pos.avgPrice || 0) * 100).toFixed(1);
          const date = pos.timestamp ? new Date(pos.timestamp * 1000).toISOString().substring(0, 10) : '';

          msg += `${i + 1}. ${statusEmoji}*${escapeMarkdown((pos.title || t(lang, 'pos.unknown')).substring(0, 50))}*\n`;
          msg += `   🎯 ${escapeMarkdown(pos.outcome || '')} @ ${avgPrice}%\n`;
          msg += `   ${formatPnL(pnl)}\n`;
          if (date) msg += `   📅 ${date}\n`;
          msg += '\n';
        });
        msg += `🧮 ${t(lang, 'cmd.total')}: ${formatPnL(totalPnl)}`;
        return msg;
      } catch (e) {
        console.error('Error getting closed positions:', e);
        return t(lang, 'error.failedPnl');
      }
    }

    case '/value': {
      if (!args[0]) {
        const allSubs = await getSubscriptions(kv);
        const userSubs = allSubs.filter((s) => s.chatId === chatId);
        if (userSubs.length === 0) {
          return t(lang, 'cmd.noSubscriptions');
        }
        if (userSubs.length > 1) {
          return {
            text: t(lang, 'select.address'),
            reply_markup: buildSubscriptionKeyboard(userSubs, 'value'),
          };
        }
      }
      const { address, displayName } = await resolveAddressArg(args[0], kv, chatId);
      if (!address) {
        return `${t(lang, 'error.provideAddressOrAlias')}: /value 0x...`;
      }

      try {
        const result = await getUserValue(address);
        const value = formatUSD(result.value);
        const profileUrl = `https://polymarket.com/profile/${address}`;
        return `💵 [${escapeMarkdown(displayName!)}](${profileUrl}) ${t(lang, 'cmd.portfolioValue')}\n\n*${value}* ${getMagnitude(result.value)}`;
      } catch (e) {
        console.error('Error getting value:', e);
        return t(lang, 'error.failedValue');
      }
    }

    case '/rank': {
      if (!args[0]) {
        const allSubs = await getSubscriptions(kv);
        const userSubs = allSubs.filter((s) => s.chatId === chatId);
        if (userSubs.length === 0) {
          return t(lang, 'cmd.noSubscriptions');
        }
        if (userSubs.length > 1) {
          return {
            text: t(lang, 'select.address'),
            reply_markup: buildSubscriptionKeyboard(userSubs, 'rank'),
          };
        }
      }
      const { address, displayName } = await resolveAddressArg(args[0], kv, chatId);
      if (!address) {
        return `${t(lang, 'error.provideAddressOrAlias')}: /rank 0x...`;
      }

      try {
        const [dayRank, weekRank, monthRank, allRank] = await Promise.all([
          getLeaderboardRank(address, 'DAY'),
          getLeaderboardRank(address, 'WEEK'),
          getLeaderboardRank(address, 'MONTH'),
          getLeaderboardRank(address, 'ALL'),
        ]);

        const profileUrl = `https://polymarket.com/profile/${address}`;
        let msg = `🏆 [${escapeMarkdown(displayName!)}](${profileUrl}) ${t(lang, 'cmd.leaderboard')}\n\n`;

        const getRankEmoji = (rank: number): string => {
          if (rank <= 100) return '🥇';
          if (rank <= 1000) return '🥈';
          if (rank <= 10000) return '🥉';
          return '🏅';
        };

        const formatRank = (data: LeaderboardEntry[], period: string): string => {
          if (!data || data.length === 0) return `*${period}:* ${t(lang, 'cmd.notRanked')}\n\n`;
          const r = data[0];
          const emoji = getRankEmoji(r.rank);
          return `*${period}:* ${emoji} #${r.rank}\n${formatPnL(r.pnl)}\n📊 ${t(lang, 'rank.volume')}: ${formatUSD(r.vol)}\n\n`;
        };

        msg += formatRank(dayRank, t(lang, 'cmd.today'));
        msg += formatRank(weekRank, t(lang, 'cmd.thisWeek'));
        msg += formatRank(monthRank, t(lang, 'cmd.thisMonth'));
        msg += formatRank(allRank, t(lang, 'cmd.allTime'));

        return msg;
      } catch (e) {
        console.error('Error getting rank:', e);
        return t(lang, 'error.failedRank');
      }
    }

    case '/lang': {
      return {
        text: t(lang, 'lang.select'),
        reply_markup: {
          inline_keyboard: [[
            { text: '🇺🇸 English', callback_data: 'lang:en' },
            { text: '🇨🇳 中文', callback_data: 'lang:zh' },
          ]],
        },
      };
    }

    case '/th': {
      const currentThreshold = await getThreshold(kv, chatId);

      if (!args[0]) {
        // 显示当前阈值
        if (currentThreshold <= 0) {
          return t(lang, 'threshold.none');
        }
        return t(lang, 'threshold.current').replace('{amount}', currentThreshold.toString());
      }

      // 解析金额
      const input = args[0].toLowerCase();
      let amount: number;

      if (input === 'off' || input === '0') {
        amount = 0;
      } else {
        amount = parseFloat(input);
        if (isNaN(amount) || amount < 0) {
          return t(lang, 'error.thresholdInvalid');
        }
      }

      await setThreshold(kv, chatId, amount);

      if (amount <= 0) {
        return t(lang, 'threshold.disabled');
      }
      return t(lang, 'threshold.set').replace('{amount}', amount.toString());
    }

    default:
      return null;
  }
}
