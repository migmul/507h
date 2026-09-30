const $ = (s) => document.querySelector(s);
const csrf = document.querySelector('meta[name="csrf-token"]').content;
const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const fdate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('fr-FR');
const money = (v) => (v === null || v === undefined ? '–' : eur.format(v));
const KIND_LABEL = { contrat: 'Contrat', aem: 'AEM', bulletin: 'Bulletin' };
const dialog = $('#contract-dialog');
const form = $('#contract-form');
let contracts = [];
let employers = [];
let editingDocs = [];

const COLUMNS = [
  { key: 'employer', label: 'Employeur' },
  { key: 'mission', label: 'Mission' },
  { key: 'start_date', label: 'Début' },
  { key: 'end_date', label: 'Fin' },
  { key: 'hours', label: 'Heures', num: true },
  { key: 'gross', label: 'Brut', num: true },
  { key: 'net', label: 'Net', num: true },
  { key: 'docs', label: 'Docs', num: true, value: (c) => c.documents.length },
];
let sort = { key: 'end_date', dir: 'desc' };

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
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}

/* ---------- Tri ---------- */
const isEmpty = (v) => v === null || v === undefined || v === '';

function sortedContracts() {
  const col = COLUMNS.find((c) => c.key === sort.key);
  const get = col.value || ((c) => c[col.key]);
  const dir = sort.dir === 'asc' ? 1 : -1;
  return [...contracts].sort((a, b) => {
    const va = get(a), vb = get(b);
    if (isEmpty(va) && isEmpty(vb)) return b.id - a.id;
    if (isEmpty(va)) return 1;            // valeurs vides toujours en bas
    if (isEmpty(vb)) return -1;
    const r = col.num ? va - vb : String(va).localeCompare(String(vb), 'fr', { sensitivity: 'base' });
    return r * dir || b.id - a.id;
  });
}

function renderHead() {
  const row = $('#head-row');
  row.replaceChildren();
  for (const col of COLUMNS) {
    const th = document.createElement('th');
    if (col.num) th.className = 'num';
    const active = sort.key === col.key;
    th.setAttribute('aria-sort', active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    const btn = el('button', col.label, 'sort');
    btn.type = 'button';
    btn.append(el('span', active ? (sort.dir === 'asc' ? '▲' : '▼') : '', 'arrow'));
    btn.onclick = () => {
      sort = { key: col.key, dir: active && sort.dir === 'asc' ? 'desc' : 'asc' };
      renderHead();
      render();
    };
    th.append(btn);
    row.append(th);
  }
  row.append(document.createElement('th'));
}

/* ---------- Tableau ---------- */
function render() {
  const tbody = $('#rows');
  tbody.replaceChildren();
  $('#empty').hidden = contracts.length > 0;
  for (const c of sortedContracts()) {
    const tr = document.createElement('tr');
    const mission = el('td', c.mission || '–');
    if (c.comment) mission.append(el('div', c.comment, 'comment'));
    tr.append(
      el('td', c.employer), mission,
      el('td', fdate(c.start_date)), el('td', fdate(c.end_date)),
      el('td', c.hours, 'num'), el('td', money(c.gross), 'num'), el('td', money(c.net), 'num'),
      el('td', c.documents.length ? `📎 ${c.documents.length}` : '–', 'num'));
    const actions = el('td');
    const edit = el('button', 'Modifier', 'ghost');
    edit.onclick = () => openDialog(c);
    const del = el('button', 'Supprimer', 'ghost danger');
    del.onclick = async () => {
      if (!confirm(`Supprimer « ${c.mission || c.employer} » et ses documents ?`)) return;
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
  $('#employers').replaceChildren(...employers.map((e) => {
    const o = document.createElement('option'); o.value = e; return o;
  }));
  $('#employer-chips').replaceChildren(...employers.slice(0, 6).map((e) => {
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

/* ---------- Modale ---------- */
function openDialog(c) {
  form.reset();
  $('#form-error').textContent = '';
  form.elements.id.value = c ? c.id : '';
  if (c) for (const k of ['employer', 'mission', 'hours', 'start_date', 'end_date', 'gross', 'net', 'comment'])
    form.elements[k].value = c[k] ?? '';
  editingDocs = c ? [...c.documents] : [];
  renderDocs();
  $('#form-title').textContent = c ? 'Modifier le contrat' : 'Ajouter un contrat';
  dialog.showModal();
}
const closeDialog = () => dialog.close();
$('#add-btn').onclick = () => openDialog(null);
$('#cancel').onclick = closeDialog;
$('#close-dialog').onclick = closeDialog;

// Fermeture au clic sur le fond : le clic doit commencer ET finir sur le fond
// (évite de fermer lors d'une sélection de texte qui déborde de la modale).
let downOnBackdrop = false;
dialog.addEventListener('mousedown', (e) => { downOnBackdrop = e.target === dialog; });
dialog.addEventListener('click', (e) => {
  if (e.target === dialog && downOnBackdrop) closeDialog();
  downOnBackdrop = false;
});

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
    err.textContent = ex.message;
    load();
  } finally {
    $('#save-btn').disabled = false;
  }
});

$('#logout').onclick = async () => { await api('/api/logout', 'POST'); location.href = '/login'; };
renderHead();
load();