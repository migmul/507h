/* ---------- Visionneuse PDF : PDF.js hébergé sur le site, dans une modale (ordinateur) ---------- */
// Sur téléphone, le lien de renderDocs (dashboard.js) laisse le navigateur ouvrir le PDF dans un onglet.
// Dépend de dashboard.js (KIND_LABEL) et de static/pdfjs/ (viewer de Mozilla).
const PDF_VIEWER = '/static/pdfjs/web/viewer.html';
const PDF_SKIN = '/static/pdfjs/site-viewer.css';
const pdfDialog = $('#pdf-dialog');
bindDialog(pdfDialog);
const pdfFrame = $('#pdf-frame');
let pdfDownloadUrl = '';

// d = document d'un contrat : { id, kind, name }
function openPdf(d) {
    $('#pdf-title').textContent = `${KIND_LABEL[d.kind]} – ${d.name}`;
    pdfDownloadUrl = `/api/documents/${d.id}?download=1`;
    pdfFrame.src = `${PDF_VIEWER}?file=${encodeURIComponent(`/api/documents/${d.id}`)}#zoom=auto&pagemode=none`;
    pdfDialog.showModal();
    pdfFrame.focus();       // le focus va au viewer, pas au bouton « Télécharger » (cadre bleu) ; les flèches défilent le document
}

$('#pdf-download').onclick = () => { window.location.href = pdfDownloadUrl; };

// Habillage du viewer (même origine : la feuille de style du site est ajoutée dans l'iframe)
pdfFrame.addEventListener('load', () => {
    try {
        const doc = pdfFrame.contentDocument;
        if (doc.location.pathname !== PDF_VIEWER) return;
        const link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = PDF_SKIN;
        doc.head.append(link);
    } catch {
        // viewer absent ou pas encore chargé : il s'affiche simplement sans l'habillage
    }
});

// À la fermeture, le viewer est déchargé : le document n'est pas gardé en mémoire
pdfDialog.addEventListener('close', () => { pdfFrame.src = 'about:blank'; });
