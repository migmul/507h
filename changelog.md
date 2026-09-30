# Changelog

Toutes les évolutions notables de **507h** sont consignées ici.
Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).

## [0.4] - 2026-09-30

### Ajouté
- Page « Intermittence » (`/intermittence`) pour suivre son droit à l'assurance chômage (annexes 8 et 10).
- Saisie du droit en cours : annexe, fin de contrat de travail (FCT) retenue, début d'indemnisation, date anniversaire (calculée à FCT + 12 mois, modifiable), AJ brute de la notification (optionnelle), délai d'attente, franchises congés payés et salaires, taux de CSG, régime local Alsace-Moselle.
- Date anniversaire, jours restants, date d'examen (lendemain de la date anniversaire) et alerte à 15 jours ou en cas de droit expiré.
- Nombre maximal de jours indemnisables (période d'indemnisation moins délai d'attente et franchises).
- Allocation journalière brute estimée (formule A + B + C, plancher 38 € / 44 €, plafond 174,80 €) à partir des contrats saisis, avec détail des parties A, B et C.
- Estimation de l'AJ nette (retraite complémentaire, CSG/CRDS, Alsace-Moselle), hors prélèvement à la source.
- Projection des 507 h jusqu'à la date anniversaire : heures réalisées, heures prévues, heures restantes, rythme hebdomadaire nécessaire et AJ projetée.
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
- Le calcul des 507 h ne proratise pas les plafonds mensuels (208 h / 250 h pour l'annexe 8) et ne gère ni les cachets (annexe 10) ni les heures assimilées.
- Simulation mensuelle de l'ARE (jours non indemnisables, cumul avec salaires plafonné à 118 % du PMSS), calcul automatique de la franchise salaires et historique des droits : prévus pour une prochaine version.
- Pas de récupération de mot de passe (nécessite l'envoi d'e-mails) ni de vérification de l'adresse e-mail.
- Limitation de tentatives en mémoire (1 seul worker gunicorn).
