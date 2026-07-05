/**
 * @module modes/consecutive.js
 * @description Consecutive Interpreting — auto/manual pause, silence gap detection, segment polling
 *
 * MAD Training Studio — Interpretation Practice Platform
 * © 2025 InterpretLab. All rights reserved.
 */

/**
 * @description Toggles the pause mode between manual and auto-pause.
 *              Updates the button UI, status text, and starts or stops
 *              the polling loop accordingly.
 * @param {HTMLButtonElement} btn - The pause-mode toggle button element.
 * @returns {void}
 */
function togglePauseMode(btn) {
  // Toggle the global manual-pause flag between true and false
  manualPauseMode = !manualPauseMode;

  // Update button label to reflect the new mode
  btn.textContent = manualPauseMode ? 'Manual pause' : 'Auto-pause';

  // Apply amber color for manual mode, green for auto mode
  btn.style.color = manualPauseMode ? 'var(--amber)' : 'var(--green)';

  // Set descriptive tooltip text based on the active mode
  btn.title = manualPauseMode
    ? 'You control when to pause — click the video to start interpreting'
    : 'Video auto-pauses at natural speech breaks';

  // Handle state transitions after the toggle
  if (manualPauseMode) {
    // Stop any running auto-pause polling when switching to manual
    stopPausePolling();
    // Display status message so the user knows manual mode is active
    setPlaybackStatus('Manual mode — pause the video when you are ready to interpret');
  } else {
    // Resume auto-pause polling only if the video is currently playing
    if (isPlaying) startPausePolling();
  }
}


/**
 * @description Determines whether a given timestamp falls inside any detected
 *              silence gap, with a 0.3-second margin on both sides.
 * @param {number} timeSec - The current playback time in seconds.
 * @returns {boolean} True if the timestamp lies within a silence gap.
 */
function isInSilenceGap(timeSec) {
  // Iterate through all silence gaps and check if timeSec overlaps any of them
  return silenceGaps.some(g => timeSec >= g.start - 0.3 && timeSec <= g.end + 0.3);
}


/**
 * @description Checks whether the speaker is considered "currently speaking"
 *              at the provided timestamp by looking at caption events.
 *              Defaults to true when no caption data is available.
 * @param {number} timeSec - The current playback time in seconds.
 * @returns {boolean} True if an active caption event is near the timestamp.
 */
function isCurrentlySpeaking(timeSec) {
  // If no caption events exist, assume continuous speech to avoid false pauses
  if (!captionEvents.length) return true; // assume speech if no captions

  // Check if any caption event is within 1.8 seconds of the current time
  return captionEvents.some(e => Math.abs(e.t - timeSec) < 1.8);
}


/**
 * @description Starts the periodic polling interval that monitors playback
 *              time and triggers auto-pause or natural-silence recording.
 *              Handles both "natural pause" mode (silence gaps) and
 *              "auto-pause" mode (speech-accumulation or AI pause points).
 * @returns {void}
 */
