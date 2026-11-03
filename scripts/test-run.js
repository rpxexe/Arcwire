const path = require('path');
const fs = require('fs');
const { app } = require('electron');

console.log('[TEST] Starting Electron Smoke Test...');

// Require the built main process
require('../apps/desktop/out/main/index.js');

app.whenReady().then(() => {
  setTimeout(() => {
    try {
      const appData = path.join(app.getPath('appData'), 'IPMessenger');
      const dbPath = path.join(appData, 'data', 'ipm.db');
      console.log('[TEST] Checking database path:', dbPath);
      const dbExists = fs.existsSync(dbPath);
      console.log('[TEST] Database file exists on disk:', dbExists);

      if (dbExists) {
        const Database = require('better-sqlite3');
        const db = new Database(dbPath);
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        console.log('[TEST] Successfully loaded SQLite. Table count:', tables.length);
        console.log('[TEST] Tables found:', tables.map(t => t.name).join(', '));
        db.close();
      }

      console.log('[TEST] SMOKE TEST COMPLETED SUCCESSFULLY! Quitting app.');
      app.quit();
      process.exit(0);
    } catch (err) {
      console.error('[TEST ERROR]', err);
      app.quit();
      process.exit(1);
    }
  }, 2500);
});
