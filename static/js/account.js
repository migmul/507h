const $ = (s) => document.querySelector(s);
const csrf = document.querySelector('meta[name="csrf-token"]').content;

async function api(path, method = 'GET', body) {
    const headers = { 'X-CSRF-Token': csrf };
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 401) {
        location.href = '/login';
        return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const e = new Error(data.error || 'Erreur');
        e.details = data.details;
        throw e;
    }
    return data;
}

function setMsg(node, text, ok = false) {
    node.textContent = text;
    node.classList.toggle('ok', ok);
}

async function loadInfo() {
    const a = await api('/api/account');
    $('#acc-email').textContent = a.email;
    const since = new Date(a.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('fr-FR');
    $('#acc-stats').textContent =
        `Inscrit le ${since} · ${a.contracts} contrat(s) · ${a.documents} document(s) PDF`;

    $('#mail-status').hidden = !a.mail_enabled;
    const badge = $('#mail-badge');
    badge.textContent = a.email_verified ? 'Adresse vérifiée' : 'Adresse non vérifiée';
    badge.className = 'badge ' + (a.email_verified ? 'active' : 'soon');
    $('#resend-btn').hidden = a.email_verified;

    $('#twofa-off').hidden = a.totp_enabled;
    $('#twofa-on').hidden = !a.totp_enabled;
    $('#twofa-status').textContent = a.totp_enabled
        ? `Activée · ${a.recovery_left} code(s) de récupération restant(s)`
        : 'Désactivée';
    showAnnexe(a.default_annexe);
}

function bind(formId, handler) {
    const form = $(formId);
    const msg = form.querySelector('.msg');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        setMsg(msg, '');
        const btn = form.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
            const text = await handler(Object.fromEntries(new FormData(form)), form);
            if (text) setMsg(msg, text, true);
        } catch (ex) {
            setMsg(msg, ex.message + (ex.details ? ' — ' + ex.details.join(' ; ') : ''));
        } finally {
            btn.disabled = false;
        }
    });
}

/* ---------- E-mail ---------- */
bind('#email-form', async (d, form) => {
    const r = await api('/api/account/email', 'POST', d);
    form.reset();
    await loadInfo();
    return r.message;
});

$('#resend-btn').onclick = async () => {
    try {
        const r = await api('/api/email/send-verification', 'POST');
        setMsg($('#mail-msg'), r.message, true);
    } catch (ex) {
        setMsg($('#mail-msg'), ex.message);
    }
};

/* ---------- Mot de passe, suppression, import ---------- */
bind('#password-form', async (d, form) => {
    if (d.new !== d.confirm) throw new Error('Les mots de passe ne correspondent pas');
    await api('/api/account/password', 'POST', d);
    form.reset();
    return 'Mot de passe modifié. Les autres appareils ont été déconnectés.';
});

bind('#delete-form', async (d) => {
    if (!confirm('Supprimer définitivement ton compte et toutes tes données ?')) return;
    await api('/api/account', 'DELETE', d);
    location.href = '/login';
});

bind('#import-form', async (d, form) => {
    const file = form.elements.file.files[0];
    if (!file) throw new Error('Choisis un fichier');
    if (file.size > 2 * 1024 * 1024) throw new Error('Fichier trop volumineux (2 Mo max)');
    let json;
    try {
        json = JSON.parse(await file.text());
    } catch {
        throw new Error("Ce fichier n'est pas un JSON valide");
    }
    const r = await api('/api/account/import', 'POST', json);
    form.reset();
    await loadInfo();
    return `${r.added} contrat(s), ${r.rights} droit(s), ${r.payments} virement(s), ` +
        `${r.trainings} formation(s) importé(s), ${r.duplicates} doublon(s) ignoré(s).`;
});

$('#logout-all').onclick = async () => {
    try {
        await api('/api/account/logout-all', 'POST');
        setMsg($('#misc-msg'), 'Tous les autres appareils ont été déconnectés.', true);
    } catch (ex) {
        setMsg($('#misc-msg'), ex.message);
    }
};

