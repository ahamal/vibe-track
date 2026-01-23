// projects.js - Project detection from window titles
const { config } = require('./config');
const { db } = require('./database');

class ProjectManager {
  constructor() {
    this.cachedKeywords = null;
    this.lastKeywordsLoad = null;
  }

  // Get project keywords (cached for performance)
  getKeywords() {
    const now = Date.now();
    // Refresh cache every 30 seconds
    if (!this.cachedKeywords || !this.lastKeywordsLoad || (now - this.lastKeywordsLoad) > 30000) {
      this.cachedKeywords = config.getProjectKeywords();
      this.lastKeywordsLoad = now;
    }
    return this.cachedKeywords;
  }

  // Detect project from window title
  detectProject(windowTitle, appName = null) {
    if (!windowTitle && !appName) {
      return 'Uncategorized';
    }

    const keywords = this.getKeywords();
    const searchText = `${windowTitle || ''} ${appName || ''}`.toLowerCase();

    // Search through all projects and their keywords
    for (const [projectName, projectKeywords] of Object.entries(keywords)) {
      if (!Array.isArray(projectKeywords)) continue;

      for (const keyword of projectKeywords) {
        if (searchText.includes(keyword.toLowerCase())) {
          return projectName;
        }
      }
    }

    // Try to detect from common patterns
    return this.detectFromPatterns(windowTitle, appName);
  }

  // Try to detect project from common patterns in window titles
  detectFromPatterns(windowTitle, appName) {
    if (!windowTitle) return 'Uncategorized';

    const title = windowTitle.toLowerCase();

    // Git repository patterns
    // e.g., "project-name - Visual Studio Code" or "GitHub - owner/repo"
    const vsCodeMatch = windowTitle.match(/^([^-]+)\s*[-\u2014]\s*Visual Studio Code/i);
    if (vsCodeMatch) {
      const folderName = vsCodeMatch[1].trim();
      // Return folder name as potential project if it looks like a project name
      if (folderName && !folderName.includes('.') && folderName.length < 50) {
        return folderName;
      }
    }

    // Terminal with project path
    // e.g., "~/projects/my-project" or "/Users/name/work/project"
    const pathMatch = windowTitle.match(/(?:~|\/\w+)(?:\/[\w.-]+)*\/([^/\s]+)/);
    if (pathMatch) {
      return pathMatch[1];
    }

    // GitHub patterns
    const githubMatch = windowTitle.match(/(?:GitHub|GitLab|Bitbucket)\s*[-:]\s*[\w-]+\/([^/\s-]+)/i);
    if (githubMatch) {
      return githubMatch[1];
    }

    // Jira/Linear/Notion patterns
    const ticketMatch = windowTitle.match(/\[?([A-Z]+-\d+)\]?/);
    if (ticketMatch) {
      // Extract project prefix from ticket (e.g., "PROJ" from "PROJ-123")
      const prefix = ticketMatch[1].split('-')[0];
      return prefix;
    }

    return 'Uncategorized';
  }

  // Get project statistics for a date range
  getProjectStats(startDate, endDate) {
    if (db.isAvailable()) {
      return db.getProjectStats(startDate, endDate);
    }

    // Fallback - return empty stats if database unavailable
    return {};
  }

  // Get all unique projects from history
  getAllProjects() {
    if (!db.isAvailable() || !db.initialized) {
      return Object.keys(config.getProjectKeywords());
    }

    try {
      const stmt = db.db.prepare(`
        SELECT DISTINCT project FROM work_sessions
        WHERE project IS NOT NULL
        UNION
        SELECT DISTINCT project FROM activity_log
        WHERE project IS NOT NULL
      `);
      const results = stmt.all();
      const projects = results.map(r => r.project).filter(Boolean);

      // Also include configured projects
      const configuredProjects = Object.keys(config.getProjectKeywords());
      return [...new Set([...projects, ...configuredProjects])];
    } catch (error) {
      console.error('Error getting all projects:', error);
      return Object.keys(config.getProjectKeywords());
    }
  }

  // Get work time breakdown by project for a date
  getProjectBreakdownForDate(date, activities) {
    const breakdown = {};

    for (const activity of activities) {
      const project = activity.project || this.detectProject(activity.window_title, activity.app_name);

      if (!breakdown[project]) {
        breakdown[project] = {
          totalSeconds: 0,
          entries: 0
        };
      }

      // Each activity entry represents ~30 seconds of work (tracking interval)
      const trackingInterval = config.get('trackingIntervalSeconds') || 30;
      breakdown[project].totalSeconds += trackingInterval;
      breakdown[project].entries += 1;
    }

    return breakdown;
  }

  // Format project stats for display
  formatProjectStats(stats) {
    const formatted = [];

    for (const [project, data] of Object.entries(stats)) {
      const hours = Math.floor(data.totalSeconds / 3600);
      const minutes = Math.floor((data.totalSeconds % 3600) / 60);

      let timeStr = '';
      if (hours > 0) {
        timeStr = `${hours}h ${minutes}m`;
      } else {
        timeStr = `${minutes}m`;
      }

      formatted.push({
        project,
        totalSeconds: data.totalSeconds,
        formattedTime: timeStr,
        sessionCount: data.sessionCount || data.entries || 0
      });
    }

    // Sort by total time descending
    formatted.sort((a, b) => b.totalSeconds - a.totalSeconds);

    return formatted;
  }

  // Invalidate keyword cache (call when config changes)
  invalidateCache() {
    this.cachedKeywords = null;
    this.lastKeywordsLoad = null;
  }
}

// Singleton instance
const projectManager = new ProjectManager();

module.exports = {
  ProjectManager,
  projects: projectManager
};
