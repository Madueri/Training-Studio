/**
 * @module shared/recording.js
 * @description Audio recording, waveform visualization, speech generation, interpretation analysis
 *
 * InterpLing — Interpretation Practice Platform
 * © 2025 InterpLing. All rights reserved.
 */

/**
 * @description Starts an audio recording session for the specified target mode.
 *              Initializes the MediaRecorder, captures audio chunks, sets up a live
 *              waveform analyser, and manages the recording UI state and timer.
 * @param {string} target - The recording target identifier: 'interp' for interpretation
 *                          mode or 'vo' for voice-over mode.
 * @returns {Promise<void>}
 */
async function startRecording(target) {
	// Store the current recording target globally for downstream logic (e.g., LUFS estimation).
	recordingTarget = target;

	// Reset the audio chunks buffer for the new recording session.
	audioChunks = [];

	// Reset the elapsed recording timer to zero seconds.
	timerSeconds = 0;

	// ------------------------------------------------------------------
	// Acquire or reuse the microphone audio stream
	// ------------------------------------------------------------------
	let stream; // Local variable to hold the MediaStream for this session
	try {
		// Reuse an existing active mic stream if available to avoid redundant permission prompts.
		stream = (micStream && micStream.active) ? micStream : await navigator.mediaDevices.getUserMedia({ audio: true });
		// Persist the stream in the module-level variable for future recordings.
		micStream = stream;
	} catch (e) {
		// Fallback: if the cached stream failed, request a fresh one unconditionally.
		stream = await navigator.mediaDevices.getUserMedia({ audio: true });
	}

	// Instantiate a MediaRecorder to capture audio data from the microphone stream.
	mediaRecorder = new MediaRecorder(stream);

	// Accumulate audio data chunks as they become available during recording.
	mediaRecorder.ondataavailable = e => {
		if (e.data.size > 0) {
			audioChunks.push(e.data);
		}
	};

	// When recording stops, assemble the chunks into a Blob and route to the correct handler.
	mediaRecorder.onstop = () => {
		// Combine all captured chunks into a single WebM audio Blob.
		const blob = new Blob(audioChunks, { type: 'audio/webm' });

		// Route the resulting Blob to the appropriate downstream handler based on target.
		if (target === 'interp') {
			interpBlob = blob;          // Store for interpretation analysis
			onInterpRecordingDone();    // Trigger transcription and UI updates
		}
		if (target === 'vo') {
			voBlob = blob;              // Store for voice-over analysis
			onVORecordingDone();        // Trigger transcription and UI updates
		}
	};

	// Start recording; pass a 100ms timeslice so ondataavailable fires frequently.
	mediaRecorder.start(100);

	// ------------------------------------------------------------------
	// Live waveform analyser setup
	// ------------------------------------------------------------------
	try {
		// Create a new Web Audio API context for real-time frequency analysis.
		const ctx = new AudioContext();

		// Create a media stream source node from the microphone stream.
		const src = ctx.createMediaStreamSource(stream);

		// Create an analyser node to extract frequency-domain data for visualization.
		analyserNode = ctx.createAnalyser();
		analyserNode.fftSize = 256; // Determines frequency bin resolution

		// Connect the microphone source to the analyser (audio path, no output needed).
		src.connect(analyserNode);

		// Begin drawing the live waveform bars in the DOM element matching 'wave-<target>'.
		drawWaveform('wave-' + target);
	} catch (e) {
		// Silently ignore AudioContext failures (e.g., user blocked or unsupported).
	}

	// ------------------------------------------------------------------
	// UI state transitions — guard every DOM element before mutating
	// ------------------------------------------------------------------
	const idleEl = document.getElementById('rec-idle-' + target); // Idle-state container
	const actEl  = document.getElementById('rec-active-' + target); // Active-state container
	const zoneEl = document.getElementById('rec-zone-' + target);   // Recording zone wrapper

	// Hide the idle UI state.
	if (idleEl) idleEl.style.display = 'none';

	// Show the active/recording UI state.
	if (actEl) actEl.style.display = 'block';

	// Add a CSS class to the zone to indicate an active recording session.
	if (zoneEl) zoneEl.classList.add('recording');

	// ------------------------------------------------------------------
	// Elapsed-time timer (updates every second)
	// ------------------------------------------------------------------
	timerInterval = setInterval(() => {
		// Increment the elapsed seconds counter.
		timerSeconds++;

		// Compute minutes and seconds from the total elapsed time.
		const m = Math.floor(timerSeconds / 60);
		const s = timerSeconds % 60;

		// Locate the timer display element for this target.
		const timerEl = document.getElementById('timer-' + target);

		// Update the timer text with zero-padded seconds (e.g., "1:05").
		if (timerEl) timerEl.textContent = m + ':' + String(s).padStart(2, '0');
	}, 1000);
}


