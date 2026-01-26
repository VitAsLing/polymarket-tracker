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
  getUserSubscriptions,
  saveUserSubscriptions,
  resolveAddressArg,
  getLang,
  getThreshold,
  setThreshold,
  getFilter,
  setFilter,
  notifyDO,
  type SubRecord,
} from '../storage/kv.js';
import { t } from '../i18n/index.js';
import type { Env, LeaderboardEntry, CommandResponse, Lang } from '../types/index.js';

// 生成订阅选择的 inline keyboard
function buildSubscriptionKeyboard(subscriptions: SubRecord[], action: string) {
  const rows = subscriptions.map((sub) => [{
    text: sub.alias || `${sub.address.slice(0, 6)}...${sub.address.slice(-4)}`,
    callback_data: `${action}:${sub.address}`,
  }]);
  return { inline_keyboard: rows };
}

// 生成分页键盘
function buildPaginationKeyboard(action: string, address: string, page: number, hasMore: boolean, lang: Lang) {
  const buttons: { text: string; callback_data: string }[] = [];

  if (page > 0) {
    buttons.push({
      text: lang === 'zh' ? '◀️ 上一页' : '◀️ Prev',
      callback_data: `${action}:${address}:${page - 1}`,
    });
  }

  buttons.push({
    text: `${page + 1}`,
    callback_data: 'noop',
  });

  if (hasMore) {
    buttons.push({
      text: lang === 'zh' ? '下一页 ▶️' : 'Next ▶️',
      callback_data: `${action}:${address}:${page + 1}`,
    });
  }

  return buttons.length > 1 ? { inline_keyboard: [buttons] } : undefined;
}

const MAX_SUBSCRIPTIONS = 20;
const PAGE_SIZE = 10;

/**
 * 获取持仓分页数据
 */
export async function getPositionsPage(
  address: string,
  displayName: string,
  page: number,
  lang: Lang
): Promise<CommandResponse> {
  const offset = page * PAGE_SIZE;
  // 多请求一条用于判断是否有下一页
  const positions = await getUserPositions(address, { limit: PAGE_SIZE + 1, offset });

  if (!positions || positions.length === 0) {
    const profileUrl = `https://polymarket.com/profile/${address}`;
    if (page === 0) {
      return { text: `📋 [${escapeMarkdown(displayName)}](${profileUrl}) ${t(lang, 'cmd.noPositions')}` };
    }
    return { text: t(lang, 'page.noMore') };
  }

  const hasMore = positions.length > PAGE_SIZE;
  const pageData = positions.slice(0, PAGE_SIZE);

  const profileUrl = `https://polymarket.com/profile/${address}`;
  let msg = `📋 [${escapeMarkdown(displayName)}](${profileUrl}) ${t(lang, 'cmd.positions')}\n\n`;

  pageData.forEach((pos, i) => {
    const idx = offset + i + 1;
    const curPrice = (pos.curPrice * 100).toFixed(1);
    const avgPrice = (pos.avgPrice * 100).toFixed(1);
    const currentValue = formatUSD(pos.currentValue);
    const initialValue = formatUSD(pos.initialValue);
    const pnlAmount = pos.currentValue - pos.initialValue;
    const pnlPct = pos.percentPnl / 100;
    const size = pos.size?.toLocaleString('en-US', { maximumFractionDigits: 0 }) || '0';

    let statusEmoji = '';
    if (pos.curPrice <= 0.01) {
      statusEmoji = '❌ ';
    } else if (pos.curPrice >= 0.99 || pos.redeemable) {
      statusEmoji = '✅ ';
    } else if (pos.curPrice > pos.avgPrice) {
      statusEmoji = '🔼 ';
    } else if (pos.curPrice < pos.avgPrice) {
      statusEmoji = '🔽 ';
    }

    const marketUrl = pos.eventSlug || pos.slug
      ? `https://polymarket.com/event/${pos.eventSlug || pos.slug}`
      : null;

    msg += `${idx}. ${statusEmoji}*${escapeMarkdown((pos.title || t(lang, 'pos.unknown')).substring(0, 50))}*\n`;
    msg += `   🎯 ${escapeMarkdown(pos.outcome || '')} @ ${curPrice}% (${t(lang, 'pos.avg')}: ${avgPrice}%)\n`;
    msg += `   💵 ${currentValue} ← ${initialValue}\n`;
    msg += `   ${formatPnL(pnlAmount, pnlPct)}\n`;
    msg += `   🎫 ${size} ${t(lang, 'pos.shares')}\n`;
    if (marketUrl) {
      msg += `   🔗 [${t(lang, 'push.market')}](${marketUrl})\n`;
    }
    msg += '\n';
  });

  const keyboard = buildPaginationKeyboard('pos', address, page, hasMore, lang);
  return { text: msg, reply_markup: keyboard };
}

