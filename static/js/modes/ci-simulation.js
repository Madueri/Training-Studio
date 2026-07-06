/**
 * @module modes/ci-simulation.js
 * @description CI/SI Simulation Overlay — full simulation engine with canvas, timer, scoring
 *
 * MAD Training Studio — Interpretation Practice Platform
 * © 2025 InterpretLab. All rights reserved.
 */

/**
 * @description Displays the CI/SI simulation overlay and initializes it for the specified interpretation mode.
 *              Validates the mode kind against supported modes, resets rotation state, and triggers overlay initialization.
 * @param {string} modeKind - The interpretation mode kind. Supported: 'simultaneous', 'chuchotage', 'escort', 'sight'; defaults to 'consecutive'.
 * @returns {void}
 */
async function showCISim(modeKind) {
  const ready = await _loadOverlay('ci-sim-overlay', 'overlay-ci.html');
  if (!ready) return;
  ciModeKind = ['simultaneous','chuchotage','escort','sight'].includes(modeKind) ? modeKind : 'consecutive';
  ciRotationShown = false;
  const ov = document.getElementById('ci-sim-overlay');
  if (ov) ov.style.display = 'flex';
  ciInitCIOverlay();
}


/**
 * @description Hides the CI simulation overlay and performs full cleanup of active session resources.
 *              Stops canvas animation, timers, audio playback, camera stream, and media recording.
 * @returns {void}
 */
function exitCISim() {
  const ov = document.getElementById('ci-sim-overlay'); // Lookup DOM element 'ci-sim-overlay'
  if (ov) ov.style.display = 'none'; // Hide the element
  ciStopCanvas(); // Invoke ciStopCanvas()
  ciStopSessionTimer(); // Invoke ciStopSessionTimer()
  if (ciAudioEl) { try { ciAudioEl.pause(); } catch(e){} } // Pause audio playback
  if (ciCameraStream) { ciCameraStream.getTracks().forEach(t=>t.stop()); ciCameraStream = null; } // Iterate over each element
  if (ciMediaRecorder && ciMediaRecorder.state !== 'inactive') { try{ciMediaRecorder.stop();}catch(e){} } // Stop media track
  ciMediaRecorder = null; // Assign value to 'ciMediaRecorder'
  if (ciDecalageTimer) { clearInterval(ciDecalageTimer); ciDecalageTimer = null; } // Stop repeating interval timer
  ciSegStartTs = 0; ciRecStartTs = 0; // Assign value to 'ciSegStartTs'
}


/**
 * @description Switches the visible view within the CI overlay by toggling display CSS.
 *              Hides all known view panels except the one matching the provided viewId.
 * @param {string} viewId - The DOM id of the view panel to show.
 * @returns {void}
 */
function ciSwitchView(viewId) {
  ['ci-pre-view','ci-brief-view','ci-loading-view','ci-prep-view','ci-session-view','ci-eval-view'].forEach(id => { // Iterate over each element
    const el = document.getElementById(id);
    if (el) el.style.display = id === viewId ? '' : 'none'; // Toggle element visibility
  });
}


/**
 * @description Initializes the CI overlay UI on first open.
 *              Populates language, field, and dialect dropdowns; sets default values; resets verbatim toggle.
 * @returns {void}
 */
function ciInitCIOverlay() {
  const LANGS = ['Arabic','English','French','Spanish','German','Italian','Russian','Chinese','Portuguese','Japanese']; // Initialize variable 'LANGS'
  const fieldSel = document.getElementById('ci-field-sel'); // Lookup DOM element 'ci-field-sel'
  if (fieldSel && !fieldSel.dataset.init) { // Mark element as initialized
    fieldSel.innerHTML = Object.entries(CI_FIELD_NAMES).map(([k])=> // Set HTML content
      `<option value="${k}"${k==='medical'?' selected':''}>${k.charAt(0).toUpperCase()+k.slice(1)}</option>`).join(''); // Join array into string
    fieldSel.dataset.init = '1'; // Mark element as initialized
  }
  const srcSel = document.getElementById('ci-src-lang'); // Lookup DOM element 'ci-src-lang'
  if (srcSel && !srcSel.dataset.init) { // Mark element as initialized
    srcSel.innerHTML = LANGS.map(l=>`<option value="${l}"${l==='English'?' selected':''}>${l}</option>`).join(''); // Set HTML content
    srcSel.dataset.init = '1'; // Mark element as initialized
  }
  const tgtSel = document.getElementById('ci-tgt-lang'); // Lookup DOM element 'ci-tgt-lang'
  if (tgtSel && !tgtSel.dataset.init) { // Mark element as initialized
    tgtSel.innerHTML = LANGS.map(l=>`<option value="${l}"${l==='Arabic'?' selected':''}>${l}</option>`).join(''); // Set HTML content
    tgtSel.dataset.init = '1'; // Mark element as initialized
  }
  ciSrcLangChanged('English'); // Invoke ciSrcLangChanged()
  ciTgtLangChanged('Arabic'); // Invoke ciTgtLangChanged()
  ciFieldChanged('medical'); // Invoke ciFieldChanged()
  ciApplyModeKindUI(); // Invoke ciApplyModeKindUI()
  // Reset Legal Verbatim toggle to off by default
  ciVerbatim = false; // Assign value to 'ciVerbatim'
  const vb = document.getElementById('ci-verbatim'); // Lookup DOM element 'ci-verbatim'
  if (vb) vb.checked = false; // Evaluate conditional branch
  ciSwitchView('ci-pre-view'); // Invoke ciSwitchView()
}

// Reflect ciModeKind ('consecutive'|'simultaneous') across header badge, replay
// availability, and the RSI atmosphere selector. Called on overlay open and on
// atmosphere change. No new generated-content path — same CI backend, mode flag only.

/**
 * @description Determines whether the current mode requires live rendering (SI or Chuchotage).
 * @returns {boolean} True if ciModeKind is 'simultaneous' or 'chuchotage'; otherwise false.
 */
function ciIsLiveRender() { return ciModeKind === 'simultaneous' || ciModeKind === 'chuchotage'; }

// ── Auto-start recording for SI/Chuchotage (called when source audio begins) ──

/**
 * @description Automatically starts camera recording for SI/Chuchotage modes.
 *              Initializes MediaRecorder with VP8/Opus codecs, sets up data handlers, updates UI indicators.
 * @returns {void}
 */
function ciAutoStartRecording() {
  if (!ciCameraStream) return; // camera not available — cannot auto-record
  if (!ciMediaRecorder || ciMediaRecorder.state === 'inactive') { // Evaluate conditional branch
    ciRecordChunks = []; // Assign value to 'ciRecordChunks'
    try { // Begin try block
      ciMediaRecorder = new MediaRecorder(ciCameraStream, {mimeType:'video/webm;codecs=vp8,opus'}); // Create media recorder instance
    } catch(e) { // Handle exception
      ciMediaRecorder = new MediaRecorder(ciCameraStream); // Create media recorder instance
    }
    ciMediaRecorder.ondataavailable = e => { if (e.data.size > 0) ciRecordChunks.push(e.data); }; // Bind data available handler
    ciMediaRecorder.onstop = () => { // Bind recording stop handler
      const blob = new Blob(ciRecordChunks, {type:'video/webm'}); // Create binary blob from data
      const url  = URL.createObjectURL(blob); // Generate object URL for blob
      const a    = document.createElement('a'); // Create new DOM element
      a.href     = url;
      a.download = `ci-session-${Date.now()}.webm`; // Get current timestamp
      a.click(); // Programmatically click element
      URL.revokeObjectURL(url); // Revoke object URL to free memory
      ciRecordChunks = []; // Assign value to 'ciRecordChunks'
    };
    ciMediaRecorder.start();
    // Sync session-view camera button
    const sessCamBtn = document.getElementById('ci-cam-btn'); // Lookup DOM element 'ci-cam-btn'
    if (sessCamBtn) { // Evaluate conditional branch
      sessCamBtn.textContent = 'Stop Recording'; // Set text content
      sessCamBtn.style.background  = 'rgba(244,63,94,.22)'; // Set background style
      sessCamBtn.style.borderColor = 'rgba(244,63,94,.6)'; // Set border color
      sessCamBtn.style.color       = 'var(--red)'; // Set text color
    }
    // Pulsing red dot
    const head = document.querySelector('.ci-sess-right .ci-camera-head') || document.querySelector('.ci-camera-head'); // Query DOM for '.ci-sess-right .ci-camera-head'
    if (head && !head.querySelector('.ci-rec-dot')) { // Evaluate conditional branch
      const dot = document.createElement('span'); // Create new DOM element
      dot.className   = 'ci-rec-dot';
      dot.title       = 'Recording';
      dot.style.cssText = 'display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--red);animation:ciRecPulse 1s ease-in-out infinite;margin-left:4px'; // Apply inline CSS styles
      head.insertBefore(dot, head.querySelector('.ci-camera-btn') || head.firstChild); // Insert element before reference
    }
  }
  ciRecStartTs = Date.now(); // Get current timestamp
}

// ── Stop auto-recording (segment end or session end) ─────────────────────────

/**
 * @description Stops the active MediaRecorder and resets camera UI to idle state.
 * @returns {void}
 */
function ciAutoStopRecording() {
  if (ciMediaRecorder && ciMediaRecorder.state !== 'inactive') { // Evaluate conditional branch
    ciMediaRecorder.stop(); // Stop media track
  }
  // Sync session-view camera button
  const sessCamBtn = document.getElementById('ci-cam-btn'); // Lookup DOM element 'ci-cam-btn'
  if (sessCamBtn) { // Evaluate conditional branch
    sessCamBtn.textContent = 'Record'; // Set text content
    sessCamBtn.style.background  = 'rgba(244,63,94,.12)'; // Set background style
    sessCamBtn.style.borderColor = 'rgba(244,63,94,.35)'; // Set border color
    sessCamBtn.style.color       = 'var(--red)'; // Set text color
  }
  document.querySelector('.ci-rec-dot')?.remove(); // Remove element from DOM if present
}


/**
 * @description Applies mode-specific UI adjustments based on ciModeKind.
 *              Updates header title, badge, visibility of controls, and enforces protocol restrictions on difficulty and duration.
 * @returns {void}
 */
function ciApplyModeKindUI() {
  const isSI = ciModeKind === 'simultaneous';
  const isChuchotage = ciModeKind === 'chuchotage';
  const isEscort = ciModeKind === 'escort';
  const isSight = ciModeKind === 'sight';
  const isLiveRender = ciIsLiveRender();
  const MODE_META = {
    consecutive:  {title: 'CI Simulation', badge: 'CONSECUTIVE', color: 'var(--blue)',   bg: 'rgba(72,120,240,.08)',  border: 'rgba(72,120,240,.2)'},
    simultaneous: {title: 'SI Simulation', badge: 'SIMULTANEOUS', color: 'var(--purple)', bg: 'rgba(167,139,250,.08)', border: 'rgba(167,139,250,.2)'},
    chuchotage:   {title: 'Chuchotage Simulation', badge: 'CHUCHOTAGE', color: 'var(--teal)', bg: 'rgba(45,212,191,.08)', border: 'rgba(45,212,191,.2)'},
    escort:       {title: 'Escort/Liaison Simulation', badge: 'ESCORT/LIAISON', color: 'var(--gold)', bg: 'rgba(232,151,30,.08)', border: 'rgba(232,151,30,.2)'},
    sight:        {title: 'Sight Translation Simulation', badge: 'SIGHT TRANSLATION', color: 'var(--amber)', bg: 'rgba(245,158,11,.08)', border: 'rgba(245,158,11,.2)'},
  };
  const meta = MODE_META[ciModeKind] || MODE_META.consecutive;
  const titleEl = document.querySelector('.ci-ov-hdr span[style*="font-weight:800"]');
  if (titleEl) titleEl.textContent = meta.title; // Set text content
  const badgeEl = document.getElementById('ci-mode-badge'); // Lookup DOM element 'ci-mode-badge'
  if (badgeEl) { // Evaluate conditional branch
    badgeEl.textContent = meta.badge; // Set text content
    badgeEl.style.color = meta.color; // Set text color
    badgeEl.style.background = meta.bg; // Set background style
    badgeEl.style.borderColor = meta.border; // Set border color
  }
  const atmoWrap = document.getElementById('ci-atmosphere-wrap'); // Lookup DOM element 'ci-atmosphere-wrap'
  if (atmoWrap) atmoWrap.style.display = isSI ? '' : 'none'; // Toggle element visibility
  const noiseWrap = document.getElementById('ci-noise-wrap'); // Lookup DOM element 'ci-noise-wrap'
  if (noiseWrap) noiseWrap.style.display = isChuchotage ? '' : 'none'; // Toggle element visibility
  const noiseWrap2 = document.getElementById('ci-noise-wrap2'); // Lookup DOM element 'ci-noise-wrap2'
  if (noiseWrap2) noiseWrap2.style.display = isChuchotage ? '' : 'none'; // Toggle element visibility
  const scenarioWrap = document.getElementById('ci-scenario-wrap'); // Lookup DOM element 'ci-scenario-wrap'
  if (scenarioWrap) scenarioWrap.style.display = isEscort ? '' : 'none'; // Toggle element visibility
  const doctypeWrap = document.getElementById('ci-doctype-wrap'); // Lookup DOM element 'ci-doctype-wrap'
  if (doctypeWrap) doctypeWrap.style.display = isSight ? '' : 'none'; // Toggle element visibility
  const verbatimWrap = document.getElementById('ci-verbatim-wrap'); // Lookup DOM element 'ci-verbatim-wrap'
  const verbatimDivider = document.getElementById('ci-verbatim-divider'); // Lookup DOM element 'ci-verbatim-divider'
  if (verbatimWrap) verbatimWrap.style.display = (isSI || ciModeKind === 'consecutive') ? 'flex' : 'none'; // Toggle element visibility
  if (verbatimDivider) verbatimDivider.style.display = (isSI || ciModeKind === 'consecutive') ? 'block' : 'none'; // Toggle element visibility
  const replayZone = document.getElementById('ci-replay-zone'); // Lookup DOM element 'ci-replay-zone'
  if (replayZone) replayZone.style.display = isLiveRender ? 'none' : ''; // Toggle element visibility

  // Escort/Liaison is capped at intermediate difficulty per protocol — never framed as high-stakes
  const diffSel = document.getElementById('ci-diff-sel'); // Lookup DOM element 'ci-diff-sel'
  if (diffSel) { // Evaluate conditional branch
    Array.from(diffSel.options).forEach(opt => { // Iterate over each element
      const restricted = isEscort && (opt.value === 'advanced' || opt.value === 'expert');
      opt.disabled = restricted;
      opt.hidden = restricted;
    });
    if (isEscort && (diffSel.value === 'advanced' || diffSel.value === 'expert')) { // Evaluate conditional branch
      diffSel.value = 'intermediate'; // Set input value
      ciDifficulty = 'intermediate'; // Assign value to 'ciDifficulty'
    }
  }

  // Chuchotage is capped at 45 minutes per protocol — whispering at close proximity
  // for longer is not realistic and causes vocal/physical fatigue for the interpreter
  const durSel = document.getElementById('ci-duration-sel'); // Lookup DOM element 'ci-duration-sel'
  if (durSel) { // Evaluate conditional branch
    Array.from(durSel.options).forEach(opt => { // Iterate over each element
      const restricted = isChuchotage && parseInt(opt.value) > 45; // Parse integer from string
      opt.disabled = restricted;
      opt.hidden = restricted;
    });
    if (isChuchotage && parseInt(durSel.value) > 45) { // Parse integer from string
      durSel.value = '45'; // Set input value
      ciDuration = 45; // Assign value to 'ciDuration'
    }
  }
}


/**
 * @description Stores the selected atmosphere/venue setting for SI mode.
 * @param {string} val - The selected atmosphere value.
 * @returns {void}
 */
function ciAtmosphereChanged(val) {
  ciAtmosphere = val; // Assign value to 'ciAtmosphere'
}

// ── Field + Canvas data ──────────────────────────────────────────────────────
// maxPart: 0 = fixed dyadic exchange (participants control grayed out)
//          N = up to N additional speakers allowed (control active)
const CI_FIELDS = {
  medical:     {desc:'Clinical settings — NCIHC triangle positioning: interpreter beside provider, facing patient. Emotional register is high; informed consent and diagnosis carry legal weight. Every number, dosage, and timeline must be exact. No omissions.', maxPart:0, protocol:'NCIHC', fixedNote:'Fixed 2-person exchange (provider + patient) by NCIHC protocol'},
  legal:       {desc:'Court proceedings, depositions, attorney-client consultations. NAJIT standard: beside witness stand during testimony, beside defendant at counsel table. Verbatim is the standard — register, tone, and hesitations are all on record.', maxPart:0, protocol:'NAJIT', fixedNote:'Fixed exchange by NAJIT protocol — judge, counsel, or witness only'},
  immigration: {desc:'Asylum hearings, consulate interviews, USCIS appointments. Interpreter beside applicant. Emotional content (fear, trauma, displacement) must be preserved faithfully. Sequence of events matters legally. Strict neutrality required.', maxPart:0, protocol:'NCIHC', fixedNote:'Fixed 2-person exchange (officer + applicant) by NCIHC protocol'},
  diplomatic:  {desc:'Bilateral meetings, treaty negotiations, official sessions. AIIC: behind and to the side of the principal. Ceremonial register; strict protocol; no paraphrasing of formal statements. Titles and forms of address are non-negotiable.', maxPart:3, protocol:'AIIC', fixedNote:''},
  business:    {desc:'Boardroom presentations, M&A negotiations, investor briefings, labor talks. Interpreter beside executive. Fast pace; financial and technical terminology is dense. Multiple voices may enter and exit. Code-switching permitted where register allows.', maxPart:8, protocol:'AIIC', fixedNote:''},
  academic:    {desc:'Interpreter in booth or beside lectern/podium. Dense terminology, references, and abbreviations are the norm. Audience questions may arrive rapidly. Proper nouns and citations must be preserved exactly.', maxPart:8, protocol:'AIIC', fixedNote:''},
  community:   {desc:'Social services, outreach, school and housing meetings. NCIHC: beside service recipient. Register must be accessible to the client — avoid over-formalizing. Limited cultural clarification is permitted when necessary; flag it explicitly.', maxPart:6, protocol:'NCIHC', fixedNote:''},
  security:    {desc:'Law enforcement interviews, customs, emergency coordination. Verbatim is mandatory. Interpreter beside subject. Absolute neutrality — nothing added, softened, or omitted. Tone carries evidentiary weight.', maxPart:0, protocol:'NAJIT', fixedNote:'Fixed exchange (officer + subject) by law enforcement protocol'},
  media:       {desc:'Press conferences, live news, broadcast interpretation. Interpreter in booth or off-frame. Delivery is rapid and impromptu; proper names and titles are preserved exactly. Expect cross-talk and overlapping voices.', maxPart:6, protocol:'AIIC', fixedNote:''},
};

