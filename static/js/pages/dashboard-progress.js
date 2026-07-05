/**
 * @module pages/dashboard-progress.js
 * @description Dashboard & Progress pages — stats, charts, achievements, streak tracking
 *
 * MAD Training Studio — Interpretation Practice Platform
 * © 2025 InterpretLab. All rights reserved.
 */

// ══════════════════════════════════════════════════════════════════════════════
// DASHBOARD MODULE
// ══════════════════════════════════════════════════════════════════════════════

/**
 * @description Loads and renders all dashboard data including session stats, XP/level,
 *              streak tracking, KPI cards, learning journey, and recent practice list.
 *              Fetches session data from the backend API and enriches it with localStorage
 *              OPI/CI simulation data.
 * @async
 * @returns {Promise<void>}
 */
async function loadDashboard() {
  // ── Entry guard ──
  try {
    // ── Fetch all sessions from the backend ──
    const r = await fetch('/api/sessions');      // GET request to sessions endpoint
    const sessions = await r.json();             // Parse JSON response into session objects

    // ── Session count badge ──
    // Look up the DOM element that shows total session count
    const sc = document.getElementById('session-count');
    // Only update if the element exists (defensive check for partial page loads)
    if (sc) sc.textContent = sessions.length + ' sessions';

    // ── Month count ──
    // Get current date to calculate "this month" metrics
    const now = new Date();
    // Build YYYYMM string from ISO date (e.g., "202507")
    const monthStr = now.toISOString().slice(0,7).replace('-','');
    // Filter sessions whose filename contains the current month string
    const thisMonth = sessions.filter(s => s.file && s.file.includes('_' + monthStr));
    // Update the monthly counter in the dashboard
    const mEl = document.getElementById('dash-month-count');
    if (mEl) mEl.textContent = thisMonth.length;

    // ── Sub text ──
    // Display motivational / status text beneath the session count
    const sub = document.getElementById('dash-sub-text');
    if (sub) sub.textContent = sessions.length ? `${sessions.length} sessions completed` : 'Start your first exercise';

    // ── Total + average score ──
    // Render total session count in the dedicated stat card
    const totalEl = document.getElementById('dash-total-sessions');
    if (totalEl) totalEl.textContent = sessions.length;

    // Filter only sessions that have a valid numeric score > 0
    const scored = sessions.filter(s => s.score && parseFloat(s.score) > 0);
    // Compute average score across scored sessions, or '—' if none exist
    const avg = scored.length ? (scored.reduce((a,s)=>a+parseFloat(s.score),0)/scored.length).toFixed(0) : '—';
    const avgEl = document.getElementById('dash-avg-score');
    // Append "/100" unit only when a valid average exists
    if (avgEl) avgEl.textContent = avg === '—' ? '—' : avg + '/100';

    // ── Recent eval preview ──
    // Shows the most recent session's type and score in a preview banner
    const prevEl = document.getElementById('dash-recent-eval-preview');
    if (prevEl) {
      if (sessions.length) {
        // The latest session is assumed to be the first element in the array
        const last = sessions[0];
        // Human-readable mapping for session type codes
        const typeNames = { interp:'Interpretation', vo:'Voice-Over', opi_sim:'OPI Call' };
        prevEl.innerHTML = `<strong style="color:var(--text)">${typeNames[last.type]||last.type||'Session'}</strong> — Score: <strong style="color:var(--gold)">${last.score||'—'}</strong>`;
      } else {
        // Fallback when no sessions have been recorded yet
        prevEl.textContent = 'No recordings yet.';
      }
    }

    // ── XP + level + streak (reuse progress logic) ──
    // Accumulate total XP by summing sessionXP() across all sessions
    const totalXP = sessions.reduce((sum,s) => sum + sessionXP(s), 0);
    // Determine current level index from total XP
    const level = getLevel(totalXP);
    // Look up thresholds for next and previous level (capped at array bounds)
    const nextThresh = XP_LEVEL_THRESHOLDS[Math.min(level+1, XP_LEVEL_THRESHOLDS.length-1)];
    const prevThresh = XP_LEVEL_THRESHOLDS[level];
    // Calculate percentage progress toward the next level
    const pct = nextThresh > prevThresh ? Math.round(((totalXP - prevThresh) / (nextThresh - prevThresh)) * 100) : 100;

    // Update level circle, name label, XP label, and progress bar width
    const lc = document.getElementById('dash-level-circle'); if (lc) lc.textContent = level+1;
    const ln = document.getElementById('dash-level-name'); if (ln) ln.textContent = `Level ${level+1} — ${LEVEL_NAMES[level]}`;
    const xl = document.getElementById('dash-xp-label'); if (xl) xl.textContent = totalXP.toLocaleString() + ' XP';
    const xb = document.getElementById('dash-xp-bar'); if (xb) xb.style.width = pct + '%';

    // Compute streak data (current streak, best streak, whether practised today)
    const streakData = updateStreak(sessions);
    const sn = document.getElementById('dash-streak-num'); if (sn) sn.textContent = streakData.streak;
    const bs = document.getElementById('dash-best-streak-num'); if (bs) bs.textContent = streakData.best;

    // ── This week ──
    // Calculate how many sessions occurred since the start of the current week (Monday-based)
    const now2 = new Date(); const dow = now2.getDay(); const msDay = 86400000;
    // Monday-based week start: if Sunday (0), go back 6 days; otherwise go back (dow-1) days
    const weekStart = new Date(now2 - (dow===0?6:dow-1)*msDay); weekStart.setHours(0,0,0,0);
    const weekSessions = sessions.filter(s => {
      // Extract YYYYMMDD from filename pattern _YYYYMMDD_
      const m = s.file?.match(/_(\d{8})_/);
      if (!m) return false;
      const d = m[1];
      // Parse extracted date string into a Date object
      const dt = new Date(`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`);
      return dt >= weekStart;
    });
    const weekEl = document.getElementById('dash-week-content');
    if (weekEl) {
      // Show session count with pluralization, or a motivational message if none
      weekEl.textContent = weekSessions.length
        ? `${weekSessions.length} session${weekSessions.length!==1?'s':''} this week`
        : 'No evaluations yet — your weekly trend will appear after your first practice.';
      // Italicize the fallback message for visual distinction
      weekEl.style.fontStyle = weekSessions.length ? 'normal' : 'italic';
    }

    // ── Learning journey ──
    // Render a stepped visual roadmap of interpreter career progression
    const journeyEl = document.getElementById('dash-journey');
    const journeyStatus = document.getElementById('dash-journey-status');
    if (journeyEl) {
      // Define ordered progression thresholds (mapped to level indices)
      const steps = [
        {label:'Novice',threshold:0},
        {label:'Apprentice',threshold:1},
        {label:'Practitioner',threshold:2},
        {label:'Interpreter',threshold:3},
        {label:'Professional',threshold:4},
        {label:'Certificate',threshold:5},
      ];
      // Build HTML for each step with connector lines and dynamic CSS classes
      journeyEl.innerHTML = steps.map((s,i) => {
        const isDone = level >= s.threshold;     // Step has been passed
        const isCurrent = level === s.threshold; // Step is the current level
        return `${i>0?`<div class="journey-connector ${isDone||isCurrent?'done':''}"></div>`:''}
          <div class="journey-step">
            <div class="journey-icon ${isDone?'done':isCurrent?'current':''}"><div class="journey-dot-inner"></div></div>
            <div class="journey-label ${isDone?'done':isCurrent?'current':''}">${s.label}</div>
          </div>`;
      }).join('');
      // Update the status line below the journey map
      if (journeyStatus) journeyStatus.textContent = sessions.length ? `Currently: ${LEVEL_NAMES[level]}` : 'Start your first practice to begin the journey';
    }

    // ── OPI + CI Performance KPIs ────────────────────────────────────────────
    // Pull OPI and CI session arrays from localStorage (populated by simulation overlays)
    const _opiSessions = JSON.parse(localStorage.getItem('opi-sessions') || '[]');
    const _ciSessions  = JSON.parse(localStorage.getItem('ci-sessions')  || '[]');

    // ── OPI KPI Card ──
    const _opiCard = document.getElementById('dash-opi-kpis');
    if (_opiCard) {
      if (_opiSessions.length) {
        const _n = _opiSessions.length;
        // Helper closure: compute average for a given KPI key across all OPI sessions
        const _avg = k => Math.round(_opiSessions.reduce((a,s)=>a+(s[k]||0),0)/_n);
        const _last = _opiSessions[0]; // Most recent OPI session
        // KPI label, data key, and CSS variable for color
        const _kpiRows = [
          ['Accuracy',            'accuracy',            '--gold'],
          ['Fusha Compliance',    'fusha_compliance',    '--green'],
          ['Completeness',        'completeness',        '--blue'],
          ['Terminology',         'terminology',         '--purple'],
          ['Fluency',             'fluency',             '--teal'],
          ['Protocol',            'professional_protocol','--amber'],
        ].map(([label,key,col]) => {
          const v = _avg(key);
          return `<div style="margin-bottom:6px">
            <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--dim);margin-bottom:2px">
              <span>${label}</span><span style="color:var(${col});font-weight:700">${v}</span>
            </div>
            <div style="background:var(--bg3);border-radius:4px;height:4px;overflow:hidden">
              <div style="height:100%;width:${v}%;background:var(${col});border-radius:4px"></div>
            </div>
          </div>`;
        }).join('');
        // Map ACTFL grade to a CSS color variable for the latest grade badge
        const _gradeColor = {'Superior':'var(--green)','Advanced High':'var(--green)','Advanced Mid':'var(--gold)','Advanced Low':'var(--gold)','Intermediate High':'var(--amber)','Intermediate Mid':'var(--amber)','Intermediate Low':'var(--red)','Novice':'var(--red)'}[_last.grade] || 'var(--dim)';
        // Inject the complete OPI KPI card HTML
        _opiCard.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <div>
              <div style="font-size:28px;font-weight:800;color:var(--text)">${_avg('overall_score')}<span style="font-size:13px;color:var(--dim);font-weight:400">/100</span></div>
              <div style="font-size:11px;color:var(--dim)">${_n} OPI call${_n!==1?'s':''} · avg overall</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:13px;font-weight:700;color:${_gradeColor}">${_last.grade || '—'}</div>
              <div style="font-size:11px;color:var(--dim)">Latest grade</div>
            </div>
          </div>
          ${_kpiRows}
          <div style="margin-top:10px;font-size:11px;color:var(--dim)">Last: ${_last.scenario || _last.field} · ${_last.lang} · ${_last.duration}</div>`;
      } else {
        // Empty-state prompt when no OPI data exists
        _opiCard.innerHTML = '<div style="font-size:12px;color:var(--dim);text-align:center;padding:12px">Complete an OPI simulation to see your KPI breakdown</div>';
      }
    }

    // ── CI KPI block ──────────────────────────────────────────────────────────
    const _ciCard = document.getElementById('dash-ci-kpis');
    if (_ciCard) {
      if (_ciSessions.length) {
        const _cn = _ciSessions.length;
        // Helper closure for CI averages
        const _cavg = k => Math.round(_ciSessions.reduce((a,s)=>a+(s[k]||0),0)/_cn);
        const _clast = _ciSessions[0];
        const _ciKpiRows = [
          ['Accuracy',         'accuracy',             '--gold'],
          ['Completeness',     'completeness',         '--blue'],
          ['Memory Accuracy',  'memory_accuracy',      '--purple'],
          ['Terminology',      'terminology',          '--teal'],
          ['Fluency',          'fluency',              '--green'],
          ['Protocol',         'professional_protocol','--amber'],
        ].map(([label,key,col]) => {
          const v = _cavg(key);
          return `<div style="margin-bottom:6px">
            <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--dim);margin-bottom:2px">
              <span>${label}</span><span style="color:var(${col});font-weight:700">${v}</span>
            </div>
            <div style="background:var(--bg3);border-radius:4px;height:4px;overflow:hidden">
              <div style="height:100%;width:${v}%;background:var(${col});border-radius:4px"></div>
            </div>
          </div>`;
        }).join('');
        // Map CI grade words to color variables (only first word matters)
        const _cgc = {'Excellent':'var(--green)','Good':'var(--gold)','Satisfactory':'var(--amber)','Needs Work':'var(--red)'}[(_clast.grade||'').split(' ')[0]] || 'var(--dim)';
        _ciCard.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <div>
              <div style="font-size:28px;font-weight:800;color:var(--text)">${_cavg('overall_score')}<span style="font-size:13px;color:var(--dim);font-weight:400">/100</span></div>
              <div style="font-size:11px;color:var(--dim)">${_cn} CI session${_cn!==1?'s':''} · avg overall</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:13px;font-weight:700;color:${_cgc}">${_clast.grade||'—'}</div>
              <div style="font-size:11px;color:var(--dim)">Latest grade</div>
            </div>
          </div>
          ${_ciKpiRows}
          <div style="margin-top:10px;font-size:11px;color:var(--dim)">Last: ${_clast.field} · ${_clast.lang} · ${_clast.segments} segs</div>`;
      } else {
        // Empty-state prompt when no CI data exists
        _ciCard.innerHTML = '<div style="font-size:12px;color:var(--dim);text-align:center;padding:12px">Complete a CI session to see your KPI breakdown</div>';
      }
    }

    // ── Recommended next ──
    // Infer the most relevant next exercise type based on recent activity
    const typeMap = { interp:'Consecutive', vo:'Voice-Over', opi_sim:'OPI' };
    const fieldGuess = sessions.length ? (sessions[0].type === 'opi_sim' ? 'OPI' : 'Medical Consecutive') : 'Medical Consecutive';
    const recTitle = document.getElementById('dash-rec-title');
    const recWhy = document.getElementById('dash-rec-why');
    if (recTitle) recTitle.textContent = sessions.length ? `Continue ${fieldGuess} — ${LEVEL_NAMES[level]}` : 'Medical Consecutive — Beginner';
    if (recWhy) recWhy.textContent = sessions.length
      ? 'Based on your recent practice. Build on your current momentum.'
      : 'Start with a structured medical scenario. Built-in silence gaps — no manual pausing needed.';

    // ── Recent practice list ──
    // Render the last 5 sessions as a scrollable list with type color indicators
    const recentEl = document.getElementById('dash-recent-list');
    if (recentEl) {
      const typeNames = { interp:'Interpretation', vo:'Voice-Over', opi_sim:'OPI Call' };
      const typeColors = { interp:'var(--gold)', vo:'var(--green)', opi_sim:'var(--purple)' };
      const recent = sessions.slice(0,5);
      if (recent.length) {
        recentEl.innerHTML = recent.map(s => {
          const score = s.score ? `${s.score}/100` : '—';
          // Color-code score by performance bands
          const scoreColor = parseFloat(s.score)>=80?'var(--green)':parseFloat(s.score)>=60?'var(--gold)':'var(--amber)';
          const typeColor = typeColors[s.type] || 'var(--dim)';
          // Extract and format YYYYMMDD from filename for display
          const dateStr = s.file?.match(/_(\d{8})_(\d{6})/)?.[1]?.replace(/(\d{4})(\d{2})(\d{2})/,'$1-$2-$3') || '';
          return `<div class="recent-item">
            <div class="recent-type">
              <div style="width:4px;height:36px;background:${typeColor};border-radius:2px;flex-shrink:0"></div>
              <div>
                <div class="recent-label">${typeNames[s.type]||s.type}</div>
                <div class="recent-date">${dateStr}</div>
              </div>
            </div>
            <div class="recent-score" style="color:${scoreColor}">${score}</div>
          </div>`;
        }).join('');
        // Update the adjacent CTA button text when recent sessions exist
        const startBtn = recentEl.parentElement?.querySelector('button');
        if (startBtn) startBtn.textContent = '▶ Start your next exercise';
      } else {
        // Empty-state when no sessions exist
        recentEl.innerHTML = '<div style="font-size:12px;color:var(--dim);text-align:center;padding:16px">No practice sessions yet</div>';
      }
    }

  } catch(e) {
    // Log any dashboard loading errors without crashing the page
    console.warn('Dashboard load error:', e);
  }
}

