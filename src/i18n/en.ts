/**
 * English language strings
 */

export const en = {
  // Errors
  error: {
    provideAddress: '❌ Please provide address: /sub 0x... [alias]',
    provideAddressUnsubscribe: '❌ Please provide address: /unsub 0x...',
    provideAddressOrAlias: '❌ Please provide address or alias',
    invalidAddress: '❌ Invalid address format',
    notFound: '❌ Subscription not found',
    aliasUsage: '❌ Usage: /alias 0x... new\\_alias',
    failedPositions: '❌ Failed to get positions',
    failedPnl: '❌ Failed to get PnL',
    failedValue: '❌ Failed to get value',
    failedRank: '❌ Failed to get rank',
    langUsage: '❌ Supported: en, zh',
    maxSubscriptions: '❌ Max 10 subscriptions reached. Use /unsub to remove some.',
  },

  // Commands
  cmd: {
    help: `🤖 *Polymarket Tracker Bot*

*Subscription:*
/sub <address> [alias] - Subscribe
/unsub <address> - Unsubscribe
/list - List subscriptions
/alias <address> <new\\_alias> - Update alias

*Query:*
/pos [address/alias] - Positions
/pnl [address/alias] - Realized PnL
/value [address/alias] - Portfolio value
/rank [address/alias] - Leaderboard

*Settings:*
/lang - Switch language

_Address format: 0x..._`,
    alreadySubscribed: '⚠️ Already subscribed',
    subscribed: '✅ Subscribed',
    unsubscribed: '✅ Unsubscribed',
    noSubscriptions: '📋 No subscriptions\n\nUse /sub to add',
    subscriptionsList: '📋 *Subscriptions:*',
    aliasUpdated: '✅ Alias updated',
    positions: 'Positions:',
    noPositions: 'has no positions',
    realizedPnl: 'Realized PnL:',
    noClosedPositions: 'has no closed positions',
    portfolioValue: 'Portfolio Value:',
    leaderboard: 'Leaderboard:',
    notRanked: 'Not ranked',
    today: 'Today',
    thisWeek: 'This Week',
    thisMonth: 'This Month',
    allTime: 'All Time',
    total: 'Total',
  },

  // Push notifications
  push: {
    buy: '🟢 *BUY*',
    sell: '🔴 *SELL*',
    redeem: '✅ *REDEEM*',
    cost: 'Cost',
    received: 'Received',
    redeemed: 'Redeemed',
    shares: 'Shares',
    ifWin: 'If Win',
    market: 'Market',
    tx: 'Tx',
  },

  // Positions display
  pos: {
    current: 'Current',
    avg: 'Avg',
    shares: 'Shares',
    unknown: 'Unknown',
  },

  // PnL display
  pnl: {
    profit: 'PnL',
  },

  // Rank display
  rank: {
    pnl: 'PnL',
    volume: 'Volume',
  },

  // Language
  lang: {
    select: '🌐 Select language:',
    switched: '✅ Language switched to: {lang}',
    english: 'English',
    chinese: '中文',
  },
};

export type Messages = typeof en;
