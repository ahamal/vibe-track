// workTracker.test.js - Tests for work tracking functionality
const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => os.tmpdir())
  }
}));

// Mock config
jest.mock('../config', () => ({
  config: {
    getAll: jest.fn(() => ({
      productiveApps: ['VSCode', 'Terminal', 'Sublime Text'],
      productiveWebsites: ['github.com', 'stackoverflow.com', 'claude.ai'],
      dailyGoalMinutes: 480,
      afkThresholdSeconds: 180,
      trackingIntervalSeconds: 30,
      projectKeywords: {},
      notifications: {
        breakReminders: true,
        dailySummary: true,
        dailySummaryTime: '18:00'
      }
    }))
  }
}));

// Mock database (not available in tests)
jest.mock('../database', () => ({
  db: {
    isAvailable: jest.fn(() => false),
    initialized: false
  }
}));

const { isProductiveWork, getDailyGoalProgress } = require('../workTracker');

describe('workTracker', () => {
  describe('isProductiveWork()', () => {
    test('returns true for productive apps', () => {
      expect(isProductiveWork('App: VSCode, Window: test.js')).toBe(true);
      expect(isProductiveWork('App: Terminal, Window: bash')).toBe(true);
      expect(isProductiveWork('App: Sublime Text, Window: file.py')).toBe(true);
    });

    test('returns false for non-productive apps', () => {
      expect(isProductiveWork('App: Slack, Window: Chat')).toBe(false);
      expect(isProductiveWork('App: Messages, Window: Conversation')).toBe(false);
    });

    test('returns true for browsers with productive websites', () => {
      expect(isProductiveWork('App: Google Chrome, Window: GitHub - repo')).toBe(true);
      expect(isProductiveWork('App: Safari, Window: stackoverflow.com - Question')).toBe(true);
      expect(isProductiveWork('App: Firefox, Window: claude.ai - Chat')).toBe(true);
    });

    test('returns false for browsers with non-productive websites', () => {
      expect(isProductiveWork('App: Google Chrome, Window: YouTube - Video')).toBe(false);
      expect(isProductiveWork('App: Safari, Window: Netflix')).toBe(false);
    });

    test('handles Edge and Brave browsers', () => {
      expect(isProductiveWork('App: Edge, Window: github.com - repo')).toBe(true);
      expect(isProductiveWork('App: Brave, Window: stackoverflow.com')).toBe(true);
    });
  });

  describe('getDailyGoalProgress()', () => {
    test('calculates percentage correctly', () => {
      // 480 minutes = 28800 seconds is 100%
      const result = getDailyGoalProgress(14400); // 4 hours = 50%
      expect(result.percentage).toBe(50);
      expect(result.isComplete).toBe(false);
    });

    test('caps percentage at 100', () => {
      const result = getDailyGoalProgress(36000); // 10 hours = 125%, should cap at 100
      expect(result.percentage).toBe(100);
      expect(result.isComplete).toBe(true);
    });

    test('calculates remaining time correctly', () => {
      const result = getDailyGoalProgress(14400); // 4 hours worked
      // Goal is 8 hours, so 4 hours remaining = 14400 seconds
      expect(result.remainingSeconds).toBe(14400);
    });

    test('formats remaining time correctly', () => {
      // 2 hours remaining
      const result1 = getDailyGoalProgress(21600); // 6 hours = 21600 seconds
      expect(result1.remainingFormatted).toBe('2h 0m');

      // Less than an hour remaining
      const result2 = getDailyGoalProgress(27000); // 7.5 hours = 27000 seconds
      expect(result2.remainingFormatted).toBe('30m');
    });

    test('returns zero remaining when goal is complete', () => {
      const result = getDailyGoalProgress(36000);
      expect(result.remainingSeconds).toBe(0);
      expect(result.isComplete).toBe(true);
    });

    test('returns goal minutes', () => {
      const result = getDailyGoalProgress(0);
      expect(result.goalMinutes).toBe(480);
    });
  });
});

