/**
 * @module shared/youtube-player.js
 * @description YouTube IFrame API wrapper — player creation, playback controls, caption injection
 *
 * MAD Training Studio — Interpretation Practice Platform
 * © 2025 InterpretLab. All rights reserved.
 */

/**
 * @description Creates a new YouTube player instance for the given video ID.
 *              Destroys any existing player, resets the auto-segment timer,
 *              and injects a fresh player container into the DOM.
 *              Polls for the YT API to be ready before constructing the player.
 * @param   {string} videoId — The YouTube video identifier (e.g. "dQw4w9WgXcQ").
 * @returns {void}
 */
function createYTPlayer(videoId) {
  // Destroy any existing YouTube player instance to prevent duplicates or memory leaks
  if (ytPlayer) { try { ytPlayer.destroy(); } catch(e){} ytPlayer = null; }
  // Cancel any pending auto-segment timeout to avoid stale timers
  clearTimeout(autoSegTimer);
  // Grab the wrapper element that will host the player
  const wrap = document.getElementById('session-video-wrap');
  // Create a fresh div to serve as the player's mount point
  const div = document.createElement('div');
  // Assign an ID so the YT API can target this element
  div.id = 'yt-player-div';
  // Style the div to fill the entire wrapper absolutely
  div.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
  // Clear any previous content from the wrapper
  wrap.innerHTML = '';
  // Append the new player div into the wrapper
  wrap.appendChild(div);

  /**
   * @description Inner helper that attempts to instantiate the YT.Player.
   *              If the YouTube IFrame API is not yet loaded, re-schedules itself.
   * @returns {void}
   */
  const tryCreate = () => {
    // Check whether the global YT object and its Player constructor are available
    if (!window.YT || !YT.Player) { setTimeout(tryCreate, 300); return; }
    // Instantiate the YouTube player on the prepared div
    ytPlayer = new YT.Player('yt-player-div', {
      videoId,                                    // The video to load
      playerVars: { rel:0, modestbranding:1, playsinline:1, enablejsapi:1 },
      events: { onReady: onYTReady, onStateChange: onYTStateChange }
    });
  };
  // Kick off the creation attempt
  tryCreate();
}


/**
 * @description Callback invoked when the YouTube player reports it is ready.
 *              Styles the iframe to fill its container and updates UI state.
 * @param   {Object} e — The YT onReady event object; e.target is the player instance.
 * @returns {void}
 */
function onYTReady(e) {
  // Obtain the underlying iframe element from the player instance
  const iframe = e.target.getIframe();
  // Force the iframe to fill the container absolutely with no border
  iframe.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border:none';
  // Update the play/pause button to show the "Play" icon since video is not yet playing
  updatePlayBtn(false);
  // Locate the playback-status DOM element
  const pbStatus = document.getElementById('playback-status');
  // If the status element exists, display a ready message prompting the user to press Play
  if (pbStatus) pbStatus.textContent = 'Ready — press Play to begin';
}

// Use numeric constants — avoids YT.PlayerState race condition on load
// -1=unstarted, 0=ended, 1=playing, 2=paused, 3=buffering, 5=video cued

/**
 * @description Handles all YouTube player state changes (playing, paused, ended, etc.).
 *              Triggers recording logic, pause polling, and UI updates based on currentMode.
 *              Uses numeric state codes to avoid YT.PlayerState dependency at load time.
 * @param   {Object} e — The YT onStateChange event object; e.data holds the state code.
 * @returns {void}
 */
