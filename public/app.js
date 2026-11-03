const $ = s => document.querySelector(s);
let draft = null;
const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
async function status() {
  const s = await (await fetch('/api/status')).json();
  $('#sbx').textContent = '🛡 ' + s.sandbox.label; $('#sbx').className = 'pill ' + (s.sandbox.production ? 'prod' : 'demo');
  $('#llm').textContent = '🧠 ' + s.llm.label + ' · ' + s.llm.model;
  $('#examples').innerHTML = s.examples.map(e => `<button data-t="${esc(e)}">${esc(e)}</button>`).join('');
  $('#demos').innerHTML = s.demos.map(d => `<button data-t="${esc(d.task)}">${esc(d.title)}</button>`).join('');
  document.querySelectorAll('.chips button').forEach(b => b.onclick = () => { $('#task').value = b.dataset.t; generate(); });
  renderLimits([{ label: 'Limits load after first run', active: false }]);
}
function renderLimits(ls) { $('#limits').innerHTML = ls.map(l => `<li class="${l.triggered ? 'trig' : l.active === false ? 'off' : ''}">${esc(l.label)}</li>`).join(''); }
function renderPolicy(p) {
  $('#policy').innerHTML = p.findings.length ? p.findings.map(f => `<div class="finding ${f.severity}">⚠ Policy scan: ${esc(f.label)} (${f.severity}) — flagged, will still run inside the sandbox</div>`).join('') : '<div class="finding ok">✓ Policy scan: no dangerous patterns</div>';
}
async function generate() {
  const task = $('#task').value.trim(); if (!task) return;
  $('#gen').disabled = true; $('#gen').textContent = 'Generating…'; $('#run').disabled = true;
  try {
    const r = await fetch('/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task }) });
    const g = await r.json(); if (!r.ok) throw new Error(g.error);
    draft = g; $('#code').value = g.code;
    $('#genmeta').textContent = `${g.language} · by ${g.provider} (${g.model}) — ${g.explanation || ''}`;
    renderPolicy(g.policy); $('#run').disabled = false;
  } catch (e) { $('#genmeta').textContent = 'Error: ' + e.message; }
  $('#gen').disabled = false; $('#gen').textContent = 'Generate code'; refresh();
}
async function run() {
  if (!draft) return; $('#run').disabled = true;
  $('#out').innerHTML = ''; $('#explain').textContent = ''; $('#stats').innerHTML = '';
  $('#badge').className = 'badge run'; $('#badge').textContent = '⏳ Running in a fresh sandbox…';
  const r = await fetch('/api/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: draft.id, code: $('#code').value, language: draft.language }) });
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line) onEvent(JSON.parse(line)); } }
  $('#run').disabled = false; refresh();
}
function onEvent(e) {
  if (e.type === 'chunk') { $('#out').insertAdjacentHTML('beforeend', e.stream === 'stderr' ? `<span class="e">${esc(e.data)}</span>` : esc(e.data)); $('#out').scrollTop = 1e9; }
  if (e.type === 'error') { $('#badge').className = 'badge contained'; $('#badge').textContent = 'Error: ' + e.error; }
  if (e.type === 'result') {
    const trig = e.limits.filter(l => l.triggered);
    $('#badge').className = 'badge ' + (e.contained ? 'contained' : 'ok');
    $('#badge').textContent = e.contained ? `⛨ CONTAINED — ${trig.map(l => l.id).join(', ')} absorbed it` : `✓ Completed safely (exit ${e.exitCode})`;
    $('#stats').innerHTML = [['exit code', e.exitCode], ['duration', e.durationMs + ' ms'], ['mem cap', e.resources.memoryMb + ' MB'], ['output', e.resources.outputBytes + ' B']].map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');
    renderLimits(e.limits); $('#explain').textContent = '🧠 ' + (e.explanation || '') + (e.mode.production ? '' : '  [local demo sandbox, not production]');
  }
}
async function refresh() {
  const [h, a] = await Promise.all([fetch('/api/history').then(r => r.json()), fetch('/api/audit').then(r => r.json())]);
  $('#history').innerHTML = h.map(x => `<li><span class="t">${x.ts.slice(11, 19)}</span> ${esc(x.task.slice(0, 60))}<span class="tag ${x.contained ? 'c' : 'o'}">${x.contained ? 'contained: ' + x.triggered.join(',') : 'exit ' + x.exitCode}</span></li>`).join('') || '<li class="t">No runs yet</li>';
  $('#audit').innerHTML = a.slice(0, 40).map(x => `<li><span class="t">${x.ts.slice(11, 19)}</span> ${esc(x.event)} ${esc(x.flags ? 'flags=' + x.flags.join(',') : x.model || x.environment || '')}</li>`).join('');
}
$('#gen').onclick = generate; $('#run').onclick = run; status(); refresh();