/**
 * @description Stops the active MediaRecorder, halts the waveform animation,
 *              clears the timer interval, and restores the idle UI state.
 * @param {string} target - The recording target identifier: 'interp' or 'vo'.
 * @returns {void}
 */
function stopRecording(target) {
	// Stop the MediaRecorder if it exists and is not already in the 'inactive' state.
	if (mediaRecorder && mediaRecorder.state !== 'inactive') {
		mediaRecorder.stop();
	}

	// Halt the one-second timer interval to prevent further elapsed-time updates.
	clearInterval(timerInterval);

	// Cancel the waveform animation frame loop to stop visualizer updates.
	cancelAnimationFrame(waveAnimFrame);

	// ------------------------------------------------------------------
	// UI state restoration — guard every DOM element before mutating
	// ------------------------------------------------------------------
	const idleEl = document.getElementById('rec-idle-' + target); // Idle-state container
	const actEl  = document.getElementById('rec-active-' + target); // Active-state container
	const zoneEl = document.getElementById('rec-zone-' + target);   // Recording zone wrapper

	// Show the idle UI state.
	if (idleEl) idleEl.style.display = 'block';

	// Hide the active/recording UI state.
	if (actEl) actEl.style.display = 'none';

	// Remove the recording CSS class from the zone wrapper.
	if (zoneEl) zoneEl.classList.remove('recording');
}


/**
 * @description Creates a bar-style waveform visualizer inside the specified container
 *              and drives live height updates via the shared analyserNode.
 * @param {string} id - The DOM element ID of the waveform container.
 * @returns {void}
 */
function drawWaveform(id) {
	// Resolve the waveform container in the DOM.
	const container = document.getElementById(id);

	// Abort if the container is missing or the analyser node has not been initialized.
	if (!container || !analyserNode) return;

	// Fixed number of vertical bars to render in the waveform.
	const bars = 40;

	// Clear any pre-existing waveform bars from prior sessions.
	container.innerHTML = '';

	// ------------------------------------------------------------------
	// Build the static bar elements
	// ------------------------------------------------------------------
	for (let i = 0; i < bars; i++) {
		// Create a single waveform bar div.
		const bar = document.createElement('div');
		bar.className = 'waveform-bar';

		// Position the bar horizontally using percentage-based left offset.
		bar.style.left = (i * (100 / bars)) + '%';

		// Append the bar into the waveform container.
		container.appendChild(bar);
	}

	// ------------------------------------------------------------------
	// Animation loop — updates bar heights from live frequency data
	// ------------------------------------------------------------------
	function draw() {
		// Schedule the next animation frame to keep the loop running.
		waveAnimFrame = requestAnimationFrame(draw);

		// Allocate a typed array large enough to hold all frequency bins.
		const data = new Uint8Array(analyserNode.frequencyBinCount);

		// Populate the array with current frequency-domain amplitude data.
		analyserNode.getByteFrequencyData(data);

		// Select all bar elements created above.
		const barsEl = container.querySelectorAll('.waveform-bar');

		// Iterate over each bar and map it to a corresponding frequency bin.
		barsEl.forEach((bar, i) => {
			// Map the bar index to a frequency-bin index within the data array.
			const idx = Math.floor(i * data.length / bars);

			// Compute bar height as a percentage of the maximum byte value (255).
			const h = (data[idx] / 255) * 100;

			// Apply the height with a 4% minimum so bars never fully disappear.
			bar.style.height = Math.max(4, h) + '%';

			// Derive a normalized peak value (0.0 – 1.0) for LUFS estimation.
			const peak = data[idx] / 255;

			// ------------------------------------------------------------------
			// Live LUFS estimate update (only for voice-over recordings)
			// ------------------------------------------------------------------
			if (recordingTarget === 'vo') {
				// Convert linear peak amplitude to decibels; guard against log10(0).
				const dbEst = peak > 0.001 ? (20 * Math.log10(peak)).toFixed(1) : '—';

				// Update the EBU LUFS display element.
				document.getElementById('lufs-ebu').textContent = dbEst !== '—' ? dbEst + ' dB' : '—';

				// Update the online/streaming LUFS estimate (EBU + 7 dB offset).
				document.getElementById('lufs-online').textContent = dbEst !== '—' ? (parseFloat(dbEst) + 7).toFixed(1) + ' dB' : '—';
			}
		});
	}

	// Kick off the animation loop.
	draw();
}

