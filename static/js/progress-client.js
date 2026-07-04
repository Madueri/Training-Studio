/**
 * MAD Training Studio — Progress Client
 * Manages user progress state: module completion, mode unlocks, field unlocks,
 * achievements, next-target recommendations, and statistics.
 *
 * Integrates with the existing module cascade logic (MODULE_UNLOCK_RULES,
 * MODE_UNLOCK_MAP, FIELD_UNLOCK_MAP) and persists data in localStorage.
 *
 * Usage:
 *   const pc = new ProgressClient();
 *   await pc.load();
 *   const status = pc.getModuleStatus(1);
 *   pc.subscribe((data) => updateDashboard(data));
 */

const CACHE_KEY = 'mad_progress_cache';
const CACHE_TS_KEY = 'mad_progress_cache_ts';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const MODULE_TOTAL = 29;

const MODULE_UNLOCK_RULES = {
  learner:       Array.from({length:MODULE_TOTAL},(_,i)=>i+1).reduce((a, n) => { a[n] = n === 1; return a; }, {}),
  professional:  Object.fromEntries(Array.from({length:MODULE_TOTAL},(_,i)=>[i+1,true])),
  upskilling:    Array.from({length:MODULE_TOTAL},(_,i)=>i+1).reduce((a, n) => { a[n] = n <= 5; return a; }, {}),
};

const MODE_UNLOCK_MAP = {
  shadowing:    { practice: { always: true },      sim: null               },
  sight:        { practice: { assignModule: 16 },   sim: { passModule: 16 } },
  chuchotage:   { practice: { assignModule: 15 },   sim: { passModule: 15 } },
  consecutive:  { practice: { assignModule: 7  },   sim: { passModule: 9  } },
  escort:       { practice: { assignModule: 10 },   sim: { passModule: 10 } },
  simultaneous: { practice: { assignModule: 14 },   sim: { passModule: 17 } },
  opi:          { practice: { assignModule: 19 },   sim: { passModule: 21 } },
};

const FIELD_UNLOCK_MAP = {
  medical:     11, legal:       14, immigration: 15,
  business:    19, diplomatic:  21, academic:    24,
  community:   15, security:    27, media:       28,
};

const LEVEL_NAMES = ['Novice','Apprentice','Practitioner','Interpreter','Professional','Expert','Senior Expert','Master','Grand Master','Legend'];
const XP_LEVEL_THRESHOLDS = [0,200,500,1000,2000,3500,5500,8000,11000,15000];

class ProgressClient {
  constructor() {
    this._data = null;
    this._listeners = [];
    this._refreshTimer = null;
    this._initialized = false;
  }

  /**
   * Load progress from cache + optionally fetch fresh data from the server.
   * Call once at app startup.
   */
  async load() {
    const cached = this._readCache();
    if (cached) {
      this._data = cached;
      this._notify();
    }

    // Attempt server refresh in the background (non-blocking)
    this._refresh().catch(() => {});

    // Auto-refresh every 5 minutes while the page is open
    this._startAutoRefresh();

    this._initialized = true;
    return this._data;
  }

  /**
   * Return the current cached progress object without fetching.
   */
  getCached() {
    return this._data || this._readCache() || this._buildEmptyState();
  }

  /**
   * Get the status for a single module.
   * @param {number} moduleId
   * @returns {{done:boolean, unlocked:boolean, locked:boolean}}
   */
  getModuleStatus(moduleId) {
    const state = this.getCached();
    const done = !!state.modulesDone[moduleId];
    const unlocked = !!state.moduleRules[moduleId];
    return { done, unlocked, locked: !unlocked };
  }

  /**
   * Get unlock status for all practice modes.
   * @returns {Object<string, {practiceUnlocked:boolean, simUnlocked:boolean, moduleId:number|null, simModuleId:number|null}>}
   */
  getModeUnlocks() {
    const state = this.getCached();
    return state.modeProgress || {};
  }

  /**
   * Get unlock status for all field/domains.
   * @returns {Object<string, boolean>}
   */
  getFieldUnlocks() {
    const state = this.getCached();
    return state.fieldUnlocks || {};
  }

