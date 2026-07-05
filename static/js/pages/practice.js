/**
 * @module pages/practice.js
 * @description Practice page — mode selection, skill tree, grid toggle, parameter setup
 *
 * MAD Training Studio — Interpretation Practice Platform
 * © 2025 InterpretLab. All rights reserved.
 */

/**
 * @description Selects an interpretation mode and visually highlights the chosen mode card.
 * @param {string} mode - The mode identifier to activate (e.g., 'shadowing', 'consecutive').
 * @param {HTMLElement} el - The DOM element representing the clicked mode card.
 * @returns {void}
 */
function selectMode(mode, el) {
 // Store the selected mode globally for reference by other functions.
 currentMode = mode;
 // Remove the 'selected' CSS class from all mode cards to clear previous selection.
 document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('selected'));
 // Add the 'selected' CSS class to the clicked card for visual feedback.
 el.classList.add('selected');
}

// ── Recording ──────────────────────────────────────────────────

/**
 * @description Transitions the UI from the home/mode-selection screen to the parameter-setup screen
 * for the chosen practice mode. Handles mode-specific visibility toggles for simulation cards,
 * language UI blocks, dialects, and optionally pre-loads curated videos for consecutive/OPI modes.
 * @param {string} mode - The interpretation mode to enter (e.g., 'consecutive', 'opi', 'shadowing').
 * @returns {Promise<void>}
 */
