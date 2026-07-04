/**
 * MAD Training Studio — Dashboard Renderer v2.0
 * FIFA-style visual stats, KPI cards, trend charts, radar charts
 * Integrates with ProgressClient data model
 */

class DashboardRenderer {
  constructor(containerId, progressClient) {
    this.container = document.getElementById(containerId);
    this.pc = progressClient;
    this.modeColors = {
      shadowing: '#14B8A6',
      consecutive: '#5B9BD5',
      simultaneous: '#A855F7',
      chuchotage: '#F59E0B',
      sight_translation: '#10B981',
      opi: '#F43F5E',
      escort: '#FB923C',
      legal_verbatim: '#94A3B8'
    };
    this.modeLabels = {
      shadowing: 'Shadowing',
      consecutive: 'Consecutive',
      simultaneous: 'Simultaneous',
      chuchotage: 'Chuchotage',
      sight_translation: 'Sight Translation',
      opi: 'OPI/VRI',
      escort: 'Escort/Liaison',
      legal_verbatim: 'Legal Verbatim'
    };
    // Skill attributes for radar charts (like FIFA player stats)
    this.skillAttributes = {
      accuracy: 'Accuracy',
      fluency: 'Fluency',
      terminology: 'Terminology',
      completeness: 'Completeness',
      register: 'Register',
      protocol: 'Protocol',
      memory: 'Memory',
      evs: 'EVS Control',
      cultural: 'Cultural Mediation'
    };
  }

  /**
   * Main render method — builds the entire dashboard
   */
  async render() {
    if (!this.container) return;
    const data = this.pc ? this.pc.getCached() : this._buildDemoData();
    
    this.container.innerHTML = `
      <div class="dashboard-root">
        ${this._renderHeader(data)}
        ${this._renderKPICards(data)}
        ${this._renderRadarSection(data)}
        ${this._renderSkillBars(data)}
        ${this._renderTrendsSection(data)}
        ${this._renderModeCards(data)}
        ${this._renderStreakSection(data)}
        ${this._renderCertReadiness(data)}
        ${this._renderAchievements(data)}
      </div>
    `;

    // Animate elements after render
    this._animateEntry();
    this._animateProgressBars();
    this._animateRadarCharts();
    this._animateCountUps();
  }

  // ========== HEADER ==========
  _renderHeader(data) {
    const stats = this.pc ? this.pc.getStats() : { currentLevel: 1, levelName: 'Novice', totalSessions: 0, streak: 0 };
    const userName = data.userName || 'Interpreter';
    const initials = userName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    
    return `
      <div class="dashboard-header animate-fade-in">
        <h1>Training Dashboard</h1>
        <div class="user-badge">
          <div class="avatar">${initials}</div>
          <div>
            <div style="font-weight:600;font-size:14px;">${userName}</div>
            <div style="font-size:12px;color:var(--text-tertiary);">${stats.levelName}</div>
          </div>
          <span class="level-pill">Lv.${stats.currentLevel}</span>
        </div>
      </div>
    `;
  }

  // ========== KPI CARDS ==========
  _renderKPICards(data) {
    const stats = this.pc ? this.pc.getStats() : this._buildDemoStats();
    const sessions = data.sessions || [];
    
    // Generate sparkline data
    const weeklyData = this._generateWeeklyData(sessions, 7);
    const monthlyData = this._generateWeeklyData(sessions, 30);
    
    const cards = [
      { label: 'Total Sessions', value: stats.totalSessions, delta: '+3', deltaType: 'up', color: 'primary', visual: 'sparkline', visualData: weeklyData },
      { label: 'Accuracy Avg', value: stats.avgScore ? stats.avgScore + '%' : 'N/A', delta: '+5.2%', deltaType: 'up', color: 'success', visual: 'sparkline', visualData: this._generateRandomSparkline(7, 60, 95) },
      { label: 'Practice Hours', value: stats.totalHours || '0', delta: '+1.5h', deltaType: 'up', color: 'info', visual: 'bars', visualData: [3, 5, 2, 7, 4, 6, 5] },
      { label: 'Current Streak', value: stats.streak + ' days', delta: 'Best: ' + (stats.bestStreak || stats.streak), deltaType: 'neutral', color: 'accent', visual: 'bars', visualData: [1, 1, 1, 0, 1, 1, 1] },
      { label: 'Modules Done', value: Object.keys(data.modulesDone || {}).length + '/29', delta: 'Phase ' + (data.currentPhase || 1), deltaType: 'neutral', color: 'warning', visual: 'progress', visualData: Object.keys(data.modulesDone || {}).length / 29 },
      { label: 'XP Earned', value: stats.xp || '0', delta: 'Next: ' + (stats.xpNeeded || '200'), deltaType: 'neutral', color: 'success', visual: 'sparkline', visualData: this._generateRandomSparkline(7, 0, 500) },
    ];

    return `
      <div class="kpi-row stagger-children">
        ${cards.map(c => this._renderKPICard(c)).join('')}
      </div>
    `;
  }

