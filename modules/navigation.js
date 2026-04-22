const { pathfinder } = require("mineflayer-pathfinder");

function createNavigation() {
  let bot = null;
  let config = null;
  let lookInterval = null;
  let followTargetName = null;
  let followInterval = null;

  function init(botInstance, configObj) {
    bot = botInstance;
    config = configObj;
    bot.loadPlugin(pathfinder);
    startIdleLook();
  }

  function getLiveEntity(name) {
    if (!name || !bot) return null;
    const fromPlayers = bot.players[name]?.entity;
    if (fromPlayers) return fromPlayers;
    return (
      Object.values(bot.entities).find(
        (e) => e.type === "player" && e.username?.toLowerCase() === name.toLowerCase()
      ) || null
    );
  }

  function followPlayer(name) {
    if (!bot) return;

    followTargetName = typeof name === "string" ? name : (name?.username || null);
    if (!followTargetName) return;

    bot.pathfinder.setGoal(null);
    bot.clearControlStates();
    stopIdleLook();

    if (followInterval) {
      clearInterval(followInterval);
      followInterval = null;
    }

    let jumpCooldown = false;
    let interactCooldownUntil = 0;

    followInterval = setInterval(() => {
      if (!bot || !followTargetName || !bot.entity?.position) return;

      const entity = getLiveEntity(followTargetName);
      if (!entity?.position) {
        bot.clearControlStates();
        return;
      }

      const pos = entity.position;
      const myPos = bot.entity.position;

      if (isNaN(pos.x) || isNaN(pos.y) || isNaN(pos.z)) {
        bot.clearControlStates();
        return;
      }
      if (isNaN(myPos.x) || isNaN(myPos.y) || isNaN(myPos.z)) {
        bot.clearControlStates();
        return;
      }

      const dx = pos.x - myPos.x;
      const dz = pos.z - myPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist <= 2.5) {
        bot.clearControlStates();
        const yaw = Math.atan2(-dx, -dz);
        bot.look(yaw, 0, false);
        return;
      }

      const yaw = Math.atan2(-dx, -dz);
      bot.look(yaw, 0, true);
      bot.setControlState("forward", true);
      bot.setControlState("sprint", dist > 6);

      if (bot.entity.isInWater) {
        bot.setControlState("jump", true);
        return;
      }

      if (!jumpCooldown && dist > 0.2) {
        try {
          const stepDir = { x: (dx / dist) * 0.7, z: (dz / dist) * 0.7 };
          const blockFeet = bot.blockAt(myPos.offset(stepDir.x, 0.1, stepDir.z));
          const blockBody = bot.blockAt(myPos.offset(stepDir.x, 1.1, stepDir.z));

          const tryOpenPassage = (block) => {
            if (!block || block.boundingBox !== "block") return false;
            const name = String(block.name || "");
            const isDoorOrGate = name.endsWith("_door") || name.endsWith("_fence_gate") || name === "fence_gate";
            if (!isDoorOrGate) return false;

            const props = typeof block.getProperties === "function"
              ? block.getProperties()
              : (block._properties || {});
            const isOpen = props.open === true || props.open === 1 || props.open === "true";
            if (isOpen) return false;

            if (Date.now() < interactCooldownUntil) return true;

            interactCooldownUntil = Date.now() + 1200;
            bot.activateBlock(block).catch(() => {
              // Ignore interaction failures (e.g., iron doors or protection plugins).
            });
            return true;
          };

          if (tryOpenPassage(blockFeet) || tryOpenPassage(blockBody)) {
            return;
          }

          if (blockFeet && blockFeet.boundingBox === "block") {
            const blockAbove = bot.blockAt(myPos.offset(0, 2.1, 0));
            if (!blockAbove || blockAbove.boundingBox !== "block") {
              jumpCooldown = true;
              bot.setControlState("jump", true);
              setTimeout(() => {
                if (bot) {
                  bot.setControlState("jump", false);
                  jumpCooldown = false;
                }
              }, 500);
            }
          }
        } catch (_) {
          // Ignore unloaded chunk lookup errors.
        }
      }
    }, 100);
  }

  function stopMoving() {
    if (!bot) return;
    bot.pathfinder.setGoal(null);
    bot.clearControlStates();
    followTargetName = null;

    if (followInterval) {
      clearInterval(followInterval);
      followInterval = null;
    }
  }

  function startIdleLook() {
    stopIdleLook();
    lookInterval = setInterval(() => {
      if (!bot) return;
      const yaw = Math.random() * Math.PI * 2 - Math.PI;
      const pitch = Math.random() * 0.5 - 0.25;
      bot.look(yaw, pitch, false);
    }, 4000);
  }

  function stopIdleLook() {
    if (lookInterval) {
      clearInterval(lookInterval);
      lookInterval = null;
    }
  }

  function getFollowStatus() {
    if (!bot || !bot.entity) return null;

    const targetName = followTargetName || null;
    const target = targetName ? getLiveEntity(targetName) : null;

    const myPos = bot.entity.position;
    const targetPos = target?.position;

    let distance = null;
    if (targetPos && myPos && !isNaN(targetPos.x) && !isNaN(myPos.x)) {
      distance = myPos.distanceTo(targetPos);
    }

    const moving = bot.controlState?.forward ?? false;

    return { targetName, distance, moving, position: myPos, config };
  }

  return {
    init,
    followPlayer,
    stopMoving,
    stopIdleLook,
    startIdleLook,
    getFollowStatus,
  };
}

module.exports = { createNavigation };
