/**
 * @module pages/learn.js
 * @description Learn page — module list, phase toggling, scroll navigation
 *
 * InterpLing — Interpretation Practice Platform
 * © 2025 InterpLing. All rights reserved.
 */

/**
 * @function loadLearnPage
 * @description Renders the learn-page module list, computes unlock states based on
 *   the user's selected path (learner / professional / upskilling), updates badge
 *   labels, toggles lock classes, and refreshes phase-progress bars.
 * @returns {void}
 */
function loadLearnPage() {
  // Retrieve the user's chosen learning path from localStorage (default to 'learner')
  const path = localStorage.getItem('il_path') || 'learner';
  // Parse the record of completed modules from localStorage (default to empty object)
  const done = JSON.parse(localStorage.getItem('il_modules_done') || '{}');
  // Deep-clone the unlock rules for the current path (fallback to learner rules)
  const rules = JSON.parse(JSON.stringify(MODULE_UNLOCK_RULES[path] || MODULE_UNLOCK_RULES['learner']));

  // Map internal path keys to human-readable labels for the UI header
  const pathLabels = { learner:'Learner Path', professional:'Professional Path', upskilling:'Upskilling Path' };
  // Map internal path keys to short description strings shown under the header
  const pathDescs  = {
    learner: 'Modules unlock sequentially. Complete each one to advance.',
    professional: 'Full access — jump to any module.',
    upskilling: 'Phase 1 open. Later phases unlock based on placement.',
  };
  // Grab the DOM element that displays the path label
  const tag  = document.getElementById('learn-path-tag');
  // Grab the DOM element that displays the path description
  const desc = document.getElementById('learn-path-desc');
  // Update the label text if the element exists
  if (tag)  tag.textContent  = pathLabels[path] || path;
  // Update the description text if the element exists
  if (desc) desc.textContent = pathDescs[path]  || '';

  // Learner: cascade unlock
  // For learner path, auto-unlock each module once the previous one is marked done
  if (path === 'learner') {
    // Iterate from module 2 up to the total module count
    for (let n = 2; n <= MODULE_TOTAL; n++) { if (done[n-1]) rules[n] = true; }
  }

  // Iterate over every module index from 1 through MODULE_TOTAL
  for (let n = 1; n <= MODULE_TOTAL; n++) {
    // Select the DOM row element for this module
    const row    = document.getElementById('mr-'  + n);
    // Select the DOM status-badge element for this module
    const badge  = document.getElementById('msb-' + n);
    // Select the DOM lock-icon element for this module
    const lock   = document.getElementById('mlk-' + n);
    // Skip to the next iteration if the row element is missing from the DOM
    if (!row) continue;
    // Determine whether this module has been completed (coerce to boolean)
    const isDone     = !!done[n];
    // Determine whether this module is currently unlocked (coerce to boolean)
    const isUnlocked = !!rules[n];
    // Toggle the 'mod-locked' CSS class based on unlock state
    row.classList.toggle('mod-locked', !isUnlocked);
    // Toggle the 'mod-done' CSS class based on completion state
    row.classList.toggle('mod-done',    isDone);
    // Show or hide the lock icon depending on whether the module is unlocked
    if (lock) lock.style.display = isUnlocked ? 'none' : '';
    // Update the badge text and CSS class if the badge element exists
    if (badge) {
      // Set badge text to 'Done', 'Start', or 'Locked' depending on state
      badge.textContent = isDone ? 'Done' : isUnlocked ? 'Start' : 'Locked';
      // Build the badge class string with a suffix for the current state
      badge.className = 'mod-status-badge' + (isDone ? ' done' : isUnlocked ? ' active' : '');
    }
  }

  // Phase progress + sidebar bars
  // Define the inclusive module ranges for each of the four phases
  const phases = [[1,7],[8,13],[14,18],[19,29]];
  // Iterate over each phase to calculate and render its progress
  phases.forEach(([start, end], pi) => {
    // Calculate the total number of modules in this phase
    const total     = end - start + 1;
    // Count how many modules in this phase are marked as completed
    const completed = Array.from({length:total},(_,i)=>start+i).filter(n=>done[n]).length;
    // Compute completion percentage, rounded to the nearest integer
    const pct = Math.round(completed/total*100);
    // Select the sidebar progress-bar element for this phase
    const sbar = document.getElementById('lspf-' + (pi+1));
    // Update the sidebar bar width to reflect the completion percentage
    if (sbar) sbar.style.width = pct + '%';
    // Select the header progress-text element for this phase
    const prog = document.getElementById('lphdr-prog-' + (pi+1));
    // Update the header text to show "completed / total" count
    if (prog) prog.textContent = `${completed} / ${total}`;
  });

  // Trigger a global progress-state recomputation (defined in progress.js)
  recomputeProgressState();
}


/**
 * @function openModule
 * @description Validates whether a module is unlocked for the current path and,
 *   if allowed, alerts the user that the module content is under construction.
 * @param {number} n - The 1-based module index to open.
 * @returns {void}
 */
function openModule(n) {
  // Retrieve the user's chosen learning path from localStorage (default to 'learner')
  const path = localStorage.getItem('il_path') || 'learner';
  // Parse the record of completed modules from localStorage (default to empty object)
  const done = JSON.parse(localStorage.getItem('il_modules_done') || '{}');
  // Fetch the unlock rules for the current path (fallback to learner rules)
  const rules = MODULE_UNLOCK_RULES[path] || MODULE_UNLOCK_RULES['learner'];
  // For learner path, cascade-unlock modules based on prior completions
  if (path === 'learner') {
    // Loop from module 2 up to the total module count
    for (let i = 2; i <= MODULE_TOTAL; i++) { if (done[i-1]) rules[i] = true; }
  }
  // Guard: block navigation if the requested module is not yet unlocked
  if (!rules[n]) { alert('Complete earlier modules first to unlock this one.'); return; }
  // placeholder — module detail panel coming in next build
  // Alert the user that this module's detailed content is still being built
  alert(`Module ${n} content is being built. Check back soon.`);
}


/**
 * @function togglePhase
 * @description Toggles the collapsed state of a phase section and rotates the
 *   chevron icon to indicate open / closed visually.
 * @param {number} n - The 1-based phase index to toggle.
 * @returns {void}
 */
function togglePhase(n) {
 // Select the collapsible body element for the given phase
 const body = document.getElementById('lphase-body-' + n);
 // Select the chevron icon element for the given phase header
 const chev = document.getElementById('lphdr-chev-' + n);
 // Abort if the body element is not present in the DOM
 if (!body) return;
 // Toggle the 'collapsed' CSS class and capture the new collapsed state
 const collapsed = body.classList.toggle('collapsed');
 // Rotate the chevron downward when expanded, upward when collapsed
 if (chev) chev.style.transform = collapsed ? 'rotate(-90deg)' : '';
}

/**
 * @function scrollToPhase
 * @description Highlights the requested phase in the sidebar and smoothly
 *   scrolls the main content area so the phase section is at the top.
 * @param {number} n - The 1-based phase index to scroll into view.
 * @returns {void}
 */
function scrollToPhase(n) {
 // Iterate over all sidebar phase items and toggle the 'active-phase' class
 // on the item whose index matches the requested phase
 document.querySelectorAll('.learn-sidebar-phase').forEach((el,i) => el.classList.toggle('active-phase', i+1 === n));
 // Select the main content section element for the requested phase
 const sec = document.getElementById('lphase-' + n);
 // Smooth-scroll the section to the top of the viewport if it exists
 if (sec) sec.scrollIntoView({ behavior:'smooth', block:'start' });
}