  _renderKPICard(card) {
    let visualHtml = '';
    if (card.visual === 'sparkline') {
      visualHtml = this._renderSparkline(card.visualData, card.color);
    } else if (card.visual === 'bars') {
      visualHtml = this._renderMiniBars(card.visualData, card.color);
    } else if (card.visual === 'progress') {
      visualHtml = `<div class="kpi-visual" style="display:flex;align-items:center;gap:8px;">
        <div style="flex:1;height:8px;background:var(--bg-overlay);border-radius:var(--radius-full);overflow:hidden;">
          <div style="width:${card.visualData * 100}%;height:100%;background:var(--${card.color});border-radius:var(--radius-full);transition:width 1s var(--ease-smooth);"></div>
        </div>
        <span style="font-size:11px;color:var(--text-tertiary);">${Math.round(card.visualData * 100)}%</span>
      </div>`;
    }

    return `
      <div class="kpi-card ${card.color}">
        <div class="kpi-label">${card.label}</div>
        <div class="kpi-value">${card.value}</div>
        <div class="kpi-delta ${card.deltaType}">
          ${card.deltaType === 'up' ? '▲' : card.deltaType === 'down' ? '▼' : '—'} ${card.delta}
        </div>
        ${visualHtml}
      </div>
    `;
  }

  _renderSparkline(data, colorKey) {
    const color = this._getColor(colorKey);
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const width = 100;
    const height = 40;
    const points = data.map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x},${y}`;
    }).join(' ');
    
    const areaPoints = `${points} ${width},${height} 0,${height}`;
    
    return `
      <div class="kpi-visual">
        <svg class="sparkline" viewBox="0 0 100 40" preserveAspectRatio="none">
          <polygon class="sparkline-area" points="${areaPoints}" fill="${color}" opacity="0.15"/>
          <polyline class="sparkline-path" points="${points}" stroke="${color}" fill="none"/>
        </svg>
      </div>
    `;
  }

  _renderMiniBars(data, colorKey) {
    const color = this._getColor(colorKey);
    const max = Math.max(...data, 1);
    return `
      <div class="kpi-visual">
        <div class="mini-bars">
          ${data.map(v => `<div class="mini-bar" style="height:${(v / max) * 100}%;background:${color};"></div>`).join('')}
        </div>
      </div>
    `;
  }

  // ========== RADAR CHARTS ==========
  _renderRadarSection(data) {
    // Overall interpreter radar (all 7 modes as axes)
    const overallScores = this._calculateOverallScores(data);
    
    // Per-mode skill radars (each mode has its own skill attributes)
    const modeScores = this._calculateModeScores(data);
    
    return `
      <div class="radar-section">
        <div class="radar-card overall">
          <h3>
            <span class="mode-icon" style="background:var(--primary-subtle);color:var(--primary);">🎯</span>
            Overall Interpreter Profile
          </h3>
          <div class="radar-container">
            ${this._renderRadarChart(overallScores, Object.keys(this.modeLabels), Object.values(this.modeLabels), '#5B9BD5', 100)}
          </div>
          <div class="radar-legend">
            <div class="radar-legend-item">
              <div class="radar-legend-dot" style="background:#5B9BD5;"></div>
              <span>Your Skills</span>
            </div>
            <div class="radar-legend-item">
              <div class="radar-legend-dot" style="background:var(--border);"></div>
              <span>Target (Certification)</span>
            </div>
          </div>
        </div>
        