async function enterPractice(mode) {
 // Store the chosen mode in the global currentMode variable.
 currentMode = mode;
 // Look up metadata (name, subtitle, instructions) for the selected mode.
 const meta = MODE_META[mode];
 // Hide the home/mode-selection container.
 document.getElementById('interp-home').style.display = 'none';
 // Show the parameter-setup container.
 document.getElementById('interp-params').style.display = 'block';
 // Ensure the active session container remains hidden until a session is started.
 document.getElementById('interp-session').style.display = 'none';
 // Populate the practice-mode name header with the localized mode name.
 document.getElementById('practice-mode-name').textContent = meta.name;
 // Populate the practice-mode subtitle with the localized subtitle text.
 document.getElementById('practice-mode-sub').textContent = meta.sub;

 // Show/hide simulation cards based on mode
 // Retrieve the OPI (Over-the-Phone Interpreting) AI launch card element.
 const opiCard  = document.getElementById('opi-ai-launch-card');
 // Retrieve the Consecutive Interpreting AI launch card element.
 const ciCard   = document.getElementById('ci-ai-launch-card');
 // Retrieve the Simultaneous Interpreting AI launch card element.
 const siCard   = document.getElementById('si-ai-launch-card');
 // Retrieve the Chuchotage (whispered simultaneous) AI launch card element.
 const chuchotageCard = document.getElementById('chuchotage-ai-launch-card');
 // Retrieve the Escort/Liaison AI launch card element.
 const escortCard     = document.getElementById('escort-ai-launch-card');
 // Retrieve the Sight Translation AI launch card element.
 const sightCard      = document.getElementById('sight-ai-launch-card');
 // Toggle visibility: show OPI card only when mode is 'opi'.
 if (opiCard) opiCard.style.display  = mode === 'opi'         ? 'block' : 'none';
 // Toggle visibility: show CI card only when mode is 'consecutive'.
 if (ciCard)  ciCard.style.display   = mode === 'consecutive' ? 'block' : 'none';
 // Toggle visibility: show SI card only when mode is 'simultaneous'.
 if (siCard)  siCard.style.display   = mode === 'simultaneous' ? 'block' : 'none';
 // Toggle visibility: show chuchotage card only when mode is 'chuchotage'.
 if (chuchotageCard) chuchotageCard.style.display = mode === 'chuchotage' ? 'block' : 'none';
 // Toggle visibility: show escort card only when mode is 'escort'.
 if (escortCard)     escortCard.style.display     = mode === 'escort'     ? 'block' : 'none';
 // Toggle visibility: show sight card only when mode is 'sight'.
 if (sightCard)      sightCard.style.display      = mode === 'sight'      ? 'block' : 'none';

 // Show correct language UI. Every block below has an explicit grid-column
 // (set in the markup) so toggling display:block/none here never reflows
 // Difficulty/Duration — only the swapped-in block's own column is affected.
 // Determine whether the selected mode is shadowing (uses single-language UI).
 const isShadowing = mode === 'shadowing';
 // Show shadowing-specific language/dialect selectors when in shadowing mode.
 ['lang-shadow-lang-wrap','lang-shadow-dialect-wrap'].forEach(id => {
  // Look up each shadowing UI block by its ID.
  const el = document.getElementById(id);
  // Show the block if shadowing is active; otherwise hide it.
  if (el) el.style.display = isShadowing ? 'block' : 'none';
 });
 // Show language-pair selectors (source + target) for all non-shadowing modes.
 ['lang-pair-block','lang-pair-dialect-block','lang-pair-target-block','lang-pair-target-dialect-block'].forEach(id => {
  // Look up each language-pair UI block by its ID.
  const el = document.getElementById(id);
  // Hide the block if shadowing is active; otherwise show it.
  if (el) el.style.display = isShadowing ? 'none' : 'block';
 });
 // Retrieve the arrow block that visually separates source and target languages.
 const arrowBlock = document.getElementById('lang-pair-arrow-block');
 // Hide the arrow for shadowing; otherwise display it as a flex container.
 if (arrowBlock) arrowBlock.style.display = isShadowing ? 'none' : 'flex';
 // Retrieve the one-way toggle group (e.g., A→B vs B→A).
 const onewayGroup = document.getElementById('interp-oneway-group');
 // Hide one-way toggle for shadowing; otherwise show it as a flex container.
 if (onewayGroup) onewayGroup.style.display = isShadowing ? 'none' : 'flex';
 // Refresh dialect options based on currently selected languages.
 updateDialects();
 // Initialize parameter controls (sliders, selects, defaults) for the current mode.
 interpInitParams();

 // For consecutive/OPI: pre-load curated seeds immediately
 // Get the container where video results will be rendered.
 const area = document.getElementById('video-results-area');
 // Check if the current mode qualifies for curated-video pre-loading.
 if (mode === 'consecutive' || mode === 'opi') {
   // Display a loading spinner/message while curated videos are fetched.
   area.innerHTML = `<div style="text-align:center;padding:20px;color:var(--dim);font-size:12px">
     <div style="font-size:20px;margin-bottom:6px"></div>Loading curated practice videos…</div>`;
   // Read the currently selected specialization field (defaults to 'medical').
   const field = document.getElementById('interp-spec')?.value || 'medical';
   // Read the currently selected difficulty level (may be empty string).
   const diff = document.getElementById('interp-difficulty')?.value || '';
   try {
     // Fetch curated videos from the backend API, including mode, field, pace, and optional difficulty.
     const r = await fetch(`/api/curated-videos?mode=${mode}&field=${field}&pace=slow${diff ? '&difficulty='+diff : ''}`);
     // Parse the JSON response into an array of video seed objects.
     const seeds = await r.json();
     // If seeds exist and the array is non-empty, render them in the grid.
     if (seeds && seeds.length) {
       // Render the fetched curated videos into the results grid.
       renderVideoResultsGrid(seeds, { field, lang: getLangPair(), topic: '', dur: 5 });
       // Create an informational banner indicating curated videos are displayed.
       const note = document.createElement('div');
       // Style the banner with teal accent colors and flex layout for alignment.
       note.style.cssText = 'font-size:12px;color:var(--teal);margin:0 0 10px;display:flex;align-items:center;gap:6px';
       // Set the banner content with a styled pill label.
       note.innerHTML = `<span style="background:rgba(45,212,191,.12);border:1px solid rgba(45,212,191,.4);padding:4px 12px;border-radius:20px"> Curated ${mode} videos — built-in silence gaps verified. Search below for more.</span>`;
       // Insert the banner at the top of the video results area.
       area.insertBefore(note, area.firstChild);
     } else {
       // No curated seeds returned; fall back to the default prompt UI.
       _showDefaultVideoPrompt(area);
     }
   } catch(e) {
     // On network or parse error, fall back to the default prompt UI.
     _showDefaultVideoPrompt(area);
   }
 } else {
   // For modes other than consecutive/OPI, show the default prompt immediately.
   _showDefaultVideoPrompt(area);
 }
}


