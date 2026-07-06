// ══════════════════════════════════════════════════════════════════
// OPI SIMULATION ENGINE
// ══════════════════════════════════════════════════════════════════
let opiSid        = null;
let opiCallSecs   = 0;
let opiCallTimerI = null;
let opiIncomingT  = null;
let opiData       = null;
let opiRecorder   = null;
let opiChunks     = [];
let opiRecTimerI  = null;
let opiRecSecs    = 0;
let opiSilenceI   = null;
let opiTurnHardCapT = null;   // global hard-cap for every interpreter turn (not just intro) —
                               // guarantees the call can never stall indefinitely if VAD fails to fire
let opiIntroTranscript = '';   // interpreter's opening self-introduction — fed into evaluation
let opiAudioCtx   = null;
let opiAnalyser   = null;
let opiMicStream  = null;
let opiTranscriptLines = [];
let opiVideoMode = false;  // OPI/VRI merge — single mode, this flag is the only branch point
let opiPendingOffline = false;  // user requested "go offline after this call" while active —
                                 // honored in opiEndCall() instead of auto-queueing the next call

function opiIsVideoMode() { return opiVideoMode; }

function opiToggleVideoMode(checked) {
  opiVideoMode = !!checked;
  const sub = document.getElementById('opi-video-sub');
  if (sub) sub.style.display = opiVideoMode ? '' : 'none';
  // Camera panel is active by default whenever VRI is toggled on, per PROJECT_BRIEF.md —
  // it'll show/hide live as calls go active, controlled again in opiSetState('active').
  const panel = document.getElementById('opi-camera-panel');
  if (panel && document.getElementById('opi-ps-active')?.style.display !== 'block') {
    panel.style.display = 'none'; // only shown once a call is actually active
  }
}
let opiEnded          = false;
let opiCallLogs       = [];       // all completed calls this session
let opiLastSourceText = '';       // track source text for turn log
let opiLastSourceSpeaker = '';    // track source speaker — sent to backend so evaluation pairing never drifts
let opiCurrentTurnLog = [];       // [{speaker, source, rendered}] for current call
let opiPreTurnsQueue  = [];       // pre-generated turns to play before hitting live API

// ── OPI field + sub-type (reuses CI's field taxonomy — same domains, same
// sub-type lists — since OPI/VRI shares the same call-type universe as CI) ──
let opiActiveField = 'medical';
let opiFieldType = '';

function opiInitOverlay() {
  const fieldSel = document.getElementById('opi-field');
  if (fieldSel && !fieldSel.dataset.init) {
    fieldSel.innerHTML = Object.entries(CI_FIELD_NAMES).map(([k]) =>
      `<option value="${k}"${k === 'medical' ? ' selected' : ''}>${k.charAt(0).toUpperCase() + k.slice(1)}</option>`).join('');
    fieldSel.dataset.init = '1';
  }
  opiFieldChanged('medical');
  opiSrcLangChanged('English');
  opiTgtLangChanged('Arabic');
}

function opiFieldChanged(fieldId) {
  opiActiveField = fieldId;
  const typeSel = document.getElementById('opi-field-type');
  if (typeSel) {
    const types = CI_FIELD_TYPES[fieldId] || [];
    typeSel.innerHTML = types.map(t => `<option>${t}</option>`).join('');
    opiTypeChanged(types[0] || '');
  }
}

function opiTypeChanged(typeVal) {
  opiFieldType = typeVal || document.getElementById('opi-field-type')?.value || '';
}

function opiUpdatePace(val) {
  const info = CI_PACE_INFO[val] || CI_PACE_INFO[2];
  const lbl = document.getElementById('opi-pace-lbl');
  if (lbl) lbl.textContent = info;
}

// ── OPI language helpers ──────────────────────────────────────────
function opiGetLang() {
  const s = document.getElementById('opi-src-lang')?.value || 'English';
  const t = document.getElementById('opi-tgt-lang')?.value || 'Arabic';
  return s + ' → ' + t;
}
function opiSrcLangChanged(lang) {
  const dialects = CI_DIALECTS[lang] || ['Standard ' + lang];
  const sel = document.getElementById('opi-src-dialect');
  if (sel) sel.innerHTML = dialects.map(d=>`<option>${d}</option>`).join('');
}
function opiTgtLangChanged(lang) {
  const dialects = CI_DIALECTS[lang] || ['Standard ' + lang];
  const sel = document.getElementById('opi-tgt-dialect');
  if (sel) sel.innerHTML = dialects.map(d=>`<option>${d}</option>`).join('');
}

// ── Entry / Exit ────────────────────────────────────────────────
async function launchOPISimulation() {
  const ready = await _loadOverlay('opi-sim-overlay', 'overlay-opi.html');
  if (!ready) return;
  opiInitOverlay();
  opiEnded = false;
  opiTranscriptLines = [];
  opiPanelMinimized = false;
  const panel = document.getElementById('opi-circle-panel');
  if (panel) { panel.classList.remove('minimized'); }
  const toggle = document.getElementById('opi-panel-toggle');
  if (toggle) toggle.textContent = '−';
  const overlay = document.getElementById('opi-sim-overlay');
  overlay.style.display = 'flex';
  overlay.style.flexDirection = 'column';
  opiSetState('offline');
}

function exitOPISim() {
  if (opiCallTimerI) clearInterval(opiCallTimerI);
  if (opiIncomingT)  clearTimeout(opiIncomingT);
  opiStopRecording();
  opiStopMicTest();
  if (opiMicStream) { opiMicStream.getTracks().forEach(t=>t.stop()); opiMicStream=null; }
  if (opiAudioCtx)  { try { opiAudioCtx.close(); } catch(e){} opiAudioCtx=null; }
  document.getElementById('opi-sim-overlay').style.display = 'none';
}

function opiSetState(state) {
  // Drive phone widget screens
  ['offline','testing','waiting','incoming','active'].forEach(s => {
    const el = document.getElementById('opi-ps-'+s);
    if (el) el.style.display = (s === state) ? 'block' : 'none';
  });

  const dot      = document.getElementById('opi-sdot');
  const lbl      = document.getElementById('opi-slbl');
  const hint     = document.getElementById('opi-phone-hint');
  const timerTop = document.getElementById('opi-call-timer-top');
  const paramRow = document.getElementById('opi-param-row');
  const offBtn   = document.getElementById('opi-global-offline-btn');

  // Persistent "Go Offline" affordance — only shown for incoming/active, since
  // 'waiting' already has its own inline Go Offline button and 'offline'/'testing'
  // have nothing to go offline from. Reset its label/color whenever we (re)enter
  // a state, since opiRequestOffline() mutates them while toggling the pending flag.
  if (offBtn) {
    if (state === 'incoming') {
      offBtn.style.display = 'block';
      offBtn.textContent = 'Decline & Go Offline';
      offBtn.style.color = 'var(--dim)';
      offBtn.style.borderColor = 'var(--border)';
    } else if (state === 'active') {
      offBtn.style.display = 'block';
      offBtn.textContent = opiPendingOffline ? 'Cancel — Stay Online After Call' : 'Go Offline (after this call)';
      offBtn.style.color = opiPendingOffline ? '#e8971e' : 'var(--dim)';
      offBtn.style.borderColor = opiPendingOffline ? 'rgba(232,151,30,.4)' : 'var(--border)';
    } else {
      offBtn.style.display = 'none';
    }
  }

  if (state === 'offline') {
    if (dot) dot.style.background = '#c0392b';
    if (lbl) lbl.textContent = 'offline';
    if (hint) hint.textContent = 'Click "Go Online" to begin';
    if (timerTop) timerTop.style.display = 'none';
    if (paramRow) paramRow.style.opacity = '1';
    opiPendingOffline = false;

  } else if (state === 'testing') {
    if (dot) dot.style.background = '#ca8a04';
    if (lbl) lbl.textContent = 'testing';
    if (hint) hint.textContent = 'Checking microphone…';
    if (paramRow) paramRow.style.opacity = '.6';

  } else if (state === 'waiting') {
    if (dot) dot.style.background = '#16a34a';
    if (lbl) lbl.textContent = 'online';
    if (hint) hint.textContent = 'Awaiting incoming call';
    if (paramRow) paramRow.style.opacity = '.5';

  } else if (state === 'incoming') {
    if (dot) dot.style.background = '#7c3aed';
    if (lbl) lbl.textContent = 'incoming';
    if (hint) hint.textContent = 'Answer the incoming call';

  } else if (state === 'active') {
    if (dot) dot.style.background = '#16a34a';
    if (lbl) lbl.textContent = 'active';
    if (hint) hint.textContent = 'Call in progress';
    if (timerTop) timerTop.style.display = 'block';
    if (paramRow) paramRow.style.opacity = '.5';
    // VRI camera panel — active by default whenever the video toggle is on
    const camPanel = document.getElementById('opi-camera-panel');
    if (camPanel) {
      camPanel.style.display = opiVideoMode ? '' : 'none';
      if (opiVideoMode) {
        const cueEl = document.getElementById('opi-visual-cue-text');
        const cues  = (opiData && opiData.scenario && opiData.scenario.visual_cues) || '';
        if (cueEl) cueEl.textContent = cues || 'Watching for gestures, items shown, and visible context…';
      }
    }
  }
}

