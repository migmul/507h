# Changelog

Toutes les évolutions notables de **507h** sont consignées ici.
Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).

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
- L'import JSON ne restaure pas les documents PDF (ils restent dans l'archive ZIP d'export).
- Les virements sont saisis à la main : aucun calcul automatique du montant mensuel.
- Pas de récupération de mot de passe (nécessite l'envoi d'e-mails) ni de vérification de l'adresse e-mail.
- Limitation de tentatives en mémoire (1 seul worker gunicorn).
