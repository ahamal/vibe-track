// workTracker.js - Common module for work tracking functionality
const fs = require('fs');
const readline = require('readline');
const { config } = require('./config');
const { db } = require('./database');

// Get productive apps from config
function getProductiveApps() {
  const cfg = config.getAll();
  return cfg.productiveApps || [];
}

// Get productive websites from config
function getProductiveWebsites() {
  const cfg = config.getAll();
  return cfg.productiveWebsites || [];
}

// Function to check if a log entry is productive work
function isProductiveWork(entry) {
  const productiveApps = getProductiveApps();
  const productiveWebsites = getProductiveWebsites();

  // Check if it's a productive app
  if (productiveApps.some(app => entry.includes(`App: ${app}`))) {
    return true;
  }

  // Check if it's a browser with productive website
  if (entry.includes('App: Safari') ||
      entry.includes('App: Google Chrome') ||
      entry.includes('App: Firefox') ||
      entry.includes('App: Chrome') ||
      entry.includes('App: Edge') ||
      entry.includes('App: Brave')) {
    return productiveWebsites.some(site => entry.includes(site));
  }

  return false;
}

// Function to analyze work time from the log file
async function analyzeWorkTime(logFilePath, targetDate = null) {
  // Try database first
  if (db.isAvailable() && db.initialized) {
    const date = targetDate || new Date().toISOString().split('T')[0];
    const productiveApps = getProductiveApps();
    const productiveWebsites = getProductiveWebsites();

    const dbResult = db.calculateWorkTimeForDate(date, productiveApps, productiveWebsites);
    if (dbResult) {
      const hours = Math.floor(dbResult.totalWorkSeconds / 3600);
      const minutes = Math.floor((dbResult.totalWorkSeconds % 3600) / 60);
      const seconds = Math.floor(dbResult.totalWorkSeconds % 60);

      return {
        date,
        totalWorkTime: {
          hours,
          minutes,
          seconds,
          totalSeconds: dbResult.totalWorkSeconds
        },
        formattedWorkTime: `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`,
        shortFormattedWorkTime: `${hours}h ${minutes}m`,
        sessionsCount: dbResult.sessionsCount,
        sessions: dbResult.sessions.map(session => ({
          start: session.start.toISOString(),
          end: session.end.toISOString(),
          durationMinutes: Math.round(session.duration / 60)
        }))
      };
    }
  }

  // Fall back to text log parsing
  return analyzeWorkTimeFromTextLog(logFilePath, targetDate);
}

