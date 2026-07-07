/**
 * @module pages/onboarding.js
 * @description Onboarding flow — 5-step questionnaire, placement test, calibration session
 *
 * InterpLing — Interpretation Practice Platform
 * © 2025 InterpLing. All rights reserved.
 */

/**
 * Selects a single-option answer for a given onboarding step.
 *
 * @param {number} step - The zero-based step index in the onboarding flow.
 * @param {string} val - The selected value to store (e.g., 'student', 'pro').
 * @returns {void}
 * @description Stores the answer in OB_ANSWERS, visually deselects all sibling
 *   options within the same step, then finds the option whose inline onclick
 *   attribute matches this exact invocation and highlights it by adding the
 *   'selected' class.
 */
function obSelect(step, val) {
  // Persist the selected value into the global onboarding answers array.
  OB_ANSWERS[step] = val;
  // Clear the 'selected' visual state from every option inside this step's container.
  document.querySelectorAll(`.ob-opts[data-step="${step}"] .ob-opt`).forEach(o => o.classList.remove('selected'));
  // Re-query the DOM for all options belonging to this step (fresh NodeList).
  const opts = document.querySelectorAll(`.ob-opts[data-step="${step}"] .ob-opt`);
  // Iterate options and highlight the one whose onclick attribute exactly matches this call signature.
  opts.forEach(o => { if (o.getAttribute('onclick') === `obSelect(${step},'${val}')`) o.classList.add('selected'); });
}


/**
 * Toggles a multi-select answer for a given onboarding step.
 *
 * @param {number} step - The zero-based step index in the onboarding flow.
 * @param {string} val - The value to toggle (e.g., 'ci', 'si', 'opi').
 * @returns {void}
 * @description Adds the value if it is not already present in the answer array,
 *   or removes it if it already exists. The corresponding DOM option is
 *   highlighted or un-highlighted accordingly by toggling the 'selected' class.
 */
function obSelectMulti(step, val) {
  // Retrieve the current multi-select answer array for this step from global state.
  const arr = OB_ANSWERS[step];
  // Determine whether this value is already selected (-1 means it is not).
  const idx = arr.indexOf(val);
  // Find the specific DOM option element whose inline onclick matches this call.
  const opt = [...document.querySelectorAll(`.ob-opts[data-step="${step}"] .ob-opt`)].find(o => o.getAttribute('onclick') === `obSelectMulti(${step},'${val}')`);
  // If the value is not present, add it and visually select the option.
  if (idx === -1) { arr.push(val); if (opt) opt.classList.add('selected'); }
  // If the value is already present, remove it and visually deselect the option.
  else { arr.splice(idx, 1); if (opt) opt.classList.remove('selected'); }
}


/**
 * Advances the onboarding flow to the next step.
 *
 * @returns {void}
 * @description Increments the global obStep counter, then syncs the DOM by
 *   activating the step panel that matches the new step index and updating the
 *   progress dots so that all dots up to and including the current step are
 *   marked active. If already at the final step (index 4), triggers obFinish
 *   instead of advancing.
 */
function obNext() {
  // If the user is on the last step, finish onboarding rather than advancing further.
  if (obStep >= 4) { obFinish(); return; }
  // Advance the global step tracker by one.
  obStep++;
  // Toggle the 'active' class on each step panel so only the current step is visible.
  document.querySelectorAll('.ob-step').forEach((s, i) => s.classList.toggle('active', i === obStep));
  // Toggle the 'active' class on each progress dot so dots up to the current step are highlighted.
  document.querySelectorAll('.ob-prog-dot').forEach((d, i) => d.classList.toggle('active', i <= obStep));
}


/**
 * Returns the onboarding flow to the previous step.
 *
 * @returns {void}
 * @description Decrements the global obStep counter, then syncs the DOM by
 *   activating the step panel that matches the new step index and updating the
 *   progress dots so that all dots up to and including the current step are
 *   marked active. Does nothing if already on the first step (index 0).
 */
