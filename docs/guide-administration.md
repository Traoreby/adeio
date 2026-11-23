# Guide d’administration ADEIO — Phases 1 et 2

## Ajouter un administrateur

1. Inviter son adresse depuis **Supabase → Authentication → Users**.
2. L’utilisateur reçoit un lien, définit son premier mot de passe et se connecte.
3. Un super-administrateur peut attribuer `admin` dans **Administration → Utilisateurs et rôles**. Pour initialiser le tout premier super-administrateur uniquement, utilisez le SQL Editor Supabase après avoir remplacé l’UUID :

```sql
insert into public.user_roles (user_id, role, created_by)
values ('UUID_DU_COMPTE', 'admin', 'UUID_DU_SUPER_ADMIN')
on conflict do nothing;
```

Les comptes ne doivent pas partager leurs identifiants. Le rôle `super_admin` ne doit être accordé qu’aux personnes chargées de l’administration technique et des rôles.

Dans **Utilisateurs et rôles**, le super-administrateur peut inviter un compte membre et attribuer les rôles Membre, Trésorier, Commissaire aux comptes, Administrateur ou Super-administrateur. La clé service role est nécessaire pour envoyer les invitations ; elle reste côté serveur.

Les titulaires des rôles Trésorier, Commissaire aux comptes, Administrateur et Super-administrateur peuvent ouvrir **Sécurité du compte** pour activer le TOTP avec leur application d’authentification. Tant qu’un compte n’a pas activé le TOTP, l’accès facultatif reste désactivé. Après activation, la base exige le niveau AAL2 pour les opérations sensibles. La désactivation demande un code TOTP valide.

## Publier une annonce

1. Ouvrir **Administration → Annonces**.
2. Saisir un titre, un identifiant URL en minuscules séparé par des tirets, un résumé facultatif et le texte.
3. Choisir la visibilité « Public » ou « Membres connectés ».
4. Cocher « Publier immédiatement » pour rendre l’annonce visible. La case « Épingler à la une » l’affiche en priorité.
5. Depuis la liste, publier/dépublier ou épingler/désépingler une annonce.

Le contenu est rendu comme du texte brut. Les pièces jointes et l’éditeur riche seront intégrés dans une phase ultérieure.

## Créer et renouveler le bureau

1. S’assurer que les membres actifs et les postes de référence sont présents dans Supabase.
2. Dans **Administration → Bureau exécutif**, créer un mandat avec son nom et sa date de début.
3. Le mandat courant est automatiquement archivé lorsque le nouveau mandat est créé.
4. Attribuer les fonctions aux membres actifs. Une fonction unique ne peut être affectée qu’une fois par mandat.
5. Vérifier la page publique **Bureau exécutif** après chaque modification.

## Ajouter une fiche membre

1. Ouvrir **Administration → Membres → Ajouter un membre**.
2. Renseigner le nom, les prénoms, l’année d’adhésion et, si nécessaire, l’année de sortie et le statut. Le numéro au format `ADEIO-AAAA-XXXX` est généré automatiquement.
3. Ajouter les coordonnées facultatives et, si le compte a déjà été invité, associer son compte. Les coordonnées restent privées.
4. L’autorisation de publier une photo est indépendante de l’ajout de photo. Sans consentement, la photo n’est pas montrée sur la page publique de vérification.
5. La fiche permet d’enregistrer une photo, de consulter les périodes de présence, d’ajouter une période et de mettre à jour les informations. Les périodes précédentes sont conservées.

Pour relier un membre à un compte, inviter d’abord son adresse dans **Utilisateurs et rôles**. Le lien du compte permet ensuite au membre de consulter **Mon profil** et ses coordonnées privées.

## Importer les membres

1. Télécharger le modèle CSV dans **Administration → Membres → Import groupé**.
2. Renseigner les colonnes `nom, prenoms, annee_entree, annee_sortie, statut, email, telephone`. Le statut accepté est `actif`, `ancien`, `suspendu` ou `decede`.
3. Choisir un CSV UTF-8 ou un fichier Excel `.xlsx`. L’aperçu valide les données localement avant envoi ; corriger les lignes invalides dans le fichier source.
4. Cliquer **Importer**. Le rapport indique pour chaque ligne si elle a été enregistrée. La limite est de 250 lignes par import. Les photos et les comptes ne sont pas importés par ce formulaire.

## QR Codes et cartes membre

- Depuis une fiche membre, **Émettre un QR Code** crée un lien aléatoire. Le QR peut être scanné depuis l’aperçu et le lien copié pour vérification.
- **Régénérer** révoque l’ancien lien au moment de l’émission. **Désactiver** rend le lien actuel invalide.
- Depuis **Administration → QR Codes et cartes**, sélectionner jusqu’à 100 membres et générer un PDF A4 de cartes. Jusqu’à huit cartes sont disposées sur chaque page.
- Chaque émission en lot génère de nouveaux QR Codes et révoque ceux déjà associés aux membres sélectionnés. Conserver le PDF en lieu sûr et le détruire en cas de remplacement.
- La page publique de vérification ne montre que le nom, le numéro de membre, le statut, la fonction actuelle et la photo consentie. Les coordonnées ne sont jamais affichées.

## Annuaire et archives

- Les membres connectés ayant le rôle `member` peuvent ouvrir **Annuaire** et **Archives** depuis leur espace membre.
- L’annuaire ne contient que les membres actifs et ne révèle pas les coordonnées privées.
- La visibilité des archives suit le réglage **Paramètres → Visibilité des anciens membres**. Les administrateurs consultent les archives depuis leur administration.
- La recherche par année utilise les périodes de présence ; il est possible d’ajouter plusieurs périodes à une même fiche.

## Migrations et photos

Après la migration initiale, appliquer `supabase/migrations/202611230002_phase2_members.sql`. Le bucket `member-photos` doit exister (créé par la migration initiale) et rester privé. Les images téléversées sont recadrées au carré et compressées dans le navigateur avant stockage.
