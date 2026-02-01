// workTracker.js - Common module for work tracking functionality
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

// Function to analyze work time from the database
async function analyzeWorkTime(logFilePath, targetDate = null) {
  const date = targetDate || new Date().toISOString().split('T')[0];
  const productiveApps = getProductiveApps();
  const productiveWebsites = getProductiveWebsites();

  // Ensure database is available
  if (!db.isAvailable()) {
    console.error('Database not available');
    return createEmptyResult(date);
  }
  if (!db.initialized && !db.init()) {
    console.error('Failed to initialize database');
    return createEmptyResult(date);
  }

  const dbResult = db.calculateWorkTimeForDate(date, productiveApps, productiveWebsites);
  if (!dbResult) {
    return createEmptyResult(date);
  }

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
    sessions: dbResult.sessions || []
  };
}

// Create an empty result for when there's no data
function createEmptyResult(date) {
  return {
    date,
    totalWorkTime: { hours: 0, minutes: 0, seconds: 0, totalSeconds: 0 },
    formattedWorkTime: '00:00:00',
    shortFormattedWorkTime: '0h 0m',
    sessionsCount: 0,
    sessions: []
  };
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
  getDailyGoalProgress,
  updateDailySummaryInDB,
  getProductiveApps,
  getProductiveWebsites
};

