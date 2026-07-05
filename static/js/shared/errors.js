/**
 * @module shared/errors.js
 * @description Error handling utilities
 *
 * MAD Training Studio — Interpretation Practice Platform
 * © 2025 InterpretLab. All rights reserved.
 */

/**
 * @function showError
 * @description Displays an error message in the DOM element associated with the given field ID,
 *              or falls back to console.error if the element is not found.
 * @param {string} id - The base identifier of the form field; the error element is expected
 *                      to have an ID of `${id}-error`.
 * @param {string} msg - The human-readable error message to display.
 * @returns {void}
 */
function showError(id, msg) {
  // Attempt to locate the error display element using the field ID suffix convention.
  const el = document.getElementById(id + '-error');

  // Check whether the error element exists in the DOM.
  if (el) {
    // Inject the warning prefix into the element's text content.
    el.textContent = 'Warning: ' + msg;
    // Make the error element visible on the page.
    el.style.display = 'block';
  } else {
    // Fallback: log the error to the browser console when no DOM element is available.
    console.error(msg);
  }
}

// ── Coaching Curriculum ────────────────────────────────────────

/**
 * @constant {Array<Object>} LESSONS
 * @description Structured coaching curriculum data for the MAD Training Studio.
 *              Each entry defines a lesson tier (Foundation → Professional),
 *              a display color, a human-readable title, and rich HTML content
 *              containing pedagogical guidance.
 */
const LESSONS = [
  // ── Foundation tier ──
  {
    level: 'Foundation',        // Skill tier classification
    color: 'var(--green)',      // CSS custom property for the tier accent color
    title: 'Breath Control & Diaphragmatic Breathing',
    content: `<p>The foundation of all professional voice work. Diaphragmatic breathing engages the dome-shaped muscle at the base of your lungs, creating a steady column of air that supports rich tone and sustained delivery.</p>
    <ul><li>Place hand on stomach — it should push OUT when you inhale</li><li>Inhale through nose (4 counts), hold (2), exhale on "sssss" (8 counts)</li><li>Practice until diaphragm breathing becomes your default</li></ul>`
  },
  {
    level: 'Foundation',
    color: 'var(--green)',
    title: 'Vocal Warm-Up Exercises',
    content: `<p>Never record cold. Professional voice artists spend 5–10 minutes warming up before every session.</p>
    <ul><li>Lip trills (motor-boat sound) up and down your range</li><li>Tongue twisters: "Red lorry, yellow lorry" — 3× faster each time</li><li>Sirens: glide from low to high on "wheee"</li><li>Yawn-sigh to open the throat</li></ul>`
  },
  {
    level: 'Foundation',
    color: 'var(--green)',
    title: 'Microphone Technique',
    content: `<p>How you relate to the mic is as important as how you sound. Distance, angle, and plosive control define your raw signal quality.</p>
    <ul><li>Maintain a fist-distance from the mic — not closer</li><li>Angle mic slightly to the side to avoid plosive Ps and Bs</li><li>Speak across the mic, not directly into it</li><li>Don't touch or move the mic stand during recording</li></ul>`
  },
  // ── Delivery tier ──
  {
    level: 'Delivery',          // Intermediate skill tier
    color: 'var(--blue)',       // Blue accent for the Delivery tier
    icon: '',                   // Reserved for future iconography
    title: 'Script Analysis & Marking',
    content: `<p>Before you read a word, analyze the script. Mark up your copy like a broadcast professional.</p>
    <ul><li>Underline key words to emphasize</li><li>Mark pauses with // (short) or /// (long)</li><li>Circle technical terms — research pronunciation first</li><li>Note tone shifts: serious / warm / urgent / conversational</li><li>Find the "read" — what is this really saying?</li></ul>`
  },
  {
    level: 'Delivery',
    color: 'var(--blue)',
    icon: '',
    title: 'Pacing & Rhythm Control',
    content: `<p>Broadcast standard for English narration is 130–150 words per minute. Arabic broadcast typically runs 120–140 WPM. Pacing carries emotional weight.</p>
    <ul><li>Record yourself, count words in 60 seconds</li><li>Slow down on important information, speed up on lists</li><li>Use silence as punctuation — pauses create impact</li><li>Vary rhythm to prevent monotony</li></ul>`
  },
  {
    level: 'Delivery',
    color: 'var(--blue)',
    icon: '',
    title: 'Intonation & Stress Patterns',
    content: `<p>In English, sentences typically fall at the end of statements and rise at the end of questions. In Arabic broadcast, maintain authoritative falling tones.</p>
    <ul><li>Avoid "upspeak" — rising tone on statements sounds uncertain</li><li>Stress content words (nouns, verbs, adjectives) not function words</li><li>Vary your pitch range — a narrow range sounds robotic</li><li>Record and listen critically to your intonation patterns</li></ul>`
  },
  // ── Broadcast tier ──
  {
    level: 'Broadcast',         // Advanced broadcast-level tier
    color: 'var(--amber)',      // Amber accent for the Broadcast tier
    title: 'Teleprompter Mastery',
    content: `<p>Reading a teleprompter naturally is a learnable skill. The goal is to sound spontaneous while reading every word verbatim.</p>
    <ul><li>Read ahead — your eyes should be 2–3 words ahead of your voice</li><li>Keep eyes at the center of the screen, not tracking left-right</li><li>Blink normally — fight the urge to stare</li><li>Practice with the prompter at 70% of normal speed first</li><li>Mark your script before loading it</li></ul>`
  },
  {
    level: 'Broadcast',
    color: 'var(--amber)',
    title: 'EBU R128 Broadcast Standards',
    content: `<p>SBS Australia and all EBU broadcasters require -23 LUFS integrated loudness. Understanding these standards separates amateur from professional recordings.</p>
    <ul><li>Target: -23 LUFS integrated (broadcast), -16 LUFS (online)</li><li>True peak: never exceed -1 dBTP</li><li>Noise floor: below -60 dB</li><li>Dynamic range: keep loudness range (LRA) under 15 LU for speech</li><li>Use a calibrated monitor or metering plugin to check levels</li></ul>`
  },
  {
    level: 'Broadcast',
    color: 'var(--amber)',
    title: 'Arabic Broadcast Voice',
    content: `<p>Arabic broadcast voice has specific conventions shaped by Fusha (Modern Standard Arabic) and regional standards used by major networks.</p>
    <ul><li>Use Modern Standard Arabic (فصحى) — avoid regional dialect in formal broadcast</li><li>Makhraj precision — articulate emphatic consonants clearly (ص، ض، ط، ظ)</li><li>Maintain authoritative, calm delivery — avoid theatrical emotion</li><li>Vowel length matters in Arabic — geminates and long vowels change meaning</li><li>Listen daily to Al Jazeera, BBC Arabic, Abu Dhabi TV presenters</li></ul>`
  },
  // ── Professional tier ──
  {
    level: 'Professional',      // Expert-level tier for working professionals
    color: 'var(--red)',        // Red accent for the Professional tier
    icon: '',                   // Reserved for future iconography
    title: 'Professional Demo Recording',
    content: `<p>Your demo reel is your business card. It should demonstrate your range in 60–90 seconds.</p>
    <ul><li>Open with your strongest 10 seconds — that's how long you have</li><li>Show 3–5 different styles (news, documentary, commercial, corporate)</li><li>Record in a treated space — no room echo</li><li>Master to -23 LUFS for broadcast, -16 LUFS for online submission</li><li>Update your demo every 12 months</li></ul>`
  }
];
