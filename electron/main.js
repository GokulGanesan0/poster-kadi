const { app, BrowserWindow, protocol, net } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");
const { pathToFileURL } = require("url");

// Register custom protocol 'app' for offline static files
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, bypassCSP: true, supportFetchAPI: true } }
]);

let mainWindow = null;
let backendProcess = null;
const BACKEND_PORT = 8000;
const isDev = process.env.NODE_ENV === "development";

function getPythonExecutable() {
  // Try workspace virtual environment first
  const winVenv = path.join(__dirname, "..", ".venv", "Scripts", "python.exe");
  const unixVenv = path.join(__dirname, "..", ".venv", "bin", "python");

  if (fs.existsSync(winVenv)) return winVenv;
  if (fs.existsSync(unixVenv)) return unixVenv;

  // Fallback to system python
  return process.platform === "win32" ? "python" : "python3";
}

function startBackend() {
  const pythonPath = getPythonExecutable();
  console.log(`Starting Python backend using: ${pythonPath}`);

  // In production, check if there's a packaged sidecar binary first
  const sidecarName = process.platform === "win32" ? "backend.exe" : "backend";
  const sidecarPath = path.join(process.resourcesPath || __dirname, "bin", sidecarName);

  let spawnCmd = pythonPath;
  let spawnArgs = ["-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", String(BACKEND_PORT)];

  if (fs.existsSync(sidecarPath)) {
    console.log(`Found packaged backend sidecar: ${sidecarPath}`);
    spawnCmd = sidecarPath;
    spawnArgs = ["--host", "127.0.0.1", "--port", String(BACKEND_PORT)];
  }

  backendProcess = spawn(spawnCmd, spawnArgs, {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PYTHONUNBUFFERED: "1" }
  });

  backendProcess.stdout.on("data", (data) => {
    console.log(`[Backend]: ${data}`);
  });

  backendProcess.stderr.on("data", (data) => {
    console.error(`[Backend Err]: ${data}`);
  });

  backendProcess.on("close", (code) => {
    console.log(`Backend process exited with code ${code}`);
  });
}

function stopBackend() {
  if (backendProcess) {
    console.log("Terminating Python backend...");
    backendProcess.kill();
    backendProcess = null;
  }
}

function registerProtocol() {
  protocol.handle("app", async (request) => {
    const parsedUrl = new URL(request.url);
    let pathname = parsedUrl.pathname;

    // Normalise slash paths
    if (pathname === "/" || pathname === "") {
      pathname = "/index.html";
    }

    // Support Next.js routing by resolving paths without extension to .html files
    const ext = path.extname(pathname);
    if (!ext && pathname !== "/") {
      pathname += ".html";
    }

    const filePath = path.join(__dirname, "..", "out", pathname.startsWith("/") ? pathname.substring(1) : pathname);

    try {
      if (fs.existsSync(filePath)) {
        return net.fetch(pathToFileURL(filePath).toString());
      }
    } catch (err) {
      console.error(`Error serving path ${pathname}:`, err);
    }

    // Fallback to index.html for SPA routing
    const fallbackPath = path.join(__dirname, "..", "out", "index.html");
    return net.fetch(pathToFileURL(fallbackPath).toString());
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    title: "Poster Kadai - Print Layout Generator",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false // Disable webSecurity so we can fetch localhost:8000 and load blob URLs easily
    }
  });

  mainWindow.setMenuBarVisibility(false);

  if (isDev) {
    // In development, load local Next.js dev server
    mainWindow.loadURL("http://localhost:3000");
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load app:// custom protocol
    mainWindow.loadURL("app://local/index.html");
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  if (!isDev) {
    registerProtocol();
  }
  startBackend();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  stopBackend();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  stopBackend();
});