/**
 * @description Initializes the skill-tree visualization by reading user progress from
 * localStorage, aggregating session counts and best scores across all modes, and
 * rendering the tree via SkillTreeRenderer. Attaches a click handler that enters practice
 * for the clicked node.
 * @returns {void}
 */
function initSkillTree() {
  // Guard clause: abort if the SkillTreeRenderer class is not loaded.
  if (typeof SkillTreeRenderer === 'undefined') {
    // Log a warning so developers know the dependency is missing.
    console.warn('[SkillTree] SkillTreeRenderer not loaded');
    return;
  }
  // Locate the DOM container where the skill tree will be rendered.
  const container = document.getElementById('skill-tree');
  // If the container does not exist, abort initialization silently.
  if (!container) return;
  // Gather progress from localStorage
  // Helper: read a boolean flag from localStorage (truthy if key exists).
  const getBool = k => !!localStorage.getItem(k);
  // Helper: read a JSON array from localStorage with safe fallback to empty array.
  const getArr  = k => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch(e) { return []; } };
  // Helper: read an integer from localStorage, defaulting to 0 if missing.
  const getNum  = k => { const v = localStorage.getItem(k); return v ? parseInt(v,10) : 0; };
  // Load the array of completed module IDs from localStorage.
  const completedModules = getArr('completed-modules');
  // Load the index of the current active module from localStorage.
  const currentModule = getNum('current-module');
  // Aggregate progress data across all practice modes.
  const progress = {
    // Shadowing progress: has the user practiced at least once, how many sessions, best score.
    shadowing:   { practiced: getBool('shadowing-practiced'), sessions: getArr('shadowing-sessions').length, score: getNum('shadowing-best-score') },
    // Consecutive progress: practiced flag derived from session count > 0.
    consecutive: { practiced: getArr('ci-sessions').length > 0, sessions: getArr('ci-sessions').length, score: getNum('ci-best-score') },
    // Simultaneous progress: practiced flag derived from session count > 0.
    simultaneous:{ practiced: getArr('si-sessions').length > 0, sessions: getArr('si-sessions').length, score: getNum('si-best-score') },
    // Sight translation progress.
    sight:       { practiced: getBool('sight-translation-practiced'), sessions: getArr('sight-sessions').length, score: getNum('sight-best-score') },
    // Chuchotage progress.
    chuchotage:  { practiced: getBool('chuchotage-practiced'), sessions: getArr('chuchotage-sessions').length, score: getNum('chuchotage-best-score') },
    // Escort/liaison progress: accepts either escort-practiced or legacy liaison-practiced flag.
    escort:      { practiced: getBool('escort-practiced') || getBool('liaison-practiced'), sessions: getArr('escort-sessions').length, score: getNum('escort-best-score') },
    // OPI/VRI progress: accepts either opi-sessions count or legacy vri-practiced flag.
    opi:         { practiced: getArr('opi-sessions').length > 0 || getBool('vri-practiced'), sessions: getArr('opi-sessions').length, score: getNum('opi-best-score') },
    // Module tracking fields for curriculum progression.
    module: currentModule,
    currentModule: currentModule,
    completedModules: completedModules
  };
  // Instantiate the skill-tree renderer, storing the reference globally for debugging.
  window._skillTree = new SkillTreeRenderer(container, progress, {
    // Define the callback invoked when a user clicks any tree node.
    onNodeClick: (mode, node) => {
      // User is already on Practice page — just enter the mode directly, same as grid cards
      // Trigger the practice parameter screen for the clicked mode.
      enterPractice(mode);
    }
  });
  // Render the skill tree into the DOM container.
  window._skillTree.render();
}

/**
 * @description Toggles between the skill-tree view and the mode-cards grid view.
 * Updates the toggle button text to reflect the next available view.
 * @returns {void}
 */
function toggleModeView() {
  // Locate the skill-tree container element.
  const tree = document.getElementById('skill-tree-container');
  // Locate the mode-cards grid element.
  const grid = document.getElementById('mode-cards-grid');
  // Locate the view-toggle button element.
  const btn = document.getElementById('mode-view-toggle');
  // Guard: if either container is missing, abort to avoid errors.
  if (!tree || !grid) return;
  // Determine whether the tree is currently visible (not explicitly set to 'none').
  const showingTree = tree.style.display !== 'none';
  // If tree is showing, hide it; otherwise show it.
  tree.style.display = showingTree ? 'none' : 'block';
  // If tree is showing, show the grid; otherwise hide the grid.
  grid.style.display = showingTree ? 'block' : 'none';
  // Update the button label so the user knows which view will appear next.
  if (btn) btn.textContent = showingTree ? 'View as Tree' : 'View as Grid';
}

