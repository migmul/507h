const $ = (s) => document.querySelector(s);
const csrf = document.querySelector('meta[name="csrf-token"]').content;
const NS = 'http://www.w3.org/2000/svg';
const COLORS = ['#ff5a36', '#4cc9f0', '#5ad19a', '#f5b942', '#b388ff', '#ff8fab', '#8bd3dd', '#9aa3b5'];
const eur0 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const fh = (h) => (h == null ? '–' : `${nf1.format(h)} h`);
const fmonth = (m, long) => new Date(m + '-01T00:00:00').toLocaleDateString(
    'fr-FR', long ? { month: 'long', year: 'numeric' } : { month: 'short', year: '2-digit' });
const fdate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('fr-FR');
let stats = null;
let calYear = new Date().getFullYear();

async function api(path, method = 'GET') {
    const res = await fetch(path, { method, headers: { 'X-CSRF-Token': csrf } });
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

function s(tag, attrs = {}, text) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text !== undefined) n.textContent = text;
    return n;
}

function kv(ul, rows) {
    ul.replaceChildren(...rows.map(([k, v]) => {
        const li = document.createElement('li');
        li.append(el('span', k, 'k'), el('strong', v));
        return li;
    }));
}

/* ---------- Infobulle ---------- */
const tip = el('div', undefined, 'tip');
tip.hidden = true;
document.body.append(tip);

function showTip(e, text) {
    tip.textContent = text;
    tip.hidden = false;
    const pad = 14;
    const r = tip.getBoundingClientRect();
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - pad;
    tip.style.left = Math.max(8, x) + 'px';
    tip.style.top = Math.max(8, y) + 'px';
}

function hover(node, text) {
    node.addEventListener('mouseenter', (e) => showTip(e, text));
    node.addEventListener('mousemove', (e) => showTip(e, text));
    node.addEventListener('mouseleave', () => { tip.hidden = true; });
    node.addEventListener('click', (e) => showTip(e, text));    // au toucher
}

document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.hz, .seg, .cd')) tip.hidden = true;
});

const niceMax = (v) => {
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const f = v / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
};

function legend(series) {
    const d = el('div', undefined, 'legend');
    for (const x of series) {
        const sp = el('span');
        const sw = el('i', undefined, 'sw');
        sw.style.background = x.color;
        sp.append(sw, x.label);
        d.append(sp);
    }
    return d;
}

/* ---------- Histogrammes ---------- */
function barChart(box, items, o) {
    if (!items.length || items.every((it) => it.vals.every((v) => !v))) {
        box.replaceChildren(el('p', 'Aucune donnée sur la période.', 'muted'));
        return;
    }
    const W = Math.max(300, Math.min(760, box.clientWidth || 760));
    const narrow = W < 500;
    const H = narrow ? 240 : 280;
    const L = narrow ? 40 : 52;
    const R = 8;
    const T = 14;
    const B = 34;
    const iw = W - L - R;
    const ih = H - T - B;
    const totals = items.map((it) => (
        o.mode === 'stack' ? it.vals.reduce((a, b) => a + b, 0) : Math.max(...it.vals)));
    const max = niceMax(Math.max(1, ...totals, o.ref ? o.ref.value : 0));
    const y = (v) => T + ih - (v / max) * ih;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });

    for (let i = 0; i <= 4; i++) {
        const v = (max / 4) * i;
    svg.append(
        s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'grid' }),
        s('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'axis' }, o.fmt(v)));
        }

    const bw = iw / items.length;
    const step = Math.ceil(items.length / Math.max(1, Math.floor(iw / 44)));
    const n = o.series.length;
    items.forEach((it, i) => {
        const gx = L + i * bw;
        const bar = (x, w, v0, v1, color) => {
            if (v1 - v0 <= 0) return;
            svg.append(s('rect', {
                x, y: y(v1), width: w, height: y(v0) - y(v1),
                fill: color, rx: 2, opacity: it.partial ? 0.55 : 1,
            }));
        };
        if (o.mode === 'stack') {
            let acc = 0;
            it.vals.forEach((v, k) => {
                bar(gx + bw * 0.15, bw * 0.7, acc, acc + v, o.series[k].color);
                acc += v;
            });
        } else {
            const w = (bw * 0.8) / n;
            it.vals.forEach((v, k) => bar(gx + bw * 0.1 + k * w, w, 0, v, o.series[k].color));
        }
        if (i % step === 0) {
            svg.append(s('text', {
                x: gx + bw / 2, y: H - 12, 'text-anchor': 'middle', class: 'axis',
            }, it.label));
        }
    });

    if (o.ref) {
        svg.append(
            s('line', { x1: L, x2: W - R, y1: y(o.ref.value), y2: y(o.ref.value), class: 'ref' }),
            s('text', {
                x: W - R, y: y(o.ref.value) - 4, 'text-anchor': 'end', class: 'ref-text',
            }, o.ref.label));
    }

    // zones de survol : une colonne par élément, sur toute la hauteur du graphique
    items.forEach((it, i) => {
        const zone = s('rect', { x: L + i * bw, y: T, width: bw, height: ih, class: 'hz' });
        hover(zone, it.tip);
        svg.append(zone);
    });
    box.replaceChildren(svg, legend(o.series));
}

