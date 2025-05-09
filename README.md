# Work Tracker

A productivity tracking application that monitors your work time by tracking which applications and websites you're using.

## Features

- **Automatic Work Time Tracking**: Tracks time spent in productive applications and websites
- **AFK Detection**: Automatically detects when you're away from keyboard
- **Menu Bar App**: Easy access from your system tray/menu bar
- **Weekly Reports**: View statistics of your work time over the past week
- **Private Data Storage**: All logs are stored locally in your home directory

## Installation

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Start the application:
   ```
   npm start
   ```

## Configuration

You can customize which applications and websites are considered "productive" by editing the `workTracker.js` file:

```javascript
const PRODUCTIVE_APPS = [
  'Google Chrome',
  'Sublime Text',
  'VSCode',
  'Visual Studio Code',
  // Add your productive apps here
];

const PRODUCTIVE_WEBSITES = [
  'claude.ai',
  'localhost',
  'github.com',
  // Add your productive websites here
];
```

## Data Storage

All activity logs are stored in:
- macOS: `~/.worktracker/activity_log.txt`

## Usage

Once started, the app will appear in your system tray/menu bar. Click on the icon to:

- See your current work time
- View detailed session information
- Generate weekly summaries
- Open the log file location
- Start/stop tracking

## Development

### Project Structure

- `main.js` - Entry point for the application
- `activityTracker.js` - Records user activity to a log file
- `workTracker.js` - Analyzes log files to calculate work time
- `work-tracker-menubar.js` - The menu bar interface

## License

MIT