function onYTStateChange(e) {
  // Check if the new state is PLAYING (code 1)
  if (e.data === 1) { // PLAYING
    // Update global playback flag
    isPlaying = true;
    // Reflect the playing state in the play/pause button icon
    updatePlayBtn(true);
    // Clear any stale hint text from the segment-hint area
    document.getElementById('segment-hint').textContent = '';

    // Branch behavior according to the active practice mode
    if (currentMode === 'shadowing' || currentMode === 'simultaneous') {
      // Schedule recording to start exactly when speech begins
      // Clear any existing speech-start timer to prevent overlapping timeouts
      clearTimeout(speechStartTimer);
      // Read the player's current time to compute delay until speech starts
      const currentTime = ytPlayer.getCurrentTime?.() || 0;
      // Calculate how many milliseconds until the scheduled speech start
      const delay = Math.max(0, (speechStartSec - currentTime) * 1000);
      // Grab the segment-hint element for countdown display
      const hint = document.getElementById('segment-hint');

      // If the speech start is more than 500ms away, show a countdown
      if (delay > 500) {
        // Show countdown until speech starts
        if (hint) hint.innerHTML = `<span style="color:var(--dim)">Speech starts in ${(delay/1000).toFixed(1)}s…</span>`;
        // Set a timer to begin recording once the countdown elapses
        speechStartTimer = setTimeout(() => {
          // Only start recording if still playing and not already recording
          if (isPlaying && !practiceRecording) scheduledStartRecording();
        }, delay);
      } else {
        // Speech already started or starting immediately — begin recording right away
        scheduledStartRecording();
      }

    } else if (currentMode === 'consecutive' || currentMode === 'opi') {
      // For consecutive and OPI modes, begin polling for upcoming pauses
      startPausePolling();
    }

  // Check if the new state is PAUSED (code 2)
  } else if (e.data === 2) { // PAUSED
    // Update global playback flag
    isPlaying = false;
    // Reflect the paused state in the play/pause button icon
    updatePlayBtn(false);
    // Stop any active pause-polling loop
    stopPausePolling();
    // Cancel the auto-segment timeout since user has manually paused
    clearTimeout(autoSegTimer);
    // Cancel any pending speech-start timer
    clearTimeout(speechStartTimer);

    // Branch behavior according to the active practice mode
    if (currentMode === 'shadowing' || currentMode === 'simultaneous') {
      // In shadowing/simultaneous modes, stopping the video stops the recording
      if (practiceRecording) {
        // Capture the exact timestamp where the player paused
        recordingEndSec = ytPlayer.getCurrentTime?.() || 0;
        // Stop the active practice recording
        stopPracticeRecording();
        // Auto-analyze after transcription completes
        autoAnalyzeAfterPause();
      }
    } else if (currentMode === 'consecutive' || currentMode === 'opi') {
      // In consecutive/OPI modes, pausing means the user should start interpreting
      if (!practiceRecording) {
        // Record the timestamp where the source speech paused
        recordingStartSec = ytPlayer.getCurrentTime?.() || 0;
        // Update the UI to prompt the user to interpret
        setPlaybackStatus('Your turn — interpret now');
        // Show the resume button so the user can continue after interpreting
        document.getElementById('resume-btn').style.display = 'block';
        // Start recording the user's interpretation after a short UI delay
        setTimeout(() => scheduledStartRecording(), 400);
      }
    }

  // Check if the new state is ENDED (code 0)
  } else if (e.data === 0) { // ENDED
    // Update global playback flag
    isPlaying = false;
    // Reflect the ended state in the play/pause button icon
    updatePlayBtn(false);
    // Cancel any pending speech-start timer since the video is over
    clearTimeout(speechStartTimer);
    // If still recording when the video ends, finalize the recording
    if (practiceRecording) {
      // Capture the final timestamp at video end
      recordingEndSec = ytPlayer.getCurrentTime?.() || 0;
      // Stop the active practice recording
      stopPracticeRecording();
      // Trigger post-recording analysis
      autoAnalyzeAfterPause();
    }
    // Update the UI to inform the user that the session is complete
    setPlaybackStatus('Video ended — see your results on the right');
  }
}


/**
 * @description Displays a status message in the segment-hint element.
 * @param   {string} msg — The message text to display.
 * @returns {void}
 */
function setPlaybackStatus(msg) {
  // Locate the segment-hint DOM element
  const el = document.getElementById('segment-hint');
  // If the element exists, set its text content to the provided message
  if (el) el.textContent = msg;
}


/**
 * @description Updates the play/pause button icon based on the current playback state.
 * @param   {boolean} playing — True if the video is currently playing; false otherwise.
 * @returns {void}
 */
function updatePlayBtn(playing) {
  // Locate the play/pause icon element
  const icon = document.getElementById('play-pause-icon');
  // If found, set the icon to pause (⏸) when playing or play (▶) when paused
  if (icon) icon.textContent = playing ? '⏸' : '▶';
}


/**
 * @description Toggles the YouTube player between play and pause.
 *              Guards against calls when the player is not yet initialized.
 * @returns {void}
 */