// ── Interpretation flow ────────────────────────────────────────

/**
 * @description Generates a source speech (text + audio) via the backend API
 *              based on the current interpretation settings (topic, language,
 *              mode, specialization, duration). Updates the source text area
 *              and injects the returned audio into the page.
 * @returns {Promise<void>}
 */
async function generateSpeech() {
	// Capture the triggering button from the global event object and set a loading state.
	const btn = event.target;
	btn.disabled = true;
	btn.textContent = '⏳ Generating...';

	// Resolve the selected direction/language pair from the UI.
	const dir = document.getElementById('interp-dir').value;

	// Derive the target language from the direction string (e.g., "English → Arabic" yields "English").
	const lang = dir.startsWith('English') ? 'English' : 'Arabic';

	// ------------------------------------------------------------------
	// Assemble the multipart/form-data payload for the API request
	// ------------------------------------------------------------------
	const body = new FormData();
	body.append('topic', document.getElementById('interp-topic').value || 'current events');
	body.append('language', lang);
	body.append('mode', currentMode);
	body.append('specialization', document.getElementById('interp-spec').value.toLowerCase());
	body.append('duration_sec', document.getElementById('interp-dur').value);

	// ------------------------------------------------------------------
	// POST to the speech generation endpoint
	// ------------------------------------------------------------------
	try {
		const r = await fetch('/api/generate-speech', { method: 'POST', body });
		const data = await r.json();

		// Surface any backend-reported error to the user.
		if (data.error) {
			showError('generate-speech', data.error);
			return;
		}

		// Populate the source text textarea with the generated transcript.
		document.getElementById('source-text').value = data.text;

		// Resolve the source audio player element.
		const audio = document.getElementById('source-audio');

		// Decode the Base64 audio payload into a Uint8Array of raw bytes.
		const bytes = Uint8Array.from(atob(data.audio_b64), c => c.charCodeAt(0));

		// Wrap the bytes in a Blob using the MIME type returned by the server.
		const blob = new Blob([bytes], { type: data.mime });

		// Create an object URL for the Blob and assign it to the audio player source.
		audio.src = URL.createObjectURL(blob);

		// Make the audio player visible in the UI.
		audio.style.display = 'block';

		// Reveal the source-area container that holds the text and audio player.
		document.getElementById('source-area').style.display = 'block';
	} catch (e) {
		// Surface network or parsing errors to the user.
		showError('interp', e.message);
	} finally {
		// Always restore the button to its default enabled state and label.
		btn.disabled = false;
		btn.textContent = 'Generate Speech';
	}
}


/**
 * @description Called automatically when an interpretation recording finishes.
 *              Transcribes the recorded audio Blob via the backend and writes
 *              the resulting transcript into the interpretation transcript textarea.
 * @returns {Promise<void>}
 */
