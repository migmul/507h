const $ = (s) => document.querySelector(s);
const csrf = document.querySelector('meta[name="csrf-token"]').content;
const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const fdate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('fr-FR');
const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const fh = (h) => (h == null ? '–' : `${nf1.format(h)} h`);
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
const THIS_YEAR = String(new Date().getFullYear());
const toggled = new Map();    // année -> dépliée (true) ou repliée (false), choisi à la main
let defaultAnnexe = 8;

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

function setAnnexe(a) {
    form.elements.annexe.value = a;
    $('#annexe-toggle').querySelectorAll('button').forEach((b) => {
        const on = Number(b.dataset.annexe) === a;
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', String(on));
    });
    const artist = a === 10;
    $('#cachets-label').hidden = !artist;
    // en annexe 10, « Jours travaillés » passe sur sa propre ligne pour garder Début | Fin appariés
    form.elements.days_worked.closest('label').classList.toggle('m-full', artist);
    if (!artist) form.elements.cachets.value = '';
    syncCachets();
}

// Des cachets saisis imposent les heures (1 cachet = 12 h)
function syncCachets() {
    const n = Number(form.elements.cachets.value);
    if (n > 0) {
        form.elements.hours.value = n * 12;
        form.elements.hours.readOnly = true;
    } else {
        form.elements.hours.readOnly = false;
    }
}

// Suggestion du champ « Jours travaillés » : un jour par cachet, sinon heures / 8
function updateDaysHint() {
    const cachets = Number(form.elements.cachets.value);
    const hours = Number(String(form.elements.hours.value).replace(',', '.'));
    let est = null;
    if (cachets > 0) est = cachets;
    else if (hours > 0) est = hours / 8;
    form.elements.days_worked.placeholder = est ? `Estimé : ${nf1.format(est)}` : 'Estimé';
}

$('#annexe-toggle').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    setAnnexe(Number(b.dataset.annexe));
    updateDaysHint();
});

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

// Par défaut, seule l'année en cours est dépliée ; pendant une recherche ou un filtre, tout l'est.
function isOpen(year) {
    if (toggled.has(year)) return toggled.get(year);
    return isFiltered() || year === THIS_YEAR;
}

function setView(patch) {
    Object.assign(view, patch);
    toggled.clear();
    render();
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
            const hay = fold(`${c.employer} ${c.job_title} ${c.mission} ${c.comment}`);
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
    tr.className = 'contract-row';
    const mission = el('td', c.mission || '–');
    if (isDup(c)) mission.append(el('span', 'Doublon', 'tag'));
    if (c.comment) mission.append(el('div', c.comment, 'comment'));
    if (!c.mission && !isDup(c) && !c.comment) mission.className = 'none';
    const docs = c.documents.length;
    const employer = el('td', c.employer);
    if (c.job_title) employer.append(el('span', c.job_title, 'sub'));
    const hoursCell = el('td', undefined, 'num');
    hoursCell.append(nf1.format(c.hours), el('span', ' h', 'mobile-inline'));
    if (c.cachets) {
        hoursCell.append(el('span', `${c.cachets} cachet${c.cachets > 1 ? 's' : ''}`, 'sub'));
    }
    tr.append(
        employer,
        mission,
        el('td', fdate(c.start_date)),
        el('td', fdate(c.end_date)),
        hoursCell,
        el('td', money(c.gross), c.gross == null ? 'num none' : 'num'),
        el('td', money(c.net), c.net == null ? 'num none' : 'num'),
        el('td', docs ? `${docs} PDF` : '–', docs ? 'num' : 'num none'));
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
    tr.classList.add('tappable');
    tr.addEventListener('click', (e) => {
        if (isMobile() && !e.target.closest('button')) openDialog(c);
    });
    return tr;
}

function groupRow(year, items) {
    const open = isOpen(year);
    const tr = document.createElement('tr');
    tr.className = 'group-row';
    tr.addEventListener('click', () => {
        toggled.set(year, !open);
        render();
    });
    const td = el('td');
    td.colSpan = COLUMNS.length + 1;
    const line = el('div', undefined, 'group-line');
    const toggle = el('button', `${open ? '▾' : '▸'} ${year}`, 'group-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(open));
    line.append(toggle, el('span', `${items.length} contrat(s)`, 'muted'));
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
        if (isOpen(y)) items.forEach((c) => tbody.append(contractRow(c)));
    }
}

