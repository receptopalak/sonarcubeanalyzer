/* ═══════════════════════════════════════════
   SONARQUBE PR ANALYZER — Logic Engine
   ═══════════════════════════════════════════ */

// ─── STATE ───
const state = {
  settings: null,
  allIssues: [],
  filteredIssues: [],
  activeSeverities: new Set(['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO']),
  searchQuery: '',
  typeFilter: '',
  sortBy: 'severity',
  isLoading: false,
  isConnected: false,
};

const SEVERITY_ORDER = { BLOCKER: 0, CRITICAL: 1, MAJOR: 2, MINOR: 3, INFO: 4 };
const VALID_SEVERITIES = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO'];
const SEVERITY_LABELS = { BLOCKER: 'Blocker', CRITICAL: 'Critical', MAJOR: 'Major', MINOR: 'Minor', INFO: 'Info' };
const TYPE_LABELS = { BUG: 'Bug', VULNERABILITY: 'Vulnerability', CODE_SMELL: 'Code Smell' };
const MAX_PAGES = 20;

// ─── DOM REFS ───
const $ = (sel) => document.querySelector(sel);

const dom = {
  toasts: $('#toasts'),
  settingsBackdrop: $('#settingsBackdrop'),
  settingsPanel: $('#settingsPanel'),
  closeSettings: $('#closeSettings'),
  btnSettings: $('#btnSettings'),
  settingUrl: $('#settingUrl'),
  settingToken: $('#settingToken'),
  settingProject: $('#settingProject'),
  settingPr: $('#settingPr'),
  toggleToken: $('#toggleToken'),
  parseUrl: $('#parseUrl'),
  btnGrabTab: $('#btnGrabTab'),
  btnParseUrl: $('#btnParseUrl'),
  btnSaveSettings: $('#btnSaveSettings'),
  btnTestConnection: $('#btnTestConnection'),
  connDot: $('#connDot'),
  connInfo: $('#connInfo'),
  connPrBadge: $('#connPrBadge'),
  btnRefresh: $('#btnRefresh'),
  btnCopyJson: $('#btnCopyJson'),
  btnCopySummary: $('#btnCopySummary'),
  btnExportCsv: $('#btnExportCsv'),
  searchInput: $('#searchInput'),
  searchClear: $('#searchClear'),
  severityChips: $('#severityChips'),
  typeFilter: $('#typeFilter'),
  sortBy: $('#sortBy'),
  dashboard: $('#dashboard'),
  issuesList: $('#issuesList'),
  emptyState: $('#emptyState'),
  loadingSkeleton: $('#loadingSkeleton'),
  setupPrompt: $('#setupPrompt'),
  btnOpenSetup: $('#btnOpenSetup'),
};

// ─── UTILS ───
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

function formatDate(dateStr) {
  try {
    return new Date(dateStr).toLocaleString('en-US', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return String(dateStr);
  }
}

function safeSeverity(sev) {
  return VALID_SEVERITIES.includes(sev) ? sev : 'INFO';
}

// ─── SETTINGS MANAGEMENT ───
const DEFAULT_SONAR_URL = '';

async function loadSettings() {
  try {
    const result = await chrome.storage.local.get('sonarSettings');
    return result.sonarSettings || null;
  } catch {
    const stored = localStorage.getItem('sonarSettings');
    return stored ? JSON.parse(stored) : null;
  }
}

let _saveQueued = null;
let _saving = false;

async function saveSettings(settings) {
  if (_saving) {
    _saveQueued = settings;
    return;
  }
  _saving = true;
  try {
    await chrome.storage.local.set({ sonarSettings: settings });
  } catch {
    localStorage.setItem('sonarSettings', JSON.stringify(settings));
  } finally {
    _saving = false;
    if (_saveQueued) {
      const next = _saveQueued;
      _saveQueued = null;
      await saveSettings(next);
    }
  }
}

// Extract project key and PR number from GitHub PR URL
function parseGitHubPrUrl(fullUrl) {
  try {
    const url = new URL(fullUrl);
    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (match) {
      return {
        projectKey: match[2].toLowerCase(),
        prNumber: match[3],
      };
    }
    return null;
  } catch {
    return null;
  }
}

// Get project and PR info from active tab URL
async function getActiveTabPrInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return null;
    return parseGitHubPrUrl(tab.url);
  } catch {
    return null;
  }
}