async function onInterpRecordingDone() {
	// Reveal the transcript area so the user can see the transcription result.
	document.getElementById('interp-transcript-area').style.display = 'block';

	// ------------------------------------------------------------------
	// Prepare the transcription request
	// ------------------------------------------------------------------
	const fd = new FormData();
	fd.append('audio', interpBlob, 'rec.webm');

	// Resolve the current language pair to determine transcription language.
	const dir = getLangPair();
	fd.append('language', dir.startsWith('Arabic') ? 'ar' : 'en');

	// ------------------------------------------------------------------
	// POST the audio to the transcription endpoint
	// ------------------------------------------------------------------
	try {
		const r = await fetch('/api/transcribe', { method: 'POST', body: fd });
		const d = await r.json();

		// If a transcript was returned, populate the interpretation textarea.
		if (d.transcript) {
			document.getElementById('interp-transcript').value = d.transcript;
		}
	} catch (e) {
		// Silently ignore transcription errors to avoid disrupting the user flow.
	}
}


/**
 * @description Analyzes the user's recorded interpretation against the source text.
 *              Handles special logic for shadowing mode (delivery-only evaluation)
 *              and conditionally attaches raw audio and source metadata for acoustic
 *              analysis. Displays loading states and delegates rendering to renderInterpFeedback.
 * @returns {Promise<void>}
 */
async function analyzeInterpretation() {
	// ------------------------------------------------------------------
	// Validate prerequisites
	// ------------------------------------------------------------------
	// Retrieve the user's interpretation/rendition text from the transcript field.
	const rendition = document.getElementById('interp-transcript').value;

	// Ensure the user has actually recorded something before analyzing.
	if (!rendition) {
		alert('Please record your interpretation first.');
		return;
	}

	// Retrieve the source text that was generated (or provided) for this session.
	let sourceText = document.getElementById('source-text').value;

	// ------------------------------------------------------------------
	// Shadowing mode — source text is optional; analyse delivery only
	// ------------------------------------------------------------------
	if (!sourceText) {
		if (currentMode === 'shadowing') {
			// Substitute a directive prompt so the backend evaluates delivery quality only.
			sourceText = '[Shadowing practice — no source text. Evaluate delivery quality only: fluency, naturalness, pacing, and pronunciation accuracy.]';
		} else {
			// For non-shadowing modes, source text is mandatory.
			alert('Please generate a speech first, then record your interpretation.');
			return;
		}
	}

	// ------------------------------------------------------------------
	// Resolve the analyze button (supports both manual click and programmatic calls)
	// ------------------------------------------------------------------
	const btn = (typeof event !== 'undefined' && event?.target?.tagName === 'BUTTON') ? event.target : document.getElementById('analyze-interp-manual-btn');
	if (btn) {
		btn.disabled = true;
		btn.textContent = '⏳ Analyzing...';
	}

	// ------------------------------------------------------------------
	// Toggle UI into the analyzing state
	// ------------------------------------------------------------------
	document.getElementById('analyzing-state').style.display = 'block';
	document.getElementById('interp-transcript-area').style.display = 'none';

	// ------------------------------------------------------------------
	// Assemble the multipart/form-data payload
	// ------------------------------------------------------------------
	const fd = new FormData();

	// Prefer the active session video title; fallback to the topic input value.
	const topic = (currentSessionVideo && currentSessionVideo.title)
		? currentSessionVideo.title
		: (document.getElementById('interp-topic')?.value || '');

	// Prefer the active session video difficulty; default to 'moderate'.
	const difficulty = (currentSessionVideo && currentSessionVideo.difficulty)
		? currentSessionVideo.difficulty.toLowerCase()
		: 'moderate';

	fd.append('source_text', sourceText);
	fd.append('rendition_text', rendition);
	fd.append('mode', currentMode);
	fd.append('specialization', document.getElementById('interp-spec').value);
	fd.append('direction', getLangPair());
	fd.append('topic', topic);
	fd.append('difficulty', difficulty);

	// ------------------------------------------------------------------
	// Shadowing acoustic analysis — attach raw audio + source video metadata
	// ------------------------------------------------------------------
	if (currentMode === 'shadowing' && interpBlob) {
		// Append the user's raw recording so the backend can perform acoustic evaluation.
		fd.append('user_audio', interpBlob, 'rec.webm');

		// Include the known source video ID if available (enables server-side source alignment).
		if (currentSessionVideo && currentSessionVideo.known_id) {
			fd.append('source_video_id', currentSessionVideo.known_id);
		}

		// Attach source WPM (words per minute) if directly available as a number.
		if (currentSessionVideo && currentSessionVideo.wpm_number) {
			fd.append('source_wpm', String(currentSessionVideo.wpm_number));
		} else if (currentSessionVideo && currentSessionVideo.wpm_est) {
			// Otherwise attempt to extract the first numeric sequence from the WPM estimate string.
			const wpmMatch = String(currentSessionVideo.wpm_est).match(/(\d+)/);
			if (wpmMatch) {
				fd.append('source_wpm', wpmMatch[1]);
			}
		}
	}

	// ------------------------------------------------------------------
	// POST to the interpretation analysis endpoint
	// ------------------------------------------------------------------
	try {
		const r = await fetch('/api/analyze-interpretation', { method: 'POST', body: fd });
		const d = await r.json();

		// Hide the analyzing spinner and render the feedback panel.
		document.getElementById('analyzing-state').style.display = 'none';
		renderInterpFeedback(d);
	} catch (e) {
		// Hide the spinner on error and surface the failure message.
		document.getElementById('analyzing-state').style.display = 'none';
		showError('interp-res', e.message);
	} finally {
		// Always restore the analyze button to its default state and label.
		if (btn) {
			btn.disabled = false;
			btn.textContent = ' Analyze Performance';
		}
	}
}


