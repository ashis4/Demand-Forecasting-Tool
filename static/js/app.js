/* ─── STATE ──────────────────────────────────────────────────────────────── */
const state = {
  colMap: {},
  columns: [],
  vizData: null,
  selectedModel: 'arima',
  selectedHorizon: 30,
};

const PLOTLY_LAYOUT = {
  paper_bgcolor: 'transparent',
  plot_bgcolor:  'transparent',
  font: { family: 'Space Mono, monospace', color: '#6b7690', size: 11 },
  margin: { t: 10, b: 40, l: 50, r: 20 },
  xaxis: { gridcolor: '#1e2634', zerolinecolor: '#1e2634', tickfont: { size: 10 } },
  yaxis: { gridcolor: '#1e2634', zerolinecolor: '#1e2634', tickfont: { size: 10 } },
  legend: { bgcolor: 'transparent', font: { size: 11 } },
};
const PLOTLY_CONFIG = { displayModeBar: false, responsive: true };

/* ─── NAV ────────────────────────────────────────────────────────────────── */
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const sec = btn.dataset.section;
    if (sec !== 'upload' && !state.vizData) { alert('Upload a dataset first!'); return; }
    goTo(sec);
  });
});

function goTo(sec) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.section === sec));
  document.querySelectorAll('.section').forEach(s => s.classList.toggle('active', s.id === `section-${sec}`));
  if (sec === 'dashboard') loadDashboard();
  if (sec === 'visualize') loadVisualize();
}

/* ─── FILE UPLOAD ────────────────────────────────────────────────────────── */
const dropZone  = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');

dropZone.addEventListener('click', e => { if (e.target === dropZone || e.target.classList.contains('upload-icon') || e.target.classList.contains('upload-text')) fileInput.click(); });
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) uploadFile(file);
});
fileInput.addEventListener('change', () => { if (fileInput.files[0]) uploadFile(fileInput.files[0]); });

function uploadFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  showLoader('Reading and analyzing your dataset…');
  fetch('/api/preview', { method: 'POST', body: fd })
    .then(r => r.json())
    .then(data => {
      hideLoader();
      if (data.error) { alert('Error: ' + data.error); return; }
      state.colMap  = data.col_map;
      state.columns = data.columns;
      renderPreview(data);
      setStatus(true, `${data.rows} rows loaded`);
      // trigger visualize data fetch
      fetchVizData();
    })
    .catch(e => { hideLoader(); alert('Upload failed: ' + e); });
}

/* ─── SAMPLE DATA ────────────────────────────────────────────────────────── */
function loadSample(type) {
  showLoader('Generating sample dataset…');
  const csv = generateSampleCSV(type);
  const blob = new Blob([csv], { type: 'text/csv' });
  const file = new File([blob], `${type}_sample.csv`);
  const fd = new FormData();
  fd.append('file', file);
  fetch('/api/preview', { method: 'POST', body: fd })
    .then(r => r.json())
    .then(data => {
      hideLoader();
      if (data.error) { alert(data.error); return; }
      state.colMap  = data.col_map;
      state.columns = data.columns;
      renderPreview(data);
      setStatus(true, `${data.rows} rows loaded`);
      fetchVizData();
    })
    .catch(e => { hideLoader(); alert(e); });
}

function generateSampleCSV(type) {
  const products = {
    retail:    ['T-Shirt','Jeans','Sneakers','Jacket','Cap'],
    ecommerce: ['Laptop','Phone','Headphones','Tablet','Charger'],
    seasonal:  ['Sunscreen','Raincoat','Heater','Fan','Umbrella'],
  }[type] || ['Product A','Product B','Product C'];

  const rows = ['Date,Product,Sales,Quantity,Revenue'];
  const base = type === 'seasonal' ? 300 : 500;
  const now  = new Date();
  for (let i = 365; i >= 0; i--) {
    const d   = new Date(now); d.setDate(d.getDate() - i);
    const ds  = d.toISOString().slice(0,10);
    const prod = products[Math.floor(Math.random() * products.length)];
    const seasonal = type === 'seasonal' ? Math.sin((i / 365) * 2 * Math.PI) * 150 : 0;
    const noise = (Math.random() - 0.5) * 80;
    const trend = i < 180 ? (180 - i) * 0.5 : 0;
    const qty   = Math.max(1, Math.round(base + seasonal + noise + trend));
    const price = 15 + Math.random() * 85;
    const sales = qty;
    const rev   = Math.round(qty * price);
    rows.push(`${ds},${prod},${sales},${qty},${rev}`);
  }
  return rows.join('\n');
}

