/**
 * @module shared/core.js
 * @description Global state, navigation, page routing, theme/language switching, settings
 *
 * MAD Training Studio — Interpretation Practice Platform
 * © 2025 InterpretLab. All rights reserved.
 */

// ═══════════════════════════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════════════════════════

/** @type {string} Current training mode (e.g. 'shadowing', 'simultaneous', 'consecutive'). */
let currentMode = 'shadowing';

/** @type {string} Current playback pace (e.g. 'slow', 'normal', 'fast'). */
let currentPace = 'slow';

/** @type {?HTMLVideoElement} Reference to the video element used in the current session. */
let currentSessionVideo = null;

// ═══════════════════════════════════════════════════════════════════════════════
//  YOUTUBE IFRAME API
// ═══════════════════════════════════════════════════════════════════════════════

/** @type {?YT.Player} The global YouTube player instance. */
let ytPlayer = null;

/** @type {boolean} Whether the YouTube player is currently playing. */
let isPlaying = false;

/** @type {boolean} Whether the YouTube player audio is muted. */
let isMuted = false;

/** @type {?number} Timer ID for automatic segment switching. */
let autoSegTimer = null;

/**
 * Mapping of difficulty levels to segment duration in seconds.
 * @type {{beginner:number, moderate:number, advanced:number, expert:number}}
 */
const SEGMENT_SECS = { beginner: 20, moderate: 30, advanced: 45, expert: 60 };

/**
 * Immediately-invoked function expression (IIFE) that loads the YouTube IFrame API
 * script asynchronously if it has not already been injected into the page.
 */
(function loadYTAPI() {
  // Guard: do not inject the script more than once.
  if (document.getElementById('yt-api-script')) return;

  // Create a new <script> element for the YouTube IFrame API.
  const s = document.createElement('script');

  // Assign a stable ID so the guard check works on subsequent runs.
  s.id = 'yt-api-script';

  // Set the source to the official YouTube IFrame API endpoint.
  s.src = 'https://www.youtube.com/iframe_api';

  // Append the script to <head>; the browser will fetch and evaluate it.
  document.head.appendChild(s);
})();

/**
 * Global callback required by the YouTube IFrame API.
 * Called automatically by the API once it has finished loading.
 * Currently a no-op because individual pages initialise their own players.
 */
window.onYouTubeIframeAPIReady = function() {};

// ═══════════════════════════════════════════════════════════════════════════════
//  PARTIAL LOADER (lazy page injection)
// ═══════════════════════════════════════════════════════════════════════════════

/** Cache of already-fetched partial HTML strings. */
const _PARTIAL_CACHE = {};
/** In-flight fetch promises so concurrent navigations don't duplicate requests. */
const _PARTIAL_INFLIGHT = {};
/** Maps page identifiers to their corresponding partial file names. */
const _PARTIAL_MAP = {
  dashboard: 'page-dashboard.html',
  practice:  'page-practice.html',
  progress:  'page-progress.html',
  learn:     'page-learn.html',
  community: 'page-community.html',
  settings:  'page-settings.html',
};

/**
 * Fetches an HTML partial from the server, caches it, and injects it into
 * the target DOM container.  If the container already has children, this
 * is a no-op (the partial was loaded on a previous visit).
 */
