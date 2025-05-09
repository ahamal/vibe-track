// main.js - Main entry point for the Work Tracker app
const electron = require('electron');
const app = electron.app;
const Menu = electron.Menu;
const path = require('path');

// Prevent multiple instances of the app
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('Another instance is already running. Quitting...');
  app.quit();
} else {
  // Import menubar app (which will handle tray creation)
  require('./work-tracker-menubar');
  
  // Hide dock icon on macOS
  if (process.platform === 'darwin') {
    app.dock.hide();
  }
  
  // Disable default menu
  Menu.setApplicationMenu(null);
  
  // Log startup
  console.log(`Work Tracker started at ${new Date().toISOString()}`);
  console.log(`App path: ${__dirname}`);
}

// When running from terminal, show a message
if (process.stdout.isTTY) {
  console.log('Work Tracker is running in the background.');
  console.log('Check your system tray/menu bar for the app icon.');
}