/**
 * @description Renders the interpretation analysis feedback in the DOM,
 *              including grade badge, score breakdown, summary, strengths,
 *              improvements, omissions, and terminology corrections.
 * @param {Object} d - The analysis response payload from the backend API.
 * @returns {void}
 */
function renderInterpFeedback(d) {
	// ------------------------------------------------------------------
	// Ensure the results panel is visible
	// ------------------------------------------------------------------
	const res = document.getElementById('interp-results');
	res.style.display = 'block';

	// Hide the placeholder message that appears before any results exist.
	const placeholder = document.getElementById('interp-results-placeholder');
	if (placeholder) placeholder.style.display = 'none';

	// Update the workflow stepper: mark step 2 as completed.
	const ws2 = document.getElementById('ws-2');
	if (ws2) ws2.className = 'wstep done';

	// Update the workflow stepper: activate step 3 (results).
	const ws3 = document.getElementById('ws-3');
	if (ws3) ws3.className = 'wstep active';

	// ------------------------------------------------------------------
	// Grade badge
	// ------------------------------------------------------------------
	const grade = d.grade || 'Good';

	// Map grade strings to CSS custom property color values.
	const gradeColors = {
		'Excellent':    'var(--green)',
		'Good':         'var(--gold)',
		'Satisfactory': 'var(--amber)',
		'Needs Work':   'var(--red)'
	};

	// Inject the colored grade badge into the DOM.
	document.getElementById('interp-grade').innerHTML =
		`<span style="color:${gradeColors[grade] || 'var(--gold)'};font-size:22px">◆ ${grade}</span>`;

	// ------------------------------------------------------------------
	// Score grid — choose labels based on evaluation method
	// ------------------------------------------------------------------
	const isShadowingAcoustic = d.evaluation_method === 'acoustic';

	// For acoustic shadowing, show WPM, Pauses, Phonemic, and Intonation.
	// For standard interpretation, show Accuracy, Completeness, Terms, and Fluency.
	const scores = isShadowingAcoustic
		? [
			{ label: 'Overall',    val: d.overall_score },
			{ label: 'WPM',        val: d.wpm_score },
			{ label: 'Pauses',     val: d.pause_score },
			{ label: 'Phonemic',   val: d.phonemic_score },
			{ label: 'Intonation', val: d.intonation_score }
		]
		: [
			{ label: 'Overall',    val: d.overall_score },
			{ label: 'Accuracy',   val: d.accuracy },
			{ label: 'Complete',   val: d.completeness },
			{ label: 'Terms',      val: d.terminology },
			{ label: 'Fluency',    val: d.fluency }
		];

	// Map each score object into a styled HTML score-item and join into a single string.
	document.getElementById('interp-scores').innerHTML = scores.map(s => {
		// Determine the CSS class based on score thresholds.
		const cls = s.val >= 85 ? 'score-100'
			: s.val >= 70 ? 'score-70'
			: s.val >= 50 ? 'score-50'
			: 'score-low';
		return `<div class="score-item"><div class="score-num ${cls}">${s.val || '—'}</div><div class="score-label">${s.label}</div></div>`;
	}).join('');

	// ------------------------------------------------------------------
	// Summary paragraph
	// ------------------------------------------------------------------
	if (d.summary) {
		document.getElementById('interp-summary').textContent = d.summary;
		document.getElementById('interp-summary').style.display = 'block';
	}

	// ------------------------------------------------------------------
	// Detail sections: strengths, improvements, omissions, terminology
	// ------------------------------------------------------------------
	let detail = '';

	// Render the strengths list as green tags if any exist.
	if (d.strengths?.length) {
		detail += `<div style="margin-top:12px"><div style="font-size:12px;font-weight:700;color:var(--green);margin-bottom:6px">✦ STRENGTHS</div><div class="tag-list">${d.strengths.map(s => `<span class="tag tag-green">${s}</span>`).join('')}</div></div>`;
	}

	// Render the improvements list as amber tags if any exist.
	if (d.improvements?.length) {
		detail += `<div style="margin-top:12px"><div style="font-size:12px;font-weight:700;color:var(--amber);margin-bottom:6px">▲ IMPROVEMENTS</div><div class="tag-list">${d.improvements.map(s => `<span class="tag tag-amber">${s}</span>`).join('')}</div></div>`;
	}

	// Render the omissions list as red tags if any exist.
	if (d.omissions?.length) {
		detail += `<div style="margin-top:12px"><div style="font-size:12px;font-weight:700;color:var(--red);margin-bottom:6px">✗ OMISSIONS</div><div class="tag-list">${d.omissions.map(s => `<span class="tag tag-red">${s}</span>`).join('')}</div></div>`;
	}

	// Render terminology corrections as amber tags showing wrong → correct pairs.
	if (d.term_errors?.length) {
		detail += `<div style="margin-top:12px"><div style="font-size:12px;font-weight:700;color:var(--amber);margin-bottom:6px"> TERMINOLOGY</div><div class="tag-list">${d.term_errors.map(t => `<span class="tag tag-amber">${t.wrong} → ${t.correct}</span>`).join('')}</div></div>`;
	}

	// Inject the assembled detail HTML into the results panel.
	document.getElementById('interp-detail').innerHTML = detail;
}