async function _loadPartial(page) {
  const container = document.getElementById('page-' + page);
  if (!container) return;
  if (container.children.length > 0) return;

  const filename = _PARTIAL_MAP[page];
  if (!filename) return;

  if (_PARTIAL_CACHE[page]) {
    container.innerHTML = _PARTIAL_CACHE[page];
    return;
  }

  if (_PARTIAL_INFLIGHT[page]) {
    const html = await _PARTIAL_INFLIGHT[page];
    container.innerHTML = html;
    return;
  }

  const promise = fetch('/static/html/partials/' + filename)
    .then(r => {
      if (!r.ok) throw new Error(`Partial ${filename} returned ${r.status}`);
      return r.text();
    });

  _PARTIAL_INFLIGHT[page] = promise;

  try {
    const html = await promise;
    _PARTIAL_CACHE[page] = html;
    container.innerHTML = html;
  } catch (err) {
    console.error('[PartialLoader] Failed to load', filename, err);
    container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--red)">
      <div style="font-size:18px;font-weight:700;margin-bottom:8px">Failed to load page</div>
      <div style="font-size:13px;color:var(--dim)">${err.message}</div>
    </div>`;
  } finally {
    delete _PARTIAL_INFLIGHT[page];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  OVERLAY PARTIAL LOADER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Lazy-loads simulation overlay HTML into its container the first time
 * the overlay is shown.
 */
async function _loadOverlay(overlayId, filename) {
  const container = document.getElementById(overlayId);
  if (!container) return false;
  if (container.children.length > 0) return true;

  if (!_PARTIAL_CACHE[overlayId]) {
    try {
      const r = await fetch('/static/html/partials/' + filename);
      if (!r.ok) throw new Error(`${filename} → ${r.status}`);
      _PARTIAL_CACHE[overlayId] = await r.text();
    } catch (err) {
      console.error('[OverlayLoader]', err);
      return false;
    }
  }
  container.innerHTML = _PARTIAL_CACHE[overlayId];
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PAGE ROUTING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Switches the visible "page" within the single-page application (SPA).
 * If the target page container is empty, the corresponding HTML partial is
 * fetched from /static/html/partials/ and injected before the page is shown.
 */
async function goPage(page) {
  currentPage = page;

  // Lazy-load partial on first visit
  if (_PARTIAL_MAP[page]) {
    await _loadPartial(page);
  }

  document.querySelectorAll('.studio-page').forEach(p => {
    p.classList.remove('active');
    p.style.display = 'none';
  });

  const el = document.getElementById('page-' + page);
  if (el) {
    el.classList.add('active');
    el.style.display = '';
  }

  document.querySelectorAll('.snl').forEach(a => a.classList.remove('active'));
  const activeBtn = document.getElementById('snl-' + page);
  if (activeBtn) activeBtn.classList.add('active');

  if (page === 'dashboard') loadDashboard();
  if (page === 'progress')  loadProgress();
  if (page === 'learn')     loadLearnPage();
  if (page === 'practice') {
    if (typeof loadPracticePage === 'function') loadPracticePage();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ONBOARDING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Stores the user's answers during the onboarding wizard.
 * Keys correspond to step indices; values can be null, a primitive, or an array.
 * @type {{0:?*, 1:?*, 2:Array, 3:?*, 4:?*}}
 */
const OB_ANSWERS = { 0: null, 1: null, 2: [], 3: null, 4: null };

/** @type {number} Current step index within the onboarding flow. */
let obStep = 0;

// ═══════════════════════════════════════════════════════════════════════════════
//  PRACTICE TABS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Activates a specific sub-tab inside the Practice page.
 * Ensures the Practice page itself is visible, then shows the
 * requested tab content and highlights the corresponding tab button.
 *
 * @param {string} tab - The tab identifier to activate (e.g. 'video', 'scenarios', 'audio').
 * @returns {void}
 */
function goPracticeTab(tab) {
  // Ensure the Practice page itself is the currently displayed page.
  goPage('practice');

  // Hide every practice content panel and strip the active class.
  document.querySelectorAll('.prac-content').forEach(c => {
    c.classList.remove('active');   // Remove active styling.
    c.style.display = 'none';       // Force-hide the panel.
  });

  // Remove the active highlight from every practice tab button.
  document.querySelectorAll('.prac-tab').forEach(b => b.classList.remove('active'));

  // Retrieve the DOM element for the requested tab content.
  const content = document.getElementById('prac-' + tab);

  // Show the content panel and mark it active, if it exists in the DOM.
  if (content) {
    content.classList.add('active');
    content.style.display = 'block';
  }

  // Find the tab button whose data-tab attribute matches the requested tab.
  const btn = document.querySelector(`.prac-tab[data-tab="${tab}"]`);

  // Highlight the matching tab button, if found.
  if (btn) btn.classList.add('active');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  COMMUNITY TABS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Switches visibility between the three community sub-sections
 * (forum, leaderboard, resources) and highlights the clicked tab button.
 *
 * @param {string} tab - The community tab to show ('forum' | 'leaderboard' | 'resources').
 * @param {?HTMLElement} btn - The button element that was clicked; used for active-state styling.
 * @returns {void}
 */
function goCommunityTab(tab, btn) {
  // Array of all valid community tab identifiers.
  ['forum', 'leaderboard', 'resources'].forEach(t => {
    // Locate the DOM container for this tab.
    const el = document.getElementById('comm-' + t);

    // Toggle visibility: show the selected tab, hide the others.
    if (el) el.style.display = t === tab ? 'block' : 'none';
  });

  // Remove the active highlight from every community tab button.
  document.querySelectorAll('.comm-tab').forEach(b => b.classList.remove('active'));

  // Highlight the clicked button, if provided.
  if (btn) btn.classList.add('active');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GENERIC TAB SWITCHER (LEGACY)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generic tab switcher — now a no-op.
 * The new page structure uses {@link goPage} and {@link goPracticeTab}
 * instead of the old monolithic tab system.
 *
 * @param {string} name - Legacy tab name (ignored).
 * @param {Event} e - The click event (ignored).
 * @returns {void}
 */
function switchTab(name, e) {
  // No-op in new structure — use goPage / goPracticeTab.
}

// ═══════════════════════════════════════════════════════════════════════════════
//  THEME ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Retrieve the user's saved theme preference from localStorage,
 * falling back to 'dark' if nothing has been stored yet.
 * @type {string}
 */
let currentTheme = localStorage.getItem('mad-theme') || 'dark';

/**
 * CSS custom-property values that define the light-theme colour palette.
 * Keys are CSS variable names; values are hex colour strings.
 * @type {Object<string, string>}
 */
const LIGHT_VARS = {
  '--bg0': '#f4f6fb',   // Deepest background layer.
  '--bg1': '#eef1f8',   // Secondary background.
  '--bg2': '#ffffff',   // Primary surface (cards, panels).
  '--bg3': '#f0f3f9',   // Tertiary background.
  '--bg4': '#e4e8f2',   // Quaternary background / dividers.
  '--border': '#dde2ef',// Border and separator colour.
  '--text': '#1a2240',  // Primary text colour.
  '--dim': '#6b7a9e'    // Muted / secondary text colour.
};

/**
 * Low-level helper that applies or removes the light-theme CSS variables.
 * When enabling the light theme, every key in {@link LIGHT_VARS} is written
 * to the document root as an inline style. When disabling, those properties
 * are removed so the dark-theme defaults (defined in the stylesheet) take over.
 *
 * @param {boolean} isLight - true to apply light-theme variables; false to revert to dark.
 * @returns {void}
 * @private
 */
function _applyVars(isLight) {
  if (isLight) {
    // Iterate over every light-theme variable and set it on :root.
    Object.entries(LIGHT_VARS).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));

    // Override the <body> background directly for immediate visual feedback.
    document.body.style.background = '#f4f6fb';

    // Add a data attribute so CSS selectors can target the light theme.
    document.body.setAttribute('data-theme', 'light');
  } else {
    // Remove each light-theme variable from :root, allowing dark-theme defaults to surface.
    Object.keys(LIGHT_VARS).forEach(k => document.documentElement.style.removeProperty(k));

    // Clear the inline background so the stylesheet's dark background applies.
    document.body.style.background = '';

    // Remove the data-theme attribute to indicate dark mode.
    document.body.removeAttribute('data-theme');
  }
}

// ── System theme preference listener ───────────────────────────────────────────

/**
 * MediaQueryList that tracks the OS-level "prefers-color-scheme: light" setting.
 * Used when the user has selected the 'system' theme option.
 * @type {MediaQueryList}
 * @private
 */
const _sysMQ = window.matchMedia('(prefers-color-scheme: light)');

// Attach a listener so the UI reacts live when the OS theme changes.
_sysMQ.addEventListener('change', e => {
  // Only react automatically if the user has explicitly chosen "system" mode.
  if (currentTheme === 'system') _applyVars(e.matches);
});

// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Applies a full theme change: persists the choice, updates UI chrome,
 * refreshes the theme icon, and calls {@link _applyVars} to toggle CSS variables.
 *
 * @param {string} theme - The theme identifier: 'dark', 'light', or 'system'.
 * @param {?HTMLElement} btn - Optional button element to highlight as active.
 * @returns {void}
 */
function applyTheme(theme, btn) {
  // Update the in-memory theme tracker.
  currentTheme = theme;

  // Persist the choice across browser sessions.
  localStorage.setItem('mad-theme', theme);

  // Remove the active highlight from every theme-toggle button.
  document.querySelectorAll('.theme-toggle .theme-btn').forEach(b => b.classList.remove('active'));

  // Highlight the specific button that triggered the change, if provided.
  if (btn) btn.classList.add('active');

  // Grab a reference to the theme icon container (used by the header / nav).
  const icon = document.getElementById('theme-icon-btn');

  // Refresh the SVG icon visibility to match the new theme.
  _updateThemeIcon(theme);

  // Route to the correct low-level helper based on the chosen theme.
  if (theme === 'light') {
    // Explicit light mode: apply all light-theme variables.
    _applyVars(true);
  } else if (theme === 'system') {
    // System mode: derive the effective theme from the current OS preference.
    _applyVars(_sysMQ.matches);
  } else {
    // Explicit dark mode (or any unknown value): revert to dark defaults.
    _applyVars(false);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Cycles the global theme forward through the sequence:
 * dark → light → system → dark …
 * Typically bound to a click on the header theme icon.
 *
 * @returns {void}
 */
function cycleTheme() {
  // Ordered list of supported themes.
  const themes = ['dark', 'light', 'system'];

  // Compute the next index, wrapping around via modulo arithmetic.
  const next = themes[(themes.indexOf(currentTheme) + 1) % themes.length];

  // Apply the newly calculated theme; no specific button to highlight.
  applyTheme(next, null);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  THEME DROPDOWN
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Toggles the visibility of the theme-selection dropdown.
 * Also closes the language dropdown to prevent overlapping menus.
 *
 * @param {Event} e - The click event; stopPropagation prevents the document click handler from immediately closing it.
 * @returns {void}
 */
function toggleThemeDD(e) {
  // Prevent the event from bubbling up to the document-level click listener.
  e.stopPropagation();

  // Locate the theme dropdown container.
  const dd = document.getElementById('theme-dd');

  // Guard: abort if the dropdown element is not present in the DOM.
  if (!dd) return;

  // Toggle the 'open' class (CSS controls visibility / opacity / transform).
  dd.classList.toggle('open');

  // Locate the language dropdown container.
  const ldd = document.getElementById('lang-dd');

  // If the language dropdown is open, close it to avoid visual overlap.
  if (ldd) ldd.classList.remove('open');
}

// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Selects a specific theme from the dropdown and closes the menu.
 *
 * @param {string} t - The theme to activate ('dark' | 'light' | 'system').
 * @returns {void}
 */
function pickTheme(t) {
  // Apply the chosen theme globally.
  applyTheme(t, null);

  // Synchronise the header icon to match.
  _updateThemeIcon(t);

  // Close the theme dropdown.
  const dd = document.getElementById('theme-dd');
  if (dd) dd.classList.remove('open');
}

// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Updates the visibility of the sun / moon / system SVG icons in the header
 * so only the icon matching the active theme is shown. Also syncs the active
 * state of dropdown items.
 *
 * @param {string} t - The currently active theme identifier.
 * @returns {void}
 * @private
 */
function _updateThemeIcon(t) {
  // Cache references to the three possible theme SVG icons.
  const sun  = document.getElementById('theme-svg-sun');
  const moon = document.getElementById('theme-svg-moon');
  const sys  = document.getElementById('theme-svg-sys');

  // If the sun icon is absent, the header markup is not present; abort.
  if (!sun) return;

  // Show the sun icon when the theme is 'light'; hide otherwise.
  sun.style.display  = t === 'light'  ? '' : 'none';

  // Show the moon icon when the theme is 'dark'; hide otherwise.
  moon.style.display = t === 'dark'   ? '' : 'none';

  // Show the system icon when the theme is 'system'; hide otherwise.
  sys.style.display  = t === 'system' ? '' : 'none';

  // Iterate over every dropdown item and toggle the 'active' class
  // based on whether its data attribute matches the current theme.
  document.querySelectorAll('.theme-dd-item').forEach(i => {
    i.classList.toggle('active', i.dataset.t === t);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LANGUAGE PICKER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Static metadata for each supported UI language.
 * Keys are ISO 639-1 language codes; values contain flag emoji, display code, and label.
 * @type {Object<string, {flag:string, code:string, label:string}>}
 */
const LANG_DATA = {
  en: { flag: '🇬🇧', code: 'EN', label: 'English' },
  ar: { flag: '🇸🇦', code: 'AR', label: 'Arabic' },
  fr: { flag: '🇫🇷', code: 'FR', label: 'French' },
  es: { flag: '🇪🇸', code: 'ES', label: 'Spanish' },
};

// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Toggles the visibility of the language-selection dropdown.
 * Also closes the theme dropdown to prevent overlapping menus.
 *
 * @param {Event} e - The click event; stopPropagation prevents the document click handler from immediately closing it.
 * @returns {void}
 */
function toggleLangDD(e) {
  // Prevent the event from bubbling up to the document-level click listener.
  e.stopPropagation();

  // Locate the language dropdown container.
  const dd = document.getElementById('lang-dd');

  // Guard: abort if the dropdown element is not present in the DOM.
  if (!dd) return;

  // Toggle the 'open' class (CSS controls visibility / opacity / transform).
  dd.classList.toggle('open');

  // Locate the theme dropdown container.
  const tdd = document.getElementById('theme-dd');

  // If the theme dropdown is open, close it to avoid visual overlap.
  if (tdd) tdd.classList.remove('open');
}

// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sets the active UI language, persists the choice, updates the header
 * flag / label, highlights the correct dropdown item, and triggers
 * any registered i18n callbacks.
 *
 * @param {string} code  - ISO 639-1 language code (e.g. 'en', 'ar', 'fr', 'es').
 * @param {string} flag  - Flag emoji to display in the header trigger.
 * @param {string} abbr  - Short language code label (deprecated in UI; kept for API compatibility).
 * @param {string} label - Human-readable language name used for accessibility / tooltips.
 * @returns {void}
 */
function setLang(code, flag, abbr, label) {
  // Persist the selected language code for cross-session recall.
  localStorage.setItem('mad-ui-lang', code);

  // Cache references to the header language-display elements.
  const flagEl = document.getElementById('lang-flag');   // Emoji flag container.
  const codeEl = document.getElementById('lang-code');   // Textual code label.
  const trigger = document.getElementById('lang-trigger'); // Clickable trigger button.

  // Update the flag emoji, if the element exists.
  if (flagEl) flagEl.textContent = flag;

  // Clear the code label (design decision: show only flag in compact header).
  if (codeEl) codeEl.textContent = '';

  // Store the human-readable label as a data attribute for tooltips / screen readers.
  if (trigger) trigger.setAttribute('data-label', label);

  // Close the language dropdown and synchronise the active item highlight.
  const dd = document.getElementById('lang-dd');
  if (dd) {
    // Collapse the dropdown menu.
    dd.classList.remove('open');

    // Iterate over every language item in the dropdown.
    dd.querySelectorAll('.lang-dd-item').forEach(i =>
      // Toggle the 'active' class by inspecting the inline onclick attribute for the language code.
      i.classList.toggle('active', i.getAttribute('onclick').includes("'" + code + "'"))
    );
  }

  // Invoke the global UI-language setter (placeholder for future i18n wiring).
  setUILang(code);
}

// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Reads the persisted language preference from localStorage and restores
 * the header flag / label on page load. Called once during application boot.
 *
 * @returns {void}
 * @private
 */
function _initLangPicker() {
  // Retrieve the saved language code, defaulting to English if absent.
  const saved = localStorage.getItem('mad-ui-lang') || 'en';

  // Look up the metadata object for the saved language, falling back to English.
  const d = LANG_DATA[saved] || LANG_DATA['en'];

  // Cache references to the header language-display elements.
  const flagEl = document.getElementById('lang-flag');
  const codeEl = document.getElementById('lang-code');
  const trigger = document.getElementById('lang-trigger');

  // Restore the flag emoji.
  if (flagEl) flagEl.textContent = d.flag;

  // Restore the short code label.
  if (codeEl) codeEl.textContent = d.code;

  // Restore the human-readable label as a data attribute.
  if (trigger) trigger.setAttribute('data-label', d.label);
}

// ── Global click listener to auto-close dropdowns ──────────────────────────────

/**
 * Document-level click handler that closes the theme and language dropdowns
 * whenever the user clicks anywhere outside of them.
 */
document.addEventListener('click', () => {
  // Locate the theme dropdown.
  const tdd = document.getElementById('theme-dd');

  // Locate the language dropdown.
  const ldd = document.getElementById('lang-dd');

  // Collapse the theme dropdown if it exists.
  if (tdd) tdd.classList.remove('open');

  // Collapse the language dropdown if it exists.
  if (ldd) ldd.classList.remove('open');
});

// ═══════════════════════════════════════════════════════════════════════════════
//  LEARN PAGE — PHASE COLLAPSE + SIDEBAR
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Persists the chosen UI language and serves as a hook for future
 * internationalisation (i18n) wiring (Phase 3 roadmap item).
 *
 * @param {string} lang - ISO 639-1 language code to activate.
 * @returns {void}
 */
function setUILang(lang) {
  // Persist the language choice.
  localStorage.setItem('mad-ui-lang', lang);

  // Placeholder — full i18n to be wired in Phase 3.
  // For now just persist the selection so it survives page reloads.
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AUTHENTICATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Logs the current user out after confirming via a browser dialog.
 * Clears all localStorage keys and reloads the page to reset application state.
 *
 * @returns {void}
 */
function logoutUser() {
  // Present a confirmation dialog to prevent accidental logout.
  if (!confirm('Log out of MAD Training Studio?')) return;

  // Clear every key stored in localStorage (user data, settings, progress, etc.).
  localStorage.clear();

  // Force a full page reload to return the application to a clean, logged-out state.
  location.reload();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SETTINGS HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Highlights the clicked difficulty / experience level button inside the Settings page.
 *
 * @param {string} level - The selected level identifier (e.g. 'beginner', 'advanced').
 * @param {?HTMLElement} btn - The button element that was clicked.
 * @returns {void}
 */
function setSettingsLevel(level, btn) {
  // Remove the active highlight from every level button in the settings section.
  document.querySelectorAll('.settings-section .theme-btn').forEach(b => b.classList.remove('active'));

  // Highlight the clicked button, if provided.
  if (btn) btn.classList.add('active');
}

// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Gathers values from the Settings form, persists the user's display name,
 * updates the Dashboard greeting, and shows a transient success indicator
 * on the Save button.
 *
 * @returns {void}
 */
function saveSettings() {
  // Read the "First Name" input value, defaulting to empty string if the element is missing.
  const first = document.getElementById('settings-first')?.value || '';

  // Read the "Last Name" input value, defaulting to empty string if the element is missing.
  const last  = document.getElementById('settings-last')?.value || '';

  // Concatenate first and last names, trimming extraneous whitespace.
  const fullName = `${first} ${last}`.trim();

  // Persist the full display name for cross-session recall.
  localStorage.setItem('mad-name', fullName);

  // Locate the Dashboard greeting element.
  const greeting = document.getElementById('dash-greeting');

  // Update the greeting text if the element exists.
  if (greeting) greeting.textContent = `Welcome back, ${first} ${last}!`;

  // Capture a reference to the button that triggered the save (via the global event object).
  const btn = event?.target;

  // If we have a valid button reference, provide brief visual feedback.
  if (btn) {
    // Change button text to indicate success.
    btn.textContent = 'Done Saved!';

    // Change button background to the success green colour.
    btn.style.background = 'var(--green)';

    // Revert the button text and background after 2 seconds.
    setTimeout(() => {
      btn.textContent = 'Save Settings';  // Restore original label.
      btn.style.background = '';          // Remove inline background override.
    }, 2000);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DASHBOARD LOADER
// ═══════════════════════════════════════════════════════════════════════════════

// (Placeholder — dashboard-specific loaders such as loadDashboard(), loadProgress(),
// and loadLearnPage() are defined in sibling modules and invoked from goPage().)