        ${Object.entries(modeScores).slice(0, 2).map(([mode, scores]) => `
          <div class="radar-card">
            <h3>
              <span class="mode-icon" style="background:${this.modeColors[mode]}22;color:${this.modeColors[mode]};">
                ${this._getModeIcon(mode)}
              </span>
              ${this.modeLabels[mode]} Skills
            </h3>
            <div class="radar-container">
              ${this._renderRadarChart(scores, 
                Object.keys(this.skillAttributes), 
                Object.values(this.skillAttributes), 
                this.modeColors[mode], 100)}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  _renderRadarChart(scores, keys, labels, color, maxValue) {
    const cx = 50;
    const cy = 50;
    const radius = 40;
    const levels = 5;
    const numAxes = keys.length;
    const angleStep = (2 * Math.PI) / numAxes;
    
    // Generate grid circles
    const gridCircles = [];
    for (let i = 1; i <= levels; i++) {
      const r = (radius / levels) * i;
      const points = [];
      for (let j = 0; j < numAxes; j++) {
        const angle = j * angleStep - Math.PI / 2;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        points.push(`${x},${y}`);
      }
      gridCircles.push(`<polygon class="radar-grid-circle" points="${points.join(' ')}"/>`);
    }
    
    // Generate grid axes
    const gridAxes = [];
    for (let i = 0; i < numAxes; i++) {
      const angle = i * angleStep - Math.PI / 2;
      const x = cx + radius * Math.cos(angle);
      const y = cy + radius * Math.sin(angle);
      gridAxes.push(`<line class="radar-grid-axis" x1="${cx}" y1="${cy}" x2="${x}" y2="${y}"/>`);
    }
    
    // Generate data area
    const dataPoints = [];
    const labelPoints = [];
    for (let i = 0; i < numAxes; i++) {
      const angle = i * angleStep - Math.PI / 2;
      const score = scores[keys[i]] || 0;
      const r = (score / maxValue) * radius;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      dataPoints.push(`${x},${y}`);
      labelPoints.push({ x, y, score, label: labels[i] });
    }
    
    // Generate labels
    const labelEls = [];
    for (let i = 0; i < numAxes; i++) {
      const angle = i * angleStep - Math.PI / 2;
      const labelR = radius + 10;
      const lx = cx + labelR * Math.cos(angle);
      const ly = cy + labelR * Math.sin(angle);
      labelEls.push(`<text class="radar-label" x="${lx}" y="${ly}">${labels[i]}</text>`);
    }
    
    // Generate data points
    const pointEls = labelPoints.map((p, i) => 
      `<circle class="radar-point" cx="${p.x}" cy="${p.y}" fill="${color}" stroke="${color}" data-score="${p.score}" data-label="${p.label}"/>
      <text class="radar-value-label" x="${p.x}" y="${p.y - 8}">${Math.round(p.score)}</text>`
    ).join('');
    
    return `
      <svg class="radar-svg" viewBox="0 0 100 100">
        ${gridCircles.join('')}
        ${gridAxes.join('')}
        <polygon class="radar-area" points="${dataPoints.join(' ')}" fill="${color}" stroke="${color}"/>
        ${labelEls.join('')}
        ${pointEls}
      </svg>
    `;
  }

  // ========== SKILL BARS ==========
  _renderSkillBars(data) {
    const skills = this._calculateOverallSkills(data);
    const skillEntries = Object.entries(skills).sort((a, b) => b[1] - a[1]);
    
    return `
      <div class="skill-bars-section">
        <h3>🎮 Skill Attributes</h3>
        ${skillEntries.map(([key, value]) => {
          const label = this.skillAttributes[key] || key;
          const color = value >= 80 ? 'var(--success)' : value >= 60 ? 'var(--warning)' : 'var(--error)';
          const valueClass = value >= 80 ? 'high' : value >= 60 ? 'medium' : 'low';
          return `
            <div class="skill-bar-row">
              <div class="skill-bar-label">${label}</div>
              <div class="skill-bar-track">
                <div class="skill-bar-fill" style="width:0%;background:${color};" data-target="${value}"></div>
              </div>
              <div class="skill-bar-value ${valueClass}">${Math.round(value)}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // ========== TRENDS ==========
  _renderTrendsSection(data) {
    const sessions = data.sessions || [];
    const trendData = this._generateTrendData(sessions, 30);
    
    return `
      <div class="trends-section">
        <h3>📈 Progress Over Time</h3>
        <div class="trend-chart-container">
          ${this._renderTrendChart(trendData, 'Accuracy Trend', '#5B9BD5')}
        </div>
      </div>
    `;
  }

  _renderTrendChart(data, label, color) {
    const width = 800;
    const height = 300;
    const padding = { top: 20, right: 40, bottom: 40, left: 50 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;
    
    const values = data.map(d => d.value);
    const min = Math.min(...values) * 0.9;
    const max = Math.max(...values) * 1.1;
    const range = max - min || 1;
    
    // Grid lines
    const gridLines = [];
    for (let i = 0; i <= 5; i++) {
      const y = padding.top + (i / 5) * chartH;
      const val = max - (i / 5) * range;
      gridLines.push(`<line class="trend-grid-line" x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}"/>`);
      gridLines.push(`<text class="trend-axis-label" x="${padding.left - 10}" y="${y + 4}" text-anchor="end">${Math.round(val)}</text>`);
    }
    
    // Data line
    const points = data.map((d, i) => {
      const x = padding.left + (i / (data.length - 1)) * chartW;
      const y = padding.top + chartH - ((d.value - min) / range) * chartH;
      return `${x},${y}`;
    }).join(' ');
    
    // Area
    const areaPoints = `${padding.left},${padding.top + chartH} ${points} ${width - padding.right},${padding.top + chartH}`;
    
    // Data points
    const pointEls = data.map((d, i) => {
      const x = padding.left + (i / (data.length - 1)) * chartW;
      const y = padding.top + chartH - ((d.value - min) / range) * chartH;
      return `<circle class="trend-data-point" cx="${x}" cy="${y}" fill="${color}" data-date="${d.date}" data-value="${d.value}"/>`;
    }).join('');
    
    // X-axis labels (every 5th day)
    const xLabels = data.filter((_, i) => i % 5 === 0).map((d, i) => {
      const x = padding.left + (i * 5 / (data.length - 1)) * chartW;
      return `<text class="trend-axis-label" x="${x}" y="${height - 10}" text-anchor="middle">${d.date.slice(5)}</text>`;
    }).join('');
    
    return `
      <svg class="trend-chart" viewBox="0 0 ${width} ${height}">
        ${gridLines.join('')}
        <polygon class="trend-area" points="${areaPoints}" fill="${color}" opacity="0.15"/>
        <polyline class="trend-line" points="${points}" stroke="${color}" fill="none"/>
        ${pointEls}
        <line class="trend-axis" x1="${padding.left}" y1="${padding.top + chartH}" x2="${width - padding.right}" y2="${padding.top + chartH}""/>
        <line class="trend-axis" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + chartH}""/>
        ${xLabels}
      </svg>
      <div class="trend-tooltip" id="trend-tooltip"></div>
    `;
  }

  // ========== MODE CARDS ==========
  _renderModeCards(data) {
    const modeUnlocks = this.pc ? this.pc.getModeUnlocks() : {};
    const modes = ['shadowing', 'consecutive', 'simultaneous', 'chuchotage', 'sight_translation', 'opi', 'escort'];
    
    return `
      <div class="mode-cards-section">
        <h3>🎮 Mode Progress</h3>
        <div class="mode-cards-grid stagger-children">
          ${modes.map(mode => this._renderModeCard(mode, modeUnlocks[mode] || {})).join('')}
        </div>
      </div>
    `;
  }

  _renderModeCard(mode, unlockData) {
    const color = this.modeColors[mode];
    const label = this.modeLabels[mode];
    const isUnlocked = unlockData.practiceUnlocked;
    const isSimUnlocked = unlockData.simUnlocked;
    const progress = isUnlocked ? (isSimUnlocked ? 100 : 50) : 0;
    const sessions = Math.floor(Math.random() * 50); // Demo data
    const avgScore = Math.floor(Math.random() * 30) + 65; // Demo data
    
    return `
      <div class="mode-card" style="--mode-color: ${color};" data-mode="${mode}">
        <div class="mode-card-header">
          <h4 class="mode-card-title">${label}</h4>
          <span class="mode-card-badge ${isUnlocked ? (isSimUnlocked ? 'unlocked' : 'in-progress') : 'locked'}">
            ${isSimUnlocked ? 'Mastered' : isUnlocked ? 'In Progress' : 'Locked'}
          </span>
        </div>
        <div class="mode-card-progress">
          <div class="mode-card-progress-label">
            <span>Progress</span>
            <span>${progress}%</span>
          </div>
          <div class="mode-card-progress-bar">
            <div class="mode-card-progress-fill" style="width:0%;" data-target="${progress}"></div>
          </div>
        </div>
        <div class="mode-card-stats">
          <div class="mode-card-stat">
            <div class="mode-card-stat-value">${sessions}</div>
            <div class="mode-card-stat-label">Sessions</div>
          </div>
          <div class="mode-card-stat">
            <div class="mode-card-stat-value">${avgScore}%</div>
            <div class="mode-card-stat-label">Avg Score</div>
          </div>
        </div>
      </div>
    `;
  }

  // ========== STREAK ==========
  _renderStreakSection(data) {
    const stats = this.pc ? this.pc.getStats() : { streak: 12, bestStreak: 45 };
    const heatmapData = this._generateHeatmapData(365);
    
    return `
      <div class="streak-section">
        <h3><span class="streak-flame">🔥</span> Practice Streak</h3>
        <div class="streak-header">
          <div>
            <div class="streak-counter">${stats.streak}</div>
            <div class="streak-counter-label">Current Streak</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:var(--text-heading-2);font-weight:var(--weight-bold);color:var(--text-secondary);">${stats.bestStreak}</div>
            <div class="streak-counter-label">Best Streak</div>
          </div>
        </div>
        <div class="streak-heatmap">
          ${heatmapData.map(d => `
            <div class="streak-day level-${d.level}" title="${d.date}: ${d.minutes} minutes">
              <div class="streak-day-tooltip">${d.date}<br>${d.minutes} min</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // ========== CERT READINESS ==========
  _renderCertReadiness(data) {
    const readiness = this._calculateCertReadiness(data);
    const circumference = 2 * Math.PI * 90; // r=90
    const offset = circumference - (readiness / 100) * circumference;
    
    return `
      <div class="cert-readiness-section">
        <div class="cert-readiness-label">Certification Readiness</div>
        <div class="cert-readiness-ring">
          <svg viewBox="0 0 200 200">
            <circle class="cert-readiness-ring-bg" cx="100" cy="100" r="90"/>
            <circle class="cert-readiness-ring-fill" cx="100" cy="100" r="90" 
              stroke="${readiness >= 80 ? 'var(--success)' : readiness >= 60 ? 'var(--warning)' : 'var(--error)'}"
              stroke-dasharray="${circumference}"
              stroke-dashoffset="${offset}"/>
          </svg>
          <div class="cert-readiness-value">${Math.round(readiness)}%</div>
        </div>
        <div class="cert-readiness-sub">
          ${readiness >= 80 ? 'You are ready to take the certification exam! 🎉' : 
            readiness >= 60 ? 'Keep practicing! You are getting close to certification readiness.' :
            'Complete more modules and practice sessions to improve your readiness.'}
        </div>
      </div>
    `;
  }

  // ========== ACHIEVEMENTS ==========
  _renderAchievements(data) {
    const achievements = this.pc ? this.pc.getAchievements() : this._buildDemoAchievements();
    
    return `
      <div class="achievements-section">
        <h3>🏆 Achievements</h3>
        <div class="achievements-grid stagger-children">
          ${achievements.map(a => this._renderAchievementCard(a)).join('')}
        </div>
      </div>
    `;
  }

  _renderAchievementCard(ach) {
    const progress = (ach.progress / ach.max) * 100;
    return `
      <div class="achievement-card ${ach.unlocked ? 'unlocked' : 'locked'}">
        <div class="achievement-icon">${ach.unlocked ? ach.icon || '🏅' : '🔒'}</div>
        <div class="achievement-name">${ach.name}</div>
        <div class="achievement-desc">${ach.desc}</div>
        ${!ach.unlocked ? `
          <div class="achievement-progress">
            <div class="achievement-progress-fill" style="width:${progress}%"></div>
          </div>
          <div class="achievement-progress-text">${ach.progress}/${ach.max} ${ach.unit || ''}</div>
        ` : '<div style="margin-top:8px;font-size:12px;color:var(--accent);font-weight:600;">✓ Unlocked!</div>'}
      </div>
    `;
  }

  // ========== ANIMATIONS ==========
  _animateEntry() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('animate-fade-in');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });

    this.container.querySelectorAll('.radar-card, .mode-card, .achievement-card, .trends-section, .skill-bars-section, .streak-section, .cert-readiness-section').forEach(el => {
      el.style.opacity = '0';
      observer.observe(el);
    });
  }