// ── Mode selection ─────────────────────────────────────────────

/**
 * @description Switches the Dashboard OPI/CI KPI card visibility and
 *              updates tab button styles for the active simulation tab.
 * @param {string} tab - The selected tab identifier: 'opi' or 'ci'.
 * @returns {void}
 */
function dashSimTab(tab) {
  // Toggle visibility of the two KPI cards based on selected tab
  document.getElementById('dash-opi-kpis').style.display = tab === 'opi' ? '' : 'none';
  document.getElementById('dash-ci-kpis').style.display  = tab === 'ci'  ? '' : 'none';
  // Reference both tab buttons
  const oBtn = document.getElementById('dash-sim-tab-opi');
  const cBtn = document.getElementById('dash-sim-tab-ci');
  // Style the OPI button: active = blue background with white text
  if (oBtn) { oBtn.style.background = tab==='opi'?'var(--blue)':'transparent'; oBtn.style.color = tab==='opi'?'#fff':'var(--dim)'; }
  // Style the CI button: active = teal background with white text and border
  if (cBtn) { cBtn.style.background = tab==='ci' ?'var(--teal)':'transparent'; cBtn.style.color = tab==='ci' ?'#fff':'var(--dim)'; cBtn.style.borderColor = tab==='ci'?'var(--teal)':'var(--border)'; }
}