// Listen for tab changes — prevent race conditions with debounce
let _tabDebounce = null;
let _autoDetecting = false;

function listenTabChanges() {
  try {
    const onTabChange = () => {
      clearTimeout(_tabDebounce);
      _tabDebounce = setTimeout(() => autoDetectFromTab(), 400);
    };
    chrome.tabs.onActivated.addListener(onTabChange);
    chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
      if (changeInfo.url || changeInfo.status === 'complete') {
        onTabChange();
      }
    });
  } catch {
    // Silently skip if Tab API is not available
  }
}

async function autoDetectFromTab() {
  if (_autoDetecting || state.isLoading) return;
  _autoDetecting = true;
  try {
    const prInfo = await getActiveTabPrInfo();
    if (!prInfo) return;

    const saved = await loadSettings();
    if (!saved || !saved.token) return;

    const changed =
      saved.projectKey !== prInfo.projectKey ||
      saved.prNumber !== prInfo.prNumber;

    if (changed && prInfo.projectKey && prInfo.prNumber) {
      state.settings = {
        baseUrl: saved.baseUrl || DEFAULT_SONAR_URL,
        token: saved.token,
        projectKey: prInfo.projectKey,
        prNumber: prInfo.prNumber,
      };
      await saveSettings(state.settings);
      showToast(`PR #${prInfo.prNumber} detected — refreshing`, 'info');
      runAnalysis();
    }
  } finally {
    _autoDetecting = false;
  }
}

// ─── SETTINGS UI ───
async function openSettings() {
  dom.settingsPanel.classList.add('open');
  dom.settingsBackdrop.classList.add('open');

  dom.settingUrl.value = state.settings?.baseUrl || DEFAULT_SONAR_URL;
  dom.settingToken.value = state.settings?.token || '';
  dom.settingProject.value = state.settings?.projectKey || '';
  dom.settingPr.value = state.settings?.prNumber || '';

  const prInfo = await getActiveTabPrInfo();
  if (prInfo) {
    if (prInfo.projectKey) dom.settingProject.value = prInfo.projectKey;
    if (prInfo.prNumber) dom.settingPr.value = prInfo.prNumber;
  }
}

function closeSettings() {
  dom.settingsPanel.classList.remove('open');
  dom.settingsBackdrop.classList.remove('open');
}

function getSettingsFromForm() {
  return {
    baseUrl: dom.settingUrl.value.trim().replace(/\/+$/, ''),
    token: dom.settingToken.value.trim(),
    projectKey: dom.settingProject.value.trim(),
    prNumber: dom.settingPr.value.trim(),
  };
}

function validateSettings(s) {
  if (!s.baseUrl) return 'Base URL is required';
  if (!s.token) return 'API Token is required';
  try {
    const url = new URL(s.baseUrl);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      return 'HTTPS is required for security';
    }
  } catch { return 'Invalid URL format'; }
  if (s.projectKey && !/^[a-zA-Z0-9._:-]+$/.test(s.projectKey)) {
    return 'Project key contains invalid characters';
  }
  if (s.prNumber && !/^\d+$/.test(s.prNumber)) {
    return 'PR number must be numeric';
  }
  return null;
}

// ─── API ───
async function fetchIssues(settings, page = 1, pageSize = 500) {
  const auth = btoa(`${settings.token}:`);
  const params = new URLSearchParams({
    componentKeys: settings.projectKey,
    pullRequest: settings.prNumber,
    resolved: 'false',
    ps: String(pageSize),
    p: String(page),
  });

  const response = await fetch(`${settings.baseUrl}/api/issues/search?${params}`, {
    headers: { 'Authorization': `Basic ${auth}` },
  });

  if (!response.ok) {
    const status = response.status;
    if (status === 401) throw new Error('Authorization error — Invalid token');
    if (status === 403) throw new Error('Access denied — Insufficient permissions');
    if (status === 404) throw new Error('Project or PR not found');
    throw new Error(`API error: ${status} ${response.statusText}`);
  }

  return response.json();
}

