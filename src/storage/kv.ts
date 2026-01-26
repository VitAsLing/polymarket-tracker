/**
 * KV Storage operations
 *
 * KV 结构：
 * - sub:{chatId} - 用户订阅列表
 * - config:{chatId} - 用户配置 (lang, threshold)
 */

import { shortenAddress } from '../utils/format.js';
import type { ResolvedAddress, Lang, Env } from '../types/index.js';

const DEFAULT_THRESHOLD = 10;

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

// ============ 用户配置相关 ============

export interface CategoryFilter {
  mode: 'include' | 'exclude';
  categories: string[];
}

export interface UserConfig {
  lang: Lang;
  threshold: number;
  filter?: CategoryFilter;
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
    filter: config.filter !== undefined ? config.filter : current.filter,
  };
  // 如果 filter 为 null，删除该字段
  if (updated.filter === null) {
    delete updated.filter;
  }
  await kv.put(`config:${chatId}`, JSON.stringify(updated));
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

/**
 * 获取用户过滤器
 */
export async function getFilter(kv: KVNamespace, chatId: number): Promise<CategoryFilter | undefined> {
  const config = await getUserConfig(kv, chatId);
  return config.filter;
}

/**
 * 设置用户过滤器
 */
export async function setFilter(kv: KVNamespace, chatId: number, filter: CategoryFilter | null): Promise<void> {
  await saveUserConfig(kv, chatId, { filter: filter as CategoryFilter | undefined });
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

// ============ Durable Object 通知 ============

type NotifyType = 'sub' | 'config';

/**
 * 通知 DO 更新缓存
 */
export async function notifyDO(env: Env, chatId: number, type: NotifyType): Promise<void> {
  try {
    const id = env.SCHEDULER_DO.idFromName('main');
    const stub = env.SCHEDULER_DO.get(id);
    await stub.fetch('http://do/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, type }),
    });
  } catch {
    // Ignore - DO will sync on next alarm
  }
}