// Auto-init when DOM ready
// Wait for the DOM to be fully parsed before initializing the skill tree.
document.addEventListener('DOMContentLoaded', () => {
  // Initialize the skill tree visualization once the DOM is ready.
  initSkillTree();
});

// ── Practice Page Navigation ────────────────────────────────────

/**
 * @description Metadata object for each practice mode. Provides localized names,
 * subtitles, and step-by-step instructions for the user. Used by enterPractice() and
 * other UI generators to display contextual help text.
 * @constant {Object.<string, Object>}
 * @property {string} name - Display name of the mode.
 * @property {string} sub - Short subtitle describing the mode.
 * @property {string} instructions - Multi-line instruction string shown to the user.
 */
const MODE_META = {
 // Metadata for shadowing mode: real-time fluency mimicry.
 shadowing: { name:'Shadowing', sub:'Real-time fluency training', instructions:'① Select a field and choose a video from the library\n② Press Start Recording — your mic activates immediately\n③ Play the video and shadow the speaker in the same language, matching their rhythm and pacing\n④ Press Finish when done — your delivery will be analyzed for fluency, pacing, and naturalness' },
 // Metadata for consecutive interpreting mode: segmented memory-based interpretation.
 consecutive: { name:'Consecutive', sub:'Segment-by-segment interpretation', instructions:'① Choose a language pair and field\n② Watch a video segment (30s–2 min), then pause it\n③ Press Start Recording and deliver your interpretation from memory\n④ Repeat for each segment, then press Finish for analysis\nTip: Use the Practice Notes field to jot key terms while watching' },
 // Metadata for simultaneous interpreting mode: real-time cross-language delivery.
 simultaneous: { name:'Simultaneous', sub:'Real-time cross-language interpreting', instructions:'① Set your language pair and field\n② Press Start Recording first, then play the video\n③ Interpret into the target language in real-time as the speaker talks\n④ Press Finish when the segment ends — your accuracy and fluency will be scored' },
 // Metadata for OPI/VRI mode: remote interpreting with optional video channel.
 opi: { name:'OPI / VRI', sub:'Over-the-Phone & Video Remote Interpreting', instructions:'① Select a field — call scenarios match real OPI/VRI call types\n② Toggle "Video call (VRI)" if you want the visual channel — a camera panel activates with non-verbal cues to read\n③ Go online and accept the incoming call, interpreting both parties\n④ End the call — you will be assessed on accuracy, turn-taking, professional register, and (in VRI mode) visual-cue handling' },
 // Metadata for chuchotage mode: whispered simultaneous without equipment.
 chuchotage: { name:'Chuchotage', sub:'Whispered simultaneous interpreting', instructions:'① Set your language pair and field, plus ambient noise and listener count\n② Press Start Recording first, then play the video\n③ Whisper your interpretation live, in real-time, with no booth or equipment — no replay is allowed\n④ Press Finish when the segment ends — you will be scored on décalage control and volume & noise discipline' },
 // Metadata for escort/liaison mode: informal bidirectional interpreting.
 escort: { name:'Escort/Liaison', sub:'Informal bidirectional interpreting', instructions:'① Choose a scenario — business, social, or administrative — and a field\n② Watch each short exchange, then press Start Recording and interpret it naturally in either direction\n③ Keep the register conversational — contractions and informality are expected\n④ Press Finish — you will be scored on cultural mediation and conversational naturalness' },
 // Metadata for sight translation mode: written-input, oral-output.
 sight: { name:'Sight Translation', sub:'Written-input, oral-output interpreting', instructions:'① Choose a document type — letter, form, contract excerpt, or news clipping — and a field\n② Press Start — the document appears on screen and stays visible the whole time (no audio, no replay needed)\n③ Read ahead silently while speaking your oral rendition aloud, at a sustained pace\n④ Press Finish — you will be scored on register fidelity, completeness, WPM throughput, and public-speaking delivery' }
};