async function fetchAllIssues(settings) {
  const firstPage = await fetchIssues(settings, 1, 500);
  let allIssues = firstPage.issues || [];
  const total = firstPage.total || allIssues.length;
  const paging = firstPage.paging;

  if (paging && total > paging.pageSize) {
    const totalPages = Math.min(Math.ceil(total / paging.pageSize), MAX_PAGES);

    if (totalPages >= MAX_PAGES) {
      showToast(`${total} issues found, showing first ${MAX_PAGES * paging.pageSize}`, 'info');
    }

    const promises = [];
    for (let p = 2; p <= totalPages; p++) {
      promises.push(fetchIssues(settings, p, paging.pageSize));
    }

    try {
      const results = await Promise.all(promises);
      for (const r of results) {
        if (r.issues) allIssues = allIssues.concat(r.issues);
      }
    } catch (err) {
      showToast('Some pages failed to load', 'error');
    }
  }

  return allIssues;
}

async function testConnection(settings) {
  const auth = btoa(`${settings.token}:`);
  const response = await fetch(`${settings.baseUrl}/api/system/status`, {
    headers: { 'Authorization': `Basic ${auth}` },
  });
  if (!response.ok) throw new Error(`Connection error: ${response.status}`);
  return response.json();
}

// ─── DATA PROCESSING ───
function computeSeverityCounts(issues) {
  const counts = { BLOCKER: 0, CRITICAL: 0, MAJOR: 0, MINOR: 0, INFO: 0 };
  for (const issue of issues) {
    if (counts[issue.severity] !== undefined) counts[issue.severity]++;
  }
  return counts;
}

function filterAndSort() {
  let issues = [...state.allIssues];

  issues = issues.filter(i => state.activeSeverities.has(i.severity));

  if (state.typeFilter) {
    issues = issues.filter(i => i.type === state.typeFilter);
  }

  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    issues = issues.filter(i =>
      (i.message || '').toLowerCase().includes(q) ||
      (i.component || '').toLowerCase().includes(q) ||
      (i.rule || '').toLowerCase().includes(q)
    );
  }

  issues.sort((a, b) => {
    switch (state.sortBy) {
      case 'severity':
        return (SEVERITY_ORDER[a.severity] ?? 5) - (SEVERITY_ORDER[b.severity] ?? 5);
      case 'file':
        return (a.component || '').localeCompare(b.component || '');
      case 'type':
        return (a.type || '').localeCompare(b.type || '');
      case 'line':
        return (a.line || 0) - (b.line || 0);
      default:
        return 0;
    }
  });

  state.filteredIssues = issues;
}

// ─── RENDERING ───
function renderSeverityChips() {
  if (!dom.severityChips) return;
  const counts = computeSeverityCounts(state.allIssues);

  dom.severityChips.innerHTML = VALID_SEVERITIES.map(sev => {
    const active = state.activeSeverities.has(sev);
    return `<button class="chip ${active ? 'active' : 'inactive'}" data-severity="${sev}">
      <span class="chip-dot"></span>
      ${SEVERITY_LABELS[sev]}
      <span class="chip-count">${counts[sev]}</span>
    </button>`;
  }).join('');

  dom.severityChips.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const sev = chip.dataset.severity;
      if (state.activeSeverities.has(sev)) {
        state.activeSeverities.delete(sev);
      } else {
        state.activeSeverities.add(sev);
      }
      chip.classList.toggle('active');
      chip.classList.toggle('inactive');
      applyFilters();
    });
  });
}

