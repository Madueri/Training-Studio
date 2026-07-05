/**
 * @module modes/shared-params.js
 * @description Shared parameter handling — language pairs, dialects, fields, difficulty, duration
 *
 * MAD Training Studio — Interpretation Practice Platform
 * © 2025 InterpretLab. All rights reserved.
 */

/**
 * @description Populates the dialect <select> element(s) based on the currently chosen language(s).
 *   In shadowing mode, a single language+dialect is used. In interpretation modes, separate
 *   source- and target-language dialects are populated from the global DIALECTS lookup table.
 * @returns {void}
 */
function updateDialects() {
 // Branch based on the active practice mode to determine which dialect UI to refresh
 if (currentMode === 'shadowing') {
  // Retrieve the currently selected shadowing language, falling back to 'English' if absent
  const lang = document.getElementById('shadow-lang')?.value || 'English';
  // Grab the dialect <select> for shadowing
  const sel = document.getElementById('shadow-dialect');
  // Only repopulate if the element exists in the DOM
  if (sel) {
   // Look up the dialect list for this language; default to a single "Default" entry
   const options = DIALECTS[lang] || [['Default', lang]];
   // Build <option> elements from each [value, label] pair and inject them into the select
   sel.innerHTML = options.map(([v,l]) => `<option value="${v}">${l}</option>`).join('');
  }
 } else {
  // In interpretation modes, read both the source and target language values
  const srcLang = document.getElementById('lang-source')?.value || 'English';
  const tgtLang = document.getElementById('lang-target')?.value || 'Arabic';
  // Get references to the source and target dialect dropdowns
  const srcSel = document.getElementById('lang-source-dialect');
  const tgtSel = document.getElementById('lang-target-dialect');
  // Populate the source-language dialect dropdown if present
  if (srcSel) {
   // Resolve dialect options for the source language, defaulting to the language name itself
   const opts = DIALECTS[srcLang] || [['Default', srcLang]];
   // Render options as HTML and replace the current list
   srcSel.innerHTML = opts.map(([v,l]) => `<option value="${v}">${l}</option>`).join('');
  }
  // Populate the target-language dialect dropdown if present
  if (tgtSel) {
   // Resolve dialect options for the target language, defaulting to the language name itself
   const opts = DIALECTS[tgtLang] || [['Default', tgtLang]];
   // Render options as HTML and replace the current list
   tgtSel.innerHTML = opts.map(([v,l]) => `<option value="${v}">${l}</option>`).join('');
  }
 }
 // After dialects are refreshed, update the language-direction display string
 syncLangDir();
}


/**
 * @description Swaps the source and target languages (and their dialects) in the UI.
 *   Captures current dialect values before the swap so they can be restored afterward
 *   if the new language supports the same dialect code. Triggers a visual pulse on
 *   the swap arrow that was clicked.
 * @returns {void}
 */
function swapLanguages() {
 // Acquire references to the source and target language <select> elements
 const src = document.getElementById('lang-source');
 const tgt = document.getElementById('lang-target');
 // Acquire references to the source and target dialect <select> elements
 const srcD = document.getElementById('lang-source-dialect');
 const tgtD = document.getElementById('lang-target-dialect');
 // capture the chosen dialect *values* before the language swap rebuilds
 // each <select>'s option list (updateDialects() repopulates them based
 // on the new language, wiping out the old selection).
 const srcDialectVal = srcD ? srcD.value : '';
 const tgtDialectVal = tgtD ? tgtD.value : '';
 // Swap the actual language values between source and target in-place
 const tmp = src.value; src.value = tgt.value; tgt.value = tmp;
 // Refresh dialect dropdowns now that languages have been swapped
 updateDialects();
 // Attempt to restore the target's old dialect into the source dialect dropdown
 if (srcD && tgtDialectVal && [...srcD.options].some(o => o.value === tgtDialectVal)) srcD.value = tgtDialectVal;
 // Attempt to restore the source's old dialect into the target dialect dropdown
 if (tgtD && srcDialectVal && [...tgtD.options].some(o => o.value === srcDialectVal)) tgtD.value = srcDialectVal;
 // Update the direction label to reflect the new source/target arrangement
 syncLangDir();
 // brief pulse on whichever arrow was clicked, to confirm the swap fired
 // Identify the arrow button element that initiated this swap from the global event
 const arrow = event?.target?.closest?.('#interp-dir-fwd,#interp-dir-bwd');
 // Apply a temporary scale transform for visual feedback, then clear it after 200 ms
 if (arrow) { arrow.style.transform = 'scale(1.3)'; setTimeout(() => arrow.style.transform = '', 200); }
}


/**
 * @description Synchronizes the visible language-direction string and the enabled
 *   state of the forward/backward arrows. In shadowing mode, the direction shows
 *   the same language on both sides. In one-way mode, the backward arrow is dimmed
 *   and disabled.
 * @returns {void}
 */
