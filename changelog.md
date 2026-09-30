# Changelog

Toutes les évolutions notables de **507h** sont consignées ici.
Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).

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
- Simulation mensuelle de l'ARE (jours non indemnisables, cumul avec salaires plafonné à 118 % du PMSS) et historique des droits : prévus pour une prochaine version.
- Pas de récupération de mot de passe (nécessite l'envoi d'e-mails) ni de vérification de l'adresse e-mail.
- Limitation de tentatives en mémoire (1 seul worker gunicorn).