function togglePlayPause() {
  // Exit early if no YouTube player instance exists
  if (!ytPlayer) return;
  // If currently playing, pause; otherwise play
  isPlaying ? ytPlayer.pauseVideo() : ytPlayer.playVideo();
}


/**
 * @description Sets the YouTube player volume and updates the volume slider UI.
 *              Mutes the player if the value is 0; unmutes otherwise.
 * @param   {string|number} val — The desired volume level (0–100).
 * @returns {void}
 */
function setVolume(val) {
  // Parse the incoming value as an integer
  const v = parseInt(val);
  // Only interact with the player if it has been initialized
  if (ytPlayer) {
    // If volume is 0, mute the player and update the muted flag
    if (v === 0) { ytPlayer.mute(); isMuted = true; }
    // Otherwise unmute and set the numeric volume level
    else { ytPlayer.unMute(); ytPlayer.setVolume(v); isMuted = false; }
  }
  // Locate the volume slider element for visual feedback
  const slider = document.getElementById('volume-slider');
  // If the slider exists, update its background gradient to reflect the current volume
  if (slider) slider.style.background =
  `linear-gradient(to right,rgba(255,255,255,.9) ${v}%,rgba(255,255,255,.2) ${v}%)`;
}


/**
 * @description Toggles the mute state of the YouTube player.
 *              Saves the previous slider value to restore later and syncs the slider UI.
 * @returns {void}
 */
function toggleMute() {
  // Exit early if no YouTube player instance exists
  if (!ytPlayer) return;
  // Locate the volume slider element to read/store its value
  const slider = document.getElementById('volume-slider');
  // Flip the global muted flag
  isMuted = !isMuted;
  // If muting, store the current slider value and set volume to 0
  if (isMuted) {
    ytPlayer.mute();
    if (slider) { slider.dataset.prev = slider.value; slider.value = 0; }
    setVolume(0);
  } else {
    // If unmuting, restore the previous slider value (defaulting to 100 if none stored)
    ytPlayer.unMute();
    const prev = slider?.dataset.prev || '100';
    if (slider) { slider.value = prev; }
    setVolume(parseInt(prev));
  }
}


/**
 * @description Resumes video playback from a paused segment.
 *              Hides the resume button, clears status text, stops any active recording,
 *              and restarts the video after a brief delay.
 * @returns {void}
 */
function resumeFromSegment() {
  // Hide the resume button since the user has chosen to continue
  document.getElementById('resume-btn').style.display = 'none';
  // Clear any playback status message in the hint area
  setPlaybackStatus('');
  // If a practice recording is still active, stop it before resuming
  if (practiceRecording) stopPracticeRecording();
  // Wait 500ms before resuming so the UI can settle and recording can finalize
  setTimeout(() => {
    // Ensure the player exists before attempting playback
    if (ytPlayer) {
      // Cache the timestamp where the user last paused (fallback to lastPausedAt if API fails)
      lastPausedAt = ytPlayer.getCurrentTime?.() || lastPausedAt;
      // Resume video playback
      ytPlayer.playVideo();
    }
  }, 500);
}

// Pre-request mic permission so auto-recording works without gesture gate
/**
 * @description Holds the pre-warmed MediaStream from getUserMedia.
 *              Declared outside functions so multiple calls can reuse or release it.
 * @type {MediaStream|null}
 */
let micStream = null;

/**
 * @description Injects caption source text into the source-text textarea for a given time window.
 *              Filters captionEvents to the range [startSec-1, endSec+1],
 *              deduplicates adjacent identical lines, and joins them with spaces.
 * @param   {number} startSec — The start timestamp of the segment (seconds).
 * @param   {number} endSec   — The end timestamp of the segment (seconds).
 * @returns {void}
 */
function injectCaptionSource(startSec, endSec) {
  // If no caption events have been loaded, there is nothing to inject
  if (!captionEvents.length) return;
  // Expand the window by 1 second on each side to catch nearby captions
  const window_start = Math.max(0, startSec - 1);
  // If endSec is valid and after startSec, expand by 1 second; otherwise use a 60-second fallback
  const window_end = endSec > startSec ? endSec + 1 : startSec + 60;
  // Filter caption events to the computed time window and extract their text
  const lines = captionEvents
  .filter(e => e.t >= window_start && e.t <= window_end)
  .map(e => e.text)
  // Remove any falsy (empty/undefined) text entries
  .filter(Boolean);
  // If no lines survive filtering, nothing to inject
  if (!lines.length) return;
  // Deduplicate adjacent identical lines to avoid repetition in the source text
  const unique = lines.filter((l, i) => i === 0 || l !== lines[i-1]);
  // Locate the source-text textarea where the caption source should appear
  const sourceEl = document.getElementById('source-text');
  // If the element exists, populate it with the deduplicated caption text
  if (sourceEl) sourceEl.value = unique.join(' ');
}


