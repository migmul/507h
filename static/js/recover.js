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
                try {
            const r = await api('/api/password/forgot', 'POST', { email: new FormData(forgotForm).get('email') });
            setMsg(msg, r.message, true);
        } catch (ex) {
            setMsg(msg, ex.message);
        }
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
                try {
            await api('/api/password/reset', 'POST', { token, ...f });
            setMsg(msg, 'Mot de passe modifié. Tu peux te connecter.', true);
            resetForm.querySelector('button[type=submit]').hidden = true;
        } catch (ex) {
            setMsg(msg, ex.message);
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
                try {
            const r = await api('/api/email/confirm', 'POST', { token });
            setMsg(msg, r.kind === 'email_change'
                ? 'Ta nouvelle adresse e-mail est confirmée.' : 'Ton adresse e-mail est vérifiée.', true);
            confirmBtn.hidden = true;
        } catch (ex) {
            setMsg(msg, ex.message);
        }
    });
}

Boot.ready();