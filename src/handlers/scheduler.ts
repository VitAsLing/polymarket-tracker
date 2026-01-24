/**
 * Scheduled task handler
 */

import { shortenAddress } from '../utils/format.js';
import { getUserActivity } from '../api/polymarket.js';
import { sendTelegram } from '../api/telegram.js';
import { getSubscriptions, getLastActivity, setLastActivity, getLang } from '../storage/kv.js';
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

  let totalProcessed = 0;
  let totalNotified = 0;

  // Process each unique address once
  for (const [address, subs] of addressMap) {
    try {
      const lastActivity = await getLastActivity(kv, address);

      // 计算 API 查询起点：使用 lastActivity，如果为 0 则用最早的订阅时间
      let apiStart = lastActivity;
      if (apiStart === 0) {
        const validAddedAts = subs.filter(s => s.addedAt).map(s => Math.floor(s.addedAt / 1000));
        if (validAddedAts.length > 0) {
          apiStart = Math.min(...validAddedAts);
        } else {
          // 老数据没有 addedAt，初始化 lastActivity 并跳过本次检查
          await setLastActivity(kv, address, Math.floor(Date.now() / 1000));
          continue;
        }
      }

      const activities = await getUserActivity(address, { start: apiStart });

      // Filter new activities (based on lastActivity for efficiency)
      const newActivities = activities.filter((a) => a.timestamp > lastActivity);
      if (newActivities.length === 0) continue;

      // Sort by time (oldest first)
      newActivities.sort((a, b) => a.timestamp - b.timestamp);

      // 预先计算每个订阅者的 displayName 和语言设置，避免重复计算
      const shortAddr = shortenAddress(address);
      const subInfoMap = new Map<number, { displayName: string; lang: Lang; addedAtSec: number }>();
      for (const sub of subs) {
        if (!subInfoMap.has(sub.chatId)) {
          subInfoMap.set(sub.chatId, {
            displayName: sub.alias || shortAddr,
            lang: await getLang(kv, sub.chatId),
            addedAtSec: sub.addedAt ? Math.floor(sub.addedAt / 1000) : 0,
          });
        }
      }

      let maxTimestamp = lastActivity;

      for (const activity of newActivities) {
        // Send to all users who subscribed to this address
        for (const sub of subs) {
          const subInfo = subInfoMap.get(sub.chatId)!;
          // 只推送订阅之后的活动（addedAt 是毫秒，timestamp 是秒）
          if (activity.timestamp <= subInfo.addedAtSec) {
            continue;
          }

          const { displayName, lang } = subInfo;
          const message = formatActivityMessage(activity, displayName, address, lang);
          if (message && sub.chatId) {
            const sent = await sendTelegram(botToken, sub.chatId, message);
            if (sent) {
              totalNotified++;
            }
            // Avoid Telegram rate limit
            await new Promise((r) => setTimeout(r, 100));
          }
        }
        maxTimestamp = Math.max(maxTimestamp, activity.timestamp);
        totalProcessed++;
      }

      if (maxTimestamp > lastActivity) {
        await setLastActivity(kv, address, maxTimestamp);
      }
    } catch (error) {
      console.error(`Error checking ${address}:`, error);
    }
  }

  return { total: subscriptions.length, addresses: addressMap.size, processed: totalProcessed, notified: totalNotified };
}