  /**
   * Compute achievements based on session history.
   * @returns {Array<{id:string, name:string, desc:string, unlocked:boolean, progress:number, max:number, unit?:string}>}
   */
  getAchievements() {
    const state = this.getCached();
    const sessions = state.sessions || [];
    const total = sessions.length;
    const interpCount = sessions.filter(s=>s.type==='interp').length;
    const voCount = sessions.filter(s=>s.type==='vo').length;
    const ieltsCount = sessions.filter(s=>s.type==='ielts').length;
    const estimatedHrs = (total * 15) / 60;

    const now = new Date(); const dow = now.getDay(); const msDay = 86400000;
    const weekStart = new Date(now - (dow === 0 ? 6 : dow-1) * msDay); weekStart.setHours(0,0,0,0);
    const sessionDates = sessions.map(s => {
      const m = s.file?.match(/_(\d{8})_(\d{6})/);
      if (!m) return 0;
      const d = m[1]; return new Date(`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`).getTime();
    });
    const thisWeek = sessions.filter((s,i) => sessionDates[i] >= weekStart.getTime());

    return [
      { id:'first_steps',     name:'First Steps',         desc:'Complete your first session',                 unlocked: total >= 1,   progress: Math.min(total,1), max:1 },
      { id:'getting_started', name:'Getting Started',     desc:'Complete 5 practice sessions',              unlocked: total >= 5,   progress: Math.min(total,5), max:5 },
      { id:'dedicated',       name:'Dedicated Learner',  desc:'Accumulate 10 hours of practice',             unlocked: estimatedHrs>=10, progress: Math.min(estimatedHrs,10).toFixed(1), max:10, unit:'h' },
      { id:'week_warrior',    name:'Week Warrior',         desc:'5 sessions in one week',                     unlocked: thisWeek.length>=5, progress: Math.min(thisWeek.length,5), max:5 },
      { id:'polyglot',        name:'Bilingual Voice',      desc:'Practice both language directions',           unlocked: interpCount>=2, progress: Math.min(interpCount,1)+Math.min(voCount,1), max:2 },
      { id:'scholar',         name:'IELTS Scholar',        desc:'Complete 3 IELTS sessions',                   unlocked: ieltsCount>=3, progress: Math.min(ieltsCount,3), max:3 },
      { id:'explorer',        name:'Category Explorer',    desc:'Use all 3 training modules',                   unlocked: (interpCount>0&&voCount>0&&ieltsCount>0), progress: (interpCount>0?1:0)+(voCount>0?1:0)+(ieltsCount>0?1:0), max:3 },
      { id:'centurion',       name:'Centurion',            desc:'Complete 100 sessions',                      unlocked: total>=100, progress: Math.min(total,100), max:100 },
    ];
  }

  /**
   * Recommend the next module or practice mode based on current progress.
   * @returns {{type:'module'|'mode', id:number|string, label:string, reason:string}}
   */
  getNextTarget() {
    const state = this.getCached();
    const path = state.path || 'learner';
    const done = state.modulesDone || {};
    const rules = state.moduleRules || {};

    // Find first unlocked but not-done module
    for (let n = 1; n <= MODULE_TOTAL; n++) {
      if (rules[n] && !done[n]) {
        return { type: 'module', id: n, label: `Module ${n}`, reason: 'Next in your learning path' };
      }
    }

    // All modules done — suggest weakest mode
    const modes = this.getModeUnlocks();
    const unlockedModes = Object.entries(modes).filter(([,v]) => v.practiceUnlocked);
    if (unlockedModes.length) {
      const [modeName] = unlockedModes[0];
      return { type: 'mode', id: modeName, label: modeName, reason: 'Keep your skills sharp' };
    }

    return { type: 'module', id: 1, label: 'Module 1', reason: 'Start your journey' };
  }

  /**
   * Get summary statistics.
   * @returns {{totalSessions:number, avgScore:number|null, currentLevel:number, levelName:string, xp:number, streak:number, bestStreak:number, totalHours:number}}
   */
  getStats() {
    const state = this.getCached();
    const sessions = state.sessions || [];
    const total = sessions.length;
    const scored = sessions.filter(s => s.score && parseFloat(s.score) > 0);
    const avg = scored.length ? (scored.reduce((a,s)=>a+parseFloat(s.score),0)/scored.length).toFixed(1) : null;
    const xp = total * 50; // simplified XP estimate
    const level = this._getLevelFromXP(xp);
    const streakData = state.streak || { streak: 0, best: 0 };

    return {
      totalSessions: total,
      avgScore: avg ? parseFloat(avg) : null,
      currentLevel: level + 1,
      levelName: LEVEL_NAMES[level] || 'Novice',
      xp,
      streak: streakData.streak,
      bestStreak: streakData.best,
      totalHours: ((total * 15) / 60).toFixed(1),
    };
  }

  /**
   * Subscribe to progress changes. Callback receives the full state object.
   * @param {function} callback
   * @returns {function} unsubscribe function
   */
  subscribe(callback) {
    if (typeof callback !== 'function') return () => {};
    this._listeners.push(callback);
    // Immediately notify with current state
    if (this._data) callback(this._data);
    return () => {
      this._listeners = this._listeners.filter(cb => cb !== callback);
    };
  }

  /**
   * Mark a module as completed and recompute derived state.
   * @param {number} moduleId
   */
  markModuleDone(moduleId) {
    const state = this.getCached();
    state.modulesDone[moduleId] = true;
    this._recomputeState(state);
    this._persist(state);
    this._notify();
  }

  /**
   * Set the user's path and recompute state.
   * @param {string} path — 'learner' | 'professional' | 'upskilling'
   */
  setPath(path) {
    const state = this.getCached();
    state.path = path;
    this._recomputeState(state);
    this._persist(state);
    this._notify();
  }

