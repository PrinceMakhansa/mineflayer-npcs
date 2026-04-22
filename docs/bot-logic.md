# Bot Logic (Current)

This document describes the exact logic that remains in the bot after removing guard and PvP features. It is intentionally detailed and is based on the current code in this workspace.

---

## 1) Entry Point and Lifecycle

### 1.1 Startup
- The program starts in index.js and immediately calls createBot().
- dotenv is loaded at the top, so environment variables from a .env file are available before any other logic runs.
- config.json is loaded and used for all runtime settings.

### 1.2 Connection Setup
- A mineflayer bot is created with:
  - host: config.host
  - port: config.port (fallback 25565 if invalid)
  - username: config.botName
  - version: config.botVersion
  - auth: config.auth (defaults to "offline" if missing)
- The console logs the target host/port/name at connect time.

### 1.3 Reconnect Backoff
- A reconnect delay is tracked and doubles on each failure.
- Starts at 10 seconds and caps at 120 seconds.
- Any reconnect reason uses the current delay and then increases the delay for the next time.

### 1.4 Auth Commands (Optional)
- If MC_PASSWORD is set in the environment:
  - On chat messages containing "register using /register", it sends: /register <pw> <pw> after 1s.
  - On chat messages containing "login using /login", it sends: /login <pw> after 1s.
- These are only sent once per session (tracked by flags).

### 1.5 Spawn Behavior
- On first spawn only:
  - navigation.init(bot, config)
  - chat.init(bot, config)
  - If config.serverCommand is set, it is sent after 3s (e.g. "/server oneforall").
- On subsequent spawns (server transfer):
  - Logs the transfer and calls navigation.stopMoving().
- A Discord startup alert is sent every time the bot spawns.

### 1.6 Death and Respawn
- On death, logs and calls bot.respawn() after 3 seconds.
- On respawn, logs only.

### 1.8 Cleanup
- cleanup() clears all active timeouts and attempts bot.quit().
- cleanup() is called on kicked, error, or end events before scheduling reconnect.

---

## 2) NaN Position Repair (Server Transfer Safety)

A repair loop prevents broken positions after forced server transfers:
- On forcedMove:
  - If position is valid (not NaN), saves it as lastValidPos.
  - Logs the position and resets a log counter.
- On every physicsTick:
  - If position is valid, updates lastValidPos and returns.
  - If position is NaN and lastValidPos exists:
    - Restores the position to lastValidPos.
    - Zeroes velocity to prevent re-corruption.
    - Logs only the first three repairs to avoid spam.

---

## 3) Chat Command Handling (PM-based)

### 3.1 Where Commands Come From
- The bot listens to incoming chat messages and parses private message format:
  - Expected pattern: [Sender -> Target] message
- It only responds when Target is the bot’s username or the literal "me".

### 3.2 Whitelist Enforcement
- If config.whitelist has entries, the sender must match:
  - Exact match with sender name
  - Exact match with raw sender string
  - Or raw sender string includes any whitelisted name
- If not allowed, the command is ignored with no reply.

### 3.3 Command Parsing
- The message must start with "!".
- The command is the first word lowercased.
- Everything after the command is treated as args.

### 3.4 Commands That Exist
Only these commands are supported:

#### !follow <name>
- If <name> is missing, it defaults to the sender username.
- The bot replies: "Looking for <name>...".
- It tries to find the player entity:
  - Checks bot.players[name]?.entity first.
  - Falls back to scanning bot.entities for a player with a case-insensitive username match.
- It retries for up to 10 attempts, one every 500 ms.
- If found:
  - Replies "Following <name>."
  - Calls navigation.followPlayer(name).
- If not found after 10 attempts:
  - Replies "Can’t find <name>."

#### !stopfollow
- Immediately cancels movement:
  - navigation.stopMoving()
  - navigation.startIdleLook()
- Replies "Stopped." in a whisper.

### 3.5 Unknown Commands
- Any other command receives: "Unknown command: <command>."

---

## 4) Navigation Module

### 4.1 Initialization
- navigation.init(bot, config) loads the mineflayer-pathfinder plugin.
- Starts the idle look loop immediately.

### 4.2 followPlayer(name)
- Sets followTargetName from string or username.
- Cancels any pathfinder goal, clears controls, and stops idle look.
- Starts a 100 ms interval loop that:
  - Resolves the target entity on every tick.
  - If missing, logs every ~2s and clears controls.
  - Validates that both positions exist and are not NaN.
  - Computes distance in XZ only.
  - If within 2.5 blocks:
    - Stops movement
    - Looks at the target
  - Otherwise:
    - Looks at the target and walks forward
    - Enables sprinting when distance > 6
    - If in water, holds jump
    - If a 1-block obstacle is detected and space above is clear, jumps for 0.5s with cooldown

### 4.3 stopMoving()
- Cancels pathfinder goal and clears all control states.
- Clears isReturning and followTargetName.
- Stops the follow interval if running.

### 4.4 Idle Look
- startIdleLook() looks around every 4 seconds using random yaw/pitch.
- stopIdleLook() stops the idle look interval.

### 4.5 Follow Status Utility
- getFollowStatus() returns:
  - targetName
  - distance (if valid)
  - moving (current forward control state)
  - position (bot position)

---

## 5) Discord Alerts (Startup Only)

- The Discord module constructs a webhook POST request when sendAlert() is called.
- It is used only on spawn to send a startup message.
- If config.discordWebhook is missing or contains "YOUR_WEBHOOK", alerts are skipped.
-- The message contains a timestamp in Asia/Kolkata time zone.

---

## 6) Configuration Keys Used

The following config values are referenced by the current code:
- host
- port
- botName
- botVersion
- auth
 - serverCommand (optional)
 - whitelist (array)
 - discordWebhook

Note: detectionRadius, followDistance, mode, and alertCooldownSeconds remain in config.json but are not used by the current logic.
