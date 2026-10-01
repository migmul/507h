const $ = (s) => document.querySelector(s);
const csrf = document.querySelector('meta[name="csrf-token"]').content;
const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const fdate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('fr-FR');
const fmonth = (m) => new Date(m + '-01T00:00:00').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
const fh = (h) => `${Math.round(h * 10) / 10} h`;
const money = (v) => (v == null ? '–' : eur.format(v));
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const TYPE = { first: 'Première ouverture', renewal: 'Renouvellement', anticipated: 'Demande anticipée' };
let state = { overview: null, rights: [], payments: [], totals: {} };

async function api(path, method = 'GET', body) {
  const headers = { 'X-CSRF-Token': csrf };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
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

function kv(ul, rows) {
  ul.replaceChildren(...rows.map(([k, v]) => {
    const li = document.createElement('li');
    li.append(el('span', k, 'k'), el('strong', v));
    return li;
  }));
}

function actions(onEdit, onDelete) {
  const td = el('td');
  const e = el('button', 'Modifier', 'ghost'); e.onclick = onEdit;
  const d = el('button', 'Supprimer', 'ghost danger'); d.onclick = onDelete;
  td.append(e, d);
  return td;
}

/* ---------- Rendu ---------- */
function renderCurrent(o) {
  $('#current').hidden = !o;
  $('#hours-card').hidden = !o;
  if (!o) return;
  $('#da-date').textContent = fdate(o.anniversary_date);
  const b = $('#da-status');
  b.className = 'badge ' + o.status;
  b.textContent = o.status === 'expired' ? 'Date anniversaire dépassée : ajoute ton nouveau droit'
    : o.status === 'soon' ? `Plus que ${o.days_left} jour(s) : prépare ton examen`
    : `${o.days_left} jours restants`;
  $('#elapsed-bar').style.width = o.elapsed_pct + '%';
  kv($('#current-detail'), [
    ["Type d'ouverture", TYPE[o.opening_type]],
    ['Annexe', String(o.annexe)],
    ['Fin de contrat retenue (FCT)', fdate(o.fct_date)],
    ["Début d'indemnisation", fdate(o.start_date)],
    ['Examen le', fdate(o.exam_date) + (o.anniversary_overridden ? ' (date anniversaire saisie)' : '')],
    ['Allocation journalière nette', money(o.aj_net)],
  ]);
  const p = o.projection;
  $('#proj-bar').style.width = Math.min(100, (p.hours_total / 507) * 100) + '%';
  $('#proj-hours').textContent = fh(p.hours_total);
  $('#proj-msg').textContent = p.hours_needed > 0 ? `· il manque ${fh(p.hours_needed)}` : '· seuil atteint 🎉';
  $('#early-msg').hidden = !p.can_request_early;
  kv($('#proj-detail'), [
    ['Heures comptées depuis', `${fdate(p.window_start)} (lendemain de la FCT)`],
    ['Heures réalisées', fh(p.hours_done)],
    ['Heures prévues (contrats à venir)', fh(p.hours_planned)],
    ['Rythme nécessaire', p.per_week ? `${fh(p.per_week)} / semaine` : '–'],
  ]);
}

function renderRights(list) {
  const tbody = $('#rights-rows');
  tbody.replaceChildren();
  $('#rights-empty').hidden = list.length > 0;
  list.forEach((r, i) => {
    const tr = document.createElement('tr');
    if (i === 0) tr.className = 'current-row';
    const end = fdate(r.end_date) + (r.ended_early ? ' (remplacé avant terme)' : '');
    tr.append(el('td', fdate(r.start_date)), el('td', fdate(r.fct_date)),
      el('td', fdate(r.anniversary_date)), el('td', end), el('td', TYPE[r.opening_type]),
      el('td', String(r.annexe)), el('td', money(r.aj_net), 'num'),
      el('td', r.ref_hours ? fh(r.ref_hours) : '–', 'num'),
      actions(() => openRight(r), async () => {
        if (!confirm('Supprimer ce droit de l\'historique ?')) return;
        await api(`/api/rights/${r.id}`, 'DELETE');
        load();
      }));
    tbody.append(tr);
  });
}

function renderPayments(list, totals) {
  const tbody = $('#pay-rows');
  tbody.replaceChildren();
  $('#pay-empty').hidden = list.length > 0;
  $('#totals').textContent = list.length
    ? `Perçu sur les 12 derniers mois : ${eur.format(totals.last12)}` +
      (totals.since_right != null ? ` · depuis le début du droit en cours : ${eur.format(totals.since_right)}` : '')
    : '';
  for (const p of list) {
    const tr = document.createElement('tr');
    tr.append(el('td', fdate(p.paid_on)), el('td', fmonth(p.month_covered)),
      el('td', p.days_paid ?? '–', 'num'), el('td', eur.format(p.amount), 'num'),
      el('td', p.note || '', 'comment'),
      actions(() => openPayment(p), async () => {
        if (!confirm('Supprimer ce virement ?')) return;
        await api(`/api/payments/${p.id}`, 'DELETE');
        load();
      }));
    tbody.append(tr);
  }
}

async function load() {
  state = await api('/api/intermittence');
  renderCurrent(state.overview);
  renderRights(state.rights);
  renderPayments(state.payments, state.totals);
}

/* ---------- Modales ---------- */
function setupDialog(dialog) {
  dialog.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => dialog.close(); });
  let down = false;
  dialog.addEventListener('mousedown', (e) => { down = e.target === dialog; });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog && down) dialog.close();
    down = false;
  });
}

function openDialog(dialog, form, title, values) {
  form.reset();
  form.querySelector('[data-error]').textContent = '';
  form.elements.id.value = values?.id ?? '';
  for (const [k, v] of Object.entries(values || {})) {
    if (k !== 'id' && form.elements[k]) form.elements[k].value = v ?? '';
  }
  dialog.querySelector('h2').textContent = title;
  dialog.showModal();
}

function bindForm(dialog, form, base, toPayload) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const id = f.id; delete f.id;
    try {
      await api(id ? `${base}/${id}` : base, id ? 'PUT' : 'POST', toPayload ? toPayload(f) : f);
      dialog.close();
      load();
    } catch (ex) {
      form.querySelector('[data-error]').textContent = ex.message;
    }
  });
}

const rightDialog = $('#right-dialog'), rightForm = $('#right-form');
const payDialog = $('#payment-dialog'), payForm = $('#payment-form');
setupDialog(rightDialog);
setupDialog(payDialog);
bindForm(rightDialog, rightForm, '/api/rights');
bindForm(payDialog, payForm, '/api/payments');

function openRight(r) {
  openDialog(rightDialog, rightForm, r ? 'Modifier le droit' : 'Ajouter un droit', r && {
    id: r.id, annexe: r.annexe, opening_type: r.opening_type, fct_date: r.fct_date,
    start_date: r.start_date, anniversary_date: r.anniversary_input, aj_net: r.aj_net, note: r.note,
  });
}
function openPayment(p) {
  openDialog(payDialog, payForm, p ? 'Modifier le virement' : 'Ajouter un virement',
    p ? { id: p.id, paid_on: p.paid_on, amount: p.amount, month_covered: p.month_covered,
          days_paid: p.days_paid, note: p.note } : { paid_on: today() });
}

$('#add-right').onclick = () => openRight(null);
$('#add-payment').onclick = () => openPayment(null);
$('#edit-current').onclick = () => {
  const r = state.rights.find((x) => x.id === state.overview.right_id);
  if (r) openRight(r);
};
$('#logout').onclick = async () => { await api('/api/logout', 'POST'); location.href = '/login'; };
load();