function obBack() {
  // Guard clause: do not allow stepping back past the first step.
  if (obStep <= 0) return;
  // Decrement the global step tracker by one.
  obStep--;
  // Toggle the 'active' class on each step panel so only the current step is visible.
  document.querySelectorAll('.ob-step').forEach((s, i) => s.classList.toggle('active', i === obStep));
  // Toggle the 'active' class on each progress dot so dots up to the current step are highlighted.
  document.querySelectorAll('.ob-prog-dot').forEach((d, i) => d.classList.toggle('active', i <= obStep));
}


/**
 * Finalizes the onboarding questionnaire, computes the user's path, and displays
 * the result screen.
 *
 * @returns {void}
 * @description Reads the answers from Steps 1-3, categorizes the user into A, B,
 *   or C, determines the starting module for Category B, persists path and
 *   progress data to localStorage, and renders the result card with a call-to-
 *   action button. For Category A, marks a placement test as pending; for
 *   Category C, marks a calibration session as pending.
 */
function obFinish() {
  // Step 1 (purpose) + Step 2 (experience) determine the A/B/C category;
  // Step 3 (modes practiced before) decides where Category B starts.
  // See PROGRESS_SYSTEM_PLAN.md §4 / §9.4 for the source rules.
  // Extract the user's stated purpose from the first onboarding answer.
  const purpose = OB_ANSWERS[0]; // student|pro|upskill|eval
  // Extract the user's stated experience level from the second onboarding answer.
  const xp = OB_ANSWERS[1];      // none|training|mid|senior
  // Extract the multi-select modes they've practiced before; default to an empty array if undefined.
  const modes = OB_ANSWERS[2] || []; // multi-select: opi|ci|si|none

  // Default category is 'A' (learner / placement test path).
  let category = 'A';
  // Category C: professional interpreter with senior experience — bypasses placement.
  if (purpose === 'pro' && xp === 'senior') category = 'C';
  // Category B: mid-level professional, or upskiller with mid-level or training experience.
  else if ((purpose === 'pro' && xp === 'mid') || (purpose === 'upskill' && (xp === 'mid' || xp === 'training'))) category = 'B';

  // Category B's starting module varies by which modes they've practiced before.
  // SI experience -> start at Phase 3; CI or OPI experience -> start at Phase 2;
  // "none of the above" has no real placement signal, so fall back to Category A's
  // placement test instead.
  let startModule = 1;
  // Only compute a starting module override for Category B users.
  if (category === 'B') {
    // If they have Simultaneous Interpreting experience, place them at Module 14 (Phase 3).
    if (modes.includes('si')) startModule = 14;
    // If they have Consecutive or OPI experience, place them at Module 8 (Phase 2).
    else if (modes.includes('ci') || modes.includes('opi')) startModule = 8;
    // If they have no relevant prior experience, downgrade them to Category A for safety.
    else category = 'A';
  }

  // Determine the path label that the rest of the application uses.
  let path = 'learner';
  // Category C maps to the 'professional' path.
  if (category === 'C') path = 'professional';
  // Category B maps to the 'upskilling' path.
  else if (category === 'B') path = 'upskilling';

  // Persist the computed path into localStorage for downstream logic to reference.
  localStorage.setItem('il_path', path);
  // Mark the user as having completed onboarding so the overlay does not reappear.
  localStorage.setItem('il_onboarded', '1');
  // Persist the raw onboarding answers for analytics or potential re-evaluation.
  localStorage.setItem('il_ob_answers', JSON.stringify(OB_ANSWERS));
  // Store the computed category so other functions (e.g., obClose) can branch on it.
  localStorage.setItem('mad_onboarding_category', category);

  // Pre-seed completed-module state per category so the existing cascade-unlock
  // logic (recomputeProgressState / openModule) picks up from the right point.
  // Category B skips up to its placed start module immediately. Category A and C
  // do NOT pre-mark anything done here — A waits for the placement test composite,
  // C waits for the calibration session to actually pass (self-attestation grants
  // full Practice access via the 'professional' path rules, but Simulation tiers
  // and Field/Domain unlocks stay gated on real `done` state until earned).
  // Load any existing module completion state; default to an empty object if none exists.
  const done = JSON.parse(localStorage.getItem('il_modules_done') || '{}');
  // For Category B, pre-mark all modules before the startModule as completed.
  if (category === 'B') {
    for (let n = 1; n < startModule; n++) done[n] = true;
  }
  // Persist the (potentially updated) completion state back to localStorage.
  localStorage.setItem('il_modules_done', JSON.stringify(done));

  // For Category A, flag that a placement test is pending and initialize empty progress.
  if (category === 'A') {
    localStorage.setItem('mad_placement_pending', '1');
    localStorage.setItem('mad_placement_progress', '{}');
  }
  // For Category C, flag that a calibration session is pending.
  else if (category === 'C') {
    localStorage.setItem('mad_calibration_pending', '1');
  }
  // Recompute derived unlock states (modes, fields) now that base state has changed.
  recomputeProgressState();

  // Grab the result container DOM element where the final message will be injected.
  const resultEl = document.getElementById('ob-result');
  // Map internal path keys to human-readable labels for display.
  const pathLabels = { learner: 'Learner', professional: 'Professional', upskilling: 'Upskilling' };
  // Map each category to its descriptive explanation text for the result card.
  const categoryDescs = {
    A: 'You will take a short placement check across Shadowing, Consecutive, Sight Translation, and Simultaneous, then start at the module that matches your demonstrated level.',
    B: `Your foundational modules are marked complete based on your experience. You'll pick up at Module ${startModule} (${startModule === 14 ? 'Simultaneous Interpreting' : 'Consecutive Interpreting'}), with the usual first-lab/final-lab unlock rule from there on.`,
    C: 'Your professional experience is accepted. Complete one calibration session — pass it and every module, mode, and Field/Domain option unlocks immediately.'
  };
  // Map each category to its call-to-action button label.
  const ctaLabels = { A: 'Take placement check', B: 'Start learning', C: 'Start calibration' };
  // Inject the fully assembled result card HTML into the DOM.
  resultEl.innerHTML = `
   <div class="ob-eyebrow">Your path is ready</div>
   <div class="ob-question">${pathLabels[path]} Path</div>
   <div class="ob-sub">${categoryDescs[category]}</div>
   <div style="margin-top:24px;display:flex;gap:12px;justify-content:center">
    <button class="ob-btn-next" onclick="obClose()">${ctaLabels[category]}</button>
   </div>`;
  // Hide all onboarding step panels so only the result card is visible.
  document.querySelectorAll('.ob-step').forEach(s => s.classList.remove('active'));
  // Reveal the result card by adding the 'active' class.
  resultEl.classList.add('active');
}


