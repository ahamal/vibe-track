// exporter.js - CSV/JSON export functionality
const fs = require('fs');
const path = require('path');
const { db } = require('./database');
const { projects } = require('./projects');

class Exporter {
  // Export work sessions to CSV
  exportToCSV(startDate, endDate, filePath) {
    return new Promise((resolve, reject) => {
      try {
        const sessions = db.getSessionsForDateRange(startDate, endDate);

        if (sessions.length === 0) {
          reject(new Error('No data to export for the specified date range'));
          return;
        }

        // CSV header
        let csv = 'Date,Start Time,End Time,Duration (minutes),Duration (formatted),Project\n';

        // Add each session
        for (const session of sessions) {
          const startTime = new Date(session.start_time);
          const endTime = session.end_time ? new Date(session.end_time) : null;
          const durationMinutes = session.duration_seconds ? Math.round(session.duration_seconds / 60) : 0;
          const durationFormatted = this.formatDuration(session.duration_seconds || 0);
          const project = session.project || 'Uncategorized';

          const row = [
            startTime.toISOString().split('T')[0],
            startTime.toISOString(),
            endTime ? endTime.toISOString() : '',
            durationMinutes,
            durationFormatted,
            this.escapeCSV(project)
          ];

          csv += row.join(',') + '\n';
        }

        // Write file
        fs.writeFileSync(filePath, csv, 'utf8');
        resolve({
          success: true,
          path: filePath,
          recordCount: sessions.length
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  // Export all data to JSON
  exportToJSON(startDate, endDate, filePath) {
    return new Promise((resolve, reject) => {
      try {
        // Get all data
        const sessions = db.getSessionsForDateRange(startDate, endDate);
        const activities = db.getActivityForDateRange(startDate, endDate);
        const dailySummaries = db.getDailySummariesForRange(startDate, endDate);
        const projectStats = db.getProjectStats(startDate, endDate);

        const data = {
          exportInfo: {
            exportedAt: new Date().toISOString(),
            startDate,
            endDate,
            version: '2.0.0'
          },
          summary: {
            totalSessions: sessions.length,
            totalActivityEntries: activities.length,
            totalDays: dailySummaries.length,
            projectBreakdown: projectStats
          },
          dailySummaries: dailySummaries.map(summary => ({
            date: summary.date,
            totalWorkSeconds: summary.total_work_seconds,
            totalWorkFormatted: this.formatDuration(summary.total_work_seconds || 0),
            goalSeconds: summary.goal_seconds,
            sessionsCount: summary.sessions_count,
            goalProgress: summary.goal_seconds ?
              Math.round((summary.total_work_seconds / summary.goal_seconds) * 100) : 0
          })),
          sessions: sessions.map(session => ({
            id: session.id,
            startTime: session.start_time,
            endTime: session.end_time,
            durationSeconds: session.duration_seconds,
            durationFormatted: this.formatDuration(session.duration_seconds || 0),
            project: session.project || 'Uncategorized'
          })),
          activities: activities.map(activity => ({
            timestamp: activity.timestamp,
            appName: activity.app_name,
            windowTitle: activity.window_title,
            isAfk: activity.is_afk === 1,
            afkType: activity.afk_type,
            project: activity.project
          }))
        };

        // Write file
        const json = JSON.stringify(data, null, 2);
        fs.writeFileSync(filePath, json, 'utf8');

        resolve({
          success: true,
          path: filePath,
          recordCount: {
            sessions: sessions.length,
            activities: activities.length,
            dailySummaries: dailySummaries.length
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  // Export daily summary to CSV
  exportDailySummaryToCSV(startDate, endDate, filePath) {
    return new Promise((resolve, reject) => {
      try {
        const summaries = db.getDailySummariesForRange(startDate, endDate);

        if (summaries.length === 0) {
          reject(new Error('No daily summary data to export'));
          return;
        }

        // CSV header
        let csv = 'Date,Total Work (seconds),Total Work (formatted),Goal (seconds),Sessions,Goal Progress (%)\n';

        for (const summary of summaries) {
          const row = [
            summary.date,
            summary.total_work_seconds || 0,
            this.formatDuration(summary.total_work_seconds || 0),
            summary.goal_seconds || 0,
            summary.sessions_count || 0,
            summary.goal_seconds ?
              Math.round(((summary.total_work_seconds || 0) / summary.goal_seconds) * 100) : 0
          ];

          csv += row.join(',') + '\n';
        }

        fs.writeFileSync(filePath, csv, 'utf8');
        resolve({
          success: true,
          path: filePath,
          recordCount: summaries.length
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  // Export project breakdown to CSV
  exportProjectBreakdownToCSV(startDate, endDate, filePath) {
    return new Promise((resolve, reject) => {
      try {
        const stats = db.getProjectStats(startDate, endDate);
        const formatted = projects.formatProjectStats(stats);

        if (formatted.length === 0) {
          reject(new Error('No project data to export'));
          return;
        }

        // CSV header
        let csv = 'Project,Total Work (seconds),Total Work (formatted),Session Count\n';

        for (const project of formatted) {
          const row = [
            this.escapeCSV(project.project),
            project.totalSeconds,
            project.formattedTime,
            project.sessionCount
          ];

          csv += row.join(',') + '\n';
        }

        fs.writeFileSync(filePath, csv, 'utf8');
        resolve({
          success: true,
          path: filePath,
          recordCount: formatted.length
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  // Helper: Format duration in seconds to human readable
  formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  // Helper: Escape CSV field
  escapeCSV(field) {
    if (field === null || field === undefined) {
      return '';
    }
    const str = String(field);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  // Generate suggested filename
  generateFilename(type, startDate, endDate, extension) {
    const dateRange = startDate === endDate ?
      startDate :
      `${startDate}_to_${endDate}`;
    return `worktracker_${type}_${dateRange}.${extension}`;
  }
}

// Singleton instance
const exporter = new Exporter();

module.exports = {
  Exporter,
  exporter
};