/* ─── PREVIEW RENDER ─────────────────────────────────────────────────────── */
function renderPreview(data) {
  document.getElementById('preview-card').classList.remove('hidden');
  document.getElementById('preview-meta').textContent = `${data.rows} rows × ${data.cols} columns`;

  // col map pills
  const pillRow = document.getElementById('col-map-row');
  pillRow.innerHTML = '';
  const pillTypes = { date: 'date', revenue: 'value', quantity: 'value', sales: 'value', product: 'product' };
  Object.entries(data.col_map).forEach(([type, col]) => {
    const cls = pillTypes[type] || '';
    pillRow.innerHTML += `<span class="col-pill ${cls}">◉ ${type}: <b>${col}</b></span>`;
  });

  // table
  const tbl  = document.getElementById('preview-table');
  const cols  = Object.keys(data.head[0] || {});
  tbl.innerHTML = `<thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead>
    <tbody>${data.head.map(row =>
      `<tr>${cols.map(c => `<td>${row[c] ?? '—'}</td>`).join('')}</tr>`
    ).join('')}</tbody>`;

  // stats
  const sg = document.getElementById('stats-grid');
  sg.innerHTML = Object.entries(data.summary).map(([col, s]) =>
    `<div class="stat-mini">
      <div class="stat-mini-label">${col}</div>
      <div class="stat-mini-val">${fmt(s.mean)}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px">min ${fmt(s.min)} · max ${fmt(s.max)}</div>
    </div>`
  ).join('');

  // missing
  const mr = document.getElementById('missing-row');
  mr.innerHTML = Object.entries(data.missing).map(([col, cnt]) =>
    `<span class="missing-badge ${cnt === 0 ? 'ok' : 'bad'}">${col}: ${cnt === 0 ? '✓' : cnt + ' missing'}</span>`
  ).join('');
}

/* ─── VIZ DATA ───────────────────────────────────────────────────────────── */
function fetchVizData() {
  fetch('/api/visualize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }).then(r => r.json()).then(data => {
    if (!data.error) state.vizData = data;
  });
}

/* ─── DASHBOARD ──────────────────────────────────────────────────────────── */
function loadDashboard() {
  fetch('/api/kpi')
    .then(r => r.json())
    .then(data => {
      if (data.error) return;
      const g = document.getElementById('kpi-grid');
      const cards = [
        { icon: '💰', label: 'TOTAL SALES', val: fmt(data.total_sales), sub: `${data.total_rows} records`, cls: 'accent1' },
        { icon: '📊', label: 'AVG DEMAND', val: fmt(data.avg_demand), sub: 'per period', cls: 'accent2' },
        { icon: '🏆', label: 'TOP PRODUCT', val: data.top_product || '—', sub: `${data.num_products || 0} products`, cls: 'accent3' },
        { icon: '📅', label: 'DATE RANGE', val: data.total_days ? data.total_days + 'd' : '—', sub: `${(data.date_range||{}).start||''} → ${(data.date_range||{}).end||''}`, cls: 'accent4' },
        { icon: '📈', label: 'MAX VALUE', val: fmt(data.max_val), sub: 'peak observed', cls: 'accent5' },
      ];
      g.innerHTML = cards.map(c =>
        `<div class="kpi-card ${c.cls}">
          <div class="kpi-icon">${c.icon}</div>
          <div class="kpi-label">${c.label}</div>
          <div class="kpi-val">${c.val}</div>
          <div class="kpi-sub">${c.sub}</div>
        </div>`
      ).join('');
    });

  if (state.vizData) renderDashCharts(state.vizData);
}

