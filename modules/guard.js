const fs = require("fs");
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder");
const pvp = require("mineflayer-pvp").plugin;

function createGuard(options = {}) {
  let bot = null;
  let config = null;
  let guardPos = null;
  let guardRadius = 16;
  let friendlyPlayers = null;

  const persistConfigPath = options.persistConfigPath || null;
  const persistFriendlyPlayers = Boolean(options.persistFriendlyPlayers);

  function normalizeName(name) {
    return String(name || "").trim().toLowerCase();
  }

  function saveFriendlyPlayers() {
    if (!persistFriendlyPlayers || !persistConfigPath || !config || !friendlyPlayers) return;
    config.friendlyPlayers = Array.from(friendlyPlayers).sort();
    try {
      fs.writeFileSync(persistConfigPath, JSON.stringify(config, null, 2) + "\n");
    } catch (err) {
      console.error("[Guard] Failed to save friendlyPlayers:", err.message);
    }
  }

  function addFriend(name, persist) {
    const normalized = normalizeName(name);
    if (!normalized) return false;
    if (friendlyPlayers.has(normalized)) return false;
    friendlyPlayers.add(normalized);
    if (persist) saveFriendlyPlayers();
    return true;
  }

  function removeFriend(name, persist) {
    const normalized = normalizeName(name);
    if (!normalized) return false;
    const removed = friendlyPlayers.delete(normalized);
    if (removed && persist) saveFriendlyPlayers();
    return removed;
  }

  function addFriendlyPlayer(name, persist = true) {
    if (!friendlyPlayers) {
      return { ok: false, message: "Friendly list not initialized yet." };
    }
    const added = addFriend(name, persist);
    return {
      ok: added,
      message: added ? `Added ${name} to friendly list.` : `${name} is already friendly.`,
    };
  }

  function removeFriendlyPlayer(name, persist = true) {
    if (!friendlyPlayers) {
      return { ok: false, message: "Friendly list not initialized yet." };
    }
    const removed = removeFriend(name, persist);
    return {
      ok: removed,
      message: removed ? `Removed ${name} from friendly list.` : `${name} was not friendly.`,
    };
  }

  function canControl(username) {
    if (!config?.whitelist?.length) return true;
    const normalized = normalizeName(username);
    return config.whitelist.some((name) => normalizeName(name) === normalized);
  }

  function guardArea(pos) {
    guardPos = {
      x: Math.floor(pos.x),
      y: Math.floor(pos.y),
      z: Math.floor(pos.z),
    };
    if (!bot.pvp.target) moveToGuardPos();
  }

  function stopGuarding() {
    guardPos = null;
    bot.pvp.stop();
    bot.pathfinder.setGoal(null);
  }

  function moveToGuardPos() {
    if (!guardPos) return;
    const movements = new Movements(bot);
    movements.canDig = false;
    if ("allow1by1towers" in movements) movements.allow1by1towers = false;
    if ("canOpenDoors" in movements) movements.canOpenDoors = true;
    if ("canOpenFenceGates" in movements) movements.canOpenFenceGates = true;
    bot.pathfinder.setMovements(movements);
    bot.pathfinder.setGoal(new goals.GoalNear(guardPos.x, guardPos.y, guardPos.z, 1));
  }

  function startGuardAtPlayer(username) {
    const player = bot?.players?.[username];
    if (!player?.entity?.position) {
      return { ok: false, message: "I can't see you." };
    }
    addFriend(username, true);
    guardArea(player.entity.position);
    return { ok: true, message: "I will guard that location." };
  }

  function init(botInstance, configObj) {
    bot = botInstance;
    config = configObj;

    bot.loadPlugin(pathfinder);
    bot.loadPlugin(pvp);

    guardRadius = Number(config.guardRadius) || 16;

    friendlyPlayers = new Set();
    const seed = Array.isArray(config.friendlyPlayers)
      ? config.friendlyPlayers
      : (config.whitelist || []);
    seed.forEach((name) => {
      const normalized = normalizeName(name);
      if (normalized) friendlyPlayers.add(normalized);
    });
    if (bot.username) friendlyPlayers.add(normalizeName(bot.username));

    bot.on("stoppedAttacking", () => {
      if (guardPos) moveToGuardPos();
    });

    bot.on("physicsTick", () => {
      if (!guardPos || !bot.entity?.position) return;

      const filter = (e) => {
        if (!e?.position || e.position.distanceTo(bot.entity.position) >= guardRadius) return false;

        if (e.type === "player") {
          return e.username && !friendlyPlayers.has(normalizeName(e.username));
        }

        if (e.type !== "mob") return false;
        const name = String(e.name || "").toLowerCase();
        if (name === "villager") return false;
        return e.displayName !== "Armor Stand" && e.displayName !== "Villager";
      };

      const entity = bot.nearestEntity(filter);
      if (entity) bot.pvp.attack(entity);
    });

    bot.on("chat", (username, message) => {
      if (!username || username === bot.username) return;
      if (!canControl(username)) return;

      if (message === "guard") {
        const player = bot.players[username];
        if (!player?.entity?.position) {
          bot.chat("I can't see you.");
          return;
        }

        addFriend(username, true);
        bot.chat("I will guard that location.");
        guardArea(player.entity.position);
      }

      if (message === "stopguard") {
        bot.chat("I will no longer guard this area.");
        stopGuarding();
      }

      if (message.startsWith("friend ")) {
        const name = message.split(" ")[1];
        if (name) {
          const added = addFriend(name, true);
          bot.chat(added ? `Added ${name} to whitelist.` : `${name} is already friendly.`);
        }
      }

      if (message.startsWith("unfriend ")) {
        const name = message.split(" ")[1];
        if (name) {
          const removed = removeFriend(name, true);
          bot.chat(removed ? `Removed ${name} from whitelist.` : `${name} was not friendly.`);
        }
      }
    });
  }

  return {
    init,
    startGuardAtPlayer,
    stopGuarding,
    addFriendlyPlayer,
    removeFriendlyPlayer,
  };
}

module.exports = { createGuard };
