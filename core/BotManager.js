const { BotInstance } = require("./BotInstance");

class BotManager {
  constructor(options = {}) {
    this.instances = new Map();
    this.logsDir = options.logsDir || null;
  }

  register(definition) {
    if (!definition?.id) {
      throw new Error("Bot definition must include an id.");
    }
    if (this.instances.has(definition.id)) {
      throw new Error(`Bot id '${definition.id}' is already registered.`);
    }

    const instance = new BotInstance({
      ...definition,
      logsDir: this.logsDir,
    });
    this.instances.set(definition.id, instance);
    return instance;
  }

  start(id) {
    const bot = this.instances.get(id);
    if (!bot) throw new Error(`Unknown bot id '${id}'.`);
    bot.start();
    return bot.getStatus();
  }

  stop(id, reason = "manual stop") {
    const bot = this.instances.get(id);
    if (!bot) throw new Error(`Unknown bot id '${id}'.`);
    bot.stop(reason);
    return bot.getStatus();
  }

  restart(id, reason = "manual restart") {
    const bot = this.instances.get(id);
    if (!bot) throw new Error(`Unknown bot id '${id}'.`);
    bot.stop(reason);
    bot.start();
    return bot.getStatus();
  }

  startAll(options = {}) {
    const staggerMs = Number(options.staggerMs) || 0;
    const bots = Array.from(this.instances.values());
    bots.forEach((bot, index) => {
      const delay = Math.max(0, staggerMs * index);
      if (delay === 0) {
        bot.start();
      } else {
        setTimeout(() => bot.start(), delay);
      }
    });
  }

  stopAll(reason = "manager shutdown") {
    for (const bot of this.instances.values()) {
      bot.stop(reason);
    }
  }

  getStatus(id) {
    const bot = this.instances.get(id);
    if (!bot) throw new Error(`Unknown bot id '${id}'.`);
    return bot.getStatus();
  }

  listStatus() {
    return Array.from(this.instances.values()).map((bot) => bot.getStatus());
  }

  getLogs(id, limit = 40) {
    const bot = this.instances.get(id);
    if (!bot) throw new Error(`Unknown bot id '${id}'.`);
    return bot.getRecentLogs(limit);
  }
}

module.exports = { BotManager };