function renderDashboard() {
  if (!dom.dashboard) return;
  const counts = computeSeverityCounts(state.allIssues);
  const total = state.allIssues.length;
  const max = Math.max(...Object.values(counts), 1);

  dom.dashboard.innerHTML = `
    <div class="total-display">
      <span class="total-number" id="totalNumber">0</span>
      <span class="total-label">Total Issues</span>
    </div>
    <div class="severity-bars">
      ${VALID_SEVERITIES.map(sev => `
        <div class="severity-row sev-${sev}">
          <span class="sev-label">${SEVERITY_LABELS[sev]}</span>
          <div class="sev-bar-track">
            <div class="sev-bar-fill" data-width="${(counts[sev] / max) * 100}"></div>
          </div>
          <span class="sev-count">${counts[sev]}</span>
        </div>
      `).join('')}
    </div>
  `;

  dom.dashboard.classList.remove('hidden');

  animateCounter($('#totalNumber'), total);

  requestAnimationFrame(() => {
    dom.dashboard.querySelectorAll('.sev-bar-fill').forEach(bar => {
      bar.style.width = bar.dataset.width + '%';
    });
  });
}

function renderIssues() {
  if (!dom.issuesList) return;
  filterAndSort();
  const issues = state.filteredIssues;

  if (issues.length === 0 && state.allIssues.length > 0) {
    dom.issuesList.classList.add('hidden');
    dom.emptyState?.classList.remove('hidden');
    const h3 = dom.emptyState?.querySelector('h3');
    const p = dom.emptyState?.querySelector('p');
    if (h3) h3.textContent = 'No Matching Issues';
    if (p) p.textContent = 'No issues match your filter criteria.';
    return;
  }

  if (issues.length === 0) {
    dom.issuesList.classList.add('hidden');
    dom.emptyState?.classList.remove('hidden');
    const h3 = dom.emptyState?.querySelector('h3');
    const p = dom.emptyState?.querySelector('p');
    if (h3) h3.textContent = 'No Issues Found';
    if (p) p.textContent = 'No unresolved issues in this PR.';
    return;
  }

  dom.emptyState?.classList.add('hidden');
  dom.issuesList.classList.remove('hidden');

  const isFiltered = issues.length !== state.allIssues.length;

  dom.issuesList.innerHTML = `
    <div class="issues-count-bar">
      <span>${issues.length} issues listed</span>
      ${isFiltered ? `<span class="filtered-note">filtered from ${state.allIssues.length}</span>` : ''}
    </div>
    ${issues.map((issue, idx) => renderIssueCard(issue, idx)).join('')}
  `;

  // Attach events
  dom.issuesList.querySelectorAll('.issue-header').forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.closest('.issue-copy-btn')) return;
      const details = header.closest('.issue-card')?.querySelector('.issue-details');
      if (details) details.classList.toggle('open');
    });
  });

  dom.issuesList.querySelectorAll('.issue-copy-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index, 10);
      const issue = state.filteredIssues[idx];
      if (issue) copyIssueToClipboard(issue, btn);
    });
  });

  dom.issuesList.querySelectorAll('.detail-btn[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index, 10);
      const issue = state.filteredIssues[idx];
      if (!issue) return;
      const action = btn.dataset.action;
      if (action === 'copy-json') {
        copyToClipboard(JSON.stringify(issue, null, 2));
        showToast('Issue JSON copied', 'success');
      } else if (action === 'copy-message') {
        copyToClipboard(issue.message);
        showToast('Message copied', 'success');
      } else if (action === 'open-sonar' && state.settings) {
        const url = `${state.settings.baseUrl}/project/issues?id=${encodeURIComponent(state.settings.projectKey)}&pullRequest=${encodeURIComponent(state.settings.prNumber)}&open=${encodeURIComponent(issue.key)}`;
        window.open(url, '_blank');
      }
    });
  });
}

