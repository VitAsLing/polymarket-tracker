/**
 * Durable Object for scheduling activity checks
 *
 * Uses alarm-based scheduling (every 10 seconds) instead of Cron.
 * Maintains in-memory cache of subscriptions and configs.
 */

import { DurableObject } from 'cloudflare:workers';
import { shortenAddress } from '../utils/format.js';
import { getUserActivity } from '../api/polymarket.js';
import { sendTelegram } from '../api/telegram.js';
import { formatActivityMessage } from '../messages/format.js';
import type { Env, CheckResult, Lang } from '../types/index.js';
import type { SubRecord, UserConfig, CategoryFilter } from '../storage/kv.js';

const DEFAULT_CHECK_INTERVAL_MS = 10_000; // 10 seconds
const API_CONCURRENCY = 10;

// Cache structure
interface Cache {
  userSubscriptions: Map<number, SubRecord[]>;
  userConfigs: Map<number, UserConfig>;
  initialized: boolean;
}

// Extended subscription with chatId for grouping
interface SubWithChat extends SubRecord {
  chatId: number;
}

// Pending message for sorted delivery
interface PendingMessage {
  chatId: number;
  message: string;
  timestamp: number;
}

// Notify request types
type NotifyType = 'sub' | 'config';

interface NotifyRequest {
  chatId: number;
  type: NotifyType;
}

export class SchedulerDO extends DurableObject<Env> {
  private cache: Cache = {
    userSubscriptions: new Map(),
    userConfigs: new Map(),
    initialized: false,
  };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  private get checkIntervalMs(): number {
    return parseInt(this.env.CHECK_INTERVAL_MS || '', 10) || DEFAULT_CHECK_INTERVAL_MS;
  }