/**
 * Closes the onboarding overlay and routes the user to their next destination.
 *
 * @returns {void}
 * @description Checks whether the user still has a pending placement test
 *   (Category A) or calibration session (Category C). If so, renders the
 *   appropriate test UI inside the overlay instead of closing it. Otherwise,
 *   hides the overlay and navigates to the 'learn' page.
 */
function obClose() {
  // Retrieve the computed onboarding category from localStorage to decide routing.
  const category = localStorage.getItem('mad_onboarding_category');
  // Category A with a pending placement test: render the placement legs UI.
  if (category === 'A' && localStorage.getItem('mad_placement_pending') === '1') {
    obRenderPlacementLegs();
    // Hide all step panels before showing the placement test container.
    document.querySelectorAll('.ob-step').forEach(s => s.classList.remove('active'));
    // Display the placement test section.
    document.getElementById('ob-placement').classList.add('active');
    return;
  }
  // Category C with a pending calibration session: show the calibration UI.
  if (category === 'C' && localStorage.getItem('mad_calibration_pending') === '1') {
    document.querySelectorAll('.ob-step').forEach(s => s.classList.remove('active'));
    // Display the calibration session section.
    document.getElementById('ob-calibration').classList.add('active');
    return;
  }
  // No pending tests: hide the onboarding overlay completely.
  const ov = document.getElementById('ob-overlay');
  if (ov) ov.style.display = 'none';
  // Navigate the user to the main learning page.
  goPage('learn');
}

