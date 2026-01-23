# Polymarket Smart Money Tracker

Track Polymarket users via Telegram Bot. Auto-push trading activities (BUY/SELL/REDEEM).

## Tech Stack

- **Runtime**: Cloudflare Workers (serverless, free tier)
- **Language**: TypeScript
- **Storage**: Cloudflare KV
- **Bot**: Telegram Bot API (Webhook)
- **Data**: Polymarket Data API

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
| `/alias <address> <new_alias>` | Update alias |
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
bun run typecheck      # TypeScript check
bun run lint           # ESLint check
```

## Disclaimer

This project is for informational purposes only. It is not financial advice. Use at your own risk. The authors are not responsible for any losses or damages.

## License

This project is licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0.html).

See the [LICENSE](LICENSE) file for details.