// ── Panel toggle (deprecated — replaced by phone widget) ─────────
function opiTogglePanel() { /* no-op */ }

// ── Mic Check (runs during 'testing' state) ──────────────────────
let opiMicTestCtx = null, opiMicTestAnalyser = null, opiMicTestStream = null, opiMicTestRAF = null;

function opiRunMicCheck() {
  const zone   = document.getElementById('opi-mic-check-zone');
  const barsEl = document.getElementById('opi-mic-bars-sm');
  const dot    = document.getElementById('opi-mic-status-dot');
  const txt    = document.getElementById('opi-mic-status-txt');
  if (!zone || !barsEl) return;

  // Build bars
  barsEl.innerHTML = '';
  for (let i = 0; i < 18; i++) {
    const b = document.createElement('div');
    barsEl.appendChild(b);
  }

  navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    .then(stream => {
      opiMicTestStream   = stream;
      opiMicTestCtx      = new AudioContext();
      const src          = opiMicTestCtx.createMediaStreamSource(stream);
      opiMicTestAnalyser = opiMicTestCtx.createAnalyser();
      opiMicTestAnalyser.fftSize = 256;
      src.connect(opiMicTestAnalyser);

      if (txt) { txt.textContent = 'Speak now to test…'; txt.style.color = '#ca8a04'; }
      if (dot) { dot.style.background = '#ca8a04'; }

      const bars        = barsEl.children;
      const data        = new Uint8Array(opiMicTestAnalyser.frequencyBinCount);
      let   signalSeen  = false;
      let   noSigTimer  = null;

      // Show "no signal" warning after 5s of silence — but NEVER advance without real signal
      noSigTimer = setTimeout(() => {
        if (!signalSeen) {
          if (dot) { dot.style.background = '#f43f5e'; }
          if (txt) {
            txt.textContent = 'Warning: No signal — check your mic';
            txt.style.color = '#f43f5e';
          }
          // Update badge to warn
          const badgeLabel = document.getElementById('opi-badge-label-text');
          if (badgeLabel) badgeLabel.textContent = 'Check Mic';
        }
      }, 5000);

      (function draw() {
        opiMicTestRAF = requestAnimationFrame(draw);
        opiMicTestAnalyser.getByteFrequencyData(data);

        // True RMS across all frequency bins
        let sum = 0;
        for (let j = 0; j < data.length; j++) sum += data[j] * data[j];
        const rms = Math.sqrt(sum / data.length);

        // Animate bars regardless of signal state
        for (let i = 0; i < bars.length; i++) {
          const val = data[Math.floor(i * data.length / bars.length)] / 255;
          const h   = Math.max(3, val * 22);
          bars[i].style.height     = h + 'px';
          bars[i].style.background = val > 0.25 ? '#22c55e' : val > 0.07 ? '#ca8a04' : '#1e2d46';
        }

        // Gate: only proceed if real audio signal detected (RMS > 8)
        if (!signalSeen && rms > 8) {
          signalSeen = true;
          clearTimeout(noSigTimer);

          // Reset badge label if it was showing "Check Mic"
          const badgeLabel = document.getElementById('opi-badge-label-text');
          if (badgeLabel) badgeLabel.textContent = 'Testing';

          if (dot) { dot.style.background = '#22c55e'; }
          if (txt) { txt.textContent = 'Mic ready Done '; txt.style.color = '#22c55e'; }

          // 1.5s so user sees confirmation, then advance to Online
          setTimeout(() => {
            opiStopMicTest();
            opiGoOnlineFromTesting();
          }, 1500);
        }
      })();
    })
    .catch(() => {
      if (dot) { dot.style.background = '#f43f5e'; }
      if (txt) { txt.textContent = 'Warning: Mic blocked'; txt.style.color = '#f43f5e'; }
      // Don't auto-advance — user must fix mic
    });
}

function opiStopMicTest() {
  if (opiMicTestRAF)    { cancelAnimationFrame(opiMicTestRAF); opiMicTestRAF = null; }
  if (opiMicTestStream) { opiMicTestStream.getTracks().forEach(t => t.stop()); opiMicTestStream = null; }
  if (opiMicTestCtx)    { try { opiMicTestCtx.close(); } catch(e){} opiMicTestCtx = null; }
}

// ── Circle button click ──────────────────────────────────────────
function opiCircleClick() {
  const offlineEl = document.getElementById('opi-ps-offline');
  const waitingEl = document.getElementById('opi-ps-waiting');
  const offlineVisible = offlineEl && offlineEl.style.display !== 'none';
  const waitingVisible = waitingEl && waitingEl.style.display !== 'none';

  if (offlineVisible) {
    // Red → Yellow: enter testing state, run mic check
    opiSetState('testing');
    setTimeout(opiRunMicCheck, 200);
  } else if (waitingVisible) {
    // Green → back offline
    clearTimeout(opiIncomingT);
    opiStopMicTest();
    opiSetState('offline');
  }
  // Incoming/active call go-offline is handled by opiRequestOffline(), bound
  // to the persistent #opi-global-offline-btn rather than this circle button.
}

// ── Persistent "Go Offline" — works during incoming/active, unlike
//    opiCircleClick() above which is scoped to offline/waiting only. ──────
function opiRequestOffline() {
  const incomingEl = document.getElementById('opi-ps-incoming');
  const activeEl    = document.getElementById('opi-ps-active');
  const incomingVisible = incomingEl && incomingEl.style.display === 'block';
  const activeVisible    = activeEl && activeEl.style.display === 'block';

  if (incomingVisible) {
    // Decline the ringing call and go straight offline — don't queue another
    // incoming call the way opiDeclineCall() normally would.
    clearTimeout(opiIncomingT);
    opiSid = null;
    opiStopMicTest();
    opiSetState('offline');
    return;
  }

  if (activeVisible) {
    // Can't drop a call already in progress — toggle a "go offline once this
    // call ends" flag instead. Honored in opiEndCall(), which checks it
    // before deciding whether to auto-queue the next incoming call.
    opiPendingOffline = !opiPendingOffline;
    opiSetState('active'); // re-render the button label/color for the new flag state
    return;
  }

  // Fallback (shouldn't normally be reachable since the button is hidden
  // outside incoming/active) — behaves like the waiting-state toggle.
  clearTimeout(opiIncomingT);
  opiStopMicTest();
  opiSetState('offline');
}

// ── Transition from testing → online (called automatically when mic passes) ──
function opiGoOnlineFromTesting() {
  opiGoOnline();
}