function renderDashCharts(d) {
  // Trend
  if (d.trend) {
    Plotly.newPlot('dash-trend', [{
      x: d.trend.x, y: d.trend.y,
      type: 'scatter', mode: 'lines',
      fill: 'tozeroy',
      fillcolor: 'rgba(0,229,255,0.08)',
      line: { color: '#00e5ff', width: 2 },
    }], { ...PLOTLY_LAYOUT, margin: { t: 10, b: 50, l: 60, r: 20 } }, PLOTLY_CONFIG);
  }

  // Monthly
  if (d.monthly) {
    Plotly.newPlot('dash-monthly', [{
      x: d.monthly.x, y: d.monthly.y,
      type: 'bar',
      marker: { color: d.monthly.y.map((_, i) => `hsl(${200 + i*8}, 80%, 60%)`) },
    }], { ...PLOTLY_LAYOUT }, PLOTLY_CONFIG);
  }

  // Product
  if (d.product && d.product.labels) {
    Plotly.newPlot('dash-product', [{
      labels: d.product.labels, values: d.product.values,
      type: 'pie',
      marker: { colors: ['#00e5ff','#7b61ff','#00ff9d','#ffcc00','#ff6b6b','#ff9f43','#48dbfb','#ff9ff3','#ffeaa7','#dfe6e9'] },
      textfont: { color: '#e8eaf0', size: 11 },
      hole: 0.4,
    }], { ...PLOTLY_LAYOUT, margin: { t: 10, b: 10, l: 10, r: 10 } }, PLOTLY_CONFIG);
  }
}

/* ─── VISUALIZE ──────────────────────────────────────────────────────────── */
function loadVisualize() {
  if (!state.vizData) return;
  const d = state.vizData;

  // Day-of-week
  if (d.dow) {
    Plotly.newPlot('viz-dow', [{
      x: d.dow.labels, y: d.dow.values,
      type: 'bar',
      marker: {
        color: d.dow.values.map(v => {
          const max = Math.max(...d.dow.values);
          const ratio = v / max;
          return `rgba(123,97,255,${0.3 + ratio * 0.7})`;
        }),
      },
    }], { ...PLOTLY_LAYOUT }, PLOTLY_CONFIG);
  }

  // Year-over-year
  if (d.yearly) {
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const colors = ['#00e5ff','#7b61ff','#00ff9d','#ffcc00','#ff6b6b'];
    const traces = Object.entries(d.yearly.series).map(([yr, vals], i) => ({
      x: monthNames, y: vals,
      type: 'scatter', mode: 'lines+markers',
      name: yr,
      line: { color: colors[i % colors.length], width: 2 },
      marker: { size: 5 },
    }));
    Plotly.newPlot('viz-yearly', traces, { ...PLOTLY_LAYOUT }, PLOTLY_CONFIG);
  }

  // Rolling average
  if (d.trend) {
    const raw  = d.trend.y;
    const win  = 30;
    const roll = raw.map((_, i) => {
      const sl = raw.slice(Math.max(0, i - win + 1), i + 1);
      return sl.reduce((a, b) => a + b, 0) / sl.length;
    });
    Plotly.newPlot('viz-rolling', [
      { x: d.trend.x, y: raw, type: 'scatter', mode: 'lines', name: 'Actual', line: { color: 'rgba(0,229,255,0.35)', width: 1 } },
      { x: d.trend.x, y: roll, type: 'scatter', mode: 'lines', name: '30-day MA', line: { color: '#00e5ff', width: 2.5 } },
    ], { ...PLOTLY_LAYOUT }, PLOTLY_CONFIG);
  }
}

/* ─── FORECAST ───────────────────────────────────────────────────────────── */
document.querySelectorAll('.model-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.model-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.selectedModel = btn.dataset.model;
  });
});
document.querySelectorAll('.horizon-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.horizon-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.selectedHorizon = +btn.dataset.days;
  });
});

function runForecast() {
  if (!state.colMap.date && !state.vizData) { alert('Upload data first!'); return; }
  showLoader(`Running ${state.selectedModel.toUpperCase()} model for ${state.selectedHorizon} days…`);
  fetch('/api/forecast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: state.selectedModel, horizon: state.selectedHorizon }),
  }).then(r => r.json()).then(data => {
    hideLoader();
    if (data.error) { alert('Forecast error: ' + data.error); return; }
    renderForecast(data);
  }).catch(e => { hideLoader(); alert(e); });
}

