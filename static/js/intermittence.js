const $ = (s) => document.querySelector(s);
const csrf = document.querySelector('meta[name="csrf-token"]').content;
const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const fdate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('fr-FR');
const fmonth = (m) => new Date(m + '-01T00:00:00').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const fh = (h) => (h == null ? '–' : `${nf1.format(h)} h`);
const money = (v) => (v == null ? '–' : eur.format(v));
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const TYPE = { first: 'Première ouverture', renewal: 'Renouvellement', anticipated: 'Demande anticipée' };
const LIMIT = { rights: 3, payments: 6 };
const showAll = { rights: false, payments: false };
let state = { overview: null, rights: [], payments: [], totals: {} };

async function api(path, method = 'GET', body) {
    const headers = { 'X-CSRF-Token': csrf };
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 401) {
        location.href = '/login';
        return;
    }
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

function editCell(onEdit) {
    const td = el('td');
    const b = el('button', 'Modifier', 'ghost');
    b.onclick = onEdit;
    td.append(b);
    return td;
}

function moreButton(btn, key, total) {
    btn.hidden = total <= LIMIT[key];
    btn.textContent = showAll[key] ? 'Réduire' : `Afficher tout (${total})`;
}

/* ---------- Droit en cours ---------- */
function renderCurrent(o) {
    $('#current').hidden = !o;
    if (!o) return;

    $('#da-date').textContent = fdate(o.anniversary_date);
    const badge = $('#da-status');
    badge.className = 'badge ' + o.status;
    badge.textContent = o.status === 'expired' ? 'Date dépassée : ajoute ton nouveau droit'
        : o.status === 'soon' ? `Plus que ${o.days_left} jour(s)`
        : `${o.days_left} jours restants`;

    const p = o.projection;
    $('#proj-bar').style.width = Math.min(100, (p.hours_total / 507) * 100) + '%';
    $('#proj-hours').textContent = nf1.format(p.hours_total);
    $('#proj-msg').textContent = p.hours_needed > 0
        ? `Il manque ${fh(p.hours_needed)}` + (p.per_week ? ` · ${fh(p.per_week)} par semaine d'ici l'examen` : '')
        : 'Seuil atteint';
    $('#early-msg').hidden = !p.can_request_early;

    kv($('#current-detail'), [
        ["Type d'ouverture", TYPE[o.opening_type]],
        ['Annexe', String(o.annexe)],
        ['Fin de contrat retenue (FCT)', fdate(o.fct_date)],
        ["Début d'indemnisation", fdate(o.start_date)],
        ['Examen le', fdate(o.exam_date) + (o.anniversary_overridden ? ' (date anniversaire saisie)' : '')],
        ['Allocation journalière nette', money(o.aj_net)],
        ['Heures comptées depuis', fdate(p.window_start)],
        ['Heures réalisées', fh(p.hours_done)],
        ['Heures prévues (contrats à venir)', fh(p.hours_planned)],
    ]);
}

function tappable(tr, onEdit) {
    tr.classList.add('tappable');
    tr.addEventListener('click', (e) => {
        if (!e.target.closest('button')) onEdit();
    });
}

/* ---------- Historique des droits ---------- */
function renderRights(list) {
    const tbody = $('#rights-rows');
    tbody.replaceChildren();
    $('#rights-empty').hidden = list.length > 0;
    const shown = showAll.rights ? list : list.slice(0, LIMIT.rights);
    shown.forEach((r, i) => {
        const tr = document.createElement('tr');
        if (i === 0) tr.classList.add('current-row');
        const period = el('td', `${fdate(r.start_date)} → ${fdate(r.end_date)}`);
        if (r.ended_early) {
            const tag = el('span', 'remplacé', 'tag');
            tag.title = 'Remplacé avant terme par un réexamen anticipé';
            period.append(tag);
        }
        period.append(el('span', `FCT ${fdate(r.fct_date)}`, 'sub'));
        tr.append(
            period,
            el('td', TYPE[r.opening_type]),
            el('td', money(r.aj_net), 'num'),
            el('td', r.ref_hours ? fh(r.ref_hours) : '–', 'num'),
            editCell(() => openRight(r)));
        tappable(tr, () => openRight(r));
        tbody.append(tr);
    });
    moreButton($('#rights-more'), 'rights', list.length);
}

