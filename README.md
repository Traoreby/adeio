# ADEIO — plateforme associative

Socle Phase 1 du site officiel ADEIO : site public en français, espace de connexion sur invitation, gestion de base des annonces et du bureau exécutif, contrôles d’accès Supabase et politiques RLS.

## Stack

- Next.js App Router, TypeScript, React, Tailwind CSS et composants suivant les conventions shadcn/ui.
- Supabase Auth, PostgreSQL, Storage et Row Level Security.
- Zod et React Hook Form pour valider les formulaires.
- Icônes Lucide.

La session Supabase est stockée dans des cookies via `@supabase/ssr`. Les clés `NEXT_PUBLIC_*` ne sont pas secrètes ; la clé service role est strictement réservée au serveur.

## Démarrage local

1. Installer Node.js 20.9 ou plus récent.
2. Copier `.env.example` vers `.env.local`, puis renseigner les clés du projet Supabase.
3. Installer les dépendances : `npm install`.
4. Appliquer `supabase/migrations/202611230001_initial_schema.sql`, puis `supabase/seed.sql` dans le SQL Editor Supabase ou avec la CLI Supabase.
5. Lancer `npm run dev`, puis ouvrir `http://localhost:3000`.

Sans les variables Supabase, les pages publiques restent consultables et affichent des états vides explicites. L’authentification, les annonces persistées et l’administration nécessitent un projet Supabase.

## Variables d’environnement

| Variable | Obligatoire | Usage |
|---|---:|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Oui en production | URL du projet Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Oui en production | Clé publique publishable Supabase |
| `NEXT_PUBLIC_SITE_URL` | Oui en production | URL canonique utilisée pour les liens d’authentification |
| `SUPABASE_SERVICE_ROLE_KEY` | Oui pour invitations, première connexion et synchronisation MFA | API serveur uniquement ; ne jamais préfixer par `NEXT_PUBLIC_` |
| `CONTACT_EMAIL` | Facultative | E-mail officiel affiché dans le pied de page et la page Contact |
| `CONTACT_PHONE` | Facultative | Téléphone officiel affiché dans la page Contact |
| `CONTACT_WHATSAPP` | Facultative | Numéro WhatsApp officiel affiché dans la page Contact |

Ajouter dans Supabase Auth les URL de redirection autorisées, notamment `http://localhost:3000/auth/callback` en local et `https://<domaine>/auth/callback` en production. Activer l’envoi d’e-mails et configurer les modèles d’invitation et de récupération.

## Initialiser le premier super-administrateur

1. Créer/inviter le premier compte depuis Supabase Auth. L’inscription publique n’existe pas.
2. Récupérer l’UUID de ce compte dans `auth.users`.
3. Dans le SQL Editor Supabase, attribuer le rôle après avoir remplacé l’UUID :

```sql
insert into public.user_roles (user_id, role)
values ('UUID_DU_COMPTE', 'super_admin')
on conflict (user_id, role) do nothing;
```

Le déclencheur crée le profil et le rôle membre à la création d’un compte. Après cette initialisation, le super-administrateur peut inviter les membres et attribuer/révoquer les rôles dans **Administration → Utilisateurs et rôles**. Le dernier rôle super-administrateur ne peut pas être retiré.

Les rôles Trésorier, Commissaire aux comptes, Administrateur et Super-administrateur peuvent activer le TOTP dans **Sécurité du compte**. Une fois activé, le niveau AAL2 est imposé par les politiques de sécurité de la base pour ces rôles. La page de connexion demande alors le code TOTP.

## Mise en production

1. Créer le projet Supabase de production et appliquer les migrations.
2. Déployer le dépôt sur Vercel.
3. Définir les variables d’environnement sur Vercel, y compris la clé service role en variable serveur chiffrée.
4. Configurer les URL de redirection Supabase avec le domaine HTTPS final.
5. Compléter et valider les mentions légales, la politique de confidentialité, les contacts, les noms du bureau et les textes officiels avant l’ouverture publique.
6. Vérifier les sauvegardes quotidiennes dans le plan Supabase choisi et les renouveler régulièrement par un exercice de restauration.

Les migrations ne contiennent aucun mot de passe ni compte administrateur de démonstration. Les buckets Supabase sont privés.

## Rôles et limites d’accès

Les accès aux tables sont aussi vérifiés par RLS dans PostgreSQL. Les pages Next.js ne constituent pas la frontière de sécurité.

| Ressource | Public | Membre | Trésorier / commissaire | Administrateur | Super-administrateur |
|---|---|---|---|---|---|
| Annonces publiques publiées | Lecture | Lecture | Lecture | Gestion | Gestion |
| Annonces membres | — | Lecture | Lecture | Gestion | Gestion |
| Bureau en fonction | Lecture limitée | Lecture | Lecture | Gestion | Gestion |
| Archives de membres | — | Lecture selon réglage | Lecture selon rôle membre | Gestion | Gestion |
| Coordonnées privées membre | — | Lui-même | Lui-même | Gestion | Gestion |
| Finances générales publiées | — | Lecture | Lecture et gestion | — | Gestion |
| Cotisations et arriérés individuels | — | Les siens | Tous | — | Tous |
| Journal d’audit | — | — | — | — | Lecture |

Le président n’a pas de droit d’accès spécial aux arriérés : la fonction du bureau n’est pas un rôle de sécurité. Un président n’y accède que s’il reçoit aussi un rôle autorisé. Les administrateurs ne peuvent pas lire les paiements ni les arriérés individuels.

## Contenu officiel et démonstration

Le seed installe des fonctions de bureau, catégories de trésorerie et réglages par défaut, sans personne réelle ni compte privilégié. Les textes d’accueil sont génériques. Les mentions légales et l’adresse de contact sont volontairement signalées comme devant être renseignées par l’association.

## Documentation complémentaire

- [Guide d’administration](docs/guide-administration.md)
- [Vérifications manuelles Phase 1](docs/tests-manuels-phase-1.md)
- [Guide d’administration Phases 1 et 2](docs/guide-administration.md)
- [Vérifications manuelles Phase 2](docs/tests-manuels-phase-2.md)
- [Migration Supabase et RLS](supabase/migrations/202611230001_initial_schema.sql)
- [Migration Supabase Phase 2](supabase/migrations/202611230002_phase2_members.sql)
