// stats.js - Statistics window renderer script
const { ipcRenderer } = require('electron');

// State
let currentViewDate = new Date();
let projectPieChart = null;

// Chart colors
const CHART_COLORS = [
  '#0071e3', '#34c759', '#ff9500', '#ff3b30', '#5856d6',
  '#af52de', '#00c7be', '#ff2d55', '#007aff', '#64d2ff'
];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initHourLabels();
  setupEventListeners();
  loadData();
});

// Initialize hour labels (12am - 11pm)
function initHourLabels() {
  const container = document.getElementById('hourLabels');
  for (let h = 0; h < 24; h++) {
    const label = document.createElement('span');
    const hour12 = h === 0 ? 12 : (h > 12 ? h - 12 : h);
    const ampm = h < 12 ? 'a' : 'p';
    label.textContent = h % 3 === 0 ? `${hour12}${ampm}` : '';
    container.appendChild(label);
  }
}

// Set up event listeners
function setupEventListeners() {
  document.getElementById('prevDay').addEventListener('click', () => navigateDay(-1));
  document.getElementById('nextDay').addEventListener('click', () => navigateDay(1));
  document.getElementById('exportCSV').addEventListener('click', () => exportData('csv'));
  document.getElementById('exportJSON').addEventListener('click', () => exportData('json'));
}

// Navigate to previous/next day
function navigateDay(direction) {
  currentViewDate.setDate(currentViewDate.getDate() + direction);
  updateDateLabel();
  loadDayData();
}

// Update date label
function updateDateLabel() {
  const today = new Date();
  const todayStr = formatDate(today);
  const viewStr = formatDate(currentViewDate);

  const label = document.getElementById('currentDate');
  if (viewStr === todayStr) {
    label.textContent = 'Today';
  } else if (viewStr === formatDate(new Date(today.getTime() - 86400000))) {
    label.textContent = 'Yesterday';
  } else {
    label.textContent = currentViewDate.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric'
    });
  }
}

// Load all data
async function loadData() {
  updateDateLabel();

  try {
    const now = new Date();
    const monthAgo = new Date(now);
    monthAgo.setDate(monthAgo.getDate() - 30);

    const data = await ipcRenderer.invoke('get-stats', {
      startDate: formatDate(monthAgo),
      endDate: formatDate(now)
    });

    updateTodayProgress(data.today, data.config);
    updateProjectChart(data.projectStats);
    updateSummaryStats(data.summary);

    // Load hourly data for current view date
    loadDayData();
  } catch (error) {
    console.error('Error loading stats:', error);
  }
}

// Load hourly data for the current view date
async function loadDayData() {
  try {
    const dateStr = formatDate(currentViewDate);
    const hourlyData = await ipcRenderer.invoke('get-hourly-stats', { date: dateStr });
    renderDailyHeatmap(hourlyData);
  } catch (error) {
    console.error('Error loading hourly data:', error);
    // Render empty heatmap if no data
    renderDailyHeatmap(Array(24).fill(0));
  }
}

// Render 24-hour daily heatmap
function renderDailyHeatmap(hourlyData) {
  const container = document.getElementById('hourBlocks');
  container.innerHTML = '';

  // Find max for scaling (cap at 60 min)
  const maxMinutes = 60;

  for (let h = 0; h < 24; h++) {
    const minutes = hourlyData[h] || 0;

    // Calculate level (0-4)
    let level = 0;
    if (minutes > 0) {
      const ratio = minutes / maxMinutes;
      if (ratio >= 0.8) level = 4;
      else if (ratio >= 0.6) level = 3;
      else if (ratio >= 0.4) level = 2;
      else level = 1;
    }

    const block = document.createElement('div');
    block.className = `hour-block level-${level}`;
    block.title = `${formatHour(h)}: ${minutes}m`;

    // Add visual intensity indicator
    const fill = document.createElement('div');
    fill.className = 'hour-fill';
    fill.style.height = `${Math.min(100, (minutes / maxMinutes) * 100)}%`;
    block.appendChild(fill);

    container.appendChild(block);
  }
}