// ── Go Online ───────────────────────────────────────────────────
async function opiGoOnline() {
  const field   = document.getElementById('opi-field').value;
  const srcLang = document.getElementById('opi-src-lang')?.value || 'English';
  const tgtLang = document.getElementById('opi-tgt-lang')?.value || 'Arabic';
  const lang    = srcLang + ' → ' + tgtLang;
  const dur     = parseInt(document.getElementById('opi-duration').value);
  const diff    = document.getElementById('opi-difficulty').value;
  opiSetState('waiting');
  const wf = document.getElementById('opi-waiting-field');
  if (wf) wf.textContent = `${field} · ${lang} · ${dur} min`;

  // Pre-warm mic
  try {
    opiMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Set up AudioContext for silence detection
    opiAudioCtx  = new AudioContext();
    const src    = opiAudioCtx.createMediaStreamSource(opiMicStream);
    opiAnalyser  = opiAudioCtx.createAnalyser();
    opiAnalyser.fftSize = 256;
    src.connect(opiAnalyser);
  } catch(e) { console.warn('Mic not available:', e); }

  // Start generation immediately — no artificial pre-delay.
  // opiTriggerIncoming() enforces its own minimum ring delay internally via Promise.all,
  // so the phone still won't ring until at least 3 s have passed even if the API is fast.
  opiIncomingT = null;
  opiTriggerIncoming(field, lang, dur, diff);
}

// ── Agency name lookup (by field type) ──────────────────────────
const OPI_AGENCY_NAMES = {
  medical:      ['Riverside Medical Center','St. Joseph Hospital','Valley Health Network','Metro General Hospital','Harbor Community Clinic','Sunrise Pediatric Center','City ER Services'],
  legal:        ['District Court — Division 4','Federal Public Defender Office','Metropolitan Courthouse','City Legal Aid Society','County Probate Court'],
  social:       ['Dept. of Social Services','Child & Family Services','Housing Assistance Bureau','Community Support Division','Adult Protective Services'],
  immigration:  ['U.S. Citizenship & Immigration Services','Immigration Court — District 7','Refugee Resettlement Agency','International Rescue Committee'],
  mental_health:['Behavioral Health Services','Crisis Intervention Center','Community Mental Health Board','Valley Wellness Center'],
  pharmacy:     ['City Pharmacy Network','Metro Health Pharmacy','Community Care Pharmacy'],
  '911':        ['Emergency Dispatch Center','Metro Police Dispatch']
};
let opiCurrentAgency = '';
function opiGetAgencyName(field) {
  const list = OPI_AGENCY_NAMES[field] || OPI_AGENCY_NAMES.medical;
  return list[Math.floor(Math.random() * list.length)];
}

async function opiTriggerIncoming(field, lang, dur, diff) {
  // Generate the call as soon as possible while enforcing a realistic minimum ring
  // delay via Promise.all — the phone won't ring until BOTH the API responds AND
  // the minimum wait has elapsed. This eliminates the old 3-6s artificial pre-delay
  // AND prevents a broken "incoming" state when the API is slower than expected.
  const wf = document.getElementById('opi-waiting-field');
  if (wf) wf.textContent = 'Preparing call…';

  const fd = new FormData();
  fd.append('field', field); fd.append('language', lang);
  fd.append('difficulty', diff); fd.append('duration_min', dur);
  // OPI/VRI merge — same call protocol, video toggle adds the visual channel.
  // Read live from the checkbox rather than threading a param through every
  // call site, since the toggle can change between consecutive calls.
  fd.append('video', opiIsVideoMode() ? 'true' : 'false');

  // AbortController: cancel if generation takes more than 60 s
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), 60000);

  // Minimum realistic delay before showing the phone as ringing (3-4 s)
  const minRingDelay = new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 1000));

  try {
    const [r] = await Promise.all([
      fetch('/api/opi/start-call', { method:'POST', body:fd, signal: ctrl.signal }),
      minRingDelay,  // both must resolve before the phone rings
    ]);
    clearTimeout(timeoutId);
    opiData = await r.json();

    // Backend returned an error — quietly retry
    if (opiData.error || !opiData.session_id || !opiData.pre_turns || !opiData.pre_turns.length) {
      console.error('[OPI] start-call failed:', opiData.error || opiData);
      opiSid = null;
      if (wf) wf.textContent = `${field} · ${lang} · ${dur} min`;
      opiIncomingT = setTimeout(() => opiTriggerIncoming(field, lang, dur, diff), 3000);
      return;
    }

    opiSid   = opiData.session_id;
    const sc = opiData.scenario || {};

    const agencyName = opiGetAgencyName(field);
    const callerName = sc.caller_name || 'Caller';
    const dialect    = (lang.split('→')[1] || 'Arabic').trim();
    const diffLabel  = diff.charAt(0).toUpperCase() + diff.slice(1);
    const fldLabel   = field.charAt(0).toUpperCase() + field.slice(1);
    opiCurrentAgency = agencyName;

    // Ring — fully generated, Accept is instant
    opiSetState('incoming');
    const agencyEl = document.getElementById('opi-incoming-agency');
    const callerEl = document.getElementById('opi-incoming-caller');
    const tagsEl   = document.getElementById('opi-incoming-tags');
    if (agencyEl) agencyEl.textContent = agencyName;
    if (callerEl) callerEl.textContent = `${callerName} — ${dialect} dialect`;
    if (tagsEl) tagsEl.innerHTML =
      `<span style="font-size:11px;padding:2px 9px;border-radius:10px;background:var(--bg2);color:var(--purple);border:0.5px solid #3d1a6b">${diffLabel}</span>` +
      `<span style="font-size:11px;padding:2px 9px;border-radius:10px;background:rgba(34,197,94,.08);color:var(--green);border:0.5px solid #064e29">${fldLabel}</span>`;
    const activeAgencyEl = document.getElementById('opi-active-agency-name');
    const activeInitEl   = document.getElementById('opi-active-initials');
    const activeDetailEl = document.getElementById('opi-active-detail');
    if (activeAgencyEl) activeAgencyEl.textContent = agencyName;
    if (activeInitEl) activeInitEl.textContent = agencyName.split(' ').slice(0,3).map(w=>w[0]).join('').toUpperCase();
    if (activeDetailEl) activeDetailEl.textContent = `${dialect} · ${fldLabel} · ${diffLabel}`;
  } catch(e) {
    clearTimeout(timeoutId);
    const reason = e.name === 'AbortError' ? 'timed out after 60 s' : e.message;
    console.error('[OPI] start-call failed:', reason, e);
    opiSid = null;
    if (wf) wf.textContent = `${field} · ${lang} · ${dur} min`;
    opiIncomingT = setTimeout(() => opiTriggerIncoming(field, lang, dur, diff), 5000);
  }
}

function opiDeclineCall() {
  // Stay online but go back to waiting — a declined call still leaves you available
  opiSetState('waiting');
  const field   = document.getElementById('opi-field').value;
  const srcLang = document.getElementById('opi-src-lang')?.value || 'English';
  const tgtLang = document.getElementById('opi-tgt-lang')?.value || 'Arabic';
  const lang    = srcLang + ' → ' + tgtLang;
  const dur     = parseInt(document.getElementById('opi-duration').value);
  const wf = document.getElementById('opi-waiting-field');
  if (wf) wf.textContent = `${field} · ${lang} · ${dur} min`;
  // Trigger another incoming call after a short delay
  const diff = document.getElementById('opi-difficulty').value;
  opiIncomingT = setTimeout(() => opiTriggerIncoming(field, lang, dur, diff), 4000 + Math.random()*3000);
}