describe('workTracker - analyzeWorkTime', () => {
  let testLogDir;
  let testLogPath;

  beforeEach(() => {
    // Create a temporary log directory
    testLogDir = path.join(os.tmpdir(), '.worktracker-test-' + Date.now());
    fs.mkdirSync(testLogDir, { recursive: true });
    testLogPath = path.join(testLogDir, 'activity_log.txt');
  });

  afterEach(() => {
    // Clean up
    if (fs.existsSync(testLogDir)) {
      fs.rmSync(testLogDir, { recursive: true, force: true });
    }
  });

  test('analyzes work time from log file', async () => {
    const { analyzeWorkTime } = require('../workTracker');
    const today = new Date().toISOString().split('T')[0];

    // Create test log entries for today
    const entries = [
      `${today}T09:00:00.000Z: App: VSCode, Window: test.js`,
      `${today}T09:30:00.000Z: App: VSCode, Window: test.js`,
      `${today}T10:00:00.000Z: App: VSCode, Window: test.js`,
      `${today}T10:30:00.000Z: App: Slack, Window: Chat`,
      `${today}T11:00:00.000Z: App: VSCode, Window: test.js`
    ];

    fs.writeFileSync(testLogPath, entries.join('\n') + '\n');

    const result = await analyzeWorkTime(testLogPath, today);

    expect(result.date).toBe(today);
    expect(result.totalWorkTime).toBeDefined();
    expect(result.sessionsCount).toBeGreaterThanOrEqual(1);
  });

  test('handles AFK markers correctly', async () => {
    const { analyzeWorkTime } = require('../workTracker');
    const today = new Date().toISOString().split('T')[0];

    const entries = [
      `${today}T09:00:00.000Z: App: VSCode, Window: test.js`,
      `${today}T09:30:00.000Z: App: VSCode, Window: test.js`,
      `${today}T10:00:00.000Z: --- AFK START ---`,
      `${today}T10:30:00.000Z: --- AFK END ---`,
      `${today}T11:00:00.000Z: App: VSCode, Window: test.js`
    ];

    fs.writeFileSync(testLogPath, entries.join('\n') + '\n');

    const result = await analyzeWorkTime(testLogPath, today);

    // Work time should not include the AFK period
    expect(result.totalWorkTime.totalSeconds).toBeLessThan(7200); // Less than 2 hours total elapsed
  });

  test('returns zero work time for non-existent date', async () => {
    const { analyzeWorkTime } = require('../workTracker');

    // Create log with entries for a different date
    fs.writeFileSync(testLogPath, `2020-01-01T09:00:00.000Z: App: VSCode, Window: test.js\n`);

    const result = await analyzeWorkTime(testLogPath, '2024-01-15');

    expect(result.totalWorkTime.totalSeconds).toBe(0);
    expect(result.sessionsCount).toBe(0);
  });

  test('formats work time correctly', async () => {
    const { analyzeWorkTime } = require('../workTracker');
    const today = new Date().toISOString().split('T')[0];

    const entries = [
      `${today}T09:00:00.000Z: App: VSCode, Window: test.js`,
      `${today}T11:00:00.000Z: App: VSCode, Window: test.js`
    ];

    fs.writeFileSync(testLogPath, entries.join('\n') + '\n');

    const result = await analyzeWorkTime(testLogPath, today);

    // Check that formatted time strings exist
    expect(result.formattedWorkTime).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(result.shortFormattedWorkTime).toMatch(/^\d+h \d+m$/);
  });
});

describe('workTracker - getWorkSummary', () => {
  let testLogDir;
  let testLogPath;

  beforeEach(() => {
    testLogDir = path.join(os.tmpdir(), '.worktracker-summary-test-' + Date.now());
    fs.mkdirSync(testLogDir, { recursive: true });
    testLogPath = path.join(testLogDir, 'activity_log.txt');
  });

  afterEach(() => {
    if (fs.existsSync(testLogDir)) {
      fs.rmSync(testLogDir, { recursive: true, force: true });
    }
  });

  test('returns summaries for multiple days', async () => {
    const { getWorkSummary } = require('../workTracker');

    // Create entries for multiple days
    const entries = [];
    for (let i = 0; i < 3; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      entries.push(`${dateStr}T09:00:00.000Z: App: VSCode, Window: test.js`);
      entries.push(`${dateStr}T10:00:00.000Z: App: VSCode, Window: test.js`);
    }

    fs.writeFileSync(testLogPath, entries.join('\n') + '\n');

    const summaries = await getWorkSummary(testLogPath, 3);

    expect(summaries.length).toBe(3);
    summaries.forEach(summary => {
      expect(summary.date).toBeDefined();
      expect(summary.totalWorkTime).toBeDefined();
    });
  });
});
