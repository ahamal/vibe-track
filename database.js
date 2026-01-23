// database.js - SQLite database layer for Work Tracker
const path = require('path');
const fs = require('fs');
const os = require('os');

let Database;
try {
  Database = require('better-sqlite3');
} catch (e) {
  console.warn('better-sqlite3 not available, database features disabled');
  Database = null;
}

class WorkTrackerDB {
  constructor() {
    this.dbDir = path.join(os.homedir(), '.worktracker');
    this.dbPath = path.join(this.dbDir, 'worktracker.db');
    this.db = null;
    this.initialized = false;
  }

  // Initialize the database
  init() {
    if (this.initialized) return true;
    if (!Database) {
      console.error('SQLite not available');
      return false;
    }

    try {
      // Ensure directory exists
      if (!fs.existsSync(this.dbDir)) {
        fs.mkdirSync(this.dbDir, { recursive: true });
      }

      // Open database
      this.db = new Database(this.dbPath);

      // Enable WAL mode for better performance
      this.db.pragma('journal_mode = WAL');

      // Create tables
      this.createTables();

      this.initialized = true;
      return true;
    } catch (error) {
      console.error('Error initializing database:', error);
      return false;
    }
  }

  // Create database tables
  createTables() {
    // Activity log table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        app_name TEXT,
        window_title TEXT,
        is_afk INTEGER DEFAULT 0,
        afk_type TEXT,
        project TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Work sessions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS work_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        start_time TEXT NOT NULL,
        end_time TEXT,
        duration_seconds INTEGER,
        project TEXT,
        is_productive INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Daily summary table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS daily_summary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT UNIQUE NOT NULL,
        total_work_seconds INTEGER DEFAULT 0,
        goal_seconds INTEGER,
        sessions_count INTEGER DEFAULT 0,
        productive_seconds INTEGER DEFAULT 0,
        projects_json TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Migration status table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS migration_status (
        id INTEGER PRIMARY KEY,
        migrated_at TEXT,
        log_file_path TEXT,
        entries_migrated INTEGER
      )
    `);

    // Create indexes for better query performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_activity_date ON activity_log(date(timestamp));
      CREATE INDEX IF NOT EXISTS idx_sessions_start ON work_sessions(start_time);
      CREATE INDEX IF NOT EXISTS idx_daily_date ON daily_summary(date);
    `);
  }

  // Log activity entry
  logActivity(timestamp, appName, windowTitle, isAfk = false, afkType = null, project = null) {
    if (!this.initialized && !this.init()) return null;

    try {
      const stmt = this.db.prepare(`
        INSERT INTO activity_log (timestamp, app_name, window_title, is_afk, afk_type, project)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(timestamp, appName, windowTitle, isAfk ? 1 : 0, afkType, project);
      return result.lastInsertRowid;
    } catch (error) {
      console.error('Error logging activity:', error);
      return null;
    }
  }

  // Get activity for a specific date
  getActivityForDate(date) {
    if (!this.initialized && !this.init()) return [];

    try {
      const stmt = this.db.prepare(`
        SELECT * FROM activity_log
        WHERE date(timestamp) = ?
        ORDER BY timestamp ASC
      `);
      return stmt.all(date);
    } catch (error) {
      console.error('Error getting activity:', error);
      return [];
    }
  }

  // Get activity for date range
  getActivityForDateRange(startDate, endDate) {
    if (!this.initialized && !this.init()) return [];

    try {
      const stmt = this.db.prepare(`
        SELECT * FROM activity_log
        WHERE date(timestamp) >= ? AND date(timestamp) <= ?
        ORDER BY timestamp ASC
      `);
      return stmt.all(startDate, endDate);
    } catch (error) {
      console.error('Error getting activity range:', error);
      return [];
    }
  }

  // Start a work session
  startSession(startTime, project = null) {
    if (!this.initialized && !this.init()) return null;

    try {
      const stmt = this.db.prepare(`
        INSERT INTO work_sessions (start_time, project)
        VALUES (?, ?)
      `);
      const result = stmt.run(startTime, project);
      return result.lastInsertRowid;
    } catch (error) {
      console.error('Error starting session:', error);
      return null;
    }
  }

  // End a work session
  endSession(sessionId, endTime, durationSeconds) {
    if (!this.initialized && !this.init()) return false;

    try {
      const stmt = this.db.prepare(`
        UPDATE work_sessions
        SET end_time = ?, duration_seconds = ?
        WHERE id = ?
      `);
      stmt.run(endTime, durationSeconds, sessionId);
      return true;
    } catch (error) {
      console.error('Error ending session:', error);
      return false;
    }
  }

  // Get sessions for a specific date
  getSessionsForDate(date) {
    if (!this.initialized && !this.init()) return [];

    try {
      const stmt = this.db.prepare(`
        SELECT * FROM work_sessions
        WHERE date(start_time) = ?
        ORDER BY start_time ASC
      `);
      return stmt.all(date);
    } catch (error) {
      console.error('Error getting sessions:', error);
      return [];
    }
  }

  // Get sessions for date range
  getSessionsForDateRange(startDate, endDate) {
    if (!this.initialized && !this.init()) return [];

    try {
      const stmt = this.db.prepare(`
        SELECT * FROM work_sessions
        WHERE date(start_time) >= ? AND date(start_time) <= ?
        ORDER BY start_time ASC
      `);
      return stmt.all(startDate, endDate);
    } catch (error) {
      console.error('Error getting sessions range:', error);
      return [];
    }
  }

  // Update or create daily summary
  updateDailySummary(date, totalWorkSeconds, goalSeconds, sessionsCount, productiveSeconds = null, projectsJson = null) {
    if (!this.initialized && !this.init()) return false;

    try {
      const stmt = this.db.prepare(`
        INSERT INTO daily_summary (date, total_work_seconds, goal_seconds, sessions_count, productive_seconds, projects_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(date) DO UPDATE SET
          total_work_seconds = excluded.total_work_seconds,
          goal_seconds = excluded.goal_seconds,
          sessions_count = excluded.sessions_count,
          productive_seconds = COALESCE(excluded.productive_seconds, productive_seconds),
          projects_json = COALESCE(excluded.projects_json, projects_json),
          updated_at = datetime('now')
      `);
      stmt.run(date, totalWorkSeconds, goalSeconds, sessionsCount, productiveSeconds, projectsJson);
      return true;
    } catch (error) {
      console.error('Error updating daily summary:', error);
      return false;
    }
  }

  // Get daily summary for a specific date
  getDailySummary(date) {
    if (!this.initialized && !this.init()) return null;

    try {
      const stmt = this.db.prepare(`
        SELECT * FROM daily_summary WHERE date = ?
      `);
      return stmt.get(date);
    } catch (error) {
      console.error('Error getting daily summary:', error);
      return null;
    }
  }

  // Get daily summaries for date range
  getDailySummariesForRange(startDate, endDate) {
    if (!this.initialized && !this.init()) return [];

    try {
      const stmt = this.db.prepare(`
        SELECT * FROM daily_summary
        WHERE date >= ? AND date <= ?
        ORDER BY date ASC
      `);
      return stmt.all(startDate, endDate);
    } catch (error) {
      console.error('Error getting daily summaries:', error);
      return [];
    }
  }

  // Get work time by project for date range
  getProjectStats(startDate, endDate) {
    if (!this.initialized && !this.init()) return {};

    try {
      const stmt = this.db.prepare(`
        SELECT project, SUM(duration_seconds) as total_seconds, COUNT(*) as session_count
        FROM work_sessions
        WHERE date(start_time) >= ? AND date(start_time) <= ?
        GROUP BY project
        ORDER BY total_seconds DESC
      `);
      const results = stmt.all(startDate, endDate);

      const stats = {};
      for (const row of results) {
        const projectName = row.project || 'Uncategorized';
        stats[projectName] = {
          totalSeconds: row.total_seconds,
          sessionCount: row.session_count
        };
      }
      return stats;
    } catch (error) {
      console.error('Error getting project stats:', error);
      return {};
    }
  }

  // Check if migration has been done
  isMigrated() {
    if (!this.initialized && !this.init()) return false;

    try {
      const stmt = this.db.prepare(`SELECT * FROM migration_status WHERE id = 1`);
      const result = stmt.get();
      return !!result;
    } catch (error) {
      return false;
    }
  }

  // Migrate data from text log file
  migrateFromTextLog(logFilePath) {
    if (!this.initialized && !this.init()) return false;
    if (this.isMigrated()) {
      console.log('Migration already completed');
      return true;
    }

    if (!fs.existsSync(logFilePath)) {
      console.log('No log file to migrate');
      return true;
    }

    console.log(`Migrating data from ${logFilePath}...`);

    try {
      const content = fs.readFileSync(logFilePath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());

      const insertActivity = this.db.prepare(`
        INSERT INTO activity_log (timestamp, app_name, window_title, is_afk, afk_type)
        VALUES (?, ?, ?, ?, ?)
      `);

      const insertMany = this.db.transaction((entries) => {
        for (const entry of entries) {
          insertActivity.run(entry.timestamp, entry.appName, entry.windowTitle, entry.isAfk, entry.afkType);
        }
      });

      const entries = [];
      for (const line of lines) {
        const entry = this.parseLogLine(line);
        if (entry) {
          entries.push(entry);
        }
      }

      insertMany(entries);

      // Mark migration as complete
      const markMigrated = this.db.prepare(`
        INSERT OR REPLACE INTO migration_status (id, migrated_at, log_file_path, entries_migrated)
        VALUES (1, datetime('now'), ?, ?)
      `);
      markMigrated.run(logFilePath, entries.length);

      console.log(`Migration complete: ${entries.length} entries migrated`);
      return true;
    } catch (error) {
      console.error('Error migrating data:', error);
      return false;
    }
  }

  // Parse a single log line from text file
  parseLogLine(line) {
    // Match timestamp at start of line
    const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z):/);
    if (!timestampMatch) return null;

    const timestamp = timestampMatch[1];

    // Check for AFK markers
    if (line.includes('AFK START')) {
      return { timestamp, appName: null, windowTitle: null, isAfk: 1, afkType: 'start' };
    }
    if (line.includes('AFK END')) {
      return { timestamp, appName: null, windowTitle: null, isAfk: 1, afkType: 'end' };
    }

    // Parse regular activity line
    const appMatch = line.match(/App: ([^,]+)/);
    const windowMatch = line.match(/Window: (.+)$/);

    if (appMatch) {
      return {
        timestamp,
        appName: appMatch[1].trim(),
        windowTitle: windowMatch ? windowMatch[1].trim() : null,
        isAfk: 0,
        afkType: null
      };
    }

    return null;
  }

  // Get total work time for a date from activity log
  calculateWorkTimeForDate(date, productiveApps, productiveWebsites) {
    if (!this.initialized && !this.init()) return null;

    try {
      const activities = this.getActivityForDate(date);
      if (activities.length === 0) return null;

      let totalWorkSeconds = 0;
      let isAfk = false;
      let lastTimestamp = null;
      let lastWasProductive = false;
      let sessionStart = null;
      const sessions = [];

      for (const activity of activities) {
        const timestamp = new Date(activity.timestamp);

        // Handle AFK
        if (activity.is_afk) {
          if (activity.afk_type === 'start') {
            // End current session if any
            if (sessionStart && !isAfk) {
              const duration = (timestamp - sessionStart) / 1000;
              if (duration > 0) {
                sessions.push({ start: sessionStart, end: timestamp, duration });
                totalWorkSeconds += duration;
              }
              sessionStart = null;
            }
            isAfk = true;
          } else if (activity.afk_type === 'end') {
            isAfk = false;
          }
          lastTimestamp = timestamp;
          continue;
        }

        if (isAfk) continue;

        // Check if productive
        const isProductive = this.isProductiveActivity(activity.app_name, activity.window_title, productiveApps, productiveWebsites);

        if (isProductive) {
          if (!sessionStart) {
            sessionStart = timestamp;
          }
        } else if (sessionStart) {
          // End productive session
          const duration = (timestamp - sessionStart) / 1000;
          if (duration > 0) {
            sessions.push({ start: sessionStart, end: timestamp, duration });
            totalWorkSeconds += duration;
          }
          sessionStart = null;
        }

        lastTimestamp = timestamp;
        lastWasProductive = isProductive;
      }

      // Handle ongoing session
      if (sessionStart && !isAfk) {
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];
        if (date === todayStr) {
          // Use current time for today
          const duration = (now - sessionStart) / 1000;
          if (duration > 0) {
            sessions.push({ start: sessionStart, end: now, duration });
            totalWorkSeconds += duration;
          }
        } else if (lastTimestamp) {
          // Use last timestamp for past days
          const duration = (lastTimestamp - sessionStart) / 1000;
          if (duration > 0) {
            sessions.push({ start: sessionStart, end: lastTimestamp, duration });
            totalWorkSeconds += duration;
          }
        }
      }

      return {
        totalWorkSeconds,
        sessions,
        sessionsCount: sessions.length
      };
    } catch (error) {
      console.error('Error calculating work time:', error);
      return null;
    }
  }

  // Check if an activity is productive
  isProductiveActivity(appName, windowTitle, productiveApps, productiveWebsites) {
    if (!appName) return false;

    // Check productive apps
    if (productiveApps.some(app => appName.includes(app))) {
      return true;
    }

    // Check browsers with productive websites
    const browsers = ['Safari', 'Google Chrome', 'Firefox', 'Chrome', 'Edge', 'Brave'];
    if (browsers.some(browser => appName.includes(browser))) {
      if (windowTitle) {
        return productiveWebsites.some(site => windowTitle.includes(site));
      }
    }

    return false;
  }

  // Close database connection
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
    }
  }

  // Check if database is available
  isAvailable() {
    return Database !== null;
  }
}

// Singleton instance
const dbInstance = new WorkTrackerDB();

module.exports = {
  WorkTrackerDB,
  db: dbInstance
};