function renderIssueCard(issue, idx) {
  const fileName = escapeHtml((issue.component || '').split(':').pop() || 'Unknown file');
  const sev = safeSeverity(issue.severity);
  const sevClass = `sev-${sev}`;
  const badgeSevClass = `badge-${sev.toLowerCase()}`;
  const typeClass = issue.type === 'BUG' ? 'badge-bug' : issue.type === 'VULNERABILITY' ? 'badge-vuln' : 'badge-smell';
  const delay = Math.min(idx * 30, 300);
  const lineHtml = issue.line ? ` : <span class="line-num">Line ${escapeHtml(String(issue.line))}</span>` : '';
  const safeIdx = parseInt(idx, 10);

  return `
    <div class="issue-card ${sevClass}" style="animation-delay:${delay}ms">
      <div class="issue-header">
        <div class="issue-badges">
          <span class="badge ${badgeSevClass}">${escapeHtml(SEVERITY_LABELS[sev] || sev)}</span>
          <span class="badge ${typeClass}">${escapeHtml(TYPE_LABELS[issue.type] || issue.type || '')}</span>
        </div>
        <span class="issue-message">${escapeHtml(issue.message || '')}</span>
      </div>
      <div class="issue-meta">
        <span class="issue-file" title="${escapeHtml(issue.component || '')}">${fileName}${lineHtml}</span>
        <button class="issue-copy-btn" data-index="${safeIdx}" title="Copy">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          Copy
        </button>
      </div>
      <div class="issue-details">
        <div class="issue-details-inner">
          ${issue.rule ? `<div class="detail-row"><span class="detail-label">Rule</span><span class="detail-value">${escapeHtml(issue.rule)}</span></div>` : ''}
          ${issue.component ? `<div class="detail-row"><span class="detail-label">File</span><span class="detail-value">${escapeHtml(issue.component)}</span></div>` : ''}
          ${issue.effort ? `<div class="detail-row"><span class="detail-label">Effort</span><span class="detail-value">${escapeHtml(issue.effort)}</span></div>` : ''}
          ${issue.debt ? `<div class="detail-row"><span class="detail-label">Debt</span><span class="detail-value">${escapeHtml(issue.debt)}</span></div>` : ''}
          ${issue.author ? `<div class="detail-row"><span class="detail-label">Author</span><span class="detail-value">${escapeHtml(issue.author)}</span></div>` : ''}
          ${issue.creationDate ? `<div class="detail-row"><span class="detail-label">Date</span><span class="detail-value">${formatDate(issue.creationDate)}</span></div>` : ''}
          <div class="detail-actions">
            <button class="detail-btn" data-action="copy-json" data-index="${safeIdx}">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
              Copy JSON
            </button>
            <button class="detail-btn" data-action="copy-message" data-index="${safeIdx}">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>
              Copy Message
            </button>
            <button class="detail-btn" data-action="open-sonar" data-index="${safeIdx}">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              Open in SonarQube
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ─── COPY / EXPORT ───
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

async function copyIssueToClipboard(issue, btn) {
  const fileName = (issue.component || '').split(':').pop();
  const text = `[${issue.severity}] ${issue.type}: ${issue.message}\n${fileName}${issue.line ? ` : Line ${issue.line}` : ''}`;
  await copyToClipboard(text);
  btn.classList.add('copied');
  btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg> Copied`;
  showToast('Issue copied', 'success');
  setTimeout(() => {
    if (!btn.isConnected) return;
    btn.classList.remove('copied');
    btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copy`;
  }, 2000);
}

function copyAllAsJson() {
  const issues = state.filteredIssues;
  if (!issues.length) {
    showToast('No issues to copy', 'error');
    return;
  }

  const data = {
    project: state.settings?.projectKey,
    pullRequest: state.settings?.prNumber,
    exportDate: new Date().toISOString(),
    totalIssues: issues.length,
    severityCounts: computeSeverityCounts(issues),
    issues: issues.map(i => ({
      key: i.key,
      severity: i.severity,
      type: i.type,
      message: i.message,
      component: i.component,
      line: i.line,
      rule: i.rule,
      effort: i.effort,
      debt: i.debt,
      author: i.author,
      creationDate: i.creationDate,
      status: i.status,
      tags: i.tags,
    })),
  };

  copyToClipboard(JSON.stringify(data, null, 2));
  showToast(`${issues.length} issues copied as JSON`, 'success');
}

function copySummary() {
  const issues = state.filteredIssues;
  if (!issues.length) {
    showToast('No summary to copy', 'error');
    return;
  }

  const counts = computeSeverityCounts(issues);
  const lines = [
    `SonarQube PR Analysis Report`,
    `═══════════════════════════`,
    `Project: ${state.settings?.projectKey || '-'}`,
    `PR: #${state.settings?.prNumber || '-'}`,
    `Date: ${new Date().toLocaleString('en-US')}`,
    ``,
    `Total Issues: ${issues.length}`,
    `──────────────`,
    `BLOCKER:  ${counts.BLOCKER}`,
    `CRITICAL: ${counts.CRITICAL}`,
    `MAJOR:    ${counts.MAJOR}`,
    `MINOR:    ${counts.MINOR}`,
    `INFO:     ${counts.INFO}`,
    ``,
    `Details:`,
    `──────────────`,
  ];

  issues.forEach((issue, i) => {
    const fileName = (issue.component || '').split(':').pop();
    lines.push(`${i + 1}. [${issue.severity}] ${issue.type}: ${issue.message}`);
    lines.push(`   ${fileName}${issue.line ? ` : Line ${issue.line}` : ''}`);
    lines.push('');
  });

  copyToClipboard(lines.join('\n'));
  showToast('Report summary copied', 'success');
}

function exportCsv() {
  const issues = state.filteredIssues;
  if (!issues.length) {
    showToast('No issues to export', 'error');
    return;
  }

  const headers = ['Severity', 'Type', 'Message', 'File', 'Line', 'Rule', 'Author', 'Date'];
  const rows = issues.map(i => [
    i.severity,
    i.type,
    `"${(i.message || '').replace(/"/g, '""')}"`,
    (i.component || '').split(':').pop(),
    i.line || '',
    i.rule || '',
    i.author || '',
    i.creationDate ? formatDate(i.creationDate) : '',
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sonar-pr${state.settings?.prNumber || ''}-issues.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`${issues.length} issues downloaded as CSV`, 'success');
}

// ─── UI HELPERS ───
function showToast(message, type = 'success') {
  if (!dom.toasts) return;
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span>${escapeHtml(message)}</span>`;
  dom.toasts.appendChild(toast);

  const hideTimer = setTimeout(() => {
    if (!toast.isConnected) return;
    toast.classList.add('out');
    setTimeout(() => { if (toast.isConnected) toast.remove(); }, 300);
  }, 2500);

  toast.addEventListener('click', () => {
    clearTimeout(hideTimer);
    if (toast.isConnected) toast.remove();
  });
}

function animateCounter(el, target, duration = 800) {
  if (!el) return;
  const startTime = performance.now();

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(target * eased);
    if (progress < 1) requestAnimationFrame(update);
  }

  requestAnimationFrame(update);
}

function showSection(section) {
  dom.dashboard?.classList.add('hidden');
  dom.issuesList?.classList.add('hidden');
  dom.emptyState?.classList.add('hidden');
  dom.loadingSkeleton?.classList.add('hidden');
  dom.setupPrompt?.classList.add('hidden');

  if (section === 'loading') dom.loadingSkeleton?.classList.remove('hidden');
  else if (section === 'setup') dom.setupPrompt?.classList.remove('hidden');
  else if (section === 'empty') dom.emptyState?.classList.remove('hidden');
  else if (section === 'data') {
    dom.dashboard?.classList.remove('hidden');
    dom.issuesList?.classList.remove('hidden');
  }
}

function updateConnectionBar(connected, text, pr) {
  state.isConnected = connected;
  if (dom.connDot) dom.connDot.className = 'conn-dot' + (connected ? ' connected' : '');
  if (dom.connInfo) dom.connInfo.textContent = text;
  if (pr) {
    if (dom.connPrBadge) {
      dom.connPrBadge.textContent = `PR #${pr}`;
      dom.connPrBadge.classList.remove('hidden');
    }
  } else {
    dom.connPrBadge?.classList.add('hidden');
  }
}

