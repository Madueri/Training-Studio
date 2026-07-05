/**
 * @module api/interpretation.js
 * @description Interpretation analysis API — Claude scoring, key terms, glossary, notes
 *
 * MAD Training Studio — Interpretation Practice Platform
 * © 2025 InterpretLab. All rights reserved.
 */

/**
 * Loads and displays key terminology terms for a given video.
 * Supports two modes: streaming real-time analysis from video content,
 * or fallback topic-based generation when no video ID is available.
 *
 * @param {Object} v - The video object containing metadata (title, difficulty, known_id, etc.)
 * @param {Object} [params={}] - Optional parameters for customization
 * @param {string} [params.field='general'] - The professional field/domain for terminology
 * @param {string} [params.lang] - Language pair string; falls back to getLangPair()
 * @param {string} [params.topic] - Topic override for fallback generation
 * @returns {Promise<void>} - Resolves when terms are loaded and displayed
 */
async function loadKeyTerms(v, params) {
  // Extract the professional field from params, defaulting to 'general' if not provided
  const field = (params && params.field) ? params.field : 'general';
  // Extract the language pair from params, falling back to the global getLangPair() function
  const lang = (params && params.lang) ? params.lang : getLangPair();
  // Normalize the difficulty level to lowercase, defaulting to 'moderate'
  const diff = (v.difficulty || 'moderate').toLowerCase();
  // Resolve the video ID, treating 'null' string as invalid
  const videoId = v.known_id && v.known_id !== 'null' ? v.known_id : null;

  // Cache DOM references for the key terms panel UI elements
  const loadingEl = document.getElementById('key-terms-loading');
  const scrollEl = document.getElementById('key-terms-scroll');
  const bodyEl = document.getElementById('key-terms-body');
  const countEl = document.getElementById('key-terms-count');

  // Reset panel state: clear previous terms, hide scroll container, show loading indicator
  bodyEl.innerHTML = '';
  countEl.textContent = '';
  scrollEl.style.display = 'none';
  loadingEl.style.display = 'block';
  loadingEl.innerHTML = '<div style="font-size:20px;margin-bottom:6px"></div><div style="color:var(--gold);font-weight:600;margin-bottom:4px">Analyzing video…</div><div style="font-size:11px;color:var(--dim)">Extracting key terms from actual content</div>';

  // If no video ID is available, use the fallback topic-based generation path
  if (!videoId) {
    // Update loading message for fallback generation mode
    loadingEl.innerHTML = '<div style="font-size:20px;margin-bottom:6px"></div>Generating terminology…';
    // Determine the topic string: prefer params.topic, then video title, then 'general'
    const topic = (params && params.topic) ? params.topic : (v.title || 'general');
    // Build FormData payload for the fallback term generation API
    const fd = new FormData();
    fd.append('topic', topic); fd.append('field', field);
    fd.append('language', lang); fd.append('difficulty', diff); fd.append('count', 15);
    try {
      // Send POST request to generate terms based on topic without video analysis
      const r = await fetch('/api/get-key-terms', { method: 'POST', body: fd });
      // Parse the JSON response containing the generated terms array
      const terms = await r.json();
      // Check if the response contains a valid non-empty terms array
      if (Array.isArray(terms) && terms.length) {
        // Display the term count in the count label
        countEl.textContent = terms.length + ' terms';
        // Render each term as a table row with source, target (Arabic), and optional note
        bodyEl.innerHTML = terms.map(t =>
          `<tr><td>${t.source||''}</td><td class="arabic">${t.target||''}</td><td>${t.note||''}</td></tr>`
        ).join('');
        // Hide loading state and reveal the scrollable terms table
        loadingEl.style.display = 'none';
        scrollEl.style.display = 'block';
        // Store the current terms globally for later use (e.g., saving glossary)
        window._currentTerms = terms;
        // Show the save-glossary button if it exists in the DOM
        const sgb = document.getElementById('save-glossary-btn'); if(sgb) sgb.style.display = 'block';
      } else {
        // No terms were generated — show a fallback message
        loadingEl.innerHTML = 'No terms generated.';
      }
    } catch(e) { loadingEl.innerHTML = 'Could not load terms.'; }
    // Exit early since fallback path is complete
    return;
  }

  // ── Streaming: real-time analysis from video content ──────────
  // Show table immediately so terms appear as they stream
  loadingEl.style.display = 'none';
  scrollEl.style.display = 'block';

  // Build FormData payload for the streaming video term analysis API
  const fd = new FormData();
  fd.append('video_id', videoId);
  fd.append('title', v.title || '');
  fd.append('field', field);
  fd.append('language', lang);
  fd.append('difficulty', diff);

  // Initialize term counter and global terms array for streaming accumulation
  let termCount = 0;
  window._currentTerms = [];
  try {
    // Initiate the streaming POST request for real-time video term analysis
    const resp = await fetch('/api/analyze-video-terms', { method: 'POST', body: fd });
    // Obtain a ReadableStream reader from the response body for SSE-style streaming
    const reader = resp.body.getReader();
    // Create a text decoder to convert streamed Uint8Array chunks into strings
    const decoder = new TextDecoder();
    // Buffer to hold incomplete lines across chunk boundaries
    let buf = '';

    // Display an "Analyzing…" status message in the count label
    countEl.innerHTML = '<span style="color:var(--dim);font-size:11px">Analyzing…</span>';

    // Infinite loop to read the stream chunk by chunk until done
    while (true) {
      // Read the next chunk from the stream (done flag + value chunk)
      const { done, value } = await reader.read();
      // Break out of the loop when the stream signals completion
      if (done) break;
      // Decode the current chunk and append to the buffer, enabling streaming mode
      buf += decoder.decode(value, { stream: true });
      // Split the buffer on newlines to process complete lines
      const lines = buf.split('\n');
      // Save the last (potentially incomplete) line back into the buffer
      buf = lines.pop();
      // Iterate over each complete line received from the stream
      for (const line of lines) {
        // Skip lines that don't start with the SSE "data: " prefix
        if (!line.startsWith('data: ')) continue;
        // Extract the JSON payload after the "data: " prefix and trim whitespace
        const data = line.slice(6).trim();
        // Handle the server-sent terminator signal indicating stream completion
        if (data === '__done__') { countEl.textContent = termCount + ' terms'; const sgb=document.getElementById('save-glossary-btn');if(sgb)sgb.style.display='block'; break; }
        try {
          // Attempt to parse the JSON payload into a term object
          const term = JSON.parse(data);
          // Log and skip any term objects containing an error field
          if (term.error) { console.warn('Term error:', term.error); continue; }
          // Skip entries that don't have a source property (invalid term data)
          if (!term.source) continue;
          // Increment the running term count for display
          termCount++;
          // Append the valid term to the global terms array
          window._currentTerms.push(term);
          // Create a new table row element for the incoming term
          const row = document.createElement('tr');
          // Start the row invisible for a fade-in animation
          row.style.opacity = '0';
          // Set up a CSS transition for smooth opacity fade-in
          row.style.transition = 'opacity 0.4s';
          // Populate the row cells with source text, Arabic target, and optional note
          row.innerHTML = `<td>${term.source}</td><td class="arabic">${term.target||''}</td><td>${term.note||''}</td>`;
          // Append the new row to the table body
          bodyEl.appendChild(row);
          // Use requestAnimationFrame to trigger the CSS opacity transition on the next frame
          requestAnimationFrame(() => row.style.opacity = '1');
          // Update the count label to reflect the current number of terms
          countEl.textContent = termCount + ' terms';
          // Auto-scroll to latest term
          scrollEl.scrollTop = scrollEl.scrollHeight;
        } catch(e) {}
      }
    }
    // After stream ends, if no terms were received, show a "No terms" message
    if (termCount === 0) {
      loadingEl.style.display = 'block';
      loadingEl.innerHTML = 'No terms extracted.';
      scrollEl.style.display = 'none';
    }
  } catch(e) {
    // Handle network or server errors by reverting to the loading state with an error message
    loadingEl.style.display = 'block';
    loadingEl.innerHTML = 'Analysis failed — check server.';
    scrollEl.style.display = 'none';
  }
}


