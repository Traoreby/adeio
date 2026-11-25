# ADEIO — Cycle de vie des membres

## Périmètre livré dans le code

Les migrations `202611250003_member_lifecycle_foundation.sql` et `202611250004_member_self_service_reactivation.sql` ajoutent les données et fonctions du nouveau parcours. Elles ne sont pas appliquées par ce travail local. Le réglage `member_lifecycle_enforced` est créé désactivé ; les accès et l’archivage selon l’année ne deviennent effectifs qu’après le préremplissage et l’activation explicite par le Super Admin.

### Modèle et conservation

| Objet | Changements | Règle de conservation |
|---|---|---|
| `members` | `exit_year`, `profile_completed_at`, `archived_at`, `photo_updated_at`, `photo_updated_by`, `reactivation_photo_required` | Une seule fiche par UUID Auth (`user_id` unique) ; la FK empêche la suppression d’un compte Auth encore lié. Un trigger interdit aussi toute transition vers `active` hors de la procédure de réactivation. L’année ADEIO et l’UUID sont conservés lors d’une réactivation. Le changement d’identité n’est permis que par l’action d’anonymisation réservée au Super Admin. |
| `member_private_details` | `sex` | Le membre peut modifier téléphone et sexe par RPC propriétaire ; les champs sensibles ne sont pas modifiables directement. |
| `membership_periods` | Suppression/réécriture bloquée ; seule la clôture est autorisée | Chaque archive/réactivation conserve les anciennes périodes. L’anonymisation Super Admin peut retirer une note personnelle sans supprimer la période. |
| `member_onboarding` | Nouvelle table liée à `auth.users` et, lorsqu’elle existe, à `members` | Une ligne de processus par compte : invitation, profil soumis, terminé ou réactivation en cours. Elle ne crée jamais de compte Auth. |
| `member_education_periods` | Nouvelle table avec une période courante unique par membre | Une formation modifiée est clôturée et une nouvelle ligne est ajoutée ; les anciennes formations restent consultables par le membre et l’administration. |
| `member_lifecycle_events` | Journal de profil, archivage, réactivation, photo et émission/révocation de QR | Append-only côté application ; lecture réservée au Super Admin. Les changements de membres restent aussi soumis au journal d’audit existant. |
| `member_qr_tokens` | Colonnes d’enveloppe AES-GCM et index garantissant au plus un QR actif | Le hash vérifie le QR public ; le jeton est chiffré pour l’impression. Un jeton révoqué n’est jamais réactivé. |

Les historiques d’adhésion existants dans `membership_periods` ne sont pas remplacés. À chaque réactivation, une nouvelle période est insérée. L’année de sortie actuelle est conservée sur la fiche ; chaque ancienne formation et période d’adhésion conserve ses propres dates.

La création et la mise à jour administratives passent par des RPC atomiques (`admin_create_member`, `admin_update_member_profile`) : périodes, coordonnées, formations et liaison Auth sont validées dans la même transaction. Cela évite les fiches partielles si une insertion échoue.

### Archivage et accès immédiats

L’activation est refusée si une fiche active n’a pas d’année de sortie ou si elle précède l’année d’adhésion. Une fois activé, `is_current_member()` vérifie en heure de Kolkata que `exit_year` est strictement supérieure à l’année actuelle. Cette vérification est utilisée par les règles RLS des données réservées aux membres actifs : les accès sont donc fermés dès le début de l’année de sortie, même si le cron quotidien n’a pas encore mis à jour `members.status`.

Le cron Vercel appelle `archive_expired_members` à 00 h 05 heure de l’Inde. Il clôt les périodes ouvertes, invalide les QR, marque les fiches `former` et inscrit les événements. Le cron ne réactive jamais de fiche. Si le traitement est momentanément indisponible, le contrôle RLS continue d’appliquer l’échéance.

Les droits des Trésoriers et Commissaires aux comptes restent fondés sur les mêmes fonctions de rôle/MFA. Les branches financières `is_finance_staff()` sont conservées dans les politiques remplacées ; les Admins ne gagnent aucun accès aux arriérés individuels. Les anciennes fonctions de rotation de QR hash-only sont révoquées au profit de l’émission chiffrée.

### Réactivation contrôlée

