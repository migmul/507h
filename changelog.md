# Changelog

Toutes les évolutions notables de **507h** sont consignées ici.
Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).

## [0.22.2] - 2026-10-08

### Vérifié
- Tous les gabarits HTML hors e-mails sont structurellement valides (balises équilibrées), sans identifiant dupliqué.
- Les identifiants, champs de formulaires et endpoints référencés par les scripts correspondent aux gabarits et aux routes disponibles.
- `MAIL_CONSOLE=1` est prioritaire sur le SMTP : les e-mails sont écrits dans les journaux et aucun e-mail n'est envoyé.

### Corrigé
- Page Intermittence : la ligne « Dont formation (retenue) » du bloc Détails n'apparaissait jamais, car `training_hours` était placé hors de `projection` dans la réponse de l'API.
- Calendrier d'activité : un clic sur les flèches avant la fin du chargement des données ne provoque plus d'erreur.
- Débogueur de Werkzeug : il n'est plus activé quand l'application écoute sur une adresse autre que locale (`HOST`, `0.0.0.0` par défaut), car il permet d'exécuter du code.

### Modifié
- `main.py` réorganisé par domaines (configuration, base de données, sécurité, e-mails, API, statistiques…), constantes et limites regroupées, imports triés, migrations factorisées (`columns` et `add_column`).
- Limitation des tentatives : fonctions `record_fail`, `clear_fails` et `_recent` à la place de manipulations répétées du dictionnaire `FAILS`.
- Le mode WAL de SQLite est activé une seule fois au démarrage au lieu de chaque requête.
- `finish_login` prend l'identifiant et la version de session ; l'inscription et la connexion partagent la même ouverture de session.
- Scripts : nouveau `common.js` (sélecteur, jeton CSRF, formats, `el`, `kv`, `api`, `bindDialog`, `isMobile`), chargé avant `nav.js`. Les copies de ces fonctions disparaissent des autres scripts ; `auth.js` et `recover.js` utilisent `api` au lieu de leur propre `post`.
- Tableau de bord : chargement en parallèle des contrats, de la progression, des plafonds et des formations ; employeurs suggérés calculés dans le navigateur ; plafond des formations lu dans la réponse de l'API.
- Statistiques : les données du calendrier ne sont plus calculées à chaque changement de période ; elles sont chargées à la première ouverture du calendrier.
- Page Intermittence : la cible des 507 h vient de l'API (`projection.target`).
- Import : le message indique aussi le nombre de plafonds importés.
- Numéro de version `0.22.1`.
- `style.css` nettoyé sans changement visuel volontaire : suppression des règles inutilisées `.span-2` et `.inline-label`, conservation de `select.auto`, regroupement de règles identiques et déplacement de `-webkit-tap-highlight-color` dans la règle `body` principale.
- Le contour au survol des cases du calendrier est limité aux appareils avec pointeur (`@media (hover: hover)`), évitant l'état de survol persistant après un toucher sur mobile.

### Supprimé
- Route `GET /api/employers` (remplacée par un calcul côté navigateur).
- Champs de réponse inutilisés : `contracts` (résumé), `recovery_used`, `elapsed_pct`, `total_days`, `anniversary_auto`, `ref_gross`, `ref_missing_gross`, `estimated`, `contracts` (plafonds), `months`.
- Calculs de salaire brut, de nombre de contrats et d'heures de travail seules dans `period_totals` (plus aucune estimation d'allocation depuis la 0.5).
- Seconde définition de `valid_email` (la première était écrasée).

### Ajouté
- Route `GET /api/calendar` pour le calendrier d'activité.

## [0.22] - 2026-10-08