  _animateProgressBars() {
    setTimeout(() => {
      this.container.querySelectorAll('.skill-bar-fill[data-target]').forEach(bar => {
        bar.style.width = bar.dataset.target + '%';
      });
      this.container.querySelectorAll('.mode-card-progress-fill[data-target]').forEach(bar => {
        bar.style.width = bar.dataset.target + '%';
      });
    }, 300);
  }

  _animateRadarCharts() {
    setTimeout(() => {
      this.container.querySelectorAll('.radar-area').forEach(area => {
        area.style.opacity = '1';
      });
    }, 500);
  }

  _animateCountUps() {
    this.container.querySelectorAll('.kpi-value').forEach(el => {
      const text = el.textContent;
      const num = parseFloat(text);
      if (!isNaN(num) && num > 0) {
        const suffix = text.replace(/[0-9.]/g, '');
        let current = 0;
        const step = num / 30;
        const timer = setInterval(() => {
          current += step;
          if (current >= num) {
            current = num;
            clearInterval(timer);
          }
          el.textContent = Math.round(current) + suffix;
        }, 30);
      }
    });
  }

  // ========== HELPERS ==========
  _getColor(key) {
    const colors = {
      primary: '#5B9BD5', accent: '#E8C547', success: '#4ADE80',
      warning: '#FBBF24', error: '#F87171', info: '#60A5FA'
    };
    return colors[key] || key;
  }

