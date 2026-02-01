const electron = require('electron');
const app = electron.app;
const Menu = electron.Menu;
const Tray = electron.Tray;
const nativeImage = electron.nativeImage;
const dialog = electron.dialog;
const path = require('path');
const fs = require('fs'); // Still needed for icon file check

// Import modules
const activityTracker = require('./activityTracker');
const { analyzeWorkTime, getWorkSummary, getDailyGoalProgress, updateDailySummaryInDB } = require('./workTracker');
const { config } = require('./config');
const { notifications } = require('./notifications');
const { projects } = require('./projects');
const { exporter } = require('./exporter');

let tray = null;
let isQuitting = false;
let lastWorkData = null;
let currentProject = 'Uncategorized';

function createTray() {
  try {
    // Create a default icon (you can replace this with your own icon file)
    const iconPath = path.join(__dirname, 'assets', 'icon.png');
    let icon;

    if (fs.existsSync(iconPath)) {
      icon = nativeImage.createFromPath(iconPath);
    } else {
      // Fallback to a simple icon if file doesn't exist
      icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
    }

    tray = new Tray(icon);

    // Set initial title
    tray.setTitle('Work: ...');

    // Start activity tracking
    activityTracker.startTracking();

    // Set up context menu
    updateContextMenu();

    // Update work time immediately and then periodically
    updateWorkTime();
    setInterval(updateWorkTime, 60000); // Update every minute

    // Set up daily summary notification callback
    notifications.onDailySummary = showDailySummaryNotification;
  } catch (error) {
    console.error('Error creating tray:', error);
  }
}

// Function to update context menu with work data
function updateContextMenu(workData = null) {
  try {
    let template = [];
    const cfg = config.getAll();

    // Work status item with goal progress
    if (workData) {
      const { totalWorkTime, formattedWorkTime, shortFormattedWorkTime, sessionsCount } = workData;
      const goalProgress = getDailyGoalProgress(totalWorkTime.totalSeconds);

      template = [
        { label: `Today: ${formattedWorkTime} (${goalProgress.percentage}%)`, enabled: false },
        { label: `Goal: ${Math.floor(cfg.dailyGoalMinutes / 60)}h ${cfg.dailyGoalMinutes % 60}m`, enabled: false },
        { label: `Sessions: ${sessionsCount}`, enabled: false }
      ];

      // Show remaining time if goal not complete
      if (!goalProgress.isComplete) {
        template.push({ label: `Remaining: ${goalProgress.remainingFormatted}`, enabled: false });
      } else {
        template.push({ label: 'Goal Complete!', enabled: false });
      }

      // Show current project if enabled
      if (cfg.ui && cfg.ui.showCurrentProject && currentProject !== 'Uncategorized') {
        template.push({ label: `Project: ${currentProject}`, enabled: false });
      }

      template.push({ type: 'separator' });
    } else {
      template = [
        { label: 'Work Status: Loading...', enabled: false },
        { type: 'separator' }
      ];
    }

    // Tracking status and control
    const trackingLabel = activityTracker.isTracking() ?
      'Activity Tracking: ON' :
      'Activity Tracking: OFF';

    const trackingToggleLabel = activityTracker.isTracking() ?
      'Stop Tracking' :
      'Start Tracking';

    template.push(
      { label: trackingLabel, enabled: false },
      { label: trackingToggleLabel, click: toggleTracking },
      { type: 'separator' }
    );

    // Add remaining actions
    template = [
      ...template,
      { label: 'View Statistics', click: openStatsWindow },
      { label: 'Weekly Summary', click: showWeeklySummary },
      { type: 'separator' },
      {
        label: 'Export Data',
        submenu: [
          { label: 'Export to CSV...', click: () => exportData('csv') },
          { label: 'Export to JSON...', click: () => exportData('json') }
        ]
      },
      { label: 'Open Log File Location', click: openLogLocation },
      { type: 'separator' },
      { label: 'Settings', click: openSettingsWindow },
      { label: 'Refresh', click: updateWorkTime },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ];

    const contextMenu = Menu.buildFromTemplate(template);
    if (tray) {
      tray.setContextMenu(contextMenu);
      tray.setToolTip('Work Time Tracker');
    }
  } catch (error) {
    console.error('Error updating context menu:', error);
  }
}

// Toggle activity tracking
function toggleTracking() {
  if (activityTracker.isTracking()) {
    activityTracker.stopTracking();
  } else {
    activityTracker.startTracking();
  }
  updateContextMenu(lastWorkData);
}

// Open log file location in file explorer
function openLogLocation() {
  const logFilePath = activityTracker.getLogFilePath();
  const logDir = path.dirname(logFilePath);

  // Use shell to open the folder
  electron.shell.openPath(logDir)
    .then(() => console.log(`Opened folder: ${logDir}`))
    .catch(error => {
      console.error('Error opening log location:', error);
      dialog.showErrorBox('Error', `Could not open log location: ${error.message}`);
    });
}

// Open Settings Window
function openSettingsWindow() {
  const main = require('./main');
  main.openSettingsWindow();
}

// Open Stats Window
function openStatsWindow() {
  const main = require('./main');
  main.openStatsWindow();
}

