/**
 * KV Storage operations
 */

import { shortenAddress } from '../utils/format.js';
import type { Subscription, ResolvedAddress, Lang } from '../types/index.js';

const DEFAULT_THRESHOLD = 10;

export async function getSubscriptions(kv: KVNamespace): Promise<Subscription[]> {
  const data = await kv.get('subscriptions', { type: 'json' });
  return (data as Subscription[]) || [];
}

export async function saveSubscriptions(kv: KVNamespace, subscriptions: Subscription[]): Promise<void> {
  // 按 chatId + address 去重，保留最新的（后面的）
  const seen = new Map<string, Subscription>();
  for (const sub of subscriptions) {
    const key = `${sub.chatId}:${sub.address.toLowerCase()}`;
    seen.set(key, sub);
  }
  await kv.put('subscriptions', JSON.stringify([...seen.values()]));
}

const LAST_ACTIVITY_TTL = 86400 * 90; // 90 天

/**
 * 读取所有地址的 lastActivity（合并存储）
 */
export async function getAllLastActivities(kv: KVNamespace): Promise<Record<string, number>> {
  const data = await kv.get('last_activities', { type: 'json' });
  return (data as Record<string, number>) || {};
}

/**
 * 保存 lastActivity 到合并 key
 * - 支持基于 validAddresses + TTL 清理孤儿数据
 */
export async function saveLastActivities(
  kv: KVNamespace,
  activities: Record<string, number>,
  validAddresses?: Set<string>
): Promise<void> {
  // 清理孤儿数据：不在订阅集合中且超过 TTL 的条目
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

export async function resolveAddressArg(
  arg: string | undefined,
  kv: KVNamespace,
  chatId: number
): Promise<ResolvedAddress> {
  const allSubscriptions = await getSubscriptions(kv);
  const userSubscriptions = allSubscriptions.filter((s) => s.chatId === chatId);

  if (!arg) {
    if (userSubscriptions.length === 1) {
      const sub = userSubscriptions[0];
      return {
        address: sub.address,
        displayName: sub.alias || shortenAddress(sub.address),
      };
    }
    return { address: null, displayName: null };
  }

  if (arg.toLowerCase().startsWith('0x')) {
    const addr = arg.toLowerCase();
    const sub = userSubscriptions.find((s) => s.address === addr);
    return {
      address: addr,
      displayName: sub?.alias || shortenAddress(arg),
    };
  }

  const sub = userSubscriptions.find(
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

export interface UserConfig {
  lang: Lang;
  threshold: number;
}

/**
 * 读取所有用户配置（合并存储）
 * 兼容旧格式：对于不在合并 key 中的用户，检查独立 key
 */
export async function getAllUserConfigs(
  kv: KVNamespace,
  chatIds?: number[]
): Promise<Record<string, UserConfig>> {
  // 1. 读取合并 key
  const data = await kv.get('user_configs', { type: 'json' });
  const result = (data as Record<string, UserConfig>) || {};

  // 2. 对于不在合并 key 中的用户，检查独立 key（兼容旧数据）
  if (chatIds) {
    for (const chatId of chatIds) {
      const key = String(chatId);
      if (result[key] === undefined) {
        const lang = await kv.get(`lang:${chatId}`);
        const threshold = await kv.get(`threshold:${chatId}`);
        if (lang || threshold) {
          result[key] = {
            lang: (lang as Lang) || 'en',
            threshold: threshold ? parseFloat(threshold) : DEFAULT_THRESHOLD,
          };
        }
      }
    }
  }

  return result;
}

/**
 * 保存单个用户配置到合并 key
 */
export async function saveUserConfig(
  kv: KVNamespace,
  chatId: number,
  config: Partial<UserConfig>
): Promise<void> {
  const data = await kv.get('user_configs', { type: 'json' });
  const allConfigs = (data as Record<string, UserConfig>) || {};
  const key = String(chatId);

  // 合并配置
  allConfigs[key] = {
    lang: config.lang ?? allConfigs[key]?.lang ?? 'en',
    threshold: config.threshold ?? allConfigs[key]?.threshold ?? DEFAULT_THRESHOLD,
  };

  await kv.put('user_configs', JSON.stringify(allConfigs));
}

/**
 * 保存所有用户配置到合并 key（用于 Cron 迁移）
 */
export async function saveAllUserConfigs(
  kv: KVNamespace,
  configs: Record<string, UserConfig>
): Promise<void> {
  await kv.put('user_configs', JSON.stringify(configs));
}

/**
 * 获取用户语言（从合并 key 或独立 key）
 */
export async function getLang(kv: KVNamespace, chatId: number): Promise<Lang> {
  // 优先从合并 key 读取
  const data = await kv.get('user_configs', { type: 'json' });
  const allConfigs = (data as Record<string, UserConfig>) || {};
  const config = allConfigs[String(chatId)];
  if (config?.lang) {
    return config.lang;
  }

  // 兼容旧格式
  const lang = await kv.get(`lang:${chatId}`);
  return (lang as Lang) || 'en';
}

/**
 * 设置用户语言
 */
export async function setLang(kv: KVNamespace, chatId: number, lang: Lang): Promise<void> {
  await saveUserConfig(kv, chatId, { lang });
}

/**
 * 获取用户阈值（从合并 key 或独立 key）
 */
export async function getThreshold(kv: KVNamespace, chatId: number): Promise<number> {
  // 优先从合并 key 读取
  const data = await kv.get('user_configs', { type: 'json' });
  const allConfigs = (data as Record<string, UserConfig>) || {};
  const config = allConfigs[String(chatId)];
  if (config?.threshold !== undefined) {
    return config.threshold;
  }

  // 兼容旧格式
  const value = await kv.get(`threshold:${chatId}`);
  return value ? parseFloat(value) : DEFAULT_THRESHOLD;
}

/**
 * 设置用户阈值
 */
export async function setThreshold(kv: KVNamespace, chatId: number, amount: number): Promise<void> {
  await saveUserConfig(kv, chatId, { threshold: amount });
}
