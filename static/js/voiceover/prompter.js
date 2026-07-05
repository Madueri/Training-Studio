/**
 * @module voiceover/prompter.js
 * @description Voice-Over Studio — prompter, style selection, coaching lessons
 *
 * MAD Training Studio — Interpretation Practice Platform
 * © 2025 InterpretLab. All rights reserved.
 */

/**
 * @function updatePrompterText
 * @description Synchronizes the prompter display with the current script textarea value
 *              and resets the scroll offset to the top.
 * @returns {void}
 */
function updatePrompterText() {
  // Retrieve the script content from the textarea element; fall back to placeholder if empty
  document.getElementById('prompter-text').textContent = document.getElementById('vo-script').value || 'Your script will appear here...';
  // Reset the global scroll offset to zero so the text starts from the top
  prompterOffset = 0;
}

/**
 * @function updatePromptSpeed
 * @description Stub / placeholder for future speed-update logic.
 *              Currently a no-op because speed is read directly inside togglePrompter.
 * @returns {void}
 */
function updatePromptSpeed() {}

/**
 * @function updateFontSize
 * @description Reads the selected font-size control and applies it to the prompter text element.
 * @returns {void}
 */
function updateFontSize() {
  // Get the numeric value from the font-size input and append 'px' for CSS
  document.getElementById('prompter-text').style.fontSize = document.getElementById('prompt-size').value + 'px';
}

/**
 * @function togglePrompter
 * @description Starts or pauses the teleprompter auto-scroll animation.
 *              When starting, configures a setInterval that increments the vertical translate offset.
 * @returns {void}
 */
function togglePrompter() {
  // Check whether the prompter is already running
  if (prompterRunning) {
    // Stop the animation by clearing the interval timer
    clearInterval(prompterInterval);
    // Update the state flag to indicate the prompter is paused
    prompterRunning = false;
    // Change the trigger button label back to Start
    event.target.textContent = '▶ Start';
    // Exit early; nothing more to do when pausing
    return;
  }
  // If we reach here, the prompter is not running, so start it
  prompterRunning = true;
  // Update the trigger button label to Pause
  event.target.textContent = '⏸ Pause';
  // Read the speed setting from the speed input control and convert to integer
  const speed = parseInt(document.getElementById('prompt-speed').value);
  // Create a repeating timer that fires every 50 ms to advance the scroll
  prompterInterval = setInterval(() => {
    // Increment the scroll offset by a base amount plus a speed-derived factor
    prompterOffset += 0.5 + speed * 0.03;
    // Apply a CSS translateY transform to visually scroll the text upward
    document.getElementById('prompter-text').style.transform = `translateY(-${prompterOffset}px)`;
  }, 50);
}

/**
 * @function resetPrompter
 * @description Halts the prompter animation, resets the scroll offset to zero,
 *              and restores the toggle button to its initial Start state.
 * @returns {void}
 */
function resetPrompter() {
  // Clear the active interval to stop any ongoing scrolling
  clearInterval(prompterInterval);
  // Mark the prompter as not running
  prompterRunning = false;
  // Reset the accumulated scroll offset back to zero
  prompterOffset = 0;
  // Reset the CSS transform so the text returns to the top visually
  document.getElementById('prompter-text').style.transform = 'translateY(0)';
  // Locate the Start/Pause button by its inline onclick attribute
  const btn = document.querySelector('[onclick="togglePrompter()"]');
  // If the button exists, reset its label to Start
  if (btn) btn.textContent = '▶ Start';
}


// ── Dashboard + Progress sim tab switchers ────────────────────────────────

/**
 * @function selectVoiceStyle
 * @description Updates the currently selected voice style, highlights the chosen card,
 *              and refreshes the voice profile panel.
 * @param {string} style - The key identifier of the selected voice style (e.g., 'warm', 'authoritative').
 * @param {HTMLElement} el - The DOM element representing the clicked style card.
 * @returns {void}
 */
function selectVoiceStyle(style, el) {
  // Store the selected style key in the global state variable
  currentVoiceStyle = style;
  // Remove the 'active' class from every style card to clear previous selection
  document.querySelectorAll('.vstyle-card').forEach(c=>c.classList.remove('active'));
  // Add the 'active' class to the clicked card to show it is selected
  el.classList.add('active');
  // Re-render the voice profile details panel based on the newly selected style
  renderVoiceProfile(style);
}


