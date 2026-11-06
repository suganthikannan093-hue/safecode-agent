const $ = s => document.querySelector(s);
let draft = null; let upload = null; let activeRun = null; let eventSource = null;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function status() {
  const s = await api('/api/status');
  $('#privacy').textContent = `Retention: ${s.retentionHours}h. Receipts: ${s.signedReceipts ? 'signed' : 'unsigned'}. Model output sharing: ${s.modelOutputSharing ? 'enabled (retries and explanations)' : 'disabled (live retries/explanations unavailable)'}.`;
  renderControls(s.controls);
  $('#sbx').textContent = '🛡 ' + s.sandbox.label; $('#sbx').className = 'pill ' + (s.sandbox.production ? 'prod' : 'demo');
  $('#llm').textContent = '🧠 ' + s.llm.label + ' · ' + s.llm.model;
  $('#examples').innerHTML = s.examples.map(e => `<button data-t="${esc(e)}">${esc(e)}</button>`).join('');
  $('#healdemo').innerHTML = `<button data-t="${esc(s.healDemo.task)}">${esc(s.healDemo.title)}</button>`;
  $('#demos').innerHTML = s.demos.map(d => `<button data-t="${esc(d.task)}">${esc(d.title)}</button>`).join('');
  document.querySelectorAll('.chips button').forEach(b => b.onclick = () => { $('#task').value = b.dataset.t; generate(); });
  renderLimits([{ label: 'Limits load after first run', active: false }]);
}
function renderLimits(ls) { $('#limits').innerHTML = ls.map(l => `<li class="${l.triggered ? 'trig' : l.active === false ? 'off' : ''}">${esc(l.label)}${l.triggered ? ` — ${esc(l.evidence)}` : ""}</li>`).join(''); }
function renderPolicy(p) {
  $('#policy').innerHTML = p.findings.length ? p.findings.map(f => `<div class="finding ${f.severity}">⚠ Policy scan: ${esc(f.label)} (${f.severity}) — flagged, will still run inside the sandbox</div>`).join('') : '<div class="finding ok">✓ Policy scan: no dangerous patterns</div>';
}
async function generate() {
  const task = $('#task').value.trim(); if (!task) return;
  $('#gen').disabled = true; $('#gen').textContent = 'Generating…'; $('#run').disabled = true;
  try {
    const r = await fetch('/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task, fileId: upload?.fileId }) });
    const g = await r.json(); if (!r.ok) throw new Error(g.error);
    draft = g; $('#code').value = g.code;
    $('#genmeta').textContent = `${g.language} · by ${g.provider} (${g.model}) — ${g.explanation || ''}`;
    renderPolicy(g.policy); $('#run').disabled = false;
  } catch (e) { $('#genmeta').textContent = 'Error: ' + e.message; }
  $('#gen').disabled = false; $('#gen').textContent = 'Generate code'; refresh();
}
async function run() {
  if (!draft) return; $('#run').disabled = true;
  $('#out').innerHTML = ''; $('#explain').textContent = ''; $('#stats').innerHTML = ''; $('#timeline').innerHTML = ''; $('#artifacts').innerHTML = ''; $('#receipt').innerHTML = '';
  $('#badge').className = 'badge run'; $('#badge').textContent = '⏳ Running in a fresh sandbox…';
  try {
  const r = await fetch('/api/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: draft.id, code: $('#code').value, language: draft.language, heal: $('#heal').checked }) });
  if (!r.ok) throw new Error((await r.json()).error);
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line) onEvent(JSON.parse(line)); } }
  } catch (e) { $('#badge').textContent = 'Run failed: ' + e.message; }
  finally { activeRun = null; $('#cancel').disabled = true; $('#run').disabled = false; refresh(); await controls(); }
}
const tl = (cls, html) => $('#timeline').insertAdjacentHTML('beforeend', `<li class="${cls}">${html}</li>`);
function onEvent(e) {
  if (e.type === 'start') { activeRun = e.id; $('#cancel').disabled = false; }
  if (e.type === 'attempt') { if (e.n > 1) { $('#code').value = e.code; $('#out').insertAdjacentHTML('beforeend', `\n<span class="e">──── attempt ${e.n}: fresh sandbox ────</span>\n`); }
    tl('', `#${e.n} ▶ ${esc(e.by)}${e.fixNote ? ' — ' + esc(e.fixNote) : ''}`); $('#badge').textContent = `⏳ Attempt ${e.n}: running in a fresh sandbox…`; }
  if (e.type === 'attempt.result') tl(e.contained ? 'cont' : e.exitCode === 0 ? 'ok' : 'fail', `#${e.n} ${e.contained ? '⛨ containment signal' : e.exitCode === 0 ? '✓ exit 0' : '✗ exit ' + e.exitCode} · ${e.durationMs} ms · ${esc(e.sandboxId)} · cleanup ${esc(e.cleanup)}${e.exitCode && !e.contained ? '<br><code>' + esc(e.stderrTail.trim().split('\n').at(-1)) + '</code>' : ''}`);
  if (e.type === 'healing') { tl('heal', `🩹 Sending stderr to the model for a fix…`); $('#badge').textContent = '🩹 Self-healing…'; }
  if (e.type === 'heal.error') tl('fail', 'Fix failed: ' + esc(e.error));
  if (e.type === 'chunk') { $('#out').insertAdjacentHTML('beforeend', e.stream === 'stderr' ? `<span class="e">${esc(e.data)}</span>` : esc(e.data)); $('#out').scrollTop = 1e9; }
  if (e.type === 'error') { $('#badge').className = 'badge contained'; $('#badge').textContent = 'Error: ' + e.error; }
  if (e.type === 'result') {
    const trig = e.limits.filter(l => l.triggered);
    $('#badge').className = 'badge ' + (e.contained ? 'contained' : 'ok');
    $('#badge').textContent = e.contained ? `⛨ Containment signals: ${trig.map(l => l.id).join(', ')}` : e.exitCode === 0 ? (e.healed ? `🩹 Self-healed in ${e.attempts} attempts ✓` : `✓ Completed (exit ${e.exitCode}); correctness not independently checked`) : `✗ Failed after ${e.attempts} attempt(s) (exit ${e.exitCode})`;
    if (e.cancelled) $('#badge').textContent = 'Execution cancelled by operator';
    if (!e.contained && e.exitCode) $('#badge').className = 'badge contained';
    $('#artifacts').innerHTML = (e.artifacts || []).map(a => `<img alt="${esc(a.name)}" src="${a.dataUrl}"><div class="meta">${esc(a.name)} · ${a.bytes} B · sha256 ${a.sha256.slice(0, 16)}…</div>`).join('') +
      (e.verified ? `<table class="vtable"><tr><th colspan="2">Program-reported results (not independently verified)</th></tr>${flat(e.verified).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>` : '');
    $('#receipt').innerHTML = `🧾 Execution receipt: <a href="${e.receipt.html}" target="_blank">view</a><a href="${e.receipt.html}?download">download HTML</a><a href="${e.receipt.json}?download">download JSON</a>`;
    $('#stats').innerHTML = [['exit code', e.exitCode], ['duration', e.durationMs + ' ms'], ['mem cap', e.resources.memoryMb + ' MB'], ['output', e.resources.outputBytes + ' B']].map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');
    renderLimits(e.limits); $('#explain').textContent = '🧠 ' + (e.explanation || '') + (e.mode.production ? '' : '  [local demo sandbox, not production]');
  }
}
async function refresh() {
  const [h, a] = await Promise.all([fetch('/api/history').then(r => r.json()), fetch('/api/audit').then(r => r.json())]);
  $('#history').innerHTML = h.map(x => `<li><span class="t">${x.ts.slice(11, 19)}</span> ${esc(x.task.slice(0, 60))}<span class="tag ${x.contained ? 'c' : 'o'}">${x.contained ? 'contained: ' + x.triggered.join(',') : 'exit ' + x.exitCode}</span></li>`).join('') || '<li class="t">No runs yet</li>';
  $('#audit').innerHTML = a.slice(0, 40).map(x => `<li><span class="t">${x.ts.slice(11, 19)}</span> ${esc(x.event)} ${esc(x.flags ? 'flags=' + x.flags.join(',') : x.model || x.environment || '')}</li>`).join('');
}
$('#gen').onclick = generate; $('#run').onclick = run;