// ── Accept Call ─────────────────────────────────────────────────
async function opiAcceptCall() {
  // Guard against accepting a call that failed to generate (no session / no audio
  // to play) — that's exactly what produced "nothing in the call" before: the
  // active screen would open with an empty transcript and silence.
  if (!opiSid || !opiData || !opiData.pre_turns || !opiData.pre_turns.length) {
    console.error('[OPI] Tried to accept a call with no generated content:', opiData);
    opiDeclineCall();
    return;
  }

  opiSetState('active');
  opiEnded = false;
  opiCallSecs = 0;
  opiCurrentTurnLog = [];
  opiLastSourceText = '';
  opiLastSourceSpeaker = '';
  document.getElementById('opi-transcript').innerHTML = '';
  opiTranscriptLines = [];

  // Start call timer
  clearInterval(opiCallTimerI);
  const timerEl = document.getElementById('opi-call-timer-main');
  const timerTop = document.getElementById('opi-call-timer-top');
  timerTop.style.display = 'block';
  opiCallTimerI = setInterval(() => {
    opiCallSecs++;
    const m = Math.floor(opiCallSecs/60), s = opiCallSecs%60;
    const ts = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    timerEl.textContent = ts; timerTop.textContent = ts;
  }, 1000);

  // Scenario display already primed in opiTriggerIncoming
  const sc = (opiData && opiData.scenario) || {};
  const turnStatusEl = document.getElementById('opi-turn-status');
  if (turnStatusEl) { turnStatusEl.textContent = 'Setting up call…'; turnStatusEl.style.borderLeftColor = '#7c3aed'; }

  // Load pre-generated turns into queue (turns 1 & 2 play after interpreter's first and second rendition)
  opiPreTurnsQueue = (opiData && opiData.pre_turns && opiData.pre_turns.length > 1)
    ? opiData.pre_turns.slice(1)   // [0] plays now; rest queued
    : [];

  // ── Professional intro — the call "starts" the instant you accept: a brief
  // line-opening silence where YOU introduce yourself (name, role, confidentiality
  // reminder), ~15-20 sec, scored as part of professionalism. This is real OPI
  // protocol, and it doubles as natural cover for the line connecting — there's
  // never a dead "loading" gap because something purposeful is always happening.
  await opiRunIntroPhase();
  if (opiEnded) return;
  opiBeginDialogue();
}

function opiBeginDialogue() {
  const sc = (opiData && opiData.scenario) || {};
  if (opiData && opiData.pre_turns && opiData.pre_turns.length > 0) {
    const pt   = opiData.pre_turns[0];
    const name = pt.speaker === 'provider' ? (sc.provider_name||'Provider') : (sc.caller_name||'Caller');
    opiAddTranscriptLine(pt.speaker, name, pt.text);
    opiPlayAudio(pt.audio_b64, pt.speaker, name, pt.text);
  }
}

// ── Interpreter Self-Introduction ────────────────────────────────
// Real OPI calls open with the interpreter introducing themselves — name, role,
// and a brief confidentiality/impartiality reminder — before any dialogue begins.
// We capture it (best-effort transcription) and hand it to the evaluator so
// professionalism is graded on the whole call, not just the renditions.
function opiSetYourTurnLabel(title, hint, color) {
  const t = document.getElementById('opi-yturn-title');
  const h = document.getElementById('opi-render-hint');
  if (t) { t.textContent = title; t.style.color = color || '#f43f5e'; }
  if (h) h.textContent = hint;
}

async function opiRunIntroPhase() {
  if (opiEnded) return;
  return new Promise(async (resolve) => {
    const zone = document.getElementById('opi-your-turn-zone');
    let hardCapT = null;   // stored so finish() can cancel it — without this the
                           // 30s timer fires mid-call, stops whoever is recording
                           // at that moment, and creates the "loop" the user sees.
    let finished = false;  // guard against finish() running twice (hard cap + manual)
    const finish = async () => {
      if (finished) return;
      finished = true;
      clearTimeout(hardCapT);   // ← the critical fix: kill the stale timer now
      clearInterval(opiSilenceI);
      if (zone) zone.style.display = 'none';
      const blob = new Blob(opiChunks, { type:'audio/webm' });
      try {
        const fd = new FormData();
        fd.append('audio', blob, 'intro.webm');
        fd.append('language', 'auto');
        const r = await fetch('/api/transcribe', { method:'POST', body: fd });
        const d = await r.json();
        opiIntroTranscript = (d && d.transcript) ? d.transcript.trim() : '';
        if (opiSid && opiIntroTranscript) {
          const fd2 = new FormData();
          fd2.append('session_id', opiSid);
          fd2.append('intro_transcript', opiIntroTranscript);
          try {
            const r2 = await fetch('/api/opi/save-intro', { method:'POST', body: fd2 });
            const fb = await r2.json();
            const feedback = fb && fb.feedback;
            if (feedback) {
              const missing = [];
              if (!feedback.has_english)       missing.push('English greeting');
              if (!feedback.has_arabic_fusha)  missing.push('Arabic Fusha greeting');
              if (!feedback.has_name)          missing.push('your name');
              if (!feedback.has_confidentiality) missing.push('confidentiality note');
              const tsEl = document.getElementById('opi-turn-status');
              if (tsEl) {
                if (missing.length === 0) {
                  tsEl.textContent = 'Done Intro complete — great start!';
                  tsEl.style.borderLeftColor = '#22c55e';
                } else {
                  tsEl.textContent = `Intro missing: ${missing.join(', ')}`;
                  tsEl.style.borderLeftColor = '#e8971e';
                }
              }
              // Brief pause so interpreter can read the feedback before audio starts
              await new Promise(r => setTimeout(r, 1800));
            }
          } catch(e) { /* non-blocking */ }
        }
      } catch(e) { console.error('[OPI] intro capture failed:', e); }
      opiSetYourTurnLabel('Your Turn — Render Now', 'Interpret into the target language', '#f43f5e');
      resolve();
    };

    if (!zone || !opiAnalyser) {
      // No mic / waveform analyser — skip the intro gracefully rather than
      // stall the call on a recording path that can't auto-stop.
      resolve();
      return;
    }

    opiSetYourTurnLabel(
      'You\'re Live — Introduce Yourself',
      'In BOTH English and Arabic Fusha: state your name, your role as interpreter, and a confidentiality/impartiality reminder (~15-20 sec)',
      '#22c55e'
    );
    zone.style.display = 'block';
    await opiStartRecording();
    if (opiEnded) { resolve(); return; }
    opiRecorder.onstop = finish;          // override the default handler for this phase only
    opiStartSilenceDetection();
    // Hard cap — intro can never stall the call indefinitely.
    // Stored in hardCapT so finish() can clear it; without that the timer would
    // fire 30s later into a live interpreter turn and prematurely stop it.
    hardCapT = setTimeout(() => {
      if (opiRecorder && opiRecorder.state !== 'inactive') opiStopRecording();
    }, 30000);
  });
}

// ── Audio Playback → then interpreter turn ───────────────────────
async function opiPlayAudio(audio_b64, speaker, name, text) {
  return new Promise(resolve => {
    opiShowCurrentSpeaker(speaker, name, text);
    const bytes = Uint8Array.from(atob(audio_b64), c=>c.charCodeAt(0));
    const blob  = new Blob([bytes], { type:'audio/mpeg' });
    const url   = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => { URL.revokeObjectURL(url); window._opiTurnEndTs = Date.now(); resolve(); opiStartInterpreterTurn(speaker); };
    audio.onerror = () => { URL.revokeObjectURL(url); window._opiTurnEndTs = Date.now(); resolve(); opiStartInterpreterTurn(speaker); };
    audio.play().catch(() => { window._opiTurnEndTs = Date.now(); resolve(); opiStartInterpreterTurn(speaker); });
  });
}

function opiShowCurrentSpeaker(speaker, name, text) {
  opiLastSourceText    = text;
  opiLastSourceSpeaker = speaker;
  // Update turn indicator in phone widget
  const turnStatusEl = document.getElementById('opi-turn-status');
  if (turnStatusEl) {
    const colors = { provider:'#4878f0', caller:'#a78bfa' };
    turnStatusEl.textContent = `Listening — ${name} speaking`;
    turnStatusEl.style.borderLeftColor = colors[speaker] || '#7c3aed';
  }
}

