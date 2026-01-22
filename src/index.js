/**
 * Polymarket Smart Money Tracker v2.0
 *
 * 功能：
 * - 通过 TG Bot 命令订阅/管理监控地址
 * - 自动推送交易活动 (BUY/SELL/REDEEM)
 * - 查询持仓、收益、排名等
 *
 * 环境变量:
 * - TG_BOT_TOKEN: Telegram Bot Token
 * - TG_CHAT_ID: 默认推送的 Chat ID
 *
 * KV 存储:
 * - subscriptions: 订阅列表 [{address, alias, chatId, addedAt}]
 * - last_activity:{address}: 最后处理的活动时间戳
 */

const POLYMARKET_API = 'https://data-api.polymarket.com';

// ============ 工具函数 ============

function shortenAddress(address) {
  if (!address) return '';
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
}

function formatUSD(amount) {
  if (amount === null || amount === undefined) return '$0.00';
  const num = Number(amount);
  if (isNaN(num)) return '$0.00';
  const sign = num >= 0 ? '' : '-';
  return `${sign}$${Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPercent(value) {
  if (value === null || value === undefined) return '0.0%';
  const num = Number(value) * 100;
  if (isNaN(num)) return '0.0%';
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(1)}%`;
}

function formatTimestamp(timestamp) {
  const date = new Date(timestamp * 1000);
  return date.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
}

function escapeMarkdown(text) {
  if (!text) return '';
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

// ============ Polymarket API ============

async function polymarketRequest(endpoint, params = {}) {
  const url = new URL(`${POLYMARKET_API}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, value);
    }
  });

  const response = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'PolymarketTracker/2.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Polymarket API error: ${response.status}`);
  }

  return response.json();
}

// 获取用户活动 (TRADE, REDEEM)
async function getUserActivity(address, options = {}) {
  return polymarketRequest('/activity', {
    user: address,
    type: 'TRADE,REDEEM',
    limit: options.limit || 20,
    sortBy: 'TIMESTAMP',
    sortDirection: 'DESC',
    ...options,
  });
}

// 获取用户当前持仓
async function getUserPositions(address, options = {}) {
  return polymarketRequest('/positions', {
    user: address,
    limit: options.limit || 10,
    sortBy: options.sortBy || 'CASHPNL',
    sortDirection: 'DESC',
    sizeThreshold: 0.01,
    ...options,
  });
}

// 获取用户持仓总价值
async function getUserValue(address) {
  const result = await polymarketRequest('/value', { user: address });
  return Array.isArray(result) && result.length > 0 ? result[0] : { value: 0 };
}

// 获取用户已平仓收益
async function getClosedPositions(address, options = {}) {
  return polymarketRequest('/v1/closed-positions', {
    user: address,
    limit: options.limit || 10,
    sortBy: options.sortBy || 'REALIZEDPNL',
    sortDirection: 'DESC',
    ...options,
  });
}

// 获取用户排行榜排名
async function getLeaderboardRank(address, timePeriod = 'DAY') {
  return polymarketRequest('/v1/leaderboard', {
    user: address,
    timePeriod,
    limit: 1,
  });
}

// ============ Telegram API ============

async function sendTelegram(botToken, chatId, text, options = {}) {
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

  const result = await response.json();
  if (!result.ok) {
    console.error('Telegram error:', result.description);
    return false;
  }
  return true;
}

// ============ 消息格式化 ============

function formatBuyMessage(activity, displayName) {
  const price = (activity.price * 100).toFixed(1);
  const cost = formatUSD(activity.usdcSize);
  const size = activity.size?.toFixed(2) || '0';
  const potentialProfit = activity.size ? formatUSD(activity.size - activity.usdcSize) : '$0';
  const potentialPct = activity.size && activity.usdcSize
    ? `+${(((activity.size / activity.usdcSize) - 1) * 100).toFixed(1)}%`
    : '';

  return `🟢 *买入* | ${escapeMarkdown(displayName)}

🏷️ ${escapeMarkdown(activity.title || 'Unknown')}
📌 买入 *${escapeMarkdown(activity.outcome || '')}* @ ${price}%

💰 投入: ${cost}
📈 份数: ${size}
💵 若胜: ${potentialProfit} (${potentialPct})

⏰ ${formatTimestamp(activity.timestamp)}
🔗 [市场](https://polymarket.com/event/${activity.eventSlug || activity.slug}) | [交易](https://polygonscan.com/tx/${activity.transactionHash})`;
}