/* ---------- Anneau ---------- */
function donut(box, parts, fmt) {
    const total = parts.reduce((a, p) => a + p.value, 0);
    if (!total) {
        box.replaceChildren(el('p', 'Aucune donnée sur la période.', 'muted'));
        return;
    }
    const R = 70;
    const C = 2 * Math.PI * R;
    let off = 0;
    const svg = s('svg', { viewBox: '0 0 200 200', role: 'img' });
    parts.forEach((p, i) => {
        const len = (p.value / total) * C;
        const c = s('circle', {
            cx: 100, cy: 100, r: R, fill: 'none', class: 'seg',
            stroke: COLORS[i % COLORS.length], 'stroke-width': 34,
            'stroke-dasharray': `${len} ${C - len}`, 'stroke-dashoffset': -off,
            transform: 'rotate(-90 100 100)',
        });
        hover(c, `${p.label}\n${fmt(p.value)} (${Math.round((p.value / total) * 100)} %)\n${p.extra}`);
        svg.append(c);
        off += len;
    });
    svg.append(s('text', {
        x: 100, y: 106, 'text-anchor': 'middle', class: 'donut-total',
    }, fmt(total)));

    const ul = document.createElement('ul');
    parts.forEach((p, i) => {
        const li = document.createElement('li');
        const name = el('span');
        const sw = el('i', undefined, 'sw');
        sw.style.background = COLORS[i % COLORS.length];
        name.append(sw, p.label);
        li.append(name, el('strong', `${Math.round((p.value / total) * 100)} %`));
        ul.append(li);
    });
    const wrap = el('div', undefined, 'donut-wrap');
    wrap.append(svg, ul);
    box.replaceChildren(wrap);
}

/* ---------- Calendrier ---------- */
/* ---------- Calendrier ---------- */
const iso = (d) => d.toISOString().slice(0, 10);

function eachDay(a, b, fn) {
    const end = new Date(b + 'T00:00:00Z');
    for (let d = new Date(a + 'T00:00:00Z'); d <= end; d = new Date(d.getTime() + 864e5)) {
        fn(iso(d));
    }
}

const MARK_PRIORITY = ['anniv', 'end', 'start', 'fct', 'pay'];
const MARK_LABEL = {
    anniv: 'Date anniversaire',
    end: 'Fin effective du droit (réexamen anticipé)',
    start: "Début d'indemnisation",
    fct: 'Fin de contrat retenue (FCT)',
    pay: 'Virement France Travail',
};

let calMonth = new Date().getMonth();
const isMobileCal = () => window.matchMedia('(max-width: 700px)').matches;

// Contrats, virements et repères des droits entre deux dates (incluses)
function buildDays(from, to) {
    const days = {};
    const get = (d) => (days[d] ||= { contracts: [], marks: new Set(), notes: [] });
    const ev = stats.events;
    for (const c of ev.contracts) {
        if (c.e < from || c.s > to) continue;
        const label = `${c.emp}${c.mission ? ' – ' + c.mission : ''} (${Math.round(c.h * 10) / 10} h)`;
        eachDay(c.s < from ? from : c.s, c.e > to ? to : c.e, (d) => get(d).contracts.push(label));
    }
    for (const p of ev.payments) {
        if (p.d >= from && p.d <= to) {
            const g = get(p.d);
            g.marks.add('pay');
            g.notes.push(`Virement France Travail : ${eur0.format(p.a)} (${fmonth(p.m, true)})`);
        }
    }
    for (const r of ev.rights) {
        if (r.d >= from && r.d <= to) {
            const g = get(r.d);
            g.marks.add(r.kind);
            g.notes.push(MARK_LABEL[r.kind] + (r.early ? ' (droit remplacé avant terme)' : ''));
        }
    }
    return days;
}

// Icône de gâteau dessinée au trait, intégrée au code (aucun fichier externe)
const CAKE_PATHS = [
    'M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8',
    'M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1',
    'M2 21h20',
    'M7 8v3M12 8v3M17 8v3',
    'M7 4h.01M12 4h.01M17 4h.01',
];

