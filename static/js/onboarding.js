/**
 * InterpLing — Onboarding Wizard Controller
 * Manages the 4-step onboarding flow, category routing, placement test UI,
 * and calibration session. Integrates with the existing HTML overlay
 * (#ob-overlay) and calls `goPage('learn')` on completion.
 *
 * Usage:
 *   const ob = new OnboardingController();
 *   ob.start();   // shows overlay if not already onboarded
 */

const PLACEMENT_LEGS = [
  { mode: 'shadowing',    label: 'Shadowing clip',              graded: false },
  { mode: 'consecutive',  label: 'Consecutive segment',         graded: true  },
  { mode: 'sight',        label: 'Sight Translation passage',   graded: true  },
  { mode: 'simultaneous', label: 'Simultaneous clip',           graded: true  },
];

const MODULE_TOTAL = 29;

const MODULE_UNLOCK_RULES = {
  learner:       Array.from({length:MODULE_TOTAL},(_,i)=>i+1).reduce((a, n) => { a[n] = n === 1; return a; }, {}),
  professional:  Object.fromEntries(Array.from({length:MODULE_TOTAL},(_,i)=>[i+1,true])),
  upskilling:    Array.from({length:MODULE_TOTAL},(_,i)=>i+1).reduce((a, n) => { a[n] = n <= 5; return a; }, {}),
};

class OnboardingController {
  constructor() {
    this.step = 0;
    this.answers = { 0: null, 1: null, 2: [], 3: null, 4: null };
    this._overlay = null;
    this._progressDots = null;
    this._steps = [];
  }

  // ── Entry point ──────────────────────────────────────────────────────

  /**
   * Start the onboarding wizard if the user hasn't completed it yet.
   */
  start() {
    if (localStorage.getItem('il_onboarded')) {
      // Already onboarded — nothing to do
      return false;
    }
    this._cacheRefs();
    this._showOverlay();
    this._goToStep(0);
    return true;
  }

  /**
   * Restart the onboarding for testing or reconfiguration.
   */
  restart() {
    localStorage.removeItem('il_onboarded');
    localStorage.removeItem('il_path');
    localStorage.removeItem('il_ob_answers');
    localStorage.removeItem('mad_onboarding_category');
    localStorage.removeItem('mad_placement_pending');
    localStorage.removeItem('mad_placement_progress');
    localStorage.removeItem('mad_calibration_pending');
    this.answers = { 0: null, 1: null, 2: [], 3: null, 4: null };
    this.start();
  }

  // ── Step navigation (mirrors existing obNext / obBack) ───────────────

  next() {
    if (this.step >= 4) {
      this.finish();
      return;
    }
    this.step++;
    this._goToStep(this.step);
  }

  back() {
    if (this.step <= 0) return;
    this.step--;
    this._goToStep(this.step);
  }

  // ── Selection handlers ───────────────────────────────────────────────

  select(step, value) {
    this.answers[step] = value;
    // Visual update
    const opts = document.querySelectorAll(`.ob-opts[data-step="${step}"] .ob-opt`);
    opts.forEach(o => o.classList.remove('selected'));
    const target = [...opts].find(o => o.getAttribute('onclick')?.includes(`obSelect(${step},'${value}')`));
    if (target) target.classList.add('selected');
  }

  selectMulti(step, value) {
    const arr = this.answers[step];
    const idx = arr.indexOf(value);
    const opts = document.querySelectorAll(`.ob-opts[data-step="${step}"] .ob-opt`);
    const target = [...opts].find(o => o.getAttribute('onclick')?.includes(`obSelectMulti(${step},'${value}')`));
    if (idx === -1) {
      arr.push(value);
      if (target) target.classList.add('selected');
    } else {
      arr.splice(idx, 1);
      if (target) target.classList.remove('selected');
    }
  }

  // ── Finish + routing ─────────────────────────────────────────────────

