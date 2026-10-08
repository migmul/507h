/* Utilitaires communs à toutes les pages (chargé avant nav.js et les scripts de page) */
const $ = (s) => document.querySelector(s);
const csrf = document.querySelector('meta[name="csrf-token"]').content;
const isMobile = () => window.matchMedia('(max-width: 700px)').matches;

const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const fh = (h) => (h == null ? '–' : `${nf1.format(h)} h`);
const money = (v) => (v == null ? '–' : eur.format(v));
const fdate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('fr-FR');

// Crée un élément ; le texte est inséré en textContent (jamais en HTML)
function el(tag, text, cls) {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
}

// Remplit une liste « clé / valeur »
function kv(ul, rows) {
    ul.replaceChildren(...rows.map(([k, v]) => {
        const li = document.createElement('li');
        li.append(el('span', k, 'k'), el('strong', v));
        return li;
    }));
}

// Appel de l'API : JSON ou FormData, jeton CSRF, erreurs en exception (avec `details` si le serveur en fournit)
async function api(path, method = 'GET', body) {
    const headers = { 'X-CSRF-Token': csrf };
    let payload;
    if (body instanceof FormData) {
        payload = body;
    } else if (body) {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
    }
    let res;
    try {
        res = await fetch(path, { method, headers, body: payload });
    } catch (e) {
        throw new Error('Connexion au serveur impossible');
    }
    // Session expirée : retour à la connexion (sauf sur la page de connexion elle-même)
    if (res.status === 401 && location.pathname !== '/login') {
        location.href = '/login';
        return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const e = new Error(data.error || 'Erreur');
        e.details = data.details;
        throw e;
    }
    return data;
}

// Modale : boutons [data-close] et fermeture au clic sur le fond
// (le clic doit commencer ET finir sur le fond, pour ne pas fermer pendant une sélection de texte)
function bindDialog(dialog) {
    dialog.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => dialog.close(); });
    let down = false;
    dialog.addEventListener('mousedown', (e) => { down = e.target === dialog; });
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog && down) dialog.close();
        down = false;
    });
}