// Export data
async function exportData(format) {
  const today = new Date().toISOString().split('T')[0];
  const monthAgo = new Date();
  monthAgo.setDate(monthAgo.getDate() - 30);
  const startDate = monthAgo.toISOString().split('T')[0];

  const defaultPath = exporter.generateFilename(
    format === 'csv' ? 'sessions' : 'full',
    startDate,
    today,
    format
  );

  const result = await dialog.showSaveDialog({
    defaultPath,
    filters: format === 'csv' ?
      [{ name: 'CSV Files', extensions: ['csv'] }] :
      [{ name: 'JSON Files', extensions: ['json'] }]
  });

  if (result.canceled) return;

  try {
    let exportResult;
    if (format === 'csv') {
      exportResult = await exporter.exportToCSV(startDate, today, result.filePath);
    } else {
      exportResult = await exporter.exportToJSON(startDate, today, result.filePath);
    }

    dialog.showMessageBox({
      type: 'info',
      title: 'Export Complete',
      message: 'Data exported successfully',
      detail: `File saved to: ${exportResult.path}`
    });
  } catch (error) {
    dialog.showErrorBox('Export Error', error.message);
  }
}

// Function to show weekly summary
async function showWeeklySummary() {
  try {
    const results = await getWorkSummary(null, 7);

    if (results.length === 0) {
      dialog.showMessageBox({
        type: 'info',
        title: 'Weekly Summary',
        message: 'No work data available for the past week'
      });
      return;
    }

    // Calculate average
    const totalSeconds = results.reduce((total, day) => total + day.totalWorkTime.totalSeconds, 0);
    const avgSeconds = totalSeconds / results.length;
    const avgHours = Math.floor(avgSeconds / 3600);
    const avgMinutes = Math.floor((avgSeconds % 3600) / 60);

    // Get goal info
    const cfg = config.getAll();
    const goalMinutes = cfg.dailyGoalMinutes || 480;
    const goalSeconds = goalMinutes * 60;
    const goalsReached = results.filter(r => r.totalWorkTime.totalSeconds >= goalSeconds).length;

    // Format the summary text
    let summaryText = 'Work Time Summary:\n\n';

    results.forEach(result => {
      const dateObj = new Date(result.date);
      const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
      const goalProgress = getDailyGoalProgress(result.totalWorkTime.totalSeconds);
      const progressIndicator = goalProgress.isComplete ? ' [Goal Reached]' : '';
      summaryText += `${dayName} (${result.date}): ${result.formattedWorkTime}${progressIndicator}\n`;
    });

    summaryText += `\nAverage daily work time: ${avgHours}h ${avgMinutes}m`;
    summaryText += `\nGoals reached this week: ${goalsReached}/7`;

    dialog.showMessageBox({
      type: 'info',
      title: 'Weekly Summary',
      message: 'Your Work Time Summary',
      detail: summaryText
    });

  } catch (error) {
    console.error('Error getting weekly summary:', error);
    dialog.showMessageBox({
      type: 'error',
      title: 'Error',
      message: 'Could not retrieve weekly summary',
      detail: error.toString()
    });
  }
}

// Show daily summary notification
function showDailySummaryNotification() {
  if (!lastWorkData) return;

  const cfg = config.getAll();
  const goalMinutes = cfg.dailyGoalMinutes || 480;
  const actualMinutes = Math.round(lastWorkData.totalWorkTime.totalSeconds / 60);

  notifications.showDailySummary(
    lastWorkData.formattedWorkTime,
    goalMinutes,
    actualMinutes,
    lastWorkData.sessionsCount
  );
}

// Function to update the work time in the menu bar
async function updateWorkTime() {
  try {
    const cfg = config.getAll();

    // Get work time analysis from database (analyzeWorkTime no longer needs file path)
    const result = await analyzeWorkTime(null);
    lastWorkData = result;

    // Update daily summary in database
    const today = new Date().toISOString().split('T')[0];
    updateDailySummaryInDB(today, result.totalWorkTime.totalSeconds, result.sessionsCount);

    // Get goal progress
    const goalProgress = getDailyGoalProgress(result.totalWorkTime.totalSeconds);

    // Format menu bar title
    let menuBarTitle;
    if (cfg.ui && cfg.ui.showGoalProgress) {
      menuBarTitle = `Work: ${result.shortFormattedWorkTime} (${goalProgress.percentage}%)`;
    } else {
      menuBarTitle = `Work: ${result.shortFormattedWorkTime}`;
    }

    if (tray) {
      tray.setTitle(menuBarTitle);
      updateContextMenu(result);
    }

    // Track work activity for break reminders
    const isCurrentlyWorking = !activityTracker.isUserAFK() && activityTracker.isTracking();
    notifications.trackWorkActivity(isCurrentlyWorking);

    // Check if goal was just reached
    if (goalProgress.isComplete) {
      notifications.showGoalReached(result.formattedWorkTime, cfg.dailyGoalMinutes);
    }

  } catch (error) {
    console.error('Error updating work time:', error);
    if (tray) {
      tray.setTitle('Work: Error');
      updateContextMenu();
    }
  }
}

// App ready event
app.on('ready', function () {
  setTimeout(createTray, 100); // Small delay to ensure app is fully initialized
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', function () {
  // Stop activity tracking before quitting
  if (activityTracker.isTracking()) {
    activityTracker.stopTracking();
  }

  // Clean up notifications
  notifications.destroy();

  if (tray) {
    tray.destroy();
  }
});

app.on('before-quit', function () {
  isQuitting = true;
});

// Export for testing
module.exports = {
  createTray,
  updateWorkTime
};