  finish() {
    const purpose = this.answers[0];  // student | pro | upskill | eval
    const xp      = this.answers[1];  // none | training | mid | senior
    const modes   = this.answers[2] || [];

    let category = 'A';
    if (purpose === 'pro' && xp === 'senior') category = 'C';
    else if ((purpose === 'pro' && xp === 'mid') || (purpose === 'upskill' && (xp === 'mid' || xp === 'training'))) category = 'B';

    let startModule = 1;
    if (category === 'B') {
      if (modes.includes('si')) startModule = 14;
      else if (modes.includes('ci') || modes.includes('opi')) startModule = 8;
      else category = 'A'; // no signal — fall back to placement
    }

    let path = 'learner';
    if (category === 'C') path = 'professional';
    else if (category === 'B') path = 'upskilling';

    // Persist onboarding state
    localStorage.setItem('il_path', path);
    localStorage.setItem('il_onboarded', '1');
    localStorage.setItem('il_ob_answers', JSON.stringify(this.answers));
    localStorage.setItem('mad_onboarding_category', category);

    // Pre-seed completed modules for Category B
    const done = JSON.parse(localStorage.getItem('il_modules_done') || '{}');
    if (category === 'B') {
      for (let n = 1; n < startModule; n++) done[n] = true;
    }
    localStorage.setItem('il_modules_done', JSON.stringify(done));

    // Set placement / calibration flags
    if (category === 'A') {
      localStorage.setItem('mad_placement_pending', '1');
      localStorage.setItem('mad_placement_progress', '{}');
    } else if (category === 'C') {
      localStorage.setItem('mad_calibration_pending', '1');
    }

    // Recompute progress state (mirrors existing recomputeProgressState)
    if (typeof recomputeProgressState === 'function') recomputeProgressState();

    // Show result card
    this._renderResult(category, path, startModule);
    this._goToResult();

    // Save onboarding to server (best-effort, non-blocking)
    this._saveOnboardingServer({ category, path, startModule, answers: this.answers });
  }

  // ── Result routing ───────────────────────────────────────────────────

  closeResult() {
    const category = localStorage.getItem('mad_onboarding_category');
    if (category === 'A' && localStorage.getItem('mad_placement_pending') === '1') {
      this._renderPlacementLegs();
      this._showStep('ob-placement');
      return;
    }
    if (category === 'C' && localStorage.getItem('mad_calibration_pending') === '1') {
      this._showStep('ob-calibration');
      return;
    }
    this._hideOverlay();
    if (typeof goPage === 'function') goPage('learn');
  }

  // ── Placement test (Category A) ──────────────────────────────────────

  renderPlacementLegs() {
    this._renderPlacementLegs();
  }

  startPlacementLeg(mode, graded) {
    if (!graded) {
      const progress = JSON.parse(localStorage.getItem('mad_placement_progress') || '{}');
      progress[mode] = true;
      localStorage.setItem('mad_placement_progress', JSON.stringify(progress));
      this._maybeFinishPlacement();
      this._renderPlacementLegs();
      return;
    }
    localStorage.setItem('mad_active_placement_leg', mode);
    this._hideOverlay();
    if (typeof goPage === 'function') goPage('practice');
    if (typeof enterPractice === 'function') enterPractice(mode);
  }

  skipPlacement() {
    localStorage.removeItem('mad_placement_pending');
    localStorage.removeItem('mad_placement_progress');
    this._hideOverlay();
    if (typeof goPage === 'function') goPage('learn');
  }

  // ── Calibration (Category C) ─────────────────────────────────────────

  startCalibration() {
    localStorage.setItem('mad_active_calibration', '1');
    this._hideOverlay();
    if (typeof goPage === 'function') goPage('practice');
    if (typeof enterPractice === 'function') enterPractice('opi');
  }

  skipCalibration() {
    localStorage.removeItem('mad_calibration_pending');
    this._hideOverlay();
    if (typeof goPage === 'function') goPage('learn');
  }

  // ── Achievement unlock ───────────────────────────────────────────────

  unlockFirstCompletionAchievement() {
    const achievements = JSON.parse(localStorage.getItem('mad_achievements') || '[]');
    if (!achievements.includes('first_completion')) {
      achievements.push('first_completion');
      localStorage.setItem('mad_achievements', JSON.stringify(achievements));
      if (typeof showToast === 'function') {
        showToast('Achievement unlocked: First Steps!', 'success');
      }
    }
  }

  // ── Private UI helpers ─────────────────────────────────────────────────

