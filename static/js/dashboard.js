const $ = (s) => document.querySelector(s);
const csrf = document.querySelector('meta[name="csrf-token"]').content;
const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const fdate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('fr-FR');
const fh = (h) => `${Math.round(h * 10) / 10} h`;
const money = (v) => (v === null || v === undefined ? '–' : eur.format(v));
const KIND_LABEL = { contrat: 'Contrat', aem: 'AEM', bulletin: 'Bulletin' };

// recherche : sans accents ni casse ; comparaison : sans casse ni espaces multiples
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const dupKey = (c) => `${norm(c.employer)}|${c.start_date}|${c.end_date}`;

const dialog = $('#contract-dialog');
const form = $('#contract-form');
let contracts = [];
let employers = [];
let editingDocs = [];
let dupMap = new Map();
const view = { q: '', year: '', employer: '', status: '', group: true };
const collapsed = new Set();

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
    if (body instanceof FormData) {
        payload = body;
    } else if (body) {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
    }
    const res = await fetch(path, { method, headers, body: payload });
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

/* ---------- Doublons ---------- */
function computeDuplicates() {
    dupMap = new Map();
    for (const c of contracts) {
        const k = dupKey(c);
        if (!dupMap.has(k)) dupMap.set(k, []);
        dupMap.get(k).push(c.id);
    }
}

const isDup = (c) => (dupMap.get(dupKey(c)) || []).length > 1;

function findDuplicate(v, excludeId) {
    if (!v.employer || !v.start_date || !v.end_date) return null;
    const key = dupKey(v);
    return contracts.find((c) => String(c.id) !== String(excludeId) && dupKey(c) === key) || null;
}

function checkDup() {
    const v = Object.fromEntries(new FormData(form));
    const match = findDuplicate(v, v.id);
    const box = $('#dup-warning');
    box.hidden = !match;
    if (match) {
        const sameMission = norm(match.mission) === norm(v.mission);
        const sameHours = Number(match.hours) === Number(String(v.hours).replace(',', '.'));
        box.textContent =
            (sameMission && sameHours
                ? 'Un contrat identique existe déjà'
                : 'Un contrat du même employeur existe déjà sur les mêmes dates') +
            ` : ${match.mission || 'sans mission'} · ${fh(match.hours)}` +
            ` (${fdate(match.start_date)} → ${fdate(match.end_date)}).`;
    }
    $('#save-btn').textContent = match ? 'Enregistrer quand même' : 'Enregistrer';
}

/* ---------- Filtres, tri, totaux ---------- */
function isFiltered() {
    return Boolean(view.q || view.year || view.employer || view.status);
}

function filteredContracts() {
    const terms = fold(view.q).split(/\s+/).filter(Boolean);
    return contracts.filter((c) => {
        if (view.year && c.end_date.slice(0, 4) !== view.year) return false;
        if (view.employer && norm(c.employer) !== view.employer) return false;
        if (view.status === 'dup' && !isDup(c)) return false;
        if (view.status === 'nonet' && c.gross != null && c.net != null) return false;
        if (view.status === 'nodoc' && c.documents.length) return false;
        if (terms.length) {
            const hay = fold(`${c.employer} ${c.mission} ${c.comment}`);
            if (!terms.every((t) => hay.includes(t))) return false;
        }
        return true;
    });
}

const isEmpty = (v) => v === null || v === undefined || v === '';

function sortedContracts(list) {
    const col = COLUMNS.find((c) => c.key === sort.key);
    const get = col.value || ((c) => c[col.key]);
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
        const va = get(a);
        const vb = get(b);
        if (isEmpty(va) && isEmpty(vb)) return b.id - a.id;
        if (isEmpty(va)) return 1;
        if (isEmpty(vb)) return -1;
        const r = col.num ? va - vb : String(va).localeCompare(String(vb), 'fr', { sensitivity: 'base' });
        return r * dir || b.id - a.id;
    });
}