function formatSellMessage(activity, displayName) {
  const price = (activity.price * 100).toFixed(1);
  const received = formatUSD(activity.usdcSize);
  const size = activity.size?.toFixed(2) || '0';

  return `🔴 *卖出* | ${escapeMarkdown(displayName)}

🏷️ ${escapeMarkdown(activity.title || 'Unknown')}
📌 卖出 *${escapeMarkdown(activity.outcome || '')}* @ ${price}%

💵 收回: ${received}
📈 份数: ${size}

⏰ ${formatTimestamp(activity.timestamp)}
🔗 [市场](https://polymarket.com/event/${activity.eventSlug || activity.slug}) | [交易](https://polygonscan.com/tx/${activity.transactionHash})`;
}

function formatRedeemMessage(activity, displayName) {
  const redeemed = formatUSD(activity.usdcSize);
  const size = activity.size?.toFixed(2) || '0';

  return `✅ *赎回* | ${escapeMarkdown(displayName)}

🏷️ ${escapeMarkdown(activity.title || 'Unknown')}
🏆 结果: *${escapeMarkdown(activity.outcome || '')}* 胜出

💵 赎回: ${redeemed}
📈 份数: ${size}

⏰ ${formatTimestamp(activity.timestamp)}
🔗 [市场](https://polymarket.com/event/${activity.eventSlug || activity.slug}) | [交易](https://polygonscan.com/tx/${activity.transactionHash})`;
}

function formatActivityMessage(activity, displayName) {
  if (activity.type === 'TRADE') {
    if (activity.side === 'BUY') {
      return formatBuyMessage(activity, displayName);
    } else {
      return formatSellMessage(activity, displayName);
    }
  } else if (activity.type === 'REDEEM') {
    return formatRedeemMessage(activity, displayName);
  }
  return null;
}

// ============ KV 存储操作 ============

async function getSubscriptions(kv) {
  const data = await kv.get('subscriptions', { type: 'json' });
  return data || [];
}

async function saveSubscriptions(kv, subscriptions) {
  await kv.put('subscriptions', JSON.stringify(subscriptions));
}

async function getLastActivity(kv, address) {
  const key = `last_activity:${address.toLowerCase()}`;
  const value = await kv.get(key);
  return value ? parseInt(value, 10) : 0;
}

async function setLastActivity(kv, address, timestamp) {
  const key = `last_activity:${address.toLowerCase()}`;
  await kv.put(key, timestamp.toString(), { expirationTtl: 86400 * 30 });
}

// ============ 地址解析 ============

async function resolveAddressArg(arg, kv) {
  if (!arg) {
    // 如果没有参数，检查是否只有一个订阅
    const subscriptions = await getSubscriptions(kv);
    if (subscriptions.length === 1) {
      const sub = subscriptions[0];
      return {
        address: sub.address,
        displayName: sub.alias || shortenAddress(sub.address),
      };
    }
    return { address: null, displayName: null };
  }

  // 检查是否是地址
  if (arg.toLowerCase().startsWith('0x')) {
    return {
      address: arg.toLowerCase(),
      displayName: shortenAddress(arg),
    };
  }

  // 查找别名
  const subscriptions = await getSubscriptions(kv);
  const sub = subscriptions.find(
    (s) => s.alias && s.alias.toLowerCase() === arg.toLowerCase()
  );

  if (sub) {
    return {
      address: sub.address,
      displayName: sub.alias || shortenAddress(sub.address),
    };
  }

  return { address: null, displayName: null };
}

