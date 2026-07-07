/**
 * InterpLing — Layered Skill Tree Renderer
 * 4 horizontal layers (Beginner → Intermediate → Advanced → Expert)
 * New layout: Shadowing → CI/Liaison → Sight/Chuchotage/SI → VRI-OPI/Relay
 */

(function (global) {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════
     Tree Data
     ═══════════════════════════════════════════════════════════════ */

  const TREE_DATA = [
    {
      id: 'shadowing',
      name: 'Shadowing',
      mode: 'shadowing',
      layer: 0,
      position: 'center',
      offset: false,
      level: 'Beginner',
      levelClass: 'badge-beginner',
      description:
        'Repeat the speaker simultaneously in the same language. Builds listening, rhythm, and spoken fluency at broadcast pace.',
    },
    {
      id: 'consecutive',
      name: 'CI',
      mode: 'consecutive',
      layer: 1,
      position: 'left',
      offset: false,
      level: 'Intermediate',
      levelClass: 'badge-intermediate',
      description:
        'Listen to segments, take notes, then deliver your interpretation during the pause. Core conference skill.',
    },
    {
      id: 'liaison',
      name: 'Liaison',
      mode: 'escort',
      layer: 1,
      position: 'right',
      offset: false,
      level: 'Intermediate',
      levelClass: 'badge-intermediate',
      description:
        'Informal, bidirectional interpreting for business, social, or administrative settings. Emphasizes natural conversation and cultural mediation.',
    },
    {
      id: 'sight',
      name: 'Sight Translation',
      mode: 'sight',
      layer: 2,
      position: 'left',
      offset: false,
      level: 'Advanced',
      levelClass: 'badge-advanced',
      description:
        'Written-input, oral-output interpreting. Read a document on screen and deliver an oral rendition at a sustained pace.',
    },
    {
      id: 'chuchotage',
      name: 'Chuchotage',
      mode: 'chuchotage',
      layer: 2,
      position: 'center',
      offset: false,
      level: 'Advanced',
      levelClass: 'badge-advanced',
      description:
        'Whispered simultaneous, no booth or equipment, delivered at close proximity to 1–2 listeners. Adds volume discipline and noise resilience.',
    },
    {
      id: 'simultaneous',
      name: 'SI',
      mode: 'simultaneous',
      layer: 2,
      position: 'right',
      offset: false,
      level: 'Advanced',
      levelClass: 'badge-advanced',
      description:
        'Interpret in real-time while the speaker talks. Maximum cognitive challenge — full conference booth standard.',
    },
    {
      id: 'vri-opi',
      name: 'VRI / OPI',
      mode: 'opi',
      layer: 3,
      position: 'left',
      offset: false,
      level: 'Expert',
      levelClass: 'badge-premium',
      description:
        'Over-the-Phone & Video Remote Interpreting. Triadic communication between two simulated parties.',
    },
    {
      id: 'relay',
      name: 'Relay',
      mode: 'relay',
      layer: 3,
      position: 'right',
      offset: false,
      level: 'Expert',
      levelClass: 'badge-premium',
      description:
        'Relay interpreting — pass through a pivot language between two interpreters who do not share a common language. Coming soon.',
      comingSoon: true,
    },
  ];

  const CONNECTIONS = [
    { from: 'shadowing', to: 'consecutive' },
    { from: 'shadowing', to: 'liaison' },
    { from: 'consecutive', to: 'liaison' },
    { from: 'consecutive', to: 'sight' },
    { from: 'consecutive', to: 'vri-opi' },
    { from: 'sight', to: 'chuchotage' },
    { from: 'chuchotage', to: 'simultaneous' },
    { from: 'liaison', to: 'simultaneous' },
    { from: 'simultaneous', to: 'relay' },
  ];

  const UNLOCK_REQ_TEXT = {
    shadowing: 'Always available — your starting point.',
    consecutive: 'Complete Shadowing practice to unlock.',
    liaison: 'Complete Shadowing practice to unlock.',
    sight: 'Complete CI practice to unlock.',
    chuchotage: 'Complete Sight Translation practice to unlock.',
    simultaneous: 'Complete Liaison or Chuchotage practice to unlock.',
    'vri-opi': 'Complete CI + Sight Translation to unlock the expert track.',
    relay: 'Complete SI practice to unlock. Coming soon.',
  };

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
    escort:
      '<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    opi:
      '<svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
    relay:
      '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M2 12h4M18 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/><line x1="12" y1="12" x2="12" y2="12"/></svg>',
  };

  const LOCK_ICON =
    '<svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

  const CHECK_ICON =
    '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>';

  const LAYER_NAMES = ['Beginner', 'Intermediate', 'Advanced', 'Expert'];

  /* ═══════════════════════════════════════════════════════════════
     SkillTreeRenderer Class
     ═══════════════════════════════════════════════════════════════ */

  class SkillTreeRenderer {
    constructor(container, progress = {}, options = {}) {
      this.container =
        typeof container === 'string'
          ? document.querySelector(container)
          : container;
      this.progress = progress;
      this.options = Object.assign(
        {
          staggerDelay: 200,
          onNodeClick: null,
          devMode: true, // Default TRUE for developers — all modes unlocked
        },
        options
      );
      this.nodes = new Map();
      this.svg = null;
      this.resizeHandler = null;
    }

    render() {
      if (!this.container) {
        console.error('[SkillTree] Container not found');
        return;
      }
      this.container.innerHTML = '';
      this.container.classList.add('skill-tree-container');
      this.nodes.clear();

      this._buildDOM();
      this._computeStates();
      this._applyStates();

      requestAnimationFrame(() => {
        this._drawLines();
        this._animateEntrance();
      });

      this.resizeHandler = () => this._drawLines();
      window.addEventListener('resize', this.resizeHandler);
    }

    destroy() {
      if (this.resizeHandler) {
        window.removeEventListener('resize', this.resizeHandler);
        this.resizeHandler = null;
      }
      if (this.container) {
        this.container.innerHTML = '';
        this.container.classList.remove('skill-tree-container');
      }
      this.nodes.clear();
    }

    updateProgress(newProgress) {
      this.progress = newProgress;
      this._computeStates();
      this._applyStates();
      this._drawLines();
    }

    _computeStates() {
      const p = this.progress || {};
      const practiced = (k) => !!(p[k]?.practiced || p[k]?.sessions > 0);
      const completed = (k) => !!(p[k]?.completed || p[k]?.score >= 80);
      const s = {};

      // DEV MODE: all modes unlocked for testing
      if (this.options.devMode) {
        TREE_DATA.forEach((node) => {
          s[node.id] = { locked: false, completed: completed(node.id) };
        });
        this._computed = s;
        return s;
      }

      // Production unlock logic
      s.shadowing = { locked: false, completed: practiced('shadowing') };
      s.consecutive = { locked: !practiced('shadowing'), completed: completed('consecutive') };
      s.liaison = { locked: !practiced('shadowing'), completed: practiced('escort') || practiced('liaison') };
      s.sight = { locked: !practiced('consecutive'), completed: completed('sight') };
      s.chuchotage = { locked: !practiced('sight'), completed: completed('chuchotage') };
      s.simultaneous = { locked: !practiced('liaison') && !practiced('chuchotage'), completed: completed('simultaneous') };
      s['vri-opi'] = { locked: !(practiced('consecutive') && practiced('sight')), completed: completed('opi') || completed('vri') };
      s.relay = { locked: !practiced('simultaneous'), completed: false };

      this._computed = s;
      return s;
    }

    _applyStates() {
      const s = this._computed;
      TREE_DATA.forEach((node) => {
        const el = this.nodes.get(node.id);
        if (!el) return;
        const st = s[node.id] || { locked: true, completed: false };

        el.classList.remove('locked', 'unlocked', 'active', 'completed', 'coming-soon');

        if (node.comingSoon) {
          el.classList.add('coming-soon');
          return;
        }

        if (st.completed) {
          el.classList.add('completed', 'unlocked');
        } else if (st.locked) {
          el.classList.add('locked');
        } else {
          el.classList.add('unlocked');
          if (this._isCurrentNode(node.id)) {
            el.classList.add('active');
          }
        }
      });
    }

    _isCurrentNode(nodeId) {
      const order = [
        'shadowing',
        'consecutive',
        'liaison',
        'sight',
        'chuchotage',
        'simultaneous',
        'vri-opi',
        'relay',
      ];
      const idx = order.indexOf(nodeId);
      if (idx === -1) return false;

      for (let i = 0; i < idx; i++) {
        const id = order[i];
        const st = this._computed[id];
        if (st && !st.locked && !st.completed) return false;
      }
      const myState = this._computed[nodeId];
      return myState && !myState.locked && !myState.completed;
    }

    _buildDOM() {
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

      const layersWrap = document.createElement('div');
      layersWrap.className = 'skill-tree-layers';

      const layerMap = new Map();
      TREE_DATA.forEach((node) => {
        if (!layerMap.has(node.layer)) layerMap.set(node.layer, []);
        layerMap.get(node.layer).push(node);
      });

      for (let layerIdx = 0; layerIdx < 4; layerIdx++) {
        const layerNodes = layerMap.get(layerIdx) || [];
        const layerEl = document.createElement('div');
        layerEl.className = 'skill-layer';
        layerEl.dataset.layer = layerIdx;

        const label = document.createElement('div');
        label.className = 'skill-layer-label';
        label.textContent = LAYER_NAMES[layerIdx];
        layerEl.appendChild(label);

        const nodesWrap = document.createElement('div');
        nodesWrap.className = 'skill-layer-nodes';

        const byPos = { left: null, center: null, right: null };
        layerNodes.forEach((n) => {
          byPos[n.position] = n;
        });

        ['left', 'center', 'right'].forEach((pos) => {
          const node = byPos[pos];
          if (node) {
            nodesWrap.appendChild(this._buildNode(node));
          } else {
            const spacer = document.createElement('div');
            spacer.className = 'skill-node-spacer';
            nodesWrap.appendChild(spacer);
          }
        });

        layerEl.appendChild(nodesWrap);
        layersWrap.appendChild(layerEl);
      }

      this.container.appendChild(layersWrap);
    }

    _buildNode(node) {
      const el = document.createElement('div');
      el.className = 'skill-node';
      if (node.offset) el.classList.add('offset-node');
      el.dataset.id = node.id;
      el.dataset.mode = node.mode || '';

      const iconWrap = document.createElement('div');
      iconWrap.className = 'skill-node-icon';
      iconWrap.innerHTML = ICONS[node.mode] || ICONS.opi;
      el.appendChild(iconWrap);

      const name = document.createElement('div');
      name.className = 'skill-node-name';
      name.textContent = node.name;
      el.appendChild(name);

      const badge = document.createElement('span');
      badge.className = `skill-node-level ${node.levelClass}`;
      badge.textContent = node.level;
      el.appendChild(badge);

      if (node.comingSoon) {
        const csBadge = document.createElement('div');
        csBadge.className = 'coming-soon-badge';
        csBadge.textContent = 'Coming Soon';
        el.appendChild(csBadge);
      }

      const lockOverlay = document.createElement('div');
      lockOverlay.className = 'skill-node-lock';
      lockOverlay.innerHTML = LOCK_ICON;
      el.appendChild(lockOverlay);

      const checkBadge = document.createElement('div');
      checkBadge.className = 'skill-node-check';
      checkBadge.innerHTML = CHECK_ICON;
      el.appendChild(checkBadge);

      const tooltip = document.createElement('div');
      tooltip.className = 'skill-tree-tooltip';
      tooltip.innerHTML = `
        <div style="font-weight:700;color:var(--text-primary);margin-bottom:4px;">${this._escapeHtml(node.name)}</div>
        <div style="font-size:12px;color:var(--text-secondary);line-height:1.5;margin-bottom:12px;">${this._escapeHtml(node.description)}</div>
        <div style="font-size:11px;color:var(--text-tertiary);border-top:1px solid var(--border-subtle);padding-top:8px;">
          <span style="color:var(--accent);font-weight:600;">Unlock:</span> ${this._escapeHtml(
            UNLOCK_REQ_TEXT[node.id] || 'Complete previous modes.'
          )}
        </div>
      `;
      el.appendChild(tooltip);

      if (node.mode && !node.comingSoon) {
        el.addEventListener('click', () => this._onClick(node));
      }

      this.nodes.set(node.id, el);
      return el;
    }

    _drawLines() {
      if (!this.svg) return;

      const oldPaths = this.svg.querySelectorAll('.st-line, .st-line-bg');
      oldPaths.forEach((p) => p.remove());

      const containerRect = this.container.getBoundingClientRect();

      CONNECTIONS.forEach((conn) => {
        const fromEl = this.nodes.get(conn.from);
        const toEl = this.nodes.get(conn.to);
        if (!fromEl || !toEl) return;

        const r1 = fromEl.getBoundingClientRect();
        const r2 = toEl.getBoundingClientRect();

        const x1 = r1.left + r1.width / 2 - containerRect.left;
        const y1 = r1.top + r1.height / 2 - containerRect.top;
        const x2 = r2.left + r2.width / 2 - containerRect.left;
        const y2 = r2.top + r2.height / 2 - containerRect.top;

        const dy = y2 - y1;
        const cp1x = x1;
        const cp1y = y1 + dy * 0.5;
        const cp2x = x2;
        const cp2y = y2 - dy * 0.5;

        const d = `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;

        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        bg.setAttribute('d', d);
        bg.classList.add('st-line-bg', 'skill-tree-line-bg');
        this.svg.appendChild(bg);

        const flow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        flow.setAttribute('d', d);
        flow.classList.add('st-line', 'skill-tree-line');
        this.svg.appendChild(flow);
      });
    }

    _animateEntrance() {
      const layers = this.container.querySelectorAll('.skill-layer');
      layers.forEach((layer, li) => {
        const nodes = layer.querySelectorAll('.skill-node');
        nodes.forEach((node, ni) => {
          setTimeout(() => {
            node.classList.add('is-visible');
          }, li * this.options.staggerDelay + ni * 100);
        });
      });
    }

    _onClick(node) {
      if (node.comingSoon) return;

      const state = this._computed[node.id];
      if (state && state.locked) return;

      if (typeof this.options.onNodeClick === 'function') {
        this.options.onNodeClick(node.mode, node);
        return;
      }

      if (typeof global.enterPractice === 'function') {
        global.enterPractice(node.mode);
      } else if (typeof global.goPage === 'function') {
        global.goPage('practice');
        setTimeout(() => {
          if (typeof global.enterPractice === 'function') {
            global.enterPractice(node.mode);
          }
        }, 100);
      }
    }

    _escapeHtml(str) {
      if (!str) return '';
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }
  }

  global.SkillTreeRenderer = SkillTreeRenderer;

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
