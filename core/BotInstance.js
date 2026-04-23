require("dotenv").config();

const fs = require("fs");
const path = require("path");
const mineflayer = require("mineflayer");
const { createNavigation } = require("../modules/navigation");
const { createChat } = require("../modules/chat");
const { createGuard } = require("../modules/guard");
const { sendAlert } = require("../modules/discord");

class BotInstance {
  constructor({
    id,
    config,
    persistConfigPath = null,
    persistFriendlyPlayers = false,
    logsDir = null,
    onLog = null,
  }) {
    this.id = id;
    this.config = config;
    this.persistConfigPath = persistConfigPath;
    this.persistFriendlyPlayers = persistFriendlyPlayers;
    this.logsDir = logsDir;
    this.onLog = onLog;

    this.bot = null;
    this.respawnTimeout = null;
    this.reconnectTimeout = null;
    this.reconnectScheduled = false;
    this.reconnectDelayMs = 10000;
    this.spawnTimeout = null;
    this.hasSentRegister = false;
    this.hasSentLogin = false;
    this.modulesInitialized = false;
    this.modulesEnabled = false;
    this.hasSpawned = false;

    this.minReconnectDelayMs = 10000;
    this.maxReconnectDelayMs = 120000;
    this.rateLimitDelayMs = 30000;
    this.internalErrorDelayMs = 20000;

    this.status = "stopped";
    this.startedAt = null;
    this.shouldReconnect = true;
    this.lastDisconnectReason = null;
    this.recentLogs = [];
    this.maxRecentLogs = 120;
    this.lastEventAt = null;

    this.navigation = createNavigation();
    this.guard = createGuard({
      persistConfigPath: this.persistConfigPath,
      persistFriendlyPlayers: this.persistFriendlyPlayers,
    });
    this.chat = createChat({ navigation: this.navigation, guard: this.guard });
  }

  log(message) {
    const name = this.config.botName || this.id;
    const timestamp = new Date().toISOString();
    const line = `[${name}] ${message}`;
    console.log(line);

    const entry = { ts: timestamp, message };
    this.recentLogs.push(entry);
    if (this.recentLogs.length > this.maxRecentLogs) {
      this.recentLogs.splice(0, this.recentLogs.length - this.maxRecentLogs);
    }
    this.lastEventAt = timestamp;

    if (this.logsDir) {
      try {
        fs.mkdirSync(this.logsDir, { recursive: true });
        const filePath = path.join(this.logsDir, `${this.id}.log`);
        fs.appendFileSync(filePath, `${timestamp} ${line}\n`, "utf8");
      } catch (_) {
        // no-op
      }
    }

    if (typeof this.onLog === "function") {
      try {
        this.onLog(this.id, entry);
      } catch (_) {
        // no-op
      }
    }
  }

  getAuthPassword() {
    return process.env.MC_PASSWORD || "";
  }