/**
 * @description Resets all interpretation-related state variables, UI elements,
 *              timers, and flags to their initial values. Called when the user
 *              starts a new interpretation practice session.
 * @returns {void}
 */
function clearInterp() {
	// ------------------------------------------------------------------
	// Reset global state variables associated with interpretation practice
	// ------------------------------------------------------------------
	practiceRecording = false;      // Flag: whether an active practice recording is in progress
	videoPausePoints = [];          // Array: timestamps where the video should auto-pause
	videoSegments = [];             // Array: segmented video regions for guided practice
	nextPauseIdx = 0;               // Index: next pause point to trigger during playback
	speechStartSec = 0;             // Timestamp (seconds): when the current speech started
	captionEvents = [];             // Array: caption display events queued during playback
	recordingStartSec = 0;          // Timestamp (seconds): when recording began
	recordingEndSec = 0;            // Timestamp (seconds): when recording ended
	silenceGaps = [];               // Array: detected silence gaps for segmentation logic
	pauseMode = 'auto';             // String: current pause mode ('auto' or 'manual')
	avgSpeechSec = 20;              // Number: average expected speech segment duration in seconds
	speechAccumulator = 0;          // Number: accumulated speech duration during analysis
	inNaturalSilence = false;       // Flag: whether the system is currently in a detected silence window
	lastPausedAt = -999;            // Number: timestamp of the last auto-pause to prevent rapid re-pause

	// ------------------------------------------------------------------
	// Clear any active timers and polling mechanisms
	// ------------------------------------------------------------------
	stopPausePolling();             // Halt the pause-point polling loop
	clearTimeout(autoSegTimer);     // Clear the auto-segmentation timer
	clearTimeout(speechStartTimer); // Clear the speech-start delay timer

	// ------------------------------------------------------------------
	// Reset DOM elements — guard each element before mutating
	// ------------------------------------------------------------------
	const st = document.getElementById('source-text');
	if (st) st.value = '';          // Clear the generated source text

	const sa = document.getElementById('source-audio');
	if (sa) sa.style.display = 'none'; // Hide the source audio player

	const ta = document.getElementById('interp-transcript-area');
	if (ta) ta.style.display = 'none'; // Hide the transcript input area

	const ir = document.getElementById('interp-results');
	if (ir) ir.style.display = 'none'; // Hide the feedback results panel

	const ph = document.getElementById('interp-results-placeholder');
	if (ph) ph.style.display = 'block'; // Show the placeholder message

	const it = document.getElementById('interp-transcript');
	if (it) it.value = '';          // Clear the user's interpretation transcript

	const rd = document.getElementById('rec-dot');
	if (rd) rd.style.display = 'none'; // Hide the recording indicator dot

	const rw = document.getElementById('rec-wave-card');
	if (rw) rw.style.display = 'none'; // Hide the waveform card

	const rb = document.getElementById('resume-btn');
	if (rb) rb.style.display = 'none'; // Hide the resume-playback button

	const vs = document.getElementById('vm-status-text');
	if (vs) {
		vs.innerHTML = 'Not recording';      // Reset status label
		vs.style.color = 'var(--dim)';       // Reset status color to dim
	}

	// Reset the main play/pause button to its idle (non-playing) state.
	updatePlayBtn(false);
}

