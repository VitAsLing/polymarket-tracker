/**
 * Scheduled task handler
 */

import { shortenAddress } from '../utils/format.js';
import { getUserActivity } from '../api/polymarket.js';
import { sendTelegram } from '../api/telegram.js';
import {
  getAllUserSubscriptions,
  getAllLastActivities,
  saveLastActivities,
  getAllUserConfigs,
  type SubRecord,
  type UserConfig,
} from '../storage/kv.js';
import { formatActivityMessage } from '../messages/format.js';
import type { Env, CheckResult, Lang } from '../types/index.js';

// 并发限制（考虑 CF Worker 子请求限制）
const API_CONCURRENCY = 10;

// 带 chatId 的订阅信息（用于按地址分组后保留用户信息）
interface SubWithChat extends SubRecord {
  chatId: number;
}

// 简单的并发控制器
async function parallelLimit<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  concurrency: number
): Promise<void> {
  const executing = new Set<Promise<void>>();

  for (const item of items) {
    const p = fn(item).finally(() => {
      executing.delete(p);
    });
    executing.add(p);

    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
}

export async function checkSubscriptions(env: Env): Promise<CheckResult> {
  const kv = env.POLYMARKET_KV;
  const botToken = env.TG_BOT_TOKEN;

  // 读取所有用户订阅（Map<chatId, SubRecord[]>）
  const userSubsMap = await getAllUserSubscriptions(kv);

  if (userSubsMap.size === 0) {
    return { total: 0, processed: 0, notified: 0 };
  }

  // 统计总订阅数
  let totalSubs = 0;
  for (const subs of userSubsMap.values()) {
    totalSubs += subs.length;
  }

  // 按地址分组（用于避免重复 API 调用）
  const addressMap = new Map<string, SubWithChat[]>();
  for (const [chatId, subs] of userSubsMap) {
    for (const sub of subs) {
      const addr = sub.address.toLowerCase();
      if (!addressMap.has(addr)) {
        addressMap.set(addr, []);
      }
      addressMap.get(addr)!.push({ ...sub, chatId });
    }
  }

  // 当前有效的地址集合，用于清理孤儿数据
  const validAddresses = new Set(addressMap.keys());

  // 读取所有数据
  const allLastActivities = await getAllLastActivities(kv);
  const allUserConfigs = await getAllUserConfigs(kv);

  // 默认用户配置
  const defaultConfig: UserConfig = { lang: 'en', threshold: 10 };

  // 待发送的消息队列（带时间戳用于排序）
  interface PendingMessage {
    chatId: number;
    message: string;
    timestamp: number;  // 活动时间戳，用于按时间排序
  }
  const pendingMessages: PendingMessage[] = [];
  let totalProcessed = 0;

  // 定义处理单个地址的函数
  const processAddress = async (entry: [string, SubWithChat[]]): Promise<void> => {
    const [address, subs] = entry;
    try {
      const lastActivity = allLastActivities[address] || 0;

      // 计算 API 查询起点：使用 lastActivity，如果为 0 则用最早的订阅时间
      let apiStart = lastActivity;
      if (apiStart === 0) {
        const validAddedAts = subs.filter(s => s.addedAt).map(s => Math.floor(s.addedAt / 1000));
        if (validAddedAts.length > 0) {
          apiStart = Math.min(...validAddedAts);
        } else {
          // 老数据没有 addedAt，初始化 lastActivity 并跳过本次检查
          allLastActivities[address] = Math.floor(Date.now() / 1000);
          return;
        }
      }

      const activities = await getUserActivity(address, { start: apiStart });

      // Filter new activities (based on lastActivity for efficiency)
      const newActivities = activities.filter((a) => a.timestamp > lastActivity);
      if (newActivities.length === 0) return;

      // Sort by time (oldest first)
      newActivities.sort((a, b) => a.timestamp - b.timestamp);

      // 预先计算每个订阅者的 displayName、语言设置和阈值
      const shortAddr = shortenAddress(address);
      const subInfoMap = new Map<number, { displayName: string; lang: Lang; addedAtSec: number; threshold: number }>();
      for (const sub of subs) {
        if (!subInfoMap.has(sub.chatId)) {
          const userConfig = allUserConfigs.get(sub.chatId) || defaultConfig;
          subInfoMap.set(sub.chatId, {
            displayName: sub.alias || shortAddr,
            lang: userConfig.lang,
            addedAtSec: sub.addedAt ? Math.floor(sub.addedAt / 1000) : 0,
            threshold: userConfig.threshold,
          });
        }
      }

      let maxTimestamp = lastActivity;

      for (const activity of newActivities) {
        // Collect messages for all users who subscribed to this address
        for (const [chatId, subInfo] of subInfoMap) {
          // 只推送 BUY/SELL，跳过 REDEEM
          if (activity.type !== 'TRADE') {
            continue;
          }

          // 只推送订阅之后的活动（addedAt 是毫秒，timestamp 是秒）
          if (activity.timestamp <= subInfo.addedAtSec) {
            continue;
          }

          // 检查金额阈值，低于阈值则跳过推送
          if (subInfo.threshold > 0 && activity.usdcSize < subInfo.threshold) {
            continue;
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
      console.error(`Error checking ${address}:`, error);
    }
  };

  // 并行处理所有地址（限制并发数）
  const addressEntries = Array.from(addressMap.entries());
  await parallelLimit(addressEntries, processAddress, API_CONCURRENCY);

  // 按活动时间排序（旧→新），保证消息按时间顺序发送
  pendingMessages.sort((a, b) => a.timestamp - b.timestamp);

  // 串行发送所有消息（避免 Telegram 限流）
  let totalNotified = 0;
  for (const { chatId, message } of pendingMessages) {
    const sent = await sendTelegram(botToken, chatId, message);
    if (sent) {
      totalNotified++;
    }
    // Avoid Telegram rate limit (with jitter)
    await new Promise((r) => setTimeout(r, 100 + Math.random() * 100));
  }

  // 保存更新 + 清理孤儿数据
  await saveLastActivities(kv, allLastActivities, validAddresses);

  return { total: totalSubs, addresses: addressMap.size, processed: totalProcessed, notified: totalNotified };
}