/**
 * @description Switches the Progress page OPI/CI history section visibility
 *              and updates tab button styles accordingly.
 * @param {string} tab - The selected tab identifier: 'opi' or 'ci'.
 * @returns {void}
 */
function progSimTab(tab) {
  // Toggle visibility of the two history containers on the progress page
  document.getElementById('prog-opi-history').style.display = tab === 'opi' ? '' : 'none';
  document.getElementById('prog-ci-history').style.display  = tab === 'ci'  ? '' : 'none';
  // Reference both tab buttons on the progress page
  const oBtn = document.getElementById('prog-sim-tab-opi');
  const cBtn = document.getElementById('prog-sim-tab-ci');
  // Apply active/inactive styling to OPI button
  if (oBtn) { oBtn.style.background = tab==='opi'?'var(--blue)':'transparent'; oBtn.style.color = tab==='opi'?'#fff':'var(--dim)'; oBtn.style.borderColor = tab==='opi'?'var(--blue)':'var(--border)'; }
  // Apply active/inactive styling to CI button
  if (cBtn) { cBtn.style.background = tab==='ci' ?'var(--teal)':'transparent'; cBtn.style.color = tab==='ci' ?'#fff':'var(--dim)'; cBtn.style.borderColor = tab==='ci'?'var(--teal)':'var(--border)'; }
}

