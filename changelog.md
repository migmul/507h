# Changelog

Toutes les évolutions notables de **507h** sont consignées ici.
Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).

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