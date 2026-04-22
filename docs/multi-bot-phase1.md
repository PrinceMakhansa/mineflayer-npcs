# Multi-Bot Phase 1

Phase 1 introduces instance-based runtime management.

## What is now possible

- Run multiple Mineflayer bot instances in one Node process.
- Keep per-bot runtime state isolated.
- Start all configured bots from `config.json`.
- Start only selected bot IDs from CLI.

## Config format for multiple bots

Use a top-level `bots` array. Root-level fields are treated as defaults and merged into each bot item.

```json
{
  "host": "bots.oneforall.social",
  "port": 25565,
  "botVersion": "1.21",
  "auth": "offline",
  "whitelist": ["Pr1nce28"],
  "guardRadius": 16,
  "discordWebhook": "https://discord.com/api/webhooks/...",
  "bots": [
    {
      "id": "megumi-1",
      "botName": "megumi"
    },
    {
      "id": "megumi-2",
      "botName": "megumi2"
    }
  ]
}
```

## Notes

- `botName` must be unique per server session.
- In multi-bot mode, friend/unfriend persistence to `config.json` is disabled to avoid file write collisions.
- In single-bot legacy mode (no `bots` array), persistence remains enabled.

## CLI usage

- Start all configured bots:
  - `npm run start:all`
- List configured bot IDs:
  - `npm run bots:list`
- Start a single bot by ID:
  - `npm run start:bot -- megumi-1`
- Start multiple selected bots:
  - `npm run start:bot -- megumi-1,megumi-2`

If `--bot` IDs do not match config, process exits with an error.

## Phase 2 API (bot control endpoints)

Start API mode:

- `npm run start:api`
- `npm run start:portal` (same as `start:api`)

Start API mode and auto-start all registered bots:

- `npm run start:api:auto`

Optional custom port:

- `node index.js --api --api-port 4000`

Notes:

- In `--api` mode, bots are registered but not started until API calls are used.
- `--api --api-autostart` keeps API on and starts bots immediately.
- `config.json` can include `apiPort` (default: `3000`) to change API port.
- Web portal is available at `http://localhost:<apiPort>/`.
- Prismarine live viewer can be enabled with `viewerEnabled` and `viewerBasePort`.

Endpoints:

- `GET /api/health`
- `GET /api/bots`
- `GET /api/bots/:id`
- `POST /api/bots/:id/start`
- `POST /api/bots/:id/stop`
- `POST /api/bots/:id/restart`
- `POST /api/bots/start-all`
- `POST /api/bots/stop-all`
- `GET /api/bots/:id/logs?limit=30`

## Phase 3 Portal improvements

- Per-bot recent logs panel in the dashboard.
- Runtime logs also written to `logs/<botId>.log`.
- Skin-rendered Minecraft 3D bot models on each bot card (username-based).
- Live world viewer links per bot via Prismarine Viewer (`Open View` button).