// Sub-types per field — refines the exact setting the AI generates
const CI_FIELD_TYPES = {
  medical:     ['Clinical Consultation','Emergency Room','Mental Health Session','Surgical Consent','Discharge & Follow-up','Pediatrics','Rehabilitation'],
  legal:       ['Criminal Court Hearing','Civil Proceeding','Deposition','Attorney-Client Consultation','Family Court','Sentencing'],
  immigration: ['Asylum Interview','Visa Consular Interview','USCIS Appointment','Border Inquiry'],
  diplomatic:  ['Bilateral Meeting','Treaty Negotiation','UN / Multilateral Session','State Visit','Official Press Briefing'],
  business:    ['Boardroom Presentation','M&A Negotiation','Investor Briefing','Labor Negotiation','Supply Chain Meeting','Product Launch'],
  academic:    ['Conference Keynote','Workshop','Seminar / Lecture','Research Presentation','Training Session','Panel Discussion'],
  community:   ['Social Services','Parent-School Meeting','Public Health Outreach','Housing Authority','Benefits Consultation'],
  security:    ['Police Interview','Customs & Border','Emergency Coordination','Military Liaison'],
  media:       ['Press Conference','Live Broadcast','Sports Interview','Award Ceremony','Documentary Interview'],
};

const CI_PACE_INFO = {1:'Deliberate — ~80 WPM', 2:'Moderate — ~110 WPM', 3:'Fast — ~140 WPM', 4:'Rapid — ~170 WPM'};
const CI_DIFF_INFO = {
  foundation:   {note:'Standard accent, plain register, clear segment boundaries, no interruptions, generous recovery time'},
  intermediate: {note:'Moderate field terminology, mild accent, occasional overlaps, denser information per segment'},
  advanced:     {note:'Strong accent or dialect, heavy field jargon, frequent interruptions, emotionally charged content'},
  expert:       {note:'Maximum cognitive pressure — overlapping speakers, heavy accent, maximum terminology density, no recovery time'},
};
const CI_FIELD_FIGS = {
  medical:     [{x:.32,y:.5,role:'Physician'},{x:.68,y:.5,role:'Patient'}],
  legal:       [{x:.5,y:.28,role:'Judge'},{x:.26,y:.52,role:'Counsel'},{x:.73,y:.49,role:'Witness'}],
  immigration: [{x:.42,y:.37,role:'Officer'},{x:.6,y:.56,role:'Applicant'}],
  diplomatic:  [{x:.26,y:.45,role:'Principal A'},{x:.74,y:.45,role:'Principal B'},{x:.5,y:.64,role:'Aide'}],
  business:    [{x:.5,y:.3,role:'Executive'},{x:.3,y:.55,role:'Counterpart'},{x:.7,y:.55,role:'Advisor'}],
  academic:    [{x:.5,y:.27,role:'Lecturer'},{x:.27,y:.62,role:'Delegate'},{x:.73,y:.62,role:'Delegate'}],
  community:   [{x:.36,y:.44,role:'Provider'},{x:.64,y:.44,role:'Client'}],
  security:    [{x:.37,y:.4,role:'Officer'},{x:.67,y:.47,role:'Subject'}],
  media:       [{x:.5,y:.3,role:'Spokesperson'},{x:.25,y:.58,role:'Press'},{x:.75,y:.58,role:'Press'}],
};
const CI_FIELD_NAMES = {
  medical:'Medical — Clinical Setting', legal:'Legal — Court Proceeding',
  immigration:'Immigration — Consular Interview', diplomatic:'Diplomatic — Bilateral Session',
  business:'Business — Board Meeting', academic:'Academic — Conference Hall',
  community:'Community — Social Services', security:'Security — Interview Room',
  media:'Media — Press Briefing',
};

const CI_DIALECTS = {
  Arabic:     ['Modern Standard Arabic','Egyptian Arabic','Levantine Arabic','Gulf Arabic','Moroccan Arabic'],
  English:    ['American English','British English','Australian English','Canadian English','Indian English'],
  French:     ['Metropolitan French','Canadian French','Belgian French'],
  Spanish:    ['Castilian Spanish','Latin American Spanish','Mexican Spanish','Argentine Spanish'],
  German:     ['Standard German','Austrian German','Swiss German'],
  Italian:    ['Standard Italian','Southern Italian'],
  Russian:    ['Standard Russian'],
  Chinese:    ['Mandarin (Putonghua)','Cantonese','Taiwanese Mandarin'],
  Portuguese: ['Brazilian Portuguese','European Portuguese'],
  Japanese:   ['Standard Japanese'],
};

const CI_FIELD_TIPS = {
  medical:     'Use first-person throughout ("I feel pain" — not "she feels pain"). Preserve all numbers, dosages, diagnoses, and timelines exactly. No omissions.',
  legal:       'Never editorialize or soften language. Reproduce exact legal terms. Interrupt formally if clarification is needed — never guess.',
  immigration: 'Emotional content must be preserved faithfully. Never soften expressions of fear, distress, or trauma. Accuracy of sequence matters.',
  diplomatic:  'Protocol is paramount. Preserve formal titles, diplomatic register, and indirect phrasing. Do not paraphrase formal statements.',
  business:    'Figures, percentages, and financial terms must be exact. Maintain neutral professional register throughout.',
  academic:    'Specialized vocabulary is the standard. Request spelling of unfamiliar proper nouns and technical terms.',
  community:   'Cultural sensitivity is expected. NCIHC permits limited cultural clarification when necessary — flag it explicitly.',
  security:    'Instructions and warnings must be rendered exactly. Do not interpret tone — stick to literal meaning only.',
  media:       'Broadcast-quality register is required. Pace will be fast. Proper names and titles must be preserved.',
};

// ── Role colors for canvas figures (index = position in CI_FIELD_FIGS[field]) ──
const CI_FIGURE_COLORS = [
  { solid:'#4878f0', rgb:'72,120,240',   label:'Speaker A' },  // 0 — main
  { solid:'#26b882', rgb:'38,184,130',   label:'Speaker B' },  // 1 — secondary
  { solid:'#e8971e', rgb:'232,151,30',   label:'Speaker C' },  // 2 — third
  { solid:'#f43f5e', rgb:'244,63,94',    label:'Speaker D' },  // 3 — fourth
  { solid:'#a855f7', rgb:'168,85,247',   label:'Speaker E' },  // 4 — fifth
];

// ── Research-based realistic durations per field + type ───────────────────────
// Format: [min_value, ...] → rendered as "N min — Label" options
// Source: NCIHC, NAJIT, AIIC field standards + practitioner averages
const CI_TYPE_DURATIONS = {
  medical: {
    'Clinical Consultation':   [{v:10,l:'10 min — Typical'},{v:20,l:'20 min — Extended'},{v:30,l:'30 min — Complex case'}],
    'Emergency Room':          [{v:5,l:'5 min — Triage'},{v:10,l:'10 min — Assessment'},{v:20,l:'20 min — Treatment'}],
    'Mental Health Session':   [{v:20,l:'20 min — Intake'},{v:45,l:'45 min — Standard session'},{v:60,l:'60 min — Full session'}],
    'Surgical Consent':        [{v:10,l:'10 min — Brief'},{v:20,l:'20 min — Standard'},{v:30,l:'30 min — Complex procedure'}],
    'Discharge & Follow-up':   [{v:10,l:'10 min — Quick discharge'},{v:20,l:'20 min — Standard'},{v:30,l:'30 min — Complex follow-up'}],
    'Pediatrics':              [{v:10,l:'10 min — Checkup'},{v:20,l:'20 min — Consultation'},{v:30,l:'30 min — Complex'}],
    'Rehabilitation':          [{v:15,l:'15 min — Assessment'},{v:30,l:'30 min — Session'},{v:45,l:'45 min — Extended session'}],
  },
  legal: {
    'Criminal Court Hearing':  [{v:20,l:'20 min — Short hearing'},{v:45,l:'45 min — Standard'},{v:90,l:'90 min — Full hearing'},{v:120,l:'120 min — Full day segment'}],
    'Civil Proceeding':        [{v:20,l:'20 min — Motions'},{v:45,l:'45 min — Standard'},{v:90,l:'90 min — Extended'}],
    'Deposition':              [{v:30,l:'30 min — Brief'},{v:60,l:'60 min — Standard'},{v:120,l:'120 min — Full deposition'}],
    'Attorney-Client Consultation': [{v:20,l:'20 min — Initial'},{v:45,l:'45 min — Standard'},{v:60,l:'60 min — Extended'}],
    'Family Court':            [{v:20,l:'20 min — Status hearing'},{v:45,l:'45 min — Standard'},{v:90,l:'90 min — Full hearing'}],
    'Sentencing':              [{v:10,l:'10 min — Brief'},{v:20,l:'20 min — Standard'},{v:45,l:'45 min — Complex case'}],
  },
  immigration: {
    'Asylum Interview':        [{v:30,l:'30 min — Abbreviated'},{v:60,l:'60 min — Standard'},{v:90,l:'90 min — Full interview'},{v:120,l:'120 min — Extended'}],
    'Visa Consular Interview': [{v:5,l:'5 min — Tourist visa'},{v:10,l:'10 min — Standard'},{v:15,l:'15 min — Complex'}],
    'USCIS Appointment':       [{v:20,l:'20 min — Status check'},{v:45,l:'45 min — Standard'},{v:60,l:'60 min — Complex case'}],
    'Border Inquiry':          [{v:5,l:'5 min — Quick check'},{v:10,l:'10 min — Standard'},{v:20,l:'20 min — Detailed inquiry'}],
  },
  diplomatic: {
    'Bilateral Meeting':       [{v:30,l:'30 min — Brief exchange'},{v:60,l:'60 min — Standard'},{v:90,l:'90 min — Extended'}],
    'Treaty Negotiation':      [{v:60,l:'60 min — Session'},{v:90,l:'90 min — Extended session'},{v:120,l:'120 min — Full round'}],
    'UN / Multilateral Session':[{v:30,l:'30 min — Short session'},{v:60,l:'60 min — Standard'},{v:90,l:'90 min — Extended'},{v:120,l:'120 min — Full sitting'}],
    'State Visit':             [{v:20,l:'20 min — Courtesy call'},{v:30,l:'30 min — Working meeting'},{v:45,l:'45 min — Full audience'},{v:60,l:'60 min — State dinner exchange'}],
    'Official Press Briefing': [{v:10,l:'10 min — Short briefing'},{v:15,l:'15 min — Standard'},{v:20,l:'20 min — Extended'},{v:30,l:'30 min — Full briefing'}],
  },
  business: {
    'Boardroom Presentation':  [{v:15,l:'15 min — Elevator pitch'},{v:30,l:'30 min — Standard'},{v:45,l:'45 min — Full deck'},{v:60,l:'60 min — Extended Q&A'}],
    'M&A Negotiation':         [{v:30,l:'30 min — Preliminary'},{v:60,l:'60 min — Standard round'},{v:90,l:'90 min — Full session'}],
    'Investor Briefing':       [{v:15,l:'15 min — Pitch'},{v:30,l:'30 min — Full briefing'},{v:45,l:'45 min — Deep dive'}],
    'Labor Negotiation':       [{v:30,l:'30 min — Opening round'},{v:60,l:'60 min — Standard'},{v:90,l:'90 min — Extended'}],
    'Supply Chain Meeting':    [{v:20,l:'20 min — Status update'},{v:30,l:'30 min — Standard'},{v:45,l:'45 min — Strategy session'},{v:60,l:'60 min — Full review'}],
    'Product Launch':          [{v:15,l:'15 min — Announcement'},{v:20,l:'20 min — Standard'},{v:30,l:'30 min — Full launch'},{v:45,l:'45 min — With Q&A'}],
  },
  academic: {
    'Conference Keynote':      [{v:20,l:'20 min — Short keynote'},{v:30,l:'30 min — Standard'},{v:45,l:'45 min — Full keynote'},{v:60,l:'60 min — Extended with Q&A'}],
    'Workshop':                [{v:30,l:'30 min — Half workshop'},{v:60,l:'60 min — Standard'},{v:90,l:'90 min — Full workshop'}],
    'Seminar / Lecture':       [{v:30,l:'30 min — Short lecture'},{v:45,l:'45 min — Standard'},{v:60,l:'60 min — Full lecture'},{v:90,l:'90 min — With exercises'}],
    'Research Presentation':   [{v:15,l:'15 min — Short paper'},{v:20,l:'20 min — Standard'},{v:30,l:'30 min — Full presentation'},{v:45,l:'45 min — With discussion'}],
    'Training Session':        [{v:30,l:'30 min — Module'},{v:60,l:'60 min — Half-day block'},{v:90,l:'90 min — Extended block'}],
    'Panel Discussion':        [{v:30,l:'30 min — Brief panel'},{v:45,l:'45 min — Standard'},{v:60,l:'60 min — Full panel'},{v:90,l:'90 min — With Q&A'}],
  },
  community: {
    'Social Services':         [{v:10,l:'10 min — Quick intake'},{v:20,l:'20 min — Standard'},{v:30,l:'30 min — Full assessment'},{v:45,l:'45 min — Case review'}],
    'Parent-School Meeting':   [{v:10,l:'10 min — Short update'},{v:20,l:'20 min — Standard'},{v:30,l:'30 min — Extended conference'}],
    'Public Health Outreach':  [{v:15,l:'15 min — Information session'},{v:20,l:'20 min — Standard'},{v:30,l:'30 min — Full outreach'},{v:45,l:'45 min — Workshop'}],
    'Housing Authority':       [{v:10,l:'10 min — Quick inquiry'},{v:20,l:'20 min — Standard meeting'},{v:30,l:'30 min — Case review'}],
    'Benefits Consultation':   [{v:15,l:'15 min — Initial inquiry'},{v:30,l:'30 min — Full consultation'},{v:45,l:'45 min — Complex case'}],
  },
  security: {
    'Police Interview':        [{v:15,l:'15 min — Brief questioning'},{v:30,l:'30 min — Standard'},{v:60,l:'60 min — Full interview'}],
    'Customs & Border':        [{v:5,l:'5 min — Routine check'},{v:10,l:'10 min — Secondary screening'},{v:20,l:'20 min — Detailed inspection'}],
    'Emergency Coordination':  [{v:10,l:'10 min — Rapid briefing'},{v:20,l:'20 min — Standard coordination'},{v:30,l:'30 min — Extended ops'}],
    'Military Liaison':        [{v:15,l:'15 min — Brief exchange'},{v:30,l:'30 min — Standard liaison'},{v:60,l:'60 min — Full debrief'}],
  },
  media: {
    'Press Conference':        [{v:10,l:'10 min — Short statement'},{v:15,l:'15 min — Standard'},{v:20,l:'20 min — Full briefing'},{v:30,l:'30 min — Extended Q&A'}],
    'Live Broadcast':          [{v:5,l:'5 min — Breaking segment'},{v:10,l:'10 min — Standard segment'},{v:15,l:'15 min — Feature'},{v:20,l:'20 min — Full broadcast'}],
    'Sports Interview':        [{v:5,l:'5 min — Post-match'},{v:10,l:'10 min — Standard'},{v:15,l:'15 min — Feature interview'}],
    'Award Ceremony':          [{v:10,l:'10 min — Acceptance & remarks'},{v:15,l:'15 min — Standard'},{v:20,l:'20 min — Extended'},{v:30,l:'30 min — Full ceremony segment'}],
    'Documentary Interview':   [{v:15,l:'15 min — Short interview'},{v:30,l:'30 min — Standard'},{v:45,l:'45 min — In-depth'},{v:60,l:'60 min — Full sit-down'}],
  },
};

// ciSetupHTML() removed — CI is now a static full-screen overlay (#ci-sim-overlay)
// Legacy stub kept to avoid reference errors in case any old call survives a refresh

/**
 * @description Legacy stub that builds the CI setup panel HTML string.
 *              CI is now a static full-screen overlay; this remains for backward compatibility.
 * @returns {string} The HTML string for the setup panel.
 */
