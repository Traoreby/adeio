# Vérifications manuelles — Phase 1

Cette liste est destinée à l’équipe ADEIO après raccordement à un projet Supabase de test.

## Site public

- Ouvrir l’accueil sur un téléphone, une tablette et un ordinateur ; vérifier le menu, les boutons et l’affichage du logo.
- Ouvrir À propos, Bureau, Actualités, Contact, Mentions légales et Confidentialité.
- Vérifier que les pages vides affichent un message clair et qu’aucun membre ou contenu fictif n’est présenté comme réel.
- Tester les liens, le focus clavier et les formulaires au clavier seul.
- Vérifier les contrastes et le zoom navigateur à 200 %.

## Authentification

- Vérifier qu’aucun formulaire d’inscription publique n’est disponible.
- Inviter un compte de test par Supabase Auth, ouvrir le lien, définir son premier mot de passe et vérifier la redirection vers le changement obligatoire.
- Essayer une connexion avec une adresse inconnue et une mauvaise combinaison ; le message ne doit pas révéler si un compte existe.
- Demander un lien « Mot de passe oublié », puis essayer un lien expiré.
- Pour un compte admin, activer TOTP, se déconnecter, se reconnecter et vérifier que l’accès à l’administration attend un code valide.
- Avec TOTP activé, essayer une requête de données sensibles avec un jeton AAL1 ; les politiques RLS doivent refuser l’accès.
- Désactiver TOTP avec un code valide et vérifier que le compte revient à son niveau de protection facultatif.
- Essayer d’ouvrir `/admin` sans session et avec un compte membre simple.
- Vérifier qu’un compte sans rôle admin est renvoyé vers l’espace membre.

## Administration — annonces et bureau

- Avec un compte admin, créer un brouillon, le publier, l’épingler, le désépingler et le dépublier.
- Vérifier qu’une annonce publique apparaît sur le site et qu’un brouillon n’apparaît pas.
- Vérifier que les slugs invalides ou déjà utilisés sont refusés.
- Créer un mandat, vérifier l’archivage du précédent, ajouter une fonction puis la retirer.
- Vérifier qu’une même fonction et qu’un même membre ne peuvent pas être dupliqués dans un mandat.
- Avec un compte membre, essayer d’accéder directement aux pages d’administration.

## RLS et données sensibles

- Avec un compte `anon`, sélectionner directement `members`, `member_private_details`, `member_qr_tokens`, `financial_transactions`, `contribution_dues`, `contribution_payments` et `audit_log` : aucun accès ne doit être accordé.
- Avec un membre, lire uniquement ses propres coordonnées privées et les données autorisées par les politiques.
- Avec un administrateur, vérifier l’accès aux membres et au contenu, mais l’absence d’accès aux arriérés et paiements individuels.
- Avec un trésorier ou commissaire, vérifier l’accès aux arriérés et paiements nécessaires.
- Avec un super-administrateur, vérifier la consultation du journal d’audit.
- Sur la page de vérification, tester un jeton aléatoire puis un jeton de test actif, révoqué et associé à un ancien membre.

## Déploiement

- Tester les variables d’environnement de production et les URLs de redirection Supabase.
- Vérifier les en-têtes de sécurité en HTTPS.
- Confirmer les sauvegardes Supabase et réaliser une restauration de test avant l’ouverture réelle.
