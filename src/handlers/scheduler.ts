/**
 * Scheduled task handler
 */

import { shortenAddress } from '../utils/format.js';
import { getUserActivity } from '../api/polymarket.js';
import { sendTelegram } from '../api/telegram.js';
import { getSubscriptions, getAllLastActivities, saveLastActivities, getAllUserConfigs, saveAllUserConfigs, type UserConfig } from '../storage/kv.js';
import { formatActivityMessage } from '../messages/format.js';
import type { Env, Subscription, CheckResult, Lang } from '../types/index.js';

export async function checkSubscriptions(env: Env): Promise<CheckResult> {
  const kv = env.POLYMARKET_KV;
  const botToken = env.TG_BOT_TOKEN;
  const subscriptions = await getSubscriptions(kv);

  if (subscriptions.length === 0) {
    return { total: 0, processed: 0, notified: 0 };
  }

  // Group subscriptions by address (to avoid duplicate API calls)
  const addressMap = new Map<string, Subscription[]>();
  for (const sub of subscriptions) {
    const addr = sub.address.toLowerCase();
    if (!addressMap.has(addr)) {
      addressMap.set(addr, []);
    }
    addressMap.get(addr)!.push(sub);
  }

  // 当前有效的地址集合，用于清理孤儿数据
  const validAddresses = new Set(addressMap.keys());

  // 收集所有唯一的 chatId
  const allChatIds = [...new Set(subscriptions.map(s => s.chatId))];

  // 单次读取所有合并 key
  const allLastActivities = await getAllLastActivities(kv);
  const allUserConfigs = await getAllUserConfigs(kv, allChatIds);

  // 默认用户配置
  const defaultConfig: UserConfig = { lang: 'en', threshold: 10 };

  let totalProcessed = 0;
  let totalNotified = 0;

  // Process each unique address once
  for (const [address, subs] of addressMap) {
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
          continue;
        }
      }

      const activities = await getUserActivity(address, { start: apiStart });

      // Filter new activities (based on lastActivity for efficiency)
      const newActivities = activities.filter((a) => a.timestamp > lastActivity);
      if (newActivities.length === 0) continue;

      // Sort by time (oldest first)
      newActivities.sort((a, b) => a.timestamp - b.timestamp);

      // 预先计算每个订阅者的 displayName、语言设置和阈值（从内存读取）
      const shortAddr = shortenAddress(address);
      const subInfoMap = new Map<number, { displayName: string; lang: Lang; addedAtSec: number; threshold: number }>();
      for (const sub of subs) {
        if (!subInfoMap.has(sub.chatId)) {
          const userConfig = allUserConfigs[String(sub.chatId)] || defaultConfig;
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
        // Send to all users who subscribed to this address (deduplicated by chatId)
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
            const sent = await sendTelegram(botToken, chatId, message);
            if (sent) {
              totalNotified++;
            }
            // Avoid Telegram rate limit (with jitter)
            await new Promise((r) => setTimeout(r, 100 + Math.random() * 100));
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
  }

  // 单次写入：保存所有更新 + 清理孤儿数据（基于 validAddresses + TTL）
  await saveLastActivities(kv, allLastActivities, validAddresses);

  // 保存用户配置到合并 key（迁移旧数据）
  await saveAllUserConfigs(kv, allUserConfigs);

  return { total: subscriptions.length, addresses: addressMap.size, processed: totalProcessed, notified: totalNotified };
}