// ── Interpreter Turn ─────────────────────────────────────────────
async function opiStartInterpreterTurn(prevSpeaker) {
  if (opiEnded) return;
  const tgt = (document.getElementById('opi-tgt-lang')?.value || 'Arabic');
  const hint = prevSpeaker==='provider'
    ? `Render to the caller (${tgt})`
    : `Render to the provider`;
  document.getElementById('opi-render-hint').textContent = hint;
  document.getElementById('opi-your-turn-zone').style.display = 'block';
  // Update turn status indicator
  const turnStatusEl = document.getElementById('opi-turn-status');
  if (turnStatusEl) {
    turnStatusEl.textContent = prevSpeaker==='provider'
      ? `Your turn — render to caller (${tgt})`
      : 'Your turn — render to provider';
    turnStatusEl.style.borderLeftColor = '#f43f5e';
  }
  window._opiInterpStartTs = Date.now();
  // Compute and log latency for this turn
  if (window._opiTurnEndTs && window._opiInterpStartTs) {
    const _lat = window._opiInterpStartTs - window._opiTurnEndTs;
    if (!window._opiLatencies) window._opiLatencies = [];
    window._opiLatencies.push(_lat);
  }
  await opiStartRecording();
  opiStartSilenceDetection();
  // Hard cap — every turn, not just the intro, must eventually advance even if
  // silence detection never fires (quiet mic, high noise floor, no mic at all).
  clearTimeout(opiTurnHardCapT);
  opiTurnHardCapT = setTimeout(() => {
    if (opiRecorder && opiRecorder.state !== 'inactive') opiStopRecording();
  }, 30000);
}

async function opiStartRecording() {
  opiChunks = []; opiRecSecs = 0;
  const stream = opiMicStream && opiMicStream.active ? opiMicStream
    : await navigator.mediaDevices.getUserMedia({ audio:true });
  opiRecorder = new MediaRecorder(stream);
  opiRecorder.ondataavailable = e => { if(e.data.size>0) opiChunks.push(e.data); };
  opiRecorder.onstop = opiOnRecordingDone;
  opiRecorder.start(100);

  // Waveform
  if (opiAnalyser) {
    const waveEl = document.getElementById('wave-opi');
    if (waveEl) {
      waveEl.innerHTML='';
      for(let i=0;i<30;i++){
        const b=document.createElement('div');
        b.className='waveform-bar';
        b.style.cssText=`position:absolute;bottom:0;width:3px;background:var(--red);border-radius:2px 2px 0 0;left:${i*3.5}%`;
        waveEl.appendChild(b);
      }
      (function drawOPIWave(){
        if(!opiRecorder||opiRecorder.state==='inactive') return;
        requestAnimationFrame(drawOPIWave);
        const d=new Uint8Array(opiAnalyser.frequencyBinCount);
        opiAnalyser.getByteFrequencyData(d);
        waveEl.querySelectorAll('.waveform-bar').forEach((b,i)=>{
          const h=(d[Math.floor(i*d.length/30)]/255)*100;
          b.style.height=Math.max(4,h)+'%';
        });
      })();
    }
  }

  // Recording timer
  clearInterval(opiRecTimerI);
  opiRecTimerI = setInterval(() => {
    opiRecSecs++;
    const m=Math.floor(opiRecSecs/60), s=opiRecSecs%60;
    const el = document.getElementById('opi-rec-timer');
    if (el) el.textContent = `${m}:${String(s).padStart(2,'0')}`;
  }, 1000);
}

function opiStopRecording() {
  clearInterval(opiRecTimerI);
  clearInterval(opiSilenceI);
  clearTimeout(opiTurnHardCapT);
  if (opiRecorder && opiRecorder.state!=='inactive') {
    opiRecorder.stop();
  }
}

function opiManualStop() {
  clearInterval(opiSilenceI);
  clearTimeout(opiTurnHardCapT);
  opiStopRecording();
}

function opiStartSilenceDetection() {
  if (!opiAnalyser) { /* no mic — user must press manual stop */ return; }
  let silentFrames  = 0;
  let speechFrames  = 0;
  let speechStarted = false;

  // Two-threshold (hysteresis) design so breathing near the mic doesn't fool the detector:
  //   SPEECH_ON  — RMS must exceed this to mark "speech started". Set well above typical
  //                breath noise (~8-12 RMS) so an inhale/exhale never triggers it.
  //   SILENCE_OFF — RMS must drop below this to start counting toward auto-stop. Slightly
  //                 lower than SPEECH_ON so there's a "grey zone" (breathing between the
  //                 two thresholds) that neither resets the silence counter (old bug: made
  //                 auto-stop impossible) nor counts as speech. In the grey zone we simply
  //                 do nothing — the counter neither advances nor retreats.
  const SPEECH_ON   = 22;   // clearly speaking
  const SILENCE_OFF = 14;   // clearly silent
  const NEED        = 50;   // ~2.5s of confirmed silence at 50ms intervals
  const MIN_SPEECH  = 20;   // require ~1s of real speech before we'll auto-stop at all
                             // (was declared but never enforced — now it is)

  clearInterval(opiSilenceI);
  opiSilenceI = setInterval(() => {
    if (!opiRecorder || opiRecorder.state==='inactive') {
      clearInterval(opiSilenceI); return;
    }
    const d = new Uint8Array(opiAnalyser.frequencyBinCount);
    opiAnalyser.getByteFrequencyData(d);
    const rms = Math.sqrt(d.reduce((a,b)=>a+b*b,0)/d.length);

    if (rms > SPEECH_ON) {
      // Definitely speaking — mark started, accumulate speech frames, reset silence counter
      speechStarted = true;
      speechFrames++;
      silentFrames  = 0;
      // Fire prefetch the instant we're sure it's real speech — gives Claude + TTS
      // maximum time to run in parallel while the interpreter finishes.
      if (speechFrames === MIN_SPEECH) opiTriggerPrefetch();
    } else if (rms <= SILENCE_OFF && speechStarted && speechFrames >= MIN_SPEECH) {
      // Definitely silent, after real speech — advance silence counter
      silentFrames++;
      if (silentFrames >= NEED) {
        clearInterval(opiSilenceI);
        opiStopRecording();
      }
    }
    // Grey zone (SILENCE_OFF < rms <= SPEECH_ON): likely breathing/room noise —
    // do nothing. Counter neither advances nor resets.
  }, 50);
}

// ── Prefetch next turn while interpreter is recording ───────────
// Fired the moment MIN_SPEECH frames are detected (≈1s of real speech).
// The backend generates + TTS-es the next speaker's line in parallel with
// the rest of the interpreter's recording, so it's usually ready by the
// time they stop — reducing perceived latency to STT time only (~2-3s).
function opiTriggerPrefetch() {
  if (!opiSid || opiEnded) return;
  const fd = new FormData();
  fd.append('session_id', opiSid);
  fetch('/api/opi/prefetch-next', { method: 'POST', body: fd })
    .then(r => r.json())
    .then(d => { if (d && d.ok) console.log('[OPI] prefetch started'); })
    .catch(e => console.warn('[OPI] prefetch failed:', e));
}

