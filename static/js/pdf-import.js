/* ---------- Import de PDF : AEM et bulletins de paie ---------- */
// Un seul bouton, un ou plusieurs fichiers : un PDF ouvre la fenêtre détaillée, plusieurs ouvrent un tableau.
// Dépend de dashboard.js (contracts, employers, form, openDialog, load, api, el, findDuplicate…) : à charger après lui.
const DOCS = {
    aem: { title: 'Importer une AEM', the: 'l\'AEM', tag: 'AEM', field: 'AEM', already: 'une AEM jointe' },
    bulletin: { title: 'Importer un bulletin de paie', the: 'le bulletin', tag: 'Bulletin', field: 'Bulletin de paie',
                already: 'un bulletin de paie joint' },
};
const FILL_LABELS = { gross: 'Brut', net: 'Net avant impôt', days_worked: 'Jours travaillés', cachets: 'Cachets' };
const LEVEL_LABEL = { certain: 'Certain', probable: 'Probable', possible: 'Possible' };
const MAX_IMPORT = 40;              // PDF par import
const MAX_PDF_SIZE = 10 * 1024 * 1024;

const analyzePdf = (file) => {
    const body = new FormData();
    body.append('file', file);
    return api('/api/pdf/analyze', 'POST', body);        // { doc, matches, already_attached }
};

// Le formulaire d'édition attend le contrat complet : on le reconstitue à partir de la liste chargée
function contractPayload(c) {
    return {
        annexe: c.annexe, employer: c.employer, job_title: c.job_title, mission: c.mission,
        hours: c.hours, cachets: c.cachets ?? '', days_worked: c.days_worked ?? '',
        start_date: c.start_date, end_date: c.end_date,
        gross: c.gross ?? '', net: c.net ?? '', comment: c.comment,
    };
}

const docPeriod = (a) => (!a.end_date || a.end_date === a.start_date
    ? fdate(a.start_date) : `${fdate(a.start_date)} → ${fdate(a.end_date)}`);

const docWork = (a) => [
    a.hours != null ? fh(a.hours) : '',
    a.cachets ? `${a.cachets} cachet${a.cachets > 1 ? 's' : ''}` : '',
    a.days_worked != null ? `${nf1.format(a.days_worked)} jour${a.days_worked > 1 ? 's' : ''}` : '',
].filter(Boolean).join(' · ');

const sentenceCase = (s) => (s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s);
const knownSpelling = (value, known) => known.find((k) => fold(k) === fold(value));

// Valeurs du formulaire de contrat déduites d'un document. Si une AEM n'en couvre qu'une partie (complémentaire,
// rectificative ou contrat en cours), ses heures, jours et montants ne sont pas ceux du contrat : on ne les reprend pas.
function contractFromAem(aem) {
    const jobs = [...new Set(contracts.map((c) => c.job_title).filter(Boolean))];
    const v = {
        annexe: aem.annexe || defaultAnnexe,
        employer: knownSpelling(aem.employer, employers) || aem.employer,    // « France Télévisions » plutôt que « FRANCE TELEVISIONS »
        job_title: aem.job_title ? knownSpelling(aem.job_title, jobs) || sentenceCase(aem.job_title) : '',
        start_date: aem.start_date || '',
        end_date: aem.end_date || '',
        comment: aem.contract_number || '',        // le n° de contrat sert au rattachement des prochains documents
    };
    if (!aem.partial) {
        if (v.annexe === 10 && aem.cachets) v.cachets = aem.cachets;    // les cachets imposent les heures
        else if (aem.hours != null) v.hours = aem.hours;
        if (aem.days_worked != null) v.days_worked = aem.days_worked;
        if (aem.gross != null) v.gross = aem.gross;
        if (aem.net != null) v.net = aem.net;
    }
    return v;
}

/* ---------- Un seul PDF : fenêtre détaillée ---------- */
const aemDialog = $('#aem-dialog');
bindDialog(aemDialog);
let aemKind = 'aem';         // 'aem' ou 'bulletin' : reconnu par le serveur
let aemFile = null;
let aemData = null;          // résultat de l'analyse, pour créer un contrat
let aemUploaded = false;     // le PDF est déjà joint : un nouvel essai ne le renvoie pas
let aemChoices = [];         // [{ match, radio }]
let aemFills = [];           // [{ field, value, box }]