/* ---------- Virements ---------- */
function renderPayments(list, totals) {
    const tbody = $('#pay-rows');
    tbody.replaceChildren();
    $('#pay-empty').hidden = list.length > 0;
    $('#totals').textContent = list.length
        ? `12 derniers mois : ${eur.format(totals.last12)}` +
          (totals.since_right != null ? ` · depuis le début du droit : ${eur.format(totals.since_right)}` : '')
        : '';
    const shown = showAll.payments ? list : list.slice(0, LIMIT.payments);
    for (const p of shown) {
        const tr = document.createElement('tr');
        const meta = [p.days_paid != null ? `${p.days_paid} j` : '', p.note].filter(Boolean).join(' · ');
        const month = el('td', fmonth(p.month_covered));
        const sub = el('span', undefined, 'sub');
        // La date de versement n'apparaît dans cette cellule que sur mobile
        sub.append(el('span', `Versé le ${fdate(p.paid_on)}${meta ? ' · ' : ''}`, 'mobile-inline'));
        if (meta) sub.append(el('span', meta));
        month.append(sub);
        tr.append(
            month,
            el('td', fdate(p.paid_on)),
            el('td', eur.format(p.amount), 'num'),
            editCell(() => openPayment(p)));
        tappable(tr, () => openPayment(p));
        tbody.append(tr);
    }
    moreButton($('#pay-more'), 'payments', list.length);
}

async function load() {
    state = await api('/api/intermittence');
    renderCurrent(state.overview);
    renderRights(state.rights);
    renderPayments(state.payments, state.totals);
}

$('#rights-more').onclick = () => {
    showAll.rights = !showAll.rights;
    renderRights(state.rights);
};
$('#pay-more').onclick = () => {
    showAll.payments = !showAll.payments;
    renderPayments(state.payments, state.totals);
};

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

function bindForm(dialog, form, base) {
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(form));
        const id = f.id;
        delete f.id;
        try {
            await api(id ? `${base}/${id}` : base, id ? 'PUT' : 'POST', f);
            dialog.close();
            load();
        } catch (ex) {
            form.querySelector('[data-error]').textContent = ex.message;
        }
    });
}

function bindDelete(button, dialog, form, base, question) {
    button.onclick = async () => {
        const id = form.elements.id.value;
        if (!id || !confirm(question)) return;
        await api(`${base}/${id}`, 'DELETE');
        dialog.close();
        load();
    };
}

const rightDialog = $('#right-dialog');
const rightForm = $('#right-form');
const payDialog = $('#payment-dialog');
const payForm = $('#payment-form');
setupDialog(rightDialog);
setupDialog(payDialog);
bindForm(rightDialog, rightForm, '/api/rights');
bindForm(payDialog, payForm, '/api/payments');
bindDelete($('#right-delete'), rightDialog, rightForm, '/api/rights', "Supprimer ce droit de l'historique ?");
bindDelete($('#pay-delete'), payDialog, payForm, '/api/payments', 'Supprimer ce virement ?');

function openRight(r) {
    openDialog(rightDialog, rightForm, r ? 'Modifier le droit' : 'Ajouter un droit', r && {
        id: r.id, annexe: r.annexe, opening_type: r.opening_type, fct_date: r.fct_date,
        start_date: r.start_date, anniversary_date: r.anniversary_input, aj_net: r.aj_net, note: r.note,
    });
    $('#right-delete').hidden = !r;
}

function openPayment(p) {
    openDialog(payDialog, payForm, p ? 'Modifier le virement' : 'Ajouter un virement',
        p ? {
            id: p.id, paid_on: p.paid_on, amount: p.amount, month_covered: p.month_covered,
            days_paid: p.days_paid, note: p.note,
        } : { paid_on: today() });
    $('#pay-delete').hidden = !p;
}

$('#add-right').onclick = () => openRight(null);
$('#add-payment').onclick = () => openPayment(null);
$('#edit-current').onclick = () => {
    const r = state.rights.find((x) => x.id === state.overview.right_id);
    if (r) openRight(r);
};

load().finally(() => Boot.ready());