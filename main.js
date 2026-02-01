// main.js - Main entry point for the Work Tracker app
const electron = require('electron');
const app = electron.app;
const Menu = electron.Menu;
const BrowserWindow = electron.BrowserWindow;
const ipcMain = electron.ipcMain;
const dialog = electron.dialog;
const path = require('path');

// Import modules
const { config } = require('./config');
const { db } = require('./database');
const { notifications } = require('./notifications');
const { projects } = require('./projects');
const { exporter } = require('./exporter');
const activityTracker = require('./activityTracker');
const workTracker = require('./workTracker');

// Windows
let settingsWindow = null;
let statsWindow = null;

// Prevent multiple instances of the app
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('Another instance is already running. Quitting...');
  app.quit();
} else {
  // Initialize configuration
  config.load();

  // Initialize database
  if (db.isAvailable()) {
    db.init();
    // Migrate from text log if needed
    const logFilePath = activityTracker.getLogFilePath();
    if (logFilePath) {
      db.migrateFromTextLog(logFilePath);
    }
  }

  // Initialize notifications
  notifications.init();

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

// IPC Handlers for Settings Window
ipcMain.handle('get-config', () => {
  return config.getAll();
});

ipcMain.handle('save-config', (event, newConfig) => {
  const success = config.update(newConfig);
  if (success) {
    // Invalidate project keyword cache
    projects.invalidateCache();
    // Reinitialize notifications with new settings
    notifications.init();
  }
  return success;
});

ipcMain.handle('reset-config', () => {
  config.reset();
  return config.getAll();
});

// IPC Handlers for Stats Window
ipcMain.handle('get-stats', async (event, { startDate, endDate }) => {
  const cfg = config.getAll();
  const today = new Date().toISOString().split('T')[0];

  // Get today's data
  let todayData = { totalWorkSeconds: 0, sessionsCount: 0, streak: 0 };

  if (db.isAvailable() && db.initialized) {
    const todaySummary = db.getDailySummary(today);
    if (todaySummary) {
      todayData = {
        totalWorkSeconds: todaySummary.total_work_seconds || 0,
        sessionsCount: todaySummary.sessions_count || 0,
        streak: calculateStreak()
      };
    } else {
      // Calculate from activity log
      const calculated = db.calculateWorkTimeForDate(today, cfg.productiveApps, cfg.productiveWebsites);
      if (calculated) {
        todayData = {
          totalWorkSeconds: calculated.totalWorkSeconds,
          sessionsCount: calculated.sessionsCount,
          streak: calculateStreak()
        };
      }
    }
  } else {
    // Fallback to text log
    try {
      const logFilePath = activityTracker.getLogFilePath();
      const result = await workTracker.analyzeWorkTime(logFilePath, today);
      todayData = {
        totalWorkSeconds: result.totalWorkTime.totalSeconds,
        sessionsCount: result.sessionsCount,
        streak: 0
      };
    } catch (e) {
      // No data
    }
  }

  // Get daily summaries for range
  let dailySummaries = [];
  if (db.isAvailable() && db.initialized) {
    dailySummaries = db.getDailySummariesForRange(startDate, endDate);
  }

  // Get project stats
  let projectStats = {};
  if (db.isAvailable() && db.initialized) {
    projectStats = db.getProjectStats(startDate, endDate);
  }

  // Calculate summary
  const totalWorkSeconds = dailySummaries.reduce((sum, d) => sum + (d.total_work_seconds || 0), 0);
  const totalSessions = dailySummaries.reduce((sum, d) => sum + (d.sessions_count || 0), 0);
  const daysWithData = dailySummaries.filter(d => d.total_work_seconds > 0).length;
  const avgDailySeconds = daysWithData > 0 ? totalWorkSeconds / daysWithData : 0;
  const goalSeconds = cfg.dailyGoalMinutes * 60;
  const goalsReached = dailySummaries.filter(d => (d.total_work_seconds || 0) >= goalSeconds).length;

  return {
    today: todayData,
    config: cfg,
    dailySummaries,
    projectStats,
    summary: {
      totalWorkSeconds,
      totalSessions,
      avgDailySeconds,
      goalsReached
    }
  };
});

// IPC Handler for hourly stats (24-hour heatmap)
ipcMain.handle('get-hourly-stats', async (event, { date }) => {
  const hourlyMinutes = Array(24).fill(0);

  if (!db.isAvailable() || !db.initialized) {
    return hourlyMinutes;
  }

  const cfg = config.getAll();
  const activities = db.getActivityForDate(date);

  if (activities.length === 0) {
    return hourlyMinutes;
  }

  let isAfk = false;
  let sessionStart = null;

  for (const activity of activities) {
    const timestamp = new Date(activity.timestamp);

    if (activity.is_afk) {
      if (activity.afk_type === 'start') {
        if (sessionStart && !isAfk) {
          addTimeToHours(hourlyMinutes, sessionStart, timestamp);
        }
        sessionStart = null;
        isAfk = true;
      } else if (activity.afk_type === 'end') {
        isAfk = false;
      }
      continue;
    }

    if (isAfk) continue;

    const isProductive = db.isProductiveActivity(
      activity.app_name, activity.window_title,
      cfg.productiveApps, cfg.productiveWebsites
    );

    if (isProductive) {
      if (!sessionStart) {
        sessionStart = timestamp;
      }
    } else if (sessionStart) {
      addTimeToHours(hourlyMinutes, sessionStart, timestamp);
      sessionStart = null;
    }
  }

  // Handle ongoing session
  if (sessionStart && !isAfk) {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    if (date === todayStr) {
      addTimeToHours(hourlyMinutes, sessionStart, now);
    }
  }

  return hourlyMinutes;
});

// Helper: Add time between start and end to hourly buckets
function addTimeToHours(hourlyMinutes, start, end) {
  let current = new Date(start);
  while (current < end) {
    const hour = current.getHours();
    const endOfHour = new Date(current);
    endOfHour.setMinutes(59, 59, 999);

    const segmentEnd = endOfHour < end ? endOfHour : end;
    const minutes = (segmentEnd - current) / 60000;
    hourlyMinutes[hour] += Math.round(minutes);

    current = new Date(endOfHour.getTime() + 1);
  }
}

// Calculate streak (days in a row where goal was reached)
function calculateStreak() {
  if (!db.isAvailable() || !db.initialized) return 0;

  const cfg = config.getAll();
  const goalSeconds = cfg.dailyGoalMinutes * 60;
  let streak = 0;
  let date = new Date();

  while (true) {
    const dateStr = date.toISOString().split('T')[0];
    const summary = db.getDailySummary(dateStr);

    if (summary && (summary.total_work_seconds || 0) >= goalSeconds) {
      streak++;
      date.setDate(date.getDate() - 1);
    } else {
      break;
    }

    // Safety limit
    if (streak > 365) break;
  }

  return streak;
}

// IPC Handler for export
ipcMain.handle('export-data', async (event, { format, startDate, endDate }) => {
  const defaultPath = exporter.generateFilename(
    format === 'csv' ? 'sessions' : 'full',
    startDate,
    endDate,
    format
  );

  const result = await dialog.showSaveDialog({
    defaultPath,
    filters: format === 'csv' ?
      [{ name: 'CSV Files', extensions: ['csv'] }] :
      [{ name: 'JSON Files', extensions: ['json'] }]
  });

  if (result.canceled) {
    return { success: false, canceled: true };
  }

  try {
    if (format === 'csv') {
      return await exporter.exportToCSV(startDate, endDate, result.filePath);
    } else {
      return await exporter.exportToJSON(startDate, endDate, result.filePath);
    }
  } catch (error) {
    throw error;
  }
});

// Open Settings Window
function openSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 650,
    height: 700,
    title: 'Settings',
    resizable: true,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  settingsWindow.loadFile(path.join(__dirname, 'settings', 'settings.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// Open Stats Window
function openStatsWindow() {
  if (statsWindow) {
    statsWindow.focus();
    return;
  }

  statsWindow = new BrowserWindow({
    width: 950,
    height: 800,
    title: 'Work Statistics',
    resizable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  statsWindow.loadFile(path.join(__dirname, 'stats', 'stats.html'));

  statsWindow.on('closed', () => {
    statsWindow = null;
  });
}

// Export functions for menubar
module.exports = {
  openSettingsWindow,
  openStatsWindow
};
