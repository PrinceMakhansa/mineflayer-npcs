require("dotenv").config();

const path = require("path");
const config = require("./config.json");
const { BotManager } = require("./core/BotManager");
const { createApiServer } = require("./core/apiServer");

const configPath = path.join(__dirname, "config.json");
const logsDir = path.join(__dirname, "logs");
const manager = new BotManager({ logsDir });

function toPlainObject(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildBotDefinitions(rootConfig) {
  const defaults = {
    host: rootConfig.host,
    port: rootConfig.port,
    botVersion: rootConfig.botVersion,
    auth: rootConfig.auth,
    whitelist: rootConfig.whitelist || [],
    friendlyPlayers: rootConfig.friendlyPlayers || [],
    guardRadius: rootConfig.guardRadius,
    followDistance: rootConfig.followDistance,
    mode: rootConfig.mode,
    alertCooldownSeconds: rootConfig.alertCooldownSeconds,
    discordWebhook: rootConfig.discordWebhook,
    serverCommand: rootConfig.serverCommand,
  };

  if (Array.isArray(rootConfig.bots) && rootConfig.bots.length > 0) {
    return rootConfig.bots.map((botCfg, index) => {
      const merged = { ...defaults, ...toPlainObject(botCfg) };
      const id = String(merged.id || merged.botName || `bot-${index + 1}`);
      return {
        id,
        config: merged,
        persistConfigPath: null,
        persistFriendlyPlayers: false,
      };
    });
  }

  const single = toPlainObject(rootConfig);
  return [
    {
      id: String(single.id || single.botName || "bot-1"),
      config: single,
      persistConfigPath: configPath,
      persistFriendlyPlayers: true,
    },
  ];
}

function parseCliArgs(argv) {
  const args = {
    listOnly: false,
    selectedIds: [],
    apiMode: false,
    apiAutostart: false,
    apiPort: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--list") {
      args.listOnly = true;
      continue;
    }
    if (token === "--api") {
      args.apiMode = true;
      continue;
    }
    if (token === "--api-autostart") {
      args.apiAutostart = true;
      continue;
    }
    if (token === "--api-port") {
      const raw = argv[i + 1];
      i += 1;
      args.apiPort = raw ? Number(raw) : null;
      continue;
    }
    if (token === "--bot" || token === "-b") {
      const raw = argv[i + 1] || "";
      i += 1;
      const ids = raw
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      args.selectedIds.push(...ids);
      continue;
    }
  }

  return args;
}

function pickDefinitions(definitions, selectedIds) {
  if (!selectedIds.length) return definitions;

  const selectedSet = new Set(selectedIds.map((id) => String(id)));
  const picked = definitions.filter((def) => selectedSet.has(def.id));
  return picked;
}

function start() {
  const cli = parseCliArgs(process.argv.slice(2));
  const allDefinitions = buildBotDefinitions(config);
  const definitions = pickDefinitions(allDefinitions, cli.selectedIds);

  if (cli.listOnly) {
    console.log("[Manager] Configured bot instances:");
    for (const def of allDefinitions) {
      console.log(`- ${def.id} (${def.config.botName}) -> ${def.config.host}:${def.config.port}`);
    }
    return;
  }

  if (cli.selectedIds.length && definitions.length === 0) {
    console.error("[Manager] No matching bot ids were found.");
    console.error(`[Manager] Requested: ${cli.selectedIds.join(", ")}`);
    console.error("[Manager] Run `npm run bots:list` to see valid ids.");
    process.exit(1);
  }

  for (const definition of definitions) {
    manager.register(definition);
  }

  const shouldStartBots = !cli.apiMode || cli.apiAutostart;
  if (shouldStartBots) {
    const staggerSeconds = Number(config.startStaggerSeconds);
    const staggerMs = Number.isFinite(staggerSeconds)
      ? Math.max(0, Math.floor(staggerSeconds * 1000))
      : (definitions.length > 1 ? 10000 : 0);
    if (staggerMs > 0 && definitions.length > 1) {
      console.log(`[Manager] Starting bots with ${Math.round(staggerMs / 1000)}s stagger...`);
    }
    manager.startAll({ staggerMs });

    const statuses = manager.listStatus();
    console.log("[Manager] Active bot instances:");
    for (const status of statuses) {
      console.log(`- ${status.id} (${status.botName}) -> ${status.host}:${status.port}`);
    }
  } else {
    console.log("[Manager] API mode started with bots registered but not auto-started.");
  }

  if (cli.apiMode) {
    const configPort = Number(config.apiPort);
    const defaultPort = Number.isFinite(configPort) ? configPort : 3000;
    const apiPort = Number.isFinite(cli.apiPort) ? cli.apiPort : defaultPort;
    const staggerSeconds = Number(config.startStaggerSeconds);
    const startAllStaggerMs = Number.isFinite(staggerSeconds)
      ? Math.max(0, Math.floor(staggerSeconds * 1000))
      : (definitions.length > 1 ? 10000 : 0);
    createApiServer({
      manager,
      port: apiPort,
      startAllStaggerMs,
      adminUsers: process.env.ADMIN_USERS,
    });
  }
}

start();

process.once("SIGINT", () => {
  console.log("\n[Manager] SIGINT received. Stopping all bots...");
  manager.stopAll("SIGINT");
  process.exit(0);
});

module.exports = {
  manager,
  buildBotDefinitions,
  parseCliArgs,
  pickDefinitions,
};