/**
 * @description Starts practice recording at the current player time.
 *              Guards against duplicate calls if already recording.
 * @returns {Promise<void>}
 */
async function scheduledStartRecording() {
  // Prevent starting a second recording if one is already in progress
  if (practiceRecording) return;
  // Capture the exact current playback time as the recording start timestamp
  recordingStartSec = ytPlayer?.getCurrentTime?.() || 0;
  // Await the actual recording initialization
  await startPracticeRecording();
}

// After recording stops: 3 parallel steps then analyze

/**
 * @description Orchestrates the post-pause analysis workflow:
 *              1) Injects caption source text for the recorded segment.
 *              2) Polls for Whisper transcription (up to 10 s).
 *              3) Calls analyzeInterpretation() once both source and rendition are ready.
 *              Updates the analyzing-state UI throughout.
 * @returns {Promise<void>}
 */
async function autoAnalyzeAfterPause() {
  // Show status
  // Locate the analyzing-state UI element
  const analyzing = document.getElementById('analyzing-state');
  // If the element exists, make it visible and display the transcription message
  if (analyzing) {
    analyzing.style.display = 'block';
    analyzing.innerHTML = '<div style="font-weight:600;color:var(--gold)">Processing — transcribing video segment and your recording...</div>';
  }

  // Step 1: Extract caption text for the recorded segment (instant — local data)
  // Populate the source-text area with captions from the recorded time window
  injectCaptionSource(recordingStartSec, recordingEndSec);
  // Read back the injected caption text (empty string if element is missing)
  const captionText = document.getElementById('source-text')?.value || '';

  // Step 2: Wait for Whisper transcription of recording (max 10s)
  // Initialize a millisecond counter for the polling timeout
  let waited = 0;
  // Poll every 300 ms until transcription appears or 10 s elapse
  while (waited < 10000) {
    // Sleep for 300 ms before checking again
    await new Promise(r => setTimeout(r, 300));
    // Accumulate elapsed wait time
    waited += 300;
    // Read the current value of the interpretation transcript textarea
    const t = document.getElementById('interp-transcript')?.value?.trim();
    // If a transcript with more than 3 characters is found, stop polling
    if (t && t.length > 3) break;
  }

  // Capture the final rendition text after polling completes
  const rendition = document.getElementById('interp-transcript')?.value?.trim();

  // Update the analyzing-state UI to indicate comparison is underway
  if (analyzing) {
    analyzing.innerHTML = '<div style="font-weight:600;color:var(--gold)">Comparing and evaluating your performance...</div>';
  }

  // If no rendition was produced, hide the spinner and reveal the manual transcript area
  if (!rendition) {
    if (analyzing) analyzing.style.display = 'none';
    document.getElementById('interp-transcript-area').style.display = 'block';
    return;
  }

  // Step 3: Analyze using segment-specific caption text as source
  // If no caption text exists and the mode is shadowing, inject a fallback message
  if (!captionText && currentMode === 'shadowing') {
    // No captions available — still analyze delivery
    document.getElementById('source-text').value =
      '[No caption data — evaluate delivery quality only]';
  }

  // Trigger the interpretation analysis (source vs. rendition)
  analyzeInterpretation();
}


/**
 * @description Pre-warms the microphone by requesting getUserMedia audio access.
 *              Stores the resulting MediaStream in micStream for later reuse.
 *              Updates the vm-status-text UI to reflect mic readiness or denial.
 * @returns {Promise<void>}
 */
