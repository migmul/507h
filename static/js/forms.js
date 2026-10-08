/* Validation visuelle des formulaires : contour rouge sur les champs à corriger */
(() => {
    const MESSAGE = 'Complète les champs obligatoires.';

    function validateForm(form) {
        let first = null;
        for (const field of form.elements) {
            if (!field.willValidate) continue;
            const bad = !field.checkValidity();
            field.classList.toggle('invalid', bad);
            if (bad && !first) first = field;
        }
        if (first) first.focus();
        return !first;
    }

    // Phase de capture : s'exécute avant les gestionnaires propres à chaque formulaire
    document.addEventListener('submit', (e) => {
        const form = e.target;
        if (!(form instanceof HTMLFormElement) || validateForm(form)) return;
        e.preventDefault();
        e.stopPropagation();
        const out = form.querySelector('[data-error], .error, .msg');
        if (out) {
            out.textContent = MESSAGE;
            out.classList.remove('ok');
        }
    }, true);

    const clearIfValid = (e) => {
        const t = e.target;
        if (t.classList && t.classList.contains('invalid') && t.checkValidity()) {
            t.classList.remove('invalid');
        }
    };
    document.addEventListener('input', clearIfValid);
    document.addEventListener('change', clearIfValid);

    // form.reset() (appelé à l'ouverture des modales) efface les marques
    document.addEventListener('reset', (e) => {
        e.target.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
    }, true);
})();