// ── Placement test (Category A) ────────────────────────────────────
// Shadowing has no AI-rubric simulation (it's always-on, ungraded), so its leg
// is a completion checkbox; the other 3 legs are real graded sessions that reuse
// the existing CI engine (showCISim) and feed their overall_score into the
// composite via _handlePlacementOrCalibrationResult, hooked from ciEndSession.

/**
 * Configuration array defining each leg of the Category A placement test.
 *
 * @constant {Array<Object>}
 * @description Each object specifies an interpretation mode, a human-readable
 *   label, and whether the leg is graded (requires a scored session) or merely
 *   a completion confirmation. This array drives the UI rendered by
 *   obRenderPlacementLegs and the composite scoring logic in
 *   obMaybeFinishPlacement.
 */
const PLACEMENT_LEGS = [
  { mode: 'shadowing',    label: 'Shadowing clip',       graded: false },
  { mode: 'consecutive',  label: 'Consecutive segment',  graded: true  },
  { mode: 'sight',        label: 'Sight Translation passage', graded: true },
  { mode: 'simultaneous', label: 'Simultaneous clip',    graded: true  },
];


/**
 * Renders the placement-test legs UI inside the onboarding overlay.
 *
 * @returns {void}
 * @description Reads the current placement progress from localStorage and
 *   generates a clickable list of legs. Completed legs show their status;
 *   incomplete graded legs launch a real session when clicked, while
 *   incomplete ungraded legs confirm completion immediately.
 */
function obRenderPlacementLegs() {
  // Load the user's current placement progress object from localStorage.
  const progress = JSON.parse(localStorage.getItem('mad_placement_progress') || '{}');
  // Grab the DOM container where the leg list will be injected.
  const wrap = document.getElementById('ob-placement-legs');
  // Guard: if the container is missing, abort to avoid errors.
  if (!wrap) return;
  // Build the HTML for each leg by mapping over the PLACEMENT_LEGS constant.
  wrap.innerHTML = PLACEMENT_LEGS.map(leg => {
    // Determine whether this leg is considered done based on its graded flag and progress type.
    const done = leg.graded ? typeof progress[leg.mode] === 'number' : progress[leg.mode] === true;
    // Choose the subtitle text: scored result for graded, confirmation for ungraded.
    const sub = done
      ? (leg.graded ? `Done — scored ${Math.round(progress[leg.mode])}/100` : 'Done — completion confirmed')
      : (leg.graded ? 'Real graded session, scored like any other simulation' : 'Ungraded — just confirms exposure');
    // Return the HTML for this leg row, conditionally attaching an onclick handler if not yet done.
    return `<div class="ob-opt${done ? ' selected' : ''}" onclick="${done ? '' : `obStartPlacementLeg('${leg.mode}', ${leg.graded})`}">
      <div><div class="ob-opt-text">${leg.label}</div><div class="ob-opt-sub">${sub}</div></div>
      <div class="ob-opt-check"></div>
    </div>`;
  }).join('');
}


/**
 * Starts or completes a single placement-test leg.
 *
 * @param {string} mode - The interpretation mode for this leg (e.g., 'consecutive').
 * @param {boolean} graded - True if this leg requires a scored session; false if it is a simple completion checkbox.
 * @returns {void}
 * @description For ungraded legs, immediately marks the leg complete in
 *   localStorage and refreshes the UI. For graded legs, stores the active leg
 *   key, hides the overlay, navigates to the Practice page, and invokes
 *   enterPractice for the selected mode.
 */
