// stats.js - Statistics window renderer script
const { ipcRenderer } = require('electron');

// Chart instances
let goalProgressChart = null;
let workTimeChart = null;
let dailyComparisonChart = null;
let projectPieChart = null;

// Current date range
let currentPeriod = 'month';
let currentStartDate = null;
let currentEndDate = null;

// Chart colors
const CHART_COLORS = [
  '#0071e3', '#34c759', '#ff9500', '#ff3b30', '#5856d6',
  '#af52de', '#00c7be', '#ff2d55', '#007aff', '#64d2ff'
];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initializeDateRange();
  setupEventListeners();
  loadData();
});

// Initialize date range
function initializeDateRange() {
  const now = new Date();
  currentEndDate = formatDate(now);

  if (currentPeriod === 'week') {
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 6);
    currentStartDate = formatDate(weekAgo);
  } else {
    const monthAgo = new Date(now);
    monthAgo.setDate(monthAgo.getDate() - 29);
    currentStartDate = formatDate(monthAgo);
  }

  document.getElementById('startDate').value = currentStartDate;
  document.getElementById('endDate').value = currentEndDate;
}

// Set up event listeners
function setupEventListeners() {
  // Period select
  document.getElementById('periodSelect').addEventListener('change', (e) => {
    currentPeriod = e.target.value;
    const customRange = document.getElementById('customDateRange');

    if (currentPeriod === 'custom') {
      customRange.style.display = 'flex';
    } else {
      customRange.style.display = 'none';
      initializeDateRange();
      loadData();
    }
  });

  // Navigation buttons
  document.getElementById('prevPeriod').addEventListener('click', () => navigatePeriod(-1));
  document.getElementById('nextPeriod').addEventListener('click', () => navigatePeriod(1));

  // Custom date range
  document.getElementById('applyDateRange').addEventListener('click', () => {
    currentStartDate = document.getElementById('startDate').value;
    currentEndDate = document.getElementById('endDate').value;
    loadData();
  });

  // Export buttons
  document.getElementById('exportCSV').addEventListener('click', () => exportData('csv'));
  document.getElementById('exportJSON').addEventListener('click', () => exportData('json'));
}

// Navigate period forward/backward
function navigatePeriod(direction) {
  const days = currentPeriod === 'week' ? 7 : 30;
  const start = new Date(currentStartDate);
  const end = new Date(currentEndDate);

  start.setDate(start.getDate() + (direction * days));
  end.setDate(end.getDate() + (direction * days));

  currentStartDate = formatDate(start);
  currentEndDate = formatDate(end);

  document.getElementById('startDate').value = currentStartDate;
  document.getElementById('endDate').value = currentEndDate;

  loadData();
}

// Load all data
async function loadData() {
  try {
    const data = await ipcRenderer.invoke('get-stats', {
      startDate: currentStartDate,
      endDate: currentEndDate
    });

    updateTodayProgress(data.today, data.config);
    updateWorkTimeChart(data.dailySummaries);
    updateDailyComparisonChart(data.dailySummaries, data.config);
    updateProjectChart(data.projectStats);
    updateSummaryStats(data.summary);
  } catch (error) {
    console.error('Error loading stats:', error);
  }
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

  // Update progress ring
  updateProgressRing(percentage);
}

// Update progress ring chart
function updateProgressRing(percentage) {
  const ctx = document.getElementById('goalProgressChart').getContext('2d');

  if (goalProgressChart) {
    goalProgressChart.destroy();
  }

  goalProgressChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      datasets: [{
        data: [percentage, 100 - percentage],
        backgroundColor: [
          percentage >= 100 ? '#34c759' : '#0071e3',
          '#f0f0f5'
        ],
        borderWidth: 0
      }]
    },
    options: {
      cutout: '75%',
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false }
      }
    }
  });
}

// Update work time trend chart
function updateWorkTimeChart(dailySummaries) {
  const ctx = document.getElementById('workTimeChart').getContext('2d');

  const labels = dailySummaries.map(d => {
    const date = new Date(d.date);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });

  const data = dailySummaries.map(d => Math.round((d.total_work_seconds || 0) / 3600 * 10) / 10);

  if (workTimeChart) {
    workTimeChart.destroy();
  }

  workTimeChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Work Hours',
        data,
        borderColor: '#0071e3',
        backgroundColor: 'rgba(0, 113, 227, 0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 3,
        pointHoverRadius: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: 'Hours'
          }
        }
      }
    }
  });
}

// Update daily comparison chart
function updateDailyComparisonChart(dailySummaries, config) {
  const ctx = document.getElementById('dailyComparisonChart').getContext('2d');
  const goalHours = (config.dailyGoalMinutes || 480) / 60;

  // Get last 7 days
  const lastWeek = dailySummaries.slice(-7);

  const labels = lastWeek.map(d => {
    const date = new Date(d.date);
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  });

  const data = lastWeek.map(d => Math.round((d.total_work_seconds || 0) / 3600 * 10) / 10);

  if (dailyComparisonChart) {
    dailyComparisonChart.destroy();
  }

  dailyComparisonChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Work Hours',
        data,
        backgroundColor: data.map(h => h >= goalHours ? '#34c759' : '#0071e3'),
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        annotation: {
          annotations: {
            goalLine: {
              type: 'line',
              yMin: goalHours,
              yMax: goalHours,
              borderColor: '#ff9500',
              borderWidth: 2,
              borderDash: [5, 5],
              label: {
                content: 'Goal',
                enabled: true
              }
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: 'Hours'
          }
        }
      }
    }
  });
}

// Update project pie chart
function updateProjectChart(projectStats) {
  const ctx = document.getElementById('projectPieChart').getContext('2d');
  const projectList = document.getElementById('projectList');

  const projects = Object.entries(projectStats)
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds)
    .slice(0, 10); // Top 10 projects

  const labels = projects.map(p => p.name);
  const data = projects.map(p => Math.round(p.totalSeconds / 60)); // Minutes
  const colors = projects.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);

  if (projectPieChart) {
    projectPieChart.destroy();
  }

  if (projects.length === 0) {
    projectList.innerHTML = '<p style="color: #6e6e73; font-style: italic;">No project data available</p>';
    return;
  }

  projectPieChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false }
      }
    }
  });

  // Update project list
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
  try {
    const result = await ipcRenderer.invoke('export-data', {
      format,
      startDate: currentStartDate,
      endDate: currentEndDate
    });

    if (result.success) {
      alert(`Data exported to:\n${result.path}`);
    }
  } catch (error) {
    console.error('Error exporting data:', error);
    alert('Failed to export data: ' + error.message);
  }
}

// Helper: Format date to YYYY-MM-DD
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

// Helper: Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