/**
 * @function renderVoiceProfile
 * @description Renders the voice color profile panel for the given style,
 *              including name header, animated bar charts, and description.
 * @param {string} style - The key identifier of the voice style to render.
 * @returns {void}
 */
function renderVoiceProfile(style) {
  // Look up the style definition object from the global VOICE_STYLES lookup table
  const s = VOICE_STYLES[style];
  // Guard clause: abort if the requested style does not exist in the lookup
  if (!s) return;
  // Set the profile header to the style name plus a fixed subtitle suffix
  document.getElementById('vp-style-name').textContent = s.name + ' — Voice Color Profile';
  // Build the bar-chart HTML by mapping over the style's bars array
  document.getElementById('vp-bars').innerHTML = s.bars.map(b=>`
  <div class="vp-row">
    <div class="vp-label">${b.label}</div>
    <div class="vp-bar-outer"><div class="vp-bar-fill" style="width:${b.val}%;background:${b.color}"></div></div>
    <div class="vp-val" style="color:${b.color}">${b.val}</div>
  </div>`).join('');
  // Populate the description paragraph with the style's long-form description text
  document.getElementById('vp-desc').textContent = s.desc;
}

// ── Save note to vault ─────────────────────────────────────────

/**
 * @function initCoachingLessons
 * @description Populates the coaching-lessons container with collapsible lesson panels.
 *              Each lesson shows an icon, title, level badge (color-coded), and expandable content.
 * @returns {void}
 */
function initCoachingLessons() {
  // Obtain a reference to the container element where lessons will be injected
  const container = document.getElementById('coaching-lessons');
  // Define a color map for lesson level badges using CSS custom properties
  const levelColors = { 'Foundation': 'var(--green)', 'Delivery': 'var(--blue)', 'Broadcast': 'var(--amber)', 'Professional': 'var(--red)' };
  // Generate HTML for all lessons by mapping over the global LESSONS array
  container.innerHTML = LESSONS.map((l, i) => `
  <div class="lesson">
    <div class="lesson-header" onclick="toggleLesson(${i})">
      <span>${l.icon} ${l.title} <span style="font-size:11px;color:${levelColors[l.level]||'var(--dim)'};margin-left:6px">${l.level}</span></span>
      <span id="lesson-arrow-${i}" style="color:var(--dim)">▼</span>
    </div>
    <div class="lesson-body" id="lesson-body-${i}">${l.content}</div>
  </div>`).join('');
}


/**
 * @function toggleLesson
 * @description Toggles the open/closed state of a specific coaching lesson panel
 *              and updates the arrow indicator accordingly.
 * @param {number} i - The zero-based index of the lesson to toggle.
 * @returns {void}
 */
function toggleLesson(i) {
  // Retrieve the lesson body element for the given index
  const body = document.getElementById('lesson-body-' + i);
  // Retrieve the arrow indicator element for the given index
  const arrow = document.getElementById('lesson-arrow-' + i);
  // Toggle the 'open' CSS class to show or hide the lesson body
  body.classList.toggle('open');
  // Update the arrow symbol: up arrow if open, down arrow if closed
  arrow.textContent = body.classList.contains('open') ? '▲' : '▼';
}

// ── Init ───────────────────────────────────────────────────────

/**
 * @event DOMContentLoaded
 * @description Application bootstrap: initializes coaching lessons, restores the saved theme,
 *              syncs navigation icons, and navigates to the dashboard while recomputing progress.
 * @returns {void}
 */
window.addEventListener('DOMContentLoaded', () => {
  // Render all coaching lesson panels into the DOM
  initCoachingLessons();

  // Apply saved theme + sync nav icons
  // Retrieve the persisted theme preference from localStorage; default to 'dark' if none stored
  const savedTheme = localStorage.getItem('mad-theme') || 'dark';
  // If the saved theme is not the default dark, apply it immediately
  if (savedTheme !== 'dark') applyTheme(savedTheme, null);
  // Update the theme toggle icon in the navigation to match the active theme
  _updateThemeIcon(savedTheme);
  // Initialize the language picker dropdown and its event listeners
  _initLangPicker();

  // Navigate to the dashboard view as the default landing page
  goPage('dashboard');
  // Initialize the user's personalized learning path state
  initUserPath();
  // Recalculate and update any progress indicators based on current state
  recomputeProgressState();
});