function obStartPlacementLeg(mode, graded) {
  // Branch based on whether this leg requires a graded simulation or just a checkbox.
  if (!graded) {
    // Load the existing placement progress from localStorage.
    const progress = JSON.parse(localStorage.getItem('mad_placement_progress') || '{}');
    // Mark this ungraded leg as completed with a boolean true.
    progress[mode] = true;
    // Persist the updated progress back to localStorage.
    localStorage.setItem('mad_placement_progress', JSON.stringify(progress));
    // Check whether all legs are now finished so we can compute the final placement.
    obMaybeFinishPlacement();
    // Refresh the legs UI to reflect the newly completed state.
    obRenderPlacementLegs();
    return;
  }
  // For graded legs, record which mode is currently active so the result hook knows where to store the score.
  localStorage.setItem('mad_active_placement_leg', mode);
  // Hide the onboarding overlay so the user can focus on the practice session.
  const ov = document.getElementById('ob-overlay');
  if (ov) ov.style.display = 'none';
  // Navigate to the Practice page where the graded session will run.
  goPage('practice');
  // Invoke the global practice entry function if it is available in scope.
  if (typeof enterPractice === 'function') enterPractice(mode);
}


/**
 * Abandons the placement test and proceeds to the learn page.
 *
 * @returns {void}
 * @description Removes all placement-related localStorage keys, hides the
 *   onboarding overlay, and routes the user directly to the 'learn' page.
 *   The user will remain on Category A but without a placement result, so
 *   they will start from Module 1.
 */
function obSkipPlacement() {
  // Remove the pending flag so the app no longer treats placement as incomplete.
  localStorage.removeItem('mad_placement_pending');
  // Remove any partial progress accumulated so far.
  localStorage.removeItem('mad_placement_progress');
  // Hide the onboarding overlay.
  const ov = document.getElementById('ob-overlay');
  if (ov) ov.style.display = 'none';
  // Route the user to the main learning page.
  goPage('learn');
}


/**
 * Checks whether all placement-test legs are finished and, if so, computes
 * the user's starting module from the composite score.
 *
 * @returns {void}
 * @description Reads progress for each leg from localStorage. Once the
 *   shadowing checkbox is confirmed and all graded legs have numeric scores,
 *   calculates the average of the graded scores. Based on the composite,
 *   pre-marks modules as completed so the user starts at the appropriate
 *   Phase (Module 8, 14, or 19) and cleans up placement flags.
 */
function obMaybeFinishPlacement() {
  // Load the current placement progress object from localStorage.
  const progress = JSON.parse(localStorage.getItem('mad_placement_progress') || '{}');
  // Extract the list of graded leg mode names for iteration and scoring.
  const gradedLegs = PLACEMENT_LEGS.filter(l => l.graded).map(l => l.mode);
  // Confirm whether the ungraded shadowing checkbox is marked complete.
  const shadowingDone = progress.shadowing === true;
  // Verify that every graded leg has a numeric score recorded.
  const gradedDone = gradedLegs.every(m => typeof progress[m] === 'number');
  // If any leg is still incomplete, exit early without computing a result.
  if (!shadowingDone || !gradedDone) return;

  // Compute the arithmetic mean of all graded leg scores.
  const composite = gradedLegs.reduce((sum, m) => sum + progress[m], 0) / gradedLegs.length;
  // Score bands per PROGRESS_SYSTEM_PLAN.md §4: <50% -> module 1, 50-70% -> Phase 2,
  // 70-85% -> Phase 3, 85%+ -> Phase 4.
  let startModule = 1;
  // 85% or higher composite places the user at Module 19 (Phase 4).
  if (composite >= 85) startModule = 19;
  // 70-84% places the user at Module 14 (Phase 3).
  else if (composite >= 70) startModule = 14;
  // 50-69% places the user at Module 8 (Phase 2).
  else if (composite >= 50) startModule = 8;

  // Load existing module completion state to pre-mark skipped modules.
  const done = JSON.parse(localStorage.getItem('il_modules_done') || '{}');
  // Mark every module below the starting module as completed.
  for (let n = 1; n < startModule; n++) done[n] = true;
  // Persist the updated completion state.
  localStorage.setItem('il_modules_done', JSON.stringify(done));
  // Persist the placement result (composite score and starting module) for display or analytics.
  localStorage.setItem('mad_placement_result', JSON.stringify({ composite: Math.round(composite), startModule }));
  // Remove the pending flag since placement is now resolved.
  localStorage.removeItem('mad_placement_pending');
  // Recompute derived unlock states now that the module completion baseline has changed.
  recomputeProgressState();
}

