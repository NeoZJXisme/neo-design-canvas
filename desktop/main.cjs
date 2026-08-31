const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");

const APP_ID = "com.neozjx.neo.canvas";
const AGENT_START_TIMEOUT_MS = 20000;
const AGENT_CONFIG_FILE = path.join(os.homedir(), ".infinite-canvas", "canvas-agent.json");
const API_PROXY_PATH = "/__neo_api_proxy__";

let mainWindow = null;
let webServer = null;
let agentProcess = null;
let ownsAgentProcess = false;
let shuttingDown = false;

function logFilePath() {
  return process.env.NEO_CANVAS_LOG_FILE || path.join(app.getPath("userData"), "logs", "desktop.log");
}

function writeLog(message) {
  try {
    const file = logFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${message}\n`, "utf8");
  } catch {
    // Logging must never block application startup.
  }
}

function resourcePath(...parts) {
  return app.isPackaged ? path.join(process.resourcesPath, ...parts) : path.join(__dirname, "..", ...parts);
}

function contentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".ico": return "image/x-icon";
    case ".woff": return "font/woff";
    case ".woff2": return "font/woff2";
    case ".mp4": return "video/mp4";
    case ".mp3": return "audio/mpeg";
    default: return "application/octet-stream";
  }
}

function proxyRequestHeaders(headers) {
  const result = {};
  const blocked = new Set(["host", "origin", "referer", "connection", "proxy-connection", "cookie"]);
  for (const [name, value] of Object.entries(headers || {})) {
    const lower = name.toLowerCase();
    if (blocked.has(lower) || lower.startsWith("sec-") || value == null) continue;
    result[name] = value;
  }
  return result;
}

function proxyResponseHeaders(headers) {
  const result = {};
  const blocked = new Set(["connection", "transfer-encoding", "set-cookie"]);
  for (const [name, value] of Object.entries(headers || {})) {
    if (blocked.has(name.toLowerCase()) || value == null) continue;
    result[name] = value;
  }
  return result;
}

function proxyExternalRequest(req, res, targetValue) {
  let target;
  try {
    target = new URL(targetValue);
  } catch {
    res.writeHead(400).end("Invalid proxy target");
    return;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    res.writeHead(400).end("Unsupported proxy protocol");
    return;
  }

  const client = target.protocol === "https:" ? https : http;
  const upstream = client.request(
    target,
    {
      method: req.method || "GET",
      headers: proxyRequestHeaders(req.headers),
    },
    (upstreamResponse) => {
      res.writeHead(upstreamResponse.statusCode || 502, proxyResponseHeaders(upstreamResponse.headers));
      upstreamResponse.on("error", (error) => {
        writeLog(`API proxy response failed: ${error.stack || error}`);
        if (!res.destroyed) res.destroy(error);
      });
      upstreamResponse.pipe(res);
    },
  );

  upstream.setTimeout(10 * 60_000, () => upstream.destroy(new Error("API proxy request timed out")));
  upstream.on("error", (error) => {
    writeLog(`API proxy request failed: ${target.origin}${target.pathname}: ${error.stack || error}`);
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    if (!res.writableEnded) res.end(JSON.stringify({ error: { message: error.message || "API proxy request failed" } }));
  });
  req.on("aborted", () => upstream.destroy());
  req.pipe(upstream);
}

function startWebServer(proxyToken) {
  const rootDir = resourcePath("web-dist");
  const indexFile = path.join(rootDir, "index.html");
  if (!fs.existsSync(indexFile)) throw new Error(`Web build not found: ${indexFile}`);

  return new Promise((resolve, reject) => {
    const root = path.resolve(rootDir);
    const server = http.createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
        if (requestUrl.pathname === API_PROXY_PATH) {
          if (requestUrl.searchParams.get("token") !== proxyToken) {
            res.writeHead(403).end("Forbidden");
            return;
          }
          const target = requestUrl.searchParams.get("target") || "";
          proxyExternalRequest(req, res, target);
          return;
        }

        const relativePath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "") || "index.html";
        let filePath = path.resolve(root, relativePath);
        if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
          res.writeHead(403).end("Forbidden");
          return;
        }

        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          if (path.extname(relativePath)) {
            res.writeHead(404).end("Not found");
            return;
          }
          filePath = indexFile;
        }

        res.setHeader("Cache-Control", filePath === indexFile ? "no-store" : "public, max-age=31536000, immutable");
        res.setHeader("Content-Type", contentType(filePath));
        fs.createReadStream(filePath)
          .on("error", (error) => {
            writeLog(`Web asset read failed: ${error.stack || error}`);
            if (!res.headersSent) res.writeHead(500);
            res.end("Internal error");
          })
          .pipe(res);
      } catch (error) {
        writeLog(`Web request failed: ${error.stack || error}`);
        res.writeHead(500).end("Internal error");
      }
    });

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      webServer = server;
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Failed to allocate desktop web port"));
      const url = `http://127.0.0.1:${address.port}`;
      writeLog(`Desktop web server ready: ${url}`);
      resolve(url);
    });
  });
}

function readAgentConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(AGENT_CONFIG_FILE, "utf8"));
    if (!config || typeof config.url !== "string" || typeof config.token !== "string") return null;
    return { url: config.url, token: config.token };
  } catch {
    return null;
  }
}