function ciSetupHTML() {
  const LANGS = ['Arabic','English','French','Spanish','German','Italian','Russian','Chinese','Portuguese','Japanese'];
  const srcOpts = LANGS.map(l=>`<option value="${l}"${l==='English'?' selected':''}>${l}</option>`).join('');
  const tgtOpts = LANGS.map(l=>`<option value="${l}"${l==='Arabic'?' selected':''}>${l}</option>`).join('');

  const srcDialectOpts = (CI_DIALECTS['English']||[]).map(d=>`<option>${d}</option>`).join('');
  const tgtDialectOpts = (CI_DIALECTS['Arabic']||[]).map(d=>`<option>${d}</option>`).join('');

  const fieldOpts = Object.entries(CI_FIELD_NAMES).map(([k])=>
    `<option value="${k}"${k==='medical'?' selected':''}>${k.charAt(0).toUpperCase()+k.slice(1)}</option>`
  ).join('');

  const diffOpts = [
    {v:'beginner', l:'Beginner — 80–100 WPM · Short, clear segments'},
    {v:'intermediate',l:'Intermediate — 100–130 WPM · Moderate density', sel:true},
    {v:'advanced',  l:'Advanced — 130–160 WPM · Dense terminology'},
    {v:'expert',    l:'Expert — 160–200 WPM · Full conference register'},
  ].map(d=>`<option value="${d.v}"${d.sel?' selected':''}>${d.l}</option>`).join('');

  const durOpts = [
    {v:5,l:'5 min — Quick drill'},
    {v:10,l:'10 min — Standard', sel:true},
    {v:15,l:'15 min — Full session'},
    {v:20,l:'20 min — Extended'},
    {v:30,l:'30 min — Intensive'},
  ].map(d=>`<option value="${d.v}"${d.sel?' selected':''}>${d.l}</option>`).join('');

  return `<div style="max-width:1100px;margin:0 auto">

  <!-- Title + status -->
  <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px 4px">
    <div style="font-size:14px;font-weight:800;color:var(--text)">Consecutive Interpretation — Session Setup</div>
    <div style="display:flex;align-items:center;gap:10px">
      <span class="ci-status-badge" id="ci-status-badge">Setup</span>
      <button onclick="hideCIInline()" style="background:none;border:none;color:var(--dim);cursor:pointer;font-size:11px;font-weight:600;padding:3px 8px;border-radius:5px;border:1px solid var(--border);transition:all .15s" onmouseover="this.style.borderColor='var(--red)';this.style.color='var(--red)'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--dim)'">Close</button>
    </div>
  </div>

  <!-- ── Setup Panel ─────────────────────────────────────────────── -->
  <div id="ci-setup-panel" style="padding:10px 18px 18px">

    <!-- Row 1: Field + Duration + Difficulty -->
    <div style="display:grid;grid-template-columns:2fr 1fr 2fr;gap:10px;margin-bottom:10px">
      <div class="sim-section" style="margin-bottom:0">
        <div class="sim-label">Field</div>
        <select id="ci-field-sel" style="width:100%" onchange="ciFieldChanged(this.value)">
          ${fieldOpts}
        </select>
        <div class="sim-field-hint" id="ci-field-hint">${CI_FIELDS.medical.desc}</div>
      </div>
      <div class="sim-section" style="margin-bottom:0">
        <div class="sim-label">Duration</div>
        <select id="ci-duration-sel" style="width:100%">${durOpts}</select>
        <div class="sim-field-hint">AI divides into timed segments</div>
      </div>
      <div class="sim-section" style="margin-bottom:0">
        <div class="sim-label">Difficulty</div>
        <select id="ci-diff-sel" style="width:100%" onchange="ciDifficulty=this.value">${diffOpts}</select>
        <div class="sim-field-hint">Affects speech rate, density, and register</div>
      </div>
    </div>

    <!-- Row 2: Language pair with dialects -->
    <div class="sim-section">
      <div class="sim-label">Language Pair</div>
      <div style="display:grid;grid-template-columns:1fr 28px 1fr;gap:8px;align-items:end">
        <div>
          <div style="font-size:9px;color:var(--dim);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Source Language</div>
          <select id="ci-src-lang" style="width:100%;margin-bottom:6px" onchange="ciSrcLangChanged(this.value)">${srcOpts}</select>
          <div style="font-size:9px;color:var(--dim);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Source Dialect</div>
          <select id="ci-src-dialect" style="width:100%">${srcDialectOpts}</select>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding-bottom:3px">
          <span id="ci-dir-fwd" style="font-size:11px;font-weight:700;color:var(--blue);line-height:1;transition:opacity .25s">→</span>
          <span id="ci-dir-bwd" style="font-size:11px;font-weight:700;color:var(--dim);line-height:1;transition:opacity .25s">←</span>
        </div>
        <div>
          <div style="font-size:9px;color:var(--dim);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Target Language</div>
          <select id="ci-tgt-lang" style="width:100%;margin-bottom:6px" onchange="ciTgtLangChanged(this.value)">${tgtOpts}</select>
          <div style="font-size:9px;color:var(--dim);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Target Dialect</div>
          <select id="ci-tgt-dialect" style="width:100%">${tgtDialectOpts}</select>
        </div>
      </div>
      <div class="ci-oneway-row">
        <label class="ci-toggle-wrap">
          <input type="checkbox" class="ci-toggle-input" id="ci-oneway" onchange="ciToggleOneWay(this.checked)">
          <div class="ci-toggle-track"><div class="ci-toggle-thumb"></div></div>
        </label>
        <span style="font-size:11px;color:var(--dim)">One-way interpretation</span>
        <span style="font-size:10px;color:var(--dim);margin-left:auto;font-style:italic;opacity:.7">Press briefings, informed consent, court readings</span>
      </div>
    </div>

    <!-- Row 3: Pace + Additional Participants -->
    <div style="display:grid;grid-template-columns:3fr 1fr;gap:10px;margin-bottom:12px">
      <div class="sim-section" style="margin-bottom:0">
        <div class="sim-label">Pace <span class="sim-sublabel">fine-tune within difficulty band</span></div>
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:9px;color:var(--dim);white-space:nowrap">Slow</span>
          <input type="range" id="ci-pace-slider" min="1" max="4" step="1" value="2" oninput="ciUpdatePace(+this.value)" style="flex:1;accent-color:var(--blue);cursor:pointer">
          <span style="font-size:9px;color:var(--dim);white-space:nowrap">Rapid</span>
        </div>
        <div id="ci-pace-display" style="font-size:11px;font-weight:600;color:var(--text);font-family:monospace;text-align:center;margin-top:4px">Moderate — ~110 WPM</div>
      </div>
      <div class="sim-section" style="margin-bottom:0">
        <div class="sim-label">Add. Participants <span class="sim-sublabel">beyond main</span></div>
        <div class="ci-part-row">
          <button class="ci-part-btn" id="ci-part-minus" onclick="ciAdjustPart(-1)" disabled>−</button>
          <span class="ci-part-num" id="ci-part-num">0</span>
          <button class="ci-part-btn" id="ci-part-plus" onclick="ciAdjustPart(1)">+</button>
        </div>
        <div id="ci-part-note" style="font-size:9px;color:var(--dim);margin-top:5px;line-height:1.4">Adds complexity and overlap</div>
      </div>
    </div>

    <!-- CTA -->
    <button class="ci-start-btn" id="ci-start-btn" onclick="ciShowBrief()">Review Assignment Brief</button>

  </div><!-- /ci-setup-panel -->

  <!-- ── Brief Panel ───────────────────────────────────────────── -->
  <div id="ci-brief-panel" style="display:none;padding:10px 18px 18px">
    <div id="ci-brief-content"></div>
    <div style="display:flex;gap:10px;margin-top:12px">
      <button class="btn btn-ghost" style="flex:1;padding:11px;font-size:12px" onclick="document.getElementById('ci-setup-panel').style.display='';document.getElementById('ci-brief-panel').style.display='none'">← Back to Setup</button>
      <button class="ci-start-btn" style="flex:2" onclick="ciConfirmAndStart()">Start Session</button>
    </div>
  </div>

  <!-- ── Session Panel ───────────────────────────────────────────── -->
  <div id="ci-session-panel" style="display:none">
    <!-- Session header bar -->
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 18px;border-bottom:1px solid var(--border);background:var(--bg2)">
      <div>
        <span style="font-size:12px;font-weight:700;color:var(--text)">Live Session</span>
        <span style="font-size:11px;color:var(--dim);margin-left:8px" id="ci-hdr-info"></span>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <span id="ci-session-elapsed" style="font-size:13px;font-weight:700;font-family:monospace;color:var(--gold);display:none">00:00</span>
        <button onclick="ciEndSession()" style="background:rgba(244,63,94,.1);border:1px solid rgba(244,63,94,.3);color:var(--red);padding:5px 14px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;transition:all .2s" onmouseover="this.style.background='rgba(244,63,94,.2)'" onmouseout="this.style.background='rgba(244,63,94,.1)'">End Session</button>
      </div>
    </div>
    <div id="ci-rotation-banner" style="display:none;padding:8px 18px;background:rgba(251,191,36,.08);border-bottom:1px solid rgba(251,191,36,.25);font-size:12px;color:var(--gold);font-weight:600">
      ⏱ You're 20-30 min in — AIIC's "tag team" rule recommends rotating interpreters around now to manage fatigue.
    </div>
    <div class="ci-session-layout">

      <!-- Left column: Room canvas + interaction zones -->
      <div>
        <div class="ci-room-wrap">
          <div class="ci-room-top-bar">
            <span class="ci-room-field-lbl" id="ci-room-field-label">Medical — Clinical Setting</span>
            <div class="ci-seg-progress" id="ci-seg-progress" style="display:flex;align-items:center;gap:6px"></div>
          </div>
          <canvas class="ci-room-canvas" id="ci-room-canvas" width="560" height="300"></canvas>
          <div class="ci-room-bottom-bar">
            <div id="ci-seg-status" style="font-size:11px;color:var(--dim)">Segment 1 of 4</div>
          </div>
        </div>

        <!-- Listening zone -->
        <div id="ci-listening-zone" class="ci-session-card" style="display:none;margin-top:10px">
          <div class="ci-player-label">Listen carefully — take notes during playback</div>
          <div class="ci-player-zone" id="ci-player-zone">
            <div id="ci-player-idle" style="color:var(--dim);font-size:13px">Preparing audio...</div>
            <div id="ci-player-active" style="display:none">
              <div class="ci-speaker-wave">
                <div class="ci-wave-bar"></div><div class="ci-wave-bar"></div><div class="ci-wave-bar"></div>
                <div class="ci-wave-bar"></div><div class="ci-wave-bar"></div><div class="ci-wave-bar"></div>
                <div class="ci-wave-bar"></div>
              </div>
              <div id="ci-playing-label" style="font-size:12px;color:var(--blue);margin-top:6px">Speaker is talking...</div>
            </div>
          </div>
          <div style="margin-top:13px">
            <div class="ci-notepad-label">
              <span>Notes</span>
              <span class="ci-notepad-tip">Use abbreviations — speed matters</span>
            </div>
            <textarea class="ci-notepad" id="ci-notes" placeholder="Key terms, numbers, names, sequences..."></textarea>
          </div>
          <div id="ci-replay-zone" style="display:none;margin-top:10px">
            <button class="btn btn-ghost" style="font-size:12px;margin-right:8px" onclick="ciReplaySegment()">Replay segment</button>
            <span style="font-size:11px;color:var(--dim)">(use sparingly)</span>
          </div>
        </div>

        <!-- Render zone -->
        <div id="ci-render-zone" class="ci-session-card" style="display:none;margin-top:10px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <div style="font-size:13px;font-weight:600;color:var(--text)">Render your interpretation</div>
            <div id="ci-render-timer" style="font-size:12px;color:var(--dim)"></div>
          </div>
          <div class="ci-render-label">Target language — complete meaning, first-person:</div>
          <textarea class="ci-render-textarea" id="ci-rendition" placeholder="Enter your interpretation here..."></textarea>
          <div class="ci-render-hint" id="ci-render-hint"></div>
          <div style="display:flex;gap:10px;margin-top:13px">
            <button class="btn btn-blue" style="flex:2;padding:12px" onclick="ciSubmitRendition()">Submit Rendition</button>
            <button class="btn btn-ghost" style="flex:1;padding:12px;font-size:12px" onclick="ciEndSession()">End Session</button>
          </div>
        </div>

        <!-- Between segments -->
        <div id="ci-between-zone" class="ci-session-card" style="display:none;text-align:center;margin-top:10px">
          <div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:6px" id="ci-between-msg">Segment submitted</div>
          <div style="font-size:12px;color:var(--dim);margin-bottom:16px" id="ci-between-sub"></div>
          <div style="display:flex;gap:10px;justify-content:center">
            <button class="btn btn-blue" id="ci-next-btn" onclick="ciNextSegment()" style="padding:12px 28px">Next Segment</button>
            <button class="btn btn-gold" id="ci-finish-btn" onclick="ciEndSession()" style="padding:12px 28px;display:none">Get Evaluation</button>
          </div>
        </div>
      </div><!-- /left column -->

      <!-- Right column: Info + camera -->
      <div class="ci-side-panel">

        <!-- Session info -->
        <div class="ci-session-info-card">
          <div style="font-size:9px;font-weight:800;color:var(--dim);text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px">Session</div>
          <div class="ci-persona-row" style="border-bottom:1px solid var(--border);padding-bottom:12px;margin-bottom:12px">
            <div class="ci-persona-avatar" id="ci-avatar">?</div>
            <div style="min-width:0">
              <div class="ci-persona-name" id="ci-persona-name">Loading...</div>
              <div class="ci-persona-role" id="ci-persona-role"></div>
              <div class="ci-topic-tag" id="ci-topic-tag" style="margin-top:4px"></div>
            </div>
          </div>
          <div class="ci-stats-row">
            <div class="ci-stat-box">
              <div class="ci-stat-val" id="ci-stat-field">—</div>
              <div class="ci-stat-lbl">Field</div>
            </div>
            <div class="ci-stat-box">
              <div class="ci-stat-val" id="ci-stat-diff">—</div>
              <div class="ci-stat-lbl">Level</div>
            </div>
          </div>
        </div>

        <!-- Camera panel -->
        <div class="ci-camera-panel">
          <div class="ci-camera-head">
            <span class="ci-camera-label">Camera</span>
            <button class="ci-camera-btn" id="ci-cam-btn" onclick="ciToggleCamera(this)">Enable</button>
          </div>
          <div id="ci-camera-body">
            <div class="ci-camera-off" id="ci-camera-off">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--border)" stroke-width="1.5" stroke-linecap="round">
                <path d="M15 10l4.55-2.28A1 1 0 0121 8.62v6.76a1 1 0 01-1.45.9L15 14"/>
                <rect x="3" y="6" width="12" height="12" rx="2"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
              <span style="font-size:10px;color:var(--dim)">Camera off</span>
            </div>
            <video id="ci-camera-video" autoplay muted playsinline style="display:none;width:100%;background:#000;min-height:130px;object-fit:cover"></video>
          </div>
        </div>

      </div><!-- /right column -->
    </div><!-- /session layout -->
  </div><!-- /ci-session-panel -->

  <!-- Evaluating spinner -->
  <div id="ci-eval-loading" style="display:none;text-align:center;padding:60px 20px">
    <div style="font-size:13px;color:var(--dim)" id="ci-eval-msg">Evaluating your session...</div>
  </div>

  <!-- Evaluation result -->
  <div id="ci-eval-panel" style="display:none;padding:0 20px 20px">
    <div class="ci-eval-card" id="ci-eval-card"></div>
    <div style="display:flex;gap:10px;margin-top:14px">
      <button class="btn btn-ghost" style="flex:1;padding:12px" onclick="ciReset()">New Session</button>
    </div>
  </div>

</div>`;
}

// ── Session Start ───────────────────────────────────────────────────────────
// Stored between loading and begin — first segment held until user clicks Begin
let ciFirstSegAudio = null;
let ciFirstSegText  = null;


/**
 * @description Updates the Begin button state in the preparation room based on camera and recording readiness.
 *              Syncs checklist ticks and button styling.
 * @returns {void}
 */
function ciUpdateBeginBtn() {
  const btn = document.getElementById('ci-begin-btn'); // Lookup DOM element 'ci-begin-btn'
  if (!btn) return; // Evaluate conditional branch

  const cameraLive = !!ciCameraStream;
  const recording  = ciPrepCameraReady; // Initialize variable 'recording'

  // Camera checklist tick
  const camCheck = document.getElementById('ci-check-cam'); // Lookup DOM element 'ci-check-cam'
  if (camCheck) { // Evaluate conditional branch
    camCheck.style.background = cameraLive ? 'rgba(38,184,130,.25)' : 'rgba(110,110,110,.15)'; // Set background style
    camCheck.style.borderColor = cameraLive ? '#26b882' : 'var(--border)'; // Set border color
    camCheck.innerHTML = cameraLive ? '<span style="font-size:9px;color:#26b882;font-weight:800">✓</span>' : ''; // Set HTML content
  }
  // Recording checklist tick
  const recCheck = document.getElementById('ci-check-rec'); // Lookup DOM element 'ci-check-rec'
  if (recCheck) { // Evaluate conditional branch
    recCheck.style.background = recording ? 'rgba(244,63,94,.18)' : 'rgba(110,110,110,.15)'; // Set background style
    recCheck.style.borderColor = recording ? 'var(--red)' : 'var(--border)'; // Set border color
    recCheck.innerHTML = recording ? '<span style="font-size:9px;color:var(--red);font-weight:800">●</span>' : ''; // Set HTML content
  }

  if (recording) { // Evaluate conditional branch
    btn.textContent = 'Begin Interpretation'; // Set text content
    btn.style.opacity = '1'; // Adjust element opacity
    btn.style.background = 'var(--blue)'; // Set background style
    btn.style.color = '#fff'; // Set text color
    btn.style.boxShadow = '0 0 18px rgba(72,120,240,.35)'; // Apply box shadow
  } else {
    btn.textContent = 'Begin without Camera'; // Set text content
    btn.style.opacity = '0.8'; // Adjust element opacity
    btn.style.background = 'var(--bg2)'; // Set background style
    btn.style.color = 'var(--text)'; // Set text color
    btn.style.boxShadow = 'none'; // Apply box shadow
  }
}


/**
 * @description Transitions from preparation room to active session.
 *              Moves camera stream, initializes canvas, starts timer, and plays the first segment.
 * @returns {void}
 */
