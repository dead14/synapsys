/**
 * ILI Pipeline Alignment System v10 — Canvas Charts
 * Pure Canvas API charts — no external libraries.
 */

const Charts = (() => {
  // ── Theme Colors ──
  const COLORS = {
    cyan: '#06b6d4', emerald: '#10b981', amber: '#f59e0b',
    rose: '#f43f5e', violet: '#8b5cf6', orange: '#f97316',
    blue: '#3b82f6', white: '#1e1e1e', muted: '#8c8c8c',
    bg: '#ffffff', gridLine: 'rgba(0,0,0,0.06)',
  };

  const STATUS_COLORS = {
    ACTIVE_CORROSION: COLORS.rose,
    STABLE: COLORS.emerald,
    SUSPECT_MATCH: COLORS.amber,
    NDF: COLORS.orange,
    NEW_IN_R2: COLORS.blue,
    MATCHED: COLORS.cyan,
  };

  function getCtx(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);
    return { ctx, w: rect.width, h: rect.height };
  }

  function drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /**
   * Bar Chart — for valve correction, anomaly counts
   * @param {string} canvasId
   * @param {{labels: string[], values: number[], colors: string[]}} data
   * @param {{title?: string, showValues?: boolean}} options
   */
  function renderBarChart(canvasId, data, options = {}) {
    const result = getCtx(canvasId);
    if (!result) return;
    const { ctx, w, h } = result;
    const { labels, values, colors } = data;
    const n = values.length;
    if (n === 0) return;

    const pad = { top: 40, right: 20, bottom: 50, left: 50 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    const maxVal = Math.max(...values, 1) * 1.15;
    const barW = Math.min(40, (plotW / n) * 0.6);
    const gap = (plotW - barW * n) / (n + 1);

    // Title
    if (options.title) {
      ctx.fillStyle = COLORS.white;
      ctx.font = '600 13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(options.title, w / 2, 22);
    }

    // Grid lines
    ctx.strokeStyle = COLORS.gridLine;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + plotH - (plotH * i / 4);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
      ctx.fillStyle = COLORS.muted;
      ctx.font = '11px Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(Math.round(maxVal * i / 4).toString(), pad.left - 8, y + 4);
    }

    // Bars
    values.forEach((val, i) => {
      const x = pad.left + gap + i * (barW + gap);
      const barH = (val / maxVal) * plotH;
      const y = pad.top + plotH - barH;
      const color = colors?.[i] || COLORS.cyan;

      const grad = ctx.createLinearGradient(x, y, x, y + barH);
      grad.addColorStop(0, color);
      grad.addColorStop(1, color + '88');
      ctx.fillStyle = grad;
      drawRoundedRect(ctx, x, y, barW, barH, 4);
      ctx.fill();

      // Value on top
      if (options.showValues !== false) {
        ctx.fillStyle = COLORS.white;
        ctx.font = '600 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(val.toString(), x + barW / 2, y - 6);
      }

      // Label
      ctx.fillStyle = COLORS.muted;
      ctx.font = '11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.save();
      ctx.translate(x + barW / 2, pad.top + plotH + 14);
      const label = labels[i] || '';
      if (label.length > 8) {
        ctx.rotate(-0.4);
        ctx.textAlign = 'right';
      }
      ctx.fillText(label.substring(0, 12), 0, 0);
      ctx.restore();
    });
  }

  /**
   * Donut Chart — for status distribution
   */
  function renderDonutChart(canvasId, data, options = {}) {
    const result = getCtx(canvasId);
    if (!result) return;
    const { ctx, w, h } = result;
    const { labels, values, colors } = data;
    const total = values.reduce((a, b) => a + b, 0);
    if (total === 0) return;

    const cx = w / 2;
    const cy = h / 2 + 10;
    const outerR = Math.min(w, h) / 2 - 30;
    const innerR = outerR * 0.58;

    // Title
    if (options.title) {
      ctx.fillStyle = COLORS.white;
      ctx.font = '600 13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(options.title, cx, 22);
    }

    let startAngle = -Math.PI / 2;
    const arcs = [];

    values.forEach((val, i) => {
      const sliceAngle = (val / total) * Math.PI * 2;
      const color = colors?.[i] || COLORS.cyan;

      ctx.beginPath();
      ctx.arc(cx, cy, outerR, startAngle, startAngle + sliceAngle);
      ctx.arc(cx, cy, innerR, startAngle + sliceAngle, startAngle, true);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();

      arcs.push({ startAngle, endAngle: startAngle + sliceAngle, label: labels[i], val, color });
      startAngle += sliceAngle;
    });

    // Center text
    ctx.fillStyle = COLORS.white;
    ctx.font = '800 28px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(total.toString(), cx, cy + 5);
    ctx.fillStyle = COLORS.muted;
    ctx.font = '11px Inter, sans-serif';
    ctx.fillText('Total', cx, cy + 22);

    // Legend
    const legendY = h - 14;
    let lx = 12;
    labels.forEach((label, i) => {
      if (values[i] === 0) return;
      ctx.fillStyle = colors[i];
      ctx.fillRect(lx, legendY - 8, 8, 8);
      ctx.fillStyle = COLORS.muted;
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'left';
      const txt = `${label} (${values[i]})`;
      ctx.fillText(txt, lx + 12, legendY);
      lx += ctx.measureText(txt).width + 24;
    });
  }

  /**
   * Gauge Chart — for match rate percentage
   */
  function renderGaugeChart(canvasId, value, max, options = {}) {
    const result = getCtx(canvasId);
    if (!result) return;
    const { ctx, w, h } = result;
    const pct = Math.min(value / Math.max(max, 1), 1);

    const cx = w / 2;
    const cy = h / 2 + 20;
    const radius = Math.min(w, h) / 2 - 30;

    // Title
    if (options.title) {
      ctx.fillStyle = COLORS.white;
      ctx.font = '600 13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(options.title, cx, 22);
    }

    const startAngle = Math.PI * 0.8;
    const endAngle = Math.PI * 2.2;
    const totalArc = endAngle - startAngle;

    // Background arc
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.strokeStyle = COLORS.gridLine;
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Value arc
    const valAngle = startAngle + totalArc * pct;
    const grad = ctx.createLinearGradient(cx - radius, cy, cx + radius, cy);
    grad.addColorStop(0, COLORS.cyan);
    grad.addColorStop(1, COLORS.emerald);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, valAngle);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Percentage text
    ctx.fillStyle = COLORS.white;
    ctx.font = '800 36px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(pct * 100)}%`, cx, cy + 10);
    ctx.fillStyle = COLORS.muted;
    ctx.font = '11px Inter, sans-serif';
    ctx.fillText(options.label || 'Match Rate', cx, cy + 30);
  }

  /**
   * Scatter/Depth Chart — depth_r1 vs depth_r2
   */
  function renderDepthChart(canvasId, matchedPairs, options = {}) {
    const result = getCtx(canvasId);
    if (!result) return;
    const { ctx, w, h } = result;

    const pad = { top: 40, right: 20, bottom: 45, left: 55 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    const points = matchedPairs.filter(p => p.depth_r1 != null && p.depth_r2 != null);
    const maxD = Math.max(
      ...points.map(p => Math.max(p.depth_r1, p.depth_r2)),
      10
    ) * 1.1;

    // Title
    if (options.title) {
      ctx.fillStyle = COLORS.white;
      ctx.font = '600 13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(options.title, w / 2, 22);
    }

    // Grid
    ctx.strokeStyle = COLORS.gridLine;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const x = pad.left + (plotW * i / 4);
      const y = pad.top + plotH - (plotH * i / 4);
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + plotH); ctx.stroke();
      ctx.fillStyle = COLORS.muted;
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(Math.round(maxD * i / 4).toString(), pad.left - 6, y + 4);
      ctx.textAlign = 'center';
      ctx.fillText(Math.round(maxD * i / 4).toString(), x, pad.top + plotH + 16);
    }

    // Axis labels
    ctx.fillStyle = COLORS.muted;
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Depth R1 (%WT)', w / 2, h - 4);
    ctx.save();
    ctx.translate(12, h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Depth R2 (%WT)', 0, 0);
    ctx.restore();

    // 1:1 line
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top + plotH);
    ctx.lineTo(pad.left + plotW, pad.top);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Points
    points.forEach(p => {
      const x = pad.left + (p.depth_r1 / maxD) * plotW;
      const y = pad.top + plotH - (p.depth_r2 / maxD) * plotH;
      const color = STATUS_COLORS[p.status] || COLORS.cyan;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = color + 'cc';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }

  return { renderBarChart, renderDonutChart, renderGaugeChart, renderDepthChart, STATUS_COLORS, COLORS };
})();
