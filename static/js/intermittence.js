const $ = (s) => document.querySelector(s);
const csrf = document.querySelector('meta[name="csrf-token"]').content;
const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const fdate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('fr-FR');
const fh = (h) => `${Math.round(h * 10) / 10} h`;
const dialog = $('#rights-dialog');
const form = $('#rights-form');
let overview = null;

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

function render(o) {
    $('#empty-state').hidden = !!o;
    $('#content').hidden = !o;
    if (!o) return;

    $('#da-date').textContent = fdate(o.anniversary_date);
    const badge = $('#da-status');
    badge.className = 'badge ' + o.status;
    badge.textContent = o.status === 'expired' ? 'Droit expiré : nouvel examen à faire'
        : o.status === 'soon' ? `Plus que ${o.days_left} jour(s) : prépare ton examen`
        : `${o.days_left} jours restants`;
    $('#elapsed-bar').style.width = o.elapsed_pct + '%';
    $('#da-detail').textContent =
        `Droit ouvert sur la FCT du ${fdate(o.fct_date)} (annexe ${o.annexe}). Examen le ${fdate(o.exam_date)}.` +
        (o.anniversary_overridden ? ` Date saisie manuellement (calculée : ${fdate(o.anniversary_auto)}).` : '');

    const cur = o.current, aj = cur.aj;
    $('#aj-brut').textContent = aj && aj.brut != null ? `${eur.format(aj.brut)} brut / jour` : '–';
    $('#aj-net').textContent = aj && aj.net != null ? `${eur.format(aj.net)} net / jour` : '';
    const rows = [];
    if (aj) rows.push(['Source', 'Notification France Travail']);
    rows.push(['Période de référence', `${fdate(cur.period_start)} → ${fdate(cur.period_end)}`],
        ['Heures / salaires bruts saisis', `${fh(cur.totals.hours)} · ${eur.format(cur.totals.gross)}`]);
    kv($('#aj-detail'), rows);
    $('#aj-note').textContent = !aj
        ? "Renseigne l'AJ de ta notification avec le bouton « Modifier »."
        : cur.totals.missing_gross ? `${cur.totals.missing_gross} contrat(s) sans brut dans la période : le total des salaires est incomplet.` : '';

    const i = o.indemnisation;
    kv($('#indem-detail'), [
        ['Période', `${fdate(o.start_date)} → ${fdate(o.anniversary_date)}`],
        ['Jours calendaires', String(i.total_days)],
        ["Délai d'attente", `− ${i.waiting} j`],
        ['Franchise congés payés', `− ${i.cp} j`],
        ['Franchise salaires', `− ${i.salary} j`],
        ['Jours indemnisables max.', `${i.max_days} j`],
    ]);

    const p = o.projection;
    $('#proj-bar').style.width = Math.min(100, (p.hours_total / 507) * 100) + '%';
    $('#proj-hours').textContent = fh(p.hours_total);
    $('#proj-msg').textContent = p.hours_needed > 0 ? `· il manque ${fh(p.hours_needed)}` : '· seuil atteint 🎉';
    kv($('#proj-detail'), [
        ['Fenêtre prise en compte', `${fdate(p.window_start)} → ${fdate(p.window_end)}`],
        ['Heures réalisées', fh(p.hours_done)],
        ['Heures prévues (contrats à venir)', fh(p.hours_planned)],
        ['Rythme nécessaire', p.per_week ? `${fh(p.per_week)} / semaine` : '–'],
    ]);
    $('#proj-note').textContent = p.missing_gross
        ? `${p.missing_gross} contrat(s) sans brut : l'AJ projetée est sous-évaluée.` : '';
}

function openDialog() {
    form.reset();
    $('#form-error').textContent = '';
    const s = overview && overview.settings;
    if (s) {
        form.elements.annexe.value = s.annexe;
        form.elements.fct_date.value = s.fct_date;
        form.elements.start_date.value = s.start_date;
        form.elements.anniversary_date.value = s.anniversary_date ?? '';
        form.elements.aj_brute.value = s.aj_brute ?? '';
        form.elements.aj_net.value = s.aj_net ?? '';
        form.elements.waiting_days.value = s.waiting_days;
        form.elements.franchise_cp_days.value = s.franchise_cp_days;
        form.elements.franchise_salary_days.value = s.franchise_salary_days;
    }
    $('#reset-btn').hidden = !s;
    dialog.showModal();
}
const closeDialog = () => dialog.close();
$('#edit-btn').onclick = openDialog;
$('#edit-empty').onclick = openDialog;
$('#cancel').onclick = closeDialog;
$('#close-dialog').onclick = closeDialog;

let downOnBackdrop = false;
dialog.addEventListener('mousedown', (e) => { downOnBackdrop = e.target === dialog; });
dialog.addEventListener('click', (e) => {
    if (e.target === dialog && downOnBackdrop) closeDialog();
    downOnBackdrop = false;
});

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    $('#save-btn').disabled = true;
    try {
        overview = (await api('/api/intermittence', 'PUT', f)).overview;
        render(overview);
        dialog.close();
    } catch (ex) {
        $('#form-error').textContent = ex.message;
    } finally {
        $('#save-btn').disabled = false;
    }
});

$('#reset-btn').onclick = async () => {
    if (!confirm('Effacer les informations de ton droit ARE ? Tes contrats ne sont pas touchés.')) return;
    await api('/api/intermittence', 'DELETE');
    overview = null;
    render(null);
    dialog.close();
};

$('#logout').onclick = async () => { await api('/api/logout', 'POST'); location.href = '/login'; };
(async () => { overview = (await api('/api/intermittence')).overview; render(overview); })();