// ── Calibration session (Category C) ───────────────────────────────

/**
 * Launches the calibration session for a Category C (professional) user.
 *
 * @returns {void}
 * @description Sets a flag in localStorage to indicate an active calibration,
 *   hides the onboarding overlay, navigates to the Practice page, and starts
 *   an OPI (Over-the-Phone Interpretation) session. The result is handled by
 *   _handlePlacementOrCalibrationResult.
 */
function obStartCalibration() {
  // Set the active calibration flag so the result hook knows to process the score.
  localStorage.setItem('mad_active_calibration', '1');
  // Hide the onboarding overlay so the user can focus on the practice session.
  const ov = document.getElementById('ob-overlay');
  if (ov) ov.style.display = 'none';
  // Navigate to the Practice page where the calibration session will run.
  goPage('practice');
  // Invoke the global practice entry function for OPI mode if it is available.
  if (typeof enterPractice === 'function') enterPractice('opi');
}


/**
 * Skips the calibration session for a Category C user.
 *
 * @returns {void}
 * @description Removes the calibration pending flag from localStorage, hides
 *   the onboarding overlay, and routes the user to the 'learn' page. The user
 *   remains on the 'professional' path but without the full unlock that a
 *   passed calibration would have granted.
 */
function obSkipCalibration() {
  // Remove the calibration pending flag so the app no longer waits for it.
  localStorage.removeItem('mad_calibration_pending');
  // Hide the onboarding overlay.
  const ov = document.getElementById('ob-overlay');
  if (ov) ov.style.display = 'none';
  // Route the user to the main learning page.
  goPage('learn');
}

// Called from ciEndSession (d.mode) and opiEndCall (mode 'opi') right after each
// session's overall_score comes back, so placement/calibration use the exact
// same AI-rubric pipeline as every other graded session — no separate scoring path.

/**
 * Receives a graded session result and routes it to the correct handler
 * (placement leg or calibration).
 *
 * @param {string} mode - The interpretation mode that just finished (e.g., 'consecutive', 'opi').
 * @param {number} score - The overall_score returned by the AI rubric (0-100).
 * @returns {void}
 * @description This function acts as a central dispatcher. If a calibration
 *   session is active and the mode is 'opi', it evaluates the pass threshold
 *   (≥80) and either unlocks all modules or records a failure. If an active
 *   placement leg matches the mode, it stores the score in placement progress
 *   and checks whether the full placement test is now complete.
 */
function _handlePlacementOrCalibrationResult(mode, score) {
  // Branch 1: Calibration session (Category C) — only triggered for OPI mode while the calibration flag is set.
  if (mode === 'opi' && localStorage.getItem('mad_active_calibration') === '1') {
    // Clear the active calibration flag immediately so this block does not re-fire.
    localStorage.removeItem('mad_active_calibration');
    // A score of 80 or higher is considered a passing calibration.
    const passed = score >= 80;
    // Persist the calibration result (pass/fail and rounded score) for display or analytics.
    localStorage.setItem('mad_calibration_result', JSON.stringify({ passed, score: Math.round(score) }));
    // Remove the pending flag since calibration has been resolved.
    localStorage.removeItem('mad_calibration_pending');
    // If the user passed, unlock every module in the curriculum immediately.
    if (passed) {
      const done = JSON.parse(localStorage.getItem('il_modules_done') || '{}');
      for (let n = 1; n <= MODULE_TOTAL; n++) done[n] = true;
      localStorage.setItem('il_modules_done', JSON.stringify(done));
    }
    // Recompute derived unlock states now that module completion has changed.
    recomputeProgressState();
    return;
  }
  // Branch 2: Active placement leg — stores the graded score and checks for completion.
  if (localStorage.getItem('mad_active_placement_leg') === mode) {
    // Clear the active placement leg flag so this block does not re-fire for the same leg.
    localStorage.removeItem('mad_active_placement_leg');
    // Load the existing placement progress object from localStorage.
    const progress = JSON.parse(localStorage.getItem('mad_placement_progress') || '{}');
    // Record the numeric score for this specific mode.
    progress[mode] = score;
    // Persist the updated progress.
    localStorage.setItem('mad_placement_progress', JSON.stringify(progress));
    // Check whether all placement legs are now complete and, if so, compute the final placement.
    obMaybeFinishPlacement();
  }
}