// ══════════════════════════════════════════════════════════════════════════════
// CONSECUTIVE INTERPRETATION (CI) SIMULATION — Frontend
// ══════════════════════════════════════════════════════════════════════════════

// ── State ──────────────────────────────────────────────────────────────────
let ciSid          = null;           // Current session ID from backend
let ciSegNum       = 0;              // Current segment number in the active session
let ciMaxSegs      = 4;              // Maximum segments for this session
let ciSegText      = '';             // Text content of the current segment
let ciPersona      = {};             // Speaker persona metadata for the session
let ciField        = '';             // legacy compat (set at session start)
let ciLang         = '';             // legacy compat (set at session start)
let ciDifficulty   = 'intermediate'; // Selected difficulty level
let ciRenditions   = [];             // Array of user renditions: {seg: N, notes, rendered}
let ciSightMode    = 'continuous';   // 'continuous' | 'chunked' — sight translation only
let ciAudioEl      = null;           // HTMLAudioElement for segment playback
let ciAudioBytes   = null;           // Stored ArrayBuffer for replay fix
let ciState        = 'setup';        // Current UI state: setup|loading|listening|rendering|submitting|evaluating|done

// New setup state variables
let ciSrcLang      = 'English';      // Source language selected by user
let ciTgtLang      = 'Arabic';       // Target language selected by user
let ciOneWay       = false;          // One-way interpretation toggle
let ciPace         = 2;              // Pace setting (affects segment length)
let ciParticipants = 0;              // Number of participants in the scenario
let ciActiveField  = 'medical';      // Active professional field domain
let ciFieldType    = '';             // Sub-type within field (e.g. 'Workshop', 'Asylum Interview')
let ciDuration     = 10;             // Session duration in minutes — AI calculates segment count
let ciModeKind     = 'consecutive';  // 'consecutive' | 'simultaneous' — SI reuses this entire overlay
let ciAtmosphere   = 'booth';        // SI only: 'booth' | 'remote-stable' | 'remote-intermittent' | 'remote-poor'
let ciNoiseLevel   = 'quiet';        // Chuchotage only: 'quiet' | 'moderate' | 'noisy'
let ciListenerCount = 1;             // Chuchotage only: 1 | 2
let ciScenarioType = 'business';     // Escort only: 'business' | 'social' | 'administrative'
let ciDocumentType = 'letter';       // Sight Translation only: 'letter' | 'form' | 'contract-excerpt' | 'news'
let ciVerbatim     = false;          // Legal Verbatim toggle — when ON, evaluation shifts to exact word matching
let ciReadStartTs  = 0;              // Sight Translation only: timestamp when document text was shown, for WPM capture
let ciEvsTargetSec = 3.0;            // SI/Chuchotage only: Ear-Voice-Span target for this pace/difficulty
let ciSegStartTs   = 0;              // SI/Chuchotage only: timestamp when current segment audio started, for décalage capture
let ciDecalageTimer = null;          // SI/Chuchotage: interval handle for updating décalage UI
let ciRecStartTs    = 0;             // SI/Chuchotage: timestamp when recording started
let ciWpmTarget    = 62.0;           // Sight Translation only: target words-per-minute throughput for this pace/difficulty
let ciRotationShown = false;         // SI/CI: 20-30 min rotation-reminder shown-once flag

// Canvas animation state
let ciAnimId       = null;           // requestAnimationFrame ID for canvas loop
let ciActiveSpeakerIdx = 0;          // Index of the currently speaking participant
let ciRoomTick     = 0;              // Animation frame tick counter
let ciSessionTimer = null;           // setInterval handle for session elapsed-time display

// ── CI Overlay Controls ──────────────────────────────────────────────────────

/**
 * @description Determines the player's current level based on accumulated XP.
 *              Iterates through XP_LEVEL_THRESHOLDS to find the highest
 *              threshold that does not exceed the provided XP value.
 * @param {number} xp - The total experience points accumulated by the player.
 * @returns {number} The zero-based level index.
 */
function getLevel(xp) {
  let level = 0;                       // Start at level 0 (Novice)
  // Iterate through all defined XP thresholds
  for (let i = 0; i < XP_LEVEL_THRESHOLDS.length; i++) {
    // If XP meets or exceeds this threshold, promote to this level
    if (xp >= XP_LEVEL_THRESHOLDS[i]) level = i;
    else break;                        // Stop once threshold exceeds XP (sorted ascending)
  }
  return level;
}