1. Un Admin ou Super Admin ouvre la fiche archivée et démarre la procédure. Le compte Auth existant et son UUID sont utilisés ; aucun nouvel utilisateur n’est créé.
2. Le membre reçoit un e-mail de reprise d’accès sur le même compte et complète formation, coordonnées et année de sortie future.
3. Il doit charger une nouvelle photo depuis son propre compte. Le serveur vérifie le changement de chemin, son horodatage et l’identité du compte qui l’a envoyé.
4. L’administration examine le dossier et confirme la réactivation. La transaction ajoute une période d’adhésion, conserve le numéro ADEIO, réactive le membre, révoque les QR actifs et émet un nouveau jeton.
5. Les événements antérieurs et anciens QR restent conservés ; un ancien QR révoqué ne peut pas redevenir valide.

Le profil membre n’expose aucun champ de rôle, statut, e-mail ou `user_id`. Le changement d’e-mail utilise `auth.admin.updateUserById` sur le même compte Auth ; l’identifiant du profil n’est donc pas remplacé.

### QR, clé et PDF

Le serveur crée un jeton aléatoire de 256 bits, stocke son SHA-256 et chiffre le jeton avec AES-256-GCM. La clé n’est jamais stockée en base ni livrée au navigateur. Elle doit être une variable serveur Vercel, jamais `NEXT_PUBLIC_*`. Le code accepte une clé versionnée (`ADEIO_QR_ENCRYPTION_KEY_V1`, puis V2, etc.) ; conserver les anciennes versions tant que des cartes correspondantes doivent être réimprimées.

L’émission/révocation du QR est distincte de la génération PDF. Le téléchargement PDF lit et déchiffre côté serveur le QR actif ; il n’écrit pas dans `member_qr_tokens`. Le jeton brut n’est jamais renvoyé en JSON ou en état JavaScript. Le PDF demandé contient nécessairement le QR scannable — donc le PDF téléchargé porte le secret de vérification sous forme de QR, comme la carte physique.

Générer une clé de 32 octets en base64 avec, par exemple :

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Placer la sortie uniquement dans Vercel comme `ADEIO_QR_ENCRYPTION_KEY_V1`, puis définir `ADEIO_QR_ENCRYPTION_KEY_VERSION=1`. Ne pas la coller dans Git, les journaux, une variable publique ou un message.

## Préparation du déploiement

Avant le push, configurer dans Vercel, en environnement Production et Preview si nécessaire :

- `NEXT_PUBLIC_SITE_URL` : domaine canonique utilisé par les invitations et cartes.
- `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` : paramètres déjà utilisés par ADEIO.
- `SUPABASE_SECRET_KEY` : clé serveur existante, jamais exposée au navigateur.
- `ADEIO_QR_ENCRYPTION_KEY_V1` et `ADEIO_QR_ENCRYPTION_KEY_VERSION=1`.
- `CRON_SECRET` : secret aléatoire réservé à Vercel Cron.

Après push, contrôler d’abord le déploiement Vercel et l’application des migrations Supabase. Le flag d’archivage doit rester désactivé pendant la vérification des données. Compléter les années de sortie et vérifier chaque fiche active ; ensuite seulement, le Super Admin (avec son contrôle MFA) peut activer le réglage dans Administration → Paramètres. Le cron est défini à `35 18 * * *` UTC, soit 00 h 05 à Bhubaneswar.

## Matrice de tests manuels

À effectuer sur un projet de test ou après autorisation de déploiement, avec comptes dédiés. Aucun test fonctionnel Supabase n’a été exécuté pendant la préparation locale.