/**
 * Initializes the user's path on app load by checking onboarding status.
 *
 * @returns {void}
 * @description Reads the 'il_onboarded' flag from localStorage. If the user
 *   has not yet completed onboarding, displays the onboarding overlay by
 *   setting its display to 'flex'. Otherwise, does nothing and lets the
 *   application continue to its normal landing state.
 */
function initUserPath() {
  // Check whether the user has already completed the onboarding questionnaire.
  const onboarded = localStorage.getItem('il_onboarded');
  // If not onboarded, reveal the onboarding overlay so the flow can begin.
  if (!onboarded) {
    const ov = document.getElementById('ob-overlay');
    if (ov) ov.style.display = 'flex';
  }
}

// ── Learn page ────────────────────────────────────────────────────
/**
 * Total number of modules in the InterpLing curriculum.
 *
 * @constant {number}
 * @description Used as the upper bound for loops and pre-seeding operations
 *   that touch every module (e.g., Category C calibration unlock).
 */
const MODULE_TOTAL = 29;

/**
 * Base unlock rules for each learner path, defining which modules are
 * initially accessible before any progress is applied.
 *
 * @constant {Object<Object<boolean>>}
 * @description
 *   - learner: Only Module 1 is unlocked initially; subsequent modules unlock
 *     via the cascade rule (previous module completed).
 *   - professional: All modules are unlocked from the start (professional path).
 *   - upskilling: Modules 1 through 5 are unlocked initially; the rest follow
 *     the cascade rule.
 */
const MODULE_UNLOCK_RULES = {
  learner:       Array.from({length:MODULE_TOTAL},(_,i)=>i+1).reduce((a, n) => { a[n] = n === 1; return a; }, {}),
  professional:  Object.fromEntries(Array.from({length:MODULE_TOTAL},(_,i)=>[i+1,true])),
  upskilling:    Array.from({length:MODULE_TOTAL},(_,i)=>i+1).reduce((a, n) => { a[n] = n <= 5; return a; }, {}),
};

// ── Mode + Field/Domain unlock mapping ─────────────────────────────
// "assignModule" = the module is unlocked/started (rules[n] true — first lab assigned).
// "passModule"   = the module is completed (done[n] true — final lab passed).
// Shadowing has no module gate — it's always on from the moment Phase 1 starts.

/**
 * Maps each interpretation mode to the module gates that unlock Practice and
 * Simulation access.
 *
 * @constant {Object<Object>}
 * @description For each mode:
 *   - practice: either {always: true} (no gate) or {assignModule: N} (unlocked
 *     when module N is assigned / rules[N] is true).
 *   - sim: either null (no simulation available) or {passModule: N} (unlocked
 *     when module N is completed / done[N] is true).
 */
const MODE_UNLOCK_MAP = {
  shadowing:    { practice: { always: true },      sim: null               },
  sight:        { practice: { assignModule: 16 },   sim: { passModule: 16 } },
  chuchotage:   { practice: { assignModule: 15 },   sim: { passModule: 15 } },
  consecutive:  { practice: { assignModule: 7  },   sim: { passModule: 9  } },
  escort:       { practice: { assignModule: 10 },   sim: { passModule: 10 } },
  simultaneous: { practice: { assignModule: 14 },   sim: { passModule: 17 } },
  opi:          { practice: { assignModule: 19 },   sim: { passModule: 21 } },
};

