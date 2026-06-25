/**
 * ILI Pipeline Alignment System v10 — API Client
 * Handles all communication with FastAPI backend.
 */
const API_BASE = window.location.origin;

const api = {
  /**
   * Upload R1 & R2 Excel files.
   * @param {File} fileR1 - Survey lama
   * @param {File} fileR2 - Survey baru
   * @returns {Promise<{job_id, files_received, message}>}
   */
  async upload(fileR1, fileR2) {
    const formData = new FormData();
    formData.append('file_r1', fileR1);
    formData.append('file_r2', fileR2);
    const res = await fetch(`${API_BASE}/api/upload`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Upload failed');
    }
    return res.json();
  },

  /**
   * Jalankan alignment pipeline.
   * @param {string} jobId
   * @param {object} params - { year_r1, year_r2, wt_mm, od_mm, smys_mpa, maop_bar }
   */
  async runAlignment(jobId, params = {}) {
    const body = { job_id: jobId, ...params };
    const res = await fetch(`${API_BASE}/api/run-alignment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Run failed');
    }
    return res.json();
  },

  /**
   * Check job status.
   * @param {string} jobId
   */
  async getStatus(jobId) {
    const res = await fetch(`${API_BASE}/api/status/${jobId}`);
    if (!res.ok) throw new Error('Status check failed');
    return res.json();
  },

  /**
   * Get full alignment results.
   * @param {string} jobId
   */
  async getResults(jobId) {
    const res = await fetch(`${API_BASE}/api/results/${jobId}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Results fetch failed');
    }
    return res.json();
  },

  /**
   * Get download URL for Excel report.
   * @param {string} jobId
   */
  getDownloadUrl(jobId) {
    return `${API_BASE}/api/download/${jobId}`;
  },

  /**
   * Connect WebSocket for real-time progress.
   * @param {string} jobId
   * @param {function} onMessage - Called with parsed JSON data
   * @param {function} onError
   * @param {function} onClose
   * @returns {WebSocket}
   */
  connectWebSocket(jobId, onMessage, onError, onClose) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/progress/${jobId}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[WS] Connected to progress stream');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
      } catch (e) {
        console.warn('[WS] Failed to parse message:', event.data);
      }
    };

    ws.onerror = (event) => {
      console.error('[WS] Error:', event);
      if (onError) onError(event);
    };

    ws.onclose = (event) => {
      console.log('[WS] Connection closed');
      if (onClose) onClose(event);
    };

    return ws;
  },
};
