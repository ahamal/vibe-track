// activityTracker.js - Module to record user activity
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Configuration
const IDLE_THRESHOLD = 3 * 60; // 3 minutes in seconds
const TRACKING_INTERVAL = 30; // Check every 30 seconds
let isAFK = false;
let trackingInterval = null;
let logFilePath = null;

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

// Function to get the currently active application on macOS
function getActiveApp() {
  return new Promise((resolve, reject) => {
    const script = `
      tell application "System Events"
        set frontApp to name of first application process whose frontmost is true
        return frontApp
      end tell
    `;
    
    exec(`osascript -e '${script}'`, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      
      const appName = stdout.trim();
      resolve({ appName });
    });
  });
}

// Function to get window title
function getWindowTitle(appName) {
  return new Promise((resolve, reject) => {
    const script = `
      tell application "${appName}"
        try
          set windowTitle to name of front window
        on error
          set windowTitle to "Unknown Window"
        end try
        return windowTitle
      end tell
    `;
    
    exec(`osascript -e '${script}'`, (error, stdout, stderr) => {
      if (error) {
        resolve("Unknown Window");
        return;
      }
      
      resolve(stdout.trim());
    });
  });
}

// Function to check idle time on macOS
function getIdleTime() {
  return new Promise((resolve, reject) => {
    // This uses the 'ioreg' command to get user idle time in nanoseconds
    exec('ioreg -c IOHIDSystem | grep HIDIdleTime', (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      
      // Extract the idle time value and convert from nanoseconds to seconds
      const match = stdout.match(/= ([0-9]+)/);
      if (match && match[1]) {
        const idleTimeNanos = parseInt(match[1], 10);
        const idleTimeSeconds = idleTimeNanos / 1000000000; // Convert to seconds
        resolve(idleTimeSeconds);
      } else {
        reject(new Error('Could not parse idle time'));
      }
    });
  });
}

// Log activity to a file only when user is active
async function logActivity() {
  if (!logFilePath) {
    logFilePath = setupLogFile();
  }
  
  try {
    // Check if user is idle
    const idleTimeSeconds = await getIdleTime();
    
    // Handle AFK status changes
    if (idleTimeSeconds > IDLE_THRESHOLD) {
      if (!isAFK) {
        isAFK = true;
        console.log(`${new Date().toISOString()}: User went AFK`);
        fs.appendFileSync(logFilePath, `${new Date().toISOString()}: --- AFK START ---\n`);
      }
      return; // Skip logging if user is AFK
    } else if (isAFK) {
      // User returned from being AFK
      isAFK = false;
      console.log(`${new Date().toISOString()}: User returned from AFK`);
      fs.appendFileSync(logFilePath, `${new Date().toISOString()}: --- AFK END ---\n`);
    }
    
    // User is active, log the current application
    const { appName } = await getActiveApp();
    let windowTitle = "Unknown Window";
    
    if (appName && !appName.includes("Finder") && !appName.includes("Dock")) {
      try {
        windowTitle = await getWindowTitle(appName);
      } catch (e) {
        // Silently fail if we can't get window title
      }
    }
    
    const timestamp = new Date().toISOString();
    const logEntry = `${timestamp}: App: ${appName}, Window: ${windowTitle}\n`;
    
    fs.appendFileSync(logFilePath, logEntry);
    console.log(logEntry.trim());
  } catch (error) {
    console.error('Error logging activity:', error);
  }
}

// Start tracking function
function startTracking() {
  // Setup log file first
  setupLogFile();
  
  // Only start if not already running
  if (!trackingInterval) {
    // Run immediately once
    logActivity();
    
    // Then set up interval
    trackingInterval = setInterval(logActivity, TRACKING_INTERVAL * 1000);
    console.log(`Activity tracking started. Checking every ${TRACKING_INTERVAL} seconds with AFK threshold set to ${IDLE_THRESHOLD} seconds (${IDLE_THRESHOLD/60} minutes).`);
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

// Export functionality
module.exports = {
  startTracking,
  stopTracking,
  getLogFilePath,
  isTracking: () => !!trackingInterval
};