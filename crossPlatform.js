// crossPlatform.js - Cross-platform activity detection
const { exec } = require('child_process');
const os = require('os');

class CrossPlatformDetector {
  constructor() {
    this.platform = process.platform;
  }

  // Get the current platform
  getPlatform() {
    return this.platform;
  }

  // Get the currently active application
  getActiveApp() {
    switch (this.platform) {
      case 'darwin':
        return this.getActiveAppMacOS();
      case 'win32':
        return this.getActiveAppWindows();
      case 'linux':
        return this.getActiveAppLinux();
      default:
        return Promise.reject(new Error(`Unsupported platform: ${this.platform}`));
    }
  }

  // Get the window title of the active application
  getWindowTitle(appName) {
    switch (this.platform) {
      case 'darwin':
        return this.getWindowTitleMacOS(appName);
      case 'win32':
        return this.getWindowTitleWindows();
      case 'linux':
        return this.getWindowTitleLinux();
      default:
        return Promise.reject(new Error(`Unsupported platform: ${this.platform}`));
    }
  }

  // Get system idle time in seconds
  getIdleTime() {
    switch (this.platform) {
      case 'darwin':
        return this.getIdleTimeMacOS();
      case 'win32':
        return this.getIdleTimeWindows();
      case 'linux':
        return this.getIdleTimeLinux();
      default:
        return Promise.reject(new Error(`Unsupported platform: ${this.platform}`));
    }
  }

  // ============ macOS Implementation ============