async function opiOnRecordingDone() {
  clearInterval(opiSilenceI);
  document.getElementById('opi-your-turn-zone').style.display = 'none';
  const turnStatusEl = document.getElementById('opi-turn-status');
  if (turnStatusEl) { turnStatusEl.textContent = 'Processing your rendition…'; turnStatusEl.style.borderLeftColor = '#5a6e90'; }
  if (opiEnded) return;

  const blob = new Blob(opiChunks, { type:'audio/webm' });
  opiCurrentTurnLog.push({ source: opiLastSourceText, rendered: '…' });
  opiAddTranscriptLine('interpreter', 'You (Interpreter)', '…processing…');

  // ── If pre-turns remain, play next one instantly (zero latency) ──
  // We still record the (source, rendition) pair for evaluation — telling the backend
  // exactly which line this was (source_speaker/source_text) so it never has to guess
  // or generate a throwaway line. need_next=false skips Claude+TTS entirely; this is
  // just a transcription + bookkeeping round trip, so it's cheap to await and keeps
  // pairs strictly in order (no race between overlapping background requests).
  if (opiPreTurnsQueue.length > 0) {
    const renderedSpeaker = opiLastSourceSpeaker;
    const renderedText    = opiLastSourceText;

    const pt   = opiPreTurnsQueue.shift();
    const sc   = opiData?.scenario || {};
    const name = pt.speaker === 'provider' ? (sc.provider_name||'Provider') : (sc.caller_name||'Caller');
    // Update interpreter placeholder optimistically
    const lines = document.getElementById('opi-transcript').children;
    if (lines.length > 0) {
      const tEl = lines[lines.length-1].querySelector('.opi-spk-txt');
      if (tEl) tEl.textContent = '(interpretation recorded)';
    }
    if (opiCurrentTurnLog.length > 0) opiCurrentTurnLog[opiCurrentTurnLog.length-1].rendered = '(recorded — see call summary)';

    const fd2 = new FormData();
    fd2.append('session_id', opiSid);
    fd2.append('audio', blob, 'interp.webm');
    fd2.append('source_speaker', renderedSpeaker);
    fd2.append('source_text', renderedText);
    fd2.append('need_next', 'false');
    try { await fetch('/api/opi/next-turn', { method:'POST', body:fd2 }); } catch(e) {}

    opiAddTranscriptLine(pt.speaker, name, pt.text);
    await opiPlayAudio(pt.audio_b64, pt.speaker, name, pt.text);
    return;
  }

  // ── All pre-turns exhausted → live API ──────────────────────────
  // This call both records the pairing for the LAST buffered/live line the user just
  // rendered (source_speaker/source_text) AND asks the backend to generate + return
  // the next live line.
  const fd = new FormData();
  fd.append('session_id', opiSid);
  fd.append('audio', blob, 'interp.webm');
  fd.append('source_speaker', opiLastSourceSpeaker);
  fd.append('source_text', opiLastSourceText);
  fd.append('need_next', 'true');

  try {
    const r = await fetch('/api/opi/next-turn', { method:'POST', body:fd });
    const d = await r.json();

    // Update interpreter line with real transcript
    const lines = document.getElementById('opi-transcript').children;
    if (lines.length > 0) {
      const last = lines[lines.length-1];
      const tEl = last.querySelector('.opi-spk-txt');
      if (tEl) tEl.textContent = d.interpreter_transcript || '—';
    }
    // Update turn log
    if (opiCurrentTurnLog.length > 0) {
      opiCurrentTurnLog[opiCurrentTurnLog.length - 1].rendered = d.interpreter_transcript || '';
    }

    if (d.is_call_ended || opiEnded) {
      opiEndCall(); return;
    }

    // Show event badge in turn status if the backend fired an event
    if (d.event && d.event !== '') {
      const eventLabels = {
        'emotional':     'Caller is getting emotional',
        'clarification': 'Caller needs clarification',
        'interruption':  '⚡ Caller interrupting',
        'long_utterance':'Warning: Long utterance — hold everything',
      };
      const turnStatusEl = document.getElementById('opi-turn-status');
      if (turnStatusEl) {
        turnStatusEl.textContent = eventLabels[d.event] || `Event: ${d.event}`;
        turnStatusEl.style.borderLeftColor = '#e8971e';
      }
    }

    // Add next party's line and play
    const sc = (opiData && opiData.scenario) || {};
    const name = d.speaker==='provider'
      ? (sc.provider_name||'Provider')
      : (sc.caller_name||'Caller');
    opiAddTranscriptLine(d.speaker, name, d.text);
    await opiPlayAudio(d.audio_b64, d.speaker, name, d.text);

  } catch(e) {
    console.error('Next turn error:', e);
  }
}

function opiAddTranscriptLine(speaker, name, text) {
  const colors = { provider:'#4878f0', caller:'#a78bfa', interpreter:'#f43f5e' };
  const el = document.createElement('div');
  el.style.cssText = 'margin-bottom:8px';
  el.innerHTML = `
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:${colors[speaker]||'#5a6e90'};margin-bottom:2px">${name}</div>
    <div class="opi-spk-txt" style="font-size:12px;color:var(--text);line-height:1.5">${text}</div>`;
  const transcript = document.getElementById('opi-transcript');
  if (transcript) { transcript.appendChild(el); transcript.scrollTop = transcript.scrollHeight; }
}

// ── End Call ────────────────────────────────────────────────────
async function opiEndCall() {
  if (opiEnded) return;
  opiEnded = true;
  clearInterval(opiCallTimerI);
  clearInterval(opiSilenceI);
  opiStopRecording();
  const timerTop = document.getElementById('opi-call-timer-top');
  if (timerTop) timerTop.style.display = 'none';

  // Go back to waiting state while evaluating
  opiSetState('waiting');
  const wf = document.getElementById('opi-waiting-field');

  // Evaluation involves a real LLM call grading every turn, so it can take
  // 10-20+ seconds — rotate status messages so it reads as active progress
  // rather than a frozen button.
  const evalMsgs = [
    'Evaluating call…', 'Reviewing your interpretations…',
    'Checking accuracy and terminology…', 'Scoring fluency and protocol…',
    'Putting together your coaching notes…', 'Almost done…'
  ];
  let evalMsgI = 0;
  if (wf) wf.textContent = evalMsgs[0];
  const evalMsgTimer = setInterval(() => {
    evalMsgI = Math.min(evalMsgI + 1, evalMsgs.length - 1);
    if (wf) wf.textContent = evalMsgs[evalMsgI];
  }, 4000);

  const fd = new FormData();
  fd.append('session_id', opiSid);
  try {
    const r = await fetch('/api/opi/end-call', { method:'POST', body:fd });
    const d = await r.json();
    clearInterval(evalMsgTimer);

    // Store in log
    const callNum = opiCallLogs.length + 1;
    const m = Math.floor(opiCallSecs/60), s = opiCallSecs%60;
    const sc = opiData?.scenario || {};
    const _opiEntry = {
      num: callNum,
      date: new Date().toLocaleTimeString(),
      field: document.getElementById('opi-field').value,
      lang: opiGetLang(),
      duration: `${m}:${String(s).padStart(2,'0')}`,
      grade: d.grade,
      overall: d.overall_score,
      scenario: sc,
      eval: d,
      turnLog: d.turn_log || opiCurrentTurnLog,
      turnEvals: d.turn_evaluations || [],
    };
    opiCallLogs.unshift(_opiEntry);
    try { _handlePlacementOrCalibrationResult('opi', d.overall_score); } catch(_e) {}

    // ── Persist KPIs to localStorage so Dashboard & Progress can read them ──
    try {
      const _stored = JSON.parse(localStorage.getItem('opi-sessions') || '[]');
      // Aggregate omission/addition rates from per-turn verdicts
      const _turnEvals = d.turn_evaluations || [];
      const _totalTurns = _turnEvals.length || 1;
      const _omissionCount  = _turnEvals.filter(t => t.verdict === 'omission').length;
      const _additionCount  = _turnEvals.filter(t => t.verdict === 'addition').length;
      const _omission_rate  = Math.round((_omissionCount  / _totalTurns) * 100);
      const _addition_rate  = Math.round((_additionCount  / _totalTurns) * 100);
      // Compute avg response latency from per-turn timestamps
      const _lats = window._opiLatencies || [];
      const _avg_latency_ms = _lats.length
        ? Math.round(_lats.reduce((a,v)=>a+v,0)/_lats.length)
        : null;
      window._opiLatencies = []; // reset for next call

      _stored.unshift({
        isoDate: new Date().toISOString(),
        date: _opiEntry.date,
        field: _opiEntry.field,
        lang: _opiEntry.lang,
        duration: _opiEntry.duration,
        grade: d.grade,
        overall_score: d.overall_score,
        accuracy: d.accuracy || 0,
        fusha_compliance: d.fusha_compliance || 0,
        completeness: d.completeness || 0,
        terminology: d.terminology || 0,
        fluency: d.fluency || 0,
        professional_protocol: d.professional_protocol || 0,
        omission_rate: _omission_rate,
        addition_rate: _addition_rate,
        avg_latency_ms: _avg_latency_ms,
        turns_evaluated: _totalTurns,
        scenario: sc.title || sc.field || _opiEntry.field,
      });
      localStorage.setItem('opi-sessions', JSON.stringify(_stored.slice(0, 200)));
    } catch(_e) { console.warn('OPI session persist failed:', _e); }

    opiRenderLogs();
    opiUpdateStats();
    if (wf) wf.textContent = 'Call evaluation ready';
    opiShowEvalSheet(opiCallLogs[0]);

    opiSid = null;  // clear so opiCloseEval knows it can trigger

    if (opiPendingOffline) {
      // User requested "Go Offline (after this call)" while the call was active —
      // honor it now instead of auto-queueing another incoming call.
      opiPendingOffline = false;
      opiStopMicTest();
      opiSetState('offline');
    } else {
      // Start generating the NEXT call in the background while the user reads the eval.
      // By the time they close the sheet, the new scenario + audio will already be ready.
      const _nf = document.getElementById('opi-field').value;
      const _nl = opiGetLang();
      const _nd = parseInt(document.getElementById('opi-duration').value);
      const _ndf = document.getElementById('opi-difficulty').value;
      opiTriggerIncoming(_nf, _nl, _nd, _ndf);
    }

  } catch(e) {
    clearInterval(evalMsgTimer);
    console.error('Evaluation failed:', e);
    opiSetState('waiting');
    if (wf) wf.textContent = `${document.getElementById('opi-field').value} · ${opiGetLang()}`;
  }
}

