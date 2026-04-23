const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const SESSION_COOKIE = "portal_sid";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function parseAdminUsers(raw) {
  const text = String(raw || "").trim();
  if (!text) return new Map();

  const users = new Map();
  for (const pair of text.split(",")) {
    const chunk = pair.trim();
    if (!chunk) continue;
    const idx = chunk.indexOf(":");
    if (idx <= 0) continue;

    const username = chunk.slice(0, idx).trim();
    const password = chunk.slice(idx + 1).trim();
    if (!username || !password) continue;
    users.set(username, password);
  }

  return users;
}

function parseCookies(req) {
  const header = String(req.headers?.cookie || "");
  const out = {};
  if (!header) return out;

  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    out[key] = decodeURIComponent(value);
  }

  return out;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 16 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(JSON.parse(raw));
      } catch (_) {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}

function isProtectedApiRoute(pathname) {
  return pathname.startsWith("/api/") && pathname !== "/api/health";
}

function createApiServer({ manager, port = 3000, startAllStaggerMs = 0, adminUsers = "" }) {
  if (!manager) throw new Error("API server requires a bot manager instance.");

  const userMap = parseAdminUsers(adminUsers);
  if (userMap.size === 0) {
    throw new Error("ADMIN_USERS is required for API mode. Example: ADMIN_USERS=alice:pass,bob:pass");
  }

  const sessions = new Map();
  const publicDir = path.join(__dirname, "..", "public");

  function serveFile(res, filePath, contentType) {
    try {
      const data = fs.readFileSync(filePath);
      res.writeHead(200, { "Content-Type": contentType });
      res.end(data);
    } catch (_) {
      sendJson(res, 404, { error: "File not found" });
    }
  }

  function serveVendorFile(res, relativePath, contentType) {
    const vendorRoot = path.join(__dirname, "..", "node_modules", "skinview3d", "bundles");
    const normalized = path.normalize(String(relativePath || ""));
    const candidatePath = path.resolve(vendorRoot, normalized);
    const allowedPrefix = `${path.resolve(vendorRoot)}${path.sep}`;

    if (!candidatePath.startsWith(allowedPrefix)) {
      sendJson(res, 400, { error: "Invalid vendor path" });
      return;
    }

    serveFile(res, candidatePath, contentType);
  }

  function serveSkinFile(res, skinRelativePath) {
    const skinsDir = path.join(publicDir, "skins");
    const cleaned = String(skinRelativePath || "")
      .replaceAll("\\", "/")
      .replace(/^\.\//, "")
      .replace(/^public\/skins\//i, "")
      .replace(/^skins\//i, "");

    const normalized = path.normalize(cleaned);
    const candidatePath = path.resolve(skinsDir, normalized);
    const allowedPrefix = `${path.resolve(skinsDir)}${path.sep}`;

    if (!candidatePath.startsWith(allowedPrefix)) {
      sendJson(res, 400, { error: "Invalid skin path" });
      return;
    }

    try {
      const data = fs.readFileSync(candidatePath);
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(data);
    } catch (_) {
      sendJson(res, 404, { error: "Skin not found" });
    }
  }
  function pruneExpiredSessions() {
    const now = Date.now();
    for (const [sid, info] of sessions.entries()) {
      if (!info || info.expiresAt <= now) {
        sessions.delete(sid);
      }
    }
  }

  function getSession(req) {
    pruneExpiredSessions();
    const cookies = parseCookies(req);
    const sid = cookies[SESSION_COOKIE];
    if (!sid) return null;
    const session = sessions.get(sid);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      sessions.delete(sid);
      return null;
    }
    return { sid, ...session };
  }

  function issueSession(res, req, username) {
    const sid = crypto.randomBytes(32).toString("hex");
    const expiresAt = Date.now() + SESSION_TTL_MS;
    sessions.set(sid, { username, expiresAt });

    const cookieParts = [
      `${SESSION_COOKIE}=${encodeURIComponent(sid)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    ];

    const proto = String(req.headers["x-forwarded-proto"] || "").toLowerCase();
    if (proto === "https") {
      cookieParts.push("Secure");
    }

    res.setHeader("Set-Cookie", cookieParts.join("; "));
  }

  function clearSession(res, req) {
    const cookies = parseCookies(req);
    const sid = cookies[SESSION_COOKIE];
    if (sid) sessions.delete(sid);
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  }

  const server = http.createServer(async (req, res) => {
    if (!req.url) {
      sendJson(res, 400, { error: "Bad request" });
      return;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, "http://localhost");
    const pathname = url.pathname;
    const method = req.method.toUpperCase();

    try {
      if (method === "GET" && pathname === "/") {
        serveFile(res, path.join(publicDir, "index.html"), "text/html; charset=utf-8");
        return;
      }

      if (method === "GET" && pathname === "/dashboard.js") {
        serveFile(res, path.join(publicDir, "dashboard.js"), "application/javascript; charset=utf-8");
        return;
      }

      if (method === "GET" && pathname === "/styles.css") {
        serveFile(res, path.join(publicDir, "styles.css"), "text/css; charset=utf-8");
        return;
      }

      if (method === "GET" && pathname === "/vendor/skinview3d.bundle.js") {
        serveVendorFile(res, "skinview3d.bundle.js", "application/javascript; charset=utf-8");
        return;
      }

      if (method === "GET" && pathname.startsWith("/skins/")) {
        const relativeSkinPath = pathname.slice("/skins/".length);
        serveSkinFile(res, relativeSkinPath);
        return;
      }
      if (method === "POST" && pathname === "/auth/login") {
        const body = await parseBody(req);
        const username = String(body.username || "").trim();
        const password = String(body.password || "");

        if (!username || !password) {
          sendJson(res, 400, { error: "Username and password are required" });
          return;
        }

        const expected = userMap.get(username);
        if (!expected || expected !== password) {
          sendJson(res, 401, { error: "Invalid username or password" });
          return;
        }

        issueSession(res, req, username);
        sendJson(res, 200, { ok: true, username });
        return;
      }

      if (method === "POST" && pathname === "/auth/logout") {
        clearSession(res, req);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (method === "GET" && pathname === "/auth/me") {
        const session = getSession(req);
        if (!session) {
          sendJson(res, 401, { authenticated: false });
          return;
        }
        sendJson(res, 200, { authenticated: true, username: session.username });
        return;
      }

      if (method === "GET" && pathname === "/api/health") {
        sendJson(res, 200, { ok: true, timestamp: new Date().toISOString() });
        return;
      }

      if (isProtectedApiRoute(pathname)) {
        const session = getSession(req);
        if (!session) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }
      }

      if (method === "GET" && pathname === "/api/bots") {
        sendJson(res, 200, { bots: manager.listStatus() });
        return;
      }

      const botMatch = pathname.match(/^\/api\/bots\/([^/]+)$/);
      if (method === "GET" && botMatch) {
        const id = decodeURIComponent(botMatch[1]);
        sendJson(res, 200, { bot: manager.getStatus(id) });
        return;
      }

      const logsMatch = pathname.match(/^\/api\/bots\/([^/]+)\/logs$/);
      if (method === "GET" && logsMatch) {
        const id = decodeURIComponent(logsMatch[1]);
        const limit = Number(url.searchParams.get("limit")) || 30;
        sendJson(res, 200, { logs: manager.getLogs(id, limit) });
        return;
      }

      const actionMatch = pathname.match(/^\/api\/bots\/([^/]+)\/(start|stop|restart)$/);
      if (method === "POST" && actionMatch) {
        const id = decodeURIComponent(actionMatch[1]);
        const action = actionMatch[2];
        console.log(`[API] ${action.toUpperCase()} requested for ${id}`);
        if (action === "start") {
          sendJson(res, 200, { bot: manager.start(id) });
          return;
        }
        if (action === "stop") {
          sendJson(res, 200, { bot: manager.stop(id, "api stop") });
          return;
        }
        if (action === "restart") {
          sendJson(res, 200, { bot: manager.restart(id, "api restart") });
          return;
        }
      }

      if (method === "POST" && pathname === "/api/bots/start-all") {
        const staggerMs = Math.max(0, Number(startAllStaggerMs) || 0);
        if (staggerMs > 0) {
          console.log(`[API] START-ALL requested with ${Math.round(staggerMs / 1000)}s stagger`);
        } else {
          console.log("[API] START-ALL requested");
        }
        manager.startAll({ staggerMs });
        sendJson(res, 200, { bots: manager.listStatus() });
        return;
      }

      if (method === "POST" && pathname === "/api/bots/stop-all") {
        console.log("[API] STOP-ALL requested");
        manager.stopAll("api stop-all");
        sendJson(res, 200, { bots: manager.listStatus() });
        return;
      }

      sendJson(res, 404, { error: "Route not found" });
    } catch (err) {
      const message = err?.message || "Internal server error";
      const statusCode =
        message.startsWith("Unknown bot id")
          ? 404
          : message === "Invalid JSON body" || message === "Request body too large"
            ? 400
            : 500;
      sendJson(res, statusCode, { error: message });
    }
  });

  server.listen(port, () => {
    console.log(`[API] Listening on http://localhost:${port}`);
  });

  return server;
}

module.exports = {
  createApiServer,
};