/**
 * Maps each specialized field to the module that must be completed before
 * the field becomes available in search / simulation parameters.
 *
 * @constant {Object<number>}
 * @description The numeric value is the module ID that, when marked done,
 *   unlocks the corresponding field option in UI dropdowns.
 */
const FIELD_UNLOCK_MAP = {
  medical:     11,
  legal:       14,
  diplomatic:  21,
  immigration: 15,
  business:    19,
  academic:    24,
  community:   15,
  security:    27,
  media:       28,
};

// Recomputes mad_mode_progress / mad_field_unlocks from the single source of
// truth (il_modules_done + the active path's MODULE_UNLOCK_RULES cascade) and
// persists them so Practice cards, Search Parameters / Simulation setup
// dropdowns, and the My Progress tab can all read the same derived state.

/**
 * Recomputes derived unlock state for modes and fields from the single source
 * of truth in localStorage.
 *
 * @returns {{modeProgress: Object, fieldUnlocks: Object}}
 *   An object containing the computed mode unlock states and field unlock states.
 * @description Reads the user's active path and completed modules from
 *   localStorage. Applies the cascade unlock rule for the 'learner' path,
 *   then evaluates each mode's practice and simulation gates against the
 *   module rules and completion state. Also evaluates each field's gate.
 *   Persists the derived structures (mad_mode_progress, mad_field_unlocks)
 *   back to localStorage so that UI components can read them without
 *   re-running the computation.
 */
function recomputeProgressState() {
  // Retrieve the active path ('learner', 'professional', or 'upskilling'); default to 'learner' if unset.
  const path = localStorage.getItem('il_path') || 'learner';
  // Load the set of completed modules from localStorage; default to an empty object.
  const done = JSON.parse(localStorage.getItem('il_modules_done') || '{}');
  // Deep-clone the base unlock rules for the active path to avoid mutating the constant.
  const rules = JSON.parse(JSON.stringify(MODULE_UNLOCK_RULES[path] || MODULE_UNLOCK_RULES['learner']));
  // For the learner path only, apply the cascade rule: completing module N-1 unlocks module N.
  if (path === 'learner') {
    for (let n = 2; n <= MODULE_TOTAL; n++) { if (done[n-1]) rules[n] = true; }
  }

  // Initialize the object that will hold each mode's practice/sim unlock status.
  const modeProgress = {};
  // Iterate over every mode defined in MODE_UNLOCK_MAP.
  for (const [mode, rule] of Object.entries(MODE_UNLOCK_MAP)) {
    // Practice is unlocked if the rule says "always" OR if the gating module is unlocked in rules.
    const practiceUnlocked = !!(rule.practice.always || rules[rule.practice.assignModule]);
    // Simulation is unlocked only if a sim rule exists AND the passModule is marked done.
    const simUnlocked = rule.sim ? !!done[rule.sim.passModule] : false;
    // Store the computed flags plus the gating module IDs for reference or debugging.
    modeProgress[mode] = {
      practiceUnlocked,
      simUnlocked,
      moduleId: rule.practice.assignModule || null,
      simModuleId: rule.sim ? rule.sim.passModule : null,
    };
  }

  // Initialize the object that will hold each field's unlock status.
  const fieldUnlocks = {};
  // Iterate over every field defined in FIELD_UNLOCK_MAP.
  for (const [field, moduleId] of Object.entries(FIELD_UNLOCK_MAP)) {
    // The field is unlocked if its gating module ID exists in the done object.
    fieldUnlocks[field] = !!done[moduleId];
  }

  // Persist the computed mode progress so Practice cards and dropdowns can read it directly.
  localStorage.setItem('mad_mode_progress', JSON.stringify(modeProgress));
  // Persist the computed field unlocks so search / simulation parameter UIs can read them directly.
  localStorage.setItem('mad_field_unlocks', JSON.stringify(fieldUnlocks));
  // Return the derived structures in case the caller needs them immediately.
  return { modeProgress, fieldUnlocks };
}
