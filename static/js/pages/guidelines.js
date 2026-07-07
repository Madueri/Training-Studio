/**
 * @module pages/guidelines.js
 * @description Platform Guidelines — accordion reference for interpreting protocols
 *
 * InterpLing — Interpretation Practice Platform
 * © 2025 InterpLing. All rights reserved.
 */

// ═══════════════════════════════════════════════════════════════════════════════
//  GUIDELINES DATA
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @constant {Array<Object>} GUIDELINES
 * @description Structured platform guidelines covering mode selection, technique,
 *              ethics, and professional protocols. Each entry defines a category,
 *              accent color, title, and rich HTML content.
 */
const GUIDELINES = [
  // ── Mode Selection ──
  {
    category: 'Modes',
    color: 'var(--blue)',
    title: 'How to Choose the Right Mode',
    content: `<p>Every interpreting assignment has an ideal mode. Choosing the wrong one degrades accuracy, exhausts the interpreter, and frustrates participants.</p>
    <ul><li><strong>Simultaneous (SI):</strong> Conferences, large meetings, live broadcasts — when real-time flow is critical and equipment is available.</li><li><strong>Consecutive (CI):</strong> Legal depositions, medical consultations, diplomatic dinners — when precision matters more than speed.</li><li><strong>Whispered (Chuchotage):</strong> One or two listeners in a small group without booth infrastructure.</li><li><strong>Sight Translation:</strong> Written documents presented orally — contracts, consent forms, briefing papers.</li><li><strong>OPI / VRI:</strong> Remote medical, legal, or community calls — choose VRI when visual cues matter; OPI when bandwidth is limited.</li><li><strong>Escort / Liaison:</strong> Site visits, trade missions, informal dialogue — bidirectional, high cultural mediation load.</li></ul>`
  },
  // ── Translation Philosophy ──
  {
    category: 'Philosophy',
    color: 'var(--purple)',
    title: 'Verbatim vs Sense-for-Sense',
    content: `<p>These are not opposing camps — they are tools for different contexts. Knowing when to apply each is a mark of seniority.</p>
    <ul><li><strong>Verbatim (word-for-word):</strong> Required in legal settings — oaths, affidavits, court transcripts. Every word carries legal weight. Deviations can void a proceeding.</li><li><strong>Sense-for-sense (equivalent effect):</strong> Standard in conference and media interpreting. The goal is the same cognitive and emotional impact on the listener, not identical wording.</li><li><strong>The shift test:</strong> Ask "If I shift this structure, does the legal meaning change?" If yes, stay verbatim. If no, optimize for naturalness.</li><li><strong>Hybrid zones:</strong> Medical interpreting often requires verbatim for dosing and diagnosis, then sense-for-sense for rapport and explanation.</li></ul>`
  },
  // ── Booth Workflow ──
  {
    category: 'Booth',
    color: 'var(--gold)',
    title: 'Team Rotation Simulation',
    content: `<p>AIIC standards define sustainable booth work as 20–30 minute rotations. Solo interpreting beyond 45 minutes degrades quality measurably.</p>
    <ul><li><strong>Rotation cadence:</strong> Switch every 20–30 minutes. Some teams alternate every 15 minutes during high-density content.</li><li><strong>Handover cues:</strong> The outgoing interpreter finishes a complete idea, then taps the console or says "Ready" softly. The incoming interpreter picks up within 1–2 seconds.</li><li><strong>Relay protocol:</strong> When working through a pivot language, monitor the relay channel, not the original floor, to avoid double-lag. Pivot interpreters speak clearly and steadily.</li><li><strong>Booth buddy system:</strong> The inactive interpreter writes numbers, names, and terminology for the active partner. Never disconnect mentally when not speaking.</li><li><strong>Emergency takeover:</strong> If the active interpreter falters, the booth partner assumes the microphone immediately without discussion.</li></ul>`
  },
  // ── Cognitive Tools ──
  {
    category: 'Cognitive',
    color: 'var(--green)',
    title: 'Note-Taking Best Practices',
    content: `<p>Notes are not a transcript — they are a structured memory trigger. The Rozan method (1956) remains the gold standard for consecutive interpreting.</p>
    <ul><li><strong>Verticality:</strong> Write ideas diagonally downward. Each new idea starts below and to the right of the previous one. This encodes logical relationships spatially.</li><li><strong>Symbol consistency:</strong> Build a personal symbol set and stick to it. Common examples: ↑ = increase/growth, ↓ = decrease, ✓ = agreement, ⚠ = caution/problem, ○ = point/idea.</li><li><strong>Language-neutrality:</strong> Use symbols and abbreviations that work in both directions of your pair. Avoid writing full words in either language.</li><li><strong>Separation of ideas:</strong> Use horizontal lines or white space to mark where one speaker's argument ends and another begins.</li><li><strong>Temporal order:</strong> Time markers (now, then, before, after) should be visually prominent — they are the backbone of narrative coherence.</li><li><strong>Practice drill:</strong> Listen to a 90-second speech, take notes, then interpret 2 minutes later without re-listening. Compare your rendition to the source.</li></ul>`
  },
  // ── Remote Interpreting ──
  {
    category: 'Remote',
    color: 'var(--teal)',
    title: 'VRI Visual Cue Checklist',
    content: `<p>Video Remote Interpreting introduces a unique set of technical and environmental constraints. Visual communication is part of the message — do not lose it.</p>
    <ul><li><strong>Camera framing:</strong> Your face and upper torso should be visible, centered, with minimal headroom (rule of thirds).</li><li><strong>Lighting:</strong> Face the primary light source. Avoid backlighting (window behind you) which silhouettes your face.</li><li><strong>Eye contact illusion:</strong> Look at the camera lens, not the screen, when speaking. This creates perceived eye contact for the remote participant.</li><li><strong>Background:</strong> Plain, neutral wall. No distracting visuals or confidential materials visible.</li><li><strong>Audio isolation:</strong> Use headphones. Echo and feedback destroy comprehension. Test microphone levels before the session.</li><li><strong>Positioning:</strong> Sit upright, slightly forward — slouching reduces vocal projection and signals disengagement.</li><li><strong>Pre-session test:</strong> Join 5 minutes early. Test audio, video, and internet stability. Have a phone backup ready.</li></ul>`
  },
  // ── Cultural Mediation ──
  {
    category: 'Cultural',
    color: 'var(--amber)',
    title: 'Escort Cultural Mediation',
    content: `<p>Escort interpreting is not "light" interpreting — it is the most cognitively demanding form because it is bidirectional, unscripted, and culturally loaded.</p>
    <ul><li><strong>Beyond translation:</strong> You are a cultural bridge. Explain why something was said, not just what was said. Flag when a gesture, silence, or formality carries meaning.</li><li><strong>Register shifts:</strong> You may hear informal Arabic dialect and need to render it as formal English — or vice versa. Maintain the social relationship, not the vocabulary.</li><li><strong>Spatial awareness:</strong> Walk slightly behind and to the side. Do not insert yourself visually into the interaction. Speak softly and briefly.</li><li><strong>Protocol navigation:</strong> Know greeting hierarchies, gift-giving customs, prayer times, and dining etiquette for both cultures. Pre-brief your principal if needed.</li><li><strong>Confidentiality in open spaces:</strong> Escort environments are leaky. Assume everything is overheard. Do not discuss the assignment in elevators, taxis, or restaurants.</li></ul>`
  },
  // ── Sight Translation ──
  {
    category: 'Sight',
    color: 'var(--red)',
    title: 'Sight Translation Read-Ahead Technique',
    content: `<p>Sight translation is simultaneous interpreting from a written source. The core skill is reading ahead while rendering behind — like a teleprompter you control.</p>
    <ul><li><strong>The 2–3 line buffer:</strong> Your eyes should always be 2–3 lines ahead of your voice. This gives you time to resolve syntax differences (e.g., English SVO → Arabic VSO).</li><li><strong>Chunking:</strong> Group text into idea units, not sentence units. A long English sentence may become two Arabic sentences. Pre-scan for conjunctions and relative clauses.</li><li><strong>Number and date protocol:</strong> Numbers are high-risk. Pause slightly before rendering a number to confirm you have the digits correct. Write them down if the text is dense.</li><li><strong>Proper nouns:</strong> Pre-scan for names, organizations, and titles. If pronunciation is uncertain, render it slowly and clearly rather than guessing.</li><li><strong>Pacing control:</strong> Unlike SI, you control the source speed. Slow down on dense passages. Mark up the text before starting — underline key terms, circle numbers.</li></ul>`
  },
  // ── Training Drill ──
  {
    category: 'Training',
    color: 'var(--blue2)',
    title: 'Shadowing — Arguelles Method',
    content: `<p>Alexander Arguelles formalized shadowing as a language-acquisition and interpreting-training tool. It builds divided attention, phonemic decoding speed, and vocal endurance.</p>
    <ul><li><strong>Full shadowing:</strong> Repeat every word in the same language immediately after hearing it. Start at 70% of normal speed. Maintain exact prosody and intonation.</li><li><strong>Partial shadowing:</strong> Shadow only content words (nouns, verbs, adjectives). This trains selective attention and prepares you for SI chunking.</li><li><strong>Dual-task shadowing:</strong> Shadow audio while writing a separate sequence of numbers or walking a pattern. This mimics the cognitive load of SI.</li><li><strong>Daily protocol:</strong> 10–15 minutes at the start of every training day. Use news broadcasts (BBC, Al Jazeera) for consistent speech rate and register.</li><li><strong>Progression:</strong> Week 1–2: monolingual shadowing. Week 3–4: shadow in L2 while hearing L1 (phonemic shadow). Week 5+: interpret while shadowing.</li></ul>`
  },
  // ── Ethics ──
  {
    category: 'Ethics',
    color: 'var(--green)',
    title: 'Professional Ethics',
    content: `<p>Ethical conduct is not abstract philosophy — it is the foundation of trust that makes interpreting possible. Clients must believe the interpreter is invisible, accurate, and neutral.</p>
    <ul><li><strong>Impartiality:</strong> Do not advocate for either party. Do not edit content to make a speaker sound better or worse. Your loyalty is to the message, not the messenger.</li><li><strong>Confidentiality:</strong> Everything heard in the booth, the courtroom, or the clinic stays there. No exceptions. Discuss cases only in anonymized, abstract training contexts.</li><li><strong>Accuracy:</strong> Render everything — including profanity, errors, and politically uncomfortable statements. Do not sanitize. Do not embellish.</li><li><strong>Competence boundaries:</strong> Decline assignments beyond your training (e.g., simultaneous conference if you are OPI-certified). Refer to a colleague.</li><li><strong>Conflict of interest:</strong> Disclose personal relationships with parties, prior involvement in a case, or financial stakes. Withdraw if neutrality is compromised.</li><li><strong>Professional solidarity:</strong> Do not undercut colleagues on price. Do not accept working conditions that endanger quality (solo SI for 3 hours, no booth kit, etc.).</li></ul>`
  }
];

