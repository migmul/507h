const $ = (s) => document.querySelector(s);
const csrf = document.querySelector('meta[name="csrf-token"]').content;

async function api(path, method = 'GET', body) {
    const headers = { 'X-CSRF-Token': csrf };
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 401) { location.href = '/login'; return; }
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

bind('#email-form', async (d, form) => {
    await api('/api/account/email', 'POST', d);
    form.reset();
    await loadInfo();
    return 'Adresse e-mail mise à jour.';
});

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
  try { json = JSON.parse(await file.text()); }
  catch { throw new Error('Ce fichier n\'est pas un JSON valide'); }
  const r = await api('/api/account/import', 'POST', json);
  form.reset();
  await loadInfo();
  const rights = { imported: ' Droit ARE importé.', ignored: ' Droit ARE ignoré (déjà renseigné).', none: '' }[r.rights];
  return `${r.added} contrat(s) importé(s), ${r.duplicates} doublon(s) ignoré(s).${rights}`;
});

$('#logout-all').onclick = async () => {
    try {
        await api('/api/account/logout-all', 'POST');
        setMsg($('#misc-msg'), 'Tous les autres appareils ont été déconnectés.', true);
    } catch (ex) {
        setMsg($('#misc-msg'), ex.message);
    }
};
$('#logout').onclick = async () => { await api('/api/logout', 'POST'); location.href = '/login'; };
loadInfo();