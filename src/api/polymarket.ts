/**
 * Polymarket API wrapper
 */

import type { Activity, Position, ClosedPosition, PortfolioValue, LeaderboardEntry } from '../types/index.js';

const POLYMARKET_API = 'https://data-api.polymarket.com';

interface RequestParams {
  [key: string]: string | number | undefined | null;
}

export async function polymarketRequest<T>(endpoint: string, params: RequestParams = {}): Promise<T> {
  const url = new URL(`${POLYMARKET_API}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, String(value));
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

  return response.json() as Promise<T>;
}

interface ActivityOptions {
  limit?: number;
  [key: string]: string | number | undefined;
}

export async function getUserActivity(address: string, options: ActivityOptions = {}): Promise<Activity[]> {
  return polymarketRequest<Activity[]>('/activity', {
    user: address,
    type: 'TRADE,REDEEM',
    limit: options.limit || 20,
    sortBy: 'TIMESTAMP',
    sortDirection: 'DESC',
    ...options,
  });
}

interface PositionOptions {
  limit?: number;
  sortBy?: string;
  [key: string]: string | number | undefined;
}

export async function getUserPositions(address: string, options: PositionOptions = {}): Promise<Position[]> {
  return polymarketRequest<Position[]>('/positions', {
    user: address,
    limit: options.limit || 20,
    sortBy: options.sortBy || 'CURRENT',
    sortDirection: 'DESC',
    sizeThreshold: 1,
    ...options,
  });
}

export async function getUserValue(address: string): Promise<PortfolioValue> {
  const result = await polymarketRequest<PortfolioValue[]>('/value', { user: address });
  return Array.isArray(result) && result.length > 0 ? result[0] : { value: 0 };
}

interface ClosedPositionOptions {
  limit?: number;
  sortBy?: string;
  [key: string]: string | number | undefined;
}

export async function getClosedPositions(address: string, options: ClosedPositionOptions = {}): Promise<ClosedPosition[]> {
  return polymarketRequest<ClosedPosition[]>('/v1/closed-positions', {
    user: address,
    limit: options.limit || 20,
    sortBy: options.sortBy || 'REALIZEDPNL',
    sortDirection: 'DESC',
    ...options,
  });
}

export async function getLeaderboardRank(address: string, timePeriod: string = 'DAY'): Promise<LeaderboardEntry[]> {
  return polymarketRequest<LeaderboardEntry[]>('/v1/leaderboard', {
    user: address,
    timePeriod,
    limit: 1,
  });
}