/**
 * @description Calculates the XP reward for a single session based on its type
 *              and score. Higher-scoring sessions in harder modes yield more XP.
 * @param {Object} s - A session object containing at minimum `type` and `score`.
 * @param {string} s.type - Session type: 'interp', 'vo', or other.
 * @param {string|number} s.score - The session's evaluated score.
 * @returns {number} The calculated XP value (rounded integer).
 */
function sessionXP(s) {
  const score = parseFloat(s.score) || 0;   // Normalize score to a number, default 0
  // Consecutive interpretation awards the most XP (base 50 + 50% of score)
  if (s.type === 'interp') return Math.round(50 + score * 0.5);
  // Voice-over awards moderate XP (base 40 + 40% of score)
  if (s.type === 'vo') return Math.round(40 + score * 0.4);
  // Fallback for any other session type
  return 30;
}

/**
 * @description Computes the current practice streak by comparing session dates
 *              against localStorage-stored streak metadata. Updates localStorage
 *              when streak state changes.
 * @param {Array<Object>} sessions - Array of session objects (used to derive dates from filenames).
 * @returns {Object} Object containing `streak` (current count), `best` (all-time best),
 *                   and `practisedToday` (boolean).
 */
function updateStreak(sessions) {
  // Derive unique practice dates from session filenames (YYYYMMDD from filename stem)
  const today = new Date(); today.setHours(0,0,0,0);
  const dates = [...new Set(sessions.map(s => {
    const m = s.file.match(/_(\d{8})_/);
    return m ? m[1] : null;
  }).filter(Boolean))].sort();

  // Store streak in localStorage
  const storedStreak = parseInt(localStorage.getItem('mad_streak') || '0');
  const storedBest = parseInt(localStorage.getItem('mad_best_streak') || '0');
  const storedLast = localStorage.getItem('mad_last_date') || '';

  // Format today's date as YYYYMMDD for comparison
  const todayStr = today.toISOString().slice(0,10).replace(/-/g,'');
  const practisedToday = dates.includes(todayStr);
  // Calculate yesterday's date string
  const yday = new Date(today); yday.setDate(yday.getDate()-1);
  const ydayStr = yday.toISOString().slice(0,10).replace(/-/g,'');

  let streak = storedStreak;
  // If the user practised today and we haven't already recorded it, increment streak
  if (practisedToday && storedLast !== todayStr) {
    streak = (storedLast === ydayStr ? storedStreak : 0) + 1;
    localStorage.setItem('mad_streak', streak);
    localStorage.setItem('mad_last_date', todayStr);
  } else if (!practisedToday && storedLast !== ydayStr && storedLast !== todayStr) {
    // Streak broken: no practice today AND last practice wasn't yesterday
    streak = 0;
    localStorage.setItem('mad_streak', 0);
  }

  // Update best streak if current streak surpasses it
  const best = Math.max(storedBest, streak);
  localStorage.setItem('mad_best_streak', best);
  return { streak, best, practisedToday };
}

/**
 * @description Renders the achievement grid by evaluating session history against
 *              a fixed set of achievement criteria. Unlocked achievements receive
 *              a special CSS class for visual distinction.
 * @param {Array<Object>} sessions - Array of all session objects.
 * @returns {void}
 */
function renderAchievements(sessions) {
  const total = sessions.length;
  // Count sessions by type for type-specific achievements
  const interpCount = sessions.filter(s=>s.type==='interp').length;
  const voCount = sessions.filter(s=>s.type==='vo').length;
  // Estimate total practice hours (assumes ~15 minutes per session)
  const estimatedHrs = (total * 15) / 60;

  // ── Week range calculation ──
  const now = new Date(); const dow = now.getDay(); const msDay = 86400000;
  // Monday-based week start
  const weekStart = new Date(now - (dow === 0 ? 6 : dow-1) * msDay); weekStart.setHours(0,0,0,0);
  // Extract timestamps from filenames for week-filtering
  const sessionDates = sessions.map(s => { const m = s.file.match(/_(\d{8})_(\d{6})/); if (!m) return 0; const d = m[1]; return new Date(d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6,8)).getTime(); });
  const thisWeek = sessions.filter((s,i) => sessionDates[i] >= weekStart.getTime());
  const categoriesThisWeek = new Set(thisWeek.map(s=>s.type)).size;

  // Define all achievements with their unlock conditions and progress metrics
  const ACHIEVEMENTS = [
    { id:'first_steps', name:'First Steps', desc:'Complete your first session', unlocked: total >= 1, progress: Math.min(total,1), max:1 },
    { id:'getting_started', name:'Getting Started', desc:'Complete 5 practice sessions', unlocked: total >= 5, progress: Math.min(total,5), max:5 },
    { id:'dedicated', name:'Dedicated Learner', desc:'Accumulate 10 hours of practice', unlocked: estimatedHrs>=10, progress: Math.min(estimatedHrs,10).toFixed(1), max:10, unit:'h' },
    { id:'week_warrior', name:'Week Warrior', desc:'5 sessions in one week', unlocked: thisWeek.length>=5, progress: Math.min(thisWeek.length,5), max:5 },
    { id:'polyglot', name:'Bilingual Voice', desc:'Practice both language directions', unlocked: interpCount>=2, progress: Math.min(interpCount,1)+Math.min(voCount,1), max:2 },
    { id:'explorer', name:'Category Explorer', desc:'Use both training modules', unlocked: (interpCount>0&&voCount>0), progress: (interpCount>0?1:0)+(voCount>0?1:0), max:2 },
    { id:'centurion', name:'Centurion', desc:'Complete 100 sessions', unlocked: total>=100, progress: Math.min(total,100), max:100 }
  ];

  // Render achievement cards into the grid container
  document.getElementById('achievements-grid').innerHTML = ACHIEVEMENTS.map(a => `
    <div class="achievement ${a.unlocked ? 'unlocked' : ''}">
      <div class="ach-icon"><div class="ach-icon-pip"></div></div>
      <div class="ach-name">${a.name}</div>
      <div class="ach-desc">${a.desc}</div>
      <div class="ach-prog">${a.unlocked ? 'Unlocked' : `${a.progress}/${a.max}${a.unit||''}`}</div>
    </div>`).join('');
}

