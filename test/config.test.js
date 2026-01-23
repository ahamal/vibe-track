// config.test.js - Tests for configuration management
const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock electron before requiring config
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => os.tmpdir())
  }
}));

const { Config, DEFAULT_CONFIG } = require('../config');

describe('Config', () => {
  let config;
  let testConfigDir;
  let testConfigPath;

  beforeEach(() => {
    // Create a temporary config directory for testing
    testConfigDir = path.join(os.tmpdir(), '.worktracker-test-' + Date.now());
    testConfigPath = path.join(testConfigDir, 'config.json');

    // Create a new config instance with custom paths
    config = new Config();
    config.configDir = testConfigDir;
    config.configPath = testConfigPath;
  });

  afterEach(() => {
    // Clean up test config directory
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  describe('load()', () => {
    test('creates config directory if it does not exist', () => {
      expect(fs.existsSync(testConfigDir)).toBe(false);
      config.load();
      expect(fs.existsSync(testConfigDir)).toBe(true);
    });

    test('returns default config when no config file exists', () => {
      const loadedConfig = config.load();
      expect(loadedConfig.dailyGoalMinutes).toBe(DEFAULT_CONFIG.dailyGoalMinutes);
      expect(loadedConfig.breakReminderMinutes).toBe(DEFAULT_CONFIG.breakReminderMinutes);
    });

    test('creates config file with defaults when none exists', () => {
      config.load();
      expect(fs.existsSync(testConfigPath)).toBe(true);
    });

    test('loads existing config file', () => {
      // Create config directory and write a custom config
      fs.mkdirSync(testConfigDir, { recursive: true });
      fs.writeFileSync(testConfigPath, JSON.stringify({
        dailyGoalMinutes: 600,
        breakReminderMinutes: 45
      }));

      const loadedConfig = config.load();
      expect(loadedConfig.dailyGoalMinutes).toBe(600);
      expect(loadedConfig.breakReminderMinutes).toBe(45);
    });

    test('merges loaded config with defaults for missing fields', () => {
      // Create config with only some fields
      fs.mkdirSync(testConfigDir, { recursive: true });
      fs.writeFileSync(testConfigPath, JSON.stringify({
        dailyGoalMinutes: 600
      }));

      const loadedConfig = config.load();
      expect(loadedConfig.dailyGoalMinutes).toBe(600);
      expect(loadedConfig.breakReminderMinutes).toBe(DEFAULT_CONFIG.breakReminderMinutes);
      expect(loadedConfig.productiveApps).toEqual(DEFAULT_CONFIG.productiveApps);
    });
  });

  describe('save()', () => {
    test('saves config to file', () => {
      config.load();
      config.config.dailyGoalMinutes = 720;
      config.save();

      const fileContent = fs.readFileSync(testConfigPath, 'utf8');
      const savedConfig = JSON.parse(fileContent);
      expect(savedConfig.dailyGoalMinutes).toBe(720);
    });
  });

  describe('get()', () => {
    test('returns config value by key', () => {
      config.load();
      expect(config.get('dailyGoalMinutes')).toBe(DEFAULT_CONFIG.dailyGoalMinutes);
    });

    test('supports dot notation for nested values', () => {
      config.load();
      expect(config.get('notifications.breakReminders')).toBe(true);
    });

    test('returns undefined for non-existent keys', () => {
      config.load();
      expect(config.get('nonExistentKey')).toBeUndefined();
    });
  });

  describe('set()', () => {
    test('sets config value and saves', () => {
      config.load();
      config.set('dailyGoalMinutes', 300);
      expect(config.get('dailyGoalMinutes')).toBe(300);

      // Verify it was saved to file
      const fileContent = fs.readFileSync(testConfigPath, 'utf8');
      const savedConfig = JSON.parse(fileContent);
      expect(savedConfig.dailyGoalMinutes).toBe(300);
    });

    test('supports dot notation for setting nested values', () => {
      config.load();
      config.set('notifications.breakReminders', false);
      expect(config.get('notifications.breakReminders')).toBe(false);
    });
  });

  describe('getAll()', () => {
    test('returns copy of full config object', () => {
      config.load();
      const allConfig = config.getAll();
      expect(allConfig).toHaveProperty('dailyGoalMinutes');
      expect(allConfig).toHaveProperty('productiveApps');
      expect(allConfig).toHaveProperty('notifications');
    });
  });

  describe('update()', () => {
    test('updates multiple values at once', () => {
      config.load();
      config.update({
        dailyGoalMinutes: 600,
        breakReminderMinutes: 90
      });

      expect(config.get('dailyGoalMinutes')).toBe(600);
      expect(config.get('breakReminderMinutes')).toBe(90);
    });

    test('deep merges nested objects', () => {
      config.load();
      config.update({
        notifications: {
          breakReminders: false
        }
      });

      expect(config.get('notifications.breakReminders')).toBe(false);
      expect(config.get('notifications.dailySummary')).toBe(true);
    });
  });

  describe('reset()', () => {
    test('resets config to defaults', () => {
      config.load();
      config.set('dailyGoalMinutes', 1000);
      config.reset();

      expect(config.get('dailyGoalMinutes')).toBe(DEFAULT_CONFIG.dailyGoalMinutes);
    });
  });

  describe('productive apps management', () => {
    test('addProductiveApp adds a new app', () => {
      config.load();
      const initialCount = config.config.productiveApps.length;
      config.addProductiveApp('NewApp');

      expect(config.config.productiveApps).toContain('NewApp');
      expect(config.config.productiveApps.length).toBe(initialCount + 1);
    });

    test('addProductiveApp does not add duplicates', () => {
      config.load();
      const initialCount = config.config.productiveApps.length;
      config.addProductiveApp('VSCode');

      expect(config.config.productiveApps.length).toBe(initialCount);
    });

    test('removeProductiveApp removes an app', () => {
      config.load();
      config.addProductiveApp('TestApp');
      config.removeProductiveApp('TestApp');

      expect(config.config.productiveApps).not.toContain('TestApp');
    });
  });

  describe('project keywords management', () => {
    test('setProjectKeywords adds project keywords', () => {
      config.load();
      config.setProjectKeywords('TestProject', ['test', 'testing']);

      expect(config.config.projectKeywords.TestProject).toEqual(['test', 'testing']);
    });

    test('removeProject removes a project', () => {
      config.load();
      config.setProjectKeywords('ToRemove', ['remove']);
      config.removeProject('ToRemove');

      expect(config.config.projectKeywords.ToRemove).toBeUndefined();
    });

    test('getProjectKeywords returns project keywords', () => {
      config.load();
      config.setProjectKeywords('Project1', ['p1', 'proj1']);

      const keywords = config.getProjectKeywords();
      expect(keywords.Project1).toEqual(['p1', 'proj1']);
    });
  });
});