function aemRows(a) {
    const rows = [
        ['Employeur', a.employer],
        ['Contrat', docPeriod(a) + (a.contract_number ? ` · n° ${a.contract_number}` : '')],
        ['Mois de paie', a.month ? `${a.month.slice(5)}/${a.month.slice(0, 4)}` : '–'],
        ['Travail déclaré', docWork(a) || '–'],
        ['Brut', money(a.gross)],
    ];
    if (a.document === 'bulletin') rows.push(['Net avant impôt', money(a.net)]);
    return rows;
}

// Notes affichées sous la liste pour le contrat sélectionné + valeurs proposées en complément
function selectAemMatch(m) {
    aemFills = Object.entries(m.fill).map(([field, value]) => {
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = true;
        return { field, value, box };
    });
    $('#aem-fill-list').replaceChildren(...aemFills.map(({ field, value, box }) => {
        const label = el('label', undefined, 'check');
        label.append(box, `${FILL_LABELS[field]} : ${field === 'gross' || field === 'net' ? money(value) : nf1.format(value)}`);
        return label;
    }));
    $('#aem-fill').hidden = !aemFills.length;
    const notes = [...(m.has_doc ? [`Ce contrat a déjà ${DOCS[aemKind].already}.`] : []), ...m.notes];
    $('#aem-notes').textContent = notes.join(' ');
    $('#aem-notes').hidden = !notes.length;
    $('#aem-attach').disabled = false;
}

function renderAem(res) {
    $('#aem-error').textContent = '';
    $('#aem-info').hidden = $('#aem-body').hidden = true;
    $('#aem-attach').disabled = true;
    $('#aem-attach').hidden = false;
    $('#aem-create').hidden = true;
    aemChoices = [];
    aemFills = [];
    aemData = null;
    if (res.loading) {
        $('#aem-info').textContent = 'Lecture du PDF…';
        $('#aem-info').hidden = false;
        return;
    }
    if (res.error) {
        $('#aem-error').textContent = res.error;
        return;
    }
    if (res.already_attached) {
        $('#aem-info').textContent = 'Ce PDF est déjà joint à un de tes contrats.';
        $('#aem-info').hidden = false;
        return;
    }

    aemKind = res.doc.document;
    $('#aem-title').textContent = DOCS[aemKind].title;
    kv($('#aem-summary'), aemRows(res.doc));
    $('#aem-warnings').textContent = res.doc.warnings.join(' ');
    $('#aem-warnings').hidden = !res.doc.warnings.length;
    $('#aem-body').hidden = false;
    aemData = res.doc;
    const found = res.matches.length > 0;
    $('#aem-attach').textContent = `Rattacher ${DOCS[aemKind].the}`;
    $('#aem-attach').hidden = !found;
    $('#aem-create').hidden = false;
    $('#aem-create').className = found ? 'ghost' : 'primary inline';

    const list = $('#aem-match-list');
    $('#aem-matches').hidden = !found;
    $('#aem-none').textContent = 'Aucun contrat de l\'application ne correspond à ce PDF. Tu peux en créer un à partir de ses données.';
    $('#aem-none').hidden = found;
    list.replaceChildren(...res.matches.map((m) => {
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'aem-contract';
        radio.checked = m.best;
        radio.addEventListener('change', () => selectAemMatch(m));
        aemChoices.push({ match: m, radio });
        const text = el('div');
        text.append(
            el('strong', m.employer + (m.mission ? ` – ${m.mission}` : '')),
            el('span', `${fdate(m.start_date)} → ${fdate(m.end_date)} · ${fh(m.hours)}`, 'sub'),
            el('span', m.reasons.join(' · '), 'sub'));
        const row = el('label', undefined, 'choice');
        row.append(radio, text, el('span', LEVEL_LABEL[m.level], m.level === 'certain' ? 'tag ok' : 'tag'));
        return row;
    }));
    const best = aemChoices.find((x) => x.match.best);
    if (best) selectAemMatch(best.match);
    else {
        $('#aem-fill').hidden = $('#aem-notes').hidden = true;
    }
}

async function importSingle(file) {
    aemFile = file;
    aemUploaded = false;
    $('#aem-title').textContent = 'Importer un PDF';
    aemDialog.showModal();
    renderAem({ loading: true });
    try {
        renderAem(await analyzePdf(file));
    } catch (ex) {
        renderAem({ error: ex.message });
    }
}

