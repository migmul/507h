const $ = (s) => document.querySelector(s);
const csrf = document.querySelector('meta[name="csrf-token"]').content;

async function post(path, body) {
    const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
}

function setMsg(node, text, ok = false) {
    node.textContent = text;
    node.classList.toggle('ok', ok);
}

// Le jeton est lu une fois puis retiré de l'adresse (historique, copier-coller)
const token = new URLSearchParams(location.search).get('token') || '';
if (token) history.replaceState(null, '', location.pathname);

const forgotForm = $('#forgot-form');
if (forgotForm) {
    const msg = forgotForm.querySelector('.msg');
    forgotForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        setMsg(msg, '');
        const r = await post('/api/password/forgot', { email: new FormData(forgotForm).get('email') });
        setMsg(msg, r.ok ? r.data.message : (r.data.error || 'Erreur'), r.ok);
    });
}

const resetForm = $('#reset-form');
if (resetForm) {
    const msg = resetForm.querySelector('.msg');
    if (!token) setMsg(msg, 'Lien invalide ou expiré. Refais une demande depuis « Mot de passe oublié ».');
    resetForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        setMsg(msg, '');
        const f = Object.fromEntries(new FormData(resetForm));
        if (f.password !== f.password_confirm) {
            setMsg(msg, 'Les mots de passe ne correspondent pas');
            return;
        }
        const r = await post('/api/password/reset', { token, ...f });
        if (r.ok) {
            setMsg(msg, 'Mot de passe modifié. Tu peux te connecter.', true);
            resetForm.querySelector('button[type=submit]').hidden = true;
        } else {
            setMsg(msg, r.data.error || 'Erreur');
        }
    });
}

const confirmBtn = $('#confirm-btn');
if (confirmBtn) {
    const msg = $('#confirm-msg');
    if (!token) {
        setMsg(msg, 'Lien invalide ou expiré.');
        confirmBtn.hidden = true;
    }
    confirmBtn.addEventListener('click', async () => {
        const r = await post('/api/email/confirm', { token });
        if (r.ok) {
            setMsg(msg, r.data.kind === 'email_change'
                ? 'Ta nouvelle adresse e-mail est confirmée.' : 'Ton adresse e-mail est vérifiée.', true);
            confirmBtn.hidden = true;
        } else {
            setMsg(msg, r.data.error || 'Erreur');
        }
    });
}

Boot.ready();