// ═══════════════════════════════════════════════════════════════════════════════
//  RENDER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @function loadGuidelinesPage
 * @description Renders the guidelines accordion list into the DOM.
 *              Called automatically when the Guidelines page is visited.
 * @returns {void}
 */
function loadGuidelinesPage() {
  const container = document.getElementById('guidelines-list');
  if (!container) return;

  // Build HTML once if empty; subsequent visits use existing DOM.
  if (container.children.length === 0) {
    container.innerHTML = GUIDELINES.map((g, i) => `
      <div class="lesson" style="border-left:3px solid ${g.color}">
        <div class="lesson-header" onclick="toggleGuideline(${i})">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:${g.color}">${g.category}</span>
            <span style="font-size:14px;color:var(--text)">${g.title}</span>
          </div>
          <svg id="gl-chev-${i}" viewBox="0 0 24 24" style="width:14px;height:14px;stroke:var(--dim);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:transform .2s;flex-shrink:0">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
        <div class="lesson-body" id="gl-body-${i}">${g.content}</div>
      </div>
    `).join('');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ACCORDION TOGGLE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @function toggleGuideline
 * @description Toggles the open/closed state of a guideline accordion item
 *              and rotates the chevron indicator.
 * @param {number} n - The 0-based index of the guideline to toggle.
 * @returns {void}
 */
function toggleGuideline(n) {
  const body = document.getElementById('gl-body-' + n);
  const chev = document.getElementById('gl-chev-' + n);
  if (!body) return;
  const isOpen = body.classList.toggle('open');
  if (chev) chev.style.transform = isOpen ? 'rotate(180deg)' : '';
}