// ── Logs rendering ───────────────────────────────────────────────
function opiRenderLogs() {
  const container = document.getElementById('opi-logs-list');
  const countEl = document.getElementById('opi-log-count');
  if (countEl) countEl.textContent = `${opiCallLogs.length} call${opiCallLogs.length!==1?'s':''}`;

  if (!opiCallLogs.length) {
    container.innerHTML = '<div style="padding:14px 20px;font-size:12px;color:var(--dim);text-align:center">No calls yet</div>';
    return;
  }

  container.innerHTML = opiCallLogs.map((log, i) => {
    const gradeColors = { Excellent:'#22c55e', Good:'#e8971e', Satisfactory:'#fb923c', 'Needs Work':'#f43f5e' };
    const gc = gradeColors[log.grade] || '#e8971e';
    return `<div class="opi-log-item" id="opi-log-${i}">
      <div class="opi-log-summary" onclick="opiToggleLog(${i})">
        <div>
          <span style="font-size:12px;font-weight:700;color:var(--text)">Call #${log.num}</span>
          <span style="font-size:11px;color:var(--dim);margin-left:8px">${log.field} · ${log.lang} · ${log.duration}</span>
          <span style="font-size:11px;color:var(--dim);margin-left:6px">${log.date}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:13px;font-weight:800;font-family:monospace;color:${gc}">${log.overall}/100</span>
          <span style="font-size:11px;font-weight:700;color:${gc}">${log.grade}</span>
          <span style="font-size:10px;color:var(--dim)">▼</span>
        </div>
      </div>
      <div class="opi-log-detail" id="opi-log-detail-${i}">
        ${opiRenderLogDetail(log)}
      </div>
    </div>`;
  }).join('');
}

function opiToggleLog(i) {
  const detail = document.getElementById(`opi-log-detail-${i}`);
  if (!detail) return;
  const open = detail.classList.toggle('open');
  const arrow = document.querySelector(`#opi-log-${i} .opi-log-summary span:last-child`);
  if (arrow) arrow.textContent = open ? '▲' : '▼';
}

// ── Stats card update ────────────────────────────────────────────
function opiUpdateStats() {
  const todayEl = document.getElementById('opi-calls-today');
  const accEl   = document.getElementById('opi-avg-acc');
  const protoEl = document.getElementById('opi-avg-proto');
  if (todayEl) todayEl.textContent = opiCallLogs.length;
  const recent = opiCallLogs.slice(0, 10);
  if (recent.length > 0) {
    const avgAcc   = Math.round(recent.reduce((a,l)=>a+(l.eval?.accuracy||0),0)/recent.length);
    const avgProto = Math.round(recent.reduce((a,l)=>a+(l.eval?.professional_protocol||0),0)/recent.length);
    if (accEl)   accEl.textContent   = avgAcc   || '—';
    if (protoEl) protoEl.textContent = avgProto || '—';
  }
}

// ── Evaluation sheet (slides up after call ends) ─────────────────
let opiFullEvalData = null;
function opiShowEvalSheet(log) {
  if (!log) return;
  opiFullEvalData = log;
  const overlay  = document.getElementById('opi-eval-overlay');
  const subtitle = document.getElementById('opi-eval-subtitle');
  const kpiBars  = document.getElementById('opi-eval-kpi-bars');
  if (!overlay) return;
  if (subtitle) subtitle.textContent = `${log.field} · ${log.lang} · ${log.duration} · ${log.grade||'—'}`;
  const d = log.eval || {};
  // Aggregate omission/addition rates from turn_evaluations
  // Latency badge in mini eval sheet
  const _latEl = document.getElementById('opi-eval-latency');
  if (_latEl) {
    const _lats2 = window._opiLatencies && window._opiLatencies.length
      ? window._opiLatencies
      : [];
    if (_lats2.length > 0) {
      const _avgLat = Math.round(_lats2.reduce((a,v)=>a+v,0)/_lats2.length);
      const _latColor = _avgLat<2000?'var(--green)':_avgLat<4000?'var(--gold)':'var(--red)';
      _latEl.innerHTML = `Avg response latency: <strong style="color:${_latColor}">${(_avgLat/1000).toFixed(1)}s</strong> <span style="color:var(--dim)">(target &lt;4s)</span>`;
      _latEl.style.display = '';
    } else {
      _latEl.style.display = 'none';
    }
  }

  const _tev = d.turn_evaluations || [];
  const _tTotal = _tev.length || 1;
  const _omPct = Math.round((_tev.filter(t=>t.verdict==='omission').length / _tTotal)*100);
  const _adPct = Math.round((_tev.filter(t=>t.verdict==='addition').length / _tTotal)*100);

  const scores = [
    { l:'Overall',      v: d.overall_score },
    { l:'Accuracy',     v: d.accuracy },
    { l:'Fusha',        v: d.fusha_compliance },
    { l:'Completeness', v: d.completeness },
    { l:'Terminology',  v: d.terminology },
    { l:'Fluency',      v: d.fluency },
    { l:'Protocol',     v: d.professional_protocol },
    { l:'Omission %',   v: _omPct, invert: true },
    { l:'Addition %',   v: _adPct, invert: true }
  ];
  if (kpiBars) kpiBars.innerHTML = scores.map(s => {
    const _iv = s.invert; // lower is better for omission/addition rates
    const _sv = s.v||0;
    const c = _iv
      ? (_sv<=5?'#22c55e':_sv<=15?'#e8971e':_sv<=30?'#fb923c':'#f43f5e')
      : (_sv>=85?'#22c55e':_sv>=70?'#e8971e':_sv>=50?'#fb923c':'#f43f5e');
    const _barW = _iv ? Math.min(_sv*3, 100) : (_sv||0);
    return `<div>
      <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px">
        <span style="color:var(--dim)">${s.l}</span>
        <span style="color:${c};font-weight:700">${s.v||'—'}${_iv?'%':''}</span>
      </div>
      <div style="background:var(--bg3);border-radius:3px;height:4px;overflow:hidden">
        <div style="background:${c};height:100%;width:${Math.max(2,_barW)}%;border-radius:3px"></div>
      </div>
    </div>`;
  }).join('');
  overlay.style.display = 'flex';
}
function opiEvalBgClose(event) { opiCloseEval(); }
function opiCloseEval() {
  const overlay = document.getElementById('opi-eval-overlay');
  if (overlay) overlay.style.display = 'none';
  // If a pending "Go Offline (after this call)" request already took us
  // offline (see opiEndCall()), don't auto-queue another incoming call.
  const offlineEl = document.getElementById('opi-ps-offline');
  if (offlineEl && offlineEl.style.display === 'block') return;
  // Start generating the next call immediately after eval is dismissed
  const field = document.getElementById('opi-field').value;
  const lang  = opiGetLang();
  const dur   = parseInt(document.getElementById('opi-duration').value);
  const diff  = document.getElementById('opi-difficulty').value;
  const wf = document.getElementById('opi-waiting-field');
  if (wf) wf.textContent = `${field} · ${lang} · ${dur} min`;
  // Only trigger if we're still in waiting state and not already generating
  if (!opiIncomingT && !opiSid) {
    opiTriggerIncoming(field, lang, dur, diff);
  }
}
function opiOpenFullEval() {
  const fullEval = document.getElementById('opi-full-eval');
  if (!fullEval || !opiFullEvalData) return;
  const log = opiFullEvalData;
  const titleEl = document.getElementById('opi-full-eval-title');
  const subEl   = document.getElementById('opi-full-eval-sub');
  const contEl  = document.getElementById('opi-full-eval-content');
  if (titleEl) titleEl.textContent = `${log.field.charAt(0).toUpperCase()+log.field.slice(1)} Call — #${log.num}`;
  if (subEl)   subEl.textContent   = `${log.date} · ${log.duration} · ${log.grade||'—'}`;
  if (contEl)  contEl.innerHTML    = opiRenderLogDetail(log);
  fullEval.style.display = 'block';
}
function opiCloseFullEval() {
  const fullEval = document.getElementById('opi-full-eval');
  if (fullEval) fullEval.style.display = 'none';
}

