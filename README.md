# SonarQube PR Analyzer

A Chrome sidebar extension that displays SonarQube code quality analysis results directly from GitHub pull request pages.

![Chrome Extension](https://img.shields.io/badge/Manifest-v3-brightgreen) ![Version](https://img.shields.io/badge/version-2.0-blue) ![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Auto-Detection** -- Automatically extracts the project key (repo name, lowercase) and PR number from GitHub PR URLs. Refreshes instantly when you switch tabs.
- **Grab from Active Tab** -- One click to capture and parse the URL of the currently open GitHub PR page.
- **Persistent Settings** -- Base URL and API token are saved permanently in `chrome.storage.local`. Project key and PR number are auto-detected per tab.
- **Severity Dashboard** -- Animated counters and bar charts showing BLOCKER, CRITICAL, MAJOR, MINOR, and INFO distribution.
- **Multiple Exports** -- Copy all issues as JSON, copy a text summary, or download as CSV. Click any individual issue to copy its details.
- **Advanced Filtering** -- Search, severity chip toggles, type filter (BUG, VULNERABILITY, CODE_SMELL), and sort by severity/file/type/line.
- **Collapsible Issue Details** -- Expand any issue to see rule, file path, effort, debt, author, and creation date.
- **Open in SonarQube** -- Direct link per issue to open it in your SonarQube instance.
- **Tab Change Listener** -- Automatically refreshes analysis when you switch to a different PR tab.
- **Runtime Permissions** -- Only requests access to your SonarQube server when needed (least-privilege principle).
- **Security Hardened** -- Content Security Policy, HTTPS enforcement, XSS protection via `escapeHtml()`, input sanitization, and `encodeURIComponent` for all URLs.

## Screenshots

The extension opens as a sidebar panel with a dark "Terminal Luxe" theme:

```
+----------------------------------+
|  [icon] SonarQube PR Analyzer  [S]|
|  * sonar.example.com  PR #168    |
|  [Refresh] [JSON] [Summary] [CSV]|
|  [Search issues...]              |
|  [BLOCKER] [CRITICAL] [MAJOR]... |
|                                  |
|  +----- Dashboard -----+        |
|  |  44  Total Issues    |        |
|  |  BLOCKER ████ 2      |        |
|  |  CRITICAL █████ 5    |        |
|  |  MAJOR ████████ 18   |        |
|  +-----------------------+       |
|                                  |
|  [BLOCKER] [BUG]                 |
|  NullPointerException risk...    |
|  UserService.java : Line 42     |
+----------------------------------+
```

## Installation

### From Source (Developer Mode)

1. Clone this repository:
   ```bash
   git clone https://github.com/your-username/sonarcubesidebar.git
   ```

2. Open Chrome and navigate to `chrome://extensions`

3. Enable **Developer mode** (toggle in the top-right corner)

4. Click **Load unpacked** and select the cloned directory

5. The extension icon will appear in your toolbar. Click it to open the sidebar panel.

### From Chrome Web Store

*(Coming soon)*

## Usage

### Quick Start

1. Click the extension icon in your toolbar to open the sidebar
2. Navigate to any GitHub PR page (e.g. `https://github.com/org/repo/pull/123`)
3. The extension auto-detects the project key and PR number
4. On first use, click **Settings** and enter:
   - **SonarQube Base URL** -- Your SonarQube server address (HTTPS required)
   - **API Token** -- Generate at SonarQube > My Account > Security > Tokens
5. Click **Save & Analyze**

### Auto-Detection

The extension parses GitHub PR URLs in this format:

```
https://github.com/{org}/{repo}/pull/{number}
```

- `{repo}` becomes the **project key** (converted to lowercase)
- `{number}` becomes the **PR number**

For example, `https://github.com/TrugoSoftwareTeam/EaaS.Backend.CSMS.Analyze.Gis/pull/168` yields:
- Project Key: `eaas.backend.csms.analyze.gis`
- PR Number: `168`

### Export Options

| Action | Description |
|--------|-------------|
| **JSON** | Copies all filtered issues as formatted JSON to clipboard |
| **Summary** | Copies a text report with severity counts and issue details |
| **CSV** | Downloads a CSV file with all filtered issues |
| **Click issue** | Copies individual issue details to clipboard |

## Project Structure

```
sonarcubesidebar/
  manifest.json      # Chrome Extension manifest (v3)
  background.js      # Service worker -- enables side panel on click
  sidepanel.html     # Main UI -- HTML + CSS (Terminal Luxe dark theme)
  sidepanel.js       # Application logic -- API, rendering, events
  promo.html         # Promotional landing page
  icon16.png         # Extension icon 16x16
  icon32.png         # Extension icon 32x32
  icon48.png         # Extension icon 48x48
  icon128.png        # Extension icon 128x128
  README.md          # This file
```

## Permissions

| Permission | Purpose |
|------------|---------|
| `sidePanel` | Opens the extension as a Chrome sidebar panel |
| `storage` | Saves settings (Base URL, token) locally in the browser |
| `activeTab` | Reads the current tab URL to detect GitHub PR pages |
| `tabs` | Listens for tab changes to auto-refresh on PR navigation |
| `host_permissions: github.com` | Accesses GitHub PR page URLs for auto-detection |
| `optional_host_permissions: https://*` | Requests access to your SonarQube server at runtime |

## Security

- **No data collection** -- Zero analytics, telemetry, or tracking
- **Local storage only** -- Token and settings never leave your browser
- **HTTPS enforced** -- SonarQube connections must use HTTPS (localhost exempted)
- **Content Security Policy** -- `script-src 'self'; object-src 'self'`
- **XSS protection** -- All dynamic content escaped via `escapeHtml()` and severity whitelist
- **Input sanitization** -- Project key and PR number validated with regex
- **URL encoding** -- All API parameters passed through `encodeURIComponent()`
- **Runtime permissions** -- Server access requested only when the user explicitly grants it
- **Race condition prevention** -- Debounced tab listeners (400ms), save queue, loading guards

## API

The extension communicates with a single SonarQube endpoint:

```
GET {baseUrl}/api/issues/search
  ?componentKeys={projectKey}
  &pullRequest={prNumber}
  &resolved=false
  &ps=500
  &p={page}
```

Authentication uses HTTP Basic Auth with the token as the username and an empty password.

## Tech Stack

- **Chrome Extension Manifest V3**
- **Vanilla HTML/CSS/JS** -- No frameworks, no dependencies, no CDN
- **Chrome APIs** -- `chrome.sidePanel`, `chrome.storage.local`, `chrome.tabs`, `chrome.permissions`
- **SonarQube Web API** -- `/api/issues/search`, `/api/system/status`

## License

MIT