async function warmMicrophone() {
  try {
    // If a mic stream already exists, stop all its tracks and clear the reference
    if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
    // Request audio-only access from the browser's media devices
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Keep stream alive — reuse it in startRecording
    // Update the status text to show the microphone is ready
    document.getElementById('vm-status-text').innerHTML = 'Mic ready';
    // Change the status color to green to indicate success
    document.getElementById('vm-status-text').style.color = 'var(--green)';
    // After 2 seconds, revert the status text to "Not recording" if it hasn't changed
    setTimeout(() => {
      const el = document.getElementById('vm-status-text');
      if (el && el.textContent === 'Mic ready') { el.innerHTML = 'Not recording'; el.style.color = 'var(--dim)'; }
    }, 2000);
  } catch(e) {
    // Log the mic permission denial for debugging
    console.warn('Mic permission denied:', e);
    // Update the status text to warn the user that the mic is blocked
    document.getElementById('vm-status-text').innerHTML = 'Warning: Mic blocked';
    // Change the status color to red to indicate an error condition
    document.getElementById('vm-status-text').style.color = 'var(--red)';
  }
}


/**
 * @description Begins a practice recording session.
 *              Updates UI indicators (rec-dot, rec-wave-card, status text)
 *              and delegates to startRecording('interp').
 *              Catches and surfaces microphone errors.
 * @returns {Promise<void>}
 */
async function startPracticeRecording() {
  // Guard against duplicate recording starts
  if (practiceRecording) return;
  // Set the global recording flag to true
  practiceRecording = true;
  // Show the recording dot indicator
  document.getElementById('rec-dot').style.display = 'flex';
  // Show the recording waveform card
  document.getElementById('rec-wave-card').style.display = 'block';
  // Locate the visual-mic status text element
  const vm = document.getElementById('vm-status-text');
  // If the element exists, render an animated "Recording" indicator
  if (vm) vm.innerHTML = '<span class="rec-indicator" style="width:8px;height:8px;flex-shrink:0"></span><span style="animation:blink 1s infinite;color:var(--red);font-weight:700">Recording</span>';
  try {
    // Start the actual media recorder for the 'interp' track
    await startRecording('interp');
  } catch(err) {
    // Log any recording failure for debugging
    console.error('Recording failed:', err);
    // Reset the recording flag since recording did not start
    practiceRecording = false;
    // Hide the recording dot indicator
    document.getElementById('rec-dot').style.display = 'none';
    // Locate the status text element again for error display
    const vm2 = document.getElementById('vm-status-text');
    // If found, display the error message in red
    if (vm2) vm2.innerHTML = `<span style="color:var(--red)">Mic error: ${err.message}</span>`;
  }
}

// Extract caption text for the recorded time window and inject as source

/**
 * @description Stops the active practice recording.
 *              Hides recording UI indicators, updates status to "Processing…",
 *              and delegates to stopRecording('interp').
 * @returns {void}
 */
function stopPracticeRecording() {
  // Clear the global recording flag
  practiceRecording = false;
  // Hide the recording dot indicator
  document.getElementById('rec-dot').style.display = 'none';
  // Hide the recording waveform card
  document.getElementById('rec-wave-card').style.display = 'none';
  // Locate the visual-mic status text element
  const vm = document.getElementById('vm-status-text');
  // If the element exists, show a processing message in amber
  if (vm) vm.innerHTML = '<span style="color:var(--amber)">Processing…</span>';
  // Stop the underlying media recorder for the 'interp' track
  stopRecording('interp');
}

/**
 * @description Lookup table mapping language names to arrays of [code, displayLabel] pairs.
 *              Used for dialect/variant selection in the UI.
 * @const {Object<string, Array<Array<string>>>}
 */
const DIALECTS = {
  English: [['US','United States'],['UK','United Kingdom'],['AU','Australia'],['CA','Canada'],['IN','India'],['ZA','South Africa']],
  Arabic: [['MSA','Modern Standard (فصحى)'],['EG','Egyptian'],['Gulf','Gulf'],['Levantine','Levantine'],['Moroccan','Moroccan']],
  French: [['FR','France'],['CA','Canada (Québec)'],['BE','Belgium'],['CH','Switzerland']],
  Spanish: [['ES','Spain'],['MX','Mexico'],['AR','Argentina'],['CO','Colombia']],
  German: [['DE','Germany'],['AT','Austria'],['CH','Switzerland']],
  Chinese: [['Mandarin','Mandarin (普通话)'],['Cantonese','Cantonese'],['TW','Taiwan']],
  Russian: [['RU','Russia'],['UA','Ukraine'],['BY','Belarus']],
  Portuguese: [['BR','Brazil'],['PT','Portugal'],['AO','Angola']],
};
