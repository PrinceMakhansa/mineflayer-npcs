const lastUpdated = document.getElementById("lastUpdated");
const botsGrid = document.getElementById("botsGrid");
const toolbar = document.getElementById("toolbar");
const loginPanel = document.getElementById("loginPanel");
const loginForm = document.getElementById("loginForm");
const usernameInput = document.getElementById("usernameInput");
const passwordInput = document.getElementById("passwordInput");
const logoutBtn = document.getElementById("logoutBtn");
const authState = document.getElementById("authState");

let isAuthenticated = false;

function setAuthUi(authenticated, username = "") {
  isAuthenticated = authenticated;

  if (loginPanel instanceof HTMLElement) {
    loginPanel.classList.toggle("hidden", authenticated);
  }

  if (toolbar instanceof HTMLElement) {
    toolbar.classList.toggle("hidden", !authenticated);
  }

  if (authState instanceof HTMLElement) {
    authState.textContent = authenticated ? `Signed in as ${username}` : "Not signed in";
  }

  if (!authenticated) {
    botsGrid.innerHTML = "";
    if (lastUpdated instanceof HTMLElement) {
      lastUpdated.textContent = "Updated: --";
    }
  }
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json" };
  const fetchOptions = {
    method: options.method || "GET",
    headers,
    credentials: "same-origin",
  };

  if (options.body !== undefined) {
    fetchOptions.body = JSON.stringify(options.body);
  }

  const res = await fetch(path, fetchOptions);
  const body = await res.json().catch(() => ({}));

  if (options.allowUnauthorized && res.status === 401) {
    return { unauthorized: true, body };
  }

  if (!res.ok) {
    const message = body.error || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }

  return body;
}

function formatStatusClass(status) {
  const value = String(status || "stopped").toLowerCase();
  if (value === "online") return "online";
  if (value === "connecting" || value === "reconnecting") return value;
  return "stopped";
}

function escapeHtml(input) {
  return String(input || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderBotCard(bot, logs = []) {
  const safeStatus = String(bot.status || "unknown");
  const statusClass = formatStatusClass(bot.status);
  const startedAt = bot.startedAt ? new Date(bot.startedAt).toLocaleString() : "N/A";
  const lastEventAt = bot.lastEventAt ? new Date(bot.lastEventAt).toLocaleTimeString() : "N/A";
  const logMarkup = logs.length
    ? logs
        .map((entry) => {
          const t = entry.ts ? new Date(entry.ts).toLocaleTimeString() : "--:--:--";
          return `<li><span class="log-time">${escapeHtml(t)}</span><span class="log-msg">${escapeHtml(entry.message)}</span></li>`;
        })
        .join("")
    : "<li><span class='log-msg muted'>No logs yet</span></li>";

  return `
    <article class="card">
      <div class="card-top">
        <div class="model-wrap">
          <div class="skin-viewer" data-botname="${escapeHtml(bot.botName || bot.id)}"></div>
        </div>
        <div>
          <h3 class="title">${bot.botName} <span class="muted">(${bot.id})</span></h3>
          <div class="meta">${bot.host}:${bot.port}</div>
          <div><span class="status ${statusClass}">${safeStatus}</span></div>
        </div>
      </div>
      <div class="meta">Started: ${startedAt}</div>
      <div class="meta">Last event: ${lastEventAt}</div>
      <div class="meta">Reconnect: ${bot.shouldReconnect ? "On" : "Off"}</div>
      <div class="actions">
        <button class="btn btn-good" data-action="start" data-id="${bot.id}">Start</button>
        <button class="btn btn-danger" data-action="stop" data-id="${bot.id}">Stop</button>
        <button class="btn" data-action="restart" data-id="${bot.id}">Restart</button>
      </div>
      <div class="log-box">
        <p class="log-title">Recent Logs</p>
        <ul class="log-list">${logMarkup}</ul>
      </div>
    </article>
  `;
}

function initSkinViewers() {
  const skinview3d = window.skinview3d;
  const viewerNodes = document.querySelectorAll(".skin-viewer");

  viewerNodes.forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    if (!skinview3d) {
      node.textContent = "Skin N/A";
      return;
    }

    const botName = node.getAttribute("data-botname") || "Steve";
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    node.innerHTML = "";
    node.appendChild(canvas);

    try {
      const viewer = new skinview3d.SkinViewer({
        canvas,
        width: 64,
        height: 64,
        skin: `https://mc-heads.net/skin/${encodeURIComponent(botName)}`,
      });
      viewer.fov = 55;
      viewer.zoom = 0.95;
      viewer.camera.position.set(18, 14, 42);
      viewer.animation = new skinview3d.IdleAnimation();

      const controls = skinview3d.createOrbitControls(viewer);
      controls.enableRotate = false;
      controls.enableZoom = false;
      controls.enablePan = false;

      let angle = 0;
      const rotate = () => {
        angle += 0.008;
        viewer.playerObject.rotation.y = angle;
        requestAnimationFrame(rotate);
      };
      requestAnimationFrame(rotate);
    } catch (_) {
      node.textContent = "Skin N/A";
    }
  });
}