  getAuthCommandDelayMs() {
    const seconds = Number(this.config.authCommandDelaySeconds);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.floor(seconds * 1000);
    }
    return 10000;
  }

  nextReconnectDelayMs() {
    const delay = Math.max(this.reconnectDelayMs, this.minReconnectDelayMs);
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, this.maxReconnectDelayMs);
    return delay;
  }

  computeReconnectDelay(reasonText) {
    const base = this.nextReconnectDelayMs();
    const lower = String(reasonText || "").toLowerCase();
    let delay = base;

    if (lower.includes("logging in too fast")) {
      delay = Math.max(delay, this.rateLimitDelayMs);
    }
    if (lower.includes("internal error occurred")) {
      delay = Math.max(delay, this.internalErrorDelayMs);
    }

    const jitter = Math.floor(Math.random() * 3000);
    return Math.min(delay + jitter, this.maxReconnectDelayMs);
  }

  start() {
    if (this.status !== "stopped") return;
    this.shouldReconnect = true;
    this.createBot();
  }

  stop(reason = "manual stop") {
    this.shouldReconnect = false;
    this.lastDisconnectReason = reason;
    this.status = "stopped";
    this.cleanup();
  }

  createBot() {
    this.reconnectScheduled = false;
    this.hasSentRegister = false;
    this.hasSentLogin = false;
    this.hasSpawned = false;
    this.modulesInitialized = false;
    this.modulesEnabled = false;
    this.status = "connecting";

    const port = Number(this.config.port) || 25565;
    this.log(`Connecting to ${this.config.host}:${port} as ${this.config.botName}...`);

    this.bot = mineflayer.createBot({
      host: this.config.host,
      port,
      username: this.config.botName,
      version: this.config.botVersion,
      auth: this.config.auth || "offline",
    });

    let lastValidPos = null;
    let nanFixLogCount = 0;

    this.bot.on("forcedMove", () => {
      const pos = this.bot.entity?.position;
      if (pos && !isNaN(pos.x)) {
        lastValidPos = { x: pos.x, y: pos.y, z: pos.z };
        nanFixLogCount = 0;
      }
    });

    this.bot.on("physicsTick", () => {
      if (!this.bot?.entity?.position) return;
      const pos = this.bot.entity.position;
      if (!isNaN(pos.x)) {
        lastValidPos = { x: pos.x, y: pos.y, z: pos.z };
        return;
      }
      if (lastValidPos) {
        pos.set(lastValidPos.x, lastValidPos.y, lastValidPos.z);
        if (this.bot.entity.velocity) this.bot.entity.velocity.set(0, 0, 0);
        nanFixLogCount++;
        if (nanFixLogCount <= 3) {
          this.log(
            `Fixed NaN position to ${lastValidPos.x.toFixed(1)}, ${lastValidPos.y.toFixed(1)}, ${lastValidPos.z.toFixed(1)}`
          );
        }
      }
    });

    this.bot.once("login", () => {
      this.log("Logged in to server.");
      if (this.spawnTimeout) clearTimeout(this.spawnTimeout);
      this.spawnTimeout = setTimeout(() => {
        this.log("Login succeeded, but spawn did not occur within 15s.");
      }, 15000);
    });

    this.bot.on("message", (jsonMsg) => {
      let text = "";
      try {
        text = jsonMsg?.toString?.() || JSON.stringify(jsonMsg);
      } catch (_) {
        text = "<unreadable message>";
      }
      if (!text) return;

      const authPassword = this.getAuthPassword();
      if (!authPassword) return;

      if (!this.hasSentRegister && /register\s+using\s+\/register/i.test(text)) {
        this.hasSentRegister = true;
        const delayMs = this.getAuthCommandDelayMs();
        setTimeout(() => {
          if (!this.bot) return;
          this.bot.chat(`/register ${authPassword} ${authPassword}`);
          this.log(`Sent /register command after ${Math.round(delayMs / 1000)}s delay.`);
        }, delayMs);
      }
      if (!this.hasSentLogin && /login\s+using\s+\/login/i.test(text)) {
        this.hasSentLogin = true;
        const delayMs = this.getAuthCommandDelayMs();
        setTimeout(() => {
          if (!this.bot) return;
          this.bot.chat(`/login ${authPassword}`);
          this.log(`Sent /login command after ${Math.round(delayMs / 1000)}s delay.`);
        }, delayMs);
      }
    });

    this.bot.on("spawn", () => {
      this.status = "online";
      if (!this.startedAt) this.startedAt = new Date().toISOString();
      this.log("Bot spawned successfully.");

      if (this.spawnTimeout) {
        clearTimeout(this.spawnTimeout);
        this.spawnTimeout = null;
      }

      if (!this.hasSpawned) {
        this.hasSpawned = true;
        this.reconnectDelayMs = this.minReconnectDelayMs;

        if (this.bot.pathfinder) this.bot.pathfinder.setGoal(null);
        this.bot.clearControlStates();

        if (!this.modulesInitialized) {
          this.guard.init(this.bot, this.config);
          this.modulesInitialized = true;
          this.log("Guard module enabled on join.");
        }

        this.chat.init(this.bot, this.config, {
          onEnable: () => {
            if (this.modulesEnabled) return;
            this.modulesEnabled = true;
            this.navigation.init(this.bot, this.config);
            this.log("Navigation module enabled by command.");
          },
        });
      } else {
        this.log("Server transfer detected.");
        this.navigation.stopMoving();
        this.reconnectDelayMs = this.minReconnectDelayMs;
      }

      sendAlert(this.config, true);
    });

    this.bot.on("death", () => {
      this.log("Bot died. Respawning in 3s...");
      this.respawnTimeout = setTimeout(() => {
        if (this.bot) this.bot.respawn();
      }, 3000);
    });

    this.bot.on("respawn", () => {
      this.log("Respawned.");
    });

    this.bot.on("kicked", (reason) => {
      const reasonText = typeof reason === "string" ? reason : JSON.stringify(reason);
      const delay = this.computeReconnectDelay(reasonText);
      this.log(`Kicked: ${reasonText}. Reconnecting in ${Math.round(delay / 1000)}s...`);
      this.cleanup();
      this.scheduleReconnect(delay);
    });

    this.bot.on("error", (err) => {
      if (err.code === "ECONNREFUSED") {
        const delay = Math.max(this.nextReconnectDelayMs(), 15000);
        this.log(`Server offline. Retrying in ${Math.round(delay / 1000)}s...`);
        this.cleanup();
        this.scheduleReconnect(delay);
        return;
      }

      this.log(`Error: ${err.message}`);
      this.cleanup();
      this.scheduleReconnect(this.computeReconnectDelay(err.message));
    });

    this.bot.on("end", (reason) => {
      const delay = this.computeReconnectDelay(reason);
      const reasonText = reason ? ` Reason: ${reason}` : "";
      this.log(`Connection ended.${reasonText} Reconnecting in ${Math.round(delay / 1000)}s...`);
      this.cleanup();
      this.scheduleReconnect(delay);
    });
  }

  cleanup() {
    if (this.respawnTimeout) clearTimeout(this.respawnTimeout);
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    if (this.spawnTimeout) clearTimeout(this.spawnTimeout);

    this.respawnTimeout = null;
    this.reconnectTimeout = null;
    this.spawnTimeout = null;

    try {
      if (this.bot) this.bot.quit();
    } catch (_) {
      // no-op
    }
    this.bot = null;

    if (this.shouldReconnect) {
      this.status = "reconnecting";
    }
  }

  scheduleReconnect(delayMs) {
    if (!this.shouldReconnect) return;
    if (this.reconnectScheduled) return;
    this.reconnectScheduled = true;
    this.reconnectTimeout = setTimeout(() => this.createBot(), delayMs);
  }

  getStatus() {
    return {
      id: this.id,
      botName: this.config.botName,
      skinFile: this.config.skinFile || null,
      host: this.config.host,
      port: this.config.port,
      status: this.status,
      startedAt: this.startedAt,
      shouldReconnect: this.shouldReconnect,
      modulesEnabled: this.modulesEnabled,
      guardInitialized: this.modulesInitialized,
      hasLiveConnection: Boolean(this.bot),
      lastDisconnectReason: this.lastDisconnectReason,
      lastEventAt: this.lastEventAt,
      lastLog: this.recentLogs.length ? this.recentLogs[this.recentLogs.length - 1] : null,
    };
  }

  getRecentLogs(limit = 40) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 40));
    return this.recentLogs.slice(-safeLimit);
  }
}

module.exports = { BotInstance };
