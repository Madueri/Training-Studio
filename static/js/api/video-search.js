/**
 * @module api/video-search.js
 * @description Video search API — YouTube search, result rendering, sorting, sidebar
 *
 * MAD Training Studio — Interpretation Practice Platform
 * © 2025 InterpretLab. All rights reserved.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. Main Video Search
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @description Executes the primary video search workflow. Gathers filter values
 *   from the DOM, builds a FormData payload, POSTs it to /api/search-videos,
 *   and renders the returned results as a grid.
 * @async
 * @returns {Promise<void>} Resolves when the search completes or an error is rendered.
 */
async function runVideoSearch() {
  // ── Read search parameters from DOM controls ──────────────────────────────
  const field = document.getElementById('interp-spec').value;         // e.g. 'medical', 'legal'
  const lang = getLangPair();                                          // source → target language pair
  const dur = parseInt(document.getElementById('interp-dur').value || 5); // desired duration in minutes
  const topic = document.getElementById('interp-topic').value.trim();  // optional topic filter
  const area = document.getElementById('video-results-area');          // container for results / spinner

  // ── Inject loading spinner into the results area ──────────────────────────
  area.innerHTML = `<div class="search-spinner"><div class="spin">⚙</div><div style="margin-top:12px;font-size:13px;font-weight:600;color:var(--gold)">AI is finding & analyzing videos…</div><div style="font-size:12px;color:var(--dim);margin-top:4px">Matching ${field} content · ${currentPace} pace${topic ? ' · '+topic : ''}</div></div>`;

  // ── Collect additional optional filters ───────────────────────────────────
  const fieldType = document.getElementById('interp-spec-type')?.value || interpFieldType || '';
  const difficulty = document.getElementById('interp-difficulty')?.value || 'intermediate';
  // Source dialect: use shadow-dialect if in shadowing mode, otherwise lang-source-dialect
  const srcDialect = document.getElementById(currentMode === 'shadowing' ? 'shadow-dialect' : 'lang-source-dialect')?.value || '';
  const tgtDialect = document.getElementById('lang-target-dialect')?.value || '';

  // ── Assemble FormData payload for the backend ─────────────────────────────
  const fd = new FormData();
  fd.append('mode', currentMode);
  fd.append('field', field);
  fd.append('field_type', fieldType);
  fd.append('topic', topic);
  fd.append('language', lang);
  fd.append('duration', dur);
  fd.append('pace', currentPace);
  fd.append('difficulty', difficulty);
  fd.append('source_dialect', srcDialect);
  fd.append('target_dialect', tgtDialect);
  fd.append('num_speakers', interpSpeakers);

  // ── Execute the POST request and handle response ──────────────────────────
  try {
    const r = await fetch('/api/search-videos', { method: 'POST', body: fd });
    const videos = await r.json();
    // If the server reports an application-level error, show a warning and abort
    if (videos.error) { area.innerHTML = `<div class="error">Warning: ${videos.error}</div>`; return; }
    // Otherwise render the grid with original search parameters attached
    renderVideoResultsGrid(videos, { field, topic, lang, dur });
  } catch(e) {
    // Network or unexpected JS error — show a user-friendly message
    area.innerHTML = `<div class="error">Search failed — is the server running?</div>`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Render Search Results Grid
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @description Renders the video search results as an interactive grid.
 *   Builds a header with a sort dropdown, creates thumbnail cards,
 *   difficulty badges, and wires click handlers that open a practice session.
 * @param {Array<Object>} videos - Array of video metadata objects returned by the API.
 * @param {Object} params - The original search parameters (field, topic, lang, dur).
 * @returns {void}
 */
function renderVideoResultsGrid(videos, params) {
  const area = document.getElementById('video-results-area');
  // Guard: if no videos came back, render a friendly empty-state message
  if (!videos.length) { area.innerHTML = '<div style="padding:30px;text-align:center;color:var(--dim)">No results found.</div>'; return; }

  // Difficulty string → CSS class mapping used for badge styling
  const diffClass = { Beginner:'diff-beginner', Moderate:'diff-moderate', Advanced:'diff-advanced', Expert:'diff-expert' };

  // Store the full, un-sorted list globally so sortResults() can revert to original order
  window._allSearchedVideos = [...videos];

  // Clear previous content (spinner or old results)
  area.innerHTML = '';

  // ── Header row with sort control ──────────────────────────────────────────
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px';
  header.innerHTML = `
    <span style="font-size:13px;color:var(--dim)">Found <strong style="color:var(--text)">${videos.length} videos</strong></span>
    <div style="display:flex;align-items:center;gap:8px">
      <label style="font-size:12px;color:var(--dim)">Sort by</label>
      <select id="results-sort" onchange="sortResults(this.value)"
        style="background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:5px 10px;border-radius:6px;font-size:12px;cursor:pointer">
        <option value="default">Relevance</option>
        <option value="difficulty_asc">Difficulty ↑ (Beginner first)</option>
        <option value="difficulty_desc">Difficulty ↓ (Expert first)</option>
        <option value="duration_asc">Duration ↑ (Shortest first)</option>
        <option value="duration_desc">Duration ↓ (Longest first)</option>
        <option value="wpm_asc">Pace ↑ (Slowest first)</option>
        <option value="wpm_desc">Pace ↓ (Fastest first)</option>
      </select>
    </div>`;
  area.appendChild(header);

  // ── Grid container ────────────────────────────────────────────────────────
  const grid = document.createElement('div');
  grid.id = 'results-grid';
  grid.className = 'video-results-grid';
  area.appendChild(grid);

  // ── Iterate each video and build its card ─────────────────────────────────
  videos.forEach((v, i) => {
    // Determine the CSS class for the difficulty badge
    const cls = diffClass[v.difficulty] || 'diff-moderate';

    // Create the outer card container
    const card = document.createElement('div');
    card.className = 'vr-card';
    // Clicking a card opens the session for this video's current index
    card.onclick = () => openSession(i);

    // ── Thumbnail ──────────────────────────────────────────────────────────
    if (v.thumbnail) {
      const img = document.createElement('img');
      img.src = v.thumbnail;
      img.className = 'vr-thumb';
      img.alt = v.title || '';
      // Fallback: if thumbnail fails to load, replace with a placeholder div
      img.onerror = function() {
        const ph = document.createElement('div');
        ph.className = 'vr-thumb-placeholder';
        ph.textContent = '';
        this.parentNode.replaceChild(ph, this);
      };
      card.appendChild(img);
    } else {
      // No thumbnail provided — use a blank placeholder
      const ph = document.createElement('div');
      ph.className = 'vr-thumb-placeholder';
      ph.textContent = '';
      card.appendChild(ph);
    }

    // ── Body (title, speaker, type, meta) ──────────────────────────────────
    const body = document.createElement('div');
    body.className = 'vr-body';

    // Map video_type enum to human-readable label
    const typeLabel = {
      opi_call_simulation: 'OPI Simulation', conference_speech: 'Conference Speech',
      press_conference: 'Press Conference', un_address: 'UN Address',
      medical_briefing: 'Medical Briefing', legal_proceeding: 'Legal Proceeding',
      news_broadcast: 'News Broadcast', lecture: 'Lecture',
      documentary: 'Documentary', interview: 'Interview',
      parliamentary_debate: 'Parliamentary Debate'
    }[v.video_type] || '';

    // Inject inner HTML: title, speaker, type badge, verified-pauses badge, WPM badge, context, meta
    body.innerHTML = `
      <div class="vr-title">${v.title||'Untitled'}</div>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap">
        <span class="vr-speaker">${v.speaker||''}</span>
        ${typeLabel ? `<span style="background:var(--bg4);border:1px solid var(--border);border-radius:10px;padding:1px 7px;font-size:10px;color:var(--teal);font-weight:600">${typeLabel}</span>` : ''}
        ${v._is_seed ? '<span style="font-size:10px;color:var(--teal);font-weight:700;background:rgba(45,212,191,.1);border:1px solid rgba(45,212,191,.35);padding:1px 7px;border-radius:10px"> Verified pauses</span>' : ''}
        ${v.wpm_verified ? '<span style="font-size:10px;color:var(--green);font-weight:700">Done WPM</span>' : ''}
      </div>
      <div class="vr-why">${v.why||v.context||''}</div>
      <div class="vr-meta">
        <span class="diff-tag ${cls}">${v.difficulty||'Moderate'}</span>
        <span style="font-size:11px;color:var(--dim)">${v.wpm_est||''} · ${v.duration_est||''}</span>
      </div>`;
    card.appendChild(body);
    grid.appendChild(card);
  });

  // Persist the currently displayed list and the original query parameters globally
  window._searchedVideos = videos;
  window._searchParams = params;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Sorting Utilities & Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @constant {Object<string,number>}
 * @description Maps difficulty strings to numeric ranks so arrays can be sorted
 *   by perceived difficulty level (Beginner = 0, Expert/Professional = 3).
 */
const DIFF_ORDER = { Beginner:0, Intermediate:1, Moderate:1, Advanced:2, Expert:3, Professional:3 };

/**
 * @description Extracts the first integer found in a duration string (e.g. "5 min")
 *   and returns it as a number. Defaults to 99 if no digit is found.
 * @param {string|number} s - Raw duration string from API.
 * @returns {number} Parsed minute value or 99 as fallback.
 */
function parseDurMin(s) { const m = String(s||'').match(/(\d+)/); return m ? parseInt(m[1]) : 99; }

/**
 * @description Extracts the first integer found in a WPM string (e.g. "120 WPM")
 *   and returns it as a number. Defaults to 0 if no digit is found.
 * @param {string|number} s - Raw WPM string from API.
 * @returns {number} Parsed WPM value or 0 as fallback.
 */
function parseWPM(s) { const m = String(s||'').match(/(\d+)/); return m ? parseInt(m[1]) : 0; }

// ─────────────────────────────────────────────────────────────────────────────
// 4. Sort Results
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @description Sorts the cached video list in place and re-renders the result grid.
 *   Supported keys: default, difficulty_asc/desc, duration_asc/desc, wpm_asc/desc.
 *   After sorting, stores the new order back into window._searchedVideos so that
 *   openSession() indexes remain consistent.
 * @param {string} key - Sort criterion selected by the user.
 * @returns {void}
 */
function sortResults(key) {
  // Clone the full original list (or fall back to the current list if original is missing)
  const all = [...(window._allSearchedVideos || window._searchedVideos || [])];

  // Apply the chosen comparator
  if (key === 'difficulty_asc') all.sort((a,b) => (DIFF_ORDER[a.difficulty]||1) - (DIFF_ORDER[b.difficulty]||1));
  if (key === 'difficulty_desc') all.sort((a,b) => (DIFF_ORDER[b.difficulty]||1) - (DIFF_ORDER[a.difficulty]||1));
  if (key === 'duration_asc') all.sort((a,b) => parseDurMin(a.duration_est) - parseDurMin(b.duration_est));
  if (key === 'duration_desc') all.sort((a,b) => parseDurMin(b.duration_est) - parseDurMin(a.duration_est));
  if (key === 'wpm_asc') all.sort((a,b) => parseWPM(a.wpm_est) - parseWPM(b.wpm_est));
  if (key === 'wpm_desc') all.sort((a,b) => parseWPM(b.wpm_est) - parseWPM(a.wpm_est));
  // 'default' = original order already restored from _allSearchedVideos, no sort needed

  // Locate the grid container; abort if it no longer exists
  const grid = document.getElementById('results-grid');
  if (!grid) return;
  grid.innerHTML = '';

  // Always update _searchedVideos to match sorted order so openSession stays in sync
  window._searchedVideos = all;

  // Extended difficulty → CSS class mapping (includes Intermediate/Professional)
  const diffClass = { Beginner:'diff-beginner', Moderate:'diff-moderate', Intermediate:'diff-moderate', Advanced:'diff-advanced', Expert:'diff-expert', Professional:'diff-expert' };
  // Condensed type labels for the sorted re-render
  const typeLabels = { opi_call_simulation:'OPI Simulation', conference_speech:'Conference', press_conference:'Press Conf', un_address:'UN Address', medical_briefing:'Medical', legal_proceeding:'Legal', news_broadcast:'Broadcast', lecture:'Lecture', documentary:'Documentary', interview:'Interview', parliamentary_debate:'Parliament' };

  // Re-build each card in the new sorted order
  all.forEach((v, i) => {
    const cls = diffClass[v.difficulty] || 'diff-moderate';
    const typeLabel = typeLabels[v.video_type] || '';

    const card = document.createElement('div');
    card.className = 'vr-card';
    // Store index as data attribute so onclick always matches current sorted position
    card.dataset.vidIdx = i;
    card.onclick = function() { openSession(parseInt(this.dataset.vidIdx)); };

    // Thumbnail or placeholder
    if (v.thumbnail) {
      const img = document.createElement('img');
      img.src = v.thumbnail; img.className = 'vr-thumb'; img.alt = v.title||'';
      img.onerror = function() { const ph = document.createElement('div'); ph.className='vr-thumb-placeholder'; ph.textContent = ''; this.parentNode.replaceChild(ph,this); };
      card.appendChild(img);
    } else {
      const ph = document.createElement('div'); ph.className='vr-thumb-placeholder'; ph.textContent = ''; card.appendChild(ph);
    }

    // Body markup
    const body = document.createElement('div'); body.className = 'vr-body';
    body.innerHTML = `
      <div class="vr-title">${v.title||'Untitled'}</div>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap">
        <span class="vr-speaker">${v.speaker||''}</span>
        ${typeLabel ? `<span style="background:var(--bg4);border:1px solid var(--border);border-radius:10px;padding:1px 7px;font-size:10px;color:var(--teal);font-weight:600">${typeLabel}</span>` : ''}
        ${v.wpm_verified ? '<span style="font-size:10px;color:var(--green);font-weight:700">Done WPM</span>' : ''}
      </div>
      <div class="vr-why">${v.why||v.context||''}</div>
      <div class="vr-meta">
        <span class="diff-tag ${cls}">${v.difficulty||'Moderate'}</span>
        <span style="font-size:11px;color:var(--dim)">${v.wpm_est||''} · ${v.duration_est||''}</span>
      </div>`;
    card.appendChild(body);
    grid.appendChild(card);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Open a Practice Session from a Grid Card
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @description Transitions the UI from search results into an active practice session.
 *   Hides the parameter pane, shows the session pane, populates metadata badges,
 *   loads a YouTube player (or a fallback search link), and triggers auxiliary
 *   helpers such as microphone warm-up and video structure analysis.
 * @param {number} idx - Index of the selected video inside window._searchedVideos.
 * @returns {void}
 */
function openSession(idx) {
  // Resolve the video object from the globally cached sorted list
  const v = (window._searchedVideos || [])[idx];
  if (!v) return;
  currentSessionVideo = v;

  // ── Navigate to session page ──────────────────────────────────────────────
  document.getElementById('interp-params').style.display = 'none';
  document.getElementById('interp-session').style.display = 'block';

  // ── Set session header (mode label + query info) ──────────────────────────
  const meta = MODE_META[currentMode] || {};
  document.getElementById('session-mode-label').textContent = (meta.name||currentMode) + ' Session';
  const params = window._searchParams || {};
  document.getElementById('session-info-label').textContent =
    [params.field, params.lang, params.topic].filter(Boolean).join(' · ');

  // ── Difficulty badge in session header ────────────────────────────────────
  const diffClass = { Beginner:'diff-beginner', Moderate:'diff-moderate', Advanced:'diff-advanced', Expert:'diff-expert' };
  const dc = diffClass[v.difficulty] || 'diff-moderate';
  document.getElementById('session-diff-badge').innerHTML = `<span class="diff-tag ${dc}">${v.difficulty||'Moderate'}</span>`;

  // ── Load video ────────────────────────────────────────────────────────────
  const wrap = document.getElementById('session-video-wrap');
  document.getElementById('session-video-title').textContent = v.title || '';
  document.getElementById('session-video-meta').textContent = [v.wpm_est, v.speaker, v.duration_est].filter(Boolean).join(' · ');

  // Determine whether a known YouTube ID is available
  const hasId = v.known_id && v.known_id !== 'null';
  const urlRow = document.getElementById('session-url-row');

  if (hasId) {
    // Valid ID: embed the player and hide the custom-URL row
    if (urlRow) urlRow.style.display = 'none';
    createYTPlayer(v.known_id);
  } else {
    // No confirmed ID: show a search-on-YouTube fallback UI
    const q = encodeURIComponent(v.search_query || v.title || '');
    wrap.innerHTML = `<div style="position:absolute;top:0;left:0;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--bg3);gap:10px">
      <div style="font-size:28px"></div>
      <div style="font-size:13px;font-weight:700;color:var(--text);padding:0 16px;text-align:center">${v.title}</div>
      <a href="https://www.youtube.com/results?search_query=${q}" target="_blank"
         class="btn btn-gold" style="padding:9px 20px;text-decoration:none;font-size:13px;border-radius:8px">
         Search on YouTube ↗
      </a>
    </div>`;
    if (urlRow) urlRow.style.display = 'flex';
    document.getElementById('session-custom-url').value = '';
  }

  // ── Mode-specific UI ──────────────────────────────────────────────────────
  const needsSource = currentMode === 'consecutive' || currentMode === 'opi';
  document.getElementById('source-area').style.display = needsSource ? 'block' : 'none';

  // ── Segment hint for consecutive / OPI ────────────────────────────────────
  const diff = (v.difficulty || 'moderate').toLowerCase();
  const secs = SEGMENT_SECS[diff] || 30;
  const segHint = document.getElementById('segment-hint');
  const pmBtn = document.getElementById('pause-mode-btn');
  if (currentMode === 'consecutive' || currentMode === 'opi') {
    if (segHint) segHint.textContent = `Auto-pause active — press Play to start`;
    if (pmBtn) { pmBtn.style.display = 'block'; manualPauseMode = false; pmBtn.textContent = 'Auto-pause'; pmBtn.style.color = 'var(--green)'; pmBtn.style.borderColor = 'var(--green)'; }
  } else {
    if (pmBtn) pmBtn.style.display = 'none';
  }

  // ── Load key terms for this video ─────────────────────────────────────────
  loadKeyTerms(v, params);

  // ── Pre-warm microphone so auto-recording works without user-gesture gate ─
  warmMicrophone();

  // ── Deep video structure analysis (pause points, type, segments) ──────────
  if (hasId) analyzeVideoStructure(v.known_id, currentMode, params?.field || 'general', v.title || '');

  // ── Reset any previous interpretation results ─────────────────────────────
  clearInterp();
}

// ── Video Structure Analysis ────────────────────────────────────────────────
/** @type {Array<number>} Stores detected pause timestamps (seconds) for the current video. */
let videoPausePoints = [];
/** @type {Array<Object>} Stores segment boundaries for the current video. */
let videoSegments = [];
/** @type {number} Index of the next pause point to trigger. */
let nextPauseIdx = 0;
/** @type {number} Timestamp (seconds) when current speech block started. */
let speechStartSec = 0;
/** @type {Array<Object>} Raw caption events fetched for the current video. */
let captionEvents = [];
/** @type {number|null} Timer ID for speech-start detection delay. */
let speechStartTimer = null;
/** @type {number} Timestamp when recording began (seconds). */
let recordingStartSec = 0;
/** @type {number} Timestamp when recording ended (seconds). */
let recordingEndSec = 0;
/** @type {number|null} Interval ID for polling the player time during pausing logic. */
let pausePollingInterval = null;
/** @type {boolean} When true, pause logic is driven manually rather than by auto-detection. */
let manualPauseMode      = false;
/** @type {number} Last player time (seconds) at which a pause was triggered; prevents re-triggering. */
let lastPausedAt         = -999;
// Silence detection state
/** @type {Array<Object>} Detected silence gaps between speech segments. */
let silenceGaps          = [];
/** @type {string} Current pause strategy: 'auto' or other modes. */
let pauseMode            = 'auto';
/** @type {number} Average expected speech segment length in seconds. */
let avgSpeechSec         = 25;
/** @type {number} Accumulated speech duration used for heuristic pause timing. */
let speechAccumulator    = 0;
/** @type {number} Last polled player time for delta calculation. */
let lastPollPlayerTime   = 0;
/** @type {boolean} True when the player is currently inside a detected natural silence. */
let inNaturalSilence     = false;

// ─────────────────────────────────────────────────────────────────────────────
// 6. Sidebar Rendering
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @description Renders a compact list of videos into the sidebar panel.
 *   Each item shows thumbnail, title, speaker, duration, context, and level.
 * @param {Array<Object>} videos - Video metadata array from API.
 * @returns {void}
 */
function renderVideoSidebar(videos) {
  const list = document.getElementById('video-sidebar-list');
  if (!list) return;
  // Guard: render empty state if no videos
  if (!videos.length) { list.innerHTML = '<div style="padding:12px;color:var(--dim);font-size:12px">No results found.</div>'; return; }

  // Clear and rebuild sidebar as an HTML string for performance
  list.innerHTML = videos.map((v,i) => {
    // Sanitize title to avoid breaking the inline onclick attribute
    const safeTitle = (v.title||'').replace(/'/g,'').replace(/"/g,'').replace(/`/g,'');
    // Encode search query for the fallback YouTube link
    const safeSearch = encodeURIComponent(v.search_query || v.title || '');
    // Determine whether a known embeddable ID exists
    const hasId = v.known_id && v.known_id !== 'null';
    return `<div class="sidebar-video-card" id="svc-${i}" onclick="loadSidebarVideo('${hasId ? v.known_id : ''}','${safeTitle}','${v.speaker||''}','${v.duration_est||''}','${safeSearch}',${i})">
      ${v.thumbnail ? `<img src="${v.thumbnail}" class="svc-thumb" onerror="this.style.display='none'">` : `<div class="svc-thumb" style="background:var(--bg4);display:flex;align-items:center;justify-content:center;font-size:20px"></div>`}
      <div class="svc-title">${v.title||'Untitled'}</div>
      <div class="svc-meta" style="margin-bottom:3px">${v.speaker||''} · ${v.duration_est||''}</div>
      <div style="font-size:10px;color:var(--dim);line-height:1.3">${v.why||v.context||''}</div>
      <div style="margin-top:5px"><span style="font-size:10px;padding:2px 7px;border-radius:10px;background:var(--bg4);color:var(--dim);border:1px solid var(--border)">${v.level||''}</span></div>
    </div>`;
  }).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Load a Sidebar Video into the Practice Player
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @description Activates a sidebar item and loads its video into the practice player area.
 *   Embeds a YouTube iframe when a valid ID exists; otherwise shows a search fallback.
 * @param {string} id - YouTube video ID (may be empty if unconfirmed).
 * @param {string} title - Video title.
 * @param {string} channel - Speaker / channel name.
 * @param {string} duration - Estimated duration string.
 * @param {string} searchQuery - Pre-encoded search query for fallback link.
 * @param {number} idx - Sidebar index used to highlight the active card.
 * @returns {void}
 */
function loadSidebarVideo(id, title, channel, duration, searchQuery, idx) {
  // Remove 'selected' class from all sidebar cards
  document.querySelectorAll('.sidebar-video-card').forEach(c => c.classList.remove('selected'));
  // Highlight the clicked card
  const card = document.getElementById('svc-' + idx);
  if (card) card.classList.add('selected');

  const wrap = document.getElementById('practice-video-wrap');
  document.getElementById('current-video-title').textContent = title || 'Video loaded';
  document.getElementById('current-video-meta').textContent = [duration, channel].filter(Boolean).join(' · ');

  // If a real ID is present, embed the nocookie iframe
  if (id && id !== 'null' && id !== '') {
    selectedVideoId = id;
    wrap.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1"
      allowfullscreen allow="autoplay; encrypted-media"
      style="position:absolute;top:0;left:0;width:100%;height:100%;border:none"></iframe>`;
  } else {
    // No confirmed ID — show search button and instructions
    selectedVideoId = null;
    wrap.innerHTML = `<div class="video-placeholder">
      <div style="font-size:30px"></div>
      <div style="font-size:13px;font-weight:700;color:var(--text);margin:8px 0;text-align:center;padding:0 20px">${title}</div>
      <div style="font-size:11px;color:var(--dim);margin-bottom:12px;text-align:center;padding:0 16px">${channel}</div>
      <a href="https://www.youtube.com/results?search_query=${searchQuery}" target="_blank"
         class="btn btn-gold" style="padding:9px 20px;text-decoration:none;font-size:13px;border-radius:8px">
         Search on YouTube ↗
      </a>
      <div style="font-size:11px;color:var(--dim);margin-top:10px">Copy the URL and paste it in the field below</div>
    </div>`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Custom Video Loaders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @description Reads a YouTube URL from the practice custom-url input,
 *   validates/extracts the video ID, and embeds it into the session video wrap.
 * @returns {void}
 */
function loadPracticeCustomVideo() {
  const url = document.getElementById('practice-custom-url').value.trim();
  const id = extractYouTubeId(url);
  // Guard: abort if the URL does not contain a valid YouTube ID
  if (!id) { alert('Please enter a valid YouTube URL'); return; }
  selectedVideoId = id;
  document.getElementById('session-video-wrap').innerHTML =
    `<iframe src="https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1"
      allowfullscreen allow="autoplay; encrypted-media"
      style="position:absolute;top:0;left:0;width:100%;height:100%;border:none"></iframe>`;
  document.getElementById('session-video-title').textContent = 'Custom video loaded';
  document.getElementById('session-video-meta').textContent = '';
}

/**
 * @description Thin wrapper that re-triggers the sidebar video search,
 *   effectively refreshing the video library view.
 * @returns {void}
 */
function renderVideoLibrary() { searchPracticeVideos(); }

// togglePracticeRecording replaced by startPracticeRecording/stopPracticeRecording

// ─────────────────────────────────────────────────────────────────────────────
// 9. Video Topic Data (Voice-Over & Interpretation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @constant {Object<Object>}
 * @description Curated voice-over training videos mapped by topic key.
 *   Some entries have a known YouTube ID; others rely on a search query fallback.
 */
const VO_VIDEOS = {
  voice: { id:'eIho2S0ZahI', title:'Julian Treasure — How to Speak so People Want to Listen (TED)', desc:'The essential voice masterclass. HAIL framework, vocal variety, resonance, and pacing. Required viewing.' },
  commercial:{ id:null, search:'voice over commercial technique tips training', title:'Commercial VO Technique', desc:'Energy, warmth, and persuasion in commercial reads. Finds the "one person" in the audience.' },
  news: { id:null, search:'broadcast news anchor voice training technique', title:'Broadcast News Voice Coaching', desc:'Neutral, authoritative delivery. Plosive control, pacing, and confidence under the mic.' },
  arabic: { id:null, search:'Arabic broadcast voice training فصيح makhraj', title:'Arabic Broadcast Technique (مخارج الحروف)', desc:'Makhraj precision, emphatic consonants, MSA vowel length. Al Jazeera / BBC Arabic style.' },
  breathing: { id:null, search:'diaphragmatic breathing voice acting singing technique', title:'Diaphragmatic Breathing Technique', desc:'Foundation of all professional voice work. Breath support for sustained, resonant delivery.' },
  mic: { id:null, search:'microphone technique voice over recording studio tips', title:'Microphone Technique for VO', desc:'Distance, angle, proximity effect, plosive control. How your relationship with the mic defines your sound.' }
};

// ─────────────────────────────────────────────────────────────────────────────
// 10. Interpretation Video Topic Loader
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @description Activates a topic button and loads the corresponding
 *   interpretation training video (embedded iframe or fallback search link).
 * @param {string} topic - Key into the INTERP_VIDEOS map.
 * @param {HTMLElement} btn - The clicked button element; receives 'active' class.
 * @returns {void}
 */
function loadInterpVideo(topic, btn) {
  // Clear active state from all topic buttons
  document.querySelectorAll('#interp-video-topics .vtopic').forEach(b=>b.classList.remove('active'));
  // Highlight the selected button
  btn.classList.add('active');
  const v = INTERP_VIDEOS[topic];
  if (!v) return;
  const frame = document.getElementById('interp-video-frame');
  const info = document.getElementById('interp-video-info');
  if (v.id) {
    // Known ID: build iframe source and inject it into the wrapper
    frame.src = `https://www.youtube-nocookie.com/embed/${v.id}?rel=0&modestbranding=1`;
    document.getElementById('interp-video-wrap').innerHTML = `<iframe id="interp-video-frame" src="https://www.youtube-nocookie.com/embed/${v.id}?rel=0&modestbranding=1" allowfullscreen allow="autoplay; encrypted-media"></iframe>`;
  } else {
    // No ID: render a placeholder with a YouTube search link
    document.getElementById('interp-video-wrap').innerHTML = `<div class="video-placeholder"><div style="font-size:32px"></div><div style="font-size:13px;font-weight:700;color:var(--text)">${v.title}</div><a href="https://www.youtube.com/results?search_query=${encodeURIComponent(v.search)}" target="_blank" class="btn btn-gold" style="padding:8px 20px;border-radius:8px;text-decoration:none;font-size:13px">Search on YouTube ↗</a></div>`;
  }
  info.innerHTML = `<strong>${v.title}</strong><br>${v.desc}`;
}

/**
 * @description Loads a custom interpretation video from a user-supplied YouTube URL.
 * @returns {void}
 */
function loadCustomInterpVideo() {
  const url = document.getElementById('interp-custom-url').value.trim();
  const id = extractYouTubeId(url);
  if (!id) { alert('Please enter a valid YouTube URL'); return; }
  document.getElementById('interp-video-wrap').innerHTML = `<iframe id="interp-video-frame" src="https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1" allowfullscreen allow="autoplay; encrypted-media"></iframe>`;
  document.getElementById('interp-video-info').innerHTML = '<strong>Custom video loaded</strong><br>Use this as your practice source material.';
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. Voice-Over Video Topic Loader
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @description Activates a voice-over topic button and loads the corresponding
 *   video into the VO tab's video wrap.
 * @param {string} topic - Key into the VO_VIDEOS map.
 * @param {HTMLElement} btn - The clicked button element; receives 'active' class.
 * @returns {void}
 */
function loadVOVideo(topic, btn) {
  // Clear active state from all VO topic buttons
  document.querySelectorAll('#vo-video-topics .vtopic').forEach(b=>b.classList.remove('active'));
  // Highlight the selected button
  btn.classList.add('active');
  const v = VO_VIDEOS[topic];
  if (!v) return;
  const info = document.getElementById('vo-video-info');
  if (v.id) {
    document.querySelector('#tab-vo .video-wrap').innerHTML = `<iframe id="vo-video-frame" src="https://www.youtube-nocookie.com/embed/${v.id}?rel=0&modestbranding=1" allowfullscreen allow="autoplay; encrypted-media"></iframe>`;
  } else {
    document.querySelector('#tab-vo .video-wrap').innerHTML = `<div class="video-placeholder"><div style="font-size:32px"></div><div style="font-size:13px;font-weight:700;color:var(--text)">${v.title}</div><a href="https://www.youtube.com/results?search_query=${encodeURIComponent(v.search)}" target="_blank" class="btn btn-gold" style="padding:8px 20px;border-radius:8px;text-decoration:none;font-size:13px">Search on YouTube ↗</a></div>`;
  }
  info.innerHTML = `<strong>${v.title}</strong><br>${v.desc}`;
}

/**
 * @description Loads a custom voice-over video from a user-supplied YouTube URL.
 * @returns {void}
 */
function loadCustomVOVideo() {
  const url = document.getElementById('vo-custom-url').value.trim();
  const id = extractYouTubeId(url);
  if (!id) { alert('Please enter a valid YouTube URL'); return; }
  document.querySelector('#tab-vo .video-wrap').innerHTML = `<iframe id="vo-video-frame" src="https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1" allowfullscreen allow="autoplay; encrypted-media"></iframe>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 12. YouTube ID Extractor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @description Extracts an 11-character YouTube video ID from a variety of URL
 *   formats (watch?v=, youtu.be/, embed/) or returns the raw string if it is
 *   already exactly 11 characters.
 * @param {string} url - Raw URL or ID string.
 * @returns {string|null} The extracted 11-character ID, or null if invalid.
 */
function extractYouTubeId(url) {
  const m = url.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : (url.length === 11 ? url : null);
}

// ─────────────────────────────────────────────────────────────────────────────
// 13. Sidebar Video Search (Practice Videos)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @description Queries the backend for practice videos matching the current
 *   interpretation parameters and renders them into the sidebar list.
 *   Also updates wizard step indicators on success.
 * @async
 * @returns {Promise<void>}
 */
async function searchPracticeVideos() {
  // Read current filter values from the DOM, falling back to safe defaults
  const field = document.getElementById('interp-spec')?.value || 'general';
  const lang = document.getElementById('interp-dir')?.value || 'English → Arabic';
  const dur = parseInt(document.getElementById('interp-dur')?.value || 5);
  const mode = currentMode || 'shadowing';

  const list = document.getElementById('video-sidebar-list');
  if (!list) return;
  // Show a loading state while the request is in flight
  list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--dim);font-size:12px">
    <div style="font-size:22px;margin-bottom:8px"></div>
    <div style="color:var(--gold);font-weight:600;margin-bottom:4px">AI is curating videos...</div>
    <div>Matching ${field} content for ${mode}</div>
  </div>`;

  // Execute the POST request and handle response / errors
  try {
    const fd = new FormData();
    fd.append('mode', mode);
    fd.append('field', field);
    fd.append('language', lang);
    fd.append('duration', dur);
    const r = await fetch('/api/search-videos', { method:'POST', body:fd });
    const videos = await r.json();
    if (videos.error) {
      list.innerHTML = `<div style="padding:12px;color:var(--amber);font-size:12px">Warning: ${videos.error}</div>`;
      return;
    }
    renderVideoSidebar(videos);
    // Advance the wizard step indicators
    document.getElementById('ws-1').className = 'wstep done';
    document.getElementById('ws-2').className = 'wstep active';
  } catch(e) {
    list.innerHTML = '<div style="padding:12px;color:var(--red);font-size:12px">Search failed — is the server running?</div>';
  }
}