function setRefreshLoading(loading) {
  state.isLoading = loading;
  if (dom.btnRefresh) {
    dom.btnRefresh.classList.toggle('refreshing', loading);
    dom.btnRefresh.disabled = loading;
  }
}

function applyFilters() {
  renderIssues();
}

// ─── MAIN FLOW ───
async function runAnalysis() {
  // Prevent concurrent execution
  if (state.isLoading) return;

  if (!state.settings || !state.settings.token) {
    showSection('setup');
    updateConnectionBar(false, 'Not connected', null);
    return;
  }

  // Try auto-detecting from active GitHub PR tab if project/PR missing
  if (!state.settings.projectKey || !state.settings.prNumber) {
    const prInfo = await getActiveTabPrInfo();
    if (prInfo && prInfo.projectKey && prInfo.prNumber) {
      state.settings.projectKey = prInfo.projectKey;
      state.settings.prNumber = prInfo.prNumber;
      if (!state.settings.baseUrl) state.settings.baseUrl = DEFAULT_SONAR_URL;
      await saveSettings(state.settings);
    } else {
      showSection('setup');
      updateConnectionBar(false, 'Navigate to a GitHub PR', null);
      showToast('Navigate to a GitHub PR page or enter settings manually', 'info');
      return;
    }
  }

  setRefreshLoading(true);
  showSection('loading');
  updateConnectionBar(false, 'Connecting...', state.settings.prNumber);

  try {
    const issues = await fetchAllIssues(state.settings);
    state.allIssues = issues;
    state.filteredIssues = issues;

    updateConnectionBar(true, state.settings.baseUrl.replace(/^https?:\/\//, ''), state.settings.prNumber);

    renderSeverityChips();
    showSection('data');
    renderDashboard();
    renderIssues();

    showToast(`${issues.length} issues found`, 'info');
  } catch (error) {
    showSection('setup');
    updateConnectionBar(false, 'Connection error', state.settings.prNumber);
    if (dom.connDot) dom.connDot.classList.add('error');
    showToast(error.message, 'error');
  } finally {
    setRefreshLoading(false);
  }
}

// ─── EVENT LISTENERS ───
function initEvents() {
  dom.btnSettings?.addEventListener('click', openSettings);
  dom.closeSettings?.addEventListener('click', closeSettings);
  dom.settingsBackdrop?.addEventListener('click', closeSettings);
  dom.btnOpenSetup?.addEventListener('click', openSettings);

  // Token visibility toggle
  dom.toggleToken?.addEventListener('click', () => {
    const input = dom.settingToken;
    if (!input) return;
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    if (dom.toggleToken) {
      dom.toggleToken.innerHTML = isPassword
        ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M1 1l22 22"/></svg>`
        : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
    }
  });

  // Grab URL from active tab
  dom.btnGrabTab?.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url) {
        showToast('Could not get active tab URL', 'error');
        return;
      }
      if (dom.parseUrl) dom.parseUrl.value = tab.url;
      const parsed = parseGitHubPrUrl(tab.url);
      if (parsed) {
        if (dom.settingProject) dom.settingProject.value = parsed.projectKey;
        if (dom.settingPr) dom.settingPr.value = parsed.prNumber;
        if (dom.settingUrl && !dom.settingUrl.value) dom.settingUrl.value = DEFAULT_SONAR_URL;
        showToast(`${parsed.projectKey} / PR #${parsed.prNumber} detected`, 'success');
      } else {
        showToast('Active tab is not a GitHub PR page', 'info');
      }
    } catch {
      showToast('Could not get tab info', 'error');
    }
  });

  // Manual GitHub PR URL parse
  dom.btnParseUrl?.addEventListener('click', () => {
    const input = dom.parseUrl?.value.trim();
    if (!input) {
      showToast('Enter a URL first or use "Grab from Active Tab"', 'error');
      return;
    }
    const parsed = parseGitHubPrUrl(input);
    if (parsed) {
      if (dom.settingProject) dom.settingProject.value = parsed.projectKey;
      if (dom.settingPr) dom.settingPr.value = parsed.prNumber;
      if (dom.settingUrl && !dom.settingUrl.value) dom.settingUrl.value = DEFAULT_SONAR_URL;
      showToast(`${parsed.projectKey} / PR #${parsed.prNumber} detected`, 'success');
    } else {
      showToast('Invalid GitHub PR URL (e.g. github.com/org/repo/pull/123)', 'error');
    }
  });

  // Save settings
  dom.btnSaveSettings?.addEventListener('click', async () => {
    const settings = getSettingsFromForm();
    const error = validateSettings(settings);
    if (error) {
      showToast(error, 'error');
      return;
    }
    // Request runtime host permission for SonarQube server
    try {
      const origin = new URL(settings.baseUrl).origin + '/*';
      const hasPermission = await chrome.permissions.contains({ origins: [origin] });
      if (!hasPermission) {
        if (dom.btnSaveSettings) {
          dom.btnSaveSettings.disabled = true;
          dom.btnSaveSettings.textContent = 'Requesting permission...';
        }
        const granted = await chrome.permissions.request({ origins: [origin] });
        if (!granted) {
          showToast('Server access permission denied', 'error');
          return;
        }
      }
    } catch {
      // Continue if permissions API unavailable
    } finally {
      if (dom.btnSaveSettings) {
        dom.btnSaveSettings.disabled = false;
        dom.btnSaveSettings.textContent = 'Save & Analyze';
      }
    }
    state.settings = settings;
    await saveSettings(settings);
    closeSettings();
    showToast('Settings saved', 'success');
    runAnalysis();
  });

  // Test connection
  dom.btnTestConnection?.addEventListener('click', async () => {
    const settings = getSettingsFromForm();
    if (!settings.baseUrl || !settings.token) {
      showToast('URL and Token are required', 'error');
      return;
    }
    if (dom.btnTestConnection) {
      dom.btnTestConnection.disabled = true;
      dom.btnTestConnection.textContent = 'Testing...';
    }
    try {
      const result = await testConnection(settings);
      showToast(`Connection successful — ${result.status || 'OK'}`, 'success');
    } catch (e) {
      showToast(`Connection failed: ${e.message}`, 'error');
    } finally {
      if (dom.btnTestConnection) {
        dom.btnTestConnection.disabled = false;
        dom.btnTestConnection.textContent = 'Test Connection';
      }
    }
  });

  // Toolbar
  dom.btnRefresh?.addEventListener('click', () => {
    if (!state.isLoading) runAnalysis();
  });
  dom.btnCopyJson?.addEventListener('click', copyAllAsJson);
  dom.btnCopySummary?.addEventListener('click', copySummary);
  dom.btnExportCsv?.addEventListener('click', exportCsv);

  // Search
  dom.searchInput?.addEventListener('input', () => {
    state.searchQuery = dom.searchInput.value;
    dom.searchClear?.classList.toggle('visible', !!state.searchQuery);
    applyFilters();
  });
  dom.searchClear?.addEventListener('click', () => {
    if (dom.searchInput) dom.searchInput.value = '';
    state.searchQuery = '';
    dom.searchClear?.classList.remove('visible');
    applyFilters();
  });

  // Type filter
  dom.typeFilter?.addEventListener('change', () => {
    state.typeFilter = dom.typeFilter.value;
    applyFilters();
  });

  // Sort
  dom.sortBy?.addEventListener('change', () => {
    state.sortBy = dom.sortBy.value;
    applyFilters();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSettings();
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      dom.searchInput?.focus();
    }
  });
}

// ─── INIT ───
async function init() {
  try {
    initEvents();
    listenTabChanges();

    const saved = await loadSettings();

    if (saved && saved.token) {
      const baseUrl = saved.baseUrl || DEFAULT_SONAR_URL;
      const prInfo = await getActiveTabPrInfo();

      if (prInfo && prInfo.projectKey && prInfo.prNumber) {
        state.settings = {
          baseUrl: baseUrl,
          token: saved.token,
          projectKey: prInfo.projectKey,
          prNumber: prInfo.prNumber,
        };
        await saveSettings(state.settings);
      } else if (saved.projectKey && saved.prNumber) {
        state.settings = { ...saved, baseUrl: baseUrl };
      } else {
        state.settings = { ...saved, baseUrl: baseUrl };
        showSection('setup');
        updateConnectionBar(false, 'Navigate to a GitHub PR', null);
        showToast('Navigate to a GitHub PR page or enter settings manually', 'info');
        return;
      }

      runAnalysis();
    } else {
      showSection('setup');
      updateConnectionBar(false, 'Not connected', null);
    }
  } catch (error) {
    showSection('setup');
    updateConnectionBar(false, 'Initialization error', null);
    showToast(`Initialization error: ${error.message}`, 'error');
  }
}

init();