function syncLangDir() {
 // Locate the hidden input that stores the human-readable direction string
 const el = document.getElementById('interp-dir');
 // If the input does not exist, there is nothing to synchronize
 if (!el) return;
 // Branch based on mode: shadowing uses a single language, interpretation uses a pair
 if (currentMode === 'shadowing') {
  // Read the chosen shadowing language and dialect, using safe fallbacks
  const lang = document.getElementById('shadow-lang')?.value || 'English';
  const dialect = document.getElementById('shadow-dialect')?.value || 'US';
  // Set the direction to the same language on both sides (e.g. "English (US) → English (US)")
  el.value = `${lang} (${dialect}) → ${lang} (${dialect})`;
 } else {
  // Read source and target languages with fallback defaults
  const src = document.getElementById('lang-source')?.value || 'English';
  const tgt = document.getElementById('lang-target')?.value || 'Arabic';
  // Read the selected dialect codes, if any, for both sides
  const srcD = document.getElementById('lang-source-dialect')?.value || '';
  const tgtD = document.getElementById('lang-target-dialect')?.value || '';
  // Build the direction string, conditionally appending dialects in parentheses
  el.value = `${src}${srcD ? ' ('+srcD+')' : ''} → ${tgt}${tgtD ? ' ('+tgtD+')' : ''}`;
 }
 // Both arrows are clickable (swap source/target). When One-way is on,
 // there's no "backward" leg of practice, so the ← arrow greys out and
 // stops being clickable — only the forward arrow remains live.
 // Fetch references to the forward and backward arrow UI elements
 const fwd = document.getElementById('interp-dir-fwd');
 const bwd = document.getElementById('interp-dir-bwd');
 // Apply opacity, pointer-events, and cursor styles based on the one-way toggle
 if (fwd && bwd) {
  // Forward arrow is always fully active
  fwd.style.opacity = '1';
  // Backward arrow is dimmed when one-way mode is enabled
  bwd.style.opacity = interpOneWay ? '0.25' : '1';
  // Disable pointer events on the backward arrow in one-way mode
  bwd.style.pointerEvents = interpOneWay ? 'none' : 'auto';
  // Use default cursor when disabled, pointer cursor when enabled
  bwd.style.cursor = interpOneWay ? 'default' : 'pointer';
 }
}


/**
 * @description Toggles one-way interpretation mode and re-syncs the direction UI.
 * @param {boolean} checked - True to enable one-way mode; false for two-way.
 * @returns {void}
 */
function interpToggleOneWay(checked) {
 // Store the new one-way state in the module-level flag
 interpOneWay = checked;
 // Refresh the direction label and arrow styles to match the new state
 syncLangDir();
}

// Mapping from numeric pace slider values (1-4) to human-readable descriptions
const INTERP_PACE_INFO = {1:'Deliberate — ~80 WPM', 2:'Moderate — ~110 WPM', 3:'Fast — ~140 WPM', 4:'Rapid — ~170 WPM'};
// Mapping from numeric pace slider values to internal string tokens used by the backend
const INTERP_PACE_VALUE = {1:'slow', 2:'moderate', 3:'fast', 4:'expert'};

/**
 * @description Updates the current pacing token and the visible pace label based
 *   on the slider value selected by the user.
 * @param {number} v - The numeric pace value from the slider (1-4).
 * @returns {void}
 */
function interpUpdatePace(v) {
 // Translate the numeric slider value to an internal pace token, defaulting to 'slow'
 currentPace = INTERP_PACE_VALUE[v] || 'slow';
 // Get a reference to the label element that displays the current pace description
 const lbl = document.getElementById('interp-pace-lbl');
 // Update the label text if the element exists; fall back to the first entry if unknown
 if (lbl) lbl.textContent = INTERP_PACE_INFO[v] || INTERP_PACE_INFO[1];
}

// ── Search Parameters card: field sub-type + speaker count (reuses CI's
// field taxonomy/data — same domains as CI/OPI, just a different surface) ──

// Holds the currently selected field sub-type (e.g., "Medical — Cardiology")
let interpFieldType = '';
// Holds the expected number of speakers in the source material (default 2 for interpretation)
let interpSpeakers = 2;
// Flag indicating whether one-way interpretation mode is active
let interpOneWay = false;


/**
 * @description Initializes parameter controls for the current mode: sets the field
 *   sub-type, defaults speaker count to 1 for shadowing or 2 for interpretation,
 *   and updates the speaker note text accordingly.
 * @returns {void}
 */
