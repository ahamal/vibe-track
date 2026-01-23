// activityTracker.js - Module to record user activity
const fs = require('fs');
const path = require('path');
const os = require('os');
const { config } = require('./config');
const { db } = require('./database');
const { projects } = require('./projects');
const { detector } = require('./crossPlatform');

// State
let isAFK = false;
let trackingInterval = null;
let logFilePath = null;
let cfg = null;

// Set up the log file path in user's home directory
function setupLogFile() {
  const homeDir = os.homedir();
  const appDataDir = path.join(homeDir, '.worktracker');

  // Create app data directory if it doesn't exist
  if (!fs.existsSync(appDataDir)) {
    fs.mkdirSync(appDataDir, { recursive: true });
  }

  logFilePath = path.join(appDataDir, 'activity_log.txt');
  return logFilePath;
}

// Load configuration
function loadConfig() {
  cfg = config.getAll();
  return cfg;
}

// Get idle threshold from config
function getIdleThreshold() {
  if (!cfg) loadConfig();
  return cfg.afkThresholdSeconds || 180;
}

// Get tracking interval from config
function getTrackingInterval() {
  if (!cfg) loadConfig();
  return cfg.trackingIntervalSeconds || 30;
}

// Log activity to both text file and database
async function logActivity() {
  if (!logFilePath) {
    logFilePath = setupLogFile();
  }
  if (!cfg) loadConfig();

  try {
    // Check if user is idle
    const idleTimeSeconds = await detector.getIdleTime();
    const idleThreshold = getIdleThreshold();

    // Handle AFK status changes
    if (idleTimeSeconds > idleThreshold) {
      if (!isAFK) {
        isAFK = true;
        const timestamp = new Date().toISOString();
        console.log(`${timestamp}: User went AFK`);

        // Log to text file
        fs.appendFileSync(logFilePath, `${timestamp}: --- AFK START ---\n`);

        // Log to database
        if (db.isAvailable() && db.initialized) {
          db.logActivity(timestamp, null, null, true, 'start', null);
        }
      }
      return; // Skip logging if user is AFK
    } else if (isAFK) {
      // User returned from being AFK
      isAFK = false;
      const timestamp = new Date().toISOString();
      console.log(`${timestamp}: User returned from AFK`);

      // Log to text file
      fs.appendFileSync(logFilePath, `${timestamp}: --- AFK END ---\n`);

      // Log to database
      if (db.isAvailable() && db.initialized) {
        db.logActivity(timestamp, null, null, true, 'end', null);
      }
    }

    // User is active, log the current application
    const { appName } = await detector.getActiveApp();
    let windowTitle = 'Unknown Window';

    if (appName && !appName.includes('Finder') && !appName.includes('Dock')) {
      try {
        windowTitle = await detector.getWindowTitle(appName);
      } catch (e) {
        // Silently fail if we can't get window title
      }
    }

    // Detect project from window title
    const project = projects.detectProject(windowTitle, appName);

    const timestamp = new Date().toISOString();
    const logEntry = `${timestamp}: App: ${appName}, Window: ${windowTitle}\n`;

    // Log to text file
    fs.appendFileSync(logFilePath, logEntry);

    // Log to database
    if (db.isAvailable() && db.initialized) {
      db.logActivity(timestamp, appName, windowTitle, false, null, project);
    }

    console.log(logEntry.trim());
  } catch (error) {
    console.error('Error logging activity:', error);
  }
}

// Start tracking function
function startTracking() {
  // Setup log file first
  setupLogFile();

  // Load config
  loadConfig();

  // Only start if not already running
  if (!trackingInterval) {
    // Run immediately once
    logActivity();

    // Then set up interval
    const intervalSeconds = getTrackingInterval();
    trackingInterval = setInterval(logActivity, intervalSeconds * 1000);

    const idleThreshold = getIdleThreshold();
    console.log(`Activity tracking started. Checking every ${intervalSeconds} seconds with AFK threshold set to ${idleThreshold} seconds (${idleThreshold / 60} minutes).`);
    console.log(`Logging to: ${logFilePath}`);

    return true;
  }

  return false;
}

// Stop tracking function
function stopTracking() {
  if (trackingInterval) {
    clearInterval(trackingInterval);
    trackingInterval = null;
    console.log('Activity tracking stopped.');
    return true;
  }

  return false;
}

// Get log file path
function getLogFilePath() {
  if (!logFilePath) {
    logFilePath = setupLogFile();
  }
  return logFilePath;
}

// Check if currently AFK
function isUserAFK() {
  return isAFK;
}

// Reload configuration
function reloadConfig() {
  loadConfig();
  // Restart tracking if running to apply new interval
  if (trackingInterval) {
    stopTracking();
    startTracking();
  }
}

// Export functionality
module.exports = {
  startTracking,
  stopTracking,
  getLogFilePath,
  isTracking: () => !!trackingInterval,
  isUserAFK,
  reloadConfig
};