/**
 * @description Renders the daily/weekly goals progress bars by aggregating
 *              session counts against configurable targets.
 * @param {Array<Object>} sessions - Array of session objects.
 * @param {Object} streakData - Object from updateStreak() containing current streak.
 * @param {number} streakData.streak - Current consecutive-day streak count.
 * @returns {void}
 */
function renderGoals(sessions, streakData) {
  // ── Time boundaries ──
  const now = new Date(); const dow = now.getDay(); const msDay = 86400000;
  // Monday-based week start
  const weekStart = new Date(now - (dow === 0 ? 6 : dow-1) * msDay); weekStart.setHours(0,0,0,0);
  const todayStart = new Date(now); todayStart.setHours(0,0,0,0);

  // Extract timestamps from session filenames
  const sessionTimes = sessions.map(s => { const m = s.file.match(/_(\d{8})_(\d{6})/); if (!m) return 0; const d=m[1],t=m[2]; return new Date(`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${t.slice(0,2)}:${t.slice(2,4)}:${t.slice(4,6)}`).getTime(); });
  // Filter sessions that occurred today and this week
  const todaySessions = sessions.filter((s,i) => sessionTimes[i] >= todayStart.getTime()).length;
  const weekSessions = sessions.filter((s,i) => sessionTimes[i] >= weekStart.getTime()).length;
  // Estimate minutes practised today (15 min per session assumption)
  const todayMins = todaySessions * 15;

  // Define goal targets with display colors
  const GOALS = [
    { name:'Daily Practice', val:todayMins, max:30, unit:'min', color:'#06b6d4' },
    { name:'Weekly Sessions', val:weekSessions, max:5, unit:'sessions', color:'#3b82f6' },
    { name:'Streak', val:streakData.streak, max:7, unit:'days', color:'#f97316' },
    { name:'Module Coverage', val:new Set(sessions.filter((s,i)=>sessionTimes[i]>=weekStart.getTime()).map(s=>s.type)).size, max:3, unit:'modules', color:'#8b5cf6' }
  ];

  // Render each goal as a progress bar with label and percentage
  document.getElementById('goals-list').innerHTML = GOALS.map(g => {
    const pct = Math.min(100, Math.round((g.val / g.max) * 100));
    const done = g.val >= g.max;
    return `<div class="goal-item">
      <div class="goal-header">
        <div class="goal-name">${g.name}</div>
        <div class="goal-count" style="color:${done?'var(--green)':g.color}">${g.val}/${g.max} ${g.unit}</div>
      </div>
      <div class="goal-bar-outer">
        <div class="goal-bar-fill ${done?'complete':'progress'}" style="width:${pct}%;background:${done?'var(--green)':g.color}"></div>
      </div>
    </div>`;
  }).join('');
}

/**
 * @description Renders a performance bar chart showing the 10 most recent sessions
 *              across all session types (backend sessions + OPI/CI localStorage sessions).
 *              Bars are color-coded by session type and show score on hover.
 * @param {Array<Object>} sessions - Backend session objects.
 * @returns {void}
 */
function renderPerfChart(sessions) {
  // ── Merge backend sessions with OPI sessions from localStorage ──
  const _opiLS = JSON.parse(localStorage.getItem('opi-sessions') || '[]').map(s => ({
    _opi: true, type: 'opi', score: s.overall_score,
    isoDate: s.isoDate, grade: s.grade, field: s.field,
  }));
  const _ciLS = JSON.parse(localStorage.getItem('ci-sessions') || '[]').map(s => ({
    _ci: true, type: 'ci', score: s.overall_score,
    isoDate: s.isoDate, grade: s.grade, field: s.field,
  }));
  // Interleave by date: backend sessions have file timestamps, OPI/CI have isoDate
  const _all = [...sessions.map(s => ({...s, _opi:false, _ci:false})), ..._opiLS, ..._ciLS];
  // Sort all sessions by date descending (newest first)
  _all.sort((a,b) => {
    const da = a.isoDate ? new Date(a.isoDate) : (a.file?.match(/_(\d{8})_(\d{6})/) ? new Date(a.file.match(/_(\d{8})_(\d{6})/)[1].replace(/(\d{4})(\d{2})(\d{2})/,'$1-$2-$3')) : new Date(0));
    const db = b.isoDate ? new Date(b.isoDate) : (b.file?.match(/_(\d{8})_(\d{6})/) ? new Date(b.file.match(/_(\d{8})_(\d{6})/)[1].replace(/(\d{4})(\d{2})(\d{2})/,'$1-$2-$3')) : new Date(0));
    return db - da;
  });
  // Take the 10 most recent and reverse so oldest is leftmost in the chart
  const last10 = _all.slice(0, 10).reverse();
  // Color and label mappings for each session type
  const colors = { interp:'var(--gold)', vo:'var(--green)', opi:'var(--purple)', opi_sim:'var(--purple)', ci:'var(--teal)' };
  const labels = { interp:'Consec', vo:'VO', opi:'OPI', opi_sim:'OPI', ci:'CI' };
  // Render vertical bar chart into perf-chart container
  document.getElementById('perf-chart').innerHTML = last10.map(s => {
    const score = parseFloat(s.score || s.overall_score) || 0;
    const h = Math.max(8, score); // Minimum 8% height for visibility
    const col = colors[s.type] || 'var(--dim)';
    const lbl = labels[s.type] || s.type;
    return `<div class="perf-bar-wrap" title="${lbl}: ${Math.round(score)}${s.grade?' ('+s.grade+')':''}">
      <div class="perf-bar" style="height:${h}%;background:${col}"></div>
      <div class="perf-label">${lbl}</div>
    </div>`;
  }).join('');
}

