(() => {
    try {
        const t = localStorage.getItem('theme');
        if (t === 'light' || t === 'dark') {
            document.documentElement.dataset.theme = t;
        }
    } catch (e) {
        // stockage indisponible : on reste en mode automatique
    }
})();