function renderForecast(data) {
  // KPI cards
  const kpi = data.kpi || {};
  const growth = kpi.growth_pct || 0;
  const fg = document.getElementById('forecast-kpi-grid');
  fg.innerHTML = [
    { icon: '📅', label: 'NEXT 7 DAYS', val: fmt(kpi.next7_total), sub: 'total forecast', cls: 'accent1' },
    { icon: '📆', label: 'NEXT 30 DAYS', val: fmt(kpi.next30_total), sub: 'total forecast', cls: 'accent2' },
    { icon: '📈', label: 'GROWTH', val: (growth >= 0 ? '+' : '') + growth + '%', sub: 'vs historical avg', cls: growth >= 0 ? 'accent3' : 'accent5' },
    { icon: '〰', label: 'HIST. AVG', val: fmt(kpi.hist_mean), sub: 'per period', cls: 'accent4' },
    { icon: '⟡', label: 'FC AVG', val: fmt(kpi.fc_mean), sub: 'per period', cls: 'accent2' },
  ].map(c =>
    `<div class="kpi-card ${c.cls}">
      <div class="kpi-icon">${c.icon}</div>
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-val">${c.val}</div>
      <div class="kpi-sub">${c.sub}</div>
    </div>`
  ).join('');

  // Chart
  const wrap = document.getElementById('forecast-chart-wrap');
  wrap.style.display = 'block';
  document.getElementById('model-badge').textContent = data.model.toUpperCase();

  const traces = [
    {
      x: data.hist_x, y: data.hist_y,
      type: 'scatter', mode: 'lines',
      name: 'Historical', line: { color: '#00e5ff', width: 1.5 },
    },
    {
      x: data.forecast_x, y: data.forecast_y,
      type: 'scatter', mode: 'lines',
      name: 'Forecast', line: { color: '#7b61ff', width: 2.5, dash: 'dot' },
    },
    {
      x: [...data.forecast_x, ...data.forecast_x.slice().reverse()],
      y: [...data.upper_y, ...data.lower_y.slice().reverse()],
      type: 'scatter', fill: 'toself',
      fillcolor: 'rgba(123,97,255,0.12)',
      line: { color: 'transparent' },
      name: '95% CI', showlegend: true,
    },
  ];

  Plotly.newPlot('forecast-chart', traces, {
    ...PLOTLY_LAYOUT,
    margin: { t: 10, b: 60, l: 70, r: 30 },
    shapes: [{
      type: 'line',
      x0: data.hist_x.at(-1), x1: data.hist_x.at(-1),
      y0: 0, y1: 1, yref: 'paper',
      line: { color: '#6b7690', dash: 'dash', width: 1 },
    }],
  }, PLOTLY_CONFIG);

  // Table
  const tw = document.getElementById('forecast-table-wrap');
  tw.classList.remove('hidden');
  const ft = document.getElementById('forecast-table');
  ft.innerHTML = `<thead><tr><th>#</th><th>Date</th><th>Forecast</th><th>Lower</th><th>Upper</th></tr></thead>
    <tbody>${data.forecast_x.slice(0, 30).map((d, i) =>
      `<tr>
        <td>${i+1}</td>
        <td>${d}</td>
        <td><b>${fmt(data.forecast_y[i])}</b></td>
        <td>${fmt(data.lower_y[i])}</td>
        <td>${fmt(data.upper_y[i])}</td>
      </tr>`
    ).join('')}</tbody>`;
}

/* ─── HELPERS ────────────────────────────────────────────────────────────── */
function fmt(v) {
  if (v == null || isNaN(v)) return '—';
  const n = Number(v);
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n % 1 === 0 ? n.toLocaleString() : n.toFixed(2);
}

function showLoader(msg) {
  document.getElementById('loader-msg').textContent = msg || 'Processing…';
  document.getElementById('loader').classList.remove('hidden');
}
function hideLoader() {
  document.getElementById('loader').classList.add('hidden');
}
function setStatus(active, msg) {
  document.getElementById('status-dot').classList.toggle('active', active);
  document.getElementById('status-text').textContent = msg;
}
