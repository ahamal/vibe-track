// settings.js - Settings window renderer script
const { ipcRenderer } = require('electron');

let currentConfig = null;

// Initialize settings
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  setupEventListeners();
});

// Load settings from main process
function loadSettings() {
  ipcRenderer.invoke('get-config').then(config => {
    currentConfig = config;
    populateForm(config);
  }).catch(error => {
    console.error('Error loading settings:', error);
  });
}

// Populate form with current config values
function populateForm(config) {
  // Daily goal
  const goalMinutes = config.dailyGoalMinutes || 480;
  document.getElementById('dailyGoalHours').value = Math.floor(goalMinutes / 60);
  document.getElementById('dailyGoalMinutes').value = goalMinutes % 60;

  // Break reminder
  document.getElementById('breakReminderMinutes').value = config.breakReminderMinutes || 60;

  // AFK threshold
  const afkSeconds = config.afkThresholdSeconds || 180;
  document.getElementById('afkThresholdMinutes').value = Math.floor(afkSeconds / 60);

  // Notifications
  const notifications = config.notifications || {};
  document.getElementById('breakRemindersEnabled').checked = notifications.breakReminders !== false;
  document.getElementById('dailySummaryEnabled').checked = notifications.dailySummary !== false;
  document.getElementById('dailySummaryTime').value = notifications.dailySummaryTime || '18:00';
  document.getElementById('goalReachedEnabled').checked = notifications.goalReached !== false;

  // Productive apps
  renderTagList('productiveAppsList', config.productiveApps || [], 'app');

  // Productive websites
  renderTagList('productiveWebsitesList', config.productiveWebsites || [], 'website');

  // Project keywords
  renderProjectKeywords(config.projectKeywords || {});
}

// Render a tag list (apps or websites)
function renderTagList(containerId, items, type) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  items.forEach(item => {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.innerHTML = `
      ${escapeHtml(item)}
      <button class="remove-tag" data-type="${type}" data-value="${escapeHtml(item)}">&times;</button>
    `;
    container.appendChild(tag);
  });
}

// Render project keywords list
function renderProjectKeywords(projects) {
  const container = document.getElementById('projectKeywordsList');
  container.innerHTML = '';

  for (const [name, keywords] of Object.entries(projects)) {
    const item = document.createElement('div');
    item.className = 'project-item';
    item.innerHTML = `
      <div class="project-header">
        <span class="project-name">${escapeHtml(name)}</span>
        <button class="remove-project" data-project="${escapeHtml(name)}">&times;</button>
      </div>
      <div class="project-keywords">Keywords: ${escapeHtml(keywords.join(', '))}</div>
    `;
    container.appendChild(item);
  }
}

// Set up event listeners
function setupEventListeners() {
  // Add productive app
  document.getElementById('addProductiveApp').addEventListener('click', () => {
    const input = document.getElementById('newProductiveApp');
    const value = input.value.trim();
    if (value && !currentConfig.productiveApps.includes(value)) {
      currentConfig.productiveApps.push(value);
      renderTagList('productiveAppsList', currentConfig.productiveApps, 'app');
      input.value = '';
    }
  });

  document.getElementById('newProductiveApp').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('addProductiveApp').click();
    }
  });

  // Add productive website
  document.getElementById('addProductiveWebsite').addEventListener('click', () => {
    const input = document.getElementById('newProductiveWebsite');
    const value = input.value.trim();
    if (value && !currentConfig.productiveWebsites.includes(value)) {
      currentConfig.productiveWebsites.push(value);
      renderTagList('productiveWebsitesList', currentConfig.productiveWebsites, 'website');
      input.value = '';
    }
  });

  document.getElementById('newProductiveWebsite').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('addProductiveWebsite').click();
    }
  });

  // Add project
  document.getElementById('addProject').addEventListener('click', () => {
    const nameInput = document.getElementById('newProjectName');
    const keywordsInput = document.getElementById('newProjectKeywords');
    const name = nameInput.value.trim();
    const keywords = keywordsInput.value.split(',').map(k => k.trim()).filter(k => k);

    if (name && keywords.length > 0) {
      currentConfig.projectKeywords[name] = keywords;
      renderProjectKeywords(currentConfig.projectKeywords);
      nameInput.value = '';
      keywordsInput.value = '';
    }
  });

  // Remove tag (delegated)
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-tag')) {
      const type = e.target.dataset.type;
      const value = e.target.dataset.value;

      if (type === 'app') {
        currentConfig.productiveApps = currentConfig.productiveApps.filter(a => a !== value);
        renderTagList('productiveAppsList', currentConfig.productiveApps, 'app');
      } else if (type === 'website') {
        currentConfig.productiveWebsites = currentConfig.productiveWebsites.filter(w => w !== value);
        renderTagList('productiveWebsitesList', currentConfig.productiveWebsites, 'website');
      }
    }

    if (e.target.classList.contains('remove-project')) {
      const project = e.target.dataset.project;
      delete currentConfig.projectKeywords[project];
      renderProjectKeywords(currentConfig.projectKeywords);
    }
  });

  // Save button
  document.getElementById('settingsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    saveSettings();
  });

  // Cancel button
  document.getElementById('cancelBtn').addEventListener('click', () => {
    window.close();
  });

  // Reset to defaults
  document.getElementById('resetDefaults').addEventListener('click', () => {
    if (confirm('Are you sure you want to reset all settings to defaults?')) {
      ipcRenderer.invoke('reset-config').then(config => {
        currentConfig = config;
        populateForm(config);
      });
    }
  });
}

// Save settings
function saveSettings() {
  // Gather form values
  const goalHours = parseInt(document.getElementById('dailyGoalHours').value) || 0;
  const goalMinutes = parseInt(document.getElementById('dailyGoalMinutes').value) || 0;
  currentConfig.dailyGoalMinutes = goalHours * 60 + goalMinutes;

  currentConfig.breakReminderMinutes = parseInt(document.getElementById('breakReminderMinutes').value) || 60;

  const afkMinutes = parseInt(document.getElementById('afkThresholdMinutes').value) || 3;
  currentConfig.afkThresholdSeconds = afkMinutes * 60;

  currentConfig.notifications = {
    breakReminders: document.getElementById('breakRemindersEnabled').checked,
    dailySummary: document.getElementById('dailySummaryEnabled').checked,
    dailySummaryTime: document.getElementById('dailySummaryTime').value,
    goalReached: document.getElementById('goalReachedEnabled').checked
  };

  // Send to main process
  ipcRenderer.invoke('save-config', currentConfig).then(() => {
    window.close();
  }).catch(error => {
    console.error('Error saving settings:', error);
    alert('Failed to save settings: ' + error.message);
  });
}

// Helper: Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
