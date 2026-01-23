/**
 * Chinese language strings
 */

import type { Messages } from './en.js';

export const zh: Messages = {
  // Errors
  error: {
    provideAddress: '❌ 请提供地址: /sub 0x... [别名]',
    provideAddressUnsubscribe: '❌ 请提供地址: /unsub 0x...',
    provideAddressOrAlias: '❌ 请提供地址或别名',
    invalidAddress: '❌ 地址格式无效',
    notFound: '❌ 未找到订阅',
    aliasUsage: '❌ 用法: /alias 0x... 新别名',
    failedPositions: '❌ 获取持仓失败',
    failedPnl: '❌ 获取盈亏失败',
    failedValue: '❌ 获取价值失败',
    failedRank: '❌ 获取排名失败',
    langUsage: '❌ 支持: en, zh',
  },

  // Commands
  cmd: {
    help: `🤖 *Polymarket 跟踪器*

*订阅管理:*
/sub <地址> [别名] - 订阅
/unsub <地址> - 取消订阅
/list - 订阅列表
/alias <地址> <新别名> - 修改别名

*查询:*
/pos [地址/别名] - 当前持仓
/pnl [地址/别名] - 已实现盈亏
/value [地址/别名] - 组合价值
/rank [地址/别名] - 排行榜

*设置:*
/lang - 切换语言

_地址格式: 0x..._`,
    alreadySubscribed: '⚠️ 已订阅',
    subscribed: '✅ 已订阅',
    unsubscribed: '✅ 已取消订阅',
    noSubscriptions: '📋 暂无订阅\n\n使用 /sub 添加',
    subscriptionsList: '📋 *订阅列表:*',
    aliasUpdated: '✅ 别名已更新',
    positions: '持仓:',
    noPositions: '暂无持仓',
    realizedPnl: '已实现盈亏:',
    noClosedPositions: '暂无已平仓记录',
    portfolioValue: '组合价值:',
    leaderboard: '排行榜:',
    notRanked: '未上榜',
    today: '今日',
    thisWeek: '本周',
    thisMonth: '本月',
    allTime: '总榜',
    total: '合计',
  },

  // Push notifications
  push: {
    buy: '🟢 *买入*',
    sell: '🔴 *卖出*',
    redeem: '✅ *赎回*',
    cost: '成本',
    received: '收到',
    redeemed: '赎回金额',
    shares: '份额',
    ifWin: '若胜',
    market: '市场',
    tx: '交易',
  },

  // Positions display
  pos: {
    current: '现价',
    avg: '均价',
    shares: '份额',
    unknown: '未知',
  },

  // PnL display
  pnl: {
    profit: '盈亏',
  },

  // Rank display
  rank: {
    pnl: '盈亏',
    volume: '交易量',
  },

  // Language
  lang: {
    select: '🌐 选择语言:',
    switched: '✅ 语言已切换为: {lang}',
    english: 'English',
    chinese: '中文',
  },
};