function render() {
    const list = sortedContracts(filteredContracts());
    const tbody = $('#rows');
    tbody.replaceChildren();

    $('#result-info').textContent = contracts.length
        ? `${list.length} contrat(s)${list.length !== contracts.length ? ` sur ${contracts.length}` : ''}`
        : '';
    $('#reset-filters').hidden = !isFiltered();
    const active = [view.year, view.employer, view.status].filter(Boolean).length;
    $('#filters-toggle').textContent = active ? `Filtres (${active})` : 'Filtres';
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
    $('#hours').textContent = nf1.format(s.hours);
    $('#range').textContent = ` (du ${fdate(s.window_start)} au ${fdate(s.window_end)})`;
    const pct = Math.round((s.hours / s.target) * 100);
    $('#progress-sum').textContent = `${nf1.format(s.hours)} / ${s.target} h · ${pct} %`;
    $('#pct').textContent = `${pct} %`;
    $('#pct').classList.toggle('done', pct >= 100);
    const left = Math.max(0, s.target - s.hours);
    let until = '';
    if (s.mode === 'since_fct') {
        if (s.anniversary_date && s.anniversary_date >= s.window_end) {
            until = ` avant le ${fdate(s.anniversary_date)}`;
        }
    } else {
        until = ' sur les 12 derniers mois';
    }
    $('#remaining').textContent = left > 0
        ? `Il te manque ${nf1.format(left)} h${until}`
        : 'Seuil des 507 h atteint';
        defaultAnnexe = s.default_annexe;
    const eq = $('#cachets-eq');
    eq.hidden = s.annexe !== 10;
    if (s.annexe === 10) {
        eq.textContent = `Soit environ ${nf1.format(s.hours / 12)} cachets sur ${Math.ceil(s.target / 12)}`;
    }
    const tr = $('#training-eq');
    tr.hidden = !(s.training_hours > 0);
    tr.textContent = `Dont ${nf1.format(s.training_hours)} h de formation`;
}

function renderJobTitles() {
    const counts = new Map();
    for (const c of contracts) {
        if (c.job_title) counts.set(c.job_title, (counts.get(c.job_title) || 0) + 1);
    }
    const titles = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
    $('#job-titles').replaceChildren(...titles.map((t) => {
        const o = document.createElement('option');
        o.value = t;
        return o;
    }));
}

async function load() {
    [contracts, employers] = await Promise.all([api('/api/contracts'), api('/api/employers')]);
    computeDuplicates();
    renderFilters();
    render();
    renderEmployers();
    renderJobTitles();
    await loadSummary();
    await loadLimits();
    await loadTrainings();
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
        for (const k of ['employer', 'job_title', 'mission', 'hours', 'cachets', 'days_worked', 'start_date', 'end_date', 'gross', 'net', 'comment']) {
            form.elements[k].value = c[k] ?? '';
        }
    }
    editingDocs = c ? [...c.documents] : [];
    renderDocs();
    $('#form-title').textContent = c ? 'Modifier le contrat' : 'Ajouter un contrat';
    $('#contract-delete').hidden = !c;
    setAnnexe(c ? c.annexe : defaultAnnexe);
    updateDaysHint();
    checkDup();
    dialog.showModal();
}

$('#contract-delete').onclick = async () => {
    const id = form.elements.id.value;
    if (!id || !confirm('Supprimer ce contrat et ses documents ?')) return;
    await api(`/api/contracts/${id}`, 'DELETE');
    dialog.close();
    load();
};

