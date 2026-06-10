const fs = require("fs");
const path = require("path");

function setupTauriAssets() {
  const sourceIcon = path.join(__dirname, "..", "electron", "icon.png");
  const tauriIconDir = path.join(__dirname, "..", "src-tauri", "icons");

  if (!fs.existsSync(sourceIcon)) {
    console.log("Source icon not found at:", sourceIcon);
    return;
  }

  if (!fs.existsSync(tauriIconDir)) {
    fs.mkdirSync(tauriIconDir, { recursive: true });
  }

  // Copy icon to required files
  const targets = [
    "32x32.png",
    "128x128.png",
    "128x128@2x.png",
    "icon.ico",
    "icon.icns"
  ];

  targets.forEach((target) => {
    const dest = path.join(tauriIconDir, target);
    fs.copyFileSync(sourceIcon, dest);
    console.log(`Copied icon to: ${dest}`);
  });

  console.log("Tauri assets setup completed successfully!");
}

setupTauriAssets();
