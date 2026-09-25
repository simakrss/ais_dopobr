"use strict";
// Application-owned files only. Never include settings, documents, secrets or caches.
module.exports = Object.freeze([
  "manifest.webmanifest", "apple-touch-icon.png", "pwa-icon-192.png", "pwa-icon-512.png", "pwa-icon-maskable.png",
  "docker-compose.onlyoffice.yml",
  "scripts/ais-service-host.ps1", "scripts/ais-service-tray.ps1", "scripts/ais-windows-service.cs", "scripts/ais-msi-update.cs", "local-update-windows.js",
  "scripts/ais-hidden-process.vbs", "scripts/control-ais-service.ps1", "scripts/show-ais-service-log.ps1",
  "scripts/setup-ais-windows-service.ps1", "scripts/install-ais-service.ps1", "scripts/enable-component-updates.ps1",
  "scripts/bootstrap-local-system.ps1", "scripts/sync-and-deploy-startup.ps1",
  "scripts/stop-lan-system.js", "scripts/stop-lan-system.ps1", "scripts/start-remote-services.ps1",
  "services/ocr/.dockerignore", "services/ocr/Dockerfile", "services/ocr/ensure_runtime.py",
  "services/ocr/requirements.txt", "services/ocr/runtime-bootstrap.js", "services/ocr/server.py",
  "vendor/mysql2-bundle.cjs", "vendor/pdf-lib.min.js", "vendor/pdf-lib.LICENSE.md",
  "vendor/sheetjs/xlsx.full.min.js", "vendor/sheetjs/LICENSE",
  "vendor/qrcode-runtime/node_modules/qrcode-generator/qrcode.js",
  "vendor/qrcode-runtime/node_modules/qrcode-generator/package.json",
  "vendor/qrcode-runtime/node_modules/qrcode-generator/README.md",
  "vendor/qrcode-runtime/package.json", "vendor/qrcode-runtime/package-lock.json"
]);
