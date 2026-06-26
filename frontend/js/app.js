/**
 * ILI Pipeline Alignment System v10 — Main Application
 * Controls the entire SPA: upload → progress → results
 */
document.addEventListener('DOMContentLoaded', () => {

  // ═══════════════════════════════════════════════════════════════
  //  STATE
  // ═══════════════════════════════════════════════════════════════
  const state = {
    currentView: 'dashboard',
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
    dashboard: $('#viewDashboard'),
    upload:   $('#viewUpload'),
    progress: $('#viewProgress'),
    results:  $('#viewResults'),
    ffs:      $('#viewFFS'),
  };

  const navItems = {
    dashboard: $('#navDashboard'),
    upload:   $('#navUpload'),
    progress: $('#navProgress'),
    results:  $('#navResults'),
    ffs:      $('#navFFS'),
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

    const titleEl = $('#pageTitle');
    const subEl = $('#pageSubtitle');
    if (titleEl && subEl) {
      if (name === 'dashboard') {
        titleEl.innerHTML = 'Home Dashboard <span>🏠</span>';
        subEl.textContent = 'Welcome back! Here is an overview of your recent pipeline alignment projects.';
      } else if (name === 'upload') {
        titleEl.innerHTML = 'Hi, Engineer! <span>👋</span>';
        subEl.textContent = 'Upload two ILI survey files to begin the 4-layer alignment process.';
      } else if (name === 'progress') {
        titleEl.innerHTML = 'Alignment in Progress <span>⚙️</span>';
        subEl.textContent = 'Please wait while the engine matches the pipeline features...';
      } else if (name === 'results') {
        titleEl.innerHTML = 'Analysis Results <span>📊</span>';
        subEl.textContent = 'Review the alignment matches and statistics below.';
      } else if (name === 'ffs') {
        titleEl.innerHTML = 'FFS Assessment <span>🔍</span>';
        subEl.textContent = 'Fitness-For-Service (ASME B31G Modified) for matched anomalies.';
      }
    }
  }

  // Sidebar navigation click handlers
  Object.keys(navItems).forEach(name => {
    if (navItems[name]) {
      navItems[name].addEventListener('click', () => {
        if (!navItems[name].disabled) {
          if (name === 'ffs') {
             sessionStorage.setItem('ffs_job_id', state.jobId);
             const iframe = $('#ffsFrame');
             if (iframe.src === 'about:blank' || iframe.src === window.location.href) {
               iframe.src = '/static/ffs.html';
             }
          } else if (name === 'dashboard') {
             // Refresh dashboard data dynamically
             loadProjects();
          }
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

    const resumeSelect = $('#param_resume_project');
    const nameInput = $('#param_project_name');
    
    let projectId = null;
    
    if (resumeSelect && resumeSelect.value) {
      projectId = parseInt(resumeSelect.value);
    } else if (nameInput && nameInput.value.trim()) {
      try {
        const proj = await api.createProject(nameInput.value.trim());
        projectId = proj.id;
        state.projectName = proj.name;
      } catch (err) {
        alert('Error creating project: ' + err.message);
        return;
      }
    } else {
      alert('Please enter a New Pipeline Name or select a Previous Project.');
      return;
    }

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
      const params = { project_id: projectId };
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
  async function loadProjects() {
    try {
      const projects = await api.getProjects();
      const select = $('#param_resume_project');
      if (select) {
        select.innerHTML = '<option value="">-- Select Project --</option>';
        projects.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = p.name;
          select.appendChild(opt);
        });
      }

      // Populate Dashboard
      let totalProjects = projects.length;
      let completedJobs = 0;
      let failedJobs = 0;
      
      const tbody = $('#table_recent_projects tbody');
      if (tbody) tbody.innerHTML = '';

      for (const p of projects) {
         let pStatus = '<span class="badge" style="background:var(--surface2);border:1px solid var(--border);">Pending</span>';
         
         try {
           const jobs = await api.getProjectJobs(p.id);
           const alignmentJob = jobs.find(j => j.type === 'alignment');
           if (alignmentJob) {
             if (alignmentJob.status === 'completed') {
               completedJobs++;
               pStatus = '<span class="badge badge-green">Completed</span>';
             } else if (alignmentJob.status === 'failed') {
               failedJobs++;
               pStatus = '<span class="badge badge-red">Failed</span>';
             } else {
               pStatus = `<span class="badge badge-orange">${alignmentJob.status}</span>`;
             }
           }
         } catch(e) {}

         if (tbody) {
           const tr = document.createElement('tr');
           tr.innerHTML = `
             <td style="color:var(--text-muted);">PRJ-${p.id.toString().padStart(3, '0')}</td>
             <td style="font-weight:600;">${p.name}</td>
             <td>${new Date(p.created_at).toLocaleDateString()}</td>
             <td>${pStatus}</td>
             <td><button class="btn-resume" data-id="${p.id}">Continue</button></td>
           `;
           tbody.appendChild(tr);
         }
      }

      if ($('#dash_val_projects')) $('#dash_val_projects').textContent = totalProjects;
      if ($('#dash_val_jobs')) $('#dash_val_jobs').textContent = completedJobs;
      if ($('#dash_val_failed')) $('#dash_val_failed').textContent = failedJobs;

      if (tbody) {
        tbody.querySelectorAll('.btn-resume').forEach(btn => {
          btn.addEventListener('click', () => {
             const pid = btn.getAttribute('data-id');
             if (select) {
               select.value = pid;
               select.dispatchEvent(new Event('change'));
             }
          });
        });
      }

      // When user selects a project, try to load its latest completed job
      select.addEventListener('change', async () => {
        const projectId = select.value;
        if (!projectId) return;
        try {
          const jobs = await api.getProjectJobs(projectId);
          const alignmentJob = jobs.find(j => j.type === 'alignment' && j.status === 'completed');
          if (alignmentJob) {
            // Restore job
            state.jobId = alignmentJob.id;
            
            try {
              const res = await api.getResults(state.jobId);
              state.results = res;
            } catch(e) {
              console.warn("Detailed results not in memory. Excel report and FFS are still available.");
              state.results = null;
            }
            
            const navProgress = $('#navProgress');
            if (navProgress) navProgress.disabled = !state.results;
            const navResults = $('#navResults');
            if (navResults) navResults.disabled = !state.results;
            const navFFS = $('#navFFS');
            if (navFFS) navFFS.disabled = false;
            
            if (state.results) {
              renderResults();
              switchView('results');
            } else {
              // Switch directly to FFS if results are missing
              sessionStorage.setItem('ffs_job_id', state.jobId);
              const iframe = $('#ffsFrame');
              if (iframe) iframe.src = '/static/ffs.html';
              switchView('ffs');
              alert('Alignment tables are no longer in memory. Redirecting to FFS Assessment & Excel download.');
            }
          } else {
            alert('No completed alignment job found for this project. Please upload files to run a new alignment.');
          }
        } catch (err) {
          console.error("Failed to fetch project jobs", err);
        }
      });
    } catch (err) {
      console.error("Failed to load projects", err);
    }
  }

  function initApp() {
    initDragDrop();
    initParams();
    loadProjects();

    const btnRun = $('#btnRunAlignment');
    if (btnRun) btnRun.addEventListener('click', handleRunClick);

    const btnDownload = $('#btnDownload');
    if (btnDownload) btnDownload.addEventListener('click', handleDownload);

    const btnContinueFFS = $('#btnContinueFFS');
    if (btnContinueFFS) {
      btnContinueFFS.addEventListener('click', () => {
        if (!state.jobId) {
          alert('No alignment job is currently active.');
          return;
        }
        $('#navFFS').disabled = false;
        sessionStorage.setItem('ffs_job_id', state.jobId);
        
        const iframe = $('#ffsFrame');
        if (iframe.src === 'about:blank' || iframe.src === window.location.href) {
          iframe.src = '/static/ffs.html';
        } else {
          // Force reload the iframe so it fetches the latest ffs_job_id from sessionStorage
          iframe.contentWindow.location.reload();
        }
        
        switchView('ffs');
      });
    }

    const btnNew = $('#btnNewAnalysis');
    if (btnNew) btnNew.addEventListener('click', handleNewAnalysis);

    updateRunButton();
    switchView('dashboard');
  }

  initApp();
});
