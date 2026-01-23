# Polymarket Smart Money Tracker

Track Polymarket users via Telegram Bot. Auto-push trading activities (BUY/SELL/REDEEM).

## Features

- Subscribe to any Polymarket address
- Real-time push notifications (BUY/SELL/REDEEM)
- Query positions, PnL, portfolio value, leaderboard
- Multi-user support (each user manages their own subscriptions)

## Bot Commands

| Command | Description |
|---------|-------------|
| `/subscribe <address> [alias]` | Subscribe to address |
| `/unsubscribe <address>` | Unsubscribe |
| `/list` | List your subscriptions |
| `/pos [address/alias]` | Current positions |
| `/pnl [address/alias]` | Realized PnL |
| `/value [address/alias]` | Portfolio value |
| `/rank [address/alias]` | Leaderboard ranking |

## Deployment

```bash
# 1. Install
bun install

# 2. Create KV (copy id to wrangler.toml)
bunx wrangler kv:namespace create "POLYMARKET_KV"

# 3. Set Bot Token
bunx wrangler secret put TG_BOT_TOKEN

# 4. Deploy
bunx wrangler deploy

# 5. Set Telegram Webhook (visit in browser)
# https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<worker>.workers.dev/webhook
```

## Development

```bash
bunx wrangler dev      # Local dev
bunx wrangler deploy   # Deploy
bunx wrangler tail     # View logs
```

## License

[AGPL-3.0](LICENSE)
