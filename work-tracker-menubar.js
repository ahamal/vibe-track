const electron = require('electron');
const app = electron.app;
const Menu = electron.Menu;
const Tray = electron.Tray;
const nativeImage = electron.nativeImage;
const dialog = electron.dialog;
const path = require('path');
const fs = require('fs');

// Import activity tracker and work tracker modules
const activityTracker = require('./activityTracker');
const { analyzeWorkTime, getWorkSummary } = require('./workTracker');

let tray = null;
let isQuitting = false;

function createTray() {
  try {
    // Create a default icon (you can replace this with your own icon file)
    const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
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
  } catch (error) {
    console.error('Error creating tray:', error);
  }
}

// Function to update context menu with work data
function updateContextMenu(workData = null) {
  try {
    let template = [];
    
    // Work status item
    if (workData) {
      const { totalWorkTime, formattedWorkTime, shortFormattedWorkTime, sessionsCount } = workData;
      
      template = [
        { label: `Today: ${formattedWorkTime}`, enabled: false },
        { label: `Sessions: ${sessionsCount}`, enabled: false },
        { type: 'separator' }
      ];
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
      { label: 'Open Log File Location', click: openLogLocation },
      { type: 'separator' }
    );
    
    // Add remaining actions
    template = [
      ...template,
      { label: 'Refresh', click: updateWorkTime },
      { label: 'Weekly Summary', click: showWeeklySummary },
      { type: 'separator' },
      { label: 'Quit', click: () => { 
        isQuitting = true;
        app.quit(); 
      }}
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
  updateContextMenu();
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

// Function to show weekly summary
async function showWeeklySummary() {
  try {
    const logFilePath = activityTracker.getLogFilePath();
    
    // Check if file exists
    if (!fs.existsSync(logFilePath)) {
      dialog.showMessageBox({
        type: 'info',
        title: 'Work Time Tracker',
        message: 'No data available',
        detail: `Log file not found at ${logFilePath}`
      });
      return;
    }
    
    const results = await getWorkSummary(logFilePath, 7);
    
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
    
    // Format the summary text
    let summaryText = 'Work Time Summary:\n\n';
    
    results.forEach(result => {
      const dateObj = new Date(result.date);
      const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
      summaryText += `${dayName} (${result.date}): ${result.formattedWorkTime}\n`;
    });
    
    summaryText += `\nAverage daily work time: ${avgHours}h ${avgMinutes}m`;
    summaryText += `\n\nLog file location: ${logFilePath}`;
    
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

// Function to update the work time in the menu bar
async function updateWorkTime() {
  try {
    const logFilePath = activityTracker.getLogFilePath();
    
    // Check if file exists
    if (!fs.existsSync(logFilePath)) {
      if (tray) {
        tray.setTitle('Work: No data');
        updateContextMenu();
      }
      return;
    }
    
    const result = await analyzeWorkTime(logFilePath);
    if (tray) {
      tray.setTitle(`Work: ${result.shortFormattedWorkTime}`);
      updateContextMenu(result);
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
app.on('ready', function() {
  setTimeout(createTray, 100); // Small delay to ensure app is fully initialized
});

app.on('window-all-closed', function() {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', function() {
  // Stop activity tracking before quitting
  if (activityTracker.isTracking()) {
    activityTracker.stopTracking();
  }
  
  if (tray) {
    tray.destroy();
  }
});

app.on('before-quit', function() {
  isQuitting = true;
});

// Export for testing
module.exports = {
  createTray,
  updateWorkTime
};