  async alarm(): Promise<void> {
    const startTime = Date.now();
    const intervalMs = this.checkIntervalMs;

    try {
      // Initialize cache on first run
      if (!this.cache.initialized) {
        await this.initializeFromKV();
      }

      // Run the check
      await this.checkSubscriptions();

      // Schedule next alarm
      const elapsed = Date.now() - startTime;
      const nextDelay = Math.max(intervalMs - elapsed, 1000);
      await this.ctx.storage.setAlarm(Date.now() + nextDelay);
    } catch (error) {
      console.error('[SchedulerDO] Alarm error:', error);
      // Still schedule next alarm on error
      await this.ctx.storage.setAlarm(Date.now() + intervalMs);
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // POST /notify - Update cache for a user
    if (path === '/notify' && request.method === 'POST') {
      try {
        const body = await request.json() as NotifyRequest;
        await this.refreshUserCache(body.chatId, body.type);
        return Response.json({ success: true });
      } catch (error) {
        console.error('[SchedulerDO] Notify error:', error);
        return Response.json({ success: false, error: String(error) }, { status: 500 });
      }
    }

    // GET /ensure - Start alarm if not running (auto-start)
    if (path === '/ensure') {
      const currentAlarm = await this.ctx.storage.getAlarm();
      if (!currentAlarm) {
        if (!this.cache.initialized) {
          await this.initializeFromKV();
        }
        await this.ctx.storage.setAlarm(Date.now() + 1000);
      }
      return Response.json({ success: true });
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  /**
   * Paginated KV list (KV returns max 1000 keys per call)
   */
  private async listAllKeys(kv: KVNamespace, prefix: string): Promise<KVNamespaceListKey<unknown>[]> {
    const keys: KVNamespaceListKey<unknown>[] = [];
    let cursor: string | undefined;

    do {
      const result = await kv.list({ prefix, cursor });
      keys.push(...result.keys);
      cursor = result.list_complete ? undefined : result.cursor;
    } while (cursor);

    return keys;
  }

  /**
   * Initialize cache from KV on first run
   */
  private async initializeFromKV(): Promise<void> {
    const kv = this.env.POLYMARKET_KV;

    // Load all subscriptions (with pagination)
    const subKeys = await this.listAllKeys(kv, 'sub:');
    for (const key of subKeys) {
      const chatId = parseInt(key.name.replace('sub:', ''), 10);
      const subs = await kv.get(key.name, { type: 'json' }) as SubRecord[];
      if (subs && subs.length > 0) {
        this.cache.userSubscriptions.set(chatId, subs);
      }
    }

    // Load all configs (with pagination)
    const configKeys = await this.listAllKeys(kv, 'config:');
    for (const key of configKeys) {
      const chatId = parseInt(key.name.replace('config:', ''), 10);
      const config = await kv.get(key.name, { type: 'json' }) as UserConfig;
      if (config) {
        this.cache.userConfigs.set(chatId, config);
      }
    }

    // Migrate lastActivities from KV to DO storage if not exists
    const existingLastActivities = await this.ctx.storage.get<Record<string, number>>('lastActivities');
    if (!existingLastActivities) {
      const kvLastActivities = await kv.get('last_activities', { type: 'json' }) as Record<string, number>;
      if (kvLastActivities) {
        await this.ctx.storage.put('lastActivities', kvLastActivities);
      }
    }

    this.cache.initialized = true;
  }

  /**
   * Refresh cache for a specific user
   */
  private async refreshUserCache(chatId: number, type: NotifyType): Promise<void> {
    const kv = this.env.POLYMARKET_KV;

    if (type === 'sub') {
      const subs = await kv.get(`sub:${chatId}`, { type: 'json' }) as SubRecord[];
      if (subs && subs.length > 0) {
        this.cache.userSubscriptions.set(chatId, subs);
      } else {
        this.cache.userSubscriptions.delete(chatId);
      }
    } else if (type === 'config') {
      const config = await kv.get(`config:${chatId}`, { type: 'json' }) as UserConfig;
      if (config) {
        this.cache.userConfigs.set(chatId, config);
      } else {
        this.cache.userConfigs.delete(chatId);
      }
    }
  }

  /**
   * Check subscriptions and send notifications
   */
  private async checkSubscriptions(): Promise<CheckResult> {
    const checkStartTime = Date.now();
    const botToken = this.env.TG_BOT_TOKEN;

    if (this.cache.userSubscriptions.size === 0) {
      return { total: 0, processed: 0, notified: 0 };
    }

    // Count total subscriptions
    let totalSubs = 0;
    for (const subs of this.cache.userSubscriptions.values()) {
      totalSubs += subs.length;
    }

    // Group by address
    const addressMap = new Map<string, SubWithChat[]>();
    for (const [chatId, subs] of this.cache.userSubscriptions) {
      for (const sub of subs) {
        const addr = sub.address.toLowerCase();
        if (!addressMap.has(addr)) {
          addressMap.set(addr, []);
        }
        addressMap.get(addr)!.push({ ...sub, chatId });
      }
    }

    const validAddresses = new Set(addressMap.keys());

    // Load lastActivities from DO storage
    const storageReadStart = Date.now();
    const allLastActivities = await this.ctx.storage.get<Record<string, number>>('lastActivities') || {};
    const storageReadTime = Date.now() - storageReadStart;

    // Default config
    const defaultConfig: UserConfig = { lang: 'en', threshold: 10 };

    // Pending messages
    const pendingMessages: PendingMessage[] = [];
    let totalProcessed = 0;

    // Process address function
    const processAddress = async (entry: [string, SubWithChat[]]): Promise<void> => {
      const [address, subs] = entry;
      try {
        const lastActivity = allLastActivities[address] || 0;

        // Calculate API start time
        let apiStart = lastActivity;
        if (apiStart === 0) {
          const validAddedAts = subs.filter(s => s.addedAt).map(s => Math.floor(s.addedAt / 1000));
          if (validAddedAts.length > 0) {
            apiStart = Math.min(...validAddedAts);
          } else {
            allLastActivities[address] = Math.floor(Date.now() / 1000);
            return;
          }
        }

        const activities = await getUserActivity(address, { start: apiStart });
        const newActivities = activities.filter((a) => a.timestamp > lastActivity);
        if (newActivities.length === 0) return;

        newActivities.sort((a, b) => a.timestamp - b.timestamp);

        const shortAddr = shortenAddress(address);
        const subInfoMap = new Map<number, { displayName: string; lang: Lang; addedAtSec: number; threshold: number; filter?: CategoryFilter }>();
        for (const sub of subs) {
          if (!subInfoMap.has(sub.chatId)) {
            const userConfig = this.cache.userConfigs.get(sub.chatId) || defaultConfig;
            subInfoMap.set(sub.chatId, {
              displayName: sub.alias || shortAddr,
              lang: userConfig.lang,
              addedAtSec: sub.addedAt ? Math.floor(sub.addedAt / 1000) : 0,
              threshold: userConfig.threshold,
              filter: userConfig.filter,
            });
          }
        }

        let maxTimestamp = lastActivity;

        for (const activity of newActivities) {
          for (const [chatId, subInfo] of subInfoMap) {
            if (activity.type !== 'TRADE') continue;
            if (activity.timestamp <= subInfo.addedAtSec) continue;
            if (subInfo.threshold > 0 && activity.usdcSize < subInfo.threshold) continue;

            // Filter by category (slug prefix)
            if (subInfo.filter && subInfo.filter.categories.length > 0) {
              const slugPrefix = activity.slug?.split('-')[0]?.toLowerCase() || '';
              const matched = subInfo.filter.categories.includes(slugPrefix);
              if (subInfo.filter.mode === 'include' && !matched) continue;
              if (subInfo.filter.mode === 'exclude' && matched) continue;
            }

            const { displayName, lang } = subInfo;
            const message = formatActivityMessage(activity, displayName, address, lang);
            if (message) {
              pendingMessages.push({ chatId, message, timestamp: activity.timestamp });
            }
          }
          maxTimestamp = Math.max(maxTimestamp, activity.timestamp);
          totalProcessed++;
        }

        if (maxTimestamp > lastActivity) {
          allLastActivities[address] = maxTimestamp;
        }
      } catch (error) {
        console.error(`[SchedulerDO] Error checking ${address}:`, error);
      }
    };

    // Parallel limit helper
    const parallelLimit = async <T>(
      items: T[],
      fn: (item: T) => Promise<void>,
      concurrency: number
    ): Promise<void> => {
      const executing = new Set<Promise<void>>();
      for (const item of items) {
        const p = fn(item).finally(() => executing.delete(p));
        executing.add(p);
        if (executing.size >= concurrency) {
          await Promise.race(executing);
        }
      }
      await Promise.all(executing);
    };

    // Process all addresses
    const apiStartTime = Date.now();
    const addressEntries = Array.from(addressMap.entries());
    await parallelLimit(addressEntries, processAddress, API_CONCURRENCY);
    const apiTime = Date.now() - apiStartTime;

    // Sort messages by timestamp
    pendingMessages.sort((a, b) => a.timestamp - b.timestamp);

    // Send messages
    const telegramStartTime = Date.now();
    let totalNotified = 0;
    for (const { chatId, message } of pendingMessages) {
      const sent = await sendTelegram(botToken, chatId, message);
      if (sent) totalNotified++;
      await new Promise((r) => setTimeout(r, 100 + Math.random() * 100));
    }
    const telegramTime = Date.now() - telegramStartTime;

    // Save lastActivities and clean orphans
    const storageWriteStart = Date.now();
    const now = Math.floor(Date.now() / 1000);
    const TTL = 86400 * 90; // 90 days
    for (const addr of Object.keys(allLastActivities)) {
      if (!validAddresses.has(addr) && now - allLastActivities[addr] > TTL) {
        delete allLastActivities[addr];
      }
    }
    await this.ctx.storage.put('lastActivities', allLastActivities);
    const storageWriteTime = Date.now() - storageWriteStart;

    const totalTime = Date.now() - checkStartTime;
    // eslint-disable-next-line no-console
    console.log(`[SchedulerDO] Poll completed: ${totalTime}ms total | storage_read: ${storageReadTime}ms | api(${addressMap.size} addrs): ${apiTime}ms | telegram(${totalNotified} msgs): ${telegramTime}ms | storage_write: ${storageWriteTime}ms`);

    return { total: totalSubs, addresses: addressMap.size, processed: totalProcessed, notified: totalNotified };
  }
}