const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => v && typeof v === 'object' ? flat(v, p + k + '.') : [[p + k, typeof v === 'number' ? +v.toFixed(4) : v]]);
$('#csv').onchange = async ev => {
  const f = ev.target.files[0]; if (!f) return;
  if (f.size > 1024 * 1024) { $('#csvinfo').textContent = 'File too large (max 1 MB)'; return; }
  const r = await fetch('/api/upload?name=' + encodeURIComponent(f.name), { method: 'POST', headers: { 'content-type': 'text/csv' }, body: f });
  const j = await r.json(); if (!r.ok) { $('#csvinfo').textContent = 'Upload failed: ' + j.error; upload = null; return; }
  upload = j; $('#csvinfo').innerHTML = `✓ ${esc(j.name)} · ${j.bytes} B · sha256 ${j.sha256.slice(0, 12)}… <button id="clearcsv" class="x">✕</button>`;
  $('#clearcsv').onclick = () => { upload = null; $('#csv').value = ''; $('#csvinfo').textContent = 'optional · mounted read-only at /work/input · max 1 MB'; };
  if (!$('#task').value.trim()) $('#task').value = 'Summarise this CSV: total of the main numeric column per category, and draw a bar chart';
};
function renderDash(s) {
  const k = [['runs', s.runs], ['success', s.success], ['failed', s.failed], ['signals', s.contained], ['self-healed', s.healed], ['avg sandbox life', s.avgSandboxLifetimeMs + ' ms']];
  $('#dgrid').innerHTML = k.map(([a, b]) => `<div><b>${b}</b><span>${a}</span></div>`).join('');
  const mx = Math.max(1, ...Object.values(s.attacks));
  $('#attacks').innerHTML = Object.entries(s.attacks).map(([a, n]) => `<div><span>${a}</span><i style="width:${n / mx * 120}px"></i>${n}</div>`).join('');
  $('#recent').innerHTML = s.recent.slice(0, 10).map(x => `<li><span class="t">${x.ts.slice(11, 19)}</span> ${x.contained ? '⛨ ' + esc(x.triggered.join(',')) : x.exitCode === 0 ? (x.healed ? '🩹 healed' : '✓ ok') : '✗ exit ' + x.exitCode} · ${esc(x.sandboxId)} · ${esc(x.task.slice(0, 40))}</li>`).join('') || '<li class="t">No runs yet</li>';
}
function live() {
  eventSource?.close(); const es = eventSource = new EventSource('/api/events');
  es.addEventListener('stats', m => renderDash(JSON.parse(m.data)));
  es.addEventListener('audit', () => refresh());
  es.onopen = () => $('#live').className = ''; es.onerror = () => { $('#live').className = 'off'; };
}
async function api(path, options = {}) {
  const res = await fetch(path, options); const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`); return data;
}
const post = (path, data) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
function renderControls(s) { $('#budgets').textContent = `${s.paused ? 'PAUSED' : 'Ready'} · ${s.active.length}/${s.maxConcurrent} active\nAttempts today: ${s.attempts}/${s.maxAttempts}\nModel requests today: ${s.modelCalls}/${s.maxModelCalls}`; }
async function controls() { try { renderControls(await api('/api/controls')); } catch (e) { $('#control-message').textContent = e.message; } }
async function action(fn) { try { await fn(); $('#control-message').textContent = 'Done'; await controls(); } catch (e) { $('#control-message').textContent = e.message; } }
$('#cancel').onclick = () => action(() => post('/api/cancel', { id: activeRun }));
$('#pause').onclick = () => action(() => post('/api/controls', { paused: true }));
$('#resume').onclick = () => action(() => post('/api/controls', { paused: false }));
$('#delete-data').onclick = () => action(async () => {
  if (!$('#delete-confirm').checked) throw new Error('Select the deletion checkbox first');
  await api('/api/data', { method: 'DELETE' }); draft = null; upload = null; $('#run').disabled = true; $('#delete-confirm').checked = false; await refresh();
});
$('#key').onclick = () => action(async () => {
  const { publicKey } = await api('/api/receipt-key'); if (!publicKey) throw new Error('Signing is not configured');
  const url = URL.createObjectURL(new Blob([publicKey], { type: 'text/plain' })); const a = document.createElement('a'); a.href = url; a.download = 'receipt-public.pem'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
async function boot() {
  const session = await api('/api/session'); $('#workspace').hidden = !session.authenticated; $('#login').hidden = session.authenticated;
  $('#logout').hidden = !session.accessRequired || !session.authenticated;
  $('#access-message').textContent = session.authenticated ? (session.accessRequired ? 'Dedicated workspace unlocked' : 'Local demo: authentication is not configured') : 'Enter the operator-provided token. Tokens are not stored in browser storage.';
  if (session.authenticated) { await status(); await refresh(); live(); }
}
$('#login').onsubmit = async e => { e.preventDefault(); try { await post('/api/session', { token: $('#token').value }); $('#token').value = ''; await boot(); } catch (e) { $('#access-message').textContent = e.message; } };
$('#logout').onclick = async () => { await api('/api/session', { method: 'DELETE' }); eventSource?.close(); location.reload(); };
boot().catch(e => { $('#access-message').textContent = e.message; });