// Original text log parsing function
async function analyzeWorkTimeFromTextLog(logFilePath, targetDate = null) {
  return new Promise((resolve, reject) => {
    // Default to analyzing today if no date is provided
    const today = targetDate || new Date().toISOString().split('T')[0];

    // Prepare variables for tracking
    const workSessions = [];
    let isAFK = false;
    let currentSession = null;
    let totalWorkSeconds = 0;
    let lastTimestamp = null;
    let lastEntry = null;

    // Create read interface
    const fileStream = fs.createReadStream(logFilePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    // Process each line
    rl.on('line', (line) => {
      // Skip empty lines
      if (!line.trim()) return;

      // Extract timestamp and check if it's for the target date
      const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z):/);
      if (!timestampMatch) return;

      const timestamp = new Date(timestampMatch[1]);
      const entryDate = timestamp.toISOString().split('T')[0];

      // Skip entries not from the target date
      if (entryDate !== today) return;

      // Handle AFK markers
      if (line.includes('AFK START')) {
        // If we were in a work session, end it
        if (currentSession && !isAFK) {
          const sessionDuration = (timestamp - currentSession.start) / 1000; // in seconds

          if (sessionDuration > 0) {
            workSessions.push({
              start: currentSession.start,
              end: timestamp,
              duration: sessionDuration
            });

            totalWorkSeconds += sessionDuration;
          }

          currentSession = null;
        }

        isAFK = true;
        return;
      }

      if (line.includes('AFK END')) {
        isAFK = false;
        // Don't start a new session yet - wait for the next activity
        lastTimestamp = timestamp; // Update last timestamp to AFK END time
        return;
      }

      // Skip processing if user is AFK
      if (isAFK) return;

      // Check if this entry is productive work
      const isProductiveEntry = isProductiveWork(line);

      // Calculate time since last entry if we have one
      if (lastTimestamp) {
        // If previous entry was productive and this one is also productive
        if (isProductiveEntry && lastEntry && lastEntry.isProductive) {
          // Continue or start work session
          if (!currentSession) {
            currentSession = { start: lastTimestamp };
          }
        }
        // If we're switching from non-productive to productive
        else if (isProductiveEntry && lastEntry && !lastEntry.isProductive) {
          // Start a new work session
          currentSession = { start: timestamp };
        }
        // If we were productive but now on non-productive activity
        else if (!isProductiveEntry && lastEntry && lastEntry.isProductive && currentSession) {
          // End the work session
          const sessionDuration = (timestamp - currentSession.start) / 1000;

          if (sessionDuration > 0) {
            workSessions.push({
              start: currentSession.start,
              end: timestamp,
              duration: sessionDuration
            });

            totalWorkSeconds += sessionDuration;
          }

          currentSession = null;
        }
      } else if (isProductiveEntry) {
        // First entry of the day and it's productive work
        currentSession = { start: timestamp };
      }

      // Update last entry info
      lastTimestamp = timestamp;
      lastEntry = { timestamp, isProductive: isProductiveEntry };
    });

    // When finished reading the file
    rl.on('close', () => {
      // If we have an ongoing work session at the end of the log, close it with the last timestamp
      // BUT ONLY if the user is not AFK
      if (currentSession && lastTimestamp && !isAFK) {
        const sessionEnd = new Date(); // Use current time for live tracking
        const sessionDuration = (sessionEnd - currentSession.start) / 1000;

        if (sessionDuration > 0) {
          workSessions.push({
            start: currentSession.start,
            end: sessionEnd,
            duration: sessionDuration
          });

          totalWorkSeconds += sessionDuration;
        }
      }

      // Calculate hours, minutes, seconds
      const hours = Math.floor(totalWorkSeconds / 3600);
      const minutes = Math.floor((totalWorkSeconds % 3600) / 60);
      const seconds = Math.floor(totalWorkSeconds % 60);

      // Prepare results
      const results = {
        date: today,
        totalWorkTime: {
          hours,
          minutes,
          seconds,
          totalSeconds: totalWorkSeconds
        },
        formattedWorkTime: `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`,
        shortFormattedWorkTime: `${hours}h ${minutes}m`,
        sessionsCount: workSessions.length,
        sessions: workSessions.map(session => {
          return {
            start: session.start.toISOString(),
            end: session.end.toISOString(),
            durationMinutes: Math.round(session.duration / 60)
          };
        })
      };

      resolve(results);
    });

    // Handle errors
    rl.on('error', (err) => {
      reject(err);
    });
  });
}

// Function to get analysis for multiple days
async function getWorkSummary(logFilePath, days = 7) {
  try {
    const summaries = [];
    const today = new Date();

    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(today.getDate() - i);
      const dateString = date.toISOString().split('T')[0];

      const summary = await analyzeWorkTime(logFilePath, dateString);
      summaries.push(summary);
    }

    return summaries;
  } catch (error) {
    console.error('Error getting work summary:', error);
    return [];
  }
}

// Get daily goal progress
function getDailyGoalProgress(totalWorkSeconds) {
  const cfg = config.getAll();
  const goalMinutes = cfg.dailyGoalMinutes || 480;
  const goalSeconds = goalMinutes * 60;

  const percentage = Math.min(100, Math.round((totalWorkSeconds / goalSeconds) * 100));
  const remainingSeconds = Math.max(0, goalSeconds - totalWorkSeconds);

  const remainingHours = Math.floor(remainingSeconds / 3600);
  const remainingMinutes = Math.floor((remainingSeconds % 3600) / 60);

  return {
    percentage,
    goalMinutes,
    remainingSeconds,
    remainingFormatted: remainingHours > 0 ?
      `${remainingHours}h ${remainingMinutes}m` :
      `${remainingMinutes}m`,
    isComplete: totalWorkSeconds >= goalSeconds
  };
}

// Update daily summary in database
function updateDailySummaryInDB(date, totalWorkSeconds, sessionsCount) {
  if (!db.isAvailable() || !db.initialized) return;

  const cfg = config.getAll();
  const goalSeconds = cfg.dailyGoalMinutes * 60;

  db.updateDailySummary(date, totalWorkSeconds, goalSeconds, sessionsCount);
}

module.exports = {
  analyzeWorkTime,
  getWorkSummary,
  isProductiveWork,
  getDailyGoalProgress,
  updateDailySummaryInDB,
  getProductiveApps,
  getProductiveWebsites
};