// ── Voice-Over flow ────────────────────────────────────────────

/**
 * @description Called automatically when a voice-over recording finishes.
 *              Enables the analyze button and transcribes the recorded audio
 *              via the backend API, storing the transcript for later analysis.
 * @returns {Promise<void>}
 */
async function onVORecordingDone() {
	// Enable the voice-over analyze button now that a recording exists.
	document.getElementById('btn-analyze-vo').disabled = false;

	// ------------------------------------------------------------------
	// Transcribe the voice-over recording
	// ------------------------------------------------------------------
	const fd = new FormData();
	fd.append('audio', voBlob, 'rec.webm');
	fd.append('language', 'auto'); // Request automatic language detection

	try {
		const r = await fetch('/api/transcribe', { method: 'POST', body: fd });
		const d = await r.json();

		// Store the transcript in the module-level variable; default to empty string.
		voTranscript = d.transcript || '';
	} catch (e) {
		// Silently ignore transcription errors to preserve user experience.
	}
}


/**
 * @description Handles a user-uploaded audio file for voice-over analysis.
 *              Reads the file from the file input, stores it as the active VO Blob,
 *              transcribes it, and enables the analyze button.
 * @returns {Promise<void>}
 */
async function uploadVoFile() {
	// Retrieve the first (and expected only) file from the upload input.
	const file = document.getElementById('vo-upload').files[0];

	// Abort if no file was selected.
	if (!file) return;

	// Promote the uploaded file to the active voice-over Blob and reset any prior transcript.
	voBlob = file;
	voTranscript = '';

	// ------------------------------------------------------------------
	// Transcribe the uploaded file
	// ------------------------------------------------------------------
	const fd = new FormData();
	fd.append('audio', file, file.name);
	fd.append('language', 'auto'); // Request automatic language detection

	try {
		const r = await fetch('/api/transcribe', { method: 'POST', body: fd });
		const d = await r.json();

		// Persist the transcription result for downstream analysis.
		voTranscript = d.transcript || '';
	} catch (e) {
		// Silently ignore transcription errors.
	}

	// Enable the voice-over analyze button now that audio is available.
	document.getElementById('btn-analyze-vo').disabled = false;
}


/**
 * @description Analyzes the user's voice-over performance by sending the transcript
 *              and target script to the backend. Displays loading state on the trigger
 *              button and delegates rendering to renderVOFeedback.
 * @returns {Promise<void>}
 */
