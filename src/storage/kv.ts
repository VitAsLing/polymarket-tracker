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
 * - 读取合并 key `last_activities`
 * - 对于不在合并 key 中的订阅地址，检查细粒度 key 并合并（支持命令侧写入）
 */
export async function getAllLastActivities(
  kv: KVNamespace,
  subscribedAddresses?: string[]
): Promise<Record<string, number>> {
  // 1. 读取合并 key
  const data = await kv.get('last_activities', { type: 'json' });
  const result = (data as Record<string, number>) || {};

  // 2. 对于不在合并 key 中的订阅地址，检查细粒度 key（支持命令侧新写入）
  if (subscribedAddresses) {
    for (const addr of subscribedAddresses) {
      if (result[addr] === undefined) {
        const value = await kv.get(`last_activity:${addr}`);
        if (value) {
          result[addr] = parseInt(value, 10);
        }
      }
    }
  }

  return result;
}

/**
 * Cron 专用：直接保存内存快照到合并 key
 * - 不再内部读取，直接写入传入的快照
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

/**
 * 命令侧专用：写细粒度 key（避免与 Cron 争用合并 key）
 * - 频率低，不影响配额
 * - 下次 Cron 会自动合并到 last_activities
 */
export async function setLastActivity(kv: KVNamespace, address: string, timestamp: number): Promise<void> {
  const key = `last_activity:${address.toLowerCase()}`;
  await kv.put(key, timestamp.toString(), { expirationTtl: LAST_ACTIVITY_TTL });
}

/**
 * 命令侧专用：删除细粒度 key
 */
export async function deleteLastActivity(kv: KVNamespace, address: string): Promise<void> {
  const key = `last_activity:${address.toLowerCase()}`;
  await kv.delete(key);
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

export async function getLang(kv: KVNamespace, chatId: number): Promise<Lang> {
  const lang = await kv.get(`lang:${chatId}`);
  return (lang as Lang) || 'en';
}

export async function setLang(kv: KVNamespace, chatId: number, lang: Lang): Promise<void> {
  await kv.put(`lang:${chatId}`, lang);
}

export async function getThreshold(kv: KVNamespace, chatId: number): Promise<number> {
  const value = await kv.get(`threshold:${chatId}`);
  return value ? parseFloat(value) : DEFAULT_THRESHOLD;
}

export async function setThreshold(kv: KVNamespace, chatId: number, amount: number): Promise<void> {
  await kv.put(`threshold:${chatId}`, amount.toString());
}