/**
 * @description Renders the default prompt UI inside the video-results area when no curated
 * videos are available or while waiting for user parameters.
 * @param {HTMLElement} area - The DOM container (video-results-area) to populate.
 * @returns {void}
 */
function _showDefaultVideoPrompt(area) {
 // Replace the container's inner HTML with a centered prompt asking the user to set parameters.
 area.innerHTML = `
 <div style="text-align:center;padding:40px;color:var(--dim)">
 <div style="font-size:36px;margin-bottom:10px"></div>
 <div style="font-size:15px;font-weight:600;color:var(--text);margin-bottom:6px">Set your parameters above</div>
 <div style="font-size:13px">Claude will search and analyze videos for difficulty — then choose one to start</div>
 </div>`;
}


/**
 * @description Navigates back from the parameter-setup screen to the home/mode-selection screen.
 * Hides the parameter and session views and clears any active interpretation state.
 * @returns {void}
 */
function backToModeSelect() {
 // Show the home/mode-selection container.
 document.getElementById('interp-home').style.display = 'block';
 // Hide the parameter-setup container.
 document.getElementById('interp-params').style.display = 'none';
 // Hide the active session container.
 document.getElementById('interp-session').style.display = 'none';
 // Reset interpretation state (player, recording, timers, etc.).
 clearInterp();
}


/**
 * @description Navigates back from the active session screen to the parameter-setup screen.
 * Stops any active YouTube playback, stops an ongoing practice recording, and cancels
 * any pending auto-segment timers before switching views.
 * @returns {void}
 */
function backToParams() {
 // Stop any active playback/recording
 // If a YouTube player exists, attempt to pause the video safely (wrap in try/catch for API quirks).
 if (ytPlayer) { try { ytPlayer.pauseVideo(); } catch(e){} }
 // If a practice recording is currently in progress, stop it to release the mic.
 if (practiceRecording) stopPracticeRecording();
 // Cancel any pending auto-segmentation timer to prevent callbacks after navigation.
 clearTimeout(autoSegTimer);
 // Hide the active session container.
 document.getElementById('interp-session').style.display = 'none';
 // Show the parameter-setup container so the user can adjust settings.
 document.getElementById('interp-params').style.display = 'block';
}


/**
 * @description Reads a custom YouTube URL from the parameter-screen input, validates it,
 * builds a synthetic video object, and immediately opens a practice session with it.
 * @returns {void}
 */
function loadParamsCustomVideo() {
 // Read and trim the raw URL from the custom-video input on the parameter screen.
 const url = document.getElementById('practice-custom-url').value.trim();
 // Attempt to extract a valid YouTube video ID from the URL.
 const id = extractYouTubeId(url);
 // If extraction fails, alert the user and abort.
 if (!id) { alert('Please enter a valid YouTube URL'); return; }
 // Build a synthetic video object and open session
 // Construct a minimal video object with placeholder metadata since no backend lookup occurs.
 currentSessionVideo = { title: 'Custom video', known_id: id, difficulty: 'Moderate', speaker: '', wpm_est: '' };
 // Store the synthetic video in the global searched-videos array so the session UI can reference it.
 window._searchedVideos = [currentSessionVideo];
 // Ensure the global search-params object exists to avoid downstream null-reference errors.
 window._searchParams = window._searchParams || {};
 // Redundantly assign the synthetic video at index 0 for maximum compatibility with legacy code.
 window._searchedVideos[0] = currentSessionVideo;
 // Open the practice session using the synthetic video at index 0.
 openSession(0);
}


/**
 * @description Reads a custom YouTube URL from the session-screen input, validates it,
 * hides the URL input row, and creates a YouTube player for the extracted video ID.
 * @returns {void}
 */
function loadSessionCustomVideo() {
 // Read and trim the raw URL from the custom-video input inside the active session.
 const url = document.getElementById('session-custom-url').value.trim();
 // Attempt to extract a valid YouTube video ID from the URL.
 const id = extractYouTubeId(url);
 // If extraction fails, alert the user and abort.
 if (!id) { alert('Please enter a valid YouTube URL'); return; }
 // Hide the custom-URL input row so it does not obstruct the video player.
 document.getElementById('session-url-row').style.display = 'none';
 // Instantiate the YouTube player with the extracted video ID.
 createYTPlayer(id);
}