/**
 * @description Loads and renders the full Progress page including XP/level display,
 *              streak stats, achievements, goals, performance chart, OPI/CI history,
 *              and the detailed session list. Also attempts to render an optional
 *              FIFA-style dashboard v2 if DashboardRenderer is available.
 * @async
 * @returns {Promise<void>}
 */
async function loadProgress() {
  try {
    // ── Fetch session data from backend ──
    const r = await fetch('/api/sessions');
    const sessions = await r.json();
    document.getElementById('session-count').textContent = sessions.length + ' sessions';

    // ── FIFA-Style Dashboard v2 (render FIRST, always) ───────
    try {
      // Only attempt to render if the DashboardRenderer class is loaded
      if (typeof DashboardRenderer !== 'undefined') {
        const dbContainer = document.getElementById('dashboard-v2-container');
        if (dbContainer) {
          dbContainer.style.display = 'block';
          // Instantiate renderer; second arg intentionally null for both empty/non-empty states
          const renderer = new DashboardRenderer('dashboard-v2-container', sessions.length ? null : null);
          await renderer.render();
        }
      }
    } catch (e) { console.error('Dashboard v2 render error:', e); }

    // ── Early exit: no sessions ──
    if (!sessions.length) {
      document.getElementById('progress-list').innerHTML = '<div class="loading">No sessions yet — start practicing!</div>';
      document.getElementById('xp-display').textContent = '0';
      document.getElementById('streak-display').textContent = '0';
      document.getElementById('hours-display').textContent = '0';
      renderAchievements([]);
      renderGoals([], { streak: 0, best: 0 });
      return;
    }

    // ── XP & Level ──────────────────────────────────────────
    const totalXP = sessions.reduce((sum, s) => sum + sessionXP(s), 0);
    const level = getLevel(totalXP);
    const nextThresh = XP_LEVEL_THRESHOLDS[Math.min(level+1, XP_LEVEL_THRESHOLDS.length-1)];
    const prevThresh = XP_LEVEL_THRESHOLDS[level];
    const pct = nextThresh > prevThresh ? Math.round(((totalXP - prevThresh) / (nextThresh - prevThresh)) * 100) : 100;
    document.getElementById('xp-display').textContent = totalXP.toLocaleString();
    document.getElementById('xp-sub').textContent = `XP — next level: ${nextThresh.toLocaleString()}`;
    document.getElementById('level-badge').textContent = `Level ${level+1}: ${LEVEL_NAMES[level]}`;
    document.getElementById('xp-bar').style.width = pct + '%';

    // ── Streak ───────────────────────────────────────────────
    const streakData = updateStreak(sessions);
    document.getElementById('streak-display').textContent = streakData.streak;
    document.getElementById('best-streak').textContent = streakData.best;
    document.getElementById('streak-sub').innerHTML = `days • Best: <span id="best-streak">${streakData.best}</span>`;
    // flameEmojis array exists as a placeholder for future emoji mapping
    const flameEmojis = ['','','','','','','','','',''];
    document.getElementById('streak-emoji').textContent = flameEmojis[Math.min(streakData.streak, flameEmojis.length-1)];

    // ── Hours ────────────────────────────────────────────────
    document.getElementById('hours-display').textContent = sessions.length;
    document.getElementById('total-time-display').textContent = `~${((sessions.length * 15) / 60).toFixed(1)} hours estimated`;

    // ── Achievements ─────────────────────────────────────────
    renderAchievements(sessions);

    // ── Goals ────────────────────────────────────────────────
    renderGoals(sessions, streakData);

    // ── Performance Chart ────────────────────────────────────
    renderPerfChart(sessions);

    // ── OPI Session History ─────────────────────────────────
    const _opiProg = JSON.parse(localStorage.getItem('opi-sessions') || '[]');
    const _ciProg  = JSON.parse(localStorage.getItem('ci-sessions')  || '[]');
    const _opiHistEl = document.getElementById('prog-opi-history');
    if (_opiHistEl) {
      if (_opiProg.length) {
        const _opiAvg = k => Math.round(_opiProg.reduce((a,s)=>a+(s[k]||0),0)/_opiProg.length);
        const _kpiDefs = [
          ['Accuracy',            'accuracy',             '--gold'],
          ['Fusha Compliance',    'fusha_compliance',     '--green'],
          ['Completeness',        'completeness',         '--blue'],
          ['Terminology',         'terminology',           '--purple'],
          ['Fluency',             'fluency',              '--teal'],
          ['Protocol',            'professional_protocol','--amber'],
        ];
        _opiHistEl.innerHTML = `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
            ${_kpiDefs.map(([label,key,col])=>`
              <div style="background:var(--bg3);border-radius:9px;padding:12px">
                <div style="font-size:10px;color:var(--dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em">${label}</div>
                <div style="font-size:22px;font-weight:800;color:var(${col})">${_opiAvg(key)}</div>
                <div style="background:var(--bg4);border-radius:3px;height:3px;margin-top:6px;overflow:hidden">
                  <div style="height:100%;width:${_opiAvg(key)}%;background:var(${col})"></div>
                </div>
              </div>`).join('')}
          </div>
          <div style="font-size:12px;color:var(--dim);margin-bottom:10px">${_opiProg.length} OPI calls recorded</div>
          <div style="max-height:220px;overflow-y:auto">
            ${_opiProg.slice(0,20).map(s=>{
              const gc={'Superior':'var(--green)','Advanced High':'var(--green)','Advanced Mid':'var(--gold)','Advanced Low':'var(--gold)','Intermediate High':'var(--amber)','Intermediate Mid':'var(--amber)','Intermediate Low':'var(--red)','Novice':'var(--red)'}[s.grade]||'var(--dim)';
              return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
                <div>
                  <div style="font-size:12px;font-weight:600;color:var(--text)">${s.scenario||s.field} · ${s.lang}</div>
                  <div style="font-size:11px;color:var(--dim)">${s.date} · ${s.duration}</div>
                </div>
                <div style="text-align:right">
                  <div style="font-size:14px;font-weight:700;color:${gc}">${s.grade||'—'}</div>
                  <div style="font-size:11px;color:var(--dim)">${s.overall_score||'—'}/100</div>
                </div>
              </div>`;
            }).join('')}
          </div>`;
      } else {
        // Empty-state message when no OPI sessions exist
        _opiHistEl.innerHTML = '<div style="font-size:12px;color:var(--dim);text-align:center;padding:16px">No OPI sessions yet — complete a simulation to track your KPIs here</div>';
      }
    }

    // ── CI Session History ────────────────────────────────────────────────────
    const _ciHistEl = document.getElementById('prog-ci-history');
    if (_ciHistEl) {
      if (_ciProg.length) {
        const _cin = _ciProg.length;
        const _ciavg = k => Math.round(_ciProg.reduce((a,s)=>a+(s[k]||0),0)/_cin);
        const _ciKpiDefs = [
          ['Accuracy',         'accuracy',             '--gold'],
          ['Completeness',     'completeness',         '--blue'],
          ['Memory Accuracy',  'memory_accuracy',      '--purple'],
          ['Terminology',      'terminology',           '--teal'],
          ['Seg. Handling',    'segment_handling',     '--green'],
          ['Protocol',         'professional_protocol','--amber'],
        ];
        _ciHistEl.innerHTML = `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
            ${_ciKpiDefs.map(([label,key,col])=>`
              <div style="background:var(--bg3);border-radius:9px;padding:12px">
                <div style="font-size:10px;color:var(--dim);margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em">${label}</div>
                <div style="font-size:22px;font-weight:800;color:var(${col})">${_ciavg(key)}</div>
                <div style="background:var(--bg4);border-radius:3px;height:3px;margin-top:6px;overflow:hidden">
                  <div style="height:100%;width:${_ciavg(key)}%;background:var(${col})"></div>
                </div>
              </div>`).join('')}
          </div>
          <div style="font-size:12px;color:var(--dim);margin-bottom:10px">${_cin} CI session${_cin!==1?'s':''} recorded</div>
          <div style="max-height:220px;overflow-y:auto">
            ${_ciProg.slice(0,20).map(s=>{
              const gc={'Excellent':'var(--green)','Good':'var(--gold)','Satisfactory':'var(--amber)','Needs Work':'var(--red)'}[(s.grade||'').split(' ')[0]]||'var(--dim)';
              return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
                <div>
                  <div style="font-size:12px;font-weight:600;color:var(--text)">${s.field} · ${s.lang}</div>
                  <div style="font-size:11px;color:var(--dim)">${s.segments} segments · ${s.difficulty}</div>
                </div>
                <div style="text-align:right">
                  <div style="font-size:14px;font-weight:700;color:${gc}">${s.grade||'—'}</div>
                  <div style="font-size:11px;color:var(--dim)">${s.overall_score||'—'}/100</div>
                </div>
              </div>`;
            }).join('')}
          </div>`;
      } else {
        // Empty-state message when no CI sessions exist
        _ciHistEl.innerHTML = '<div style="font-size:12px;color:var(--dim);text-align:center;padding:16px">No CI sessions yet — complete a session to track your KPIs here</div>';
      }
    }

    // ── Session List ─────────────────────────────────────────
    const typeNamesP = { interp:'Interpretation', vo:'Voice-Over', opi_sim:'OPI Call' };
    const typeColorsP = { interp:'var(--gold)', vo:'var(--green)', opi_sim:'var(--purple)' };
    document.getElementById('progress-list').innerHTML = sessions.map(s => {
      const xp = sessionXP(s);
      const scoreDisplay = s.score ? `${s.score}/100` : '—';
      // Extract date and time from filename pattern _YYYYMMDD_HHMMSS_
      const ts = s.file.match(/_(\d{8})_(\d{6})/);
      let dateStr = s.timestamp || '';
      if (ts) { const d=ts[1],t=ts[2]; dateStr = `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)} ${t.slice(0,2)}:${t.slice(2,4)}`; }
      const tColor = typeColorsP[s.type] || 'var(--dim)';
      return `<div class="progress-item">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:4px;height:32px;background:${tColor};border-radius:2px;flex-shrink:0"></div>
          <div>
            <div class="progress-type">${typeNamesP[s.type]||s.type}</div>
            <div style="font-size:11px;color:var(--dim)">${dateStr}</div>
          </div>
        </div>
        <div style="text-align:right">
          <div style="font-size:16px;font-weight:700;font-family:monospace;color:var(--gold)">${scoreDisplay}</div>
          <div style="font-size:10px;color:var(--amber)">+${xp} XP</div>
        </div>
      </div>`;
    }).join('');

    // ── Quick Stats ──────────────────────────────────────────
    const scored = sessions.filter(s=>s.score && parseFloat(s.score)>0);
    const avg = scored.length ? (scored.reduce((a,s)=>a+parseFloat(s.score),0)/scored.length).toFixed(1) : '—';
    const types = { interp: sessions.filter(s=>s.type==='interp').length, vo: sessions.filter(s=>s.type==='vo').length };
    document.getElementById('stats-display').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:12px;font-size:12px">
        <span style="color:var(--dim)">Avg score:</span><strong style="color:var(--gold)">${avg}</strong>
        <span style="color:var(--dim)">Interp:</span><strong>${types.interp}</strong>
        <span style="color:var(--dim)">Voice-Over:</span><strong>${types.vo}</strong>
      </div>`;

  } catch(e) {
    // Show a user-facing error in the session list area when the server is unreachable
    document.getElementById('progress-list').innerHTML = '<div class="loading">Could not load sessions — is the server running?</div>';
  }
}

// ── Skill Tree ─────────────────────────────────────────────────
