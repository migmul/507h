const $ = (s) => document.querySelector(s);
const csrf = document.querySelector('meta[name="csrf-token"]').content;
const NS = 'http://www.w3.org/2000/svg';
const COLORS = ['#ff5a36', '#4cc9f0', '#5ad19a', '#f5b942', '#b388ff', '#ff8fab', '#8bd3dd', '#9aa3b5'];
const eur0 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const fh = (h) => (h == null ? '–' : `${Math.round(h * 10) / 10} h`);
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
}

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
    const W = 760, H = 280, L = 52, R = 10, T = 14, B = 34;
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
    const step = Math.ceil(items.length / 12);
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

function renderCalendar() {
    $('#cal-year').textContent = calYear;
    const y0 = `${calYear}-01-01`;
    const y1 = `${calYear}-12-31`;
    const days = {};
    const get = (d) => (days[d] ||= { contracts: [], marks: new Set(), notes: [] });
    const ev = stats.events;

    for (const c of ev.contracts) {
        if (c.e < y0 || c.s > y1) continue;
        const label = `${c.emp}${c.mission ? ' – ' + c.mission : ''} (${Math.round(c.h * 10) / 10} h)`;
        eachDay(c.s < y0 ? y0 : c.s, c.e > y1 ? y1 : c.e, (d) => get(d).contracts.push(label));
    }
    for (const p of ev.payments) {
        if (p.d >= y0 && p.d <= y1) {
            const g = get(p.d);
            g.marks.add('pay');
            g.notes.push(`Virement France Travail : ${eur0.format(p.a)} (${fmonth(p.m, true)})`);
        }
    }
    for (const r of ev.rights) {
        if (r.d >= y0 && r.d <= y1) {
            const g = get(r.d);
            g.marks.add(r.kind);
            g.notes.push(MARK_LABEL[r.kind] + (r.early ? ' (droit remplacé avant terme)' : ''));
        }
    }

    const cells = [el('span', '')];
    for (let d = 1; d <= 31; d++) cells.push(el('span', String(d), 'ml'));
    const todayIso = iso(new Date(Date.now() - new Date().getTimezoneOffset() * 60000));

    for (let m = 0; m < 12; m++) {
        const name = new Date(Date.UTC(calYear, m, 1)).toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' });
        cells.push(el('span', name, 'ml'));
        const len = new Date(Date.UTC(calYear, m + 1, 0)).getUTCDate();
        for (let d = 1; d <= 31; d++) {
            const cell = el('div', d <= len ? String(d) : '', 'cd');
            if (d > len) {
                cell.classList.add('off');
                cells.push(cell);
                continue;
            }
            const dt = new Date(Date.UTC(calYear, m, d));
            const key = iso(dt);
            const info = days[key];
            if ([0, 6].includes(dt.getUTCDay())) cell.classList.add('we');
            if (key === todayIso) cell.classList.add('today');
            if (info) {
                if (info.contracts.length) cell.classList.add(info.contracts.length > 1 ? 'c2' : 'c1');
                const mark = MARK_PRIORITY.find((k) => info.marks.has(k));
                if (mark) cell.classList.add('m-' + mark);
                hover(cell, [fdate(key), ...info.contracts, ...info.notes].join('\n'));
            }
            cells.push(cell);
        }
    }
    $('#cal').replaceChildren(...cells);
}

/* ---------- Rendu ---------- */
function render() {
    const st = stats;
    const hs = st.hours_stats;
    $('#stats-note').textContent =
        `Période : du ${fdate(st.period.first)} au ${fdate(st.period.last)}. ` +
        "Heures et salaires répartis au prorata des jours de chaque contrat, jusqu'à aujourd'hui. " +
        "L'ARE est rattachée au mois concerné du virement. " +
        'Les mois incomplets (mois en cours, premier mois partiel) sont exclus des moyennes et médianes.' +
        (st.no_net ? ` ${st.no_net} contrat(s) sans net sont exclus des revenus.` : '');

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

    barChart($('#chart-rights'), st.rights.map((r) => ({
        label: fdate(r.start_date).slice(0, 5) + '/' + r.start_date.slice(2, 4),
        vals: [r.ref_hours, r.during_hours],
        tip: `Droit du ${fdate(r.start_date)}${r.ended_early ? ' (remplacé avant terme)' : ''}\n` +
            `Heures de référence : ${fh(r.ref_hours)}\nHeures pendant le droit : ${fh(r.during_hours)}`,
    })), {
        mode: 'group',
        series: [
            { label: 'Heures de référence', color: COLORS[0] },
            { label: 'Heures pendant le droit', color: COLORS[2] },
        ],
        ref: { value: 507, label: '507 h' },
        fmt: (v) => Math.round(v),
    });

    renderDependency();
    renderCalendar();
}

function renderDependency() {
    const mode = $('#dep-mode').value;
    const list = stats.employers.filter((e) => e[mode] > 0).sort((a, b) => b[mode] - a[mode]);
    const parts = list.slice(0, 7).map((e) => ({
        label: e.name,
        value: e[mode],
        extra: `${e.contracts} contrat(s) · ${fh(e.hours)} · ${eur0.format(e.net)}`,
    }));
    const others = list.slice(7);
    if (others.length) {
        parts.push({
            label: `Autres (${others.length})`,
            value: others.reduce((a, e) => a + e[mode], 0),
            extra: `${others.reduce((a, e) => a + e.contracts, 0)} contrat(s)`,
        });
    }
    donut($('#chart-dep'), parts, mode === 'hours' ? fh : (v) => eur0.format(v));
}

async function load() {
    stats = await api('/api/stats?period=' + encodeURIComponent($('#period').value));
    render();
}

$('#period').onchange = load;
$('#dep-mode').onchange = renderDependency;
$('#cal-prev').onclick = () => { calYear--; renderCalendar(); };
$('#cal-next').onclick = () => { calYear++; renderCalendar(); };
load();