/**
 * @description Updates the duration label next to the duration selector if one exists.
 * Currently a no-op guard because the selector is a native <select> with readable options,
 * but legacy onchange wiring may still invoke this function.
 * @param {string|number} val - The selected duration value in minutes.
 * @returns {void}
 */
function updateDurLabel(val) {
 // #interp-dur is now a <select> whose chosen option already reads "X min",
 // so there's no separate label to update — kept as a no-op guard in case
 // any old onchange wiring still calls it.
 // Attempt to locate a legacy duration-label element.
 const lbl = document.getElementById('dur-label');
 // If the legacy label exists, update its text content with the new value plus ' min'.
 if (lbl) lbl.textContent = val + ' min';
}

// ── Expanded Video Library ───────────────────────────────────────

/**
 * @description Static library of curated and searchable videos organized by field/category.
 * Entries with a null 'id' rely on the 'search' field for runtime YouTube lookups.
 * @constant {Object.<string, Array<Object>>}
 * @property {string} id - YouTube video ID (null if search-based).
 * @property {string} search - Query string for runtime YouTube search when id is null.
 * @property {string} title - Human-readable title shown in the UI.
 * @property {string} level - Difficulty level (e.g., 'Intermediate', 'Advanced').
 * @property {string} dur - Approximate duration string for display.
 */
const VIDEO_LIBRARY = {
 // General-domain videos with known YouTube IDs.
 general: [
 // Steve Jobs' famous Stanford commencement address.
 { id:'UF8uR6Z6KLc', title:'Steve Jobs — Stanford Commencement', level:'Intermediate', dur:'15 min' },
 // TED talk by Lera Boroditsky on linguistic relativity.
 { id:'iThnT8EaEJo', title:'Lera Boroditsky — How Language Shapes Thought (TED)', level:'Advanced', dur:'14 min' },
 // TED talk by Amy Cuddy on body language and presence.
 { id:'Ks-_Mh1QhMc', title:'Amy Cuddy — Presence (TED)', level:'Intermediate', dur:'21 min' },
 ],
 // Diplomatic-context videos (search-based lookups).
 diplomatic: [
 { id:null, search:'UN General Assembly speech 2023', title:'UN General Assembly Address', level:'Advanced', dur:'20+ min' },
 { id:null, search:'UN Secretary General speech 2023 address', title:'UN Secretary-General Statement', level:'Advanced', dur:'15 min' },
 { id:null, search:'NATO summit speech press conference 2023', title:'NATO Summit Address', level:'Advanced', dur:'20 min' },
 ],
 // Medical-context videos (search-based lookups).
 medical: [
 { id:null, search:'WHO Director General speech 2023 health pandemic', title:'WHO Director-General Briefing', level:'Advanced', dur:'20 min' },
 { id:null, search:'medical conference keynote speech doctor 2023', title:'Medical Conference Keynote', level:'Intermediate', dur:'20 min' },
 { id:null, search:'public health speech announcement 2023', title:'Public Health Address', level:'Intermediate', dur:'10 min' },
 ],
 // Humanitarian-context videos (search-based lookups).
 humanitarian: [
 { id:null, search:'UNHCR refugee crisis speech 2023', title:'UNHCR Refugee Address', level:'Advanced', dur:'15 min' },
 { id:null, search:'UNICEF humanitarian aid speech 2023', title:'UNICEF Humanitarian Address', level:'Advanced', dur:'10 min' },
 { id:null, search:'MSF doctors without borders speech', title:'MSF — Doctors Without Borders Address', level:'Advanced', dur:'15 min' },
 ],
 // Legal-context videos (search-based lookups).
 legal: [
 { id:null, search:'ICC international criminal court speech judgment', title:'ICC Court Proceedings', level:'Advanced', dur:'20 min' },
 { id:null, search:'human rights lawyer speech advocacy TED', title:'Human Rights Advocacy Address', level:'Intermediate', dur:'15 min' },
 { id:null, search:'UN human rights council speech 2023', title:'UN Human Rights Council', level:'Advanced', dur:'20 min' },
 ],
 // Business-context videos (search-based lookups).
 business: [
 { id:null, search:'davos world economic forum speech 2023', title:'Davos — World Economic Forum', level:'Advanced', dur:'20 min' },
 { id:null, search:'CEO keynote conference speech business 2023', title:'CEO Conference Keynote', level:'Intermediate', dur:'20 min' },
 { id:null, search:'IMF World Bank speech economic 2023', title:'IMF / World Bank Address', level:'Advanced', dur:'20 min' },
 ],
 // Broadcast-news videos (search-based lookups).
 broadcast: [
 { id:null, search:'BBC World News broadcast anchor English 2023', title:'BBC World News Broadcast', level:'Advanced', dur:'5 min' },
 { id:null, search:'CNN anchor news broadcast segment 2023', title:'CNN News Broadcast', level:'Intermediate', dur:'5 min' },
 { id:null, search:'Sky News broadcast live anchor 2023', title:'Sky News Broadcast', level:'Intermediate', dur:'5 min' },
 ],
 // Arabic-language videos (search-based lookups).
 arabic: [
 { id:null, search:'Al Jazeera Arabic news broadcast 2023 فصحى', title:'قناة الجزيرة — نشرة الأخبار', level:'Advanced', dur:'5 min' },
 { id:null, search:'Arab League summit speech Arabic 2023', title:'القمة العربية — كلمة ترحيبية', level:'Advanced', dur:'20 min' },
 { id:null, search:'Arabic speech parliament Jordan 2023', title:'خطاب رسمي عربي', level:'Advanced', dur:'15 min' },
 ],
 // Conference-context videos (mixed known-ID and search-based).
 conference: [
 { id:'eIho2S0ZahI', title:'Julian Treasure — How to Speak (TED)', level:'Intermediate', dur:'10 min' },
 { id:null, search:'academic conference keynote lecture 2023', title:'Academic Conference Keynote', level:'Advanced', dur:'30 min' },
 { id:null, search:'TED global conference speech ideas 2023', title:'TED Global Conference Talk', level:'Intermediate', dur:'15 min' },
 ],
 // Political-context videos (search-based lookups).
 political: [
 { id:null, search:'parliament debate speech 2023 english', title:'Parliamentary Debate Speech', level:'Advanced', dur:'20 min' },
 { id:null, search:'presidential address nation speech 2023', title:'Presidential National Address', level:'Advanced', dur:'20 min' },
 { id:null, search:'prime minister press conference speech 2023', title:'Prime Minister Press Conference', level:'Advanced', dur:'15 min' },
 ],
};