function startPausePolling() {
  // Clear any existing polling interval to prevent duplicate timers
  stopPausePolling();

  // Abort if manual mode is active or the YouTube player is not ready
  if (manualPauseMode || !ytPlayer) return;

  // Reset the accumulated speech-time counter for auto-pause mode
  speechAccumulator  = 0;

  // Reset the natural-silence state flag
  inNaturalSilence   = false;

  // Capture the player's current time as the baseline for the next tick
  lastPollPlayerTime = ytPlayer.getCurrentTime?.() || 0;

  // Create a recurring interval that fires every 300 ms
  pausePollingInterval = setInterval(() => {
    // Skip this tick if the player is missing, playback is stopped, or manual mode is on
    if (!ytPlayer || !isPlaying || manualPauseMode) return;

    // Read the player's current timestamp (fallback to 0 if unavailable)
    const now = ytPlayer.getCurrentTime?.() || 0;

    // Calculate elapsed time since last poll, clamped between 0 and 0.6 seconds
    const dt  = Math.max(0, Math.min(now - lastPollPlayerTime, 0.6));

    // Update the baseline timestamp for the next interval tick
    lastPollPlayerTime = now;

    // ══ NATURAL PAUSE MODE — video has built-in silence gaps ══════
    if (pauseMode === 'natural' && silenceGaps.length > 0) {
      // Find the silence gap that currently overlaps the playback position
      const activeGap = silenceGaps.find(g => now >= g.start - 0.3 && now <= g.end + 0.3);

      // Convert the gap lookup result to a boolean presence flag
      const inGap = !!activeGap;

      if (inGap && !inNaturalSilence && !practiceRecording) {
        // ── Silence started — begin recording immediately (no pause needed) ──
        // Mark that we have entered a natural silence period
        inNaturalSilence = true;

        // Record the timestamp when this silence gap began
        recordingStartSec = now;

        // Compute the gap duration for display (round to nearest second)
        const gapSec = activeGap ? Math.round(activeGap.duration || (activeGap.end - activeGap.start)) : '?';

        // Notify the user that it is their turn to interpret within this window
        setPlaybackStatus(`Your turn — ${gapSec}s to render`);

        // Update the on-screen hint with the gap duration
        updatePauseHint(`Interpreting — ${gapSec}s window`, 0);

        // Trigger the actual practice recording logic
        scheduledStartRecording();

      } else if (inGap && inNaturalSilence && activeGap) {
        // ── Still in gap — show countdown of remaining time in this window ──
        // Calculate how many seconds remain before speech resumes
        const remaining = Math.max(0, Math.round(activeGap.end - now));

        // Locate the DOM element used for segment hints
        const hint = document.getElementById('segment-hint');

        // Refresh the hint text with a live countdown while recording
        if (hint && remaining > 0) {
          hint.innerHTML = `<span style="color:var(--red);font-weight:700"> REC</span> <span style="color:var(--dim)">${remaining}s remaining</span>`;
        }

      } else if (!inGap && inNaturalSilence) {
        // ── Speech resumed — stop recording and analyze ──
        // Clear the natural-silence flag since the gap has ended
        inNaturalSilence  = false;

        // Record the timestamp when speech resumed
        recordingEndSec   = now;

        // If the user was recording, stop the recording and run analysis
        if (practiceRecording) {
          stopPracticeRecording();
          autoAnalyzeAfterPause();
        }

        // Clear the playback status message
        setPlaybackStatus('');
      }

      // Show countdown to NEXT gap when not currently recording
      if (!inNaturalSilence) {
        // Look for the first upcoming silence gap that starts more than 1 second from now
        const nextGap = silenceGaps.find(g => g.start > now + 1);

        if (nextGap) {
          // Compute seconds until the next gap begins
          const secs = Math.max(0, Math.round(nextGap.start - now));

          // Compute the duration of that upcoming gap
          const dur  = Math.round(nextGap.duration || (nextGap.end - nextGap.start));

          // Locate the hint DOM element
          const hint = document.getElementById('segment-hint');

          // Display a countdown preview of the next interpreting window
          if (hint) hint.innerHTML = `<span style="color:var(--dim)">Your turn in <strong style="color:var(--gold)">${secs}s</strong> — <span style="color:var(--teal)">${dur}s window</span></span>`;
        }
      }

      // Nothing more to do in natural-pause mode this tick
      return;
    }

    // ══ AUTO-PAUSE MODE — count speech seconds, not timestamp seconds ══
    // Determine whether the speaker is currently active at this timestamp
    const speaking = isCurrentlySpeaking(now);

    // Accumulate elapsed time only when the speaker is active
    if (speaking) speechAccumulator += dt;

    // Check AI pause points first (most accurate)
    if (videoPausePoints.length > 0) {
      // Search for a pause point that has not been used recently and is within range
      const reached = videoPausePoints.find(
        p => p.time_sec > lastPausedAt + 3 && p.time_sec <= now && p.time_sec > now - 0.8
      );

      if (reached) {
        // Reset the speech accumulator because we are pausing now
        speechAccumulator = 0;

        // Mark this timestamp as the most recent pause so we do not re-trigger
        lastPausedAt = now;

        // Show the AI-generated label (e.g., "topic break") in the hint area
        updatePauseHint(reached.label || 'topic break', 0);

        // Command the YouTube player to pause playback
        ytPlayer.pauseVideo();

        // Wait until the next interval tick after pausing
        return;
      }

      // Find the next upcoming AI pause point more than 1 second away
      const next = videoPausePoints.find(p => p.time_sec > now + 1);

      if (next) {
        // Compute how many seconds remain until that next pause point
        const secs = Math.max(0, Math.round(next.time_sec - now));

        // Update the hint to preview the upcoming break
        updatePauseHint(next.label || 'next break', secs);
      }

      // In AI-point mode we do not fall through to the speech-threshold logic
      return;
    }

    // Fallback: pause after avgSpeechSec of actual speech
    // Use the server-provided average speech duration, defaulting to 20 seconds
    const speechThreshold = avgSpeechSec || 20;

    // Calculate how much speech time remains before triggering auto-pause
    const remaining = Math.max(0, Math.round(speechThreshold - speechAccumulator));

    if (remaining <= 0) {
      // Speech threshold reached — trigger auto-pause
      speechAccumulator = 0;      // Reset accumulator for the next segment
      lastPausedAt = now;         // Remember when we paused
      updatePauseHint('', 0);     // Clear the countdown hint
      ytPlayer.pauseVideo();      // Pause the video
    } else {
      // Threshold not yet reached — show the countdown to the user
      const hint = document.getElementById('segment-hint');
      if (hint) hint.textContent = `Pause after ${remaining}s of speech`;
    }
  }, 300); // Poll every 300 milliseconds for responsive pause detection
}