/**
 * 获取已平仓分页数据
 */
export async function getPnlPage(
  address: string,
  displayName: string,
  page: number,
  lang: Lang
): Promise<CommandResponse> {
  const offset = page * PAGE_SIZE;
  const closed = await getClosedPositions(address, { limit: PAGE_SIZE + 1, offset });

  if (!closed || closed.length === 0) {
    const profileUrl = `https://polymarket.com/profile/${address}`;
    if (page === 0) {
      return { text: `📋 [${escapeMarkdown(displayName)}](${profileUrl}) ${t(lang, 'cmd.noClosedPositions')}` };
    }
    return { text: t(lang, 'page.noMore') };
  }

  const hasMore = closed.length > PAGE_SIZE;
  const pageData = closed.slice(0, PAGE_SIZE);

  const profileUrl = `https://polymarket.com/profile/${address}`;
  let totalPnl = 0;
  let msg = `📋 [${escapeMarkdown(displayName)}](${profileUrl}) ${t(lang, 'cmd.realizedPnl')}\n\n`;

  pageData.forEach((pos, i) => {
    const idx = offset + i + 1;
    const pnl = pos.realizedPnl || 0;
    totalPnl += pnl;
    const statusEmoji = pnl >= 0 ? '✅ ' : '❌ ';
    const avgPrice = ((pos.avgPrice || 0) * 100).toFixed(1);
    const date = pos.timestamp ? new Date(pos.timestamp * 1000).toISOString().substring(0, 10) : '';

    msg += `${idx}. ${statusEmoji}*${escapeMarkdown((pos.title || t(lang, 'pos.unknown')).substring(0, 50))}*\n`;
    msg += `   🎯 ${escapeMarkdown(pos.outcome || '')} @ ${avgPrice}%\n`;
    msg += `   ${formatPnL(pnl)}\n`;
    if (date) msg += `   📅 ${date}\n`;
    msg += '\n';
  });

  msg += `🧮 ${t(lang, 'page.pageTotal')}: ${formatPnL(totalPnl)}`;

  const keyboard = buildPaginationKeyboard('pnl', address, page, hasMore, lang);
  return { text: msg, reply_markup: keyboard };
}

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

      const userSubs = await getUserSubscriptions(kv, chatId);
      const existing = userSubs.find((s) => s.address === address);
      if (existing) {
        return `${t(lang, 'cmd.alreadySubscribed')}: ${existing.alias || shortenAddress(address)}`;
      }

      if (userSubs.length >= MAX_SUBSCRIPTIONS) {
        return t(lang, 'error.maxSubscriptions');
      }

      let defaultAlias = args.slice(1).join(' ');
      if (!defaultAlias) {
        try {
          const activities = await getUserActivity(address, { limit: 1 });
          if (activities.length > 0 && activities[0].name) {
            defaultAlias = activities[0].name;
          }
        } catch {
          // Ignore - will use short address as fallback
        }
      }

      userSubs.push({
        address,
        alias: defaultAlias || '',
        addedAt: Date.now(),
      });
      await saveUserSubscriptions(kv, chatId, userSubs);
      await notifyDO(env, chatId, 'sub');

      const displayName = defaultAlias || shortenAddress(address);
      const profileUrl = `https://polymarket.com/profile/${address}`;
      return `${t(lang, 'cmd.subscribed')}: [${escapeMarkdown(displayName)}](${profileUrl})\nAddress: \`${address}\``;
    }

    case '/unsub': {
      const userSubs = await getUserSubscriptions(kv, chatId);

      if (!args[0]) {
        if (userSubs.length === 0) {
          return t(lang, 'cmd.noSubscriptions');
        }
        return {
          text: t(lang, 'select.unsubscribe'),
          reply_markup: buildSubscriptionKeyboard(userSubs, 'unsub'),
        };
      }

      const address = args[0].toLowerCase();
      const index = userSubs.findIndex((s) => s.address === address);

      if (index === -1) {
        return t(lang, 'error.notFound');
      }

      const removed = userSubs.splice(index, 1)[0];
      await saveUserSubscriptions(kv, chatId, userSubs);
      await notifyDO(env, chatId, 'sub');

      return `${t(lang, 'cmd.unsubscribed')}: ${removed.alias || shortenAddress(address)}`;
    }

    case '/list': {
      const userSubs = await getUserSubscriptions(kv, chatId);
      if (userSubs.length === 0) {
        return t(lang, 'cmd.noSubscriptions');
      }

      let msg = `${t(lang, 'cmd.subscriptionsList')}\n\n`;
      userSubs.forEach((sub, i) => {
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

      const userSubs = await getUserSubscriptions(kv, chatId);
      const sub = userSubs.find((s) => s.address === address);
      if (!sub) {
        return t(lang, 'error.notFound');
      }

      sub.alias = newAlias;
      await saveUserSubscriptions(kv, chatId, userSubs);
      await notifyDO(env, chatId, 'sub');
      return `${t(lang, 'cmd.aliasUpdated')}: *${escapeMarkdown(newAlias)}*`;
    }

    case '/pos': {
      if (!args[0]) {
        const userSubs = await getUserSubscriptions(kv, chatId);
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
        return await getPositionsPage(address, displayName!, 0, lang);
      } catch {
        return t(lang, 'error.failedPositions');
      }
    }

    case '/pnl': {
      if (!args[0]) {
        const userSubs = await getUserSubscriptions(kv, chatId);
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
        return await getPnlPage(address, displayName!, 0, lang);
      } catch {
        return t(lang, 'error.failedPnl');
      }
    }

    case '/value': {
      if (!args[0]) {
        const userSubs = await getUserSubscriptions(kv, chatId);
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
      } catch {
        return t(lang, 'error.failedValue');
      }
    }

    case '/rank': {
      if (!args[0]) {
        const userSubs = await getUserSubscriptions(kv, chatId);
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

        const formatRank = (data: LeaderboardEntry[], period: string): string => {
          if (!data || data.length === 0) return `*${period}:* ${t(lang, 'cmd.notRanked')}\n\n`;
          const r = data[0];
          return `*${period}:* 🏅 #${r.rank}\n${formatPnL(r.pnl)}\n🔥 ${t(lang, 'rank.volume')}: ${formatUSD(r.vol)}\n\n`;
        };

        msg += formatRank(dayRank, t(lang, 'cmd.today'));
        msg += formatRank(weekRank, t(lang, 'cmd.thisWeek'));
        msg += formatRank(monthRank, t(lang, 'cmd.thisMonth'));
        msg += formatRank(allRank, t(lang, 'cmd.allTime'));

        return msg;
      } catch {
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
        if (currentThreshold <= 0) {
          return t(lang, 'threshold.none');
        }
        return t(lang, 'threshold.current').replace('{amount}', currentThreshold.toString());
      }

      const amount = parseFloat(args[0]);
      if (isNaN(amount) || amount < 0) {
        return t(lang, 'error.thresholdInvalid');
      }

      await setThreshold(kv, chatId, amount);
      await notifyDO(env, chatId, 'config');

      if (amount <= 0) {
        return t(lang, 'threshold.disabled');
      }
      return t(lang, 'threshold.set').replace('{amount}', amount.toString());
    }

    case '/ft': {
      const currentFilter = await getFilter(kv, chatId);

      // 无参数：显示当前设置
      if (!args[0]) {
        if (!currentFilter || !currentFilter.categories.length) {
          return t(lang, 'filter.none');
        }
        return t(lang, 'filter.current')
          .replace('{mode}', t(lang, `filter.${currentFilter.mode}`))
          .replace('{categories}', currentFilter.categories.join(', '));
      }

      // off: 关闭过滤
      if (args[0].toLowerCase() === 'off') {
        await setFilter(kv, chatId, null);
        await notifyDO(env, chatId, 'config');
        return t(lang, 'filter.disabled');
      }

      // 解析 +/- 开头的分类
      const input = args.join(' ');
      const firstChar = input.charAt(0);

      if (firstChar !== '+' && firstChar !== '-') {
        return t(lang, 'filter.invalidUsage');
      }

      const mode = firstChar === '+' ? 'include' : 'exclude';
      // 去掉开头的 +/- 并按逗号或空格分隔
      const categoriesStr = input.slice(1).trim();
      const categories = categoriesStr
        .split(/[,\s]+/)
        .map(c => c.toLowerCase().trim())
        .filter(c => c.length > 0);

      if (categories.length === 0) {
        return t(lang, 'filter.invalidUsage');
      }

      await setFilter(kv, chatId, { mode, categories });
      await notifyDO(env, chatId, 'config');

      return t(lang, 'filter.set')
        .replace('{mode}', t(lang, `filter.${mode}`))
        .replace('{categories}', categories.join(', '));
    }

    default:
      return null;
  }
}
