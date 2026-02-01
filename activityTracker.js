// activityTracker.js - Module to record user activity
const path = require('path');
const os = require('os');
const { config } = require('./config');
const { db } = require('./database');
const { projects } = require('./projects');
const { detector } = require('./crossPlatform');

// State
let isAFK = false;
let trackingInterval = null;
let cfg = null;

// Get the data directory path (for legacy compatibility)
function getDataDir() {
  return path.join(os.homedir(), '.worktracker');
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

// Log activity to database
async function logActivity() {
  if (!cfg) loadConfig();

  // Ensure database is initialized
  if (!db.isAvailable()) {
    console.error('Database not available for logging');
    return;
  }
  if (!db.initialized && !db.init()) {
    console.error('Failed to initialize database');
    return;
  }

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
        db.logActivity(timestamp, null, null, true, 'start', null);
      }
      return; // Skip logging if user is AFK
    } else if (isAFK) {
      // User returned from being AFK
      isAFK = false;
      const timestamp = new Date().toISOString();
      console.log(`${timestamp}: User returned from AFK`);
      db.logActivity(timestamp, null, null, true, 'end', null);
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
    db.logActivity(timestamp, appName, windowTitle, false, null, project);

    console.log(`${timestamp}: App: ${appName}, Window: ${windowTitle}`);
  } catch (error) {
    console.error('Error logging activity:', error);
  }
}

// Start tracking function
function startTracking() {
  // Load config
  loadConfig();

  // Ensure database is initialized
  if (db.isAvailable() && !db.initialized) {
    db.init();
  }

  // Only start if not already running
  if (!trackingInterval) {
    // Run immediately once
    logActivity();

    // Then set up interval
    const intervalSeconds = getTrackingInterval();
    trackingInterval = setInterval(logActivity, intervalSeconds * 1000);

    const idleThreshold = getIdleThreshold();
    console.log(`Activity tracking started. Checking every ${intervalSeconds} seconds with AFK threshold set to ${idleThreshold} seconds (${idleThreshold / 60} minutes).`);
    console.log(`Data stored in: ${getDataDir()}`);

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

// Get log file path (legacy - returns data directory for compatibility)
function getLogFilePath() {
  return path.join(getDataDir(), 'activity_log.txt');
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