$('#aem-attach').onclick = async () => {
    const choice = aemChoices.find((x) => x.radio.checked);
    const contract = choice && contracts.find((c) => c.id === choice.match.id);
    if (!contract || !aemFile) return;
    const fill = Object.fromEntries(aemFills.filter((f) => f.box.checked).map((f) => [f.field, f.value]));
    $('#aem-error').textContent = '';
    $('#aem-attach').disabled = true;
    try {
        if (!aemUploaded) {
            const body = new FormData();
            body.append('kind', aemKind);
            body.append('file', aemFile);
            await api(`/api/contracts/${contract.id}/documents`, 'POST', body);
            aemUploaded = true;
        }
        if (Object.keys(fill).length) {
            await api(`/api/contracts/${contract.id}`, 'PUT', { ...contractPayload(contract), ...fill });
        }
        toggled.set(contract.end_date.slice(0, 4), true);
        aemDialog.close();
        load();
    } catch (ex) {
        $('#aem-error').textContent = aemUploaded
            ? `PDF joint, mais les valeurs n'ont pas pu être renseignées : ${ex.message}`
            : ex.message;
        $('#aem-attach').disabled = false;
        load();
    }
};

/* ---------- Création d'un contrat à partir du PDF importé ---------- */
function createFromAem() {
    const aem = aemData;
    if (!aem || !aemFile) return;
    const doc = DOCS[aemKind];
    const v = contractFromAem(aem);
    aemDialog.close();
    openDialog(null);
    setAnnexe(v.annexe);
    for (const k of ['employer', 'job_title', 'start_date', 'end_date', 'comment', 'hours', 'cachets', 'days_worked', 'gross', 'net']) {
        if (v[k] !== undefined) form.elements[k].value = v[k];
    }
    syncCachets();
    updateDaysHint();
    checkDup();
    $('#form-title').textContent = aemKind === 'aem' ? 'Nouveau contrat depuis une AEM' : 'Nouveau contrat depuis un bulletin';

    // Le PDF part avec le formulaire, comme s'il avait été choisi dans la case correspondante
    let attached = true;
    try {
        const files = new DataTransfer();
        files.items.add(aemFile);
        form.elements[`file_${aemKind}`].files = files.files;
    } catch {
        attached = false;
    }
    const lines = [`Valeurs lues dans ${doc.the} : vérifie-les avant d'enregistrer.`];
    lines.push(attached ? 'Le PDF sera joint au contrat.' : `Joins le PDF dans la case « ${doc.field} » ci-dessous.`);
    if (aem.partial) {
        lines.push(aem.partial, 'Les heures, les jours et les montants ne sont pas renseignés : saisis ceux du contrat entier.');
        if (!aem.end_date) lines.push('Renseigne aussi la date de fin.');
    }
    $('#aem-draft-note').textContent = lines.join(' ');
    $('#aem-draft-note').hidden = false;
}

form.addEventListener('reset', () => { $('#aem-draft-note').hidden = true; });
$('#aem-create').onclick = createFromAem;

/* ---------- Plusieurs PDF : tableau ---------- */
const bulkDialog = $('#bulk-dialog');
bindDialog(bulkDialog);
let bulkRows = [];           // un objet par fichier : { file, state, doc, matches, choice, message, target, tr }
let bulkCreated = new Map(); // clé du contrat → id du contrat créé pendant cet import (évite les doublons au nouvel essai)
let bulkBusy = false;

const ID_FIELDS = ['employer', 'job_title', 'contract_number', 'annexe', 'start_date', 'end_date'];
const AMOUNT_FIELDS = ['hours', 'cachets', 'days_worked', 'gross', 'net'];

// Les documents d'un même contrat (AEM + bulletin) créent un seul contrat : clé = n° de contrat, sinon employeur + dates
const groupKey = (d) => (d.contract_number
    ? `${fold(d.employer)}|n°${d.contract_number}`
    : `${fold(d.employer)}|${d.start_date}|${d.end_date || ''}`);