/**
 * Saves the currently loaded key terms as a glossary entry in the user's vault.
 * Collects metadata (topic, field, language) and sends the terms array to the server.
 * Provides visual feedback on the save button during the operation.
 *
 * @returns {Promise<void>} - Resolves when the save operation completes or fails
 */
async function saveGlossary() {
  // Retrieve the globally stored terms array from the window object
  const terms = window._currentTerms || [];
  // Guard clause: abort if there are no terms to save
  if (!terms.length) { alert('No terms to save.'); return; }
  // Cache reference to the save button DOM element
  const btn = document.getElementById('save-glossary-btn');
  // Store the original button text so it can be restored later
  const orig = btn.textContent;
  // Update button to a loading state and disable it to prevent duplicate submissions
  btn.textContent = '⏳ Saving…'; btn.disabled = true;

  // Gather context metadata for the glossary entry: prefer video title, then input field, then fallback
  const topic = currentSessionVideo?.title || document.getElementById('interp-topic')?.value || 'session';
  // Get the selected professional field from the specialization dropdown
  const field = document.getElementById('interp-spec')?.value || 'general';
  // Get the current language pair from the global helper
  const lang = getLangPair();

  // Build FormData payload containing the serialized terms and metadata
  const fd = new FormData();
  fd.append('terms', JSON.stringify(terms));
  fd.append('topic', topic);
  fd.append('field', field);
  fd.append('language', lang);

  try {
    // Send the glossary save request to the server
    const r = await fetch('/api/save-glossary', { method: 'POST', body: fd });
    // Parse the JSON response to check success status
    const d = await r.json();
    if (d.ok) {
      // On success, update button text and color to indicate completion
      btn.textContent = ' Saved!';
      btn.style.color = 'var(--green)';
      // After a delay, restore the original button state and re-enable it
      setTimeout(() => { btn.textContent = orig; btn.style.color = 'var(--gold)'; btn.disabled = false; }, 2500);
    } else {
      // On server-reported failure, show an error state on the button
      btn.textContent = ' Error'; btn.disabled = false;
    }
  } catch(e) {
    // On network or unexpected error, show a failure state on the button
    btn.textContent = ' Failed'; btn.disabled = false;
  }
}