/**
 * @description Clears the active pause-polling interval and nulls the handle
 *              to prevent memory leaks and duplicate timers.
 * @returns {void}
 */
function stopPausePolling() {
  // Cancel the recurring interval if one is active
  clearInterval(pausePollingInterval);

  // Clear the handle so isRunning checks or restart logic work correctly
  pausePollingInterval = null;
}


/**
 * @description Updates the on-screen hint element that tells the user when
 *              the next pause will occur or that a pause is happening now.
 * @param {string} label - Descriptive label for the upcoming pause (e.g., "topic break").
 * @param {number} secsLeft - Seconds remaining until the pause; 0 or less means "pausing now".
 * @returns {void}
 */
function updatePauseHint(label, secsLeft) {
  // Locate the hint DOM element in the session UI
  const hint = document.getElementById('segment-hint');

  // Guard against a missing element (e.g., page not fully loaded)
  if (!hint) return;

  if (secsLeft <= 0) {
    // No time left — display the "pausing now" message in amber
    hint.innerHTML = `<span style="color:var(--amber);font-weight:600">Pausing — your turn</span>`;
  } else {
    // Show countdown preview with the provided label
    hint.innerHTML = `<span style="color:var(--dim)">Next: <strong style="color:var(--text)">${label}</strong> in ${secsLeft}s</span>`;
  }
}


/**
 * @description Sends the current video metadata to the backend for structural
 *              analysis, then stores the returned pause points, segments,
 *              silence gaps, caption events, and difficulty metadata.
 *              Also updates the pause-mode badge and session-header badge.
 * @param {string} videoId - The YouTube video identifier.
 * @param {string} mode    - The practice mode (e.g., "consecutive" or "opi").
 * @param {string} field   - The professional field (e.g., "medical", "legal").
 * @param {string} title   - The video title shown in the UI.
 * @returns {Promise<void>}
 */
