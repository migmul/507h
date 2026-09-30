const $ = (s) => document.querySelector(s);
const csrf = document.querySelector('meta[name="csrf-token"]').content;
let mode = 'login';

function setMode(m) {
    mode = m;
    $('#tab-login').classList.toggle('active', m === 'login');
    $('#tab-register').classList.toggle('active', m === 'register');
    $('#auth-submit').textContent = m === 'login' ? 'Se connecter' : 'Créer mon compte';
    $('#pwd-hint').hidden = m === 'login';
    $('#confirm-label').hidden = m === 'login';
    $('input[name=password_confirm]').required = m === 'register';
    $('input[name=password]').autocomplete = m === 'login' ? 'current-password' : 'new-password';
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
    const res = await fetch(`/api/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify(body),
    });
    if (res.ok) { location.href = '/'; return; }
    const data = await res.json().catch(() => ({}));
    $('#auth-error').textContent = data.error || 'Erreur inattendue';
});