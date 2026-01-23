// notifications.js - Break reminders and daily summary notifications
const { Notification } = require('electron');
const { config } = require('./config');

class NotificationManager {
  constructor() {
    this.lastBreakReminder = null;
    this.lastWorkStart = null;
    this.continuousWorkMinutes = 0;
    this.dailySummaryTimer = null;
    this.goalNotifiedToday = false;
    this.lastNotificationDate = null;
  }

  // Initialize notification system
  init() {
    this.setupDailySummaryTimer();
    this.resetDailyFlags();
    return true;
  }

  // Reset daily notification flags at midnight
  resetDailyFlags() {
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    if (this.lastNotificationDate !== today) {
      this.goalNotifiedToday = false;
      this.lastNotificationDate = today;
    }

    // Schedule next reset at midnight
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const msUntilMidnight = tomorrow - now;

    setTimeout(() => this.resetDailyFlags(), msUntilMidnight);
  }

  // Set up daily summary notification timer
  setupDailySummaryTimer() {
    // Clear existing timer
    if (this.dailySummaryTimer) {
      clearTimeout(this.dailySummaryTimer);
    }

    const notificationConfig = config.get('notifications');
    if (!notificationConfig || !notificationConfig.dailySummary) {
      return;
    }

    const summaryTime = notificationConfig.dailySummaryTime || '18:00';
    const [hours, minutes] = summaryTime.split(':').map(Number);

    const now = new Date();
    const scheduledTime = new Date(now);
    scheduledTime.setHours(hours, minutes, 0, 0);

    // If time has passed today, schedule for tomorrow
    if (scheduledTime <= now) {
      scheduledTime.setDate(scheduledTime.getDate() + 1);
    }

    const msUntilSummary = scheduledTime - now;

    this.dailySummaryTimer = setTimeout(() => {
      this.showDailySummaryCallback();
      // Reschedule for next day
      this.setupDailySummaryTimer();
    }, msUntilSummary);
  }

  // Callback to be set by the main app for showing daily summary
  showDailySummaryCallback() {
    // This will be set by work-tracker-menubar.js
    if (this.onDailySummary) {
      this.onDailySummary();
    }
  }

  // Track work activity for break reminders
  trackWorkActivity(isWorking) {
    const notificationConfig = config.get('notifications');
    if (!notificationConfig || !notificationConfig.breakReminders) {
      return;
    }

    const breakReminderMinutes = config.get('breakReminderMinutes') || 60;

    if (isWorking) {
      if (!this.lastWorkStart) {
        this.lastWorkStart = new Date();
      }

      // Calculate continuous work time
      const now = new Date();
      this.continuousWorkMinutes = (now - this.lastWorkStart) / 1000 / 60;

      // Check if we need to show break reminder
      if (this.continuousWorkMinutes >= breakReminderMinutes) {
        // Only remind once per interval (don't spam)
        const reminderInterval = breakReminderMinutes * 60 * 1000; // Convert to ms
        const timeSinceLastReminder = this.lastBreakReminder ?
          (now - this.lastBreakReminder) : Infinity;

        if (timeSinceLastReminder >= reminderInterval) {
          this.showBreakReminder();
          this.lastBreakReminder = now;
        }
      }
    } else {
      // User stopped working, reset continuous work tracking
      this.lastWorkStart = null;
      this.continuousWorkMinutes = 0;
    }
  }

  // Show break reminder notification
  showBreakReminder() {
    const workHours = Math.floor(this.continuousWorkMinutes / 60);
    const workMins = Math.floor(this.continuousWorkMinutes % 60);

    let timeText = '';
    if (workHours > 0) {
      timeText = `${workHours} hour${workHours > 1 ? 's' : ''}`;
      if (workMins > 0) {
        timeText += ` ${workMins} minutes`;
      }
    } else {
      timeText = `${workMins} minutes`;
    }

    this.showNotification({
      title: 'Time for a Break',
      body: `You've been working for ${timeText}. Take a short break to rest your eyes and stretch.`,
      silent: false
    });
  }

  // Show goal reached notification
  showGoalReached(workTimeFormatted, goalMinutes) {
    const notificationConfig = config.get('notifications');
    if (!notificationConfig || !notificationConfig.goalReached) {
      return;
    }

    // Only notify once per day
    if (this.goalNotifiedToday) {
      return;
    }

    const goalHours = Math.floor(goalMinutes / 60);
    const goalMins = goalMinutes % 60;
    let goalText = '';
    if (goalHours > 0) {
      goalText = `${goalHours} hour${goalHours > 1 ? 's' : ''}`;
      if (goalMins > 0) {
        goalText += ` ${goalMins} minutes`;
      }
    } else {
      goalText = `${goalMins} minutes`;
    }

    this.showNotification({
      title: 'Daily Goal Reached!',
      body: `Congratulations! You've completed your ${goalText} work goal for today. Total: ${workTimeFormatted}`,
      silent: false
    });

    this.goalNotifiedToday = true;
  }

  // Show daily summary notification
  showDailySummary(workTimeFormatted, goalMinutes, actualMinutes, sessionsCount) {
    const notificationConfig = config.get('notifications');
    if (!notificationConfig || !notificationConfig.dailySummary) {
      return;
    }

    const percentage = goalMinutes > 0 ? Math.round((actualMinutes / goalMinutes) * 100) : 0;

    let body = `Today's work: ${workTimeFormatted} (${percentage}% of goal)`;
    if (sessionsCount > 0) {
      body += `\nWork sessions: ${sessionsCount}`;
    }

    this.showNotification({
      title: 'Daily Work Summary',
      body: body,
      silent: true
    });
  }

  // Core notification display function
  showNotification(options) {
    try {
      if (!Notification.isSupported()) {
        console.warn('Notifications not supported on this system');
        return false;
      }

      const notification = new Notification({
        title: options.title,
        body: options.body,
        silent: options.silent || false,
        timeoutType: 'default'
      });

      notification.on('click', () => {
        if (options.onClick) {
          options.onClick();
        }
      });

      notification.show();
      return true;
    } catch (error) {
      console.error('Error showing notification:', error);
      return false;
    }
  }

  // Get current continuous work time in minutes
  getContinuousWorkMinutes() {
    return this.continuousWorkMinutes;
  }

  // Reset break reminder (user took a break)
  resetBreakTimer() {
    this.lastWorkStart = new Date();
    this.continuousWorkMinutes = 0;
    this.lastBreakReminder = null;
  }

  // Clean up timers
  destroy() {
    if (this.dailySummaryTimer) {
      clearTimeout(this.dailySummaryTimer);
      this.dailySummaryTimer = null;
    }
  }
}

// Singleton instance
const notificationManager = new NotificationManager();

module.exports = {
  NotificationManager,
  notifications: notificationManager
};