const closeDialog = () => dialog.close();
$('#add-btn').onclick = () => openDialog(null);
$('#cancel').onclick = closeDialog;
$('#close-dialog').onclick = closeDialog;
form.addEventListener('input', () => {
    syncCachets();
    checkDup();
    updateDaysHint();
});

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
        ['annexe', 'employer', 'job_title', 'mission', 'hours', 'cachets', 'days_worked', 'start_date', 'end_date', 'gross', 'net', 'comment']
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
        toggled.set(payload.end_date.slice(0, 4), true);    // montre le contrat qu'on vient d'enregistrer
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
$('#q').addEventListener('input', (e) => setView({ q: e.target.value }));
$('#f-year').addEventListener('change', (e) => setView({ year: e.target.value }));
$('#f-employer').addEventListener('change', (e) => setView({ employer: e.target.value }));
$('#f-status').addEventListener('change', (e) => setView({ status: e.target.value }));
$('#group').addEventListener('change', (e) => setView({ group: e.target.checked }));
$('#reset-filters').onclick = () => {
    $('#q').value = '';
    $('#f-year').value = '';
    $('#f-employer').value = '';
    $('#f-status').value = '';
    setView({ q: '', year: '', employer: '', status: '' });
};
$('#filters-toggle').onclick = () => {
    const open = $('#toolbar').classList.toggle('show-filters');
    $('#filters-toggle').setAttribute('aria-expanded', String(open));
};
$('#sort-mobile').addEventListener('change', (e) => {
    const [key, dir] = e.target.value.split(':');
    sort = { key, dir };
    renderHead();
    render();
});

/* ---------- Plafonds annuels ---------- */
let limitYear = new Date().getFullYear();
const limitDialog = $('#limit-dialog');
const limitForm = $('#limit-form');

async function loadLimits() {
    renderLimits(await api(`/api/limits?year=${limitYear}`));
}

function renderLimits(d) {
    limitYear = d.year;
    $('#limit-year').textContent = d.year;
    $('#limits-empty').hidden = d.rules.length > 0;
    $('#limits-list').replaceChildren(...d.rules.map(limitBlock));
    // Résumé affiché sur la carte repliée
    const prefix = String(d.year) === THIS_YEAR ? '' : `${d.year} : `;
    const sum = $('#limits-sum');
    sum.textContent = d.rules.length
        ? prefix + d.rules.map((r) => `${r.label} ${nf1.format(r.total)} / ${r.max_days} j`).join(' · ')
        : '';
    sum.classList.toggle('over', d.rules.some((r) => r.over));
}

function limitBlock(r) {
    const box = el('div', undefined, 'limit tappable');
    box.addEventListener('click', () => openLimit(r));

    const head = el('div', undefined, 'limit-head');
    head.append(
        el('strong', r.label),
        el('span', `${nf1.format(r.total)} / ${r.max_days} jours`, r.over ? 'over' : ''));

    // Un seul remplissage : dégradé net entre les jours effectués et les jours prévus
    const bar = el('div', undefined, r.over ? 'progress multi over' : 'progress multi');
    const fill = el('div');
    fill.style.width = Math.min(100, (r.total / r.max_days) * 100) + '%';
    fill.style.setProperty('--done', (r.total > 0 ? (r.done / r.total) * 100 : 100) + '%');
    bar.append(fill);

    const parts = [];
    if (r.planned > 0) parts.push(`dont ${nf1.format(r.planned)} prévu(s)`);
    parts.push(r.over ? `dépassé de ${nf1.format(-r.remaining)} j` : `reste ${nf1.format(r.remaining)} j`);
    if (r.per_week) parts.push(`soit ${nf1.format(r.per_week)} j par semaine d'ici le 31/12`);
    box.append(head, bar, el('p', parts.join(' · '), 'muted small'));
    return box;
}

function openLimit(r) {
    limitForm.reset();
    limitForm.querySelector('[data-error]').textContent = '';
    limitForm.elements.id.value = r ? r.id : '';
    if (r) {
        limitForm.elements.label.value = r.label;
        limitForm.elements.employer_match.value = r.employer_match;
        limitForm.elements.max_days.value = r.max_days;
    }
    $('#limit-delete').hidden = !r;
    limitDialog.querySelector('h2').textContent = r ? 'Modifier le plafond' : 'Ajouter un plafond';
    limitDialog.showModal();
}

limitDialog.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => limitDialog.close(); });
let limitDown = false;
limitDialog.addEventListener('mousedown', (e) => { limitDown = e.target === limitDialog; });
limitDialog.addEventListener('click', (e) => {
    if (e.target === limitDialog && limitDown) limitDialog.close();
    limitDown = false;
});

limitForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(limitForm));
    const id = f.id;
    delete f.id;
    try {
        await api(id ? `/api/limits/${id}` : '/api/limits', id ? 'PUT' : 'POST', f);
        limitDialog.close();
        loadLimits();
    } catch (ex) {
        limitForm.querySelector('[data-error]').textContent = ex.message;
    }
});

$('#limit-delete').onclick = async () => {
    const id = limitForm.elements.id.value;
    if (!id || !confirm('Supprimer ce plafond ?')) return;
    await api(`/api/limits/${id}`, 'DELETE');
    limitDialog.close();
    loadLimits();
};

$('#limit-add').onclick = () => openLimit(null);
$('#limit-prev').onclick = () => { limitYear--; loadLimits(); };
$('#limit-next').onclick = () => { limitYear++; loadLimits(); };

/* ---------- Menu d'ajout ---------- */
const addMenu = $('#add-menu');
const addMenuBtn = $('#add-menu-btn');

function toggleAddMenu(open) {
    addMenu.hidden = !open;
    addMenuBtn.setAttribute('aria-expanded', String(open));
}

addMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleAddMenu(addMenu.hidden);
});
document.addEventListener('click', () => toggleAddMenu(false));
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') toggleAddMenu(false);
});
$('#add-training').onclick = () => openTraining(null);

/* ---------- Formations ---------- */
const trainingDialog = $('#training-dialog');
const trainingForm = $('#training-form');
const TRAINING_CAP = 338;

async function loadTrainings() {
    renderTrainings((await api('/api/trainings')).trainings);
}

function renderTrainings(list) {
    $('#trainings-card').hidden = list.length === 0;
    const eligible = list.filter((t) => !t.paid_by_are).reduce((a, t) => a + t.hours, 0);
    $('#trainings-sum').textContent =
        `${nf1.format(Math.min(eligible, TRAINING_CAP))} / ${TRAINING_CAP} h retenues`;
    $('#trainings-list').replaceChildren(...list.map(trainingItem));
}

function trainingItem(t) {
    const box = el('div', undefined, 'item tappable');
    box.addEventListener('click', () => openTraining(t));
    const left = el('div');
    left.append(el('strong', t.title));
    const meta = [t.provider, `${fdate(t.start_date)} → ${fdate(t.end_date)}`].filter(Boolean).join(' · ');
    left.append(el('span', meta, 'sub'));
    const right = el('div', undefined, 'item-end');
    right.append(el('span', `${nf1.format(t.hours)} h`));
    if (t.paid_by_are) right.append(el('span', 'non retenue', 'tag'));
    box.append(left, right);
    return box;
}

function openTraining(t) {
    trainingForm.reset();
    trainingForm.querySelector('[data-error]').textContent = '';
    trainingForm.elements.id.value = t ? t.id : '';
    if (t) {
        for (const k of ['title', 'provider', 'start_date', 'end_date', 'hours']) {
            trainingForm.elements[k].value = t[k] ?? '';
        }
        trainingForm.elements.paid_by_are.checked = t.paid_by_are;
    }
    $('#training-delete').hidden = !t;
    trainingDialog.querySelector('h2').textContent = t ? 'Modifier la formation' : 'Ajouter une formation';
    trainingDialog.showModal();
}

trainingDialog.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => trainingDialog.close(); });
let trainingDown = false;
trainingDialog.addEventListener('mousedown', (e) => { trainingDown = e.target === trainingDialog; });
trainingDialog.addEventListener('click', (e) => {
    if (e.target === trainingDialog && trainingDown) trainingDialog.close();
    trainingDown = false;
});

trainingForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(trainingForm));
    f.paid_by_are = trainingForm.elements.paid_by_are.checked;
    const id = f.id;
    delete f.id;
    try {
        await api(id ? `/api/trainings/${id}` : '/api/trainings', id ? 'PUT' : 'POST', f);
        trainingDialog.close();
        load();      // recalcule aussi la progression des 507 h
    } catch (ex) {
        trainingForm.querySelector('[data-error]').textContent = ex.message;
    }
});

$('#training-delete').onclick = async () => {
    const id = trainingForm.elements.id.value;
    if (!id || !confirm('Supprimer cette formation ?')) return;
    await api(`/api/trainings/${id}`, 'DELETE');
    trainingDialog.close();
    load();
};

renderHead();
load().finally(() => Boot.ready());