function ciBeginInterpretation() {
  // Stop prep camera if it was just testing (don't stop if recording for session)
  // Canvas starts now
  ciActiveSpeakerIdx = 0; // Assign value to 'ciActiveSpeakerIdx'
  ciStopCanvas(); // Invoke ciStopCanvas()
  ciInitCanvas(ciField); // Invoke ciInitCanvas()
  ciUpdateLegend(0); // Invoke ciUpdateLegend()

  ciSwitchView('ci-session-view'); // Invoke ciSwitchView()
  ciStartSessionTimer(); // Invoke ciStartSessionTimer()

  // Move camera stream to session-view video element if active
  const prepVideo    = document.getElementById('ci-prep-camera-video'); // Lookup DOM element 'ci-prep-camera-video'
  const sessVideo    = document.getElementById('ci-camera-video'); // Lookup DOM element 'ci-camera-video'
  const sessOff      = document.getElementById('ci-camera-off'); // Lookup DOM element 'ci-camera-off'
  const sessCamBtn   = document.getElementById('ci-cam-btn'); // Lookup DOM element 'ci-cam-btn'
  if (ciCameraStream && prepVideo && sessVideo) { // Evaluate conditional branch
    sessVideo.srcObject = ciCameraStream; // Attach media stream to video element
    sessVideo.style.display   = ''; // Toggle element visibility
    if (sessOff) sessOff.style.display = 'none'; // Hide the element
    if (sessCamBtn) { // Evaluate conditional branch
      // Mirror recording state
      sessCamBtn.textContent = (ciMediaRecorder && ciMediaRecorder.state === 'recording') // Set text content
        ? 'Stop Recording' : 'Record';
      sessCamBtn.style.background  = 'rgba(244,63,94,.12)'; // Set background style
      sessCamBtn.style.borderColor = 'rgba(244,63,94,.35)'; // Set border color
      sessCamBtn.style.color       = 'var(--red)'; // Set text color
    }
    prepVideo.srcObject = null; // Attach media stream to video element
  }

  ciPlaySegment(ciFirstSegAudio, ciFirstSegText, 1); // Invoke ciPlaySegment()
  ciFirstSegAudio = null; // Assign value to 'ciFirstSegAudio'
  ciFirstSegText  = null; // Assign value to 'ciFirstSegText'
}

// ── Segment Playback ─────────────────────────────────────────────────────────

/**
 * @description Plays a session segment (audio for CI/SI, document for Sight).
 *              Handles speaker rotation, zone visibility, and SI auto-recording with EVS delay.
 * @param {string} audio_b64 - Base64-encoded audio data for the segment.
 * @param {string} seg_text - The source text of the segment.
 * @param {number} seg_num - The segment number in the session.
 * @returns {void}
 */
function ciPlaySegment(audio_b64, seg_text, seg_num) {
  ciSegText = seg_text; // Assign value to 'ciSegText'
  ciSegNum  = seg_num; // Assign value to 'ciSegNum'

  // Rotate active speaker per segment for visual realism
  const figs = CI_FIELD_FIGS[ciActiveField] || CI_FIELD_FIGS.medical;
  ciActiveSpeakerIdx = (seg_num - 1) % figs.length; // Assign value to 'ciActiveSpeakerIdx'
  ciUpdateLegend(ciActiveSpeakerIdx); // Invoke ciUpdateLegend()

  document.getElementById('ci-seg-status').textContent = `Segment ${seg_num} of ${ciMaxSegs}`;
  document.getElementById('ci-notes').value = '';
  document.getElementById('ci-rendition').value = '';

  const tgt = ciTgtLang || 'Arabic';
  document.getElementById('ci-render-hint').textContent = `Render into ${tgt} — first-person, complete meaning, no additions.`;

  ciRenderPips(); // Invoke ciRenderPips()
  ciSetState('listening'); // Invoke ciSetState()

  const isSI    = ciIsLiveRender();
  const isSight = ciModeKind === 'sight';

  document.getElementById('ci-listening-zone').style.display = ''; // Show the element (default display)
  // SI/Sight: render zone is available concurrently (no listen-then-render split);
  // CI: render zone only appears after the segment finishes (set in ciOnSegmentEnd).
  document.getElementById('ci-render-zone').style.display    = (isSI || isSight) ? '' : 'none'; // Toggle element visibility
  document.getElementById('ci-between-zone').style.display   = 'none'; // Toggle element visibility
  document.getElementById('ci-replay-zone').style.display    = 'none'; // SI/Sight never need replay; CI re-shows it in ciOnSegmentEnd
  if (isSI) { // Evaluate conditional branch
    document.getElementById('ci-render-hint').textContent = `Render into ${tgt} live, as the speaker continues — no replay available.`;
  } else if (isSight) {
    document.getElementById('ci-render-hint').textContent = `Render into ${tgt} aloud as you read — the document stays visible the whole time.`;
  }

  // Sight Translation: no audio source — show the written document directly, no playback delay
  if (isSight) { // Evaluate conditional branch
    document.getElementById('ci-player-label-text').style.display = 'none'; // Hide the element
    document.getElementById('ci-player-zone').style.display       = 'none'; // Toggle element visibility
    document.getElementById('ci-sight-doc-zone').style.display    = ''; // Toggle element visibility
    document.getElementById('ci-sight-doc-text').textContent      = seg_text;
    const metaEl = document.getElementById('ci-sight-doc-meta'); // Lookup DOM element 'ci-sight-doc-meta'
    if (metaEl) metaEl.textContent = `~${seg_text.split(/\s+/).length} words`; // Set text content

    const isChunked = ciSightMode === 'chunked';
    const chunkedStart = document.getElementById('ci-sight-chunked-start'); // Lookup DOM element 'ci-sight-chunked-start'
    if (chunkedStart) chunkedStart.style.display = isChunked ? '' : 'none'; // Toggle element visibility

    if (isChunked) { // Evaluate conditional branch
      // Chunked: hide render zone until user presses Start Rendering
      document.getElementById('ci-render-zone').style.display = 'none'; // Hide the element
      ciSetState('listening'); // Invoke ciSetState()
    } else {
      // Continuous: show render zone immediately, auto-start recording
      document.getElementById('ci-render-zone').style.display = ''; // Show the element (default display)
      ciReadStartTs = Date.now(); // Get current timestamp
      ciSetState('rendering'); // Invoke ciSetState()
      // Auto-start camera recording if camera is enabled but not yet recording
      const sessCamBtn = document.getElementById('ci-cam-btn'); // Lookup DOM element 'ci-cam-btn'
      if (sessCamBtn && ciCameraStream && (!ciMediaRecorder || ciMediaRecorder.state === 'inactive')) { // Evaluate conditional branch
        ciToggleCamera(sessCamBtn); // Invoke ciToggleCamera()
      }
    }
    return; // Early return
  }

  document.getElementById('ci-player-label-text').style.display = ''; // Show the element (default display)
  document.getElementById('ci-player-zone').style.display       = ''; // Toggle element visibility
  document.getElementById('ci-sight-doc-zone').style.display    = 'none'; // Toggle element visibility
  document.getElementById('ci-player-idle').style.display    = ''; // Toggle element visibility
  document.getElementById('ci-player-active').style.display  = 'none'; // Toggle element visibility

  // Small delay then play
  setTimeout(() => { // Schedule delayed execution
    document.getElementById('ci-player-idle').style.display   = 'none'; // Toggle element visibility
    document.getElementById('ci-player-active').style.display = ''; // Show the element (default display)
    ciAudioBytes = Uint8Array.from(atob(audio_b64), c=>c.charCodeAt(0)); // Convert iterable to array
    const blob   = new Blob([ciAudioBytes], {type:'audio/mpeg'}); // Create binary blob from data
    const url    = URL.createObjectURL(blob); // Generate object URL for blob
    ciAudioEl    = new Audio(url); // Create audio element
    ciSegStartTs = Date.now(); // décalage (EVS) measurement start — SI only, harmless for CI

    // ── SI/Chuchotage: auto-start recording after 1–2 s EVS delay ─────────────
    if (isSI) { // Evaluate conditional branch
      const decalageEl = document.getElementById('ci-decalage-indicator'); // Lookup DOM element 'ci-decalage-indicator'
      if (decalageEl) decalageEl.style.display = ''; // Show the element (default display)
      const evsDelay = 1000 + Math.random() * 1000; // 1–2 s
      setTimeout(() => { // Schedule delayed execution
        ciAutoStartRecording(); // Invoke ciAutoStartRecording()
        // Start real-time décalage timer
        if (ciDecalageTimer) clearInterval(ciDecalageTimer); // Stop repeating interval timer
        ciDecalageTimer = setInterval(() => { // Start repeating interval timer
          if (!ciSegStartTs) return; // Evaluate conditional branch
          const lag = ((Date.now() - ciSegStartTs) / 1000).toFixed(1); // Format number to fixed decimal places
          const el = document.getElementById('ci-decalage-indicator'); // Lookup DOM element 'ci-decalage-indicator'
          if (el) el.textContent = `Décalage: ${lag}s`; // Set text content
        }, 100);
      }, evsDelay);
    } else {
      document.getElementById('ci-decalage-indicator').style.display = 'none'; // Hide the element
    }

    ciAudioEl.onended = () => { URL.revokeObjectURL(url); ciAudioEl._url = null; ciOnSegmentEnd(); }; // Bind playback ended handler
    ciAudioEl.onerror = () => { URL.revokeObjectURL(url); ciOnSegmentEnd(); }; // Bind error handler
    ciAudioEl._url = url;
    ciAudioEl.play().catch(() => ciOnSegmentEnd()); // Start audio playback
  }, 400);
}


/**
 * @description Handles cleanup when a segment's audio playback ends.
 *              Manages state transitions, décalage timer cleanup, and zone visibility.
 * @returns {void}
 */
function ciOnSegmentEnd() {
  const isSI = ciIsLiveRender();
  document.getElementById('ci-player-active').style.display = 'none'; // Hide the element
  document.getElementById('ci-player-idle').textContent = isSI
    ? 'Playback complete — segment ended.'
    : 'Playback complete — render your interpretation below.';
  document.getElementById('ci-player-idle').style.display = ''; // Show the element (default display)
  document.getElementById('ci-replay-zone').style.display = isSI ? 'none' : ''; // no-replay protocol for SI

  // Clear décalage timer
  if (ciDecalageTimer) { clearInterval(ciDecalageTimer); ciDecalageTimer = null; } // Stop repeating interval timer

  if (isSI) { // Evaluate conditional branch
    // SI/Chuchotage: state becomes Between (rendering happened live during listening)
    // but keep the render zone visible so the user can still submit their rendition
    ciAutoStopRecording(); // Invoke ciAutoStopRecording()
    ciSetState('between'); // Invoke ciSetState()
    document.getElementById('ci-listening-zone').style.display = 'none'; // Hide the element
    // Don't show the between-zone UI yet — wait for submission
  } else {
    ciSetState('rendering'); // Invoke ciSetState()
    document.getElementById('ci-render-zone').style.display = ''; // Show the element (default display)
  }
}


/**
 * @description Replays the current segment's audio from stored bytes.
 *              Not available for SI, Chuchotage, or Sight modes.
 * @returns {void}
 */
function ciReplaySegment() {
  if (ciIsLiveRender() || ciModeKind === 'sight') return; // no-replay protocol — SI/Chuchotage never allow replay; Sight has no audio to replay (doc stays visible)
  if (!ciAudioBytes) return; // Evaluate conditional branch
  // Rebuild blob from stored bytes (previous URL may have been revoked)
  const blob = new Blob([ciAudioBytes], {type:'audio/mpeg'}); // Create binary blob from data
  const url  = URL.createObjectURL(blob); // Generate object URL for blob
  const el   = new Audio(url); // Create audio element
  el.onended = () => { URL.revokeObjectURL(url); }; // Bind playback ended handler
  document.getElementById('ci-player-active').style.display = ''; // Show the element (default display)
  document.getElementById('ci-player-idle').style.display   = 'none'; // Toggle element visibility
  document.getElementById('ci-render-zone').style.display   = 'none'; // Toggle element visibility
  document.getElementById('ci-replay-zone').style.display   = 'none'; // Toggle element visibility
  el.play().catch(()=>{ // Start audio playback
    URL.revokeObjectURL(url); // Revoke object URL to free memory
    document.getElementById('ci-player-active').style.display = 'none'; // Hide the element
    document.getElementById('ci-player-idle').style.display   = ''; // Toggle element visibility
    document.getElementById('ci-render-zone').style.display   = ''; // Toggle element visibility
    document.getElementById('ci-replay-zone').style.display   = ''; // Toggle element visibility
  });
  el.onended = () => { // Bind playback ended handler
    URL.revokeObjectURL(url); // Revoke object URL to free memory
    document.getElementById('ci-player-active').style.display = 'none'; // Hide the element
    document.getElementById('ci-player-idle').style.display   = ''; // Toggle element visibility
    document.getElementById('ci-render-zone').style.display   = ''; // Toggle element visibility
    document.getElementById('ci-replay-zone').style.display   = ''; // Toggle element visibility
  };
}

// ── Submit Rendition ─────────────────────────────────────────────────────────

/**
 * @description Sets the Sight Translation mode (continuous or chunked) and updates button styles.
 * @param {string} mode - The sight mode: 'continuous' or 'chunked'.
 * @returns {void}
 */
function ciSetSightMode(mode) {
  ciSightMode = mode; // Assign value to 'ciSightMode'
  const contBtn = document.getElementById('ci-sight-mode-continuous'); // Lookup DOM element 'ci-sight-mode-continuous'
  const chunkBtn = document.getElementById('ci-sight-mode-chunked'); // Lookup DOM element 'ci-sight-mode-chunked'
  if (!contBtn || !chunkBtn) return; // Evaluate conditional branch
  if (mode === 'continuous') { // Evaluate conditional branch
    contBtn.style.background = 'var(--amber)'; // Set background style
    contBtn.style.color = '#fff'; // Set text color
    contBtn.style.borderColor = 'var(--amber)'; // Set border color
    chunkBtn.style.background = 'transparent'; // Set background style
    chunkBtn.style.color = 'var(--dim)'; // Set text color
    chunkBtn.style.borderColor = 'var(--border)'; // Set border color
  } else {
    chunkBtn.style.background = 'var(--amber)'; // Set background style
    chunkBtn.style.color = '#fff'; // Set text color
    chunkBtn.style.borderColor = 'var(--amber)'; // Set border color
    contBtn.style.background = 'transparent'; // Set background style
    contBtn.style.color = 'var(--dim)'; // Set text color
    contBtn.style.borderColor = 'var(--border)'; // Set border color
  }
}


/**
 * @description Transitions from reading phase to rendering phase in chunked Sight Translation mode.
 *              Starts camera recording if available and focuses the rendition textarea.
 * @returns {void}
 */
function ciStartSightRendering() {
  // Chunked mode: user has read the text and is now ready to render
  document.getElementById('ci-sight-chunked-start').style.display = 'none'; // Hide the element
  document.getElementById('ci-render-zone').style.display = ''; // Show the element (default display)
  ciReadStartTs = Date.now(); // Get current timestamp
  ciSetState('rendering'); // Invoke ciSetState()
  // Start camera recording if camera is enabled but not yet recording
  const sessCamBtn = document.getElementById('ci-cam-btn'); // Lookup DOM element 'ci-cam-btn'
  if (sessCamBtn && ciCameraStream && (!ciMediaRecorder || ciMediaRecorder.state === 'inactive')) { // Evaluate conditional branch
    ciToggleCamera(sessCamBtn); // Invoke ciToggleCamera()
  }
  document.getElementById('ci-rendition').focus(); // Focus input element
}

// ── End Session + Evaluation ─────────────────────────────────────────────────

/**
 * @description Renders the full session evaluation card with KPIs, segment breakdown, and coaching tips.
 * @param {Object} d - The evaluation data object from the server.
 * @returns {void}
 */