  getActiveAppMacOS() {
    return new Promise((resolve, reject) => {
      const script = `
        tell application "System Events"
          set frontApp to name of first application process whose frontmost is true
          return frontApp
        end tell
      `;

      exec(`osascript -e '${script}'`, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ appName: stdout.trim() });
      });
    });
  }

  getWindowTitleMacOS(appName) {
    return new Promise((resolve, reject) => {
      const script = `
        tell application "${appName}"
          try
            set windowTitle to name of front window
          on error
            set windowTitle to "Unknown Window"
          end try
          return windowTitle
        end tell
      `;

      exec(`osascript -e '${script}'`, (error, stdout, stderr) => {
        if (error) {
          resolve('Unknown Window');
          return;
        }
        resolve(stdout.trim());
      });
    });
  }

  getIdleTimeMacOS() {
    return new Promise((resolve, reject) => {
      exec('ioreg -c IOHIDSystem | grep HIDIdleTime', (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }

        const match = stdout.match(/= ([0-9]+)/);
        if (match && match[1]) {
          const idleTimeNanos = parseInt(match[1], 10);
          const idleTimeSeconds = idleTimeNanos / 1000000000;
          resolve(idleTimeSeconds);
        } else {
          reject(new Error('Could not parse idle time'));
        }
      });
    });
  }

  // ============ Windows Implementation ============

  getActiveAppWindows() {
    return new Promise((resolve, reject) => {
      // PowerShell script to get active window process name
      const psScript = `
        Add-Type @"
          using System;
          using System.Runtime.InteropServices;
          public class User32 {
            [DllImport("user32.dll")]
            public static extern IntPtr GetForegroundWindow();
            [DllImport("user32.dll")]
            public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);
          }
"@
        $hwnd = [User32]::GetForegroundWindow()
        $pid = 0
        [void][User32]::GetWindowThreadProcessId($hwnd, [ref]$pid)
        $process = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($process) { $process.ProcessName } else { "Unknown" }
      `;

      exec(`powershell -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ appName: stdout.trim() });
      });
    });
  }

  getWindowTitleWindows() {
    return new Promise((resolve, reject) => {
      // PowerShell script to get active window title
      const psScript = `
        Add-Type @"
          using System;
          using System.Runtime.InteropServices;
          using System.Text;
          public class User32 {
            [DllImport("user32.dll")]
            public static extern IntPtr GetForegroundWindow();
            [DllImport("user32.dll", CharSet = CharSet.Auto)]
            public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
          }
"@
        $hwnd = [User32]::GetForegroundWindow()
        $title = New-Object System.Text.StringBuilder 256
        [void][User32]::GetWindowText($hwnd, $title, 256)
        $title.ToString()
      `;

      exec(`powershell -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, (error, stdout, stderr) => {
        if (error) {
          resolve('Unknown Window');
          return;
        }
        resolve(stdout.trim() || 'Unknown Window');
      });
    });
  }

  getIdleTimeWindows() {
    return new Promise((resolve, reject) => {
      // PowerShell script to get idle time
      const psScript = `
        Add-Type @"
          using System;
          using System.Runtime.InteropServices;
          public class IdleTime {
            [DllImport("user32.dll")]
            public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
            [StructLayout(LayoutKind.Sequential)]
            public struct LASTINPUTINFO {
              public uint cbSize;
              public uint dwTime;
            }
          }
"@
        $lii = New-Object IdleTime+LASTINPUTINFO
        $lii.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($lii)
        [IdleTime]::GetLastInputInfo([ref]$lii) | Out-Null
        $idleTime = ([Environment]::TickCount - $lii.dwTime) / 1000
        $idleTime
      `;

      exec(`powershell -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        const idleSeconds = parseFloat(stdout.trim());
        if (!isNaN(idleSeconds)) {
          resolve(idleSeconds);
        } else {
          reject(new Error('Could not parse idle time'));
        }
      });
    });
  }

  // ============ Linux Implementation ============

  getActiveAppLinux() {
    return new Promise((resolve, reject) => {
      // Try xdotool first (most common)
      exec('xdotool getactivewindow getwindowname 2>/dev/null', (error, stdout, stderr) => {
        if (!error && stdout.trim()) {
          // xdotool returns window name, try to get process name from window
          exec('xdotool getactivewindow getwindowpid 2>/dev/null', (pidError, pidStdout) => {
            if (!pidError && pidStdout.trim()) {
              const pid = pidStdout.trim();
              exec(`ps -p ${pid} -o comm= 2>/dev/null`, (psError, psStdout) => {
                resolve({ appName: psError ? 'Unknown' : psStdout.trim() });
              });
            } else {
              resolve({ appName: 'Unknown' });
            }
          });
          return;
        }

        // Fallback to wmctrl
        exec('wmctrl -a :ACTIVE: -v 2>&1 | grep "Using window"', (wmError, wmStdout) => {
          if (!wmError && wmStdout) {
            const match = wmStdout.match(/Using window: (.*)/);
            resolve({ appName: match ? match[1] : 'Unknown' });
          } else {
            resolve({ appName: 'Unknown' });
          }
        });
      });
    });
  }

  getWindowTitleLinux() {
    return new Promise((resolve, reject) => {
      // Try xdotool first
      exec('xdotool getactivewindow getwindowname 2>/dev/null', (error, stdout, stderr) => {
        if (!error && stdout.trim()) {
          resolve(stdout.trim());
          return;
        }

        // Fallback to xprop
        exec('xprop -root _NET_ACTIVE_WINDOW 2>/dev/null', (xpropError, xpropStdout) => {
          if (!xpropError && xpropStdout) {
            const match = xpropStdout.match(/window id # (0x[0-9a-f]+)/);
            if (match) {
              exec(`xprop -id ${match[1]} _NET_WM_NAME 2>/dev/null`, (nameError, nameStdout) => {
                if (!nameError && nameStdout) {
                  const titleMatch = nameStdout.match(/_NET_WM_NAME.*= "(.*?)"/);
                  resolve(titleMatch ? titleMatch[1] : 'Unknown Window');
                } else {
                  resolve('Unknown Window');
                }
              });
              return;
            }
          }
          resolve('Unknown Window');
        });
      });
    });
  }

  getIdleTimeLinux() {
    return new Promise((resolve, reject) => {
      // Try xprintidle first (needs to be installed)
      exec('xprintidle 2>/dev/null', (error, stdout, stderr) => {
        if (!error && stdout.trim()) {
          const idleMs = parseInt(stdout.trim(), 10);
          if (!isNaN(idleMs)) {
            resolve(idleMs / 1000); // Convert to seconds
            return;
          }
        }

        // Fallback to xssstate (part of slock)
        exec('xssstate -i 2>/dev/null', (xssError, xssStdout) => {
          if (!xssError && xssStdout.trim()) {
            const idleMs = parseInt(xssStdout.trim(), 10);
            if (!isNaN(idleMs)) {
              resolve(idleMs / 1000);
              return;
            }
          }

          // Last resort: return 0 (assume active)
          console.warn('Could not detect idle time on Linux. Install xprintidle for accurate idle detection.');
          resolve(0);
        });
      });
    });
  }

  // ============ Utility Methods ============

  // Check if the required tools are available for the current platform
  checkDependencies() {
    return new Promise((resolve) => {
      const results = {
        platform: this.platform,
        available: true,
        missing: [],
        warnings: []
      };

      switch (this.platform) {
        case 'darwin':
          // macOS should work out of the box
          resolve(results);
          break;

        case 'win32':
          // Windows needs PowerShell (should be available by default)
          exec('powershell -Command "echo test"', (error) => {
            if (error) {
              results.available = false;
              results.missing.push('PowerShell');
            }
            resolve(results);
          });
          break;

        case 'linux':
          // Check for xdotool or wmctrl
          exec('which xdotool', (xdotoolError) => {
            if (xdotoolError) {
              exec('which wmctrl', (wmctrlError) => {
                if (wmctrlError) {
                  results.available = false;
                  results.missing.push('xdotool or wmctrl');
                }
                // Check for idle time tools
                exec('which xprintidle', (idleError) => {
                  if (idleError) {
                    results.warnings.push('xprintidle not found - idle detection may not work');
                  }
                  resolve(results);
                });
              });
            } else {
              exec('which xprintidle', (idleError) => {
                if (idleError) {
                  results.warnings.push('xprintidle not found - idle detection may not work');
                }
                resolve(results);
              });
            }
          });
          break;

        default:
          results.available = false;
          results.missing.push(`Platform support for ${this.platform}`);
          resolve(results);
      }
    });
  }
}

// Singleton instance
const detector = new CrossPlatformDetector();

module.exports = {
  CrossPlatformDetector,
  detector
};