function cakeIcon() {
    const svg = s('svg', { viewBox: '0 0 24 24', class: 'icon-cake', 'aria-hidden': 'true' });
    for (const d of CAKE_PATHS) svg.append(s('path', { d }));
    return svg;
}

function dayCell(key, info, todayIso, dt) {
    const cell = el('div', String(dt.getUTCDate()), 'cd');
    if ([0, 6].includes(dt.getUTCDay())) cell.classList.add('we');
    if (key === todayIso) cell.classList.add('today');
    if (info) {
        if (info.contracts.length) cell.classList.add(info.contracts.length > 1 ? 'c2' : 'c1');
        const mark = MARK_PRIORITY.find((k) => info.marks.has(k));
        if (mark === 'anniv') cell.append(cakeIcon());
        else if (mark) cell.classList.add('m-' + mark);
        hover(cell, [fdate(key), ...info.contracts, ...info.notes].join('\n'));
    }
    return cell;
}

function renderCalendar() {
    const grid = $('#cal');
    const todayIso = iso(new Date(Date.now() - new Date().getTimezoneOffset() * 60000));

    if (isMobileCal()) {
        // Mobile : un seul mois, grille de sept colonnes (lundi en premier)
        const first = new Date(Date.UTC(calYear, calMonth, 1));
        const len = new Date(Date.UTC(calYear, calMonth + 1, 0)).getUTCDate();
        $('#cal-year').textContent = first.toLocaleDateString(
            'fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
        const days = buildDays(iso(first), iso(new Date(Date.UTC(calYear, calMonth, len))));
        const cells = ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((w) => el('span', w, 'wd'));
        for (let i = 0; i < (first.getUTCDay() + 6) % 7; i++) cells.push(el('div', '', 'cd off'));
        for (let d = 1; d <= len; d++) {
            const dt = new Date(Date.UTC(calYear, calMonth, d));
            const key = iso(dt);
            cells.push(dayCell(key, days[key], todayIso, dt));
        }
        grid.className = 'cal-month';
        grid.replaceChildren(...cells);
        return;
    }

    // Ordinateur : l'année entière, un mois par ligne
    $('#cal-year').textContent = calYear;
    const days = buildDays(`${calYear}-01-01`, `${calYear}-12-31`);
    const cells = [el('span', '')];
    for (let d = 1; d <= 31; d++) cells.push(el('span', String(d), 'ml'));
    for (let m = 0; m < 12; m++) {
        const name = new Date(Date.UTC(calYear, m, 1)).toLocaleDateString(
            'fr-FR', { month: 'long', timeZone: 'UTC' });
        cells.push(el('span', name, 'ml mn'));
        const len = new Date(Date.UTC(calYear, m + 1, 0)).getUTCDate();
        for (let d = 1; d <= 31; d++) {
            if (d > len) {
                cells.push(el('div', '', 'cd off'));
                continue;
            }
            const dt = new Date(Date.UTC(calYear, m, d));
            const key = iso(dt);
            cells.push(dayCell(key, days[key], todayIso, dt));
        }
    }
    grid.className = 'cal';
    grid.replaceChildren(...cells);
}

function shiftCalendar(step) {
    if (isMobileCal()) {
        calMonth += step;
        if (calMonth < 0) {
            calMonth = 11;
            calYear--;
        } else if (calMonth > 11) {
            calMonth = 0;
            calYear++;
        }
    } else {
        calYear += step;
    }
    renderCalendar();
}

/* ---------- Rendu ---------- */
function render() {
    const st = stats;
    const hs = st.hours_stats;
    const total = st.income.total;
    const hasBest = total && total.best > 0;

    $('#stats-range').textContent = `Du ${fdate(st.period.first)} au ${fdate(st.period.last)}`;

    // Chiffres clés
    $('#t-hours').textContent = fh(st.hours_total);
    $('#t-hours-sub').textContent = st.hours_per_week != null ? `soit ${fh(st.hours_per_week)} par semaine` : '';
    $('#t-month').textContent = hs ? fh(hs.mean) : '–';
    $('#t-month-sub').textContent = hs ? `médiane ${fh(hs.median)}` : '';
    $('#t-income').textContent = total ? eur0.format(total.mean) : '–';
    $('#t-income-sub').textContent = total ? `médiane ${eur0.format(total.median)}` : '';
    $('#t-best').textContent = hasBest ? eur0.format(total.best) : '–';
    $('#t-best-sub').textContent = hasBest ? fmonth(total.best_month, true) : '';

    // Détails repliés
    kv($('#hours-kpi'), [
        ['Heures sur la période', fh(st.hours_total)],
        ['Moyenne par semaine', fh(st.hours_per_week)],
        ['Moyenne par mois', hs ? fh(hs.mean) : '–'],
        ['Médiane par mois', hs ? fh(hs.median) : '–'],
        ['Meilleur mois', hs && hs.best > 0 ? `${fmonth(hs.best_month, true)} · ${fh(hs.best)}` : '–'],
    ]);
    const rows = $('#income-rows');
    rows.replaceChildren();
    for (const [key, label] of [['salary', 'Salaires nets'], ['are', 'ARE'], ['total', 'Revenu total']]) {
        const x = st.income[key];
        const tr = document.createElement('tr');
        tr.append(
            el('td', label),
            el('td', x && x.best > 0 ? `${fmonth(x.best_month, true)} · ${eur0.format(x.best)}` : '–'),
            el('td', x ? eur0.format(x.mean) : '–', 'num'),
            el('td', x ? eur0.format(x.median) : '–', 'num'));
        rows.append(tr);
    }

    // Méthode et mise en garde
    $('#method-note').textContent =
        "Heures et salaires sont répartis au prorata des jours de chaque contrat, jusqu'à aujourd'hui. " +
        "L'ARE est rattachée au mois concerné du virement. " +
        'Les moyennes et médianes excluent les mois incomplets (mois en cours, premier mois partiel).';
    const tag = $('#no-net-tag');
    tag.hidden = !st.no_net;
    tag.textContent = `${st.no_net} contrat(s) sans net`;

    // Graphiques
    const months = st.series;
    const note = (m) => (m.complete ? '' : '\n(mois incomplet)');

    barChart($('#chart-hours'), months.map((m) => ({
        label: fmonth(m.month),
        vals: [m.hours],
        partial: !m.complete,
        tip: `${fmonth(m.month, true)}\nHeures : ${fh(m.hours)}${note(m)}`,
    })), {
        mode: 'group',
        series: [{ label: 'Heures', color: COLORS[0] }],
        fmt: (v) => Math.round(v),
    });

    barChart($('#chart-income'), months.map((m) => ({
        label: fmonth(m.month),
        vals: [m.salary, m.are],
        partial: !m.complete,
        tip: `${fmonth(m.month, true)}\nSalaires nets : ${eur0.format(m.salary)}\n` +
            `ARE : ${eur0.format(m.are)}\nTotal : ${eur0.format(m.total)}${note(m)}`,
    })), {
        mode: 'stack',
        series: [{ label: 'Salaires nets', color: COLORS[0] }, { label: 'ARE', color: COLORS[1] }],
        fmt: (v) => eur0.format(v),
    });

    renderDonuts();
    if ($('#cal-details').open) renderCalendar();    // calculé seulement s'il est déplié
}

function renderDonut(boxSel, modeSel, list) {
    const mode = $(modeSel).value;
    const items = list.filter((e) => e[mode] > 0).sort((a, b) => b[mode] - a[mode]);
    const parts = items.slice(0, 7).map((e) => ({
        label: e.name,
        value: e[mode],
        extra: `${e.contracts} contrat(s) · ${fh(e.hours)} · ${eur0.format(e.net)}`,
    }));
    const others = items.slice(7);
    if (others.length) {
        parts.push({
            label: `Autres (${others.length})`,
            value: others.reduce((a, e) => a + e[mode], 0),
            extra: `${others.reduce((a, e) => a + e.contracts, 0)} contrat(s)`,
        });
    }
    donut($(boxSel), parts, mode === 'hours' ? fh : (v) => eur0.format(v));
}

function renderDonuts() {
    renderDonut('#chart-dep', '#dep-mode', stats.employers);
    renderDonut('#chart-jobs', '#jobs-mode', stats.jobs);
}

async function load() {
    stats = await api('/api/stats?period=' + encodeURIComponent($('#period').value));
    render();
}

$('#period').onchange = load;
$('#dep-mode').onchange = renderDonuts;
$('#jobs-mode').onchange = renderDonuts;
$('#cal-prev').onclick = () => shiftCalendar(-1);
$('#cal-next').onclick = () => shiftCalendar(1);
$('#cal-details').addEventListener('toggle', () => {
    if ($('#cal-details').open) renderCalendar();
});

let lastWidth = window.innerWidth;
let resizeTimer;
window.addEventListener('resize', () => {
    if (window.innerWidth === lastWidth) return;    // ignore la barre d'adresse mobile qui apparaît ou disparaît
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (stats) render(); }, 150);
});

load().finally(() => Boot.ready());