// Fusionne les documents d'un même contrat. Les montants ne viennent que des documents qui couvrent le contrat entier,
// le bulletin en premier ; l'annexe et les cachets viennent de l'AEM.
function mergeDocs(docs) {
    const complete = docs.filter((d) => !d.partial)
        .sort((a, b) => (a.document === 'bulletin' ? 0 : 1) - (b.document === 'bulletin' ? 0 : 1));
    const merged = { document: docs.some((d) => d.document === 'bulletin') ? 'bulletin' : 'aem' };
    for (const d of [...complete, ...docs.filter((d) => d.partial)]) {
        for (const k of ID_FIELDS) if (merged[k] == null && d[k] != null && d[k] !== '') merged[k] = d[k];
    }
    for (const d of complete) {
        for (const k of AMOUNT_FIELDS) if (merged[k] == null && d[k] != null) merged[k] = d[k];
    }
    merged.partial = complete.length ? null : docs[0].partial;
    return merged;
}

const selectedMatch = (row) => row.matches.find((m) => String(m.id) === row.choice);

function rowStatus(row) {
    switch (row.state) {
        case 'queued': return ['En attente', ''];
        case 'reading': return ['Lecture…', ''];
        case 'ready': return [row.choice ? 'Prêt' : 'À choisir', row.choice ? '' : 'bulk-warn'];
        case 'known': return ['Déjà joint à un contrat', 'bulk-warn'];
        case 'error': return [row.message, 'bulk-ko'];
        case 'working': return ['Envoi…', ''];
        case 'done': return [row.message || 'Importé', 'bulk-ok'];
        default: return [row.message, 'bulk-ko'];       // failed
    }
}

function contractOptions(row) {
    const option = (value, text) => {
        const o = document.createElement('option');
        o.value = value;
        o.textContent = text;
        return o;
    };
    return [
        option('', '— Ne pas importer —'),
        ...row.matches.map((m) => option(String(m.id),
            `${m.employer}${m.mission ? ` – ${m.mission}` : ''} · ${fdate(m.start_date)} → ${fdate(m.end_date)} · ${LEVEL_LABEL[m.level]}`)),
        option('new', '＋ Créer un contrat'),
    ];
}

function renderRow(row) {
    const tr = row.tr ||= document.createElement('tr');
    const doc = row.doc;

    const name = document.createElement('td');
    name.append(el('strong', row.file.name));
    if (doc) name.append(el('span', DOCS[doc.document].tag, 'tag'));

    const content = document.createElement('td');
    if (doc) {
        content.append(
            el('span', `${doc.employer} · ${docPeriod(doc)}`),
            el('span', [doc.contract_number ? `n° ${doc.contract_number}` : '', docWork(doc),
                doc.gross != null ? `brut ${money(doc.gross)}` : '', doc.net != null ? `net ${money(doc.net)}` : '']
                .filter(Boolean).join(' · '), 'sub'));
        if (doc.warnings.length) content.append(el('span', doc.warnings.join(' '), 'sub'));
    }

    const target = document.createElement('td');
    if (['ready', 'working', 'failed'].includes(row.state)) {
        const select = document.createElement('select');
        select.replaceChildren(...contractOptions(row));
        select.value = row.choice;
        select.disabled = row.state === 'working';
        select.addEventListener('change', () => {
            row.choice = select.value;
            renderRow(row);
            updateBulk();
        });
        const m = selectedMatch(row);
        const remark = row.choice === 'new'
            ? (doc.partial ? `${doc.partial} Les montants viendront d'un autre document du même contrat.` : 'Nouveau contrat prérempli avec les valeurs du PDF.')
            : [m && m.has_doc ? `Ce contrat a déjà ${DOCS[doc.document].already}.` : '', ...(m ? m.notes : [])].filter(Boolean).join(' ');
        target.append(select);
        if (remark) target.append(el('span', remark, 'sub'));
    }

    const status = document.createElement('td');
    const [text, cls] = rowStatus(row);
    status.append(el('span', text, cls));

    tr.replaceChildren(name, content, target, status);
    return tr;
}

function updateBulk() {
    const todo = bulkRows.filter((r) => ['ready', 'failed'].includes(r.state) && r.choice).length;
    const count = (s) => bulkRows.filter((r) => r.state === s).length;
    const toChoose = bulkRows.filter((r) => r.state === 'ready' && !r.choice).length;
    $('#bulk-summary').textContent = [`${bulkRows.length} PDF`, `${todo} prêts`, toChoose && `${toChoose} à choisir`,
        count('known') && `${count('known')} déjà joints`, count('error') && `${count('error')} en erreur`,
        count('done') && `${count('done')} importés`].filter(Boolean).join(' · ');
    $('#bulk-run').textContent = todo ? `Importer ${todo} PDF` : 'Importer';
    $('#bulk-run').disabled = bulkBusy || !todo;
}