### Ajouté
- E-mails au format HTML professionnel (vérification de l'adresse, confirmation d'un changement d'adresse, réinitialisation du mot de passe) : carte centrée de 560 px, nom 507h en en-tête, bouton d'action, durée de validité du lien, rappel « si ce n'est pas toi », lien de secours à copier et pied de page. Compatible mode sombre (clients qui le gèrent) et mobile.
- Version texte brut de chaque e-mail (message multipart) pour les clients sans HTML et pour la délivrabilité.
- Modèles `templates/mail/action.html` et `templates/mail/action.txt`, partagés par tous les e-mails d'action.
- Logo d'e-mail automatique : si le fichier `static/img/logo-email.png` existe, il remplace le nom 507h en texte dans l'en-tête des e-mails, sans autre modification.
- Prévisualisation des e-mails dans le navigateur avec `DEV=1` : `/dev/mail` (HTML) et `/dev/mail?text=1` (texte).
- En-tête `Auto-Submitted` et identifiant de message au domaine de l'expéditeur.

### Modifié
- `send_mail` accepte une version HTML en plus du texte ; les trois e-mails existants passent par la nouvelle fonction `send_action_mail`.

## [0.21] - 2026-10-08

### Ajouté
- Validation visuelle des formulaires : à l'envoi, chaque champ obligatoire vide ou invalide est entouré en rouge, le premier reçoit le focus et un message invite à corriger. Le contour rouge disparaît dès que le champ devient valide. Le comportement s'applique à tous les formulaires de l'application (contrats, droits, virements, plafonds, formations, compte, connexion) grâce au fichier `static/js/forms.js`.
- Bouton « + Ajouter un contrat » scindé : une petite flèche à sa droite ouvre un menu (fermeture au clic extérieur ou avec Échap) qui propose « Ajouter une formation ».
- Gestion des formations : les heures de formation professionnelle sont assimilées à des heures de travail pour la recherche des 507 h, dans la limite de 338 h (deux tiers du seuil, partagés avec l'enseignement). Une formation rémunérée par l'assurance chômage (AREF) est enregistrée mais n'est pas retenue.
- Nouvelle carte « Formations » sur la page Contrats, repliée par défaut, visible dès qu'une formation existe : liste, total retenu sur 338 h, modification et suppression.
- Les heures de formation retenues s'ajoutent à la progression des 507 h (tableau de bord, page Intermittence, heures de référence des droits). Le tableau de bord et la page Intermittence indiquent la part de formation.
- Les formations sont exclues des statistiques de revenus, des répartitions, des plafonds de jours et de la détection de doublons : ce ne sont pas des contrats.
- Export et import des formations (`formations` dans `507h-export.json`).
- Nouvelle table `trainings`.

### Modifié
- Hauteur minimale commune des boutons du menu et style du bouton scindé.

## [0.20] - 2026-10-08

### Ajouté
- Annexe sur chaque contrat (8 technicien ou 10 artiste), choisie avec un sélecteur en haut de la fenêtre de saisie. Elle est exportée et importée avec le contrat.
- Réglage « Annexe par défaut des nouveaux contrats » sur la page Compte, enregistré avec le compte. À la mise à jour, il reprend l'annexe du droit en cours (8 sinon), et les contrats existants reçoivent cette annexe.
- Saisie en cachets pour l'annexe 10 : champ « Cachets » (1 cachet = 12 heures). L'équivalent en heures est calculé et affiché dans le champ des heures, qui devient en lecture seule tant qu'un nombre de cachets est saisi. On peut aussi saisir des heures sans cachets. Les calculs existants (progression des 507 h, statistiques, droits) utilisent les heures équivalentes.
- Liste des contrats : le nombre de cachets apparaît sous les heures des contrats saisis en cachets.
- Tableau de bord : pour l'annexe 10, la carte de progression indique l'équivalent en cachets (par exemple « Soit environ 20 cachets sur 43 »).
- Statistiques : pour l'annexe 10, le graphique mensuel permet d'afficher les cachets au lieu des heures.
- Migration automatique : colonnes `annexe` et `cachets` sur `contracts`, colonne `default_annexe` sur `users`.

### Modifié
- Plafonds de jours travaillés : sans nombre de jours saisi, un contrat en cachets compte un jour par cachet (au lieu de heures ÷ 8).
- Mobile : l'unité « h » à côté des heures dans la liste des contrats est ajoutée par le script (et non plus par le style), pour laisser la place au nombre de cachets.

## [0.19.1] - 2026-10-04

### Modifié
- Calendrier : la date anniversaire est repérée par une icône de gâteau SVG intégrée directement dans la page (plus de fichier externe, plus d'émoji système), dessinée au trait comme les icônes du menu. Elle prend la couleur du thème et passe en blanc sur un jour de contrat en orange vif. La même icône est utilisée dans la légende.
- Tableau de bord, carte « Ma progression » : le pourcentage est placé juste sous la barre, aligné à droite, à la hauteur de la première ligne de texte, sans espace entre la barre et lui.
- Mobile : le double appui ne zoome plus la page (`touch-action: manipulation`). Le zoom par pincement reste possible.

## [0.19] - 2026-10-04

### Modifié
- Tableau de bord, carte « Ma progression » : le texte est raccourci en « Il te manque 267 h avant le 30/05/2027 » (la ligne sur la fin de contrat retenue disparaît ; sans droit renseigné, la phrase précise « sur les 12 derniers mois »). La date n'est pas affichée si la date anniversaire est passée.
- Tableau de bord, mobile : le pourcentage ne passe plus sur deux lignes (« 47 » puis « % ») et garde sa place à droite.
- Intermittence, mobile : la ligne du droit en cours dans l'historique n'est plus décalée par rapport aux autres ; seul son fond teinté déborde de la carte.
- Statistiques, calendrier d'activité : sur mobile, affichage d'un seul mois à la fois (grille de sept colonnes, lundi en premier) avec boutons mois précédent et mois suivant. Sur ordinateur, la vue annuelle est conservée.
- Statistiques, calendrier : la date anniversaire est repérée par un gâteau au lieu d'une étoile.

## [0.18] - 2026-10-02

### Ajouté
- Déploiement par conteneur Docker : `Dockerfile` (Python 3.12 slim, utilisateur sans privilèges, un worker Gunicorn à quatre threads, données dans le volume `/app/instance`) et `.dockerignore`.
- Publication automatique de l'image sur GitHub Container Registry (`ghcr.io/migmul/507h`) par GitHub Actions à chaque tag de version commençant par `v` (`v0.18.0`, `v0.18.1`, etc.). L'image reçoit une étiquette du nom du tag (par exemple `v0.18.1`) et l'étiquette `latest`.
- Point de contrôle `/healthz` (sans authentification, vérifie l'accès à la base) utilisé par le `HEALTHCHECK` Docker et utilisable par une supervision externe.
- Variable `PROXY_HOPS` : nombre de proxys de confiance devant l'application (1 derrière Nginx Proxy Manager). Elle active `ProxyFix` pour que l'adresse IP, le protocole et l'hôte réels des visiteurs soient lus dans les en-têtes `X-Forwarded-*`, ce qui rend la limitation des tentatives de connexion efficace derrière un reverse proxy.
- Modèle de stack Portainer / Compose (`deploy/portainer-stack.yml`) : configuration par variables d'environnement de la stack, données dans un dossier de l'hôte, réseau partagé avec Nginx Proxy Manager.

### Modifié
- Numéro de version `0.18`.
- `.gitignore` complété (fichiers d'environnement, dossier de données, bases SQLite, fichiers système et d'éditeur).

## [0.17.2] - 2026-10-02

### Modifié
- Plafonds annuels : les informations « dont n prévu(s) », « reste n j » (ou « dépassé de n j ») et « soit n j par semaine d'ici le 31/12 » sont réunies sur une seule ligne, qui passe à la ligne seulement si l'écran est trop étroit.

## [0.17.1] - 2026-10-02

### Modifié
- Cartes repliables : le triangle de texte est remplacé par un chevron dessiné en CSS, avec un espace régulier avec le titre, qui pivote à l'ouverture. Il s'applique à toutes les cartes et blocs repliables (plafonds, détails, méthode de calcul).
- La carte « Ma progression » devient repliable, dépliée par défaut. Repliée, elle résume « 240 / 507 h · 47 % » sur la ligne du titre.
- Cartes repliables : le résumé de la ligne du titre n'est affiché que lorsque la carte est repliée.
- Plafonds annuels : la barre est dessinée avec un seul remplissage à dégradé net (effectué puis prévu), ce qui arrondit correctement son extrémité droite.
- Plafonds annuels : suppression des doublons d'information. Le « n effectué(s) » sous la barre disparaît ; il reste « dont n prévu(s) » (si besoin) et « reste n j » ou « dépassé de n j ».

### Supprimé
- Mention « dont n contrat(s) estimé(s) à 8 h par jour » dans la carte des plafonds.

## [0.17] - 2026-10-02

### Ajouté
- Champ « Jours travaillés » sur les contrats (facultatif). S'il est vide, le nombre de jours vaut les heures divisées par 8 ; l'estimation est proposée en suggestion pendant la saisie. Le champ est exporté et importé.
- Plafonds annuels configurables : un nom, un texte à retrouver dans le nom de l'employeur (sans tenir compte des accents ni de la casse) et un nombre de jours maximum par année civile. Jusqu'à 10 plafonds par compte, créés, modifiés et supprimés depuis la page Contrats ; exportés et importés.
- Carte « Plafonds annuels » sur la page Contrats, repliée par défaut. Fermée, elle affiche un résumé d'une ligne (par exemple « France Télévisions 52 / 80 j »), en rouge en cas de dépassement.
- Dépliée, pour chaque plafond : barre à deux teintes (jours effectués et jours prévus), jours restants ou dépassement, jours par semaine possibles d'ici le 31 décembre (année en cours) et nombre de contrats dont les jours sont estimés. Navigation d'une année à l'autre.
- Les contrats à cheval sur deux années sont répartis au prorata des jours entre les deux années civiles.
- Migration automatique : colonne `days_worked` sur `contracts`, table `day_limits`.

### Modifié
- Le plafond est une jauge : il n'empêche jamais d'enregistrer un contrat et n'affiche aucune alerte dans la fenêtre de saisie.

## [0.16.1] - 2026-10-02

### Corrigé
- Liste des contrats sur ordinateur : un nom d'employeur ou de mission très long élargissait le tableau et repoussait le bouton « Modifier » hors de l'écran, avec une barre de défilement tout en bas de la liste. Les textes longs passent désormais à la ligne (employeur 220 px, mission 320 px au maximum) et la colonne des boutons reste collée au bord droit si le tableau doit tout de même défiler.

### Modifié
- Tableau de bord : le pourcentage des 507 h effectuées est affiché en grand, en bas à droite de la carte de progression (en vert à partir de 100 %). La ligne d'heures ne le répète plus.

## [0.16] - 2026-10-02

### Ajouté
- Tableau de bord : pourcentage des 507 h effectuées à côté du nombre d'heures.
- Champ « Poste occupé » sur les contrats (monteur vidéo, étalonneur, assistant…), facultatif, 80 caractères maximum. Les postes déjà saisis sont proposés en suggestion. Le poste est affiché sous l'employeur dans la liste, pris en compte par la recherche, exporté et importé.
- Statistiques : graphique « Répartition des postes occupés » en anneau, par heures ou par salaires nets, avec regroupement des petits postes en « Autres » et une part « Non renseigné » pour les contrats sans poste.
- Migration automatique de la table `contracts` (colonne `job_title`).

### Modifié
- Statistiques : « Heures par droit » est remplacé par « Répartition des postes occupés » ; « Dépendance aux employeurs » devient « Répartition des employeurs ».
- Les statistiques ne calculent plus les heures par droit (données inutilisées).
- Le fichier JSON de l'archive d'export s'appelle désormais `507h-export.json` au lieu de `donnees.json`. L'import accepte tout fichier JSON valide : les anciens exports restent importables.

## [0.15.3] - 2026-10-01

### Modifié
- Les lignes de contrats, de droits et de virements ne sont cliquables que sur mobile. Sur ordinateur, seul le bouton « Modifier » ouvre la fenêtre de modification, et le curseur ne change plus au survol d'une ligne.
- Page Compte : les cartes sont réparties en deux colonnes équilibrées (flux en colonnes) au lieu d'une grille en rangées, ce qui supprime l'espace vide dans les cartes les moins hautes. Ordre de lecture inchangé : Mon compte, Apparence, e-mail, mot de passe, puis double authentification, sessions, données et suppression.

### Corrigé
- Ordinateur : le bouton « Modifier » des tableaux (contrats, droits, virements) est désormais collé au bord droit de la carte au lieu de flotter au milieu de la dernière colonne.

## [0.15.2] - 2026-10-01

### Modifié
- Mobile : les lignes de contrats, de droits et de virements deviennent entièrement cliquables et ouvrent la fenêtre de modification ; les boutons « Modifier » et « Supprimer » ne sont plus affichés dans les cartes, ce qui réduit leur hauteur. La suppression d'un contrat se fait depuis la fenêtre de modification (nouveau bouton « Supprimer »).
- Mobile, contrats : l'étiquette « Net » est retirée, le montant net reste affiché à droite.
- Mobile, historique des droits : une carte de deux lignes (période, puis ouverture et AJ nette). La FCT et les heures de référence ne sont plus affichées sur mobile.
- Mobile, virements : une carte de deux lignes (mois et montant, puis « Versé le » avec les jours et la note).
- Boutons d'ajout raccourcis en « + Ajouter » sur mobile.
- Mobile, modales : champs en deux colonnes (début et fin, brut et net, FCT et début d'indemnisation, etc.) pour réduire le défilement ; en-tête compatible avec la zone sûre en haut de l'écran.
- Les libellés longs des modales Droit et Virement sont raccourcis et leurs valeurs par défaut sont expliquées en une ligne sous le formulaire.
- L'étiquette « remplacé avant terme » devient « remplacé » (le détail est dans l'infobulle).

### Corrigé
- Mobile, modales : les champs de date débordaient à droite et décalaient tout le formulaire (iOS).

## [0.15.1] - 2026-10-01

### Corrigé
- Liste des contrats sur mobile : le brut et les cellules vides (tiret du document) s'affichaient malgré leur masquage, car une règle plus spécifique les remettait en bloc. Elles sont de nouveau masquées et la carte reprend l'ordre prévu (employeur et heures, mission, dates, documents, net, actions).
- Calendrier : la colonne des mois laissait voir des bandes de cellules entre les lignes pendant le défilement horizontal. Les lignes sont désormais jointives et la colonne des mois a un fond plein.
- Calendrier mobile : noms de mois abrégés (janv., févr., etc.) et colonne plus étroite.
- Symboles du calendrier : le carré de la fin de contrat retenue s'affichait en émoji noir sur iOS ; il utilise désormais un carré texte, et le triangle du début d'indemnisation est forcé en mode texte.
- Le survol des lignes de tableau n'est plus appliqué sur écran tactile (il restait « collé » après un appui).

### Modifié
- La déconnexion quitte l'en-tête sur mobile et passe dans la carte « Sessions » de la page Compte (bouton « Se déconnecter », visible sur mobile uniquement). Sur ordinateur, elle reste dans l'en-tête.
- La déconnexion est gérée par l'attribut `data-logout`, ce qui permet plusieurs boutons.

## [0.15] - 2026-10-01

### Ajouté
- Affichage mobile (écrans de 700 px et moins). Barre de navigation fixe en bas de l'écran avec icônes (Contrats, Intermittence, Statistiques, Compte), compatible avec les zones sûres des téléphones à encoche. La déconnexion reste en haut à droite.
- Liste des contrats en cartes sur mobile : employeur et heures, mission, dates, documents, net et boutons d'action. Le brut est masqué. Un sélecteur de tri remplace les en-têtes de colonnes.
- Barre de recherche des contrats avec bouton « Filtres » (compteur de filtres actifs) qui déplie les filtres sur mobile.
- Historique des droits et virements en lignes compactes sur mobile.
- Modales en plein écran sur mobile, avec en-tête et boutons d'action fixes pour rester accessibles au clavier virtuel.
- Graphiques adaptés à la largeur de l'écran (étiquettes de l'axe horizontal espacées) et recalculés au changement d'orientation. Infobulles activées au toucher.
- Calendrier d'activité : colonne des mois fixe pendant le défilement horizontal.
- Balises `viewport-fit=cover` et `theme-color` (clair et sombre) pour préparer la future version PWA.

### Modifié
- Le menu du haut devient une barre de navigation en bas sur mobile ; sur ordinateur, il est inchangé.
- Champs de saisie à 16 px sur mobile (évite le zoom automatique d'iOS) et boutons d'au moins 40 px de haut.
- Tuiles de statistiques en deux colonnes sur mobile.

## [0.14.1] - 2026-10-01

### Modifié
- Statistiques : les tuiles suivent toutes le même schéma (intitulé, chiffre, information complémentaire). « Heures sur la période » indique le rythme hebdomadaire ; « Heures par mois » donne la moyenne et la médiane ; « Revenu net par mois » et « Meilleur mois » sont inchangés.
- Statistiques : les cartes de graphiques d'une même rangée ont la même hauteur et le même en-tête, de sorte que les graphiques démarrent à la même hauteur.
- Les cartes repliables (« Moyennes, médianes et meilleurs mois », « Calendrier d'activité ») sont plus basses et leur titre est centré verticalement quand elles sont fermées.
- Les heures s'affichent avec la virgule décimale française (13,1 h au lieu de 13.1 h) sur le tableau de bord, la page Intermittence et les statistiques.
- Hauteur minimale commune des en-têtes de carte (2,5 rem).

## [0.14] - 2026-10-01

### Modifié
- Page Statistiques allégée. Le paragraphe d'explication en tête est remplacé par la période affichée sur une ligne, à côté du sélecteur. Les notes de méthode (prorata des jours, rattachement de l'ARE, mois incomplets) passent dans un bloc « Méthode de calcul » replié en bas de page.
- Quatre chiffres clés en tête de page : heures sur la période, heures par semaine (avec la moyenne mensuelle), revenu net moyen par mois (avec la médiane) et meilleur mois de revenu.
- Les moyennes, médianes et meilleurs mois détaillés (heures, salaires nets, ARE, revenu total) sont dans un bloc replié « Moyennes, médianes et meilleurs mois ».
- Le calendrier d'activité est replié par défaut et ne se calcule qu'à l'ouverture. Sa légende est raccourcie.
- Le nombre de contrats sans net est signalé par une étiquette sur le graphique « Revenu net par mois » au lieu d'une phrase.
- Les graphiques sont inchangés.

## [0.13] - 2026-10-01

### Modifié
- Page Intermittence allégée. Le droit en cours et la progression vers les 507 h sont réunis dans une seule carte qui affiche l'essentiel : date anniversaire, jours restants, heures réalisées sur 507 et heures manquantes avec le rythme nécessaire. Le reste (type d'ouverture, annexe, FCT, début d'indemnisation, date d'examen, AJ nette, détail des heures) est dans un bloc « Détails » replié.
- Historique des droits condensé en quatre colonnes (période avec FCT en sous-ligne, ouverture, AJ nette, heures de référence). Les trois droits les plus récents sont affichés, avec « Afficher tout » pour le reste.
- Virements condensés en trois colonnes (mois avec jours et note en sous-ligne, date, montant). Les six plus récents sont affichés, avec « Afficher tout » pour le reste. Les totaux tiennent sur une ligne.
- Un seul bouton « Modifier » par ligne ; la suppression se fait depuis la fenêtre de modification.
- Contenu de la page centré sur une largeur réduite (880 px).

### Supprimé
- Barre de progression du temps écoulé dans le droit, note explicative sous l'historique et ligne d'avertissement en bas de page.


## [0.12.1] - 2026-10-01

### Ajouté
- Chargement automatique du fichier `.env` au démarrage (`python-dotenv`). Les variables déjà définies dans l'environnement (par exemple par `systemd`) restent prioritaires.
- Fichier `.env.example` listant toutes les variables de configuration.
- Avertissements au démarrage : `MAIL_CONSOLE` actif (les liens sont écrits dans les journaux) et `SMTP_HOST` défini sans `APP_BASE_URL` (envoi d'e-mails désactivé).

### Modifié
- `MAIL_CONSOLE=1` écrit désormais le contenu des e-mails dans les journaux en plus de les envoyer quand le SMTP est configuré (auparavant, le SMTP désactivait la sortie console).
- `requirements.txt` complété avec des versions minimales : `segno>=1.6`, `python-dotenv>=1.0`.

## [0.12] - 2026-10-01

### Ajouté
- Envoi d'e-mails par SMTP, configuré par variables d'environnement (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `APP_BASE_URL`), avec envoi en tâche de fond. Mode `MAIL_CONSOLE=1` pour tester sans serveur SMTP.
- Vérification de l'adresse e-mail : lien envoyé à l'inscription (valable 48 h), bandeau tant que l'adresse n'est pas vérifiée, renvoi du lien depuis la page Compte.
- Récupération de mot de passe : pages `/forgot` et `/reset`, lien valable 1 h à usage unique, message identique que le compte existe ou non, réservée aux adresses vérifiées. La réinitialisation déconnecte tous les appareils.
- Double authentification par code temporaire (TOTP, application d'authentification) : activation depuis la page Compte avec QR code, 10 codes de récupération à usage unique, désactivation et régénération des codes protégées par le mot de passe et un code, connexion en deux étapes, refus de rejouer un code déjà utilisé, secret chiffré au repos.
- Changement d'adresse e-mail confirmé par un lien envoyé à la nouvelle adresse.
- Tables `email_tokens` et `recovery_codes`, colonnes `email_verified`, `totp_secret`, `totp_enabled` et `totp_last_step` sur `users` (migration automatique).
- Dépendance `segno` (génération du QR code en SVG).

### Modifié
- Page Compte réorganisée : état de l'adresse e-mail, carte « Double authentification », grille en quatre rangées.
- Contrôle d'adresse e-mail plus strict (caractères de contrôle et séparateurs refusés).
- Activer la double authentification ou réinitialiser le mot de passe déconnecte les autres appareils.
- Les adresses existantes sont considérées comme non vérifiées tant que le lien n'a pas été ouvert (sans effet si l'envoi d'e-mails n'est pas configuré).

### Sécurité
- Jetons de lien stockés sous forme d'empreinte HMAC, à usage unique et à durée limitée.
- Liens construits à partir de `APP_BASE_URL` et jamais de l'en-tête `Host`.
- Limitation des demandes de lien et des essais de code.

## [0.11.1] - 2026-10-01

### Modifié
- Liste des contrats : seule l'année en cours est dépliée par défaut. Les autres années sont repliées et se déplient d'un clic.
- Pendant une recherche ou un filtre, toutes les années sont dépliées pour que les résultats ne soient pas masqués. Un changement de recherche ou de filtre remet l'état par défaut.
- Après l'enregistrement d'un contrat, son année est dépliée automatiquement.
- Le résumé sous la recherche n'affiche plus que le nombre de contrats (les totaux d'heures et de net font double emploi avec la page Statistiques).
- Les lignes d'année n'affichent plus que le nombre de contrats.

## [0.11] - 2026-10-01

### Ajouté
- Recherche dans la liste des contrats (employeur, mission, commentaire), insensible à la casse et aux accents, tous les mots saisis devant être présents.
- Filtres par année (année de fin du contrat), par employeur et par statut : tous, doublons possibles, sans brut ou net, sans document. Bouton « Réinitialiser » et compteur de résultats avec total d'heures et de net.
- Regroupement par année (année de fin du contrat) avec sous-total par année (nombre de contrats, heures, net), activable et repliable.
- Alerte de doublon à la saisie : dès qu'un contrat du même employeur existe sur les mêmes dates, un avertissement s'affiche dans la modale et le bouton devient « Enregistrer quand même ». L'alerte distingue un contrat identique (même mission et mêmes heures) d'un contrat voisin.
- Étiquette « Doublon » sur les contrats concernés dans la liste.

### Modifié
- Le tableau de bord attend désormais le calcul de la progression avant de s'afficher, pour éviter un second changement visuel après le chargement.
- Les libellés des documents affichent « n PDF » au lieu d'un symbole.

## [0.10.2] - 2026-10-01

### Corrigé
- Clignotement au chargement des pages : le contenu (hors en-tête) et le pied de page restent masqués jusqu'au premier rendu des données, puis apparaissent par un court fondu. Plus de cartes vides, de textes provisoires ni de saut du pied de page.
- Les barres de progression ne s'animent plus depuis zéro au premier affichage.

### Modifié
- `theme.js` devient `early.js` : script exécuté dans `<head>` qui gère le thème (`Theme`) et l'état de chargement (`Boot.ready()`).
- Chaque page appelle `Boot.ready()` une fois son premier rendu terminé. Un garde-fou de 3 secondes affiche la page même si un script échoue.

## [0.10.1] - 2026-10-01

### Modifié
- Le sélecteur de thème (Auto, Clair, Sombre) quitte l'en-tête et passe dans une carte « Apparence » de la page Compte. Le réglage reste propre au navigateur (`localStorage`) et ne suit pas le compte ; la carte l'indique.
- `theme.js` expose un petit objet `Theme` (`get`, `set`) utilisé par la page Compte et synchronise le thème entre les onglets ouverts.
- La carte « Mon compte » ne prend plus toute la largeur : elle partage la première rangée avec « Apparence ».

### Supprimé
- Bouton de thème dans l'en-tête et code de thème dans `nav.js` (qui ne gère plus que la déconnexion).

## [0.10] - 2026-10-01

### Ajouté
- Mode clair en complément du mode sombre. Par défaut, le thème suit le réglage du système (mode « Auto »).
- Bouton de thème dans l'en-tête : Auto, Clair, Sombre. Le choix est mémorisé dans le navigateur (`localStorage`).
- Fichier `static/js/theme.js`, chargé dans `<head>`, qui applique le thème avant l'affichage pour éviter un flash de la mauvaise couleur.

### Modifié
- Toutes les couleurs de `style.css` sont définies avec `light-dark()` : une seule déclaration par variable pour les deux thèmes.
- Nouvelles variables : `--hover-strong`, `--shadow`, `--accent-soft`, `--on-accent-soft` (remplace `--accent-dark`).
- Couleur d'accent légèrement plus foncée en mode clair pour garder un bon contraste avec le texte blanc des boutons.
- Les graphiques SVG (grille, axes, repère des 507 h, total de l'anneau) utilisent des classes CSS au lieu de couleurs fixes, pour suivre le thème.
- Le calendrier d'activité utilise des couleurs adaptées au thème (jour courant, contrat simple).

## [0.9] - 2026-10-01

### Ajouté
- En-tête commun dans `base.html` : même navigation sur toutes les pages (Contrats, Intermittence, Statistiques, Compte, Déconnexion), avec la page courante mise en évidence (`aria-current`).
- Fichier `static/js/nav.js` pour la déconnexion, partagé par toutes les pages.

### Modifié
- Refonte visuelle plus sobre : en-tête fixe translucide, navigation en liens, cartes sans bordure, champs et boutons plus discrets, tableaux allégés, badges teintés, barre de progression plus fine, modales avec fond flouté.
- Le pied de page (version) est désormais dans `base.html`.
- Les pages n'ont plus leur propre en-tête ni leur propre pied de page ; la page de connexion n'affiche pas la navigation.
- Suppression des émojis dans les libellés (progression, documents).

### Supprimé
- Règles CSS devenues inutiles : `.topbar`, `.tabs .active` avec bordure.
- Gestionnaires de déconnexion dupliqués dans `dashboard.js`, `intermittence.js`, `stats.js` et `account.js`.

## [0.8.2] - 2026-10-01

### Modifié
- `style.css` réorganisé en sections commentées (variables, base, mise en page, utilitaires, formulaires, boutons, tableaux, composants, modales, graphiques, calendrier), une propriété par ligne, indentation en 4 espaces.
- Nouvelles variables de couleur (`--ok`, `--warn`, `--info`, `--accent-dark`) à la place des valeurs répétées.
- Les styles des formulaires de modale s'appliquent à toutes les modales (`dialog form`) et plus seulement au formulaire de contrat : les modales « Droit ARE » et « Virement » ont désormais la même grille et les mêmes marges.
- Le contour de focus s'applique aussi aux listes déroulantes et aux zones de texte.

### Supprimé
- Règles CSS devenues inutiles : `.inner`, `.col`, `#bar` (couvert par `.progress > div`), doublon de `.container`.

## [0.8.1] - 2026-10-01

### Modifié
- Page « Mon compte » réorganisée en rangées : « Mon compte » ; changement d'e-mail et de mot de passe ; sessions et données ; suppression du compte.
- Statistiques : les graphiques affichent une infobulle au survol (mois, valeurs détaillées, part de chaque employeur, détail de chaque jour du calendrier).
- Statistiques : la période « Depuis la FCT du droit en cours » utilise la même base que la page Intermittence (lendemain de la FCT). Elle s'arrête à aujourd'hui au lieu de la fin du mois.
- Statistiques : les mois incomplets (mois en cours, premier mois partiel) sont exclus des moyennes et médianes et affichés plus clairs dans les graphiques.

### Corrigé
- Statistiques : la période du droit en cours commençait au premier jour du mois et comptait des heures antérieures à la FCT (312 h au lieu de 232 h dans l'exemple observé).
- Statistiques : les virements de la période du droit en cours sont filtrés sur leur date de versement, comme les totaux de la page Intermittence.

## [0.8] - 2026-10-01

### Ajouté
- Page « Statistiques » (`/stats`) avec sélecteur de période : 12 derniers mois, année en cours, année précédente, depuis le début du droit en cours, depuis le début.
- Heures par mois (histogramme).
- Heures par droit : heures de référence (12 mois avant la FCT) et heures travaillées pendant le droit, avec repère des 507 h.
- Heures moyennes par semaine, moyenne et médiane mensuelles, meilleur mois.
- Revenu net par mois en barres empilées : salaires nets (contrats) et ARE (virements France Travail, rattachés au mois concerné).
- Meilleur mois, moyenne et médiane pour les salaires, l'ARE et le revenu total.
- Dépendance aux employeurs : graphique en anneau par heures ou par salaires nets, avec regroupement des petits employeurs en « Autres ».
- Calendrier d'activité annuel : jours couverts par un contrat, virements France Travail, fin de contrat retenue (FCT), début d'indemnisation, date anniversaire et fin effective d'un droit. Détail au survol.
- Lien « Statistiques » dans la navigation.
- Graphiques en SVG, sans bibliothèque externe.

### Modifié
- Les pages Intermittence et Mon compte s'affichent sur deux colonnes (une seule colonne sur petit écran).
- Largeur maximale du contenu portée à 1 200 px.

### Corrigé
- Page Intermittence : le contenu était décalé vers la droite à cause du tableau de l'historique, qui élargissait la grille. Les tableaux défilent désormais dans leur carte.

## [0.7] - 2026-10-01

### Ajouté
- Historique des droits ARE : plusieurs droits par utilisateur, chacun avec son annexe, sa fin de contrat (FCT), son début d'indemnisation, sa date anniversaire (calculée ou saisie), son AJ nette et une note.
- Type d'ouverture d'un droit : première ouverture, renouvellement à la date anniversaire ou demande anticipée.
- Fin effective d'un droit : un droit remplacé avant sa date anniversaire (réexamen anticipé) s'arrête la veille du début du droit suivant. La date anniversaire n'est plus déduite de celle du droit précédent.
- Heures de la période de référence affichées pour chaque droit.
- Message « réexamen anticipé possible » dès 507 h réalisées depuis la FCT du droit en cours, avant la date anniversaire.
- Suivi des virements France Travail saisis à la main : date du virement, montant, mois concerné (par défaut le mois précédant le virement), jours indemnisés (optionnel) et note.
- Totaux des virements : 12 derniers mois et depuis le début du droit en cours.
- Export et import : les droits (`droits_are`) et les virements (`virements`) sont inclus. Les anciens fichiers contenant `droit_are` restent importables.
- Nouvelles tables `rights` et `payments` (supprimées avec le compte).

### Modifié
- Page Intermittence refondue en quatre blocs : droit en cours, progression vers les 507 h, historique des droits, virements.
- Le droit en cours est le droit dont le début d'indemnisation est le plus récent ; le tableau de bord s'appuie sur lui.
- Migration automatique : l'ancienne table `are_rights` est copiée dans `rights` puis renommée `are_rights_old` (elle peut être supprimée manuellement après vérification).
- API : `PUT/DELETE /api/intermittence` sont remplacés par `/api/rights` et `/api/payments`.
- Import JSON : les droits et virements déjà présents sont ignorés comme doublons (au lieu d'ignorer tout le droit ARE si un droit existait).

### Supprimé
- Cartes « Allocation journalière » et « Période d'indemnisation » (fusionnées dans le bloc du droit en cours).

## [0.6] - 2026-09-30

### Ajouté
- Import de données depuis un fichier JSON, au même endroit que l'export (page « Mon compte », carte « Mes données »). Le fichier attendu est le `donnees.json` d'une archive d'export 507h.
- Import des contrats : les doublons (même employeur, mission, dates et heures) sont ignorés ; les documents PDF ne sont pas importés.
- Import du droit ARE uniquement si aucun droit n'est déjà renseigné.
- Import atomique : si une entrée est invalide, rien n'est modifié et les premières erreurs sont listées.
- Limites : fichier de 2 Mo maximum, 2 000 contrats par import.

### Modifié
- Page « Mon compte » : la carte « Sessions et données » est scindée en « Sessions » et « Mes données ».

## [0.5.1] - 2026-09-30

### Supprimé
- Page Intermittence : AJ brute, franchise congés payés, franchise salaires et délai d'attente (formulaire, API et affichage). Les colonnes correspondantes (`aj_brute_cents`, `waiting_days`, `franchise_cp_days`, `franchise_salary_days`) restent en base des installations existantes mais ne sont plus utilisées.
- Nombre maximal de jours indemnisables (il dépendait des franchises).

### Modifié
- L'allocation journalière affichée est l'AJ nette de la notification France Travail, saisie par l'utilisateur.
- La carte « Période d'indemnisation » est simplifiée : début, date anniversaire et durée en jours.

## [0.5] - 2026-09-30

### Modifié
- Tableau de bord : la barre de progression compte désormais les 12 derniers mois glissants tant qu'aucun droit n'est renseigné. Dès qu'un droit est renseigné, elle compte les heures postérieures à la fin de contrat (FCT) retenue, sans dépasser 12 mois glissants (les heures déjà utilisées pour ouvrir un droit ne sont pas réutilisables).
- Le tableau de bord affiche la période prise en compte et la date anniversaire.
- Les heures sont proratisées au jour pour les contrats à cheval sur la période (comme sur la page Intermittence).
- Page Intermittence : l'allocation journalière affichée est celle de la notification France Travail, saisie par l'utilisateur.

### Ajouté
- Champ « AJ nette » (issu de la notification) sur la page Intermittence.
- Migration automatique de la table `are_rights` (colonne `aj_net_cents`).

### Supprimé
- Toutes les estimations d'allocation : AJ brute calculée (A + B + C), AJ nette estimée, AJ projetée.
- Options CSG et Alsace-Moselle (les colonnes `csg_rate` et `alsace_moselle` restent en base des installations existantes mais ne sont plus utilisées).

## [0.4] - 2026-09-30

### Ajouté
- Page « Intermittence » (`/intermittence`) pour suivre son droit à l'assurance chômage (annexes 8 et 10).
- Saisie du droit en cours : annexe, fin de contrat de travail (FCT) retenue, début d'indemnisation, date anniversaire (calculée à FCT + 12 mois, modifiable), AJ brute de la notification (optionnelle), délai d'attente, franchises congés payés et salaires.
- Date anniversaire, jours restants, date d'examen (lendemain de la date anniversaire) et alerte à 15 jours ou en cas de droit expiré.
- Nombre maximal de jours indemnisables (période d'indemnisation moins délai d'attente et franchises).
- Projection des 507 h jusqu'à la date anniversaire : heures réalisées, heures prévues, heures restantes et rythme hebdomadaire nécessaire.
- Nouvelle table `are_rights` (supprimée avec le compte, incluse dans l'export des données).
- Liens de navigation « Intermittence » sur le tableau de bord et la page du compte.

### Modifié
- L'export des données contient désormais le droit ARE.

## [0.3] - 2026-09-30

### Ajouté
- Page « Mon compte » (`/account`), accessible depuis le tableau de bord.
- Changement d'adresse e-mail (mot de passe actuel requis).
- Changement de mot de passe (mot de passe actuel + nouveau mot de passe saisi deux fois). Les autres sessions sont déconnectées.
- « Se déconnecter partout » : invalidation de toutes les sessions ouvertes (`session_version`).
- Export de toutes les données (JSON + documents PDF déchiffrés) dans une archive ZIP.
- Suppression définitive du compte (mot de passe + saisie de « SUPPRIMER » requis) : contrats, documents en base et fichiers chiffrés sur le disque sont effacés.
- Champ « Confirmer le mot de passe » à l'inscription (contrôle côté navigateur et côté serveur).
- Limitation des tentatives sur les actions sensibles du compte.

### Modifié
- Les sessions sont désormais liées à une version stockée en base : toutes les sessions ouvertes avant la 0.3 sont fermées une fois (reconnexion nécessaire).
- Migration automatique de la table `users` (colonne `session_version`).
- Les règles CSS respectent désormais l'attribut `hidden` sur tous les éléments.

### Corrigé
- La comparaison du jeton CSRF ne plante plus si l'en-tête contient des caractères non ASCII.

## [0.2] - 2026-09-30

### Ajouté
- Tri des colonnes de la liste des contrats (clic sur l'en-tête : croissant, décroissant), avec indicateur visuel et `aria-sort`. Tri par défaut : date de fin décroissante. Les valeurs vides sont toujours placées en fin de liste.
- La colonne « Dates » est scindée en « Début » et « Fin » pour pouvoir trier sur chacune.

### Modifié
- La modale se ferme au clic en dehors de la fenêtre (sans se fermer lors d'une sélection de texte qui déborde).
- « Mission », « Brut » et « Net » deviennent optionnels (API, base de données et formulaire). Le contrôle net <= brut ne s'applique que si les deux sont renseignés.
- Migration automatique de la table `contracts` (les colonnes `gross_cents` et `net_cents` acceptent désormais NULL). Les données existantes sont conservées.

## [0.1] - 2026-09-30

### Ajouté
- Authentification : inscription, connexion, déconnexion (hash scrypt, mot de passe 12 caractères minimum, protection anti brute-force, anti fixation de session).
- Protection CSRF par jeton de session (en-tête `X-CSRF-Token`) et en-têtes de sécurité (CSP stricte, nosniff, frame-ancestors none).
- Gestion des contrats : ajout, modification, suppression (employeur, mission, heures, dates, brut, net), montants stockés en centimes.
- Barre de progression vers les 507 h sur une fenêtre glissante de 365 jours.
- Commentaire optionnel (500 caractères max) sur chaque contrat.
- Sélection rapide d'un employeur déjà saisi (pastilles des employeurs les plus utilisés + autocomplétion).
- Import de documents PDF par contrat : contrat de travail, AEM, bulletin de paie (10 Mo max, signature `%PDF-` vérifiée, chiffrés au repos avec Fernet, nom aléatoire, stockés hors de `/static`, téléchargement authentifié avec contrôle de propriété).
- Numéro de version affiché dans le pied de page (`APP_VERSION`).
- Migration automatique de la base SQLite (colonne `comment`, table `documents`).

### Modifié
- Le formulaire de contrat n'est plus sur la page principale : il s'ouvre dans une fenêtre modale (`<dialog>`).

## Connu / à faire
- Le calcul des 507 h n'applique pas les plafonds mensuels d'heures (208 h / 250 h pour l'annexe 8) et ne gère ni les cachets (annexe 10) ni les heures assimilées.
- Les statistiques répartissent heures et salaires au prorata des jours de chaque contrat : ce ne sont pas les jours réellement travaillés.
- L'import JSON ne restaure pas les documents PDF (ils restent dans l'archive ZIP d'export).
- Les virements sont saisis à la main : aucun calcul automatique du montant mensuel.
- Pas de récupération de mot de passe (nécessite l'envoi d'e-mails) ni de vérification de l'adresse e-mail.
- Limitation de tentatives en mémoire (1 seul worker gunicorn).