function ciRenderEval(d) {
  const card = document.getElementById('ci-eval-card'); // Lookup DOM element 'ci-eval-card'
  if (!card) return; // Evaluate conditional branch

  const gradeColor = {
    'Excellent': 'var(--green)', 'Good': 'var(--gold)',
    'Satisfactory': 'var(--amber)', 'Needs Work': 'var(--red)'
  }[d.grade?.split(' ')[0]] || 'var(--dim)'; // Split string into array

  const kpis = [
    ['Accuracy',         d.accuracy,             '--gold'],
    ['Fusha Compliance', d.fusha_compliance,      '--green'],
    ['Completeness',     d.completeness,          '--blue'],
    ['Terminology',      d.terminology,           '--purple'],
    ['Fluency',          d.fluency,               '--teal'],
    ['Protocol',         d.professional_protocol, '--amber'],
  ];

  const isSI = d.mode === 'simultaneous';
  const isChuchotage = d.mode === 'chuchotage';
  const isEscort = d.mode === 'escort';
  const isSight = d.mode === 'sight';
  const MODE_LABEL = {simultaneous: 'SI', chuchotage: 'Chuchotage', escort: 'Escort/Liaison', sight: 'Sight Translation', consecutive: 'CI'}; // Initialize variable 'MODE_LABEL'
  const modeShortLabel = MODE_LABEL[d.mode] || 'CI';
  const kpiLabels = d.kpi_labels || {memory_accuracy: 'Memory Accuracy', segment_handling: 'Segment Handling'};
  const ciSpecific = [
    [kpiLabels.memory_accuracy,  d.memory_accuracy,   '--gold'],
    [kpiLabels.segment_handling, d.segment_handling,  '--blue'],
  ];

  const kpiBoxes = (arr) => arr.map(([label, val, col]) => ` // Transform each element
    <div class="ci-kpi-box">
      <div class="ci-kpi-label">${label}</div>
      <div class="ci-kpi-val" style="color:var(${col})">${val || '—'}</div>
      <div class="ci-kpi-bar"><div class="ci-kpi-bar-fill" style="width:${val||0}%;background:var(${col})"></div></div>
    </div>`).join(''); // Join array into string

  const segs = (d.segment_evaluations || []).map(s => { // Transform each element
    const vc = `ci-v-${(s.verdict||'acceptable').replace(/ /g,'_')}`; // Replace pattern in string
    return `<div class="ci-seg-row"> // Return value to caller
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
        <span style="font-size:11px;color:var(--dim)">Seg ${s.segment_num}</span>
        <span class="ci-seg-verdict ${vc}">${s.verdict||'—'}</span>
      </div>
      <div style="font-size:11px;color:var(--dim);margin-bottom:3px">
        <em>Source:</em> ${(s.source_text||'').slice(0,80)}... // Extract substring or subarray
      </div>
      ${s.memory_items_missed ? `<div style="font-size:11px;color:var(--red);margin-bottom:3px">Missed: ${s.memory_items_missed}</div>` : ''}
      ${s.memory_items_hit ? `<div style="font-size:11px;color:var(--green);margin-bottom:3px">Recalled: ${s.memory_items_hit}</div>` : ''}
      ${s.note ? `<div style="font-size:11px;color:var(--dim);font-style:italic">${s.note}</div>` : ''}
    </div>`;
  }).join(''); // Join array into string

  const decalageLine = (isSI || isChuchotage) && d.decalage_avg_sec !== undefined
    ? `<div style="font-size:11px;color:var(--dim);margin-top:2px">Avg décalage: <strong style="color:var(--text)">${d.decalage_avg_sec}s</strong> vs target <strong style="color:var(--text)">${d.evs_target_sec}s</strong></div>`
    : '';
  const scenarioLine = isEscort && d.scenario_type
    ? `<div style="font-size:11px;color:var(--dim);margin-top:2px">Scenario: <strong style="color:var(--text)">${d.scenario_type}</strong></div>`
    : '';
  const noiseLine = isChuchotage && d.noise_level
    ? `<div style="font-size:11px;color:var(--dim);margin-top:2px">Noise: <strong style="color:var(--text)">${d.noise_level}</strong> · Listeners: <strong style="color:var(--text)">${d.listener_count||1}</strong></div>`
    : '';
  const wpmLine = isSight && d.wpm_avg !== undefined && d.wpm_avg !== null
    ? `<div style="font-size:11px;color:var(--dim);margin-top:2px">Avg WPM: <strong style="color:var(--text)">${d.wpm_avg}</strong> vs target <strong style="color:var(--text)">~${d.wpm_target}</strong> · Document: <strong style="color:var(--text)">${d.document_type||'letter'}</strong></div>`
    : '';

  card.innerHTML = ` // Set HTML content
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div>
        <div style="font-size:16px;font-weight:800;color:var(--text)">${modeShortLabel} Session Evaluation</div>
        <div style="font-size:12px;color:var(--dim);margin-top:2px">${ciActiveField||ciField} · ${ciSrcLang} → ${ciTgtLang} · ${ciDifficulty} · ${ciMaxSegs} segments</div>
        ${decalageLine}${noiseLine}${scenarioLine}${wpmLine}
      </div>
      <div style="text-align:right">
        <div style="font-size:28px;font-weight:800;color:var(--text)">${d.overall_score||'—'}<span style="font-size:13px;color:var(--dim)">/100</span></div>
        <div style="font-size:13px;font-weight:700;color:${gradeColor}">${d.grade||'—'}</div>
      </div>
    </div>

    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);margin-bottom:8px">AIIC Dimensions</div>
    <div class="ci-kpi-grid">${kpiBoxes(kpis)}</div>

    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);margin:14px 0 8px">${modeShortLabel}-Specific KPIs</div>
    <div class="ci-kpi-grid" style="grid-template-columns:1fr 1fr">${kpiBoxes(ciSpecific)}</div>

    ${d.summary ? `<div style="margin:14px 0;padding:12px;background:var(--bg3);border-radius:9px;font-size:12px;color:var(--dim);line-height:1.6">${d.summary}</div>` : ''}

    ${d.strengths?.length ? `<div style="margin-bottom:8px"><div style="font-size:11px;color:var(--green);font-weight:700;margin-bottom:4px">Strength</div><div style="font-size:12px;color:var(--dim)">${d.strengths[0]}</div></div>` : ''}
    ${d.coaching_tips?.length ? `<div style="margin-bottom:8px"><div style="font-size:11px;color:var(--amber);font-weight:700;margin-bottom:4px">Coaching Tip</div><div style="font-size:12px;color:var(--dim)">${d.coaching_tips[0]}</div></div>` : ''}
    ${d.next_drill ? `<div style="padding:10px 12px;background:rgba(72,120,240,.08);border:1px solid rgba(72,120,240,.2);border-radius:8px;font-size:12px;color:var(--blue);margin-top:10px"><strong>Next drill:</strong> ${d.next_drill}</div>` : ''}

    ${segs ? `<div style="margin-top:16px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);margin-bottom:10px">Segment Breakdown</div>${segs}</div>` : ''}
  `;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * @description Updates the session status badge text and CSS class based on the current state.
 * @param {string} state - The new state identifier (e.g., 'listening', 'rendering', 'evaluating').
 * @returns {void}
 */
function ciSetState(state) {
  ciState = state; // Assign value to 'ciState'
  const badge = document.getElementById('ci-status-badge'); // Lookup DOM element 'ci-status-badge'
  if (!badge) return; // Evaluate conditional branch
  const labels = {
    setup:'Setup', loading:'Loading...', listening:'Listening',
    rendering:'Render Now', submitting:'Submitting...', evaluating:'Evaluating...',
    between: ciIsLiveRender() ? 'Between' : 'Submitted', done:'Complete'
  };
  badge.textContent = labels[state] || state; // Set text content
  badge.className = 'ci-status-badge';
  if (state === 'listening') badge.classList.add('listening'); // Add CSS class
  if (state === 'rendering') badge.classList.add('rendering'); // Add CSS class
  if (state === 'evaluating') badge.classList.add('evaluating'); // Add CSS class
}


/**
 * @description Renders segment progress pips in both the session view and prep view.
 * @returns {void}
 */
function ciRenderPips() {
  // Session-view pips
  const el = document.getElementById('ci-seg-progress'); // Lookup DOM element 'ci-seg-progress'
  if (el) { // Evaluate conditional branch
    let html = ''; // Initialize variable 'html'
    for (let i = 1; i <= ciMaxSegs; i++) {
      const isDone   = i < ciSegNum || (i === ciSegNum && ciState === 'between');
      const isActive = i === ciSegNum && ciState !== 'between';
      html += `<div class="ci-seg-pip ${isDone?'done':isActive?'active':''}"></div>`;
    }
    html += `<span class="ci-seg-label">${ciSegNum} / ${ciMaxSegs} segments</span>`;
    el.innerHTML = html; // Set HTML content
  }
  // Prep-view pip preview (all pending, no active yet)
  const prepPips = document.getElementById('ci-prep-seg-pips'); // Lookup DOM element 'ci-prep-seg-pips'
  const prepCount = document.getElementById('ci-prep-seg-count'); // Lookup DOM element 'ci-prep-seg-count'
  if (prepPips) { // Evaluate conditional branch
    prepPips.innerHTML = Array.from({length:ciMaxSegs}, ()=>'<div class="ci-seg-pip"></div>').join(''); // Set HTML content
  }
  if (prepCount) prepCount.textContent = `${ciMaxSegs} segments · ~${ciDuration} min`; // Set text content
}


// ── Dropdown-driven field/lang/dialect helpers ────────────────────────────────

/**
 * @description Handles field selection changes.
 *              Updates descriptions, field-type dropdown, participant caps, and UI hints.
 * @param {string} fieldId - The selected field identifier.
 * @returns {void}
 */
function ciFieldChanged(fieldId) {
  ciActiveField = fieldId; // Assign value to 'ciActiveField'
  const fieldData = CI_FIELDS[fieldId] || {};

  // Field description card in pre-view
  const hint = document.getElementById('ci-field-hint'); // Lookup DOM element 'ci-field-hint'
  if (hint) hint.textContent = fieldData.desc || ''; // Set text content
  const title = document.getElementById('ci-pre-field-title'); // Lookup DOM element 'ci-pre-field-title'
  if (title) title.textContent = CI_FIELD_NAMES[fieldId] || fieldId; // Set text content
  const tip = document.getElementById('ci-field-tip-pre'); // Lookup DOM element 'ci-field-tip-pre'
  if (tip) tip.textContent = CI_FIELD_TIPS[fieldId] || ''; // Set text content

  // Populate field-type sub-dropdown
  const typeSel = document.getElementById('ci-field-type'); // Lookup DOM element 'ci-field-type'
  if (typeSel) { // Evaluate conditional branch
    const types = CI_FIELD_TYPES[fieldId] || [];
    typeSel.innerHTML = types.map(t => `<option>${t}</option>`).join(''); // Set HTML content
    ciTypeChanged(types[0] || ''); // Invoke ciTypeChanged()
  }

  // Smart participants cap
  const maxPart = fieldData.maxPart ?? 0;
  const isFixed = maxPart === 0;
  ciParticipants = isFixed ? 0 : Math.min(ciParticipants, maxPart); // Get minimum value

  const section = document.getElementById('ci-part-section'); // Lookup DOM element 'ci-part-section'
  if (section) { // Evaluate conditional branch
    section.style.opacity  = isFixed ? '0.35' : '1'; // Adjust element opacity
    section.style.pointerEvents = isFixed ? 'none' : '';
  }
  const fixedNote = document.getElementById('ci-part-fixed-note'); // Lookup DOM element 'ci-part-fixed-note'
  if (fixedNote) { // Evaluate conditional branch
    fixedNote.textContent = isFixed ? (fieldData.fixedNote || 'Fixed exchange — no additional participants') : ''; // Set text content
    fixedNote.style.display = isFixed ? '' : 'none'; // Toggle element visibility
  }
  const numEl = document.getElementById('ci-part-num'); // Lookup DOM element 'ci-part-num'
  if (numEl) numEl.textContent = ciParticipants; // Set text content
  const minus = document.getElementById('ci-part-minus'); // Lookup DOM element 'ci-part-minus'
  const plus  = document.getElementById('ci-part-plus'); // Lookup DOM element 'ci-part-plus'
  if (minus) minus.disabled = isFixed || ciParticipants <= 0; // Evaluate conditional branch
  if (plus)  plus.disabled  = isFixed || ciParticipants >= maxPart; // Evaluate conditional branch

  const note = document.getElementById('ci-pre-part-note'); // Lookup DOM element 'ci-pre-part-note'
  if (note) note.textContent = isFixed // Set text content
    ? (fieldData.fixedNote || 'Fixed 2-person exchange by protocol')
    : `Up to ${maxPart} additional voice${maxPart!==1?'s':''} allowed`;
}


/**
 * @description Handles field-type selection changes.
 *              Updates duration options based on the selected field type.
 * @param {string} typeVal - The selected field type value.
 * @returns {void}
 */
function ciTypeChanged(typeVal) {
  ciFieldType = typeVal || document.getElementById('ci-field-type')?.value || ''; // Assign value to 'ciFieldType'
  const durSel = document.getElementById('ci-duration-sel'); // Lookup DOM element 'ci-duration-sel'
  if (!durSel) return; // Evaluate conditional branch
  const durations = (CI_TYPE_DURATIONS[ciActiveField] || {})[ciFieldType];
  if (durations && durations.length) { // Evaluate conditional branch
    durSel.innerHTML = durations.map((d, i) => `<option value="${d.v}"${i === 1 ? ' selected' : ''}>${d.l}</option>`).join(''); // Set HTML content
    // If only one option, select it
    if (durations.length === 1) durSel.selectedIndex = 0; // Evaluate conditional branch
  } else {
    // Fallback generic options
    durSel.innerHTML = [ // Set HTML content
      '<option value="10">10 min — Standard</option>',
      '<option value="20" selected>20 min — Extended</option>',
      '<option value="30">30 min — Full session</option>',
    ].join(''); // Join array into string
  }
  ciDuration = parseInt(durSel.value); // Parse integer from string
  ciMaxSegs = Math.max(2, Math.round(ciDuration / 2.5)); // Get maximum value
  ciUpdatePreview(); // Invoke ciUpdatePreview()
}


/**
 * @description Handles source language selection changes.
 *              Populates the source dialect dropdown for the chosen language.
 * @param {string} lang - The selected source language.
 * @returns {void}
 */
function ciSrcLangChanged(lang) {
  ciSrcLang = lang; // Assign value to 'ciSrcLang'
  const dialects = CI_DIALECTS[lang] || ['Standard ' + lang];
  const sel = document.getElementById('ci-src-dialect'); // Lookup DOM element 'ci-src-dialect'
  if (sel) sel.innerHTML = dialects.map(d=>`<option>${d}</option>`).join(''); // Set HTML content
}


/**
 * @description Handles target language selection changes.
 *              Populates the target dialect dropdown for the chosen language.
 * @param {string} lang - The selected target language.
 * @returns {void}
 */
function ciTgtLangChanged(lang) {
  ciTgtLang = lang; // Assign value to 'ciTgtLang'
  const dialects = CI_DIALECTS[lang] || ['Standard ' + lang];
  const sel = document.getElementById('ci-tgt-dialect'); // Lookup DOM element 'ci-tgt-dialect'
  if (sel) sel.innerHTML = dialects.map(d=>`<option>${d}</option>`).join(''); // Set HTML content
}

// ── Brief / Confirm ───────────────────────────────────────────────────────────

/**
 * @description Gathers form values and renders the assignment brief panel for review before starting.
 * @returns {void}
 */
function ciShowBrief() {
  // Read all form values into state
  const field    = document.getElementById('ci-field-sel')?.value  || 'medical'; // Lookup DOM element 'ci-field-sel'
  const fieldType= document.getElementById('ci-field-type')?.value || ''; // Lookup DOM element 'ci-field-type'
  const srcLang  = document.getElementById('ci-src-lang')?.value   || 'English'; // Lookup DOM element 'ci-src-lang'
  const srcDial  = document.getElementById('ci-src-dialect')?.value || ''; // Lookup DOM element 'ci-src-dialect'
  const tgtLang  = document.getElementById('ci-tgt-lang')?.value   || 'Arabic'; // Lookup DOM element 'ci-tgt-lang'
  const tgtDial  = document.getElementById('ci-tgt-dialect')?.value || ''; // Lookup DOM element 'ci-tgt-dialect'
  const diff     = document.getElementById('ci-diff-sel')?.value   || 'intermediate'; // Lookup DOM element 'ci-diff-sel'
  const dur      = parseInt(document.getElementById('ci-duration-sel')?.value || 10); // Lookup DOM element 'ci-duration-sel'
  const pace     = parseInt(document.getElementById('ci-pace-slider')?.value || 2); // Lookup DOM element 'ci-pace-slider'
  const oneWay   = document.getElementById('ci-oneway')?.checked   || false; // Lookup DOM element 'ci-oneway'

  ciActiveField = field; ciFieldType = fieldType; // Assign value to 'ciActiveField'
  ciSrcLang = srcLang; ciTgtLang = tgtLang; // Assign value to 'ciSrcLang'
  ciDifficulty  = diff;  ciDuration = dur;    ciPace = pace; ciOneWay = oneWay; // Assign value to 'ciDifficulty'
  ciLang = srcLang + ' → ' + tgtLang; // Assign value to 'ciLang'
  // Calculate segments from duration
  ciMaxSegs = Math.max(2, Math.round(dur / 2.5)); // Get maximum value

  const fieldInfo = CI_FIELDS[field] || {};
  const fieldName = CI_FIELD_NAMES[field] || field;
  const paceLabel = CI_PACE_INFO[pace] || '';
  const direction = oneWay ? `${srcLang} only (one-way)` : `${srcLang} ↔ ${tgtLang}`;
  const tip       = CI_FIELD_TIPS[field] || '';
  const diffNote  = (CI_DIFF_INFO[diff] || {}).note || '';

  const brief = `
  <div style="background:var(--bg3);border:1px solid var(--border);border-radius:12px;padding:16px 18px">
    <div style="font-size:9px;font-weight:800;color:var(--dim);text-transform:uppercase;letter-spacing:.09em;margin-bottom:14px">Assignment Brief</div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
      <div style="background:var(--bg2);border-radius:8px;padding:10px 12px">
        <div style="font-size:9px;color:var(--dim);font-weight:700;text-transform:uppercase;margin-bottom:4px">Field</div>
        <div style="font-size:13px;font-weight:700;color:var(--text)">${fieldName}</div>
        ${fieldType ? `<div style="font-size:10px;color:var(--blue);margin-top:3px;font-weight:600">${fieldType}</div>` : ''}
      </div>
      <div style="background:var(--bg2);border-radius:8px;padding:10px 12px">
        <div style="font-size:9px;color:var(--dim);font-weight:700;text-transform:uppercase;margin-bottom:4px">Direction</div>
        <div style="font-size:13px;font-weight:700;color:var(--text)">${direction}</div>
      </div>
      <div style="background:var(--bg2);border-radius:8px;padding:10px 12px">
        <div style="font-size:9px;color:var(--dim);font-weight:700;text-transform:uppercase;margin-bottom:4px">Languages</div>
        <div style="font-size:12px;font-weight:600;color:var(--text)">${srcLang}${srcDial?' · <span style="color:var(--dim);font-size:10px;font-weight:400">'+srcDial+'</span>':''}</div>
        <div style="font-size:12px;font-weight:600;color:var(--text);margin-top:2px">${tgtLang}${tgtDial?' · <span style="color:var(--dim);font-size:10px;font-weight:400">'+tgtDial+'</span>':''}</div>
      </div>
      <div style="background:var(--bg2);border-radius:8px;padding:10px 12px">
        <div style="font-size:9px;color:var(--dim);font-weight:700;text-transform:uppercase;margin-bottom:4px">Session Parameters</div>
        <div style="font-size:11px;color:var(--text)">${dur} min · ${diff.charAt(0).toUpperCase()+diff.slice(1)} · ${paceLabel}</div> // Extract substring or subarray
        <div style="font-size:10px;color:var(--dim);margin-top:2px">${diffNote}</div>
        <div style="font-size:10px;color:var(--dim);margin-top:1px">Protocol: ${fieldInfo.protocol||'—'}</div>
      </div>
    </div>

    <div style="background:rgba(72,120,240,.06);border:1px solid rgba(72,120,240,.2);border-radius:8px;padding:11px 13px;margin-bottom:10px">
      <div style="font-size:9px;font-weight:700;color:var(--blue);text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px">Context & Setting</div>
      <div style="font-size:11.5px;color:var(--dim);line-height:1.6">${fieldInfo.desc||''}</div>
    </div>

    <div style="background:rgba(232,151,30,.06);border:1px solid rgba(232,151,30,.2);border-radius:8px;padding:11px 13px;margin-bottom:10px">
      <div style="font-size:9px;font-weight:700;color:var(--gold);text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px">Professional Guidance</div>
      <div style="font-size:11.5px;color:var(--dim);line-height:1.6">${tip}</div>
    </div>

    <div style="font-size:11px;color:var(--dim);border-top:1px solid var(--border);padding-top:10px;line-height:1.65">
      <strong style="color:var(--text)">Introduction:</strong> The scenario will determine whether a formal interpreter introduction is required. Follow contextual cues from the speakers — the opening exchange will make it clear. Use professional judgment.
    </div>
  </div>`;

  document.getElementById('ci-brief-content').innerHTML = brief; // Set HTML content
  ciSwitchView('ci-brief-view'); // Invoke ciSwitchView()
}


/**
 * @description Commits form values and initiates the session start sequence.
 * @returns {void}
 */
function ciConfirmAndStart() {
  // Commit form values regardless of whether brief was shown
  const field    = document.getElementById('ci-field-sel')?.value  || 'medical'; // Lookup DOM element 'ci-field-sel'
  const fieldType= document.getElementById('ci-field-type')?.value || ''; // Lookup DOM element 'ci-field-type'
  const srcLang  = document.getElementById('ci-src-lang')?.value   || 'English'; // Lookup DOM element 'ci-src-lang'
  const srcDial  = document.getElementById('ci-src-dialect')?.value || ''; // Lookup DOM element 'ci-src-dialect'
  const tgtLang  = document.getElementById('ci-tgt-lang')?.value   || 'Arabic'; // Lookup DOM element 'ci-tgt-lang'
  const tgtDial  = document.getElementById('ci-tgt-dialect')?.value || ''; // Lookup DOM element 'ci-tgt-dialect'
  const diff     = document.getElementById('ci-diff-sel')?.value   || 'intermediate'; // Lookup DOM element 'ci-diff-sel'
  const dur      = parseInt(document.getElementById('ci-duration-sel')?.value || 10); // Lookup DOM element 'ci-duration-sel'
  const pace     = parseInt(document.getElementById('ci-pace-slider')?.value || 2); // Lookup DOM element 'ci-pace-slider'
  const oneWay   = document.getElementById('ci-oneway')?.checked   || false; // Lookup DOM element 'ci-oneway'
  const verbatim = document.getElementById('ci-verbatim')?.checked || false; // Lookup DOM element 'ci-verbatim'
  ciActiveField = field; ciFieldType = fieldType; // Assign value to 'ciActiveField'
  ciSrcLang = srcLang;  ciTgtLang = tgtLang; // Assign value to 'ciSrcLang'
  ciDifficulty = diff;  ciDuration = dur; ciPace = pace; ciOneWay = oneWay; ciVerbatim = verbatim; // Assign value to 'ciDifficulty'
  ciLang = srcLang + ' → ' + tgtLang; // Assign value to 'ciLang'
  ciMaxSegs = Math.max(2, Math.round(ciDuration / 2.5)); // Get maximum value
  ciStartSession(); // Invoke ciStartSession()
}

// ── Session timer ─────────────────────────────────────────────────────────────

/**
 * @description Starts the session elapsed-time timer and manages the AIIC rotation reminder banner.
 * @returns {void}
 */
function ciStartSessionTimer() {
  if (ciSessionTimer) clearInterval(ciSessionTimer); // Stop repeating interval timer
  const el = document.getElementById('ci-session-elapsed'); // Lookup DOM element 'ci-session-elapsed'
  if (!el) return; // Evaluate conditional branch
  el.style.display = ''; // Show the element (default display)
  let secs = 0; // Initialize variable 'secs'
  ciSessionTimer = setInterval(() => { // Start repeating interval timer
    secs++;
    const mm = String(Math.floor(secs/60)).padStart(2,'0'); // Pad string to minimum length
    const ss = String(secs%60).padStart(2,'0'); // Pad string to minimum length
    el.textContent = `${mm}:${ss}`; // Set text content
    // 20-30 min rotation reminder (AIIC "tag team" rule) — only for sessions long enough to matter, shown once
    if (!ciRotationShown && ciDuration >= 30 && secs >= 1200 && secs <= 1800) { // Evaluate conditional branch
      ciRotationShown = true; // Assign value to 'ciRotationShown'
      const banner = document.getElementById('ci-rotation-banner'); // Lookup DOM element 'ci-rotation-banner'
      if (banner) banner.style.display = ''; // Show the element (default display)
    }
  }, 1000);
}


/**
 * @description Stops the session elapsed-time timer.
 * @returns {void}
 */
function ciStopSessionTimer() {
  if (ciSessionTimer) { clearInterval(ciSessionTimer); ciSessionTimer = null; } // Stop repeating interval timer
}

// ── Setup helper functions ────────────────────────────────────────────────────

/**
 * @description Legacy card-based field selector; updates active field, description, and participant cap.
 * @param {string} fieldId - The selected field identifier.
 * @param {HTMLElement} el - The clicked card element.
 * @returns {void}
 */
function ciSelectField(fieldId, el) {
  ciActiveField = fieldId; // Assign value to 'ciActiveField'
  // Update active card
  document.querySelectorAll('.ci-field-card').forEach(c=>c.classList.remove('active')); // Remove CSS class
  if (el) el.classList.add('active'); // Add CSS class
  // Update description
  const desc = document.getElementById('ci-field-desc'); // Lookup DOM element 'ci-field-desc'
  if (desc) desc.textContent = (CI_FIELDS[fieldId]||{}).desc || ''; // Set text content
  // Update participants cap
  const maxPart = (CI_FIELDS[fieldId]||{}).maxPart ?? 0;
  if (ciParticipants > maxPart) ciParticipants = maxPart; // Evaluate conditional branch
  const numEl = document.getElementById('ci-part-num'); // Lookup DOM element 'ci-part-num'
  if (numEl) numEl.textContent = ciParticipants; // Set text content
  const minus = document.getElementById('ci-part-minus'); // Lookup DOM element 'ci-part-minus'
  const plus  = document.getElementById('ci-part-plus'); // Lookup DOM element 'ci-part-plus'
  if (minus) minus.disabled = ciParticipants <= 0; // Evaluate conditional branch
  if (plus)  plus.disabled  = ciParticipants >= maxPart; // Evaluate conditional branch
  const note = document.getElementById('ci-part-note'); // Lookup DOM element 'ci-part-note'
  if (note) note.textContent = maxPart === 0 // Set text content
    ? 'No additional participants in this environment'
    : `Up to ${maxPart} additional voice${maxPart!==1?'s':''} in this environment`;
  ciUpdatePreview(); // Invoke ciUpdatePreview()
}


/**
 * @description Legacy card-based difficulty selector.
 * @param {string} diffId - The selected difficulty identifier.
 * @param {HTMLElement} el - The clicked card element.
 * @returns {void}
 */
function ciSelectDiff(diffId, el) {
  ciDifficulty = diffId; // Assign value to 'ciDifficulty'
  document.querySelectorAll('.ci-diff-card').forEach(c=>c.classList.remove('active')); // Remove CSS class
  if (el) el.classList.add('active'); // Add CSS class
  ciUpdatePreview(); // Invoke ciUpdatePreview()
}


/**
 * @description Legacy card-based segment count selector.
 * @param {number} n - The selected segment count.
 * @param {HTMLElement} el - The clicked card element.
 * @returns {void}
 */
function ciSelectSegs(n, el) {
  ciMaxSegs = n; // Assign value to 'ciMaxSegs'
  document.querySelectorAll('.ci-seg-card-sel').forEach(c=>c.classList.remove('active')); // Remove CSS class
  if (el) el.classList.add('active'); // Add CSS class
  ciUpdatePreview(); // Invoke ciUpdatePreview()
}


/**
 * @description Updates the pace display and global pace state when the slider changes.
 * @param {number} val - The pace slider value (1-4).
 * @returns {void}
 */
function ciUpdatePace(val) {
  ciPace = +val; // Assign value to 'ciPace'
  const el = document.getElementById('ci-pace-display'); // Lookup DOM element 'ci-pace-display'
  if (el) el.textContent = CI_PACE_INFO[ciPace] || ''; // Set text content
  ciUpdatePreview(); // Invoke ciUpdatePreview()
}


/**
 * @description Adjusts the number of additional participants by a delta, respecting field maxima.
 * @param {number} delta - The change in participant count (+1 or -1).
 * @returns {void}
 */
function ciAdjustPart(delta) {
  const maxPart = (CI_FIELDS[ciActiveField]||{}).maxPart ?? 0;
  ciParticipants = Math.max(0, Math.min(maxPart, ciParticipants + delta)); // Get minimum value
  const numEl = document.getElementById('ci-part-num'); // Lookup DOM element 'ci-part-num'
  if (numEl) numEl.textContent = ciParticipants; // Set text content
  const minus = document.getElementById('ci-part-minus'); // Lookup DOM element 'ci-part-minus'
  const plus  = document.getElementById('ci-part-plus'); // Lookup DOM element 'ci-part-plus'
  if (minus) minus.disabled = ciParticipants <= 0; // Evaluate conditional branch
  if (plus)  plus.disabled  = ciParticipants >= maxPart; // Evaluate conditional branch
}


/**
 * @description Swaps the source and target language selections.
 * @returns {void}
 */
function ciSwapLangs() {
  const srcEl = document.getElementById('ci-src-lang'); // Lookup DOM element 'ci-src-lang'
  const tgtEl = document.getElementById('ci-tgt-lang'); // Lookup DOM element 'ci-tgt-lang'
  if (!srcEl || !tgtEl) return; // Evaluate conditional branch
  const tmp = srcEl.value;
  srcEl.value = tgtEl.value; // Set input value
  tgtEl.value = tmp; // Set input value
  ciSrcLang = srcEl.value; // Assign value to 'ciSrcLang'
  ciTgtLang = tgtEl.value; // Assign value to 'ciTgtLang'
  ciUpdatePreview(); // Invoke ciUpdatePreview()
}


/**
 * @description Toggles one-way interpretation mode and updates the UI arrow opacity.
 * @param {boolean} checked - Whether one-way mode is enabled.
 * @returns {void}
 */
function ciToggleOneWay(checked) {
  ciOneWay = checked; // Assign value to 'ciOneWay'
  const grp = document.getElementById('ci-left-arrow-grp'); // Lookup DOM element 'ci-left-arrow-grp'
  if (grp) grp.style.opacity = checked ? '0.1' : '1'; // Adjust element opacity
  ciUpdatePreview(); // Invoke ciUpdatePreview()
}


/**
 * @description Updates the session preview text summarizing current selections.
 * @returns {void}
 */
function ciUpdatePreview() {
  const el = document.getElementById('ci-preview'); // Lookup DOM element 'ci-preview'
  if (!el) return; // Evaluate conditional branch
  const fName = ciActiveField ? ciActiveField.charAt(0).toUpperCase() + ciActiveField.slice(1) : 'Medical'; // Extract substring or subarray
  const diff  = CI_DIFF_INFO[ciDifficulty] || CI_DIFF_INFO.intermediate;
  const proto = (CI_FIELDS[ciActiveField]||{}).protocol || 'AIIC';
  const dir   = ciOneWay ? `${ciSrcLang} only (one-way)` : `${ciSrcLang} → ${ciTgtLang}`;
  el.innerHTML = `<strong>${fName} · ${dir} · ${ciDifficulty.charAt(0).toUpperCase()+ciDifficulty.slice(1)}</strong><br> // Set HTML content
    ${ciMaxSegs} segments · ${ciParticipants > 0 ? ciParticipants+' additional voice'+(ciParticipants>1?'s':'')+' · ' : ''}${proto} protocol`;
}

// ── Camera — three states: off → live ("Record") → recording ("Stop Recording") ─
let ciCameraStream = null; // Initialize variable 'ciCameraStream'
let ciMediaRecorder = null; // Initialize variable 'ciMediaRecorder'
let ciRecordChunks  = []; // Initialize variable 'ciRecordChunks'


/**
 * @description Initializes the room canvas animation loop for the given field.
 * @param {string} fieldId - The field identifier used to determine room layout.
 * @returns {void}
 */
function ciInitCanvas(fieldId) {
  const canvas = document.getElementById('ci-room-canvas'); // Lookup DOM element 'ci-room-canvas'
  if (!canvas) return; // Evaluate conditional branch
  ciRoomTick = 0; // Assign value to 'ciRoomTick'
  function loop() {
    ciDrawRoomB(canvas, fieldId || ciActiveField || 'medical'); // Invoke ciDrawRoomB()
    ciRoomTick++;
    ciAnimId = requestAnimationFrame(loop); // Schedule next animation frame
  }
  loop(); // Invoke loop()
}


/**
 * @description Stops the room canvas animation loop.
 * @returns {void}
 */
function ciStopCanvas() {
  if (ciAnimId) { cancelAnimationFrame(ciAnimId); ciAnimId = null; } // Cancel animation frame
}


/**
 * @description Draws the interpreter POV room scene on the canvas.
 *              Renders background, perspective floor, ceiling, walls, protocol badge, and animated figures.
 * @param {HTMLCanvasElement} canvas - The canvas element to draw on.
 * @param {string} fieldId - The field identifier determining figure layout and colors.
 * @returns {void}
 */
function ciDrawRoomB(canvas, fieldId) {
  const ctx = canvas.getContext('2d'); // Get canvas 2D rendering context
  const W = canvas.width, H = canvas.height;

  // ── Background ──
  const bg = ctx.createRadialGradient(W*.5, H*.4, 0, W*.5, H*.5, W*.75); // Create radial gradient for fill
  bg.addColorStop(0, '#212121'); // Add color stop to gradient
  bg.addColorStop(1, '#0a0a0a'); // Add color stop to gradient
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H); // Fill rectangular region

  // ── Perspective floor ──
  const vx = W * .5, vy = H * .32;
  ctx.strokeStyle = 'rgba(255,255,255,0.035)';
  ctx.lineWidth = 1;
  const floorLines = 8; // Initialize variable 'floorLines'
  for (let i = 0; i <= floorLines; i++) {
    const t  = i / floorLines;
    const y  = vy + (H - vy) * Math.pow(t, 1.4); // Compute power
    const hw = (y - vy) / (H - vy) * W * .62;
    ctx.beginPath(); // Start new drawing path
    ctx.moveTo(vx - hw, y); // Move path cursor to point
    ctx.lineTo(vx + hw, y); // Draw line to point
    ctx.stroke(); // Stroke the current path
  }
  for (let i = -5; i <= 5; i++) {
    ctx.beginPath(); // Start new drawing path
    ctx.moveTo(vx + i * W * .055, vy); // Move path cursor to point
    ctx.lineTo(vx + i * W * .22, H); // Draw line to point
    ctx.stroke(); // Stroke the current path
  }

  // ── Ceiling line ──
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, H*.1); ctx.lineTo(W, H*.1); ctx.stroke(); // Start new drawing path

  // ── Left & right walls hint ──
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, H*.1); ctx.lineTo(vx, vy); ctx.stroke(); // Start new drawing path
  ctx.beginPath(); ctx.moveTo(W, H*.1); ctx.lineTo(vx, vy); ctx.stroke(); // Start new drawing path

  // ── Field label (upper left) ──
  ctx.font = '700 9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.textAlign = 'left';
  const fieldLabel = (CI_FIELD_NAMES[fieldId] || '').toUpperCase(); // Convert to uppercase
  ctx.fillText(fieldLabel, 14, 20); // Draw text on canvas

  // ── POV label (lower left) ──
  ctx.font = '500 8px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillStyle = 'rgba(72,120,240,0.45)';
  ctx.fillText('INTERPRETER POV', 14, H - 10); // Draw text on canvas

  // ── Protocol badge (upper right) ──
  const proto = (CI_FIELDS[fieldId]||{}).protocol || 'AIIC';
  ctx.font = '700 8px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillStyle = 'rgba(72,120,240,0.5)';
  ctx.textAlign = 'right';
  ctx.fillText(proto + ' PROTOCOL', W - 14, 20); // Draw text on canvas
  ctx.textAlign = 'left';

  // ── Figures ──
  const figs = CI_FIELD_FIGS[fieldId] || CI_FIELD_FIGS.medical;
  figs.forEach((fig, idx) => { // Iterate over each element
    const fx = fig.x * W;
    const fy = fig.y * H;
    const isActive = idx === ciActiveSpeakerIdx;

    // Role color from palette
    const roleColor = CI_FIGURE_COLORS[Math.min(idx, CI_FIGURE_COLORS.length - 1)]; // Get minimum value
    const rgb = roleColor.rgb;

    // Depth scale (figures further back appear smaller)
    const depthT = fig.y;  // 0=top(far), 1=bottom(close)
    const scale  = 0.65 + depthT * 0.55;
    const headR  = 9  * scale;
    const bodyW  = 13 * scale;
    const bodyH  = 20 * scale;
    const headY  = fy - bodyH - headR;

    // ── Pulse rings (active speaker) — colored per role ──
    if (isActive) { // Evaluate conditional branch
      const phase = (ciRoomTick % 80) / 80;
      for (let r = 0; r < 3; r++) {
        const p = (phase + r * 0.33) % 1;
        const radius = headR + 4 + p * 24 * scale;
        const alpha  = (1 - p) * 0.32;
        ctx.beginPath(); // Start new drawing path
        ctx.arc(fx, headY, radius, 0, Math.PI * 2); // Draw arc or circle
        ctx.strokeStyle = `rgba(${rgb},${alpha})`;
        ctx.lineWidth   = 1.2;
        ctx.stroke(); // Stroke the current path
      }
    }

    // ── Shadow under figure ──
    const shadowGrad = ctx.createRadialGradient(fx, fy, 0, fx, fy, bodyW * 1.3); // Create radial gradient for fill
    shadowGrad.addColorStop(0, 'rgba(0,0,0,0.3)'); // Add color stop to gradient
    shadowGrad.addColorStop(1, 'rgba(0,0,0,0)'); // Add color stop to gradient
    ctx.fillStyle = shadowGrad;
    ctx.beginPath(); // Start new drawing path
    ctx.ellipse(fx, fy + 2, bodyW * 1.1, bodyW * 0.35, 0, 0, Math.PI * 2); // Draw ellipse
    ctx.fill(); // Fill the current path

    // ── Figure silhouette — role color when active, desaturated when silent ──
    const baseAlpha = isActive ? 0.9 : 0.38;
    const figColor  = isActive // Initialize variable 'figColor'
      ? `rgba(${rgb},${baseAlpha})`
      : `rgba(${rgb},${baseAlpha})`;  // same formula — alpha does the work

    // Body (trapezoid)
    ctx.beginPath(); // Start new drawing path
    ctx.moveTo(fx - bodyW * .55, fy - bodyH * .05); // Move path cursor to point
    ctx.lineTo(fx - bodyW * .72, fy); // Draw line to point
    ctx.lineTo(fx + bodyW * .72, fy); // Draw line to point
    ctx.lineTo(fx + bodyW * .55, fy - bodyH * .05); // Draw line to point
    ctx.lineTo(fx + bodyW * .42, fy - bodyH); // Draw line to point
    ctx.lineTo(fx - bodyW * .42, fy - bodyH); // Draw line to point
    ctx.closePath(); // Close current path
    ctx.fillStyle = figColor;
    ctx.fill(); // Fill the current path

    // Head
    ctx.beginPath(); // Start new drawing path
    ctx.arc(fx, headY, headR, 0, Math.PI * 2); // Draw arc or circle
    ctx.fillStyle = figColor;
    ctx.fill(); // Fill the current path

    // Neck
    ctx.fillStyle = figColor;
    ctx.fillRect(fx - headR * .3, headY + headR - 1, headR * .6, bodyH * .1 + 2); // Fill rectangular region

    // ── Active speaker mic dot ──
    if (isActive) { // Evaluate conditional branch
      ctx.beginPath(); // Start new drawing path
      ctx.arc(fx, fy + 7 * scale, 3 * scale, 0, Math.PI * 2); // Draw arc or circle
      ctx.fillStyle = `rgba(${rgb},0.9)`;
      ctx.fill(); // Fill the current path
    }

    // ── Role label ──
    ctx.font = `${isActive ? '700' : '500'} ${8 * scale + 1}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.fillStyle = isActive ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.22)';
    ctx.textAlign = 'center';
    ctx.fillText(fig.role.toUpperCase(), fx, fy + 14 * scale); // Convert to uppercase
    ctx.textAlign = 'left';
  });
}

// ── Canvas legend — renders role color swatches, highlights active speaker ────

/**
 * @description Updates the canvas legend HTML to highlight the currently active speaker.
 * @param {number} activeIdx - The index of the active speaker figure.
 * @returns {void}
 */
function ciUpdateLegend(activeIdx) {
  const legend = document.getElementById('ci-canvas-legend'); // Lookup DOM element 'ci-canvas-legend'
  if (!legend) return; // Evaluate conditional branch
  const figs = CI_FIELD_FIGS[ciActiveField] || CI_FIELD_FIGS.medical;
  legend.innerHTML = figs.map((fig, idx) => { // Set HTML content
    const col = CI_FIGURE_COLORS[Math.min(idx, CI_FIGURE_COLORS.length - 1)]; // Get minimum value
    const isActive = idx === activeIdx;
    return `<span style="display:flex;align-items:center;gap:5px;font-size:10px;font-weight:${isActive?'700':'500'};color:${isActive?'var(--text)':'var(--dim)'};transition:all .25s"> // Return value to caller
      <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${col.solid};opacity:${isActive?'1':'0.45'};box-shadow:${isActive?`0 0 6px ${col.solid}`:'none'};transition:all .25s;flex-shrink:0"></span>
      ${fig.role}
    </span>`;
  }).join('') + // Join array into string
  `<span style="display:flex;align-items:center;gap:5px;font-size:10px;font-weight:500;color:var(--dim);margin-left:auto">
    <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#6b7280;flex-shrink:0"></span>
    You (Interpreter — POV)
  </span>`;
}

// ── Reset ─────────────────────────────────────────────────────────────────────

/**
 * @description Resets all session state, UI elements, and resources to their initial values.
 * @returns {void}
 */
function ciReset() {
  ciStopCanvas(); // Invoke ciStopCanvas()
  ciStopSessionTimer(); // Invoke ciStopSessionTimer()
  ciSid = null; ciSegNum = 0; ciRenditions = []; // Assign value to 'ciSid'
  ciAudioBytes = null; ciActiveSpeakerIdx = 0; ciParticipants = 0; // Assign value to 'ciAudioBytes'
  ciFirstSegAudio = null; ciFirstSegText = null; ciPrepCameraReady = false; // Assign value to 'ciFirstSegAudio'
  // Stop any active camera stream on reset
  if (ciCameraStream) { ciCameraStream.getTracks().forEach(t=>t.stop()); ciCameraStream = null; } // Iterate over each element
  if (ciMediaRecorder && ciMediaRecorder.state !== 'inactive') { try{ciMediaRecorder.stop();}catch(e){} } // Stop media track
  ciMediaRecorder = null; ciRecordChunks = []; // Assign value to 'ciMediaRecorder'
  // Clear SI state
  if (ciDecalageTimer) { clearInterval(ciDecalageTimer); ciDecalageTimer = null; } // Stop repeating interval timer
  ciSegStartTs = 0; ciRecStartTs = 0; // Assign value to 'ciSegStartTs'
  document.getElementById('ci-decalage-indicator')?.style && (document.getElementById('ci-decalage-indicator').style.display = 'none'); // Hide the element
  document.querySelector('.ci-rec-dot')?.remove(); // Remove element from DOM if present
  // Reset prep camera UI
  const prepVideo = document.getElementById('ci-prep-camera-video'); // Lookup DOM element 'ci-prep-camera-video'
  const prepOff   = document.getElementById('ci-prep-camera-off'); // Lookup DOM element 'ci-prep-camera-off'
  const prepBtn   = document.getElementById('ci-prep-cam-btn'); // Lookup DOM element 'ci-prep-cam-btn'
  if (prepVideo) { prepVideo.srcObject = null; prepVideo.style.display = 'none'; } // Hide the element
  if (prepOff)   prepOff.style.display = ''; // Show the element (default display)
  if (prepBtn)   { prepBtn.textContent = 'Enable'; prepBtn.style.background = ''; prepBtn.style.borderColor = ''; prepBtn.style.color = ''; } // Set text color
  // Reset session camera UI
  const sessVideo = document.getElementById('ci-camera-video'); // Lookup DOM element 'ci-camera-video'
  const sessOff   = document.getElementById('ci-camera-off'); // Lookup DOM element 'ci-camera-off'
  const sessBtn   = document.getElementById('ci-cam-btn'); // Lookup DOM element 'ci-cam-btn'
  if (sessVideo) { sessVideo.srcObject = null; sessVideo.style.display = 'none'; } // Hide the element
  if (sessOff)   sessOff.style.display = ''; // Show the element (default display)
  if (sessBtn)   { sessBtn.textContent = 'Enable'; sessBtn.style.background = ''; sessBtn.style.borderColor = ''; sessBtn.style.color = ''; } // Set text color
  // Reset elapsed timer
  const elapsed = document.getElementById('ci-session-elapsed'); // Lookup DOM element 'ci-session-elapsed'
  if (elapsed) { elapsed.style.display = 'none'; elapsed.textContent = '00:00'; } // Hide the element
  // Reset pace
  const paceSlider = document.getElementById('ci-pace-slider'); // Lookup DOM element 'ci-pace-slider'
  if (paceSlider) paceSlider.value = '2'; // Set input value
  const paceDsp = document.getElementById('ci-pace-display'); // Lookup DOM element 'ci-pace-display'
  if (paceDsp) paceDsp.textContent = CI_PACE_INFO[2]; // Set text content
  ciPace = 2; // Assign value to 'ciPace'
  // Reset participants
  const numEl = document.getElementById('ci-part-num'); // Lookup DOM element 'ci-part-num'
  if (numEl) numEl.textContent = '0'; // Set text content
  const minus = document.getElementById('ci-part-minus'); // Lookup DOM element 'ci-part-minus'
  if (minus) minus.disabled = true; // Evaluate conditional branch
  // Re-init field hint from current selection
  const field = document.getElementById('ci-field-sel')?.value || 'medical'; // Lookup DOM element 'ci-field-sel'
  ciFieldChanged(field); // Invoke ciFieldChanged()
  // Go back to pre-session view
  ciSwitchView('ci-pre-view'); // Invoke ciSwitchView()
}
// ══════════════════════════════════════════════════════════════════════════════


// ── Gamification engine ────────────────────────────────────────
const XP_LEVEL_THRESHOLDS = [0,200,500,1000,2000,3500,5500,8000,11000,15000]; // Initialize variable 'XP_LEVEL_THRESHOLDS'
const LEVEL_NAMES = ['Novice','Apprentice','Practitioner','Interpreter','Professional','Expert','Senior Expert','Master','Grand Master','Legend']; // Initialize variable 'LEVEL_NAMES'
const LEVEL_ICONS = ['L1','L2','L3','L4','L5','L6','L7','L8','L9','L10']; // Initialize variable 'LEVEL_ICONS'


/**
 * @description Starts a new CI/SI session by calling the backend /api/ci/new-session endpoint.
 *              Populates the preparation room with session data and switches to the prep view.
 * @returns {Promise<void>}
 */
async function ciStartSession() {
  // Commit form state (covers both brief-flow and direct-start paths)
  ciSrcLang = document.getElementById('ci-src-lang')?.value || ciSrcLang; // Assign value to 'ciSrcLang'
  ciTgtLang = document.getElementById('ci-tgt-lang')?.value || ciTgtLang; // Assign value to 'ciTgtLang'
  ciLang    = ciSrcLang + ' → ' + ciTgtLang; // Assign value to 'ciLang'
  ciField   = document.getElementById('ci-field-sel')?.value || ciActiveField || 'medical'; // Assign value to 'ciField'
  ciDifficulty = document.getElementById('ci-diff-sel')?.value || ciDifficulty; // Assign value to 'ciDifficulty'
  ciActiveField = ciField; // Assign value to 'ciActiveField'
  ciRenditions = []; // Assign value to 'ciRenditions'
  ciSegNum     = 0; // Assign value to 'ciSegNum'

  ciSetState('loading'); // Invoke ciSetState()
  document.getElementById('ci-eval-msg').textContent = 'Preparing your session...';
  ciSwitchView('ci-loading-view'); // Invoke ciSwitchView()

  const fd = new FormData(); // Create FormData for POST request
  fd.append('field', ciField); // Append field to FormData
  fd.append('field_type', ciFieldType || ''); // Append field to FormData
  fd.append('language', ciLang); // Append field to FormData
  fd.append('difficulty', ciDifficulty); // Append field to FormData
  fd.append('segments', ciMaxSegs); // Append field to FormData
  fd.append('pace', ciPace); // Append field to FormData
  fd.append('participants', ciParticipants); // Append field to FormData
  fd.append('one_way', ciOneWay ? '1' : '0'); // Append field to FormData
  fd.append('mode', ciModeKind); // Append field to FormData
  fd.append('verbatim', ciVerbatim ? '1' : '0'); // Append field to FormData
  fd.append('atmosphere', ciModeKind === 'simultaneous' ? ciAtmosphere : 'booth'); // Append field to FormData
  if (ciModeKind === 'chuchotage') { // Evaluate conditional branch
    fd.append('listener_count', ciListenerCount); // Append field to FormData
    fd.append('noise_level', ciNoiseLevel); // Append field to FormData
  }
  if (ciModeKind === 'escort') { // Evaluate conditional branch
    fd.append('scenario_type', ciScenarioType); // Append field to FormData
  }
  if (ciModeKind === 'sight') { // Evaluate conditional branch
    fd.append('document_type', ciDocumentType); // Append field to FormData
    fd.append('sight_mode', ciSightMode); // Append field to FormData
  }

  try { // Begin try block
    const r = await fetch('/api/ci/new-session', {method:'POST', body:fd}); // Send HTTP request to backend
    const d = await r.json(); // Parse JSON response
    if (d.error) { alert('Error starting session: ' + d.error); ciReset(); return; } // Evaluate conditional branch

    ciSid          = d.session_id; // Assign value to 'ciSid'
    ciPersona      = d.persona || {}; // Assign value to 'ciPersona'
    ciSegText      = d.document_text || d.segment_text; // Assign value to 'ciSegText'
    ciSegNum       = 1; // Assign value to 'ciSegNum'
    ciFirstSegAudio = d.audio_b64; // Assign value to 'ciFirstSegAudio'
    ciFirstSegText  = d.document_text || d.segment_text; // Assign value to 'ciFirstSegText'
    ciEvsTargetSec  = d.evs_target_sec || ciEvsTargetSec; // Assign value to 'ciEvsTargetSec'
    ciWpmTarget     = d.wpm_target || ciWpmTarget; // Assign value to 'ciWpmTarget'

    // ── Populate Preparation Room ──────────────────────────────────────────
    // Brief card
    const fieldTypeLine = ciFieldType ? ` — ${ciFieldType}` : '';
    const diffNote = (CI_DIFF_INFO[ciDifficulty]||CI_DIFF_INFO.intermediate).note;
    const proto    = (CI_FIELDS[ciField]||{}).protocol || 'AIIC';
    const tip      = CI_FIELD_TIPS[ciField] || '';
    const el = document.getElementById('ci-prep-brief'); // Lookup DOM element 'ci-prep-brief'
    if (el) el.innerHTML = ` // Set HTML content
      <div style="font-size:9px;font-weight:800;color:var(--dim);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">
        ${CI_FIELD_NAMES[ciField]||ciField}${fieldTypeLine} &nbsp;·&nbsp; ${ciSrcLang} → ${ciTgtLang}
      </div>
      <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:4px">${ciPersona.name || 'Unknown'}</div>
      <div style="font-size:11px;color:var(--dim);margin-bottom:10px">${d.provider_role || ''} &nbsp;·&nbsp; ${d.field || ciField}</div>
      <div style="font-size:12px;color:var(--dim);margin-bottom:12px;line-height:1.65">${d.topic || ''}</div>
      <div style="padding:10px 12px;background:var(--bg3);border-radius:7px;margin-bottom:10px">
        <div style="font-size:9px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px">Difficulty — ${ciDifficulty.charAt(0).toUpperCase()+ciDifficulty.slice(1)}</div> // Extract substring or subarray
        <div style="font-size:11px;color:var(--dim);line-height:1.6">${diffNote}</div>
      </div>
      <div style="padding:10px 12px;background:rgba(232,151,30,.07);border:1px solid rgba(232,151,30,.2);border-radius:7px">
        <div style="font-size:9px;font-weight:700;color:var(--gold);text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px">${proto} Field Tip</div>
        <div style="font-size:11px;color:var(--dim);line-height:1.6">${tip}</div>
      </div>`;

    // Segment pips
    ciRenderPips(); // Invoke ciRenderPips()

    // Session header info (populated now, visible when session-view opens)
    const hdr = document.getElementById('ci-hdr-info'); // Lookup DOM element 'ci-hdr-info'
    if (hdr) hdr.textContent = `${CI_FIELD_NAMES[ciField]||ciField} · ${ciSrcLang} → ${ciTgtLang} · ${ciDifficulty}`; // Set text content
    const statField = document.getElementById('ci-stat-field'); // Lookup DOM element 'ci-stat-field'
    const statDiff  = document.getElementById('ci-stat-diff'); // Lookup DOM element 'ci-stat-diff'
    if (statField) statField.textContent = ciField.charAt(0).toUpperCase() + ciField.slice(1); // Set text content
    if (statDiff)  statDiff.textContent  = ciDifficulty.charAt(0).toUpperCase() + ciDifficulty.slice(1); // Extract substring or subarray
    const roomLbl = document.getElementById('ci-room-field-label'); // Lookup DOM element 'ci-room-field-label'
    if (roomLbl) roomLbl.textContent = CI_FIELD_NAMES[ciField] || ciField; // Set text content

    // Render persona card (session-view sidebar — pre-populated)
    const initials = (ciPersona.name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase(); // Transform each element
    document.getElementById('ci-avatar').textContent       = initials;
    document.getElementById('ci-persona-name').textContent = ciPersona.name || d.provider_role;
    document.getElementById('ci-persona-role').textContent = d.provider_role + ' · ' + d.field;
    document.getElementById('ci-topic-tag').textContent    = d.topic;

    // Reset prep camera state
    ciPrepCameraReady = false; // Assign value to 'ciPrepCameraReady'
    ciUpdateBeginBtn(); // Invoke ciUpdateBeginBtn()

    // Show sight-mode toggle only for sight translation
    const sightToggle = document.getElementById('ci-sight-mode-toggle'); // Lookup DOM element 'ci-sight-mode-toggle'
    if (sightToggle) sightToggle.style.display = ciModeKind === 'sight' ? '' : 'none'; // Toggle element visibility
    ciSetSightMode(ciSightMode); // refresh button styles

    ciSwitchView('ci-prep-view'); // Invoke ciSwitchView()

  } catch(e) { // Handle exception
    console.error('CI session start failed:', e);
    alert('Could not start session. Is the server running?'); // Invoke alert()
    ciReset(); // Invoke ciReset()
  }
}

// ── Begin Interpretation — user-triggered from Preparation Room ──────────────
let ciPrepCameraReady = false;  // true once camera is recording in prep room


/**
 * @description Submits the interpreter's rendition for the current segment to the backend.
 * @returns {Promise<void>}
 */
async function ciSubmitRendition() {
  const rendition = (document.getElementById('ci-rendition').value || '').trim(); // Lookup DOM element 'ci-rendition'
  const notes     = (document.getElementById('ci-notes').value     || '').trim(); // Lookup DOM element 'ci-notes'
  if (!rendition) { document.getElementById('ci-rendition').focus(); return; } // Focus input element

  ciRenditions.push({seg: ciSegNum, notes, rendered: rendition}); // Append item to array

  ciSetState('submitting'); // Invoke ciSetState()
  document.getElementById('ci-render-zone').style.display = 'none'; // Hide the element

  const fd = new FormData(); // Create FormData for POST request
  fd.append('session_id', ciSid); // Append field to FormData
  fd.append('segment_num', ciSegNum); // Append field to FormData
  fd.append('segment_text', ciSegText); // Append field to FormData
  fd.append('interpreter_text', rendition); // Append field to FormData
  if (ciIsLiveRender() && ciSegStartTs) { // Evaluate conditional branch
    fd.append('decalage_sec', ((Date.now() - ciSegStartTs) / 1000).toFixed(2)); // Format number to fixed decimal places
  }
  if (ciModeKind === 'sight' && ciReadStartTs) { // Evaluate conditional branch
    // Reuses the decalage_sec field — repurposed server-side as read_duration_sec for WPM throughput scoring
    fd.append('decalage_sec', ((Date.now() - ciReadStartTs) / 1000).toFixed(2)); // Format number to fixed decimal places
  }

  try { // Begin try block
    const r = await fetch('/api/ci/submit-turn', {method:'POST', body:fd}); // Send HTTP request to backend
    const d = await r.json(); // Parse JSON response

    const isLast = ciSegNum >= ciMaxSegs;
    const bz = document.getElementById('ci-between-zone'); // Lookup DOM element 'ci-between-zone'
    bz.style.display = ''; // Show the element (default display)
    document.getElementById('ci-listening-zone').style.display = 'none'; // Hide the element

    document.getElementById('ci-between-msg').textContent = isLast
      ? 'All segments complete!'
      : `Segment ${ciSegNum} submitted`;
    document.getElementById('ci-between-sub').textContent = isLast
      ? `${ciMaxSegs} segments completed — ready for full evaluation.`
      : `${ciMaxSegs - ciSegNum} segment${ciMaxSegs - ciSegNum !== 1 ? 's' : ''} remaining`;

    document.getElementById('ci-next-btn').style.display   = isLast ? 'none' : ''; // Toggle element visibility
    document.getElementById('ci-finish-btn').style.display = isLast ? '' : 'none'; // Toggle element visibility

    ciRenderPips(); // Invoke ciRenderPips()
    ciSetState(isLast ? 'done' : 'between'); // Invoke ciSetState()

  } catch(e) { // Handle exception
    console.error('CI submit failed:', e);
    document.getElementById('ci-render-zone').style.display = ''; // Show the element (default display)
    ciSetState('rendering'); // Invoke ciSetState()
  }
}

// ── Next Segment ─────────────────────────────────────────────────────────────

/**
 * @description Fetches the next segment from the backend and begins playback.
 * @returns {Promise<void>}
 */
async function ciNextSegment() {
  document.getElementById('ci-between-zone').style.display = 'none'; // Hide the element
  ciSetState('loading'); // Invoke ciSetState()

  const fd = new FormData(); // Create FormData for POST request
  fd.append('session_id', ciSid); // Append field to FormData

  try { // Begin try block
    const r = await fetch('/api/ci/get-segment', {method:'POST', body:fd}); // Send HTTP request to backend
    const d = await r.json(); // Parse JSON response
    if (d.done) { ciEndSession(); return; } // Evaluate conditional branch
    if (d.error) { alert('Error: ' + d.error); return; } // Evaluate conditional branch
    ciPlaySegment(d.audio_b64, d.document_text || d.segment_text, d.segment_num); // Invoke ciPlaySegment()
  } catch(e) { // Handle exception
    console.error('CI get-segment failed:', e);
  }
}

// ── Sight Translation mode helpers ────────────────────────────────────────────

/**
 * @description Ends the session, stops all timers and recordings, fetches evaluation, and persists results.
 * @returns {Promise<void>}
 */
async function ciEndSession() {
  ciStopSessionTimer(); // Invoke ciStopSessionTimer()
  if (ciAudioEl) { try { ciAudioEl.pause(); } catch(e){} } // Pause audio playback
  // Clear SI state
  if (ciDecalageTimer) { clearInterval(ciDecalageTimer); ciDecalageTimer = null; } // Stop repeating interval timer
  ciAutoStopRecording(); // Invoke ciAutoStopRecording()
  ciSwitchView('ci-loading-view'); // Invoke ciSwitchView()
  ciSetState('evaluating'); // Invoke ciSetState()

  const evalMsgs = [
    'Evaluating your session...', 'Reviewing completeness and accuracy...',
    'Checking terminology precision...', 'Assessing memory recall...',
    'Putting together your coaching notes...', 'Almost done...'
  ];
  let mi = 0; // Initialize variable 'mi'
  const msgEl = document.getElementById('ci-eval-msg'); // Lookup DOM element 'ci-eval-msg'
  const msgTimer = setInterval(() => { // Start repeating interval timer
    mi = Math.min(mi+1, evalMsgs.length-1); // Get minimum value
    if (msgEl) msgEl.textContent = evalMsgs[mi]; // Set text content
  }, 4000);

  const fd = new FormData(); // Create FormData for POST request
  fd.append('session_id', ciSid); // Append field to FormData

  try { // Begin try block
    const r = await fetch('/api/ci/end-session', {method:'POST', body:fd}); // Send HTTP request to backend
    const d = await r.json(); // Parse JSON response
    clearInterval(msgTimer); // Stop repeating interval timer

    // Persist to localStorage
    try { // Begin try block
      const _cs = JSON.parse(localStorage.getItem('ci-sessions') || '[]'); // Parse JSON string to object
      _cs.unshift({
        isoDate: new Date().toISOString(), // Create new Date instance
        field: ciField, lang: ciLang, difficulty: ciDifficulty,
        segments: ciMaxSegs, grade: d.grade,
        overall_score: d.overall_score,
        accuracy: d.accuracy || 0,
        fusha_compliance: d.fusha_compliance || 0,
        completeness: d.completeness || 0,
        terminology: d.terminology || 0,
        fluency: d.fluency || 0,
        professional_protocol: d.professional_protocol || 0,
        memory_accuracy: d.memory_accuracy || 0,
        segment_handling: d.segment_handling || 0,
        persona: ciPersona.name || '',
      });
      localStorage.setItem('ci-sessions', JSON.stringify(_cs.slice(0, 200))); // Extract substring or subarray
    } catch(_e) { console.warn('CI persist failed:', _e); } // Handle exception

    ciSwitchView('ci-eval-view'); // Invoke ciSwitchView()
    ciRenderEval(d); // Invoke ciRenderEval()
    ciSetState('done'); // Invoke ciSetState()
    try { _handlePlacementOrCalibrationResult(d.mode || 'consecutive', d.overall_score); } catch(_e) {} // Begin try block

  } catch(e) { // Handle exception
    clearInterval(msgTimer); // Stop repeating interval timer
    console.error('CI eval failed:', e);
    ciSwitchView('ci-eval-view'); // Invoke ciSwitchView()
    ciSetState('done'); // Invoke ciSetState()
  }
}

// ── Render Eval Sheet ─────────────────────────────────────────────────────────

/**
 * @description Toggles the session camera through three states: off → live preview → recording.
 * @param {HTMLElement} btn - The camera button element.
 * @returns {Promise<void>}
 */
async function ciToggleCamera(btn) {
  const video   = document.getElementById('ci-camera-video'); // Lookup DOM element 'ci-camera-video'
  const offView = document.getElementById('ci-camera-off'); // Lookup DOM element 'ci-camera-off'

  // State A → B: camera is off, request permission and start preview
  if (!ciCameraStream) { // Evaluate conditional branch
    try { // Begin try block
      ciCameraStream = await navigator.mediaDevices.getUserMedia({video:true, audio:true}); // Request camera/microphone access
      video.srcObject = ciCameraStream; // Attach media stream to video element
      video.style.display   = ''; // Toggle element visibility
      offView.style.display = 'none'; // Hide the element
      btn.textContent = 'Record'; // Set text content
      btn.style.background  = 'rgba(244,63,94,.12)'; // Set background style
      btn.style.borderColor = 'rgba(244,63,94,.35)'; // Set border color
      btn.style.color       = 'var(--red)'; // Set text color
    } catch(e) { // Handle exception
      console.warn('Camera access denied:', e);
    }
    return; // Early return
  }

  // State B → C: camera is live but not recording → start MediaRecorder
  if (!ciMediaRecorder || ciMediaRecorder.state === 'inactive') { // Evaluate conditional branch
    ciRecordChunks = []; // Assign value to 'ciRecordChunks'
    try { // Begin try block
      ciMediaRecorder = new MediaRecorder(ciCameraStream, {mimeType:'video/webm;codecs=vp8,opus'}); // Create media recorder instance
    } catch(e) { // Handle exception
      ciMediaRecorder = new MediaRecorder(ciCameraStream); // Create media recorder instance
    }
    ciMediaRecorder.ondataavailable = e => { if (e.data.size > 0) ciRecordChunks.push(e.data); }; // Bind data available handler
    ciMediaRecorder.onstop = () => { // Bind recording stop handler
      const blob = new Blob(ciRecordChunks, {type:'video/webm'}); // Create binary blob from data
      const url  = URL.createObjectURL(blob); // Generate object URL for blob
      const a    = document.createElement('a'); // Create new DOM element
      a.href     = url;
      a.download = `ci-session-${Date.now()}.webm`; // Get current timestamp
      a.click(); // Programmatically click element
      URL.revokeObjectURL(url); // Revoke object URL to free memory
      ciRecordChunks = []; // Assign value to 'ciRecordChunks'
    };
    ciMediaRecorder.start();
    btn.textContent = 'Stop Recording'; // Set text content
    btn.style.background  = 'rgba(244,63,94,.22)'; // Set background style
    btn.style.borderColor = 'rgba(244,63,94,.6)'; // Set border color
    btn.style.color       = 'var(--red)'; // Set text color
    // Pulsing red dot indicator
    const head = btn.closest('.ci-camera-panel')?.querySelector('.ci-camera-head'); // Find closest ancestor matching selector
    if (head && !head.querySelector('.ci-rec-dot')) { // Evaluate conditional branch
      const dot = document.createElement('span'); // Create new DOM element
      dot.className   = 'ci-rec-dot';
      dot.title       = 'Recording';
      dot.style.cssText = 'display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--red);animation:ciRecPulse 1s ease-in-out infinite;margin-left:4px'; // Apply inline CSS styles
      head.insertBefore(dot, btn); // Insert element before reference
    }
    return; // Early return
  }

  // State C → off: stop recording, stop camera
  if (ciMediaRecorder && ciMediaRecorder.state !== 'inactive') { // Evaluate conditional branch
    ciMediaRecorder.stop(); // Stop media track
  }
  ciCameraStream.getTracks().forEach(t => t.stop()); // Iterate over each element
  ciCameraStream  = null; // Assign value to 'ciCameraStream'
  ciMediaRecorder = null; // Assign value to 'ciMediaRecorder'
  video.srcObject = null; // Attach media stream to video element
  video.style.display   = 'none'; // Toggle element visibility
  offView.style.display = ''; // Show the element (default display)
  btn.textContent = 'Enable'; // Set text content
  btn.style.background  = ''; // Set background style
  btn.style.borderColor = ''; // Set border color
  btn.style.color       = ''; // Set text color
  // Remove recording dot
  const dot = document.querySelector('.ci-rec-dot'); // Query DOM for '.ci-rec-dot'
  if (dot) dot.remove(); // Remove element from DOM
}

// ── Prep-room camera (shared stream with session camera) ─────────────────────

/**
 * @description Toggles the preparation room camera through three states: off → live → recording.
 * @param {HTMLElement} btn - The camera button element.
 * @returns {Promise<void>}
 */
async function ciPrepToggleCamera(btn) {
  const video   = document.getElementById('ci-prep-camera-video'); // Lookup DOM element 'ci-prep-camera-video'
  const offView = document.getElementById('ci-prep-camera-off'); // Lookup DOM element 'ci-prep-camera-off'

  // Off → Live
  if (!ciCameraStream) { // Evaluate conditional branch
    try { // Begin try block
      ciCameraStream = await navigator.mediaDevices.getUserMedia({video:true, audio:true}); // Request camera/microphone access
      video.srcObject = ciCameraStream; // Attach media stream to video element
      video.style.display   = ''; // Toggle element visibility
      offView.style.display = 'none'; // Hide the element
      btn.textContent = 'Record'; // Set text content
      btn.style.background  = 'rgba(244,63,94,.12)'; // Set background style
      btn.style.borderColor = 'rgba(244,63,94,.35)'; // Set border color
      btn.style.color       = 'var(--red)'; // Set text color
      ciPrepCameraReady = false; // Assign value to 'ciPrepCameraReady'
      ciUpdateBeginBtn(); // Invoke ciUpdateBeginBtn()
    } catch(e) { // Handle exception
      console.warn('Camera access denied:', e);
    }
    return; // Early return
  }

  // Live → Recording
  if (!ciMediaRecorder || ciMediaRecorder.state === 'inactive') { // Evaluate conditional branch
    ciRecordChunks = []; // Assign value to 'ciRecordChunks'
    try { // Begin try block
      ciMediaRecorder = new MediaRecorder(ciCameraStream, {mimeType:'video/webm;codecs=vp8,opus'}); // Create media recorder instance
    } catch(e) { // Handle exception
      ciMediaRecorder = new MediaRecorder(ciCameraStream); // Create media recorder instance
    }
    ciMediaRecorder.ondataavailable = e => { if (e.data.size > 0) ciRecordChunks.push(e.data); }; // Bind data available handler
    ciMediaRecorder.onstop = () => { // Bind recording stop handler
      const blob = new Blob(ciRecordChunks, {type:'video/webm'}); // Create binary blob from data
      const url  = URL.createObjectURL(blob); // Generate object URL for blob
      const a    = document.createElement('a'); a.href = url; // Create new DOM element
      a.download = `ci-session-${Date.now()}.webm`; a.click(); // Get current timestamp
      URL.revokeObjectURL(url); ciRecordChunks = []; // Revoke object URL to free memory
    };
    ciMediaRecorder.start();
    btn.textContent = 'Recording — Ready'; // Set text content
    btn.style.background  = 'rgba(244,63,94,.22)'; // Set background style
    btn.style.borderColor = 'rgba(244,63,94,.6)'; // Set border color
    btn.style.color       = 'var(--red)'; // Set text color
    // Pulsing dot
    const head = btn.closest('.ci-camera-panel')?.querySelector('.ci-camera-head'); // Find closest ancestor matching selector
    if (head && !head.querySelector('.ci-rec-dot')) { // Evaluate conditional branch
      const dot = document.createElement('span'); // Create new DOM element
      dot.className = 'ci-rec-dot';
      dot.style.cssText = 'display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--red);animation:ciRecPulse 1s ease-in-out infinite;margin-left:4px'; // Apply inline CSS styles
      head.insertBefore(dot, btn); // Insert element before reference
    }
    ciPrepCameraReady = true; // Assign value to 'ciPrepCameraReady'
    ciUpdateBeginBtn(); // Invoke ciUpdateBeginBtn()
    return; // Early return
  }

  // Recording → off (if they want to disable before starting)
  if (ciMediaRecorder && ciMediaRecorder.state !== 'inactive') ciMediaRecorder.stop(); // Stop media track
  ciCameraStream.getTracks().forEach(t => t.stop()); // Iterate over each element
  ciCameraStream = null; ciMediaRecorder = null; // Assign value to 'ciCameraStream'
  video.srcObject = null; // Attach media stream to video element
  video.style.display   = 'none'; // Toggle element visibility
  offView.style.display = ''; // Show the element (default display)
  btn.textContent = 'Enable'; btn.style.background = ''; btn.style.borderColor = ''; btn.style.color = ''; // Set text color
  document.querySelector('.ci-rec-dot')?.remove(); // Remove element from DOM if present
  ciPrepCameraReady = false; // Assign value to 'ciPrepCameraReady'
  ciUpdateBeginBtn(); // Invoke ciUpdateBeginBtn()
}

// ── Canvas Room View — Option B (Interpreter POV, Professional) ───────────────
