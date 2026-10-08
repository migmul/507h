let mode = 'login';
let recoveryMode = false;

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
        let r;
    try {
        r = await api(`/api/${mode}`, 'POST', body);
    } catch (ex) {
        $('#auth-error').textContent = ex.message;
        return;
    }
    if (r.needs_2fa) {
        $('#step-credentials').hidden = true;
        $('#twofa-form').hidden = false;
        $('#twofa-form input[name=code]').focus();
        return;
    }
    location.href = '/';
});

$('#twofa-form').addEventListener('submit', async (e) => {
    e.preventDefault();
        try {
        await api('/api/login/2fa', 'POST', { code: new FormData(e.target).get('code') });
        location.href = '/';
    } catch (ex) {
        $('#twofa-error').textContent = ex.message;
    }
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