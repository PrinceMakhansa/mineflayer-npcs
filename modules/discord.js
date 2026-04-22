const https = require("https");
const http = require("http");

function sendAlert(config, isTest = false) {
  const webhookUrl = config.discordWebhook;

  if (!webhookUrl || webhookUrl.includes("YOUR_WEBHOOK")) {
    console.log("[Discord] Webhook URL not set in config.json; skipping alert.");
    return;
  }

  const now = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });

  const title = isTest
    ? "Bot is Online"
    : "Bot Alert";

  const description = isTest
    ? `The bot has connected and is online.\nTime: ${now}`
    : `A bot alert was triggered.\nTime: ${now}`;

  const color = isTest ? 0x00ff00 : 0xff3333;

  const payload = JSON.stringify({
    username: config.botName || "Minecraft Bot",
    avatar_url: `https://minotar.net/avatar/${encodeURIComponent(config.botName || "MinecraftBot")}/100`,
    embeds: [
      {
        title,
        description,
        color,
        footer: {
          text: `${config.botName || "Minecraft Bot"} - Minecraft SMP`,
        },
        timestamp: new Date().toISOString(),
      },
    ],
  });

  const urlObj = new URL(webhookUrl);
  const lib = urlObj.protocol === "https:" ? https : http;

  const options = {
    hostname: urlObj.hostname,
    path: urlObj.pathname + urlObj.search,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    },
  };

  const req = lib.request(options, (res) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      console.log(`[Discord] Alert sent (${isTest ? "startup" : "runtime"}).`);
    } else {
      console.log(`[Discord] Webhook returned status ${res.statusCode}`);
    }
  });

  req.on("error", (err) => {
    console.error("[Discord] Failed to send webhook:", err.message);
  });

  req.write(payload);
  req.end();
}

module.exports = { sendAlert };
