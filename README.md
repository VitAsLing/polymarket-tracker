# Polymarket Smart Money Tracker v2.1

Track Polymarket users via Telegram Bot. Auto-push trading activities (BUY/SELL/REDEEM).

**Features:**
- Multi-user support (each user manages their own subscriptions)
- Real-time notifications (BUY/SELL/REDEEM)
- Query positions, PnL, portfolio value, leaderboard ranking
- Optimized API calls (same address only fetched once)

## Architecture

```
┌─────────────────┐      ┌────────────────────┐      ┌─────────────────┐
│  Polymarket     │      │  Cloudflare        │      │  Telegram       │
│  Data API       │─────▶│  Workers           │─────▶│  Bot API        │
│                 │      │  (Poll every min)  │      │  (Webhook)      │
└─────────────────┘      └────────────────────┘      └─────────────────┘
                                  │
                                  ▼
                         ┌────────────────────┐
                         │  Cloudflare KV     │
                         │  (Subscriptions)   │
                         └────────────────────┘
```

## Bot Commands

### Subscription

| Command | Description |
|---------|-------------|
| `/subscribe <address> [alias]` | Subscribe to address (alias defaults to Polymarket username) |
| `/unsubscribe <address>` | Unsubscribe |
| `/list` | List subscriptions |
| `/alias <address> <new_alias>` | Update alias |

### Query

| Command | Description |
|---------|-------------|
| `/pos [address/alias]` | Current positions |
| `/pnl [address/alias]` | Realized PnL |
| `/value [address/alias]` | Portfolio value |
| `/rank [address/alias]` | Leaderboard ranking |

> If you have only one subscription, address/alias can be omitted
> Each user can only see and manage their own subscriptions

## Message Examples

### BUY
```
🟢 BUY | SmartMoney

🏷️ Will Trump win 2024 election?
📌 Yes @ 52.3%

💰 Cost: $1,000.00
📈 Shares: 1,912.05
💵 If Win: $912.05 (+91.2%)

⏰ 2026-01-22 15:30:00 UTC
🔗 Market | Tx
```

### SELL
```
🔴 SELL | SmartMoney

🏷️ Will Trump win 2024 election?
📌 Yes @ 65.0%

💵 Received: $1,243.00
📈 Shares: 1,912.05

⏰ 2026-01-22 16:00:00 UTC
🔗 Market | Tx
```

### REDEEM
```
✅ REDEEM | SmartMoney

🏷️ Will Trump win 2024 election?
💵 Redeemed: $1,912.05

⏰ 2026-01-22 17:00:00 UTC
🔗 Market | Tx
```

## Deployment

### 1. Create Telegram Bot

1. Open Telegram, search `@BotFather`
2. Send `/newbot`
3. Follow prompts to set bot name and username
4. Get Bot Token: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`

### 2. Install Dependencies

```bash
bun install
```

### 3. Create KV Storage

```bash
bunx wrangler kv:namespace create "POLYMARKET_KV"
```

Copy the output `id` to `wrangler.toml`.

### 4. Set Secret

```bash
bunx wrangler secret put TG_BOT_TOKEN
# Enter your Bot Token
```

### 5. Deploy

```bash
bunx wrangler deploy
```

### 6. Set Webhook

After deployment, visit:
```
https://polymarket-tracker.<your-account>.workers.dev/setWebhook?url=https://polymarket-tracker.<your-account>.workers.dev/webhook
```

## HTTP Endpoints

| Path | Description |
|------|-------------|
| `POST /webhook` | Telegram Bot Webhook |
| `GET /check` | Manually trigger check |
| `GET /health` | Health check |
| `GET /setWebhook?url=` | Set Telegram Webhook |
| `GET /subscriptions` | View subscriptions (JSON) |

## Development

```bash
# Local dev
bunx wrangler dev

# Deploy
bunx wrangler deploy

# View logs
bunx wrangler tail
```

## Polling Frequency

Edit `wrangler.toml` crons:
- `* * * * *` - Every minute
- `*/5 * * * *` - Every 5 minutes

## Cost

Free (within Cloudflare Workers free tier).

## FAQ

**Q: Not receiving notifications after subscribing?**
1. Confirm Webhook is set
2. Check if Bot Token is correct
3. Check if the subscribed address has new trades
4. Run `bunx wrangler tail` to view logs

**Q: How to add a new address?**
Send `/subscribe 0xAddress alias` in Telegram

**Q: Query command shows "Please provide address"?**
If you have multiple subscriptions, specify address or alias, e.g., `/pos SmartMoney`

## License

This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).

See the [LICENSE](LICENSE) file for details.
