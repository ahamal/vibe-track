// database.test.js - Tests for SQLite database layer
const fs = require('fs');
const path = require('path');
const os = require('os');

// Check if better-sqlite3 is available
let Database;
let dbAvailable = false;
try {
  Database = require('better-sqlite3');
  dbAvailable = true;
} catch (e) {
  console.warn('better-sqlite3 not available, skipping database tests');
}

// Only run tests if database is available
const describeIfDb = dbAvailable ? describe : describe.skip;

describeIfDb('WorkTrackerDB', () => {
  const { WorkTrackerDB } = require('../database');
  let db;
  let testDbDir;

  beforeEach(() => {
    // Create a temporary database directory for testing
    testDbDir = path.join(os.tmpdir(), '.worktracker-db-test-' + Date.now());

    // Create a new database instance with custom paths
    db = new WorkTrackerDB();
    db.dbDir = testDbDir;
    db.dbPath = path.join(testDbDir, 'test.db');
  });

  afterEach(() => {
    // Close database and clean up
    if (db) {
      db.close();
    }
    if (fs.existsSync(testDbDir)) {
      fs.rmSync(testDbDir, { recursive: true, force: true });
    }
  });

  describe('init()', () => {
    test('creates database directory if it does not exist', () => {
      expect(fs.existsSync(testDbDir)).toBe(false);
      db.init();
      expect(fs.existsSync(testDbDir)).toBe(true);
    });

    test('creates database file', () => {
      db.init();
      expect(fs.existsSync(db.dbPath)).toBe(true);
    });

    test('creates required tables', () => {
      db.init();

      // Check that tables exist
      const tables = db.db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table'
      `).all();

      const tableNames = tables.map(t => t.name);
      expect(tableNames).toContain('activity_log');
      expect(tableNames).toContain('work_sessions');
      expect(tableNames).toContain('daily_summary');
      expect(tableNames).toContain('migration_status');
    });

    test('sets initialized flag to true', () => {
      expect(db.initialized).toBe(false);
      db.init();
      expect(db.initialized).toBe(true);
    });
  });

  describe('logActivity()', () => {
    beforeEach(() => {
      db.init();
    });

    test('logs activity entry', () => {
      const timestamp = new Date().toISOString();
      const id = db.logActivity(timestamp, 'VSCode', 'test.js', false, null, 'TestProject');

      expect(id).toBeDefined();
      expect(id).toBeGreaterThan(0);
    });

    test('logs AFK entry', () => {
      const timestamp = new Date().toISOString();
      const id = db.logActivity(timestamp, null, null, true, 'start', null);

      expect(id).toBeDefined();

      const entry = db.db.prepare('SELECT * FROM activity_log WHERE id = ?').get(id);
      expect(entry.is_afk).toBe(1);
      expect(entry.afk_type).toBe('start');
    });
  });

  describe('getActivityForDate()', () => {
    beforeEach(() => {
      db.init();
    });

    test('returns activities for specific date', () => {
      const today = new Date().toISOString().split('T')[0];
      const timestamp1 = new Date().toISOString();
      const timestamp2 = new Date().toISOString();

      db.logActivity(timestamp1, 'App1', 'Window1', false, null, null);
      db.logActivity(timestamp2, 'App2', 'Window2', false, null, null);

      const activities = db.getActivityForDate(today);
      expect(activities.length).toBe(2);
    });

    test('returns empty array for date with no activities', () => {
      const activities = db.getActivityForDate('2000-01-01');
      expect(activities).toEqual([]);
    });
  });

  describe('work sessions', () => {
    beforeEach(() => {
      db.init();
    });

    test('startSession creates a new session', () => {
      const startTime = new Date().toISOString();
      const id = db.startSession(startTime, 'TestProject');

      expect(id).toBeDefined();
      expect(id).toBeGreaterThan(0);
    });

    test('endSession updates session with end time and duration', () => {
      const startTime = new Date().toISOString();
      const id = db.startSession(startTime, 'TestProject');

      const endTime = new Date().toISOString();
      db.endSession(id, endTime, 3600);

      const session = db.db.prepare('SELECT * FROM work_sessions WHERE id = ?').get(id);
      expect(session.end_time).toBe(endTime);
      expect(session.duration_seconds).toBe(3600);
    });

    test('getSessionsForDate returns sessions', () => {
      const today = new Date().toISOString().split('T')[0];
      const startTime = new Date().toISOString();
      db.startSession(startTime, 'Project1');

      const sessions = db.getSessionsForDate(today);
      expect(sessions.length).toBe(1);
    });
  });

  describe('daily summary', () => {
    beforeEach(() => {
      db.init();
    });

    test('updateDailySummary creates new summary', () => {
      const date = '2024-01-15';
      db.updateDailySummary(date, 28800, 28800, 5);

      const summary = db.getDailySummary(date);
      expect(summary).toBeDefined();
      expect(summary.total_work_seconds).toBe(28800);
      expect(summary.sessions_count).toBe(5);
    });

    test('updateDailySummary updates existing summary', () => {
      const date = '2024-01-15';
      db.updateDailySummary(date, 14400, 28800, 2);
      db.updateDailySummary(date, 28800, 28800, 5);

      const summary = db.getDailySummary(date);
      expect(summary.total_work_seconds).toBe(28800);
      expect(summary.sessions_count).toBe(5);
    });

    test('getDailySummariesForRange returns summaries in range', () => {
      db.updateDailySummary('2024-01-10', 10000, 28800, 2);
      db.updateDailySummary('2024-01-11', 20000, 28800, 3);
      db.updateDailySummary('2024-01-12', 30000, 28800, 4);

      const summaries = db.getDailySummariesForRange('2024-01-10', '2024-01-12');
      expect(summaries.length).toBe(3);
    });
  });

  describe('project stats', () => {
    beforeEach(() => {
      db.init();
    });

    test('getProjectStats returns project breakdown', () => {
      const today = new Date().toISOString().split('T')[0];
      const startTime1 = new Date().toISOString();
      const id1 = db.startSession(startTime1, 'Project1');
      db.endSession(id1, new Date().toISOString(), 3600);

      const startTime2 = new Date().toISOString();
      const id2 = db.startSession(startTime2, 'Project2');
      db.endSession(id2, new Date().toISOString(), 7200);

      const stats = db.getProjectStats(today, today);
      expect(stats.Project1.totalSeconds).toBe(3600);
      expect(stats.Project2.totalSeconds).toBe(7200);
    });
  });

  describe('migration', () => {
    beforeEach(() => {
      db.init();
    });

    test('isMigrated returns false initially', () => {
      expect(db.isMigrated()).toBe(false);
    });

    test('migrateFromTextLog marks migration as complete', () => {
      // Create a test log file
      const logPath = path.join(testDbDir, 'test_log.txt');
      fs.writeFileSync(logPath, `${new Date().toISOString()}: App: VSCode, Window: test.js\n`);

      db.migrateFromTextLog(logPath);
      expect(db.isMigrated()).toBe(true);
    });

    test('parseLogLine parses regular activity', () => {
      const timestamp = '2024-01-15T10:30:00.000Z';
      const line = `${timestamp}: App: VSCode, Window: test.js`;

      const result = db.parseLogLine(line);
      expect(result.timestamp).toBe(timestamp);
      expect(result.appName).toBe('VSCode');
      expect(result.windowTitle).toBe('test.js');
      expect(result.isAfk).toBe(0);
    });

    test('parseLogLine parses AFK markers', () => {
      const timestamp = '2024-01-15T10:30:00.000Z';
      const line = `${timestamp}: --- AFK START ---`;

      const result = db.parseLogLine(line);
      expect(result.timestamp).toBe(timestamp);
      expect(result.isAfk).toBe(1);
      expect(result.afkType).toBe('start');
    });
  });

  describe('isProductiveActivity()', () => {
    beforeEach(() => {
      db.init();
    });

    test('identifies productive apps', () => {
      const productiveApps = ['VSCode', 'Terminal'];
      const productiveWebsites = ['github.com'];

      expect(db.isProductiveActivity('VSCode', 'test.js', productiveApps, productiveWebsites)).toBe(true);
      expect(db.isProductiveActivity('Terminal', 'bash', productiveApps, productiveWebsites)).toBe(true);
    });

    test('identifies productive browser activity', () => {
      const productiveApps = [];
      const productiveWebsites = ['github.com', 'stackoverflow.com'];

      expect(db.isProductiveActivity('Google Chrome', 'GitHub - repo', productiveApps, productiveWebsites)).toBe(true);
      expect(db.isProductiveActivity('Safari', 'stackoverflow.com - Question', productiveApps, productiveWebsites)).toBe(true);
    });

    test('identifies non-productive activity', () => {
      const productiveApps = ['VSCode'];
      const productiveWebsites = ['github.com'];

      expect(db.isProductiveActivity('Google Chrome', 'YouTube - Video', productiveApps, productiveWebsites)).toBe(false);
      expect(db.isProductiveActivity('Slack', 'Chat', productiveApps, productiveWebsites)).toBe(false);
    });
  });

  describe('close()', () => {
    test('closes database connection', () => {
      db.init();
      expect(db.initialized).toBe(true);

      db.close();
      expect(db.initialized).toBe(false);
      expect(db.db).toBeNull();
    });
  });
});

// Tests that don't require the database
describe('WorkTrackerDB availability', () => {
  const { WorkTrackerDB } = require('../database');

  test('isAvailable returns correct value', () => {
    const db = new WorkTrackerDB();
    expect(db.isAvailable()).toBe(dbAvailable);
  });
});
