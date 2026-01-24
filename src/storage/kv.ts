/**
 * KV Storage operations
 *
 * KV 结构：
 * - sub:{chatId} - 用户订阅列表
 * - config:{chatId} - 用户配置 (lang, threshold)
 * - last_activities - 所有地址的最后活动时间
 */

import { shortenAddress } from '../utils/format.js';
import type { ResolvedAddress, Lang } from '../types/index.js';

const DEFAULT_THRESHOLD = 10;
const LAST_ACTIVITY_TTL = 86400 * 90; // 90 天

// ============ 订阅相关 ============

export interface SubRecord {
  address: string;
  alias: string;
  addedAt: number;
}

/**
 * 获取用户订阅
 */
export async function getUserSubscriptions(kv: KVNamespace, chatId: number): Promise<SubRecord[]> {
  const data = await kv.get(`sub:${chatId}`, { type: 'json' });
  return (data as SubRecord[]) || [];
}

/**
 * 保存用户订阅
 */
export async function saveUserSubscriptions(kv: KVNamespace, chatId: number, subs: SubRecord[]): Promise<void> {
  // 按 address 去重，保留最新的
  const seen = new Map<string, SubRecord>();
  for (const sub of subs) {
    seen.set(sub.address.toLowerCase(), sub);
  }
  await kv.put(`sub:${chatId}`, JSON.stringify([...seen.values()]));
}

/**
 * 获取所有用户订阅（用于 Cron，使用 list API）
 */
export async function getAllUserSubscriptions(kv: KVNamespace): Promise<Map<number, SubRecord[]>> {
  const result = new Map<number, SubRecord[]>();

  const list = await kv.list({ prefix: 'sub:' });

  for (const key of list.keys) {
    const chatId = parseInt(key.name.replace('sub:', ''), 10);
    const subs = await kv.get(key.name, { type: 'json' }) as SubRecord[];
    if (subs && subs.length > 0) {
      result.set(chatId, subs);
    }
  }

  return result;
}

// ============ 用户配置相关 ============

export interface UserConfig {
  lang: Lang;
  threshold: number;
}

/**
 * 获取用户配置
 */
export async function getUserConfig(kv: KVNamespace, chatId: number): Promise<UserConfig> {
  const data = await kv.get(`config:${chatId}`, { type: 'json' });
  if (data) {
    return data as UserConfig;
  }
  return { lang: 'en', threshold: DEFAULT_THRESHOLD };
}

/**
 * 保存用户配置
 */
export async function saveUserConfig(kv: KVNamespace, chatId: number, config: Partial<UserConfig>): Promise<void> {
  const current = await getUserConfig(kv, chatId);
  const updated: UserConfig = {
    lang: config.lang ?? current.lang,
    threshold: config.threshold ?? current.threshold,
  };
  await kv.put(`config:${chatId}`, JSON.stringify(updated));
}

/**
 * 获取所有用户配置（用于 Cron，使用 list API）
 */
export async function getAllUserConfigs(kv: KVNamespace): Promise<Map<number, UserConfig>> {
  const result = new Map<number, UserConfig>();

  const list = await kv.list({ prefix: 'config:' });

  for (const key of list.keys) {
    const chatId = parseInt(key.name.replace('config:', ''), 10);
    const config = await kv.get(key.name, { type: 'json' }) as UserConfig;
    if (config) {
      result.set(chatId, config);
    }
  }

  return result;
}

/**
 * 获取用户语言
 */
export async function getLang(kv: KVNamespace, chatId: number): Promise<Lang> {
  const config = await getUserConfig(kv, chatId);
  return config.lang;
}

/**
 * 设置用户语言
 */
export async function setLang(kv: KVNamespace, chatId: number, lang: Lang): Promise<void> {
  await saveUserConfig(kv, chatId, { lang });
}

/**
 * 获取用户阈值
 */
export async function getThreshold(kv: KVNamespace, chatId: number): Promise<number> {
  const config = await getUserConfig(kv, chatId);
  return config.threshold;
}

/**
 * 设置用户阈值
 */
export async function setThreshold(kv: KVNamespace, chatId: number, amount: number): Promise<void> {
  await saveUserConfig(kv, chatId, { threshold: amount });
}

// ============ LastActivity 相关 ============

/**
 * 读取所有地址的 lastActivity
 */
export async function getAllLastActivities(kv: KVNamespace): Promise<Record<string, number>> {
  const data = await kv.get('last_activities', { type: 'json' });
  return (data as Record<string, number>) || {};
}

/**
 * 保存 lastActivity + 清理孤儿数据
 */
export async function saveLastActivities(
  kv: KVNamespace,
  activities: Record<string, number>,
  validAddresses?: Set<string>
): Promise<void> {
  if (validAddresses) {
    const now = Math.floor(Date.now() / 1000);
    for (const addr of Object.keys(activities)) {
      if (!validAddresses.has(addr) && now - activities[addr] > LAST_ACTIVITY_TTL) {
        delete activities[addr];
      }
    }
  }
  await kv.put('last_activities', JSON.stringify(activities));
}

// ============ 地址解析 ============

export async function resolveAddressArg(
  arg: string | undefined,
  kv: KVNamespace,
  chatId: number
): Promise<ResolvedAddress> {
  const userSubs = await getUserSubscriptions(kv, chatId);

  if (!arg) {
    if (userSubs.length === 1) {
      const sub = userSubs[0];
      return {
        address: sub.address,
        displayName: sub.alias || shortenAddress(sub.address),
      };
    }
    return { address: null, displayName: null };
  }

  if (arg.toLowerCase().startsWith('0x')) {
    const addr = arg.toLowerCase();
    const sub = userSubs.find((s) => s.address === addr);
    return {
      address: addr,
      displayName: sub?.alias || shortenAddress(arg),
    };
  }

  const sub = userSubs.find(
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