// ============ Bot 命令处理 ============

async function handleCommand(command, args, chatId, env) {
  const kv = env.POLYMARKET_KV;

  switch (command) {
    case '/start':
    case '/help':
      return `🤖 *Polymarket Tracker Bot*

*订阅管理:*
/subscribe <地址> \\[别名\\] \\- 订阅地址
/unsubscribe <地址> \\- 取消订阅
/list \\- 查看订阅列表
/alias <地址> <新别名> \\- 修改别名

*查询数据:*
/pos \\[地址/别名\\] \\- 当前持仓
/pnl \\[地址/别名\\] \\- 已实现收益
/value \\[地址/别名\\] \\- 持仓总价值
/rank \\[地址/别名\\] \\- 排行榜排名

_地址格式: 0x\\.\\.\\._`;

    case '/subscribe': {
      if (!args[0]) {
        return '❌ 请提供地址: /subscribe 0x... [别名]';
      }
      const address = args[0].toLowerCase();
      if (!address.startsWith('0x') || address.length !== 42) {
        return '❌ 无效地址格式';
      }

      const subscriptions = await getSubscriptions(kv);
      const existing = subscriptions.find((s) => s.address === address);
      if (existing) {
        return `⚠️ 已订阅: ${existing.alias || shortenAddress(address)}`;
      }

      // 获取用户 pseudonym 作为默认别名
      let defaultAlias = args.slice(1).join(' ');
      if (!defaultAlias) {
        try {
          const activities = await getUserActivity(address, { limit: 1 });
          if (activities.length > 0 && activities[0].pseudonym) {
            defaultAlias = activities[0].pseudonym;
          }
        } catch (e) {
          console.error('Failed to get pseudonym:', e);
        }
      }

      subscriptions.push({
        address,
        alias: defaultAlias || '',
        chatId,
        addedAt: Date.now(),
      });
      await saveSubscriptions(kv, subscriptions);

      // 设置初始 last_activity 为当前时间，避免推送历史消息
      await setLastActivity(kv, address, Math.floor(Date.now() / 1000));

      const displayName = defaultAlias || shortenAddress(address);
      return `✅ 已订阅: *${escapeMarkdown(displayName)}*\n地址: \`${address}\``;
    }

    case '/unsubscribe': {
      if (!args[0]) {
        return '❌ 请提供地址: /unsubscribe 0x...';
      }
      const address = args[0].toLowerCase();
      const subscriptions = await getSubscriptions(kv);
      const index = subscriptions.findIndex((s) => s.address === address);

      if (index === -1) {
        return '❌ 未找到该订阅';
      }

      const removed = subscriptions.splice(index, 1)[0];
      await saveSubscriptions(kv, subscriptions);
      await kv.delete(`last_activity:${address}`);

      return `✅ 已取消订阅: ${removed.alias || shortenAddress(address)}`;
    }

    case '/list': {
      const subscriptions = await getSubscriptions(kv);
      if (subscriptions.length === 0) {
        return '📋 暂无订阅\n\n使用 /subscribe 添加';
      }

      let msg = '📋 *订阅列表:*\n\n';
      subscriptions.forEach((sub, i) => {
        const name = sub.alias || shortenAddress(sub.address);
        msg += `${i + 1}\\. *${escapeMarkdown(name)}*\n   \`${sub.address}\`\n\n`;
      });
      return msg;
    }

    case '/alias': {
      if (!args[0] || !args[1]) {
        return '❌ 用法: /alias 0x... 新别名';
      }
      const address = args[0].toLowerCase();
      const newAlias = args.slice(1).join(' ');

      const subscriptions = await getSubscriptions(kv);
      const sub = subscriptions.find((s) => s.address === address);
      if (!sub) {
        return '❌ 未找到该订阅';
      }

      sub.alias = newAlias;
      await saveSubscriptions(kv, subscriptions);
      return `✅ 别名已更新: *${escapeMarkdown(newAlias)}*`;
    }

    case '/pos': {
      const { address, displayName } = await resolveAddressArg(args[0], kv);
      if (!address) {
        return '❌ 请提供地址或别名: /pos 0x... 或 /pos 别名';
      }

      try {
        const positions = await getUserPositions(address);
        if (!positions || positions.length === 0) {
          return `📊 *${escapeMarkdown(displayName)}* 暂无持仓`;
        }

        let msg = `📊 *${escapeMarkdown(displayName)}* 当前持仓:\n\n`;
        positions.slice(0, 8).forEach((pos, i) => {
          const pnl = formatUSD(pos.cashPnl);
          const pnlPct = formatPercent(pos.percentPnl);
          const price = (pos.curPrice * 100).toFixed(1);
          const pnlEmoji = pos.cashPnl >= 0 ? '🟢' : '🔴';
          msg += `${i + 1}\\. *${escapeMarkdown((pos.title || 'Unknown').substring(0, 30))}*\n`;
          msg += `   ${escapeMarkdown(pos.outcome || '')} @ ${price}%\n`;
          msg += `   ${pnlEmoji} ${pnl} (${pnlPct})\n\n`;
        });
        return msg;
      } catch (e) {
        console.error('Error getting positions:', e);
        return '❌ 获取持仓失败';
      }
    }

    case '/pnl': {
      const { address, displayName } = await resolveAddressArg(args[0], kv);
      if (!address) {
        return '❌ 请提供地址或别名: /pnl 0x...';
      }

      try {
        const closed = await getClosedPositions(address);
        if (!closed || closed.length === 0) {
          return `📈 *${escapeMarkdown(displayName)}* 暂无已平仓记录`;
        }

        let totalPnl = 0;
        let msg = `📈 *${escapeMarkdown(displayName)}* 已实现收益:\n\n`;
        closed.slice(0, 8).forEach((pos, i) => {
          const pnl = pos.realizedPnl || 0;
          totalPnl += pnl;
          const pnlStr = formatUSD(pnl);
          const pnlEmoji = pnl >= 0 ? '✅' : '❌';
          msg += `${i + 1}\\. *${escapeMarkdown((pos.title || 'Unknown').substring(0, 30))}*\n`;
          msg += `   ${pnlEmoji} ${pnlStr}\n\n`;
        });
        msg += `💰 *合计: ${formatUSD(totalPnl)}*`;
        return msg;
      } catch (e) {
        console.error('Error getting closed positions:', e);
        return '❌ 获取收益失败';
      }
    }

    case '/value': {
      const { address, displayName } = await resolveAddressArg(args[0], kv);
      if (!address) {
        return '❌ 请提供地址或别名: /value 0x...';
      }

      try {
        const result = await getUserValue(address);
        const value = formatUSD(result.value);
        return `💰 *${escapeMarkdown(displayName)}* 持仓总价值:\n\n*${value}*`;
      } catch (e) {
        console.error('Error getting value:', e);
        return '❌ 获取价值失败';
      }
    }

    case '/rank': {
      const { address, displayName } = await resolveAddressArg(args[0], kv);
      if (!address) {
        return '❌ 请提供地址或别名: /rank 0x...';
      }

      try {
        const [dayRank, weekRank, monthRank] = await Promise.all([
          getLeaderboardRank(address, 'DAY'),
          getLeaderboardRank(address, 'WEEK'),
          getLeaderboardRank(address, 'MONTH'),
        ]);

        let msg = `🏆 *${escapeMarkdown(displayName)}* 排行榜:\n\n`;

        const formatRank = (data, period) => {
          if (!data || data.length === 0) return `*${period}:* 未上榜\n\n`;
          const r = data[0];
          return `*${period}:*\n   排名: \\#${r.rank}\n   盈亏: ${formatUSD(r.pnl)}\n   交易量: ${formatUSD(r.vol)}\n\n`;
        };

        msg += formatRank(dayRank, '今日');
        msg += formatRank(weekRank, '本周');
        msg += formatRank(monthRank, '本月');

        return msg;
      } catch (e) {
        console.error('Error getting rank:', e);
        return '❌ 获取排名失败';
      }
    }

    default:
      return null;
  }
}