function opiRenderLogDetail(log) {
  const d = log.eval;
  const sc = log.scenario || {};

  // ── Scores ──
  const scores = [
    {l:'Overall', v:d.overall_score},{l:'Accuracy', v:d.accuracy},
    {l:'Fusha', v:d.fusha_compliance},{l:'Complete', v:d.completeness},
    {l:'Terms', v:d.terminology},{l:'Fluency', v:d.fluency},{l:'Protocol', v:d.professional_protocol}
  ];
  const scoresHtml = `<div class="opi-eval-scores-sm">${scores.map(s=>{
    const c=s.v>=85?'#22c55e':s.v>=70?'#e8971e':s.v>=50?'#fb923c':'#f43f5e';
    return `<div style="background:var(--bg1);border:1px solid var(--border);border-radius:7px;padding:9px;text-align:center">
      <div style="font-size:18px;font-weight:800;font-family:monospace;color:${c}">${s.v||'—'}</div>
      <div style="font-size:10px;color:var(--dim);margin-top:2px;text-transform:uppercase">${s.l}</div>
    </div>`;
  }).join('')}</div>`;

  // ── Call info ──
  const infoHtml = `<div style="margin-bottom:10px;font-size:12px;color:var(--dim);line-height:1.7">
    <strong style="color:var(--text)">${sc.provider_name||'Provider'}</strong> (${sc.provider_role||''}) — ${sc.setting||log.field}<br>
    <strong style="color:var(--text)">Issue:</strong> ${sc.chief_issue||'OPI call'}<br>
    ${d.summary ? `<div style="margin-top:6px;color:var(--text);font-style:italic">"${d.summary}"</div>` : ''}
  </div>`;

  // ── Section 1: Full dialogue ──
  const turnEvals = log.turnEvals || [];
  const dialogueRows = turnEvals.map((te, i) => {
    const vClass = te.verdict || 'acceptable';
    return `<div style="margin-bottom:10px">
      <div style="font-size:10px;color:var(--dim);margin-bottom:4px">Turn ${i+1} — ${te.speaker||''}</div>
      <div class="opi-dialogue-row">
        <div class="opi-dialogue-src">
          <div style="font-size:10px;font-weight:700;color:var(--dim);margin-bottom:3px">SOURCE</div>
          ${te.source_text||''}
        </div>
        <div class="opi-dialogue-rnd">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
            <span style="font-size:10px;font-weight:700;color:var(--green)">YOU SAID</span>
            <span class="opi-verdict ${vClass}">${(vClass||'').replace('_',' ')}</span>
          </div>
          ${te.interpreter_said||'—'}
        </div>
      </div>
      ${te.note ? `<div style="font-size:11px;color:var(--dim);margin-top:3px;padding-left:4px"> ${te.note}</div>` : ''}
      ${te.omissions ? `<div style="font-size:11px;color:var(--red);margin-top:2px;padding-left:4px">✗ Omitted: ${te.omissions}</div>` : ''}
      ${te.additions ? `<div style="font-size:11px;color:var(--gold);margin-top:2px;padding-left:4px">+ Added: ${te.additions}</div>` : ''}
    </div>`;
  }).join('');

  const dialogueHtml = `<div class="opi-log-section">
    <div class="opi-log-section-title" style="background:var(--bg1);color:var(--blue2)">Full Dialogue</div>
    <div style="font-size:11px;color:var(--dim);margin-bottom:8px">Source utterance (left) vs. what you rendered (right)</div>
    ${dialogueRows || '<div style="font-size:12px;color:var(--dim)">No turn data available</div>'}
  </div>`;

  // ── Section 2: Correct translations ──
  const correctRows = turnEvals.map((te, i) => {
    if (!te.ideal_rendition) return '';
    const isOk = te.verdict === 'correct' || te.verdict === 'acceptable';
    return `<div style="margin-bottom:10px">
      <div style="font-size:10px;color:var(--dim);margin-bottom:4px">Turn ${i+1}</div>
      <div class="opi-dialogue-row">
        <div class="opi-dialogue-rnd">
          <div style="font-size:10px;font-weight:700;color:var(--green);margin-bottom:3px">YOU SAID</div>
          ${te.interpreter_said||'—'}
        </div>
        <div class="opi-dialogue-ideal">
          <div style="font-size:10px;font-weight:700;color:var(--gold);margin-bottom:3px">IDEAL RENDITION</div>
          ${te.ideal_rendition}
        </div>
      </div>
    </div>`;
  }).filter(Boolean).join('');

  const correctHtml = `<div class="opi-log-section">
    <div class="opi-log-section-title" style="background:rgba(232,151,30,.07);color:var(--gold)">Correct Translation</div>
    <div style="font-size:11px;color:var(--dim);margin-bottom:8px">Your rendition (left) vs. what a Band 8 interpreter would say (right)</div>
    ${correctRows || '<div style="font-size:12px;color:var(--dim)">No corrections needed or data unavailable</div>'}
  </div>`;

  // ── Section 3: AI Feedback ──
  let feedbackHtml = `<div class="opi-log-section">
    <div class="opi-log-section-title" style="background:rgba(34,197,94,.07);color:var(--green)">Notes, Tips & Recommendations</div>`;
  if (d.strengths?.length) feedbackHtml += `<div style="margin-bottom:8px"><div style="font-size:11px;font-weight:700;color:var(--green);margin-bottom:5px">✦ Strengths</div><div style="display:flex;flex-wrap:wrap;gap:5px">${d.strengths.map(s=>`<span style="background:rgba(34,197,94,.07);color:var(--green);border:1px solid rgba(34,197,94,.25);padding:2px 9px;border-radius:20px;font-size:11px">${s}</span>`).join('')}</div></div>`;
  if (d.protocol_notes) feedbackHtml += `<div style="margin-bottom:8px;background:rgba(232,151,30,.07);border-left:3px solid #e8971e;padding:8px 12px;border-radius:0 6px 6px 0;font-size:12px;color:var(--text)"><strong style="color:var(--gold)">Protocol: </strong>${d.protocol_notes}</div>`;
  if (d.coaching_tips?.length) feedbackHtml += `<div style="margin-bottom:8px"><div style="font-size:11px;font-weight:700;color:var(--amber);margin-bottom:5px">▲ Tips for Next Call</div>${d.coaching_tips.map(t=>`<div style="font-size:12px;color:var(--text);padding:4px 0;border-bottom:1px solid #1e2d46">• ${t}</div>`).join('')}</div>`;
  if (d.next_drill) feedbackHtml += `<div style="background:var(--bg1);border:1px solid var(--border);border-radius:7px;padding:10px 12px;font-size:12px;margin-top:4px"><span style="color:var(--gold);font-weight:700">Next Drill: </span>${d.next_drill}</div>`;
  feedbackHtml += `</div>`;

  return `<div style="padding-top:12px">
    ${infoHtml}
    ${scoresHtml}
    ${dialogueHtml}
    ${correctHtml}
    ${feedbackHtml}
  </div>`;
}

function toggleOPITranscript() {} // kept for compatibility

function opiNewCall() {
  opiSid=null; opiData=null; opiEnded=false; opiPreTurnsQueue=[];
  opiTranscriptLines=[]; opiCurrentTurnLog=[]; opiLastSourceText='';
  clearInterval(opiCallTimerI); clearTimeout(opiIncomingT);
  const tt = document.getElementById('opi-call-timer-top');
  if (tt) tt.style.display = 'none';
  opiSetState('offline');
}