/* ---------- Double authentification ---------- */
const tfDialog = $('#twofa-dialog');
const tfSteps = ['#tf-step-1', '#tf-step-2', '#tf-step-3'];

function tfShow(n) {
    tfSteps.forEach((s, i) => { $(s).hidden = i !== n - 1; });
}

function tfCodes(codes, title) {
    $('#tf-title').textContent = title;
    $('#tf-codes').textContent = codes.join('\n');
    tfShow(3);
    if (!tfDialog.open) tfDialog.showModal();
}

function tfClose() {
    if (!$('#tf-step-3').hidden && !confirm("Tu n'as pas encore noté tes codes. Fermer quand même ?")) return;
    tfDialog.close();
    loadInfo();
}

$('#twofa-start').onclick = () => {
    $('#tf-title').textContent = 'Activer la double authentification';
    tfDialog.querySelectorAll('form').forEach((f) => f.reset());
    tfDialog.querySelectorAll('.msg').forEach((m) => setMsg(m, ''));
    tfShow(1);
    tfDialog.showModal();
};
$('#tf-close').onclick = tfClose;
$('#tf-done').onclick = tfClose;
tfDialog.addEventListener('cancel', (e) => {
    e.preventDefault();         // Échap : même garde-fou que le bouton de fermeture
    tfClose();
});

bind('#tf-pass-form', async (d) => {
    const r = await api('/api/2fa/setup', 'POST', d);
    $('#tf-qr').src = '/api/2fa/qr.svg?t=' + Date.now();
    $('#tf-secret').textContent = r.secret.replace(/(.{4})/g, '$1 ').trim();
    tfShow(2);
});

bind('#tf-code-form', async (d) => {
    const r = await api('/api/2fa/enable', 'POST', d);
    tfCodes(r.recovery_codes, 'Codes de récupération');
});

$('#tf-copy').onclick = () => navigator.clipboard?.writeText($('#tf-codes').textContent);

bind('#twofa-manage', async (d, form) => {
    await api('/api/2fa/disable', 'POST', d);
    form.reset();
    await loadInfo();
    return 'Double authentification désactivée.';
});

$('#twofa-regen').onclick = async () => {
    const form = $('#twofa-manage');
    const msg = form.querySelector('.msg');
    setMsg(msg, '');
    try {
        const r = await api('/api/2fa/recovery', 'POST', Object.fromEntries(new FormData(form)));
        form.reset();
        tfCodes(r.recovery_codes, 'Nouveaux codes de récupération');
    } catch (ex) {
        setMsg(msg, ex.message);
    }
};

/* ---------- Apparence (propre au navigateur) ---------- */
const themeButtons = document.querySelectorAll('[data-theme-choice]');

function showTheme() {
    const current = Theme.get();
    themeButtons.forEach((b) => {
        const on = b.dataset.themeChoice === current;
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', String(on));
    });
}

themeButtons.forEach((b) => {
    b.addEventListener('click', () => {
        Theme.set(b.dataset.themeChoice);
        showTheme();
    });
});

/* ---------- Annexe par défaut des nouveaux contrats ---------- */
const annexeButtons = document.querySelectorAll('[data-annexe-choice]');

function showAnnexe(a) {
    annexeButtons.forEach((b) => {
        const on = Number(b.dataset.annexeChoice) === a;
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', String(on));
    });
}

annexeButtons.forEach((b) => {
    b.addEventListener('click', async () => {
        const a = Number(b.dataset.annexeChoice);
        try {
            await api('/api/account/preferences', 'POST', { default_annexe: a });
            showAnnexe(a);
            setMsg($('#pref-msg'), 'Enregistré.', true);
        } catch (ex) {
            setMsg($('#pref-msg'), ex.message);
        }
    });
});

showTheme();
loadInfo().finally(() => Boot.ready());