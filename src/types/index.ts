/**
 * Type definitions for Polymarket Tracker
 */

// Language type
export type Lang = 'en' | 'zh';

// Command response with optional reply markup
export interface CommandResponse {
  text: string;
  reply_markup?: object;
}

// Environment bindings
export interface Env {
  POLYMARKET_KV: KVNamespace;
  TG_BOT_TOKEN: string;
  WEBHOOK_SECRET?: string; // Optional: Telegram webhook secret token
  SCHEDULER_DO: DurableObjectNamespace; // Durable Object for scheduling
  CHECK_INTERVAL_MS?: string; // Polling interval in milliseconds (default: 10000)
}

// Subscription data structure
export interface Subscription {
  address: string;
  alias: string;
  chatId: number;
  addedAt: number;
}

// Polymarket Activity
export interface Activity {
  type: 'TRADE' | 'REDEEM';
  side?: 'BUY' | 'SELL';
  timestamp: number;
  price: number;
  usdcSize: number;
  size?: number;
  title?: string;
  outcome?: string;
  eventSlug?: string;
  slug?: string;
  transactionHash?: string;
  name?: string;
}

// Polymarket Position
export interface Position {
  title?: string;
  outcome?: string;
  curPrice: number;
  avgPrice: number;
  currentValue: number;
  initialValue: number;
  percentPnl: number;
  size?: number;
  redeemable?: boolean;
  eventSlug?: string;
  slug?: string;
}

// Closed Position
export interface ClosedPosition {
  title?: string;
  outcome?: string;
  avgPrice?: number;
  realizedPnl?: number;
  timestamp?: number;
  eventSlug?: string;
  slug?: string;
}

// Portfolio Value
export interface PortfolioValue {
  value: number;
}

// Leaderboard Entry
export interface LeaderboardEntry {
  rank: number;
  pnl: number;
  vol: number;
}

// Address Resolution Result
export interface ResolvedAddress {
  address: string | null;
  displayName: string | null;
}

// Check Subscriptions Result
export interface CheckResult {
  total: number;
  addresses?: number;
  processed: number;
  notified: number;
}