// Format hour for display
function formatHour(h) {
  const hour12 = h === 0 ? 12 : (h > 12 ? h - 12 : h);
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${hour12} ${ampm}`;
}

// Update today's progress
function updateTodayProgress(today, config) {
  const goalMinutes = config.dailyGoalMinutes || 480;
  const goalHours = Math.floor(goalMinutes / 60);
  const goalMins = goalMinutes % 60;

  const workSeconds = today.totalWorkSeconds || 0;
  const workHours = Math.floor(workSeconds / 3600);
  const workMins = Math.floor((workSeconds % 3600) / 60);

  const percentage = Math.min(100, Math.round((workSeconds / (goalMinutes * 60)) * 100));

  document.getElementById('todayWorkTime').textContent = `${workHours}h ${workMins}m`;
  document.getElementById('goalTime').textContent = goalMins > 0 ? `${goalHours}h ${goalMins}m` : `${goalHours}h`;
  document.getElementById('todayPercentage').textContent = `${percentage}%`;
  document.getElementById('todaySessions').textContent = today.sessionsCount || 0;
  document.getElementById('currentStreak').textContent = today.streak || 0;

  updateProgressRing(percentage);
}

// Update progress ring
function updateProgressRing(percentage) {
  const canvas = document.getElementById('goalProgressChart');
  const ctx = canvas.getContext('2d');
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const radius = 60;
  const lineWidth = 12;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Background circle
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
  ctx.strokeStyle = '#f0f0f5';
  ctx.lineWidth = lineWidth;
  ctx.stroke();

  // Progress arc
  const startAngle = -Math.PI / 2;
  const endAngle = startAngle + (2 * Math.PI * percentage / 100);
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, startAngle, endAngle);
  ctx.strokeStyle = percentage >= 100 ? '#34c759' : '#0071e3';
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.stroke();
}

// Update project pie chart
function updateProjectChart(projectStats) {
  const canvas = document.getElementById('projectPieChart');
  const ctx = canvas.getContext('2d');
  const projectList = document.getElementById('projectList');

  const projects = Object.entries(projectStats)
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds)
    .slice(0, 10);

  const data = projects.map(p => p.totalSeconds);
  const colors = projects.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (projects.length === 0) {
    projectList.innerHTML = '<p style="color: #6e6e73; font-style: italic;">No project data available</p>';
    return;
  }

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const radius = Math.min(centerX, centerY) - 10;
  const total = data.reduce((a, b) => a + b, 0);
  let startAngle = -Math.PI / 2;

  data.forEach((value, i) => {
    const sliceAngle = (value / total) * 2 * Math.PI;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, startAngle, startAngle + sliceAngle);
    ctx.closePath();
    ctx.fillStyle = colors[i];
    ctx.fill();
    startAngle += sliceAngle;
  });

  // Donut hole
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * 0.6, 0, 2 * Math.PI);
  ctx.fillStyle = getComputedStyle(document.querySelector('.card')).backgroundColor || '#fff';
  ctx.fill();

  // Project list
  projectList.innerHTML = projects.map((p, i) => {
    const hours = Math.floor(p.totalSeconds / 3600);
    const mins = Math.floor((p.totalSeconds % 3600) / 60);
    const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

    return `
      <div class="project-item">
        <span class="project-color" style="background: ${colors[i]}"></span>
        <span class="project-name">${escapeHtml(p.name)}</span>
        <span class="project-time">${timeStr}</span>
      </div>
    `;
  }).join('');
}

// Update summary stats
function updateSummaryStats(summary) {
  const totalHours = Math.floor(summary.totalWorkSeconds / 3600);
  const totalMins = Math.floor((summary.totalWorkSeconds % 3600) / 60);
  const avgHours = Math.floor(summary.avgDailySeconds / 3600);
  const avgMins = Math.floor((summary.avgDailySeconds % 3600) / 60);

  document.getElementById('totalWorkTime').textContent = totalMins > 0 ? `${totalHours}h ${totalMins}m` : `${totalHours}h`;
  document.getElementById('avgDailyTime').textContent = avgMins > 0 ? `${avgHours}h ${avgMins}m` : `${avgHours}h`;
  document.getElementById('totalSessions').textContent = summary.totalSessions || 0;
  document.getElementById('goalsReached').textContent = summary.goalsReached || 0;
}

// Export data
async function exportData(format) {
  const now = new Date();
  const monthAgo = new Date(now);
  monthAgo.setDate(monthAgo.getDate() - 30);

  try {
    const result = await ipcRenderer.invoke('export-data', {
      format,
      startDate: formatDate(monthAgo),
      endDate: formatDate(now)
    });

    if (result.success) {
      alert(`Data exported to:\n${result.path}`);
    }
  } catch (error) {
    console.error('Error exporting data:', error);
    alert('Failed to export data: ' + error.message);
  }
}

// Helper: Format date
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

// Helper: Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