function setBulkBusy(busy) {
    bulkBusy = busy;
    bulkDialog.querySelectorAll('[data-close]').forEach((b) => { b.disabled = busy; });
    updateBulk();
}
bulkDialog.addEventListener('cancel', (e) => { if (bulkBusy) e.preventDefault(); });

// Au plus 3 analyses en même temps : chacune lance un sous-processus côté serveur
async function pool(items, limit, task) {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) await task(items[next++]);
    }));
}

async function analyzeRow(row) {
    row.state = 'reading';
    renderRow(row);
    try {
        const res = await analyzePdf(row.file);
        row.doc = res.doc;
        row.matches = res.matches;
        if (res.already_attached) {
            row.state = 'known';
        } else {
            row.state = 'ready';
            const best = res.matches.find((m) => m.best);
            // plusieurs candidats sans favori : à l'utilisateur de choisir ; aucun candidat : création proposée
            row.choice = best ? String(best.id) : (res.matches.length ? '' : 'new');
        }
    } catch (ex) {
        row.state = 'error';
        row.message = ex.message;
    }
    renderRow(row);
}

// Un document partiel (AEM complémentaire, contrat en cours) ne peut pas créer un contrat seul : on ne le propose
// que si un autre document du même contrat, qui le couvre en entier, est lui aussi à créer
function settleCreations() {
    const groups = new Map();
    for (const r of bulkRows.filter((r) => r.state === 'ready' && r.choice === 'new')) {
        const key = groupKey(r.doc);
        groups.set(key, [...(groups.get(key) || []), r]);
    }
    for (const rows of groups.values()) {
        if (rows.every((r) => r.doc.partial)) rows.forEach((r) => { r.choice = ''; });
    }
}

async function importMany(files) {
    bulkRows = files.map((file) => {
        const row = { file, state: 'queued', doc: null, matches: [], choice: '', message: '', target: null, tr: null };
        if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
            Object.assign(row, { state: 'error', message: 'Ce fichier n\'est pas un PDF.' });
        } else if (file.size > MAX_PDF_SIZE) {
            Object.assign(row, { state: 'error', message: `${file.name} dépasse 10 Mo.` });
        }
        return row;
    });
    bulkCreated = new Map();
    $('#bulk-error').textContent = '';
    $('#bulk-rows').replaceChildren(...bulkRows.map(renderRow));
    setBulkBusy(true);
    bulkDialog.showModal();
    await pool(bulkRows.filter((r) => r.state === 'queued'), 3, analyzeRow);
    settleCreations();
    bulkRows.forEach(renderRow);
    setBulkBusy(false);
}

function failRows(rows, message) {
    rows.forEach((r) => { r.state = 'failed'; r.message = message; });
}

// Étape 1 : un contrat par groupe de documents « à créer », prérempli avec leurs valeurs fusionnées
async function createContracts(todo) {
    const groups = new Map();
    for (const r of todo.filter((r) => r.choice === 'new' && r.state === 'working')) {
        const key = groupKey(r.doc);
        groups.set(key, [...(groups.get(key) || []), r]);
    }
    for (const [key, rows] of groups) {
        if (bulkCreated.has(key)) {
            rows.forEach((r) => { r.target = bulkCreated.get(key); });
            continue;
        }
        const v = contractFromAem(mergeDocs(rows.map((r) => r.doc)));
        if (!v.employer || !v.start_date || !v.end_date || !(v.hours || v.cachets)) {
            failRows(rows, 'Données insuffisantes pour créer le contrat : importe-le seul pour le compléter.');
            continue;
        }
        const dup = findDuplicate(v, null);
        if (dup) {
            failRows(rows, `Un contrat identique existe déjà (${dup.mission || 'sans mission'}, ${fdate(dup.start_date)} → ${fdate(dup.end_date)}) : choisis-le dans la liste.`);
            continue;
        }
        try {
            const created = await api('/api/contracts', 'POST', {
                annexe: v.annexe, employer: v.employer, job_title: v.job_title, mission: '',
                hours: v.hours ?? '', cachets: v.cachets ?? '', days_worked: v.days_worked ?? '',
                start_date: v.start_date, end_date: v.end_date, gross: v.gross ?? '', net: v.net ?? '', comment: v.comment,
            });
            bulkCreated.set(key, created.id);
            rows.forEach((r) => { r.target = created.id; r.createdYear = v.end_date.slice(0, 4); });
        } catch (ex) {
            failRows(rows, ex.message);
        }
    }
}