  // ── Private helpers ───────────────────────────────────────────────

  _buildEmptyState() {
    return {
      path: 'learner',
      modulesDone: {},
      moduleRules: { ...MODULE_UNLOCK_RULES.learner },
      modeProgress: {},
      fieldUnlocks: {},
      sessions: [],
      streak: { streak: 0, best: 0 },
    };
  }

  _recomputeState(state) {
    const path = state.path || 'learner';
    const done = state.modulesDone || {};
    const rules = JSON.parse(JSON.stringify(MODULE_UNLOCK_RULES[path] || MODULE_UNLOCK_RULES['learner']));

    if (path === 'learner') {
      for (let n = 2; n <= MODULE_TOTAL; n++) { if (done[n-1]) rules[n] = true; }
    }

    const modeProgress = {};
    for (const [mode, rule] of Object.entries(MODE_UNLOCK_MAP)) {
      const practiceUnlocked = !!(rule.practice.always || rules[rule.practice.assignModule]);
      const simUnlocked = rule.sim ? !!done[rule.sim.passModule] : false;
      modeProgress[mode] = {
        practiceUnlocked,
        simUnlocked,
        moduleId: rule.practice.assignModule || null,
        simModuleId: rule.sim ? rule.sim.passModule : null,
      };
    }

    const fieldUnlocks = {};
    for (const [field, moduleId] of Object.entries(FIELD_UNLOCK_MAP)) {
      fieldUnlocks[field] = !!done[moduleId];
    }

    state.moduleRules = rules;
    state.modeProgress = modeProgress;
    state.fieldUnlocks = fieldUnlocks;
    return state;
  }

  async _refresh() {
    try {
      // Fetch sessions from server
      const sessions = await api('/api/sessions');
      const state = this.getCached();
      state.sessions = Array.isArray(sessions) ? sessions : [];

      // Recompute streak from sessions
      state.streak = this._computeStreak(state.sessions);

      this._recomputeState(state);
      this._persist(state);
      this._notify();
    } catch (e) {
      console.warn('[ProgressClient] refresh failed:', e);
    }
  }

  _computeStreak(sessions) {
    const today = new Date(); today.setHours(0,0,0,0);
    const dates = [...new Set(sessions.map(s => {
      const m = s.file?.match(/_(\d{8})_/);
      return m ? m[1] : null;
    }).filter(Boolean))].sort();

    const storedStreak = parseInt(localStorage.getItem('mad_streak') || '0');
    const storedBest = parseInt(localStorage.getItem('mad_best_streak') || '0');
    const storedLast = localStorage.getItem('mad_last_date') || '';

    const todayStr = today.toISOString().slice(0,10).replace(/-/g,'');
    const practisedToday = dates.includes(todayStr);
    const yday = new Date(today); yday.setDate(yday.getDate()-1);
    const ydayStr = yday.toISOString().slice(0,10).replace(/-/g,'');

    let streak = storedStreak;
    if (practisedToday && storedLast !== todayStr) {
      streak = (storedLast === ydayStr ? storedStreak : 0) + 1;
      localStorage.setItem('mad_streak', streak);
      localStorage.setItem('mad_last_date', todayStr);
    } else if (!practisedToday && storedLast !== ydayStr && storedLast !== todayStr) {
      streak = 0;
      localStorage.setItem('mad_streak', 0);
    }
    const best = Math.max(storedBest, streak);
    localStorage.setItem('mad_best_streak', best);
    return { streak, best, practisedToday };
  }

  _getLevelFromXP(xp) {
    let level = 0;
    for (let i = 0; i < XP_LEVEL_THRESHOLDS.length; i++) {
      if (xp >= XP_LEVEL_THRESHOLDS[i]) level = i;
      else break;
    }
    return level;
  }

  _readCache() {
    try {
      const ts = parseInt(localStorage.getItem(CACHE_TS_KEY) || '0');
      if (Date.now() - ts > CACHE_TTL_MS) return null;
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return this._recomputeState(data);
    } catch {
      return null;
    }
  }

  _persist(state) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(state));
      localStorage.setItem(CACHE_TS_KEY, String(Date.now()));
    } catch (e) {
      console.warn('[ProgressClient] localStorage write failed:', e);
    }
  }

  _notify() {
    if (!this._data) return;
    this._listeners.forEach(cb => {
      try { cb(this._data); } catch (e) { console.error(e); }
    });
  }

  _startAutoRefresh() {
    if (this._refreshTimer) clearInterval(this._refreshTimer);
    this._refreshTimer = setInterval(() => this._refresh().catch(() => {}), CACHE_TTL_MS);
  }

  dispose() {
    if (this._refreshTimer) clearInterval(this._refreshTimer);
    this._listeners = [];
  }
}

// ── Global export ───────────────────────────────────────────────────
export { ProgressClient };

if (typeof window !== 'undefined') {
  window.ProgressClient = ProgressClient;
}