// ── Voice Style ─────────────────────────────────────────────────

/**
 * Predefined voice style profiles for interpretation practice scoring and feedback.
 * Each style defines vocal characteristic bar charts and a descriptive coaching paragraph.
 * Used by the scoring UI to compare the user's performance against ideal style benchmarks.
 *
 * @constant {Object.<string, Object>}
 * @property {string} name - Display name of the voice style
 * @property {Array<Object>} bars - Array of vocal trait objects: label, val (0-100), color
 * @property {string} desc - Coaching description paragraph for this voice style
 */
const VOICE_STYLES = {
  // Commercial voice style: high warmth and energy for persuasive, emotional delivery
  commercial: { name:'Commercial', bars:[{label:'Warmth',val:85,color:'#f59e0b'},{label:'Energy',val:90,color:'#f43f5e'},{label:'Brightness',val:75,color:'#e8971e'},{label:'Breathiness',val:30,color:'#a78bfa'},{label:'Resonance',val:60,color:'#4878f0'}], desc:'High warmth and energy create an emotional connection. Forward placement for clarity. Avoid breathiness — it weakens conviction. The key question: who is the one person you are talking to?' },
  // Documentary voice style: deep resonance, deliberate pacing, low energy but high gravitas
  documentary: { name:'Documentary', bars:[{label:'Warmth',val:65,color:'#f59e0b'},{label:'Energy',val:50,color:'#f43f5e'},{label:'Brightness',val:55,color:'#e8971e'},{label:'Breathiness',val:20,color:'#a78bfa'},{label:'Resonance',val:90,color:'#4878f0'}], desc:'Deep chest resonance carries the weight of the story. Slow, deliberate pacing. Low energy but high gravitas. Pauses are your punctuation. Think David Attenborough — measure every word.' },
  // News broadcast voice style: maximum clarity, zero breathiness, authoritative neutral tone
  news: { name:'News Broadcast', bars:[{label:'Warmth',val:40,color:'#f59e0b'},{label:'Energy',val:70,color:'#f43f5e'},{label:'Brightness',val:90,color:'#e8971e'},{label:'Breathiness',val:10,color:'#a78bfa'},{label:'Resonance',val:70,color:'#4878f0'}], desc:'Maximum clarity and brightness. Zero breathiness — authority demands a clean, supported tone. Neutral affect: not cold, but not warm. Plosive precision. Falling intonation on statements.' },
  // Corporate / E-Learning voice style: approachable professional, moderate warmth for long-form content
  corporate: { name:'Corporate / E-Learning', bars:[{label:'Warmth',val:70,color:'#f59e0b'},{label:'Energy',val:60,color:'#f43f5e'},{label:'Brightness',val:65,color:'#e8971e'},{label:'Breathiness',val:25,color:'#a78bfa'},{label:'Resonance',val:65,color:'#4878f0'}], desc:'The trusted colleague register. Approachable but professional. Moderate warmth keeps engagement up during long e-learning modules. Avoid monotony with intentional stress variation.' },
  // Arabic Broadcast (فصحى) voice style: maximum resonance, Makhraj precision, authoritative calm delivery
  arabic: { name:'Arabic Broadcast فصحى', bars:[{label:'Warmth',val:50,color:'#f59e0b'},{label:'Energy',val:65,color:'#f43f5e'},{label:'Brightness',val:60,color:'#e8971e'},{label:'Breathiness',val:10,color:'#a78bfa'},{label:'Resonance',val:95,color:'#4878f0'}], desc:'Maximum resonance and depth. Makhraj (مخارج الحروف) precision is non-negotiable — emphatic letters ص ض ط ظ must be clearly distinguished. Authoritative, calm delivery. Guttural letters ع غ ح خ require open throat placement.' },
  // Character / Animation voice style: widest dynamic range, pitch shifts, distinct character home base
  character: { name:'Character / Animation', bars:[{label:'Warmth',val:75,color:'#f59e0b'},{label:'Energy',val:95,color:'#f43f5e'},{label:'Brightness',val:80,color:'#e8971e'},{label:'Breathiness',val:50,color:'#a78bfa'},{label:'Resonance',val:55,color:'#4878f0'}], desc:'Full dynamic range — the widest of all VO styles. Pitch shifts, rhythm changes, and physical voice placement all serve character. Each character needs a distinct "home base" you can reliably reproduce take after take.' }
};

/** @type {string} The currently selected voice style key, defaulting to 'commercial'. Used by scoring UI. */
let currentVoiceStyle = 'commercial';


/**
 * Saves the user's interpretation notes to the vault.
 * Currently displays a mock alert; in production this would call the Jarvis vault write API.
 *
 * @returns {void}
 */
async function saveNote() {
  // Get the raw text value from the interpretation notes textarea
  const note = document.getElementById('interp-notes').value;
  // Guard clause: abort if the note is empty or contains only whitespace
  if (!note.trim()) return;
  // Would call Jarvis vault write API in production
  alert('Note saved to vault: Inbox/Interpretation-Notes.md');
}

// ── Error display ──────────────────────────────────────────────