async function loadBots() {
  if (!isAuthenticated) return;

  try {
    const data = await api("/api/bots");
    const cards = await Promise.all(
      data.bots.map(async (bot) => {
        try {
          const logsData = await api(`/api/bots/${encodeURIComponent(bot.id)}/logs?limit=8`);
          return renderBotCard(bot, logsData.logs || []);
        } catch (_) {
          return renderBotCard(bot, []);
        }
      })
    );
    botsGrid.innerHTML = cards.join("");
    initSkinViewers();
    lastUpdated.textContent = `Updated: ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    if (err.status === 401) {
      setAuthUi(false);
      return;
    }
    throw err;
  }
}

async function runAction(action, id) {
  await api(`/api/bots/${encodeURIComponent(id)}/${action}`, { method: "POST" });
  await loadBots();
}

async function startAll() {
  await api("/api/bots/start-all", { method: "POST" });
  await loadBots();
}

async function stopAll() {
  await api("/api/bots/stop-all", { method: "POST" });
  await loadBots();
}

document.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const action = target.getAttribute("data-action");
  const id = target.getAttribute("data-id");

  try {
    if (action && id) {
      target.setAttribute("disabled", "true");
      await runAction(action, id);
      return;
    }

    if (target.id === "startAllBtn") {
      target.setAttribute("disabled", "true");
      await startAll();
      return;
    }

    if (target.id === "stopAllBtn") {
      target.setAttribute("disabled", "true");
      await stopAll();
      return;
    }

    if (target.id === "refreshBtn") {
      target.setAttribute("disabled", "true");
      await loadBots();
      return;
    }

    if (target.id === "logoutBtn") {
      target.setAttribute("disabled", "true");
      await api("/auth/logout", { method: "POST" });
      setAuthUi(false);
      if (passwordInput instanceof HTMLInputElement) passwordInput.value = "";
      return;
    }
  } catch (err) {
    alert(err.message || "Action failed");
  } finally {
    if (target instanceof HTMLButtonElement) {
      target.removeAttribute("disabled");
    }
  }
});

if (loginForm instanceof HTMLFormElement) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const username = usernameInput instanceof HTMLInputElement ? usernameInput.value.trim() : "";
    const password = passwordInput instanceof HTMLInputElement ? passwordInput.value : "";

    if (!username || !password) {
      alert("Username and password are required");
      return;
    }

    try {
      const result = await api("/auth/login", {
        method: "POST",
        body: { username, password },
      });
      setAuthUi(true, result.username || username);
      if (passwordInput instanceof HTMLInputElement) passwordInput.value = "";
      await loadBots();
    } catch (err) {
      alert(err.message || "Login failed");
    }
  });
}

async function bootstrap() {
  try {
    const session = await api("/auth/me", { allowUnauthorized: true });
    if (session.unauthorized || !session.authenticated) {
      setAuthUi(false);
      return;
    }

    setAuthUi(true, session.username || "");
    await loadBots();
  } catch (err) {
    setAuthUi(false);
    alert(err.message || "Failed to initialize portal");
  }
}

bootstrap();

setInterval(() => {
  if (!isAuthenticated) return;
  loadBots().catch(() => {});
}, 5000);
