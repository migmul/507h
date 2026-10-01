/* ---------- Déconnexion ---------- */
document.getElementById('logout')?.addEventListener('click', async () => {
    const csrf = document.querySelector('meta[name="csrf-token"]').content;
    await fetch('/api/logout', {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrf },
    });
    location.href = '/login';
});

/* ---------- Thème : Auto -> Clair -> Sombre ---------- */
const THEMES = ['auto', 'light', 'dark'];
const LABELS = { auto: 'Auto', light: 'Clair', dark: 'Sombre' };
const themeBtn = document.getElementById('theme-toggle');

function storedTheme() {
    try {
        const t = localStorage.getItem('theme');
        return THEMES.includes(t) ? t : 'auto';
    } catch (e) {
        return 'auto';
    }
}

function showTheme(t) {
    if (!themeBtn) return;
    themeBtn.textContent = LABELS[t];
    themeBtn.setAttribute('aria-label', `Thème : ${LABELS[t]} (cliquer pour changer)`);
}

function applyTheme(t) {
    if (t === 'auto') {
        delete document.documentElement.dataset.theme;
    } else {
        document.documentElement.dataset.theme = t;
    }
    try {
        if (t === 'auto') {
            localStorage.removeItem('theme');
        } else {
            localStorage.setItem('theme', t);
        }
    } catch (e) {
        // stockage indisponible : le choix vaut pour cette page seulement
    }
    showTheme(t);
}

showTheme(storedTheme());
themeBtn?.addEventListener('click', () => {
    applyTheme(THEMES[(THEMES.indexOf(storedTheme()) + 1) % THEMES.length]);
});