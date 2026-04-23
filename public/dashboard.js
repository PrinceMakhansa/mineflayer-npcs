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
let skinview3dReadyPromise = null;

const SKINVIEW3D_SOURCES = [
  "/vendor/skinview3d.bundle.js",
  "https://cdn.jsdelivr.net/npm/skinview3d@3.1.0/bundles/skinview3d.bundle.js",
  "https://unpkg.com/skinview3d@3.1.0/bundles/skinview3d.bundle.js",
  "https://cdnjs.cloudflare.com/ajax/libs/skinview3d/3.1.0/skinview3d.bundle.min.js",
];

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      setTimeout(() => resolve(), 100);
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

async function ensureSkinview3d() {
  if (window.skinview3d) {
    console.log(`[skinview3d] Already loaded`);
    return window.skinview3d;
  }
  if (skinview3dReadyPromise) return skinview3dReadyPromise;

  skinview3dReadyPromise = (async () => {
    for (const src of SKINVIEW3D_SOURCES) {
      try {
        console.log(`[skinview3d] Trying to load: ${src}`);
        await loadScript(src);
        
        // Wait longer for initialization
        await new Promise(resolve => setTimeout(resolve, 500));
        
        if (window.skinview3d) {
          console.log(`[skinview3d] Successfully loaded from: ${src}`, window.skinview3d);
          return window.skinview3d;
        } else {
          console.log(`[skinview3d] Script loaded but window.skinview3d not found. Checking for THREE...`, window.THREE);
        }
      } catch (err) {
        console.log(`[skinview3d] Failed to load from ${src}:`, err.message);
      }
    }
    throw new Error("skinview3d could not be loaded from any source");
  })();

  try {
    return await skinview3dReadyPromise;
  } catch (err) {
    console.error(`[skinview3d] Fatal error:`, err.message);
    skinview3dReadyPromise = null;
    throw err;
  }
}

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
      <div class="card-head">
        <h3 class="title">${bot.botName} <span class="muted">(${bot.id})</span></h3>
        <div class="meta">${bot.host}:${bot.port}</div>
        <div><span class="status ${statusClass}">${safeStatus}</span></div>
      </div>
      <div class="card-row">
        <div class="card-col card-col-model">
          <div class="model-wrap">
            <div class="skin-viewer" data-botname="${escapeHtml(bot.botName || bot.id)}" data-skinfile="${escapeHtml(bot.skinFile || "")}"></div>
          </div>
        </div>
        <div class="card-col card-col-controls">
          <div class="meta">Started: ${startedAt}</div>
          <div class="meta">Last event: ${lastEventAt}</div>
          <div class="meta">Reconnect: ${bot.shouldReconnect ? "On" : "Off"}</div>
          <div class="actions">
            <button class="btn btn-good" data-action="start" data-id="${bot.id}">Start</button>
            <button class="btn btn-danger" data-action="stop" data-id="${bot.id}">Stop</button>
            <button class="btn" data-action="restart" data-id="${bot.id}">Restart</button>
          </div>
        </div>
        <div class="card-col card-col-logs">
          <div class="log-box">
            <p class="log-title">Recent Logs</p>
            <ul class="log-list">${logMarkup}</ul>
          </div>
        </div>
      </div>
    </article>
  `;
}

function resolveSkinUrl(node, botName) {
  const configuredSkinFile = (node.getAttribute("data-skinfile") || "").trim();
  if (configuredSkinFile) {
    const normalized = configuredSkinFile
      .replaceAll("\\", "/")
      .replace(/^\.\//, "")
      .replace(/^public\/skins\//i, "")
      .replace(/^skins\//i, "");

    const encodedParts = normalized
      .split("/")
      .filter(Boolean)
      .map((part) => encodeURIComponent(part));

    if (encodedParts.length > 0) {
      return `/skins/${encodedParts.join("/")}`;
    }
  }

  return `https://mc-heads.net/skin/${encodeURIComponent(botName)}`;
}

function renderHeadPreview(node, skinUrl) {
  const canvas = document.createElement("canvas");
  canvas.className = "skin-head";
  canvas.width = 64;
  canvas.height = 64;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    node.textContent = "Skin N/A";
    return;
  }

  ctx.imageSmoothingEnabled = false;

  const img = new Image();
  img.decoding = "async";
  img.onload = () => {
    ctx.clearRect(0, 0, 64, 64);
    ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 64, 64);
    ctx.drawImage(img, 40, 8, 8, 8, 0, 0, 64, 64);
  };
  img.onerror = () => {
    node.textContent = "Skin N/A";
  };

  node.innerHTML = "";
  node.appendChild(canvas);
  img.src = skinUrl;
}

async function initSkinViewers() {
  let skinview3d = window.skinview3d || null;
  if (!skinview3d) {
    try {
      skinview3d = await ensureSkinview3d();
      console.log(`[skinview3d] Ready, SkinViewer available:`, !!skinview3d?.SkinViewer);
    } catch (err) {
      console.error(`[skinview3d] Failed to load:`, err);
      skinview3d = null;
    }
  }
  const viewerNodes = document.querySelectorAll(".skin-viewer");

  viewerNodes.forEach((node) => {
    if (!(node instanceof HTMLElement)) return;

    const botName = node.getAttribute("data-botname") || "Steve";
    const skinUrl = resolveSkinUrl(node, botName);

    if (!skinview3d) {
      console.log(`[skinview3d] Not available, using head preview for ${botName}`);
      renderHeadPreview(node, skinUrl);
      return;
    }

    // Measure the container so the renderer matches exactly
    const wrap = node.closest(".model-wrap") || node;
    const wrapW = wrap.clientWidth  || 260;
    const wrapH = wrap.clientHeight || 340;

    const canvas = document.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.inset    = "0";
    canvas.style.width    = "100%";
    canvas.style.height   = "100%";
    canvas.style.display  = "block";
    node.innerHTML = "";
    node.appendChild(canvas);

    try {
      console.log(`[3d-viewer] Creating SkinViewer for ${botName}, url: ${skinUrl}`);
      const viewer = new skinview3d.SkinViewer({
        canvas,
        width: wrapW,
        height: wrapH,
        skin: skinUrl,
      });
      console.log(`[3d-viewer] SkinViewer created successfully`);
      viewer.fov = 40;
      viewer.zoom = 1.0;
      viewer.camera.position.set(0, 0, 60);
      viewer.camera.lookAt(0, 0, 0);
      // Reset player rotation to face straight forward
      viewer.playerObject.rotation.y = 0;
      viewer.animation = new skinview3d.IdleAnimation();
      viewer.renderer.shadowMap.enabled = true;

      // Try new API first (v3.x), fallback to old API
      if (skinview3d.OrbitControls) {
        try {
          const controls = new skinview3d.OrbitControls(viewer);
          controls.enableRotate = true;
          controls.enableZoom = true;
          controls.enablePan = false;
          console.log(`[3d-viewer] OrbitControls initialized`);
        } catch (e) {
          console.log(`[3d-viewer] OrbitControls failed, using auto-rotate only`, e);
        }
      } else if (skinview3d.createOrbitControls) {
        const controls = skinview3d.createOrbitControls(viewer);
        controls.enableRotate = true;
        controls.enableZoom = true;
        controls.enablePan = false;
      }

      // No auto-rotation — skin stands straight and faces forward
      console.log(`[3d-viewer] ${botName} viewer fully initialized`);
    } catch (err) {
      console.error(`[3d-viewer] Failed to create viewer for ${botName}:`, err);
      renderHeadPreview(node, skinUrl);
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
    await initSkinViewers();
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
