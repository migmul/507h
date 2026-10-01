const $ = (s) => document.querySelector(s);
const csrf = document.querySelector('meta[name="csrf-token"]').content;
let mode = 'login';
let recoveryMode = false;

async function post(path, body) {
    const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
}

function setMode(m) {
    mode = m;
    $('#tab-login').classList.toggle('active', m === 'login');
    $('#tab-register').classList.toggle('active', m === 'register');
    $('#auth-submit').textContent = m === 'login' ? 'Se connecter' : 'Créer mon compte';
    $('#pwd-hint').hidden = m === 'login';
    $('#confirm-label').hidden = m === 'login';
    $('input[name=password_confirm]').required = m === 'register';
    $('input[name=password]').autocomplete = m === 'login' ? 'current-password' : 'new-password';
    const forgot = $('#forgot-row');
    if (forgot) forgot.hidden = m !== 'login';
    $('#auth-error').textContent = '';
}
$('#tab-login').onclick = () => setMode('login');
$('#tab-register').onclick = () => setMode('register');

$('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const body = { email: f.get('email'), password: f.get('password') };
    if (mode === 'register') {
        body.password_confirm = f.get('password_confirm');
        if (body.password !== body.password_confirm) {
            $('#auth-error').textContent = 'Les mots de passe ne correspondent pas';
            return;
        }
    }
    const r = await post(`/api/${mode}`, body);
    if (!r.ok) {
        $('#auth-error').textContent = r.data.error || 'Erreur inattendue';
        return;
    }
    if (r.data.needs_2fa) {
        $('#step-credentials').hidden = true;
        $('#twofa-form').hidden = false;
        $('#twofa-form input[name=code]').focus();
        return;
    }
    location.href = '/';
});

$('#twofa-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await post('/api/login/2fa', { code: new FormData(e.target).get('code') });
    if (r.ok) {
        location.href = '/';
        return;
    }
    $('#twofa-error').textContent = r.data.error || 'Erreur inattendue';
});

$('#use-recovery').onclick = () => {
    recoveryMode = !recoveryMode;
    const input = $('#twofa-form input[name=code]');
    $('#twofa-label-text').textContent = recoveryMode
        ? 'Code de récupération' : 'Code à 6 chiffres de ton application';
    $('#use-recovery').textContent = recoveryMode
        ? "Utiliser le code de l'application" : 'Utiliser un code de récupération';
    input.inputMode = recoveryMode ? 'text' : 'numeric';
    input.value = '';
    input.focus();
};

$('#twofa-cancel').onclick = () => location.reload();

Boot.ready();