  _cacheRefs() {
    this._overlay = document.getElementById('ob-overlay');
    this._progressDots = document.querySelectorAll('.ob-prog-dot');
    this._steps = document.querySelectorAll('.ob-step');
  }

  _showOverlay() {
    if (this._overlay) this._overlay.style.display = 'flex';
  }

  _hideOverlay() {
    if (this._overlay) this._overlay.style.display = 'none';
  }

  _goToStep(index) {
    this._steps.forEach((s, i) => s.classList.toggle('active', i === index));
    this._progressDots.forEach((d, i) => d.classList.toggle('active', i <= index));
  }

  _showStep(id) {
    this._steps.forEach(s => s.classList.remove('active'));
    const target = document.getElementById(id);
    if (target) target.classList.add('active');
  }

  _goToResult() {
    this._steps.forEach(s => s.classList.remove('active'));
    const resultEl = document.getElementById('ob-result');
    if (resultEl) resultEl.classList.add('active');
  }

  _renderResult(category, path, startModule) {
    const resultEl = document.getElementById('ob-result');
    if (!resultEl) return;

    const pathLabels = { learner: 'Learner', professional: 'Professional', upskilling: 'Upskilling' };
    const categoryDescs = {
      A: 'You will take a short placement check across Shadowing, Consecutive, Sight Translation, and Simultaneous, then start at the module that matches your demonstrated level.',
      B: `Your foundational modules are marked complete based on your experience. You'll pick up at Module ${startModule} (${startModule === 14 ? 'Simultaneous Interpreting' : 'Consecutive Interpreting'}), with the usual first-lab/final-lab unlock rule from there on.`,
      C: 'Your professional experience is accepted. Complete one calibration session — pass it and every module, mode, and Field/Domain option unlocks immediately.',
    };
    const ctaLabels = { A: 'Take placement check', B: 'Start learning', C: 'Start calibration' };

    resultEl.innerHTML = `
      <div class="ob-eyebrow">Your path is ready</div>
      <div class="ob-question">${pathLabels[path]} Path</div>
      <div class="ob-sub">${categoryDescs[category]}</div>
      <div style="margin-top:24px;display:flex;gap:12px;justify-content:center">
        <button class="ob-btn-next" onclick="window.onboardingController.closeResult()">${ctaLabels[category]}</button>
      </div>`;
  }

  _renderPlacementLegs() {
    const progress = JSON.parse(localStorage.getItem('mad_placement_progress') || '{}');
    const wrap = document.getElementById('ob-placement-legs');
    if (!wrap) return;

    wrap.innerHTML = PLACEMENT_LEGS.map(leg => {
      const done = leg.graded ? typeof progress[leg.mode] === 'number' : progress[leg.mode] === true;
      const sub = done
        ? (leg.graded ? `Done — scored ${Math.round(progress[leg.mode])}/100` : 'Done — completion confirmed')
        : (leg.graded ? 'Real graded session, scored like any other simulation' : 'Ungraded — just confirms exposure');
      return `<div class="ob-opt${done ? ' selected' : ''}" onclick="${done ? '' : `window.onboardingController.startPlacementLeg('${leg.mode}', ${leg.graded})`}">
        <div><div class="ob-opt-text">${leg.label}</div><div class="ob-opt-sub">${sub}</div></div>
        <div class="ob-opt-check"></div>
      </div>`;
    }).join('');
  }

  _maybeFinishPlacement() {
    const progress = JSON.parse(localStorage.getItem('mad_placement_progress') || '{}');
    const gradedLegs = PLACEMENT_LEGS.filter(l => l.graded).map(l => l.mode);
    const shadowingDone = progress.shadowing === true;
    const gradedDone = gradedLegs.every(m => typeof progress[m] === 'number');
    if (!shadowingDone || !gradedDone) return;

    const composite = gradedLegs.reduce((sum, m) => sum + progress[m], 0) / gradedLegs.length;
    let startModule = 1;
    if (composite >= 85) startModule = 19;
    else if (composite >= 70) startModule = 14;
    else if (composite >= 50) startModule = 8;

    const done = JSON.parse(localStorage.getItem('il_modules_done') || '{}');
    for (let n = 1; n < startModule; n++) done[n] = true;
    localStorage.setItem('il_modules_done', JSON.stringify(done));
    localStorage.setItem('mad_placement_result', JSON.stringify({ composite: Math.round(composite), startModule }));
    localStorage.removeItem('mad_placement_pending');

    if (typeof recomputeProgressState === 'function') recomputeProgressState();
    if (typeof showToast === 'function') showToast(`Placement complete! Starting at Module ${startModule}`, 'success');

    this.unlockFirstCompletionAchievement();
  }

