// config.js - Configuration management for Work Tracker
const fs = require('fs');
const path = require('path');
const os = require('os');

// Default configuration
const DEFAULT_CONFIG = {
  productiveApps: [
    'Sublime Text',
    'sublime_text',
    'VSCode',
    'Visual Studio Code',
    'Terminal',
    'iTerm2',
    'TextEdit',
    'Xcode',
    'IntelliJ IDEA',
    'WebStorm',
    'PyCharm',
    'Android Studio',
    'Atom',
    'Vim',
    'Emacs',
    'Notepad++',
    'Eclipse'
  ],
  productiveWebsites: [
    'Claude',
    'claude.ai',
    'localhost',
    'GitHub',
    'github.com',
    'stackoverflow.com',
    'docs.google.com',
    'notion.so',
    'jira.com',
    'Xenote',
    'xenote',
    'Excalidraw',
    'React',
    'Radix',
    'Colab',
    'Jupyter',
    'gitlab.com',
    'bitbucket.org',
    'linear.app',
    'figma.com',
    'miro.com'
  ],
  dailyGoalMinutes: 480, // 8 hours
  breakReminderMinutes: 60, // Remind after 60 minutes of continuous work
  afkThresholdSeconds: 180, // 3 minutes
  trackingIntervalSeconds: 30,
  projectKeywords: {
    // Example: "ProjectA": ["projecta", "client-a", "proj-a"]
  },
  notifications: {
    breakReminders: true,
    dailySummary: true,
    dailySummaryTime: '18:00',
    goalReached: true
  },
  ui: {
    showGoalProgress: true,
    showCurrentProject: true
  }
};

class Config {
  constructor() {
    this.configDir = path.join(os.homedir(), '.worktracker');
    this.configPath = path.join(this.configDir, 'config.json');
    this.config = null;
  }

  // Ensure config directory exists
  ensureConfigDir() {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
  }

  // Load configuration from file
  load() {
    this.ensureConfigDir();

    try {
      if (fs.existsSync(this.configPath)) {
        const fileContent = fs.readFileSync(this.configPath, 'utf8');
        const loadedConfig = JSON.parse(fileContent);
        // Merge with defaults to ensure all fields exist
        this.config = this.mergeWithDefaults(loadedConfig);
      } else {
        // No config file exists, use defaults and save them
        this.config = { ...DEFAULT_CONFIG };
        this.save();
      }
    } catch (error) {
      console.error('Error loading config, using defaults:', error);
      this.config = { ...DEFAULT_CONFIG };
    }

    return this.config;
  }

  // Deep merge loaded config with defaults
  mergeWithDefaults(loaded) {
    const merged = { ...DEFAULT_CONFIG };

    for (const key in loaded) {
      if (loaded.hasOwnProperty(key)) {
        if (typeof loaded[key] === 'object' && !Array.isArray(loaded[key]) && loaded[key] !== null) {
          // Deep merge for objects (like notifications, ui)
          merged[key] = { ...DEFAULT_CONFIG[key], ...loaded[key] };
        } else {
          // Direct assignment for primitives and arrays
          merged[key] = loaded[key];
        }
      }
    }

    return merged;
  }

  // Save configuration to file
  save() {
    this.ensureConfigDir();

    try {
      const content = JSON.stringify(this.config, null, 2);
      fs.writeFileSync(this.configPath, content, 'utf8');
      return true;
    } catch (error) {
      console.error('Error saving config:', error);
      return false;
    }
  }

  // Get a configuration value
  get(key) {
    if (!this.config) {
      this.load();
    }

    // Support dot notation (e.g., 'notifications.breakReminders')
    const keys = key.split('.');
    let value = this.config;

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return undefined;
      }
    }

    return value;
  }

  // Set a configuration value
  set(key, value) {
    if (!this.config) {
      this.load();
    }

    // Support dot notation
    const keys = key.split('.');
    let obj = this.config;

    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!(k in obj) || typeof obj[k] !== 'object') {
        obj[k] = {};
      }
      obj = obj[k];
    }

    obj[keys[keys.length - 1]] = value;
    return this.save();
  }

  // Get full configuration object
  getAll() {
    if (!this.config) {
      this.load();
    }
    return { ...this.config };
  }

  // Update multiple configuration values
  update(updates) {
    if (!this.config) {
      this.load();
    }

    for (const key in updates) {
      if (updates.hasOwnProperty(key)) {
        if (typeof updates[key] === 'object' && !Array.isArray(updates[key]) && updates[key] !== null) {
          this.config[key] = { ...this.config[key], ...updates[key] };
        } else {
          this.config[key] = updates[key];
        }
      }
    }

    return this.save();
  }

  // Reset to default configuration
  reset() {
    this.config = { ...DEFAULT_CONFIG };
    return this.save();
  }

  // Get the config directory path
  getConfigDir() {
    return this.configDir;
  }

  // Get the config file path
  getConfigPath() {
    return this.configPath;
  }

  // Add a productive app
  addProductiveApp(appName) {
    if (!this.config) {
      this.load();
    }

    if (!this.config.productiveApps.includes(appName)) {
      this.config.productiveApps.push(appName);
      return this.save();
    }
    return true;
  }

  // Remove a productive app
  removeProductiveApp(appName) {
    if (!this.config) {
      this.load();
    }

    const index = this.config.productiveApps.indexOf(appName);
    if (index > -1) {
      this.config.productiveApps.splice(index, 1);
      return this.save();
    }
    return true;
  }

  // Add a productive website
  addProductiveWebsite(website) {
    if (!this.config) {
      this.load();
    }

    if (!this.config.productiveWebsites.includes(website)) {
      this.config.productiveWebsites.push(website);
      return this.save();
    }
    return true;
  }

  // Remove a productive website
  removeProductiveWebsite(website) {
    if (!this.config) {
      this.load();
    }

    const index = this.config.productiveWebsites.indexOf(website);
    if (index > -1) {
      this.config.productiveWebsites.splice(index, 1);
      return this.save();
    }
    return true;
  }

  // Add or update a project's keywords
  setProjectKeywords(projectName, keywords) {
    if (!this.config) {
      this.load();
    }

    this.config.projectKeywords[projectName] = keywords;
    return this.save();
  }

  // Remove a project
  removeProject(projectName) {
    if (!this.config) {
      this.load();
    }

    if (projectName in this.config.projectKeywords) {
      delete this.config.projectKeywords[projectName];
      return this.save();
    }
    return true;
  }

  // Get project keywords
  getProjectKeywords() {
    if (!this.config) {
      this.load();
    }
    return { ...this.config.projectKeywords };
  }
}

// Singleton instance
const configInstance = new Config();

module.exports = {
  Config,
  config: configInstance,
  DEFAULT_CONFIG
};
