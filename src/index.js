/**
 * Polymarket Smart Money Tracker v2.0
 *
 * Features:
 * - Subscribe/manage addresses via Telegram Bot
 * - Auto push trading activities (BUY/SELL/REDEEM)
 * - Query positions, PnL, rankings
 *
 * Environment:
 * - TG_BOT_TOKEN: Telegram Bot Token
 *
 * KV Storage:
 * - subscriptions: [{address, alias, chatId, addedAt}]
 * - last_activity:{address}: Last processed activity timestamp
 */

const POLYMARKET_API = 'https://data-api.polymarket.com';

// ============ Utilities ============

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
  return text.replace(/[_*`\[]/g, '\\$&');
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

// Get user activity (TRADE, REDEEM)
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

// Get user positions
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

// Get user portfolio value
async function getUserValue(address) {
  const result = await polymarketRequest('/value', { user: address });
  return Array.isArray(result) && result.length > 0 ? result[0] : { value: 0 };
}

// Get user closed positions
async function getClosedPositions(address, options = {}) {
  return polymarketRequest('/v1/closed-positions', {
    user: address,
    limit: options.limit || 10,
    sortBy: options.sortBy || 'REALIZEDPNL',
    sortDirection: 'DESC',
    ...options,
  });
}

// Get user leaderboard rank
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

// ============ Message Formatting ============

function formatBuyMessage(activity, displayName) {
  const price = (activity.price * 100).toFixed(1);
  const cost = formatUSD(activity.usdcSize);
  const size = activity.size?.toFixed(2) || '0';
  const potentialProfit = activity.size ? formatUSD(activity.size - activity.usdcSize) : '$0';
  const potentialPct = activity.size && activity.usdcSize
    ? `+${(((activity.size / activity.usdcSize) - 1) * 100).toFixed(1)}%`
    : '';

  return `🟢 *BUY* | ${escapeMarkdown(displayName)}

🏷️ ${escapeMarkdown(activity.title || 'Unknown')}
📌 *${escapeMarkdown(activity.outcome || '')}* @ ${price}%

💰 Cost: ${cost}
📈 Shares: ${size}
💵 If Win: ${potentialProfit} (${potentialPct})

⏰ ${formatTimestamp(activity.timestamp)}
🔗 [Market](https://polymarket.com/event/${activity.eventSlug || activity.slug}) | [Tx](https://polygonscan.com/tx/${activity.transactionHash})`;
}

function formatSellMessage(activity, displayName) {
  const price = (activity.price * 100).toFixed(1);
  const received = formatUSD(activity.usdcSize);
  const size = activity.size?.toFixed(2) || '0';

  return `🔴 *SELL* | ${escapeMarkdown(displayName)}

🏷️ ${escapeMarkdown(activity.title || 'Unknown')}
📌 *${escapeMarkdown(activity.outcome || '')}* @ ${price}%

💵 Received: ${received}
📈 Shares: ${size}

⏰ ${formatTimestamp(activity.timestamp)}
🔗 [Market](https://polymarket.com/event/${activity.eventSlug || activity.slug}) | [Tx](https://polygonscan.com/tx/${activity.transactionHash})`;
}

function formatRedeemMessage(activity, displayName) {
  const redeemed = formatUSD(activity.usdcSize);

  return `✅ *REDEEM* | ${escapeMarkdown(displayName)}

🏷️ ${escapeMarkdown(activity.title || 'Unknown')}
💵 Redeemed: ${redeemed}

⏰ ${formatTimestamp(activity.timestamp)}
🔗 [Market](https://polymarket.com/event/${activity.eventSlug || activity.slug}) | [Tx](https://polygonscan.com/tx/${activity.transactionHash})`;
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

// ============ KV Storage ============

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

// ============ Address Resolution ============

async function resolveAddressArg(arg, kv) {
  if (!arg) {
    // If no arg, check if there's only one subscription
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

  // Check if it's an address
  if (arg.toLowerCase().startsWith('0x')) {
    return {
      address: arg.toLowerCase(),
      displayName: shortenAddress(arg),
    };
  }

  // Find by alias
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

// ============ Bot Commands ============

async function handleCommand(command, args, chatId, env) {
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
      const existing = subscriptions.find((s) => s.address === address);
      if (existing) {
        return `⚠️ Already subscribed: ${existing.alias || shortenAddress(address)}`;
      }

      // Get pseudonym as default alias
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

      // Set initial last_activity to now to avoid pushing history
      await setLastActivity(kv, address, Math.floor(Date.now() / 1000));

      const displayName = defaultAlias || shortenAddress(address);
      return `✅ Subscribed: *${escapeMarkdown(displayName)}*\nAddress: \`${address}\``;
    }

    case '/unsubscribe': {
      if (!args[0]) {
        return '❌ Please provide address: /unsubscribe 0x...';
      }
      const address = args[0].toLowerCase();
      const subscriptions = await getSubscriptions(kv);
      const index = subscriptions.findIndex((s) => s.address === address);

      if (index === -1) {
        return '❌ Subscription not found';
      }

      const removed = subscriptions.splice(index, 1)[0];
      await saveSubscriptions(kv, subscriptions);
      await kv.delete(`last_activity:${address}`);

      return `✅ Unsubscribed: ${removed.alias || shortenAddress(address)}`;
    }

    case '/list': {
      const subscriptions = await getSubscriptions(kv);
      if (subscriptions.length === 0) {
        return '📋 No subscriptions\n\nUse /subscribe to add';
      }

      let msg = '📋 *Subscriptions:*\n\n';
      subscriptions.forEach((sub, i) => {
        const name = sub.alias || shortenAddress(sub.address);
        msg += `${i + 1}. *${escapeMarkdown(name)}*\n   \`${sub.address}\`\n\n`;
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
      const sub = subscriptions.find((s) => s.address === address);
      if (!sub) {
        return '❌ Subscription not found';
      }

      sub.alias = newAlias;
      await saveSubscriptions(kv, subscriptions);
      return `✅ Alias updated: *${escapeMarkdown(newAlias)}*`;
    }

    case '/pos': {
      const { address, displayName } = await resolveAddressArg(args[0], kv);
      if (!address) {
        return '❌ Please provide address or alias: /pos 0x...';
      }

      try {
        const positions = await getUserPositions(address);
        if (!positions || positions.length === 0) {
          return `📊 *${escapeMarkdown(displayName)}* has no positions`;
        }

        let msg = `📊 *${escapeMarkdown(displayName)}* Positions:\n\n`;
        positions.slice(0, 8).forEach((pos, i) => {
          const pnl = formatUSD(pos.cashPnl);
          const pnlPct = formatPercent(pos.percentPnl);
          const price = (pos.curPrice * 100).toFixed(1);
          const pnlEmoji = pos.cashPnl >= 0 ? '🟢' : '🔴';
          msg += `${i + 1}. *${escapeMarkdown((pos.title || 'Unknown').substring(0, 30))}*\n`;
          msg += `   ${escapeMarkdown(pos.outcome || '')} @ ${price}%\n`;
          msg += `   ${pnlEmoji} ${pnl} (${pnlPct})\n\n`;
        });
        return msg;
      } catch (e) {
        console.error('Error getting positions:', e);
        return '❌ Failed to get positions';
      }
    }

    case '/pnl': {
      const { address, displayName } = await resolveAddressArg(args[0], kv);
      if (!address) {
        return '❌ Please provide address or alias: /pnl 0x...';
      }

      try {
        const closed = await getClosedPositions(address);
        if (!closed || closed.length === 0) {
          return `📈 *${escapeMarkdown(displayName)}* has no closed positions`;
        }

        let totalPnl = 0;
        let msg = `📈 *${escapeMarkdown(displayName)}* Realized PnL:\n\n`;
        closed.slice(0, 8).forEach((pos, i) => {
          const pnl = pos.realizedPnl || 0;
          totalPnl += pnl;
          const pnlStr = formatUSD(pnl);
          const pnlEmoji = pnl >= 0 ? '✅' : '❌';
          msg += `${i + 1}. *${escapeMarkdown((pos.title || 'Unknown').substring(0, 30))}*\n`;
          msg += `   ${pnlEmoji} ${pnlStr}\n\n`;
        });
        msg += `💰 *Total: ${formatUSD(totalPnl)}*`;
        return msg;
      } catch (e) {
        console.error('Error getting closed positions:', e);
        return '❌ Failed to get PnL';
      }
    }

    case '/value': {
      const { address, displayName } = await resolveAddressArg(args[0], kv);
      if (!address) {
        return '❌ Please provide address or alias: /value 0x...';
      }

      try {
        const result = await getUserValue(address);
        const value = formatUSD(result.value);
        return `💰 *${escapeMarkdown(displayName)}* Portfolio Value:\n\n*${value}*`;
      } catch (e) {
        console.error('Error getting value:', e);
        return '❌ Failed to get value';
      }
    }

    case '/rank': {
      const { address, displayName } = await resolveAddressArg(args[0], kv);
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

        let msg = `🏆 *${escapeMarkdown(displayName)}* Leaderboard:\n\n`;

        const formatRank = (data, period) => {
          if (!data || data.length === 0) return `*${period}:* Not ranked\n\n`;
          const r = data[0];
          return `*${period}:*\n   Rank: #${r.rank}\n   PnL: ${formatUSD(r.pnl)}\n   Volume: ${formatUSD(r.vol)}\n\n`;
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

// ============ Webhook Handler ============

async function handleWebhook(request, env) {
  try {
    const update = await request.json();
    const message = update.message;
    if (!message || !message.text) return new Response('OK');

    const chatId = message.chat.id;
    const text = message.text.trim();
    if (!text.startsWith('/')) return new Response('OK');

    const parts = text.split(/\s+/);
    const command = parts[0].split('@')[0].toLowerCase();
    const args = parts.slice(1);
    console.log(`Command: ${command}, args: ${args.join(', ')}`);

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

// ============ Scheduled Task ============

async function checkSubscriptions(env) {
  const kv = env.POLYMARKET_KV;
  const botToken = env.TG_BOT_TOKEN;
  const subscriptions = await getSubscriptions(kv);

  if (subscriptions.length === 0) {
    return { total: 0, processed: 0, notified: 0 };
  }

  let totalProcessed = 0;
  let totalNotified = 0;

  for (const sub of subscriptions) {
    try {
      const lastActivity = await getLastActivity(kv, sub.address);
      const activities = await getUserActivity(sub.address, { limit: 20 });

      // Filter new activities
      const newActivities = activities.filter((a) => a.timestamp > lastActivity);
      if (newActivities.length === 0) continue;

      // Sort by time (oldest first)
      newActivities.sort((a, b) => a.timestamp - b.timestamp);

      const displayName = sub.alias || sub.pseudonym || shortenAddress(sub.address);
      let maxTimestamp = lastActivity;

      for (const activity of newActivities) {
        const message = formatActivityMessage(activity, displayName);
        if (message && sub.chatId) {
          const sent = await sendTelegram(botToken, sub.chatId, message);
          if (sent) {
            totalNotified++;
            console.log(`Notified: ${activity.type} ${activity.transactionHash}`);
          }
          // Avoid Telegram rate limit
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

  return { total: subscriptions.length, processed: totalProcessed, notified: totalNotified };
}

// ============ HTTP Handler ============

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  // Telegram Webhook
  if (path === '/webhook' && request.method === 'POST') {
    return handleWebhook(request, env);
  }

  // Manual trigger
  if (path === '/check') {
    const results = await checkSubscriptions(env);
    return Response.json(results);
  }

  // Health check
  if (path === '/health') {
    return Response.json({ status: 'ok', timestamp: Date.now() });
  }

  // Set Webhook
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

  // View subscriptions
  if (path === '/subscriptions') {
    const subscriptions = await getSubscriptions(env.POLYMARKET_KV);
    return Response.json(subscriptions);
  }

  // Default response
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

// ============ Export ============

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(checkSubscriptions(env));
  },
};