  // ── Server persistence ───────────────────────────────────────────────

  async _saveOnboardingServer(payload) {
    try {
      const userId = (typeof getUserId === 'function') ? getUserId() : null;
      const body = JSON.stringify({ ...payload, userId, ts: Date.now() });
      await fetch('/api/progress/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    } catch (e) {
      console.warn('[OnboardingController] server save failed (non-critical):', e);
    }
  }

  // ── Static handlePlacementOrCalibrationResult (called by CI/OPI eval) ─
  /**
   * Call this from ciEndSession / opiEndCall to feed placement/calibration scores.
   * Mirrors the existing _handlePlacementOrCalibrationResult global.
   */
  static handleResult(mode, score) {
    // Calibration (Category C)
    if (mode === 'opi' && localStorage.getItem('mad_active_calibration') === '1') {
      localStorage.removeItem('mad_active_calibration');
      const passed = score >= 80;
      localStorage.setItem('mad_calibration_result', JSON.stringify({ passed, score: Math.round(score) }));
      localStorage.removeItem('mad_calibration_pending');
      if (passed) {
        const done = JSON.parse(localStorage.getItem('il_modules_done') || '{}');
        for (let n = 1; n <= MODULE_TOTAL; n++) done[n] = true;
        localStorage.setItem('il_modules_done', JSON.stringify(done));
      }
      if (typeof recomputeProgressState === 'function') recomputeProgressState();
      return;
    }

    // Placement leg (Category A)
    if (localStorage.getItem('mad_active_placement_leg') === mode) {
      localStorage.removeItem('mad_active_placement_leg');
      const progress = JSON.parse(localStorage.getItem('mad_placement_progress') || '{}');
      progress[mode] = score;
      localStorage.setItem('mad_placement_progress', JSON.stringify(progress));
      // Trigger maybe-finish via singleton if available
      if (window.onboardingController) window.onboardingController._maybeFinishPlacement();
    }
  }
}

// ── Global singleton for inline HTML onclick handlers ──────────────────
// The existing HTML uses onclick="obNext()", obBack(), etc.
// We wire these globals to the singleton so migration is seamless.
let _onboardingSingleton = null;

function _ensureOnboarding() {
  if (!_onboardingSingleton) _onboardingSingleton = new OnboardingController();
  return _onboardingSingleton;
}

// Global compatibility shims (used by existing HTML onclick attributes)
function obSelect(step, val)       { _ensureOnboarding().select(step, val); }
function obSelectMulti(step, val)  { _ensureOnboarding().selectMulti(step, val); }
function obNext()                  { _ensureOnboarding().next(); }
function obBack()                  { _ensureOnboarding().back(); }
function obFinish()                { _ensureOnboarding().finish(); }
function obClose()                 { _ensureOnboarding().closeResult(); }
function obStartPlacementLeg(mode, graded) { _ensureOnboarding().startPlacementLeg(mode, graded); }
function obSkipPlacement()           { _ensureOnboarding().skipPlacement(); }
function obStartCalibration()      { _ensureOnboarding().startCalibration(); }
function obSkipCalibration()       { _ensureOnboarding().skipCalibration(); }
function obRenderPlacementLegs()   { _ensureOnboarding().renderPlacementLegs(); }
function obMaybeFinishPlacement()  { _ensureOnboarding()._maybeFinishPlacement(); }

// Legacy _handlePlacementOrCalibrationResult wiring
function _handlePlacementOrCalibrationResult(mode, score) {
  OnboardingController.handleResult(mode, score);
}

// ── Export / global registration ───────────────────────────────────────
export { OnboardingController };

if (typeof window !== 'undefined') {
  window.OnboardingController = OnboardingController;
  window.onboardingController = _ensureOnboarding();
}
