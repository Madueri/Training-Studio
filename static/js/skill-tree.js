/**
 * MAD Training Studio — Vertical Skill Tree Renderer
 * Renders an interactive skill-progression tree into a container div.
 *
 * Usage:
 *   const tree = new SkillTreeRenderer('#skill-tree', userProgress);
 *   tree.render();
 */

(function (global) {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════
     Tree Data
     ═══════════════════════════════════════════════════════════════ */

  const TREE_NODES = [
    {
      id: 'shadowing',
      name: 'Shadowing',
      mode: 'shadowing',
      level: 'Beginner',
      levelClass: 'badge-beginner',
      description:
        'Repeat the speaker simultaneously in the same language. Builds listening, rhythm, and spoken fluency at broadcast pace.',
      color: 'shadowing',
      row: 0,
      col: 1,
      gridCols: 3,
    },
    {
      id: 'consecutive',
      name: 'Consecutive',
      mode: 'consecutive',
      level: 'Intermediate',
      levelClass: 'badge-intermediate',
      description:
        'Listen to segments, take notes, then deliver your interpretation during the pause. Core conference skill.',
      color: 'consecutive',
      row: 1,
      col: 0,
      gridCols: 3,
    },
    {
      id: 'liaison',
      name: 'Liaison / Escort',
      mode: 'escort',
      level: 'Intermediate',
      levelClass: 'badge-intermediate',
      description:
        'Informal, bidirectional interpreting for business, social, or administrative settings. Emphasizes natural conversation and cultural mediation.',
      color: 'escort',
      row: 1,
      col: 1,
      gridCols: 3,
    },
    {
      id: 'simultaneous',
      name: 'Simultaneous',
      mode: 'simultaneous',
      level: 'Advanced',
      levelClass: 'badge-advanced',
      description:
        'Interpret in real-time while the speaker talks. Maximum cognitive challenge — full conference booth standard.',
      color: 'simultaneous',
      row: 1,
      col: 2,
      gridCols: 3,
    },
    {
      id: 'sight',
      name: 'Sight Translation',
      mode: 'sight',
      level: 'Advanced',
      levelClass: 'badge-advanced',
      description:
        'Written-input, oral-output interpreting. Read a document on screen and deliver an oral rendition at a sustained pace.',
      color: 'sight',
      row: 2,
      col: 0,
      gridCols: 3,
    },
    {
      id: 'chuchotage',
      name: 'Chuchotage',
      mode: 'chuchotage',
      level: 'Advanced',
      levelClass: 'badge-advanced',
      description:
        'Whispered simultaneous, no booth or equipment, delivered at close proximity to 1–2 listeners. Adds volume discipline and noise resilience.',
      color: 'chuchotage',
      row: 2,
      col: 2,
      gridCols: 3,
    },
    {
      id: 'legal',
      name: 'Legal Verbatim',
      mode: 'legal',
      level: 'Advanced+',
      levelClass: 'badge-advanced',
      description:
        'Word-for-word legal interpretation — depositions, court statements, and sworn testimony. Exact reproduction required, no summarization.',
      color: 'legal',
      row: 3,
      col: 0,
      gridCols: 3,
    },
    {
      id: 'future',
      name: 'Coming Soon',
      mode: null,
      level: 'Future',
      levelClass: 'badge-premium',
      description: 'More advanced modes are on the way. Stay tuned!',
      color: 'opi',
      row: 3,
      col: 2,
      gridCols: 3,
    },
    {
      id: 'vri-opi',
      name: 'VRI / OPI',
      mode: 'opi',
      level: 'Expert',
      levelClass: 'badge-premium',
      description:
        'Over-the-Phone & Video Remote Interpreting. Triadic communication between two simulated parties.',
      color: 'opi',
      row: 4,
      col: 1,
      gridCols: 3,
    },
  ];

  const CONNECTIONS = [
    { from: 'shadowing', to: 'consecutive', type: 'branch' },
    { from: 'shadowing', to: 'liaison', type: 'branch' },
    { from: 'shadowing', to: 'simultaneous', type: 'branch' },
    { from: 'consecutive', to: 'sight', type: 'branch' },
    { from: 'simultaneous', to: 'chuchotage', type: 'branch' },
    { from: 'liaison', to: 'consecutive', type: 'bridge' },
    { from: 'liaison', to: 'simultaneous', type: 'bridge' },
    { from: 'sight', to: 'legal', type: 'branch' },
    { from: 'chuchotage', to: 'future', type: 'branch' },
    { from: 'legal', to: 'vri-opi', type: 'branch' },
  ];

  /* Unlock requirement strings shown in tooltips */
  const UNLOCK_REQ_TEXT = {
    shadowing: 'Always available — your starting point.',
    consecutive: 'Complete Shadowing practice or finish Module 5.',
    liaison: 'Complete Consecutive practice or finish Module 11.',
    simultaneous: 'Complete both Shadowing and Consecutive modules.',
    sight: 'Complete Consecutive practice or finish Module 16.',
    chuchotage: 'Complete Simultaneous practice or finish Module 24.',
    legal: 'Complete Sight Translation practice.',
    future: 'Unlocks automatically with future updates.',
    'vri-opi': 'Complete Legal Verbatim or finish the full advanced track.',
  };

  /* ═══════════════════════════════════════════════════════════════
     SVG Icons
     ═══════════════════════════════════════════════════════════════ */

  const ICONS = {
    shadowing:
      '<svg viewBox="0 0 24 24"><path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
    consecutive:
      '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><polyline points="8 9 12 5 16 9"/><line x1="12" y1="5" x2="12" y2="13"/></svg>',
    simultaneous:
      '<svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M2 12h4M18 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>',
    chuchotage:
      '<svg viewBox="0 0 24 24"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>',
    sight:
      '<svg viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
    legal:
      '<svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>',
    escort:
      '<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    opi:
      '<svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
  };

  const LOCK_ICON =
    '<svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

  const CHECK_ICON =
    '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>';

  /* ═══════════════════════════════════════════════════════════════
     SkillTreeRenderer Class
     ═══════════════════════════════════════════════════════════════ */

  class SkillTreeRenderer {
    /**
     * @param {string|HTMLElement} container — selector or element
     * @param {Object} progress — user progress data
     * @param {Object} options — optional config
     */
    constructor(container, progress = {}, options = {}) {
      this.container =
        typeof container === 'string'
          ? document.querySelector(container)
          : container;
      this.progress = progress;
      this.options = Object.assign(
        {
          staggerDelay: 120,
          lineAnimDuration: 800,
          onNodeClick: null, // fn(mode) — if null, falls back to enterPractice(mode)
        },
        options
      );
      this.nodes = new Map(); // id -> DOM element
      this.resizeHandler = null;
    }

    /* ── Public API ─────────────────────────────────────────── */

    render() {
      if (!this.container) {
        console.error('[SkillTree] Container not found');
        return;
      }
      this.container.innerHTML = '';
      this.nodes.clear();

      this._buildDOM();
      this._computeStates();
      this._applyStates();

      // Draw lines after DOM is laid out
      requestAnimationFrame(() => {
        this._drawLines();
        this._animateEntrance();
      });

      // Re-draw lines on resize
      this.resizeHandler = () => this._drawLines();
      window.addEventListener('resize', this.resizeHandler);
    }

    destroy() {
      if (this.resizeHandler) {
        window.removeEventListener('resize', this.resizeHandler);
        this.resizeHandler = null;
      }
      if (this.container) this.container.innerHTML = '';
      this.nodes.clear();
    }

    updateProgress(newProgress) {
      this.progress = newProgress;
      this._computeStates();
      this._applyStates();
      this._drawLines();
    }

    /* ── State Engine ───────────────────────────────────────── */

    _computeStates() {
      const p = this.progress || {};
      const s = {};

      // Helper
      const practiced = (k) => !!(p[k]?.practiced || p[k]?.sessions > 0);
      const completed = (k) => !!(p[k]?.completed || p[k]?.score >= 80);
      const mod = (n) => (p.module >= n || p.currentModule >= n);

      // Shadowing — always unlocked
      s.shadowing = { locked: false, completed: practiced('shadowing') };

      // Consecutive
      s.consecutive = {
        locked: !(practiced('shadowing') || mod(5)),
        completed: completed('consecutive'),
      };

      // Liaison
      s.liaison = {
        locked: !(practiced('consecutive') || mod(11)),
        completed: practiced('escort') || practiced('liaison'),
      };

      // Simultaneous
      s.simultaneous = {
        locked: !(completed('shadowing') && completed('consecutive')),
        completed: completed('simultaneous'),
      };

      // Sight Translation
      s.sight = {
        locked: !(practiced('consecutive') || mod(16)),
        completed: completed('sight'),
      };

      // Chuchotage
      s.chuchotage = {
        locked: !(practiced('simultaneous') || mod(24)),
        completed: completed('chuchotage'),
      };

      // Legal Verbatim
      s.legal = {
        locked: !practiced('sight'),
        completed: completed('legal'),
      };

      // Future placeholder — always locked (decorative)
      s.future = { locked: true, completed: false };

      // VRI / OPI — unlocked via either expert track
      const vriReady = completed('simultaneous') && completed('chuchotage');
      const opiReady = completed('consecutive') && completed('sight');
      s['vri-opi'] = {
        locked: !(vriReady || opiReady),
        completed: completed('opi') || completed('vri'),
      };

      this._computed = s;
      return s;
    }

    _applyStates() {
      const s = this._computed;
      TREE_NODES.forEach((node) => {
        const el = this.nodes.get(node.id);
        if (!el) return;
        const st = s[node.id] || { locked: true, completed: false };

        el.classList.remove('locked', 'unlocked', 'active', 'completed');

        if (st.completed) {
          el.classList.add('completed', 'unlocked');
        } else if (st.locked) {
          el.classList.add('locked');
        } else {
          el.classList.add('unlocked');
          // Mark as "active" if it is the first unlocked-but-not-completed node
          if (this._isCurrentNode(node.id)) {
            el.classList.add('active');
          }
        }
      });
    }

    /**
     * A node is "current/active" if it is unlocked, not completed,
     * and no ancestor that is also unlocked+incomplete comes before it.
     */
    _isCurrentNode(nodeId) {
      const order = [
        'shadowing',
        'consecutive',
        'liaison',
        'simultaneous',
        'sight',
        'chuchotage',
        'legal',
        'future',
        'vri-opi',
      ];
      const idx = order.indexOf(nodeId);
      if (idx === -1) return false;

      const s = this._computed;
      for (let i = 0; i < idx; i++) {
        const id = order[i];
        const st = s[id];
        if (st && !st.locked && !st.completed) return false; // earlier node is active
      }
      const myState = s[nodeId];
      return myState && !myState.locked && !myState.completed;
    }

    /* ── DOM Builder ────────────────────────────────────────── */

    _buildDOM() {
      // SVG layer
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.classList.add('skill-tree-svg');
      svg.setAttribute('aria-hidden', 'true');
      svg.innerHTML = `
        <defs>
          <linearGradient id="skill-tree-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:var(--primary);stop-opacity:1" />
            <stop offset="100%" style="stop-color:var(--accent);stop-opacity:1" />
          </linearGradient>
        </defs>
      `;
      this.svg = svg;
      this.container.appendChild(svg);

      // Rows container
      const rowsWrap = document.createElement('div');
      rowsWrap.className = 'skill-tree-rows';

      // Group nodes by row
      const rowMap = new Map();
      TREE_NODES.forEach((node) => {
        if (!rowMap.has(node.row)) rowMap.set(node.row, []);
        rowMap.get(node.row).push(node);
      });

      // Sort rows
      const sortedRows = Array.from(rowMap.keys()).sort((a, b) => a - b);

      sortedRows.forEach((rowIdx) => {
        const rowNodes = rowMap.get(rowIdx);
        const rowEl = document.createElement('div');
        rowEl.className = 'skill-tree-row';
        rowEl.dataset.row = rowIdx;

        // Sort by col
        rowNodes.sort((a, b) => a.col - b.col);

        // For rows that are sparse, we insert spacers so flex centers items correctly
        const cols = rowNodes[0].gridCols || 3;
        for (let c = 0; c < cols; c++) {
          const node = rowNodes.find((n) => n.col === c);
          if (node) {
            const el = this._buildNode(node);
            this.nodes.set(node.id, el);
            rowEl.appendChild(el);
          } else {
            const spacer = document.createElement('div');
            spacer.style.cssText = 'width:220px;flex-shrink:0;pointer-events:none;';
            spacer.setAttribute('aria-hidden', 'true');
            rowEl.appendChild(spacer);
          }
        }

        rowsWrap.appendChild(rowEl);
      });

      this.container.appendChild(rowsWrap);
    }

    _buildNode(node) {
      const el = document.createElement('div');
      el.className = 'skill-tree-node';
      el.dataset.id = node.id;
      el.dataset.mode = node.mode || '';
      el.dataset.row = node.row;
      el.dataset.col = node.col;

      // Icon
      const iconWrap = document.createElement('div');
      iconWrap.className = 'stn-icon';
      iconWrap.innerHTML = ICONS[node.color] || ICONS.opi;
      el.appendChild(iconWrap);

      // Name
      const name = document.createElement('div');
      name.className = 'stn-name';
      name.textContent = node.name;
      el.appendChild(name);

      // Level badge
      const badge = document.createElement('span');
      badge.className = `stn-level ${node.levelClass}`;
      badge.textContent = node.level;
      el.appendChild(badge);

      // Lock overlay
      const lockOverlay = document.createElement('div');
      lockOverlay.className = 'stn-lock-overlay';
      lockOverlay.innerHTML = LOCK_ICON;
      el.appendChild(lockOverlay);

      // Completed check badge
      const checkBadge = document.createElement('div');
      checkBadge.className = 'stn-check-badge';
      checkBadge.innerHTML = CHECK_ICON;
      el.appendChild(checkBadge);

      // Tooltip
      const tooltip = document.createElement('div');
      tooltip.className = 'skill-tree-tooltip';
      tooltip.innerHTML = `
        <div class="stt-title">${this._escapeHtml(node.name)}</div>
        <div class="stt-desc">${this._escapeHtml(node.description)}</div>
        <div class="stt-req">
          <span class="stt-req-label">Unlock requirement</span>
          ${this._escapeHtml(
            UNLOCK_REQ_TEXT[node.id] || 'Complete previous modes to unlock.'
          )}
        </div>
      `;
      el.appendChild(tooltip);

      // Click handler
      if (node.mode) {
        el.addEventListener('click', () => this._onClick(node));
      }

      return el;
    }

    /* ── SVG Line Drawing ───────────────────────────────────── */

    _drawLines() {
      if (!this.svg) return;
      // Remove old paths (keep defs)
      const oldPaths = this.svg.querySelectorAll('path');
      oldPaths.forEach((p) => p.remove());

      const containerRect = this.container.getBoundingClientRect();
      const isMobile = window.innerWidth < 768;

      CONNECTIONS.forEach((conn) => {
        const fromEl = this.nodes.get(conn.from);
        const toEl = this.nodes.get(conn.to);
        if (!fromEl || !toEl) return;

        const r1 = fromEl.getBoundingClientRect();
        const r2 = toEl.getBoundingClientRect();

        // Coordinates relative to container
        const x1 = r1.left + r1.width / 2 - containerRect.left;
        const y1 = r1.bottom - containerRect.top;
        const x2 = r2.left + r2.width / 2 - containerRect.left;
        const y2 = r2.top - containerRect.top;

        // Mobile: straight vertical-ish lines
        if (isMobile) {
          this._addLine(x1, y1, x2, y2, false);
          return;
        }

        // Desktop: curved paths
        const isBridge = conn.type === 'bridge';
        this._addCurvedLine(x1, y1, x2, y2, isBridge);
      });
    }

    _addLine(x1, y1, x2, y2, isDashed) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const d = `M ${x1} ${y1} L ${x2} ${y2}`;
      path.setAttribute('d', d);
      path.classList.add('skill-tree-lines');
      if (isDashed) {
        path.style.strokeDasharray = '4 4';
        path.style.opacity = '0.5';
      }
      this.svg.appendChild(path);
    }

    _addCurvedLine(x1, y1, x2, y2, isBridge) {
      const deltaY = y2 - y1;
      const cpY1 = y1 + deltaY * 0.5;
      const cpY2 = y2 - deltaY * 0.5;

      let d;
      if (isBridge) {
        // Horizontal bridge: more curvature
        const midY = (y1 + y2) / 2 + 10;
        d = `M ${x1} ${y1} Q ${x1} ${midY} ${(x1 + x2) / 2} ${midY} Q ${x2} ${midY} ${x2} ${y2}`;
      } else {
        // Vertical branch: smooth S-curve
        d = `M ${x1} ${y1} C ${x1} ${cpY1}, ${x2} ${cpY2}, ${x2} ${y2}`;
      }

      // Background track
      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      bg.setAttribute('d', d);
      bg.classList.add('skill-tree-line-bg');
      this.svg.appendChild(bg);

      // Animated flow line
      const flow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      flow.setAttribute('d', d);
      flow.classList.add('skill-tree-line-flow');
      if (isBridge) {
        flow.style.opacity = '0.4';
        flow.style.animationDuration = '2s';
      }
      this.svg.appendChild(flow);
    }

    /* ── Entrance Animation ─────────────────────────────────── */

    _animateEntrance() {
      const nodes = Array.from(this.nodes.values());
      nodes.forEach((el, i) => {
        setTimeout(() => {
          el.classList.add('is-visible');
        }, i * this.options.staggerDelay);
      });

      // Also animate SVG lines drawing in
      const lines = this.svg.querySelectorAll('.skill-tree-line-flow');
      lines.forEach((line, i) => {
        const len = line.getTotalLength ? line.getTotalLength() : 200;
        line.style.strokeDasharray = len;
        line.style.strokeDashoffset = len;
        line.style.transition = `stroke-dashoffset ${this.options.lineAnimDuration}ms ease-out ${i * 100 + 400}ms`;
        requestAnimationFrame(() => {
          line.style.strokeDashoffset = '0';
        });
      });
    }

    /* ── Click Handler ──────────────────────────────────────── */

    _onClick(node) {
      const state = this._computed[node.id];
      if (state && state.locked) return;

      if (typeof this.options.onNodeClick === 'function') {
        this.options.onNodeClick(node.mode, node);
        return;
      }

      // Fallback: use global enterPractice if available
      if (typeof global.enterPractice === 'function') {
        global.enterPractice(node.mode);
      } else {
        // Navigate to practice tab as fallback
        if (typeof global.goPage === 'function') {
          global.goPage('practice');
          // Small delay to let page switch, then call enterPractice
          setTimeout(() => {
            if (typeof global.enterPractice === 'function') {
              global.enterPractice(node.mode);
            }
          }, 100);
        }
      }
    }

    /* ── Utilities ──────────────────────────────────────────── */

    _escapeHtml(str) {
      if (!str) return '';
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     Expose
     ═══════════════════════════════════════════════════════════════ */

  global.SkillTreeRenderer = SkillTreeRenderer;

  // Auto-initialize if a container exists with data-init
  document.addEventListener('DOMContentLoaded', () => {
    const autoEl = document.querySelector('[data-skill-tree-auto]');
    if (autoEl) {
      try {
        const progress = JSON.parse(autoEl.dataset.progress || '{}');
        const tree = new SkillTreeRenderer(autoEl, progress);
        tree.render();
      } catch (e) {
        console.error('[SkillTree] Auto-init failed:', e);
      }
    }
  });
})(window);
