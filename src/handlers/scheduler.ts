/**
 * Scheduled task handler
 */

import { shortenAddress } from '../utils/format.js';
import { getUserActivity } from '../api/polymarket.js';
import { sendTelegram } from '../api/telegram.js';
import { getSubscriptions, getLastActivity, setLastActivity, getLang } from '../storage/kv.js';
import { formatActivityMessage } from '../messages/format.js';
import type { Env, Subscription, CheckResult } from '../types/index.js';

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
      const activities = await getUserActivity(address, { limit: 20 });

      // Filter new activities
      const newActivities = activities.filter((a) => a.timestamp > lastActivity);
      if (newActivities.length === 0) continue;

      // Sort by time (oldest first)
      newActivities.sort((a, b) => a.timestamp - b.timestamp);

      let maxTimestamp = lastActivity;

      for (const activity of newActivities) {
        // Send to all users who subscribed to this address
        for (const sub of subs) {
          const displayName = sub.alias || shortenAddress(address);
          // Get user's language preference
          const lang = await getLang(kv, sub.chatId);
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