| Profil | Vérifications |
|---|---|
| Membre actif | Compléter sa fiche ; modifier ses coordonnées/formation ; vérifier que statut et e-mail n’ont pas de champ d’édition ; essayer de lire une autre fiche privée ; émettre un QR par l’administration puis télécharger plusieurs PDF et vérifier que l’identifiant de QR ne change pas. |
| Membre invité sans fiche | Utiliser l’invitation existante ; changer le mot de passe par le parcours actuel ; compléter son profil ; vérifier qu’un seul Auth UUID et une seule fiche ADEIO sont liés. Renvoyer l’e-mail depuis l’administration et vérifier qu’aucun second compte n’est créé. |
| Membre archivé | Vérifier l’impossibilité de modifier son statut/fiche active, l’accès bloqué aux annonces/documents/finances réservés aux membres actifs, tout en gardant ses propres données ; scanner son ancien QR, qui doit être invalide. |
| Trésorier | Avec MFA selon le réglage du compte, vérifier la gestion financière et les arriérés individuels. Confirmer que la réactivation de membre et la gestion des rôles restent interdites. |
| Commissaire aux comptes | Vérifier les mêmes droits financiers préexistants que le rôle autorise, sans pouvoir changer les rôles ou lancer une réactivation. |
| Admin | Créer/inviter et associer un membre, gérer les informations permises, renvoyer l’e-mail, démarrer une réactivation et émettre/révoquer un QR. Vérifier l’impossibilité de modifier le numéro d’une fiche liée et l’absence d’accès aux arriérés individuels. |
| Super Admin | Préremplir les années manquantes, activer le cycle, contrôler le refus en cas de fiche invalide, valider une réactivation complète, consulter les événements et suspendre le réglage sans réactiver les fiches archivées. |
| Échéance / cron | Sur une fiche de test dont l’année de sortie est l’année courante, vérifier avant le cron la coupure RLS et le statut de QR non actif ; appeler le cron avec le secret configuré, puis vérifier le statut `former`, la clôture des périodes et la révocation permanente. Tester un nouvel appel : aucune réactivation ni double période ne doit survenir. |
| QR et PDF | Télécharger deux fois la même carte : même QR valide et aucun nouveau jeton en base. Émettre explicitement un nouveau QR : le précédent ne doit plus vérifier. Vérifier le QR public avec photo consentie puis sans consentement. |
| Intégrité financière | Comparer les accès du Trésorier, du Commissaire, de l’Admin et du Super Admin avant/après. Les rôles existants et les écritures financières ne doivent pas changer. |

## Risques et retour arrière

| Changement | Risque / impact existant | Vérification |
|---|---|---|
| Colonnes d’année et de profil | Les colonnes restent nulles sur les anciennes fiches ; aucune donnée n’est effacée. L’activation échoue tant que les fiches actives sont incomplètes. | Comparer le nombre de fiches actives à `exit_year IS NULL`, puis inspecter les années incohérentes avant activation. |
| Tables d’onboarding, formations et événements | Aucune migration d’historique ne déduit des formations non présentes dans les anciennes tables ; les données déjà disponibles restent intactes. | Contrôler contraintes uniques, historique affiché et relation compte/fiche. |
| RLS liée à `is_current_member()` | Les membres dont l’année de sortie est atteinte perdent les accès membres immédiatement après activation. Les branches Trésorier/Commissaire/Admin existantes sont conservées. | Tests par rôle et comparaison des politiques financières avant/après. |
| FK Auth et garde de réactivation | La suppression d’un utilisateur Auth encore lié est refusée par PostgreSQL. Une mise à jour directe du statut vers `active` est refusée ; seules les étapes atomiques de réactivation l’autorisent. | Tenter ces deux opérations avec un compte administrateur de test ; les deux doivent échouer sans modifier la fiche. |
| QR chiffré et réémission | Les anciens QR sans enveloppe chiffrée restent vérifiables jusqu’à leur révocation, mais ne peuvent pas être réimprimés par le nouveau flux. Aucun jeton historique ne peut être reconstruit à partir du hash. | Émettre un QR de test, télécharger plusieurs PDF, révoquer, scanner l’ancien. |
| Cron Vercel | L’absence de `CRON_SECRET`, de clé serveur ou de déploiement peut retarder la mise à jour des statuts. Le contrôle RLS de l’année continue à bloquer les accès. | Vérifier les journaux du cron et le nombre retourné par `archive_expired_members`. |

Les migrations sont additives pour les données membres et ne suppriment pas de comptes, rôles, périodes, historiques ni jetons. Une restauration automatique par « down migration » n’est pas fournie : réactiver en masse des anciens membres serait dangereux et pourrait ressusciter une décision d’archivage manuelle. Avant application, conserver un point de restauration Supabase/PITR et vérifier qu’il n’existe pas plusieurs QR actifs pour un même membre (l’index impose désormais un seul QR actif). En cas d’échec après application, suspendre le contrôle d’année via Administration → Paramètres ; les membres déjà au statut archivé restent archivés. Cette suspension peut rouvrir les accès des lignes encore marquées `active` même si leur année est échue : elle est réservée au rollback d’urgence, jamais à une réactivation. Corriger par une migration en avant. Si une restauration complète est indispensable, restaurer un point de sauvegarde après revue des événements et des écritures intervenues depuis celui-ci ; ne pas supprimer simplement les nouvelles tables/colonnes.
