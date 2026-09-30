const $ = (s) => document.querySelector(s);
const csrf = document.querySelector('meta[name="csrf-token"]').content;
const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const fdate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('fr-FR');
const KIND_LABEL = { contrat: 'Contrat', aem: 'AEM', bulletin: 'Bulletin' };
const dialog = $('#contract-dialog');
const form = $('#contract-form');
let contracts = [];
let employers = [];
let editingDocs = [];

async function api(path, method = 'GET', body) {
  const headers = { 'X-CSRF-Token': csrf };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(path, { method, headers, body: payload });
  if (res.status === 401) { location.href = '/login'; return; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erreur');
  return data;
}

function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;   // jamais d'innerHTML
  if (cls) n.className = cls;
  return n;
}

/* ---------- Tableau ---------- */
function render() {
  const tbody = $('#rows');
  tbody.replaceChildren();
  $('#empty').hidden = contracts.length > 0;
  for (const c of contracts) {
    const tr = document.createElement('tr');
    const mission = el('td', c.mission);
    if (c.comment) mission.append(el('div', c.comment, 'comment'));
    tr.append(
      el('td', c.employer), mission,
      el('td', `${fdate(c.start_date)} → ${fdate(c.end_date)}`),
      el('td', c.hours, 'num'), el('td', eur.format(c.gross), 'num'),
      el('td', eur.format(c.net), 'num'),
      el('td', c.documents.length ? `📎 ${c.documents.length}` : '–'));
    const actions = el('td');
    const edit = el('button', 'Modifier', 'ghost');
    edit.onclick = () => openDialog(c);
    const del = el('button', 'Supprimer', 'ghost danger');
    del.onclick = async () => {
      if (!confirm(`Supprimer « ${c.mission} » et ses documents ?`)) return;
      await api(`/api/contracts/${c.id}`, 'DELETE');
      load();
    };
    actions.append(edit, del);
    tr.append(actions);
    tbody.append(tr);
  }
}

async function loadSummary() {
  const s = await api('/api/summary');
  $('#bar').style.width = Math.min(100, (s.hours / s.target) * 100) + '%';
  $('#hours').textContent = s.hours;
  $('#range').textContent = ` (du ${fdate(s.window_start)} au ${fdate(s.window_end)})`;
  const left = Math.max(0, s.target - s.hours);
  $('#remaining').textContent = left > 0 ? `Il te manque ${left} h.` : 'Seuil des 507 h atteint 🎉';
}

async function load() {
  [contracts, employers] = await Promise.all([api('/api/contracts'), api('/api/employers')]);
  render();
  renderEmployers();
  loadSummary();
}

/* ---------- Employeurs ---------- */
function renderEmployers() {
  const dl = $('#employers');
  dl.replaceChildren(...employers.map((e) => { const o = document.createElement('option'); o.value = e; return o; }));
  const chips = $('#employer-chips');
  chips.replaceChildren(...employers.slice(0, 6).map((e) => {
    const b = el('button', e, 'chip');
    b.type = 'button';
    b.onclick = () => { form.elements.employer.value = e; form.elements.mission.focus(); };
    return b;
  }));
}

/* ---------- Documents existants ---------- */
function renderDocs() {
  const ul = $('#existing-docs');
  ul.replaceChildren();
  for (const d of editingDocs) {
    const li = document.createElement('li');
    const a = el('a', `${KIND_LABEL[d.kind]} – ${d.name}`);
    a.href = `/api/documents/${d.id}`;
    const del = el('button', 'Retirer', 'ghost danger');
    del.type = 'button';
    del.onclick = async () => {
      if (!confirm('Supprimer ce document ?')) return;
      await api(`/api/documents/${d.id}`, 'DELETE');
      editingDocs = editingDocs.filter((x) => x.id !== d.id);
      renderDocs();
      load();
    };
    li.append(a, del);
    ul.append(li);
  }
}

/* ---------- Modal ---------- */
function openDialog(c) {
  form.reset();
  $('#form-error').textContent = '';
  form.elements.id.value = c ? c.id : '';
  if (c) for (const k of ['employer', 'mission', 'hours', 'start_date', 'end_date', 'gross', 'net', 'comment'])
    form.elements[k].value = c[k];
  editingDocs = c ? [...c.documents] : [];
  renderDocs();
  $('#form-title').textContent = c ? 'Modifier le contrat' : 'Ajouter un contrat';
  dialog.showModal();
}
const closeDialog = () => dialog.close();
$('#add-btn').onclick = () => openDialog(null);
$('#cancel').onclick = closeDialog;
$('#close-dialog').onclick = closeDialog;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#form-error');
  err.textContent = '';
  const f = new FormData(form);
  const payload = Object.fromEntries(['employer', 'mission', 'hours', 'start_date', 'end_date', 'gross', 'net', 'comment']
    .map((k) => [k, f.get(k)]));
  const files = ['contrat', 'aem', 'bulletin']
    .map((k) => [k, f.get('file_' + k)]).filter(([, file]) => file && file.size > 0);
  for (const [, file] of files) {
    if (file.size > 10 * 1024 * 1024) { err.textContent = `${file.name} dépasse 10 Mo`; return; }
  }
  $('#save-btn').disabled = true;
  let id = f.get('id');
  try {
    if (id) await api(`/api/contracts/${id}`, 'PUT', payload);
    else { id = (await api('/api/contracts', 'POST', payload)).id; form.elements.id.value = id; }
    for (const [kind, file] of files) {
      const fd = new FormData();
      fd.append('kind', kind);
      fd.append('file', file);
      await api(`/api/contracts/${id}/documents`, 'POST', fd);
      form.elements['file_' + kind].value = '';
    }
    dialog.close();
    load();
  } catch (ex) {
    err.textContent = ex.message;   // le contrat reste en mode édition : pas de doublon au nouvel essai
    load();
  } finally {
    $('#save-btn').disabled = false;
  }
});

$('#logout').onclick = async () => { await api('/api/logout', 'POST'); location.href = '/login'; };
load();