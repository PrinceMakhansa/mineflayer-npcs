function createChat({ navigation, guard }) {
  let bot = null;
  let config = null;
  let commandsEnabled = false;
  let onEnable = null;

  function init(botInstance, configObj, options = {}) {
    bot = botInstance;
    config = configObj;
    commandsEnabled = false;
    onEnable = typeof options.onEnable === "function" ? options.onEnable : null;

    bot.on("message", (jsonMsg) => {
      let text = "";
      try {
        text = jsonMsg?.toString?.() || "";
      } catch (_) {
        text = "";
      }
      if (!text) return;

      const match = text.match(/\[.*?\s([A-Za-z0-9_]+)\s->\s([A-Za-z0-9_]+)\]\s(.+)/i);
      if (!match) return;

      const senderRaw = match[1];
      const target = match[2];
      const message = match[3];

      if (
        target.toLowerCase() !== bot.username.toLowerCase() &&
        target.toLowerCase() !== "me"
      ) return;

      const senderName = senderRaw.trim().split(/\s+/).slice(-1)[0];

      if (config.whitelist.length > 0) {
        const allowed = config.whitelist.some((name) => {
          const n = name.toLowerCase();
          const raw = senderRaw.toLowerCase();
          const simple = senderName.toLowerCase();
          return n === simple || n === raw || raw.includes(n);
        });
        if (!allowed) return;
      }

      const normalizedMessage = String(message || "").trim();
      if (!normalizedMessage) return;
      const commandLine = normalizedMessage.startsWith("!")
        ? normalizedMessage.slice(1).trim()
        : normalizedMessage;
      if (!commandLine) return;

      const parts = commandLine.split(/\s+/);
      const command = parts[0].toLowerCase();
      const args = parts.slice(1);

      handleCommand(senderName, command, args, true);
    });
  }

  function reply(username, message, whisperOnly) {
    if (whisperOnly) {
      bot.chat(`/whisper ${username} ${message}`);
    } else {
      bot.chat(message);
    }
  }

  function handleCommand(username, command, args, whisperOnly) {
    if (!commandsEnabled && command !== "enable" && command !== "help") {
      reply(username, "[Bot] Commands are disabled. Use enable to unlock.", whisperOnly);
      return;
    }

    switch (command) {
      case "help": {
        reply(
          username,
          "[Bot] Commands: enable, guard, stopguard, follow <name>, stopfollow, friend <name>, unfriend <name>",
          whisperOnly
        );
        break;
      }

      case "guard": {
        const result = guard.startGuardAtPlayer(username);
        reply(username, `[Bot] ${result.message}`, whisperOnly);
        break;
      }

      case "stopguard": {
        guard.stopGuarding();
        reply(username, "[Bot] I will no longer guard this area.", whisperOnly);
        break;
      }

      case "enable": {
        if (commandsEnabled) {
          reply(username, "[Bot] Commands already enabled.", whisperOnly);
          break;
        }
        commandsEnabled = true;
        if (onEnable) onEnable();
        reply(username, "[Bot] Commands enabled.", whisperOnly);
        break;
      }

      case "stopfollow": {
        navigation.stopMoving();
        navigation.startIdleLook();
        reply(username, "[Bot] Stopped following.", whisperOnly);
        break;
      }

      case "follow": {
        const targetName = args[0] || username;
        reply(username, `[Bot] Looking for ${targetName}...`, whisperOnly);

        const tryFollow = (attempts = 0) => {
          const entity =
            bot.players[targetName]?.entity ||
            Object.values(bot.entities).find(
              (e) => e.type === "player" &&
                e.username?.toLowerCase() === targetName.toLowerCase()
            );
          if (entity) {
            reply(username, `[Bot] Following ${targetName}.`, whisperOnly);
            navigation.followPlayer(targetName);
            return;
          }
          if (attempts >= 10) {
            reply(username, `[Bot] Can't find ${targetName}.`, whisperOnly);
            return;
          }
          setTimeout(() => tryFollow(attempts + 1), 500);
        };
        tryFollow();
        break;
      }

      case "friend": {
        const targetName = args[0];
        if (!targetName) {
          reply(username, "[Bot] Usage: friend <name>", whisperOnly);
          break;
        }
        const result = guard.addFriendlyPlayer(targetName, true);
        reply(username, `[Bot] ${result.message}`, whisperOnly);
        break;
      }

      case "unfriend": {
        const targetName = args[0];
        if (!targetName) {
          reply(username, "[Bot] Usage: unfriend <name>", whisperOnly);
          break;
        }
        const result = guard.removeFriendlyPlayer(targetName, true);
        reply(username, `[Bot] ${result.message}`, whisperOnly);
        break;
      }

      default: {
        reply(username, `[Bot] Unknown command: ${command}.`, whisperOnly);
      }
    }
  }

  return { init };
}

module.exports = { createChat };
