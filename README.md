# 507h

Application web de suivi des **507 heures** pour les intermittents du spectacle (annexes 8 et 10) : contrats, droits au chômage, bulletins de salaire et statistiques, dans un outil auto-hébergeable.

Chaque compte gère ses contrats et ses documents ; les données sont chiffrées au repos et exportables à tout moment.

## Fonctionnalités

- **Contrats** : saisie, modification, suppression (employeur, mission, poste, heures, cachets, annexe 8 ou 10, jours travaillés, brut, net), recherche, filtres, tri, détection de doublons, documents PDF joints et visionneuse intégrée (PDF.js).
- **Progression des 507 h** : fenêtre glissante de 12 mois, heures effectuées et prévues, date de franchissement du seuil, plafonds annuels de jours par employeur, formations (dans la limite de 338 h).
- **Intermittence** : historique des droits (FCT, date anniversaire, AJ nette), réexamen anticipé, virements France Travail, prévisionnel jusqu'à la date anniversaire.
- **Import de PDF** : une AEM (formulaire DAJ 110) ou un bulletin de paie est reconnu, lu et rattaché automatiquement au contrat correspondant ; import en masse (jusqu'à 40 fichiers), création de contrat prérempli, complétion des champs vides. Les données personnelles du formulaire (identité, NIR, adresse, coordonnées bancaires) ne sont jamais lues.
- **Statistiques** : heures et revenus par mois, moyennes et médianes, répartition par employeur et par poste, calendrier d'activité annuel ; graphiques SVG sans bibliothèque externe.
- **Compte** : inscription, vérification d'e-mail, récupération de mot de passe, double authentification TOTP avec codes de secours, gestion des sessions, export complet (JSON + PDF) et suppression définitive du compte.
- **Interface** : thèmes clair / sombre / auto, entièrement responsive (barre de navigation mobile, modales plein écran), accessibilité soignée (`aria-*`), sans framework JavaScript.

## Stack technique

- Python 3.12, Flask 3, SQLite (stdlib `sqlite3`, migrations automatiques dans le code)
- Gunicorn en production, débogueur Werkzeug limité à localhost en développement
- Jinja2, CSS et JS vanilla, PDF.js auto-hébergé
- `pdfplumber` (lecture des PDF en sous-processus isolé), `cryptography` (Fernet), `segno` (QR TOTP), `python-dotenv`
- Docker (image slim, utilisateur non-root) et GitHub Actions (publication sur GHCR)

## Démarrage rapide

### En local

```bash
git clone https://github.com/migmul/507h.git
cd 507h
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python main.py            # écoute sur http://127.0.0.1:5007
```

Avec `DEV=1` dans `.env`, le débogueur est activé (localhost uniquement) et les e-mails sont prévisualisables sur `/dev/mail`.

### Avec Docker

```bash
docker run -d --name 507h \
  -p 8000:8000 \
  -v 507h-instance:/app/instance \
  ghcr.io/migmul/507h:latest
```

L'image est construite à chaque tag `v*` par GitHub Actions. La base SQLite, les clés et les PDF chiffrés vivent dans le volume `/app/instance` ; le point de contrôle `/healthz` est exposé pour la supervision.

## Configuration

Copier `.env.example` vers `.env` et renseigner ce qui est nécessaire. Les clés absentes (`SECRET_KEY`, `FILE_KEY`) sont générées automatiquement au premier démarrage et stockées dans `instance/` (chmod 600).

| Variable | Rôle |
| --- | --- |
| `SECRET_KEY`, `FILE_KEY` | Clés de session et de chiffrement des fichiers (auto-générées si vides) |
| `APP_BASE_URL` | URL publique du site (obligatoire pour les liens des e-mails) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Envoi des e-mails ; `MAIL_CONSOLE=1` écrit les e-mails dans les journaux à la place |
| `HOST`, `DEV` | Adresse d'écoute et mode développement |
| `PROXY_HOPS` | Nombre de proxys de confiance devant l'application (ProxyFix) |

## Structure du projet

```text
main.py        Application Flask (routes, API, base, sécurité, statistiques)
aem.py         Lecture et rapprochement des AEM (formulaire DAJ 110)
bulletin.py    Lecture des bulletins de paie
reader.py      Point d'entrée de l'analyse PDF (reconnaissance du type de document)
templates/     Gabarits Jinja2
static/        CSS, JS vanilla, visionneuse PDF.js
changelog.md   Historique des versions (format Keep a Changelog)
Dockerfile     Image de production
```

## Sécurité

- Protection CSRF, en-têtes de sécurité (CSP stricte, `nosniff`, `frame-ancestors`)
- Mots de passe hachés (Werkzeug), cookies HttpOnly / SameSite / Secure
- Double authentification TOTP, limitation des tentatives de connexion, sessions invalidables
- PDF joints chiffrés au repos (Fernet), stockés hors de `/static`, téléchargement authentifié avec contrôle de propriété
- Lecture des PDF isolée dans un sous-processus (temps et mémoire limités, environnement sans secret)
- Utilisateur non-root dans l'image Docker, débogueur jamais exposé hors localhost