// ============ Webhook 处理 ============

async function handleWebhook(request, env) {
  try {
    const update = await request.json();

    // 处理消息
    const message = update.message;
    if (!message || !message.text) {
      return new Response('OK');
    }

    const chatId = message.chat.id;
    const text = message.text.trim();

    // 解析命令
    if (!text.startsWith('/')) {
      return new Response('OK');
    }

    const parts = text.split(/\s+/);
    const command = parts[0].split('@')[0].toLowerCase(); // 移除 @botname
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

// ============ 定时任务 ============

async function checkSubscriptions(env) {
  console.log('Starting subscription check...');

  const kv = env.POLYMARKET_KV;
  const botToken = env.TG_BOT_TOKEN;

  const subscriptions = await getSubscriptions(kv);
  console.log(`Found ${subscriptions.length} subscriptions`);

  if (subscriptions.length === 0) {
    return { total: 0, processed: 0, notified: 0 };
  }

  let totalProcessed = 0;
  let totalNotified = 0;

  for (const sub of subscriptions) {
    try {
      const lastActivity = await getLastActivity(kv, sub.address);
      console.log(`Checking ${sub.alias || sub.address}, last: ${lastActivity}`);

      const activities = await getUserActivity(sub.address, { limit: 20 });

      // 过滤新活动
      const newActivities = activities.filter((a) => a.timestamp > lastActivity);
      console.log(`Found ${newActivities.length} new activities`);

      if (newActivities.length === 0) continue;

      // 按时间排序（旧的在前）
      newActivities.sort((a, b) => a.timestamp - b.timestamp);

      const displayName = sub.alias || sub.pseudonym || shortenAddress(sub.address);
      let maxTimestamp = lastActivity;

      for (const activity of newActivities) {
        const message = formatActivityMessage(activity, displayName);
        if (message) {
          const chatId = sub.chatId || env.TG_CHAT_ID;
          const sent = await sendTelegram(botToken, chatId, message);
          if (sent) {
            totalNotified++;
            console.log(`Notified: ${activity.type} ${activity.transactionHash}`);
          }
          // 避免 Telegram 限流
          await new Promise((r) => setTimeout(r, 100));
        }
        maxTimestamp = Math.max(maxTimestamp, activity.timestamp);
        totalProcessed++;
      }

      if (maxTimestamp > lastActivity) {
        await setLastActivity(kv, sub.address, maxTimestamp);
      }
    } catch (error) {
      console.error(`Error checking ${sub.address}:`, error);
    }
  }

  console.log(`Done: ${totalProcessed} processed, ${totalNotified} notified`);
  return { total: subscriptions.length, processed: totalProcessed, notified: totalNotified };
}

// ============ HTTP 处理 ============

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  // Telegram Webhook
  if (path === '/webhook' && request.method === 'POST') {
    return handleWebhook(request, env);
  }

  // 手动触发检查
  if (path === '/check') {
    const results = await checkSubscriptions(env);
    return Response.json(results);
  }

  // 健康检查
  if (path === '/health') {
    return Response.json({ status: 'ok', timestamp: Date.now() });
  }

  // 设置 Webhook
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
    const result = await response.json();
    return Response.json(result);
  }

  // 查看订阅列表
  if (path === '/subscriptions') {
    const subscriptions = await getSubscriptions(env.POLYMARKET_KV);
    return Response.json(subscriptions);
  }

  // 默认响应
  return Response.json({
    name: 'Polymarket Tracker Bot',
    version: '2.0.0',
    endpoints: {
      'POST /webhook': 'Telegram webhook',
      'GET /check': 'Manually trigger check',
      'GET /health': 'Health check',
      'GET /setWebhook?url=': 'Set Telegram webhook URL',
      'GET /subscriptions': 'View subscriptions',
    },
  });
}

// ============ 导出 ============

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkSubscriptions(env));
  },
};
