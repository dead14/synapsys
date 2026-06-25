/**
 * ILI Pipeline Alignment System v10 — Main Application
 * Controls the entire SPA: upload → progress → results
 */
document.addEventListener('DOMContentLoaded', () => {

  // ═══════════════════════════════════════════════════════════════
  //  STATE
  // ═══════════════════════════════════════════════════════════════
  const state = {
    currentView: 'upload',
    jobId: null,
    files: { r1: null, r2: null },
    params: {
      year_r1: null, year_r2: null,
      wt_mm: 6.4, od_mm: 219.1, smys_mpa: 359.0, maop_bar: 70.0,
    },
    results: null,
    ws: null,
    pollTimer: null,
    activeTab: 'comparison',
    sortCol: null,
    sortDir: 'asc',
  };

  // ═══════════════════════════════════════════════════════════════
  //  DOM REFERENCES
  // ═══════════════════════════════════════════════════════════════
  const $  = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const views = {
    upload:   $('#viewUpload'),
    progress: $('#viewProgress'),
    results:  $('#viewResults'),
  };

  const navItems = {
    upload:   $('#navUpload'),
    progress: $('#navProgress'),
    results:  $('#navResults'),
  };

  // ═══════════════════════════════════════════════════════════════
  //  VIEW SWITCHING
  // ═══════════════════════════════════════════════════════════════
  function switchView(name) {
    Object.values(views).forEach(v => v?.classList.remove('active'));
    Object.values(navItems).forEach(n => n?.classList.remove('active'));

    if (views[name]) {
      views[name].classList.add('active');
      state.currentView = name;
    }
    
    if (navItems[name]) {
      navItems[name].classList.add('active');
    }
  }

  // Sidebar navigation click handlers
  Object.keys(navItems).forEach(name => {
    if (navItems[name]) {
      navItems[name].addEventListener('click', () => {
        if (!navItems[name].disabled) {
          switchView(name);
        }
      });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  //  UPLOAD VIEW — Drag & Drop
  // ═══════════════════════════════════════════════════════════════
  function initDragDrop() {
    ['r1', 'r2'].forEach(key => {
      const zone = $(`#dropZone_${key}`);
      const input = zone?.querySelector('input[type="file"]');
      if (!zone || !input) return;

      ['dragenter', 'dragover'].forEach(evt => {
        zone.addEventListener(evt, e => { e.preventDefault(); zone.classList.add('dragover'); });
      });
      ['dragleave', 'drop'].forEach(evt => {
        zone.addEventListener(evt, e => { e.preventDefault(); zone.classList.remove('dragover'); });
      });

      zone.addEventListener('drop', e => {
        const file = e.dataTransfer.files[0];
        if (file) setFile(key, file);
      });

      input.addEventListener('change', e => {
        if (e.target.files[0]) setFile(key, e.target.files[0]);
      });
    });
  }

  function setFile(key, file) {
    state.files[key] = file;
    const zone = $(`#dropZone_${key}`);
    if (!zone) return;
    zone.classList.add('has-file');
    const info = zone.querySelector('.zone-file-info');
    if (info) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
      info.textContent = `${file.name} (${sizeMB} MB)`;
    }
    updateRunButton();
  }

  function updateRunButton() {
    const btn = $('#btnRunAlignment');
    if (btn) btn.disabled = !(state.files.r1 && state.files.r2);
  }

  // ═══════════════════════════════════════════════════════════════
  //  PARAMETERS
  // ═══════════════════════════════════════════════════════════════
  function initParams() {
    const toggle = $('#paramsToggle');
    const grid = $('#paramsGrid');
    if (toggle && grid) {
      toggle.addEventListener('click', () => {
        toggle.classList.toggle('open');
        grid.classList.toggle('open');
      });
    }

    // Bind inputs
    ['year_r1', 'year_r2', 'wt_mm', 'od_mm', 'smys_mpa', 'maop_bar'].forEach(key => {
      const input = $(`#param_${key}`);
      if (!input) return;
      input.value = state.params[key] || '';
      input.addEventListener('change', () => {
        const val = input.value.trim();
        state.params[key] = val ? (key.startsWith('year') ? parseInt(val) : parseFloat(val)) : null;
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  UPLOAD & RUN
  // ═══════════════════════════════════════════════════════════════
  async function handleRunClick() {
    const btn = $('#btnRunAlignment');
    if (!state.files.r1 || !state.files.r2) return;

    btn.disabled = true;
    btn.innerHTML = '<span class="loading-spinner"></span> Uploading...';

    try {
      // Step 1: Upload
      const uploadRes = await api.upload(state.files.r1, state.files.r2);
      state.jobId = uploadRes.job_id;

      // Step 2: Switch to progress view
      const navProgress = $('#navProgress');
      if (navProgress) navProgress.disabled = false;
      switchView('progress');
      resetProgress();

      // Step 3: Start alignment
      const params = {};
      for (const [k, v] of Object.entries(state.params)) {
        if (v !== null && v !== '' && !isNaN(v)) params[k] = v;
      }
      await api.runAlignment(state.jobId, params);

      // Step 4: Start polling (WebSocket may not work in all envs)
      startPolling();

    } catch (err) {
      alert('Error: ' + err.message);
      btn.disabled = false;
      btn.innerHTML = 'Start Alignment';
      switchView('upload');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  PROGRESS VIEW
  // ═══════════════════════════════════════════════════════════════
  const LAYERS = [
    { id: 0, name: 'Validasi', key: 'Layer 0' },
    { id: 1, name: 'Valve Corr.', key: 'Layer 1' },
    { id: 2, name: 'Weld Match', key: 'Layer 2' },
    { id: 3, name: 'Anomaly Match', key: 'Layer 3' },
    { id: 4, name: 'Growth Val.', key: 'Layer 4' },
    { id: 5, name: 'Excel Report', key: 'Excel' },
  ];

  function resetProgress() {
    // Reset nodes
    LAYERS.forEach((layer, i) => {
      const node = $(`#pipelineNode_${i}`);
      if (node) {
        node.className = 'pipeline-node';
      }
    });
    // Reset bar
    const fill = $('#progressBarFill');
    if (fill) fill.style.width = '0%';
    const pct = $('#progressPctLabel');
    if (pct) pct.textContent = '0%';
    // Clear log
    const log = $('#logTerminal');
    if (log) log.innerHTML = '';
  }

  function updateProgress(pct, currentLayer, message) {
    const fill = $('#progressBarFill');
    if (fill) fill.style.width = `${pct}%`;
    const label = $('#progressPctLabel');
    if (label) label.textContent = `${Math.round(pct)}%`;

    // Update nodes
    LAYERS.forEach((layer, i) => {
      const node = $(`#pipelineNode_${i}`);
      if (!node) return;
      const layerPcts = [10, 25, 45, 65, 85, 95];
      if (pct >= layerPcts[i] + 5) {
        node.className = 'pipeline-node done';
      } else if (pct >= layerPcts[i] - 5) {
        node.className = 'pipeline-node active';
      }
    });

    // Add log line
    if (message) addLogLine(message);
  }

  function addLogLine(text) {
    const log = $('#logTerminal');
    if (!log) return;
    const line = document.createElement('div');
    line.className = 'log-line';
    if (text.includes('[Layer') || text.includes('LAYER')) line.className += ' layer';
    if (text.includes('ERROR')) line.className += ' error';
    if (text.includes('COMPLETE') || text.includes('OK')) line.className += ' success';

    const ts = new Date().toLocaleTimeString('id-ID');
    line.innerHTML = `<span class="timestamp" style="color:var(--text-muted);font-size:0.8em;margin-right:8px">[${ts}]</span>${escapeHtml(text)}`;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ═══════════════════════════════════════════════════════════════
  //  POLLING (fallback for WebSocket)
  // ═══════════════════════════════════════════════════════════════
  let lastLogCount = 0;

  function startPolling() {
    lastLogCount = 0;
    state.pollTimer = setInterval(async () => {
      try {
        const status = await api.getStatus(state.jobId);
        updateProgress(status.progress_pct, status.current_layer, null);

        // Add new log lines
        if (status.logs && status.logs.length > lastLogCount) {
          for (let i = lastLogCount; i < status.logs.length; i++) {
            addLogLine(status.logs[i]);
          }
          lastLogCount = status.logs.length;
        }

        if (status.status === 'completed') {
          stopPolling();
          updateProgress(100, null, 'Pipeline completed successfully!');
          LAYERS.forEach((_, i) => {
            const node = $(`#pipelineNode_${i}`);
            if (node) node.className = 'pipeline-node done';
          });
          
          const navResults = $('#navResults');
          if (navResults) navResults.disabled = false;
          
          setTimeout(() => loadResults(), 800);
        } else if (status.status === 'failed') {
          stopPolling();
          addLogLine('ERROR: ' + (status.message || 'Pipeline failed'));
          LAYERS.forEach((_, i) => {
            const node = $(`#pipelineNode_${i}`);
            if (node && node.classList.contains('active')) {
              node.className = 'pipeline-node error';
            }
          });
        }
      } catch (err) {
        console.error('Poll error:', err);
      }
    }, 1500);
  }

  function stopPolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  RESULTS VIEW
  // ═══════════════════════════════════════════════════════════════
  async function loadResults() {
    try {
      const data = await api.getResults(state.jobId);
      state.results = data;
      switchView('results');
      renderSummaryCards(data.summary);
      renderCharts(data);
      initTabs(data);
    } catch (err) {
      addLogLine('ERROR loading results: ' + err.message);
    }
  }

  function renderSummaryCards(s) {
    setText('#statMatched', s.n_matched);
    setText('#statActive', s.n_active_corrosion);
    setText('#statNDF', s.n_ndf);
    setText('#statNew', s.n_new);

    const erfEl = $('#erfWarning');
    if (erfEl) {
      erfEl.textContent = s.critical_erf_count > 0 ? `⚠ ${s.critical_erf_count} ERF ≥ 1.0` : '';
      erfEl.style.display = s.critical_erf_count > 0 ? 'block' : 'none';
    }
  }

  function setText(sel, val) {
    const el = $(sel);
    if (el) el.textContent = val ?? '—';
  }

  function renderCharts(data) {
    const s = data.summary;
    const results = data.results || [];

    // Status distribution donut
    Charts.renderDonutChart('chartDonut', {
      labels:  ['Active', 'Stable', 'Suspect', 'NDF', 'NEW'],
      values:  [s.n_active_corrosion, s.n_stable, s.n_suspect, s.n_ndf, s.n_new],
      colors:  [Charts.COLORS.rose, Charts.COLORS.emerald, Charts.COLORS.amber, Charts.COLORS.orange, Charts.COLORS.blue],
    }, { title: 'Status Distribution' });

    // Depth scatter
    const matched = results.filter(r => r.depth_r1 != null && r.depth_r2 != null);
    Charts.renderDepthChart('chartDepth', matched, { title: 'Depth Comparison (R1 vs R2)' });

    // Match rate gauge
    const total = s.n_matched + s.n_ndf + s.n_new;
    Charts.renderGaugeChart('chartGauge', s.n_matched, total, {
      title: 'Match Rate', label: `${s.n_matched} of ${total}`,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  TABS & TABLES
  // ═══════════════════════════════════════════════════════════════
  function initTabs(data) {
    const tabBtns = $$('.tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        $$('.tab-content').forEach(tc => tc.classList.remove('active'));
        const target = btn.dataset.tab;
        const content = $(`#tab_${target}`);
        if (content) content.classList.add('active');
        state.activeTab = target;
        renderTabTable(target, data);
      });
    });

    // Render default tab
    renderTabTable('comparison', data);
  }

  function renderTabTable(tabName, data) {
    const results = data.results || [];
    let filtered = [];
    let columns = [];

    switch (tabName) {
      case 'comparison':
        filtered = results.filter(r => r.status !== 'NDF' && r.status !== 'NEW_IN_R2');
        columns = ['status', 'spool_id', 'anom_id_r1', 'anom_id_r2', 'delta_odo', 'delta_clock', 'depth_r1', 'depth_r2', 'side', 'cost'];
        break;
      case 'new':
        filtered = results.filter(r => r.status === 'NEW_IN_R2');
        columns = ['spool_id', 'anom_id_r2', 'depth_r2', 'length_r2', 'side', 'flag'];
        break;
      case 'old':
        filtered = results.filter(r => r.status === 'NDF');
        columns = ['spool_id', 'anom_id_r1', 'depth_r1', 'length_r1', 'side', 'flag'];
        break;
      case 'physics':
        filtered = results.filter(r => ['ACTIVE_CORROSION', 'STABLE', 'SUSPECT_MATCH'].includes(r.status));
        columns = ['status', 'anom_id_r1', 'anom_id_r2', 'depth_r1', 'depth_r2', 'depth_growth_pct', 'growth_rate_per_yr', 'erf', 'remaining_life_yr'];
        break;
      case 'weld':
        buildWeldTable(data.weld_matching || []);
        return;
      case 'valve':
        buildValveTable(data.valve_correction || []);
        return;
    }

    buildTable(`#table_${tabName}`, filtered, columns);
  }

  function buildTable(containerId, rows, columns) {
    const container = $(containerId);
    if (!container) return;

    const count = container.closest('.tab-content')?.querySelector('.table-count');
    if (count) count.textContent = `${rows.length} entries`;

    // Search
    const search = container.closest('.tab-content')?.querySelector('.table-search');
    let displayRows = rows;
    if (search) {
      search.oninput = () => {
        const term = search.value.toLowerCase();
        const filtered = rows.filter(r =>
          columns.some(c => String(r[c] ?? '').toLowerCase().includes(term))
        );
        renderTableHtml(container, filtered, columns);
        if (count) count.textContent = `${filtered.length} of ${rows.length} entries`;
      };
    }

    renderTableHtml(container, displayRows, columns);
  }

  function renderTableHtml(container, rows, columns) {
    const colLabels = {
      status: 'Status', spool_id: 'Spool', anom_id_r1: 'ID R1', anom_id_r2: 'ID R2',
      delta_odo: 'Δ Odo (m)', delta_clock: 'Δ Clock (°)', depth_r1: 'Depth R1 (%)',
      depth_r2: 'Depth R2 (%)', length_r1: 'Length R1', length_r2: 'Length R2',
      side: 'Side', cost: 'Cost', flag: 'Flag',
      depth_growth_pct: 'Growth (%)', growth_rate_per_yr: 'Rate (%/yr)',
      erf: 'ERF', remaining_life_yr: 'Life (yr)',
    };

    let html = '<table><thead><tr>';
    columns.forEach(col => {
      html += `<th data-col="${col}">${colLabels[col] || col}<span class="sort-icon">↕</span></th>`;
    });
    html += '</tr></thead><tbody>';

    rows.forEach(row => {
      html += `<tr>`;
      columns.forEach(col => {
        let val = row[col];
        if (col === 'status') {
          val = renderBadge(row.status);
        } else if (typeof val === 'number') {
          val = val % 1 === 0 ? val : val.toFixed(3);
        }
        html += `<td>${val ?? '—'}</td>`;
      });
      html += '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;

    // Sort handlers
    container.querySelectorAll('th').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        const dir = (state.sortCol === col && state.sortDir === 'asc') ? 'desc' : 'asc';
        state.sortCol = col;
        state.sortDir = dir;

        rows.sort((a, b) => {
          let va = a[col], vb = b[col];
          if (va == null) return 1;
          if (vb == null) return -1;
          if (typeof va === 'number') return dir === 'asc' ? va - vb : vb - va;
          return dir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
        });

        renderTableHtml(container, rows, columns);
      });
    });
  }

  function buildWeldTable(welds) {
    const container = $('#table_weld');
    if (!container || !welds.length) {
      if (container) container.innerHTML = '<p class="text-muted" style="padding:20px">No weld matching data</p>';
      return;
    }
    const cols = Object.keys(welds[0]);
    buildTable('#table_weld', welds, cols);
  }

  function buildValveTable(valves) {
    const container = $('#table_valve');
    if (!container || !valves.length) {
      if (container) container.innerHTML = '<p class="text-muted" style="padding:20px">No valve correction data</p>';
      return;
    }
    const cols = Object.keys(valves[0]);
    buildTable('#table_valve', valves, cols);
  }

  function renderBadge(status) {
    const map = {
      ACTIVE_CORROSION: ['badge-red', 'Active'],
      STABLE: ['badge-green', 'Stable'],
      SUSPECT_MATCH: ['badge-orange', 'Suspect'],
      NDF: ['badge-orange', 'NDF'],
      NEW_IN_R2: ['badge-blue', 'NEW'],
      MATCHED: ['badge-green', 'Matched'],
    };
    const [cls, label] = map[status] || ['badge-green', status];
    return `<span class="badge ${cls}">${label}</span>`;
  }

  // ═══════════════════════════════════════════════════════════════
  //  DOWNLOAD & NEW ANALYSIS
  // ═══════════════════════════════════════════════════════════════
  function handleDownload() {
    if (!state.jobId) return;
    window.open(api.getDownloadUrl(state.jobId), '_blank');
  }

  function handleNewAnalysis() {
    stopPolling();
    state.jobId = null;
    state.files = { r1: null, r2: null };
    state.results = null;

    // Reset upload zones
    ['r1', 'r2'].forEach(key => {
      const zone = $(`#dropZone_${key}`);
      if (zone) {
        zone.classList.remove('has-file');
        const info = zone.querySelector('.zone-file-info');
        if (info) info.textContent = '';
        const input = zone.querySelector('input[type="file"]');
        if (input) input.value = '';
      }
    });

    updateRunButton();
    switchView('upload');
  }

  // ═══════════════════════════════════════════════════════════════
  //  INIT
  // ═══════════════════════════════════════════════════════════════
  function initApp() {
    initDragDrop();
    initParams();

    const btnRun = $('#btnRunAlignment');
    if (btnRun) btnRun.addEventListener('click', handleRunClick);

    const btnDownload = $('#btnDownload');
    if (btnDownload) btnDownload.addEventListener('click', handleDownload);

    const btnNew = $('#btnNewAnalysis');
    if (btnNew) btnNew.addEventListener('click', handleNewAnalysis);

    updateRunButton();
    switchView('upload');
  }

  initApp();
});
