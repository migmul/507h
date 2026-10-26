/* ---------- Import d'un PDF : AEM ou bulletin de paie ---------- */
const aemDialog = $('#aem-dialog');
bindDialog(aemDialog);
const DOCS = {
    aem: { api: '/api/aem/analyze', title: 'Importer une AEM', the: 'l\'AEM', field: 'AEM', already: 'une AEM jointe' },
    bulletin: { api: '/api/bulletins/analyze', title: 'Importer un bulletin de paie', the: 'le bulletin',
                field: 'Bulletin de paie', already: 'un bulletin de paie joint' },
};
const FILL_LABELS = { gross: 'Brut', net: 'Net avant impôt', days_worked: 'Jours travaillés', cachets: 'Cachets' };
const LEVEL_LABEL = { certain: 'Certain', probable: 'Probable', possible: 'Possible' };
let aemKind = 'aem';         // 'aem' ou 'bulletin' : le document en cours d'import
let aemFile = null;
let aemData = null;          // résultat de l'analyse, pour créer un contrat
let aemUploaded = false;     // le PDF est déjà joint : un nouvel essai ne le renvoie pas
let aemChoices = [];         // [{ match, radio }]
let aemFills = [];           // [{ field, value, box }]

// Le formulaire d'édition attend le contrat complet : on le reconstitue à partir de la liste chargée
function contractPayload(c) {
    return {
        annexe: c.annexe, employer: c.employer, job_title: c.job_title, mission: c.mission,
        hours: c.hours, cachets: c.cachets ?? '', days_worked: c.days_worked ?? '',
        start_date: c.start_date, end_date: c.end_date,
        gross: c.gross ?? '', net: c.net ?? '', comment: c.comment,
    };
}

function aemRows(a) {
    const period = !a.end_date || a.end_date === a.start_date
        ? fdate(a.start_date) : `${fdate(a.start_date)} → ${fdate(a.end_date)}`;
    const work = [
        a.hours != null ? fh(a.hours) : '',
        a.cachets ? `${a.cachets} cachet${a.cachets > 1 ? 's' : ''}` : '',
        a.days_worked != null ? `${nf1.format(a.days_worked)} jour${a.days_worked > 1 ? 's' : ''}` : '',
    ].filter(Boolean).join(' · ');
    const rows = [
        ['Employeur', a.employer],
        ['Contrat', period + (a.contract_number ? ` · n° ${a.contract_number}` : '')],
        ['Mois de paie', a.month ? `${a.month.slice(5)}/${a.month.slice(0, 4)}` : '–'],
        ['Travail déclaré', work || '–'],
        ['Brut', money(a.gross)],
    ];
    if (aemKind === 'bulletin') rows.push(['Net avant impôt', money(a.net)]);
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

    kv($('#aem-summary'), aemRows(res.aem));
    $('#aem-warnings').textContent = res.aem.warnings.join(' ');
    $('#aem-warnings').hidden = !res.aem.warnings.length;
    $('#aem-body').hidden = false;
    aemData = res.aem;
    const found = res.matches.length > 0;
    $('#aem-attach').textContent = `Rattacher ${DOCS[aemKind].the}`;
    $('#aem-attach').hidden = !found;
    $('#aem-create').hidden = false;
    $('#aem-create').className = found ? 'ghost' : 'primary inline';

    const list = $('#aem-match-list');
    $('#aem-matches').hidden = !found;
    $('#aem-none').textContent = `Aucun contrat de l'application ne correspond à ce PDF. Tu peux en créer un à partir de ses données.`;
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

async function analyzeAem(file, kind) {
    aemKind = kind;
    aemFile = file;
    aemUploaded = false;
    $('#aem-title').textContent = DOCS[kind].title;
    aemDialog.showModal();
    renderAem({ loading: true });
    const body = new FormData();
    body.append('file', file);
    try {
        renderAem(await api(DOCS[kind].api, 'POST', body));
    } catch (ex) {
        renderAem({ error: ex.message });
    }
}

function bindImport(button, input, kind) {
    $(button).onclick = () => {
        toggleAddMenu(false);
        $(input).click();
    };
    $(input).addEventListener('change', (e) => {
        const file = e.target.files[0];
        e.target.value = '';        // permet de rechoisir le même fichier
        if (file) analyzeAem(file, kind);
    });
}
bindImport('#import-aem', '#aem-file', 'aem');
bindImport('#import-bulletin', '#bulletin-file', 'bulletin');

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
const sentenceCase = (s) => (s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s);
const knownSpelling = (value, known) => known.find((k) => fold(k) === fold(value));

// Valeurs du formulaire de contrat déduites du PDF. Si l'AEM n'en couvre qu'une partie (complémentaire,
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