function totals(items) {
    let hours = 0, gross = 0, net = 0, nGross = 0, nNet = 0;
    for (const c of items) {
        hours += c.hours;
        if (c.gross != null) { gross += c.gross; nGross++; }
        if (c.net != null) { net += c.net; nNet++; }
    }
    return { hours, gross: nGross ? gross : null, net: nNet ? net : null };
}

function fillSelect(select, options, key) {
    select.replaceChildren(...options.map(([value, text]) => {
        const o = document.createElement('option');
        o.value = value;
        o.textContent = text;
        return o;
    }));
    if (!options.some(([value]) => value === view[key])) view[key] = '';
    select.value = view[key];
}

function renderFilters() {
    const years = [...new Set(contracts.map((c) => c.end_date.slice(0, 4)))].sort().reverse();
    const names = new Map();
    for (const c of contracts) {
        if (!names.has(norm(c.employer))) names.set(norm(c.employer), c.employer);
    }
    const emps = [...names.entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr', { sensitivity: 'base' }));
    fillSelect($('#f-year'), [['', 'Toutes les années'], ...years.map((y) => [y, y])], 'year');
    fillSelect($('#f-employer'), [['', 'Tous les employeurs'], ...emps], 'employer');
}

/* ---------- En-tête du tableau ---------- */
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
function contractRow(c) {
    const tr = document.createElement('tr');
    const mission = el('td', c.mission || '–');
    if (isDup(c)) mission.append(el('span', 'Doublon', 'tag'));
    if (c.comment) mission.append(el('div', c.comment, 'comment'));
    tr.append(
        el('td', c.employer),
        mission,
        el('td', fdate(c.start_date)),
        el('td', fdate(c.end_date)),
        el('td', c.hours, 'num'),
        el('td', money(c.gross), 'num'),
        el('td', money(c.net), 'num'),
        el('td', c.documents.length ? `${c.documents.length} PDF` : '–', 'num'));
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
    return tr;
}

function groupRow(year, items) {
    const t = totals(items);
    const open = !collapsed.has(year);
    const tr = document.createElement('tr');
    tr.className = 'group-row';
    tr.addEventListener('click', () => {
        if (collapsed.has(year)) collapsed.delete(year);
        else collapsed.add(year);
        render();
    });
    const td = el('td');
    td.colSpan = COLUMNS.length + 1;
    const line = el('div', undefined, 'group-line');
    const toggle = el('button', `${open ? '▾' : '▸'} ${year}`, 'group-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(open));
    const sums = `${items.length} contrat(s) · ${fh(t.hours)}` + (t.net != null ? ` · ${eur.format(t.net)} net` : '');
    line.append(toggle, el('span', sums, 'muted'));
    td.append(line);
    tr.append(td);
    return tr;
}

function renderGroups(tbody, list) {
    const groups = new Map();
    for (const c of list) {
        const y = c.end_date.slice(0, 4);
        if (!groups.has(y)) groups.set(y, []);
        groups.get(y).push(c);
    }
    const years = [...groups.keys()].sort();
    const asc = (sort.key === 'start_date' || sort.key === 'end_date') && sort.dir === 'asc';
    if (!asc) years.reverse();
    for (const y of years) {
        const items = groups.get(y);
        tbody.append(groupRow(y, items));
        if (!collapsed.has(y)) items.forEach((c) => tbody.append(contractRow(c)));
    }
}

function render() {
    const list = sortedContracts(filteredContracts());
    const tbody = $('#rows');
    tbody.replaceChildren();

    const t = totals(list);
    $('#result-info').textContent = contracts.length
        ? `${list.length} contrat(s)${list.length !== contracts.length ? ` sur ${contracts.length}` : ''} · ${fh(t.hours)}` +
          (t.net != null ? ` · ${eur.format(t.net)} net` : '')
        : '';
    $('#reset-filters').hidden = !isFiltered();
    const empty = $('#empty');
    empty.hidden = list.length > 0;
    empty.textContent = contracts.length
        ? 'Aucun contrat ne correspond aux filtres.'
        : "Aucun contrat pour l'instant.";

    if (view.group) renderGroups(tbody, list);
    else list.forEach((c) => tbody.append(contractRow(c)));
}

/* ---------- Progression ---------- */
async function loadSummary() {
    const s = await api('/api/summary');
    $('#bar').style.width = Math.min(100, (s.hours / s.target) * 100) + '%';
    $('#hours').textContent = Math.round(s.hours * 10) / 10;
    $('#range').textContent = ` (du ${fdate(s.window_start)} au ${fdate(s.window_end)})`;
    const left = Math.max(0, s.target - s.hours);
    $('#remaining').textContent = left > 0
        ? `Il te manque ${Math.round(left * 10) / 10} h.`
        : 'Seuil des 507 h atteint';
    $('#mode').textContent = s.mode === 'since_fct'
        ? `Heures depuis ta fin de contrat retenue du ${fdate(s.fct_date)}` +
          (s.anniversary_date ? ` · date anniversaire le ${fdate(s.anniversary_date)}` : '')
        : '12 derniers mois glissants (aucun droit renseigné sur la page Intermittence).';
}

async function load() {
    [contracts, employers] = await Promise.all([api('/api/contracts'), api('/api/employers')]);
    computeDuplicates();
    renderFilters();
    render();
    renderEmployers();
    await loadSummary();
}

/* ---------- Employeurs (saisie rapide) ---------- */
function renderEmployers() {
    $('#employers').replaceChildren(...employers.map((e) => {
        const o = document.createElement('option');
        o.value = e;
        return o;
    }));
    $('#employer-chips').replaceChildren(...employers.slice(0, 6).map((e) => {
        const b = el('button', e, 'chip');
        b.type = 'button';
        b.onclick = () => {
            form.elements.employer.value = e;
            checkDup();
            form.elements.mission.focus();
        };
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
    if (c) {
        for (const k of ['employer', 'mission', 'hours', 'start_date', 'end_date', 'gross', 'net', 'comment']) {
            form.elements[k].value = c[k] ?? '';
        }
    }
    editingDocs = c ? [...c.documents] : [];
    renderDocs();
    $('#form-title').textContent = c ? 'Modifier le contrat' : 'Ajouter un contrat';
    checkDup();
    dialog.showModal();
}

const closeDialog = () => dialog.close();
$('#add-btn').onclick = () => openDialog(null);
$('#cancel').onclick = closeDialog;
$('#close-dialog').onclick = closeDialog;
form.addEventListener('input', checkDup);

// Fermeture au clic sur le fond : le clic doit commencer ET finir sur le fond
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
    const payload = Object.fromEntries(
        ['employer', 'mission', 'hours', 'start_date', 'end_date', 'gross', 'net', 'comment']
            .map((k) => [k, f.get(k)]));
    const files = ['contrat', 'aem', 'bulletin']
        .map((k) => [k, f.get('file_' + k)])
        .filter(([, file]) => file && file.size > 0);
    for (const [, file] of files) {
        if (file.size > 10 * 1024 * 1024) {
            err.textContent = `${file.name} dépasse 10 Mo`;
            return;
        }
    }
    $('#save-btn').disabled = true;
    let id = f.get('id');
    try {
        if (id) {
            await api(`/api/contracts/${id}`, 'PUT', payload);
        } else {
            id = (await api('/api/contracts', 'POST', payload)).id;
            form.elements.id.value = id;
        }
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

/* ---------- Barre d'outils ---------- */
$('#q').addEventListener('input', (e) => { view.q = e.target.value; render(); });
$('#f-year').addEventListener('change', (e) => { view.year = e.target.value; render(); });
$('#f-employer').addEventListener('change', (e) => { view.employer = e.target.value; render(); });
$('#f-status').addEventListener('change', (e) => { view.status = e.target.value; render(); });
$('#group').addEventListener('change', (e) => { view.group = e.target.checked; render(); });
$('#reset-filters').onclick = () => {
    Object.assign(view, { q: '', year: '', employer: '', status: '' });
    $('#q').value = '';
    $('#f-year').value = '';
    $('#f-employer').value = '';
    $('#f-status').value = '';
    render();
};

renderHead();
load().finally(() => Boot.ready());