async function analyzeVideoStructure(videoId, mode, field, title) {
  // Show analysis status in segment hint so the user knows work is in progress
  const hint = document.getElementById('segment-hint');
  if (hint) hint.innerHTML = '<span style="color:var(--dim)">Analyzing video structure…</span>';

  // Build a FormData payload with the video metadata required by the API
  const fd = new FormData();
  fd.append('video_id', videoId);
  fd.append('mode', mode);
  fd.append('field', field);
  fd.append('title', title);

  try {
    // POST the metadata to the video-structure analysis endpoint
    const r = await fetch('/api/analyze-video-structure', { method: 'POST', body: fd });

    // Parse the JSON response from the server
    const d = await r.json();

    // If the server reports an error, clear the hint and abort
    if (d.error) { if (hint) hint.textContent = ''; return; }

    // Store pause points for the player, sorted chronologically by time_sec
    videoPausePoints  = (d.pause_points || []).sort((a,b) => a.time_sec - b.time_sec);

    // Store the full segment list returned by the analyzer
    videoSegments     = d.segments    || [];

    // Record the timestamp where speech begins (used for alignment)
    speechStartSec    = d.speech_start_sec || 0;

    // Cache caption events for the isCurrentlySpeaking helper
    captionEvents     = d.caption_events   || [];

    // Store silence gaps sorted by start time for natural-pause mode
    silenceGaps       = (d.silence_gaps    || []).sort((a,b) => a.start - b.start);

    // Choose the pause mode: "natural" if silence gaps exist, otherwise "auto"
    pauseMode         = d.pause_mode       || 'auto';

    // Store the recommended average speech duration per segment
    avgSpeechSec      = d.avg_speech_sec   || 20;

    // Reset the speech accumulator so auto-pause starts from a clean state
    speechAccumulator = 0;

    // Reset the natural-silence flag until the next gap is entered
    inNaturalSilence  = false;

    // ── Update pause mode badge ──
    const pmBtn = document.getElementById('pause-mode-btn');

    // Only adjust the pause-mode badge when the mode supports auto-pause behavior
    if (pmBtn && (mode === 'consecutive' || mode === 'opi')) {
      if (pauseMode === 'natural') {
        // Natural pause mode: display teal badge with gap count
        pmBtn.textContent = 'Natural pauses';
        pmBtn.style.color = 'var(--teal)';
        pmBtn.style.borderColor = 'var(--teal)';
        pmBtn.title = `Video has ${silenceGaps.length} built-in silence gaps — recording activates automatically during silence`;
      } else {
        // Auto-pause mode: display green badge with speech-duration info
        pmBtn.textContent = 'Auto-pause';
        pmBtn.style.color = 'var(--green)';
        pmBtn.style.borderColor = 'var(--green)';
        pmBtn.title = `No built-in pauses detected — video will auto-pause after ${avgSpeechSec}s of speech`;
      }
    }

    // ── Show video type + suitability badge in session header ──
    const diffBadge = document.getElementById('session-diff-badge');
    if (diffBadge) {
      // Map the raw video_type enum to human-readable labels
      const typeLabel = {
        opi_call_simulation:'OPI Simulation', conference_speech:'Conference',
        press_conference:'Press Conf', un_address:'UN Address',
        medical_briefing:'Medical', legal_proceeding:'Legal',
        news_broadcast:'Broadcast', lecture:'Lecture',
        documentary:'Documentary', interview:'Interview',
        parliamentary_debate:'Parliament'
      }[d.video_type] || '';

      // Map difficulty tiers to CSS color variables for visual theming
      const diffColors = { Beginner:'var(--green)', Intermediate:'var(--gold)', Advanced:'var(--amber)', Expert:'var(--red)', Professional:'var(--purple)' };

      // Resolve the difficulty color, falling back to a dim neutral tone
      const diffColor = diffColors[d.difficulty] || 'var(--dim)';

      // Extract the suitability score (0–100) for this video
      const score = d.suitability_score || 0;

      // Choose a color for the score based on its value: green >= 80, gold >= 60, otherwise amber
      const scoreColor = score >= 80 ? 'var(--green)' : score >= 60 ? 'var(--gold)' : 'var(--amber)';

      // Pull out the per-dimension difficulty scores for mini bar charts
      const scores = d.difficulty_scores || {};

      // Helper lambda that generates a tiny inline bar given a value and maximum
      const scoreBar = (val, max=10) => `<div style="display:inline-block;width:${Math.round(val/max*40)}px;height:3px;background:var(--gold);border-radius:2px;vertical-align:middle"></div>`;

      // Inject the fully-assembled badge HTML into the session header
      diffBadge.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
          <div style="display:flex;align-items:center;gap:8px">
            ${typeLabel ? `<span style="background:var(--bg3);border:1px solid var(--border);padding:3px 9px;border-radius:10px;font-size:11px;color:var(--teal);font-weight:600">${typeLabel}</span>` : ''}
            ${d.difficulty ? `<span style="font-size:12px;font-weight:800;color:${diffColor}" title="${d.difficulty_reason||''}">${d.difficulty}</span>` : ''}
            ${d.wpm_actual ? `<span style="font-size:11px;color:var(--dim)">${d.wpm_actual} wpm</span>` : ''}
            <span style="font-size:11px;font-weight:700;color:${scoreColor}" title="Suitability for ${mode}">${score}/100</span>
          </div>
          ${scores.overall ? `<div style="display:flex;gap:8px;font-size:10px;color:var(--dim)">
            <span title="Pace">Pace ${scoreBar(scores.pace_score||0)}</span>
            <span title="Vocabulary">Vocab ${scoreBar(scores.vocabulary_score||0)}</span>
            <span title="Information density">Density ${scoreBar(scores.density_score||0)}</span>
          </div>` : ''}
        </div>`;
    }

    // ── Update segment hint ──
    if (hint) {
      // Only show mode-specific hints for consecutive or OPI practice modes
      if (mode === 'consecutive' || mode === 'opi') {
        if (d.pause_mode === 'natural' && silenceGaps.length > 0) {
          // Inform the user that natural silence gaps were found and auto-recording is enabled
          hint.innerHTML = `<span style="color:var(--teal)">Done ${silenceGaps.length} built-in silence gaps detected — recording activates automatically</span>`;
        } else if (videoPausePoints.length > 0) {
          // Inform the user that AI pause points were found
          hint.innerHTML = `<span style="color:var(--green)">Done ${videoPausePoints.length} AI pause points — pauses after ~${avgSpeechSec}s of speech</span>`;
        } else {
          // Fallback hint when no structural data is available
          hint.textContent = `Auto-pause after ${avgSpeechSec}s of speech — press Play`;
        }
      } else {
        // For other modes, show the suitability reason if provided
        hint.textContent = d.suitability_reason || '';
      }
    }

    // ── Warn if video is meta/tutorial content ──
    if (d.is_authentic_source === false) {
      // Create a warning banner element dynamically
      const warn = document.createElement('div');

      // Style the banner with amber-themed background and border
      warn.style.cssText = 'background:rgba(232,151,30,.07);border:1px solid var(--amber);border-radius:8px;padding:10px 14px;font-size:12px;color:var(--amber);margin-top:10px';

      // Set the warning text from the server note or use a generic default
      warn.textContent = `Warning: ${d.authenticity_note || 'This video may be about interpreting rather than authentic source material.'}`;

      // Insert the warning immediately after the session video title element
      document.getElementById('session-video-title').insertAdjacentElement('afterend', warn);
    }

  } catch(e) {
    // On network or parsing failure, quietly clear the hint so the UI is not stuck
    if (hint) hint.textContent = '';
  }
}