function probeAgent(url) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      const endpoint = new URL("/health", url);
      const request = http.get(endpoint, { timeout: 1000 }, (response) => {
        response.resume();
        finish(response.statusCode === 200);
      });
      request.once("timeout", () => {
        request.destroy();
        finish(false);
      });
      request.once("error", () => finish(false));
    } catch {
      finish(false);
    }
  });
}

async function discoverExistingAgent() {
  const config = readAgentConfig();
  if (!config) return null;
  return (await probeAgent(config.url)) ? config : null;
}

function stripAnsi(value) {
  return value.replace(/\u001B\[[0-?]*[ -\/]*[@-~]/g, "");
}

async function startAgent() {
  const existing = await discoverExistingAgent();
  if (existing) {
    writeLog(`Using existing Canvas Agent: ${existing.url}`);
    return existing;
  }

  const agentRoot = resourcePath("canvas-agent");
  const entry = path.join(agentRoot, "dist", "index.js");
  if (!fs.existsSync(entry)) throw new Error(`Canvas Agent build not found: ${entry}`);

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry], {
      cwd: agentRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    agentProcess = child;
    ownsAgentProcess = true;

    let output = "";
    let errorOutput = "";
    let settled = false;
    const timer = setTimeout(() => fail(new Error(`Canvas Agent startup timed out after ${AGENT_START_TIMEOUT_MS / 1000}s`)), AGENT_START_TIMEOUT_MS);

    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      writeLog(`Canvas Agent ready: ${value.url}`);
      resolve(value);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      writeLog(`Canvas Agent startup failed: ${error.stack || error}\n${errorOutput}`);
      reject(error);
    };
    const inspect = (chunk) => {
      const text = stripAnsi(chunk.toString("utf8"));
      output += text;
      writeLog(`[agent] ${text.trimEnd()}`);
      const urlMatch = output.match(/Local URL:\s*(https?:\/\/[^\s]+)/i);
      const tokenMatch = output.match(/Connect token:\s*([^\s]+)/i);
      if (urlMatch && tokenMatch) finish({ url: urlMatch[1], token: tokenMatch[1] });
    };

    child.stdout.on("data", inspect);
    child.stderr.on("data", (chunk) => {
      const text = stripAnsi(chunk.toString("utf8"));
      errorOutput += text;
      writeLog(`[agent:stderr] ${text.trimEnd()}`);
    });
    child.once("error", fail);
    child.once("exit", (code, signal) => {
      writeLog(`Canvas Agent exited: code=${code} signal=${signal || ""}`);
      if (!settled) fail(new Error(`Canvas Agent exited before startup (code ${code ?? "unknown"})`));
    });
  });
}

function stopOwnedAgent() {
  if (!ownsAgentProcess || !agentProcess || !agentProcess.pid) return;
  const pid = agentProcess.pid;
  ownsAgentProcess = false;
  agentProcess = null;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } else {
      process.kill(pid, "SIGTERM");
    }
    writeLog(`Canvas Agent process tree stopped: ${pid}`);
  } catch (error) {
    writeLog(`Failed to stop Canvas Agent ${pid}: ${error.stack || error}`);
  }
}

function stopWebServer() {
  if (!webServer) return;
  try { webServer.close(); } catch {}
  webServer = null;
}

async function createMainWindow(webUrl, agent, proxyToken) {
  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: "#111111",
    title: "Neo Canvas",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow = window;

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.on("ready-to-show", () => window.show());
  window.on("closed", () => { if (mainWindow === window) mainWindow = null; });

  const bootstrap = new URLSearchParams({ agentUrl: agent.url, agentToken: agent.token }).toString();
  const pageUrl = new URL(webUrl);
  if (proxyToken) pageUrl.searchParams.set("neoDesktopProxy", proxyToken);
  pageUrl.hash = bootstrap;
  await window.loadURL(pageUrl.toString());
  writeLog("Main window loaded");

  if (process.env.NEO_CANVAS_SMOKE_TEST === "1") {
    writeLog("Desktop smoke test passed");
    setTimeout(() => app.quit(), 1000);
  }
}

async function bootstrap() {
  writeLog(`Neo Canvas desktop starting; packaged=${app.isPackaged}`);
  Menu.setApplicationMenu(null);
  if (process.platform === "win32") app.setAppUserModelId(APP_ID);

  const devUrl = process.env.NEO_CANVAS_DEV_URL || "";
  const proxyToken = devUrl ? "" : crypto.randomBytes(24).toString("hex");
  const webUrl = devUrl || await startWebServer(proxyToken);
  const agent = await startAgent();
  await createMainWindow(webUrl, agent, proxyToken);
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(bootstrap).catch((error) => {
    const detail = `${error instanceof Error ? error.message : String(error)}\n\n日志：${logFilePath()}`;
    writeLog(`Fatal startup error: ${error && error.stack ? error.stack : error}`);
    if (process.env.NEO_CANVAS_SMOKE_TEST !== "1") dialog.showErrorBox("Neo Canvas 启动失败", detail);
    app.quit();
  });

  app.on("before-quit", () => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopOwnedAgent();
    stopWebServer();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (mainWindow) mainWindow.show();
  });
}
