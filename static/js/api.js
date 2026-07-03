/**
 * MAD Training Studio — API Client
 * Centralized HTTP layer with error handling, file upload, auth helpers, and toast notifications.
 *
 * Imported first in the page so every module can call:
 *   import { api, apiUpload, getUserId, showToast } from './js/api.js';
 *
 * Or when loaded with a regular <script> tag the globals are available:
 *   api(), apiUpload(), getUserId(), showToast()
 */

// ── Base URL ─────────────────────────────────────────────────────────
const BASE_URL = window.location.origin;

// ── Internal helpers ─────────────────────────────────────────────────
function _buildUrl(endpoint) {
  const path = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
  return BASE_URL + path;
}

function _getAuthHeaders() {
  const headers = {};
  const userId = getUserId();
  if (userId) headers['X-User-Id'] = userId;
  return headers;
}

/**
 * Generic API call wrapper with JSON parsing, error handling, and timeout.
 *
 * @param {string} endpoint        — API path (e.g. '/api/sessions')
 * @param {object} options         — fetch options (method, body, headers, etc.)
 * @param {number} [timeoutMs=30000] — request timeout in milliseconds
 * @returns {Promise<any>}         — parsed JSON response
 */
async function api(endpoint, options = {}, timeoutMs = 30000) {
  const url = _buildUrl(endpoint);
  const opts = {
    ...options,
    headers: {
      ..._getAuthHeaders(),
      ...(options.headers || {}),
    },
  };

  // If body is FormData, don't set Content-Type — let the browser add the boundary.
  if (opts.body instanceof FormData) {
    delete opts.headers['Content-Type'];
  } else if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof Blob)) {
    // Auto-stringify plain objects and set JSON header
    opts.body = JSON.stringify(opts.body);
    opts.headers['Content-Type'] = 'application/json';
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  opts.signal = controller.signal;

  try {
    const response = await fetch(url, opts);
    clearTimeout(timeoutId);

    // Handle empty body (204 No Content, etc.)
    if (response.status === 204 || response.headers.get('content-length') === '0') {
      return null;
    }

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const msg = data?.error || data?.message || `HTTP ${response.status}`;
      throw new Error(msg);
    }

    return data;
  } catch (err) {
    clearTimeout(timeoutId);

    if (err.name === 'AbortError') {
      console.error(`[API] Request timeout: ${endpoint}`);
      throw new Error('Request timed out — please check your connection.');
    }

    console.error(`[API] ${endpoint} →`, err);
    throw err;
  }
}

/**
 * Convenience wrapper for multipart / file-upload POST requests.
 *
 * @param {string} endpoint  — API path
 * @param {FormData} formData — pre-built FormData instance
 * @param {number} [timeoutMs=60000] — longer default for uploads
 * @returns {Promise<any>}
 */
async function apiUpload(endpoint, formData, timeoutMs = 60000) {
  return api(endpoint, { method: 'POST', body: formData }, timeoutMs);
}

// ── User identity ────────────────────────────────────────────────────
const USER_ID_KEY = 'mad_user_id';

/**
 * Get or create a persistent anonymous user ID.
 * Used to identify the user across sessions without requiring login.
 *
 * @returns {string} UUID v4
 */
function getUserId() {
  let id = localStorage.getItem(USER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : _fallbackUUID();
    localStorage.setItem(USER_ID_KEY, id);
  }
  return id;
}

/** Fallback UUID generator for browsers without crypto.randomUUID */
function _fallbackUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ── Toast notifications ────────────────────────────────────────────
const TOAST_TTL_MS = 4000;

/**
 * Show a toast notification in the bottom-right corner.
 *
 * @param {string} message  — text to display
 * @param {string} [type='info'] — 'info' | 'success' | 'warning' | 'error'
 */
function showToast(message, type = 'info') {
  const container = _ensureToastContainer();

  const toast = document.createElement('div');
  toast.className = `mad-toast mad-toast--${type}`;
  toast.textContent = message;

  // Styling inline so the toast works even before CSS is loaded
  toast.style.cssText = `
    padding: 12px 18px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    color: #fff;
    margin-top: 8px;
    opacity: 0;
    transform: translateY(10px);
    transition: all 0.35s ease;
    cursor: default;
    pointer-events: auto;
    max-width: 320px;
    word-break: break-word;
    box-shadow: 0 4px 12px rgba(0,0,0,0.25);
  `;

  const colors = {
    info:    { bg: '#4878f0', border: '#4878f0' },
    success: { bg: '#22c55e', border: '#22c55e' },
    warning: { bg: '#e8971e', border: '#e8971e' },
    error:   { bg: '#f43f5e', border: '#f43f5e' },
  };
  const c = colors[type] || colors.info;
  toast.style.background = c.bg;
  toast.style.borderLeft = `4px solid ${c.border}`;

  container.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  // Auto-remove
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 350);
  }, TOAST_TTL_MS);
}

function _ensureToastContainer() {
  let container = document.getElementById('mad-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'mad-toast-container';
    container.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 10000;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      pointer-events: none;
    `;
    document.body.appendChild(container);
  }
  return container;
}

// ── Convenience HTTP verbs (optional) ──────────────────────────────
async function apiGet(endpoint, options = {}) {
  return api(endpoint, { method: 'GET', ...options });
}

async function apiPost(endpoint, body, options = {}) {
  return api(endpoint, { method: 'POST', body, ...options });
}

async function apiDelete(endpoint, options = {}) {
  return api(endpoint, { method: 'DELETE', ...options });
}

// ── Export / global registration ─────────────────────────────────────
// ESM-style named exports (when imported as a module)
export { api, apiGet, apiPost, apiDelete, apiUpload, getUserId, showToast };

// Global registration for legacy <script> tag loading
if (typeof window !== 'undefined') {
  window.api = api;
  window.apiGet = apiGet;
  window.apiPost = apiPost;
  window.apiDelete = apiDelete;
  window.apiUpload = apiUpload;
  window.getUserId = getUserId;
  window.showToast = showToast;
}