  _getModeIcon(mode) {
    const icons = {
      shadowing: '🔊', consecutive: '🎤', simultaneous: '🎧',
      chuchotage: '🗣️', sight_translation: '👁️', opi: '📞', escort: '🚶'
    };
    return icons[mode] || '🎯';
  }

  _generateWeeklyData(sessions, days) {
    return Array.from({length: days}, () => Math.floor(Math.random() * 10));
  }

  _generateRandomSparkline(length, min, max) {
    return Array.from({length}, () => Math.floor(Math.random() * (max - min) + min));
  }

  _generateHeatmapData(days) {
    const data = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const minutes = Math.random() > 0.3 ? Math.floor(Math.random() * 120) : 0;
      const level = minutes === 0 ? 0 : minutes < 30 ? 1 : minutes < 60 ? 2 : minutes < 90 ? 3 : 4;
      data.push({
        date: d.toISOString().slice(0, 10),
        minutes,
        level
      });
    }
    return data;
  }

  _generateTrendData(sessions, days) {
    const data = [];
    const now = new Date();
    let score = 60;
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      score += (Math.random() - 0.3) * 10;
      score = Math.max(50, Math.min(98, score));
      data.push({ date: d.toISOString().slice(0, 10), value: Math.round(score) });
    }
    return data;
  }

  _calculateOverallScores(data) {
    const sessions = data.sessions || [];
    const modes = Object.keys(this.modeLabels);
    const scores = {};
    modes.forEach(mode => {
      const modeSessions = sessions.filter(s => s.mode === mode || s.type === mode);
      scores[mode] = modeSessions.length > 0 
        ? modeSessions.reduce((a, s) => a + (parseFloat(s.score) || 0), 0) / modeSessions.length
        : Math.random() * 40 + 40; // Demo: 40-80 range
    });
    return scores;
  }

  _calculateModeScores(data) {
    const modes = ['consecutive', 'simultaneous', 'opi'];
    const result = {};
    modes.forEach(mode => {
      result[mode] = {};
      Object.keys(this.skillAttributes).forEach(attr => {
        result[mode][attr] = Math.random() * 60 + 30; // Demo: 30-90 range
      });
    });
    return result;
  }

  _calculateOverallSkills(data) {
    const skills = {};
    Object.keys(this.skillAttributes).forEach(attr => {
      skills[attr] = Math.random() * 60 + 30; // Demo: 30-90 range
    });
    return skills;
  }

  _calculateCertReadiness(data) {
    const modulesDone = Object.keys(data.modulesDone || {}).length;
    const total = 29;
    const base = (modulesDone / total) * 60;
    const avgScore = data.sessions?.length > 0 
      ? data.sessions.reduce((a, s) => a + (parseFloat(s.score) || 0), 0) / data.sessions.length
      : 70;
    const scoreBonus = (avgScore / 100) * 30;
    const streakBonus = Math.min((data.streakDays || 0) / 30, 1) * 10;
    return Math.min(100, base + scoreBonus + streakBonus);
  }

  _buildDemoData() {
    return {
      userName: 'Test Interpreter',
      modulesDone: { 'M001': true, 'M002': true, 'M003': true, 'M004': true, 'M005': true },
      currentPhase: 1,
      streakDays: 12,
      sessions: Array.from({length: 20}, (_, i) => ({
        type: 'interp',
        mode: ['consecutive', 'simultaneous', 'shadowing'][i % 3],
        score: (60 + Math.random() * 35).toFixed(1),
        file: `session_202401${String(i+1).padStart(2,'0')}_120000.mp3`
      }))
    };
  }

  _buildDemoStats() {
    return { totalSessions: 20, avgScore: 78.5, currentLevel: 4, levelName: 'Practitioner', xp: 850, streak: 12, bestStreak: 45, totalHours: 8.5 };
  }

  _buildDemoAchievements() {
    return [
      { id: 'first', name: 'First Steps', desc: 'Complete your first session', icon: '🚀', unlocked: true, progress: 1, max: 1 },
      { id: 'five', name: 'Getting Started', desc: 'Complete 5 sessions', icon: '⭐', unlocked: true, progress: 5, max: 5 },
      { id: 'dedicated', name: 'Dedicated Learner', desc: '10 hours of practice', icon: '⏱️', unlocked: false, progress: 8.5, max: 10, unit: 'h' },
      { id: 'week', name: 'Week Warrior', desc: '5 sessions in one week', icon: '⚔️', unlocked: true, progress: 5, max: 5 },
      { id: 'polyglot', name: 'Bilingual Voice', desc: 'Practice both directions', icon: '🌐', unlocked: false, progress: 1, max: 2 },
      { id: 'scholar', name: 'IELTS Scholar', desc: '3 IELTS sessions', icon: '📚', unlocked: false, progress: 1, max: 3 },
      { id: 'explorer', name: 'Explorer', desc: 'All 3 training modules', icon: '🗺️', unlocked: true, progress: 3, max: 3 },
      { id: 'centurion', name: 'Centurion', desc: '100 sessions', icon: '💯', unlocked: false, progress: 20, max: 100 },
    ];
  }
}

// ========== EXPORT ==========
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DashboardRenderer };
}