async function analyzeVO() {
	// Ensure a transcript exists before proceeding with analysis.
	if (!voTranscript) {
		alert('No recording to analyze.');
		return;
	}

	// Capture the triggering button from the global event object and set a loading state.
	const btn = event.target;
	btn.disabled = true;
	btn.textContent = '⏳ Analyzing...';

	// ------------------------------------------------------------------
	// Assemble the multipart/form-data payload for the API request
	// ------------------------------------------------------------------
	const fd = new FormData();
	fd.append('transcript', voTranscript);
	fd.append('target_text', document.getElementById('vo-script').value);
	fd.append('live_db', '-20'); // Estimated live loudness level in dB

	// ------------------------------------------------------------------
	// POST to the voice-over analysis endpoint
	// ------------------------------------------------------------------
	try {
		const r = await fetch('/api/analyze-voiceover', { method: 'POST', body: fd });
		const d = await r.json();

		// Render the feedback panel with scores, coaching points, and readiness status.
		renderVOFeedback(d);
	} catch (e) {
		// Silently ignore errors to avoid breaking the UI state.
	} finally {
		// Always restore the analyze button to its default enabled state and label.
		btn.disabled = false;
		btn.textContent = ' Get Feedback';
	}
}


/**
 * @description Renders the voice-over analysis feedback in the DOM,
 *              including score breakdown, summary, coaching points,
 *              next-exercise suggestion, and broadcast-readiness badge.
 * @param {Object} d - The analysis response payload from the backend API.
 * @returns {void}
 */
function renderVOFeedback(d) {
	// Make the voice-over results panel visible.
	document.getElementById('vo-results').style.display = 'block';

	// ------------------------------------------------------------------
	// Score grid
	// ------------------------------------------------------------------
	const scores = [
		{ label: 'Overall',       val: d.overall_score },
		{ label: 'Clarity',       val: d.clarity },
		{ label: 'Pacing',        val: d.pacing },
		{ label: 'Intonation',    val: d.intonation },
		{ label: 'Energy',        val: d.energy },
		{ label: 'Pronunciation', val: d.pronunciation }
	];

	// Map each score into a styled HTML score-item and join into a single string.
	document.getElementById('vo-scores').innerHTML = scores.map(s => {
		// Determine the CSS class based on score thresholds.
		const cls = s.val >= 85 ? 'score-100'
			: s.val >= 70 ? 'score-70'
			: s.val >= 50 ? 'score-50'
			: 'score-low';
		return `<div class="score-item"><div class="score-num ${cls}">${s.val || '—'}</div><div class="score-label">${s.label}</div></div>`;
	}).join('');

	// Populate the summary paragraph (falls back to empty string if absent).
	document.getElementById('vo-summary').textContent = d.summary || '';

	// ------------------------------------------------------------------
	// Detail sections: coaching points, next exercise, broadcast readiness
	// ------------------------------------------------------------------
	let det = '';

	// Render coaching points as amber tags if any are returned.
	if (d.coaching_points?.length) {
		det += `<div style="margin-top:12px"><div style="font-size:12px;font-weight:700;color:var(--amber);margin-bottom:6px">▲ COACHING POINTS</div><div class="tag-list">${d.coaching_points.map(p => `<span class="tag tag-amber">${p}</span>`).join('')}</div></div>`;
	}

	// Render the recommended next exercise inside a styled card if provided.
	if (d.next_exercise) {
		det += `<div style="margin-top:12px;background:var(--bg3);border:1px solid var(--border);padding:12px;border-radius:8px;font-size:13px"><span style="color:var(--gold);font-weight:700">Next Exercise: </span>${d.next_exercise}</div>`;
	}

	// Generate a broadcast-readiness badge: green if ready, amber if not.
	const broadcastBadge = d.broadcast_ready
		? '<span style="color:var(--green)">Broadcast Ready</span>'
		: '<span style="color:var(--amber)">Warning: Not Yet Broadcast Ready</span>';

	// Append the readiness badge to the detail string.
	det += `<div style="margin-top:10px;font-size:13px">${broadcastBadge}</div>`;

	// Inject the assembled detail HTML into the results panel.
	document.getElementById('vo-detail').innerHTML = det;
}

// ── Teleprompter ───────────────────────────────────────────────