// Global variable: stores the ID of the video currently selected by the user.
let selectedVideoId = null;
// Global variable: tracks whether a practice recording is currently active.
let practiceRecording = false;

// Build smart search query from parameters

/**
 * @description Mapping of specialization fields to pre-curated search query strings.
 * Used when the user does not provide a specific video ID and the system needs to
 * discover suitable practice material on YouTube at runtime.
 * @constant {Object.<string, string>}
 */
const FIELD_QUERIES = {
 // Broad English public-speaking queries for general training.
 general: 'english speech interview lecture public speaking',
 // Diplomatic-context queries focused on UN and international forums.
 diplomatic: 'UN General Assembly speech diplomatic 2023',
 // Medical-context queries targeting WHO and health conferences.
 medical: 'WHO medical conference health speech doctor',
 // Humanitarian-context queries targeting UNHCR and aid agencies.
 humanitarian:'UNHCR humanitarian refugee aid speech 2023',
 // Legal-context queries targeting courts and human rights.
 legal: 'court legal speech human rights ICC proceedings',
 // Business-context queries targeting Davos, CEOs, and economic institutions.
 business: 'davos CEO conference business keynote speech',
 // Broadcast-news queries targeting major English-language networks.
 broadcast: 'BBC CNN Sky News anchor broadcast segment',
 // Arabic-language queries targeting news broadcasts and formal speeches.
 arabic: 'الجزيرة خطاب عربي فصحى أخبار 2023',
 // Conference-context queries targeting TED and academic venues.
 conference: 'TED talk academic conference lecture ideas',
 // Political-context queries targeting parliamentary and executive addresses.
 political: 'parliament presidential speech political address',
};
