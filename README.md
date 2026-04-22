# 🏰 BaseGuard Bot

A Mineflayer bot for your Minecraft Java SMP (1.21.x).  
Guard and PvP features are disabled for now; only follow/stop commands are enabled.

---

## 🚀 Quick Setup

### 1. Install Node.js
Download from https://nodejs.org (v18 or higher)

### 2. Install dependencies
```bash
npm install
```

### 3. Configure the bot
Edit `config.json`:

```json
{
  "host": "your.server.ip",       ← your server IP or localhost
  "port": 25565,                   ← your server port
  "botName": "BaseGuard",          ← bot's username (any name in offline mode)
  "botVersion": "1.21",
  "auth": "offline",               ← use "microsoft" for online-mode servers

  "followDistance": 80,            ← max blocks to chase before returning
  "whitelist": ["YourUsername"],   ← players the bot ignores

  "discordWebhook": "https://discord.com/api/webhooks/..."  ← your webhook URL
}
```

### 4. Get your Discord Webhook URL
1. Open Discord → go to your server
2. Right-click a channel → Edit Channel → Integrations → Webhooks
3. Create New Webhook → Copy Webhook URL
4. Paste it into `config.json`

### 5. Run the bot
```bash
node index.js
```

### API Auth (required for portal/API mode)
Set `ADMIN_USERS` in `.env` before using `--api`:

```env
ADMIN_USERS=owner:strongpass1,mod2:strongpass2,mod3:strongpass3,mod4:strongpass4
```

Then open the portal and sign in with one of those username/password pairs.

---

## 🎮 In-Game Commands
Type these in Minecraft chat (only whitelisted players can use them):

| Command | Description |
|---|---|
| `!follow <name>` | Follow a player (defaults to sender if name omitted) |
| `!stopfollow` | Stop moving and cancel follow |

---

## 🌐 Online Mode Servers
If your server has `online-mode=true` in `server.properties`:
1. Change `"auth": "offline"` → `"auth": "microsoft"` in config.json
2. On first run, the bot will print a Microsoft login URL in the terminal
3. Open it in a browser and log in with your alt account

---

## 24/7 Hosting with PM2
```bash
# Install PM2
npm install -g pm2

# Start bot with PM2
pm2 start index.js --name baseguard

# Save so it restarts after reboot
pm2 save
pm2 startup

# Useful commands
pm2 logs baseguard     # view live logs
pm2 restart baseguard  # restart bot
pm2 stop baseguard     # stop bot
```

---

## ⚠️ Notes
- Bot needs a **player slot** on the server — make sure your server isn't full
- In **offline mode**, any username works — no account needed
- In **online mode**, you need a real Microsoft/Mojang alt account
- Keep `config.json` private — don't share it publicly
