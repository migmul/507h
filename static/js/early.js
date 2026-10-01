/* Exécuté dans <head>, avant l'affichage de la page */
(() => {
    const root = document.documentElement;

    /* ---------- Chargement : contenu masqué jusqu'au premier rendu ---------- */
    root.classList.add('booting');
    let done = false;

    const ready = () => {
        if (done) return;
        done = true;
        root.classList.remove('booting');
    };

    setTimeout(ready, 3000);    // garde-fou si un script échoue

    /* ---------- Thème ---------- */
    const KEY = 'theme';
    const CHOICES = ['auto', 'light', 'dark'];

    function get() {
        try {
            const t = localStorage.getItem(KEY);
            return CHOICES.includes(t) ? t : 'auto';
        } catch (e) {
            return 'auto';
        }
    }

    function apply(t) {
        if (t === 'auto') {
            delete root.dataset.theme;
        } else {
            root.dataset.theme = t;
        }
    }

    function set(t) {
        if (!CHOICES.includes(t)) return;
        try {
            if (t === 'auto') {
                localStorage.removeItem(KEY);
            } else {
                localStorage.setItem(KEY, t);
            }
        } catch (e) {
            // stockage indisponible : le choix vaut pour cette page seulement
        }
        apply(t);
    }

    apply(get());
    window.addEventListener('storage', (e) => {
        if (e.key === KEY || e.key === null) apply(get());
    });

    window.Boot = { ready };
    window.Theme = { get, set };
})();