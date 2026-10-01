(() => {
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
            delete document.documentElement.dataset.theme;
        } else {
            document.documentElement.dataset.theme = t;
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
    window.Theme = { get, set };
})();