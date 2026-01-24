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

export async function getLastActivity(kv: KVNamespace, address: string): Promise<number> {
  const key = `last_activity:${address.toLowerCase()}`;
  const value = await kv.get(key);
  return value ? parseInt(value, 10) : 0;
}

export async function setLastActivity(kv: KVNamespace, address: string, timestamp: number): Promise<void> {
  const key = `last_activity:${address.toLowerCase()}`;
  await kv.put(key, timestamp.toString(), { expirationTtl: 86400 * 90 });  // 90 天 TTL
}

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