function interpInitParams() {
 // Grab the field specialization dropdown
 const fieldSel = document.getElementById('interp-spec');
 // If present, trigger field-changed logic to populate sub-types
 if (fieldSel) interpFieldChanged(fieldSel.value);
 // Shadowing mode uses a single speaker; interpretation expects two by default
 interpSpeakers = currentMode === 'shadowing' ? 1 : 2;
 // Locate the DOM element that displays the speaker count
 const numEl = document.getElementById('interp-spk-num');
 // Reflect the default speaker count in the UI
 if (numEl) numEl.textContent = interpSpeakers;
 // Locate the note element that explains the speaker count
 const note = document.getElementById('interp-spk-note');
 // Update the note text based on the current mode
 if (note) note.textContent = currentMode === 'shadowing'
  ? 'single-speaker monologue expected'
  : 'speakers expected in the source video';
}


/**
 * @description Rebuilds the field sub-type dropdown whenever the top-level field changes.
 *   Reads option lists from the global CI_FIELD_TYPES lookup.
 * @param {string} fieldId - The selected top-level field identifier.
 * @returns {void}
 */
function interpFieldChanged(fieldId) {
 // Get the sub-type <select> element for field specialization
 const typeSel = document.getElementById('interp-spec-type');
 // Abort if the element is not present in the DOM
 if (!typeSel) return;
 // Safely look up sub-types for this field in the global CI_FIELD_TYPES object
 const types = (typeof CI_FIELD_TYPES !== 'undefined' && CI_FIELD_TYPES[fieldId]) || [];
 // Render each sub-type as an <option> and replace the current list
 typeSel.innerHTML = types.map(t => `<option>${t}</option>`).join('');
 // Trigger downstream logic with the first sub-type (or empty string if none)
 interpTypeChanged(types[0] || '');
}


/**
 * @description Stores the currently selected field sub-type, falling back to the
 *   dropdown's current value if no argument is provided.
 * @param {string} typeVal - The chosen sub-type string.
 * @returns {void}
 */
function interpTypeChanged(typeVal) {
 // Persist the sub-type; if called without a value, read from the DOM dropdown
 interpFieldType = typeVal || document.getElementById('interp-spec-type')?.value || '';
}


/**
 * @description Adjusts the expected speaker count by a given delta, clamping
 *   the result between 1 and 8 inclusive, then updates the UI counter.
 * @param {number} delta - Positive or negative increment to apply.
 * @returns {void}
 */
function interpAdjustSpeakers(delta) {
 // Apply delta and clamp the result to the allowed range [1, 8]
 interpSpeakers = Math.max(1, Math.min(8, interpSpeakers + delta));
 // Locate the element that displays the speaker count
 const numEl = document.getElementById('interp-spk-num');
 // Refresh the on-screen counter if the element exists
 if (numEl) numEl.textContent = interpSpeakers;
}


/**
 * @description Builds and returns the current language pair string for use in
 *   search parameters or logging. In shadowing mode, returns a single-language
 *   string with dialect; otherwise returns a source → target pair.
 * @returns {string} The formatted language direction string.
 */
function getLangPair() {
 // Handle shadowing mode: only one language is involved
 if (currentMode === 'shadowing') {
  // Read the shadowing language, defaulting to English
  const lang = document.getElementById('shadow-lang')?.value || 'English';
  // Read the shadowing dialect, defaulting to US
  const dialect = document.getElementById('shadow-dialect')?.value || 'US';
  // Return a single-language representation with dialect
  return `${lang} (${dialect})`;
 }
 // Read the source language, defaulting to English
 const src = document.getElementById('lang-source')?.value || 'English';
 // Read the target language, defaulting to Arabic
 const tgt = document.getElementById('lang-target')?.value || 'Arabic';
 // Return the source-to-target pair string
 return `${src} → ${tgt}`;
}

// Holds the currently active question object (or null when none is loaded)
let currentQuestion = null;
// MediaRecorder instance for capturing user audio during practice
let mediaRecorder = null;
// Accumulates raw audio Blob chunks while recording is in progress
let audioChunks = [];
// Identifies which UI element or mode the current recording is destined for
let recordingTarget = null;
// Interval ID for the session timer so it can be cleared on stop
let timerInterval = null;
// Elapsed time in seconds tracked by the session timer
let timerSeconds = 0;
// Interval ID for the prompter animation loop
let prompterInterval = null;
// Boolean flag indicating whether the teleprompter is currently running
let prompterRunning = false;
// Pixel offset used to scroll or highlight the prompter text
let prompterOffset = 0;
// requestAnimationFrame handle for the waveform visualization loop
let waveAnimFrame = null;
// Web Audio API AnalyserNode for real-time waveform/frequency data
let analyserNode = null;
// Blob holding the recorded voiceover audio for upload or playback
let voBlob = null;
// Transcript text associated with the recorded voiceover
let voTranscript = '';
// Blob holding the recorded interpretation audio for upload or playback
let interpBlob = null;

// ── Page navigation ─────────────────────────────────────────────

// Tracks which page/screen is currently visible to the user
let currentPage = 'dashboard';