// Étape 2 : chaque PDF est joint à son contrat
async function attachRow(row) {
    if (row.state !== 'working') return;
    const id = row.choice === 'new' ? row.target : Number(row.choice);
    try {
        const body = new FormData();
        body.append('kind', row.doc.document);
        body.append('file', row.file);
        await api(`/api/contracts/${id}/documents`, 'POST', body);
        row.state = 'done';
        row.message = row.choice === 'new' ? 'Contrat créé, PDF joint' : 'PDF joint';
    } catch (ex) {
        row.state = 'failed';
        row.message = ex.message;
    }
}

// Étape 3 : valeurs vides des contrats existants complétées, en une seule mise à jour par contrat
async function completeContracts(todo) {
    if (!$('#bulk-fill').checked) return;
    const fills = new Map();
    const done = todo.filter((r) => r.state === 'done' && r.choice !== 'new')
        .sort((a, b) => (a.doc.document === 'bulletin' ? 0 : 1) - (b.doc.document === 'bulletin' ? 0 : 1));
    for (const row of done) {
        const m = selectedMatch(row);
        if (!m || !Object.keys(m.fill).length) continue;
        const entry = fills.get(m.id) || { fill: {}, rows: [] };
        for (const [k, v] of Object.entries(m.fill)) if (!(k in entry.fill)) entry.fill[k] = v;
        entry.rows.push(row);
        fills.set(m.id, entry);
    }
    for (const [id, { fill, rows }] of fills) {
        const contract = contracts.find((c) => c.id === id);
        if (!contract) continue;
        try {
            await api(`/api/contracts/${id}`, 'PUT', { ...contractPayload(contract), ...fill });
            rows.forEach((r) => { r.message += ' · valeurs complétées'; });
        } catch (ex) {
            rows.forEach((r) => { r.message = `PDF joint, mais valeurs non renseignées : ${ex.message}`; });
        }
    }
}

async function runBulk() {
    if (bulkBusy) return;
    setBulkBusy(true);
    $('#bulk-error').textContent = '';
    const todo = bulkRows.filter((r) => ['ready', 'failed'].includes(r.state) && r.choice);
    todo.forEach((r) => { r.state = 'working'; r.message = ''; renderRow(r); });
    try {
        await createContracts(todo);
        for (const row of todo) {
            await attachRow(row);
            renderRow(row);
        }
        await completeContracts(todo);
        todo.forEach(renderRow);
        for (const r of todo.filter((r) => r.state === 'done')) {
            const m = selectedMatch(r);
            toggled.set((m ? m.end_date : r.createdYear || r.doc.end_date || '').slice(0, 4), true);     // montre ce qui vient d'être importé
        }
    } catch (ex) {
        $('#bulk-error').textContent = ex.message;
    }
    toggled.delete('');
    setBulkBusy(false);
    load();
}
$('#bulk-run').onclick = runBulk;

/* ---------- Entrée : un seul bouton dans le menu d'ajout ---------- */
$('#import-pdf').onclick = () => {
    toggleAddMenu(false);
    $('#pdf-files').click();
};
$('#pdf-files').addEventListener('change', (e) => {
    const seen = new Set();
    const files = [...e.target.files].filter((f) => {
        const key = `${f.name}|${f.size}|${f.lastModified}`;        // le même fichier choisi deux fois
        return !seen.has(key) && seen.add(key);
    }).sort((a, b) => a.name.localeCompare(b.name));
    e.target.value = '';        // permet de rechoisir les mêmes fichiers
    if (!files.length) return;
    if (files.length === 1) importSingle(files[0]);
    else importMany(files.slice(0, MAX_IMPORT)).then(() => {
        if (files.length > MAX_IMPORT) $('#bulk-error').textContent = `${MAX_IMPORT} PDF au maximum à la fois : les suivants sont ignorés.`;
    });
});