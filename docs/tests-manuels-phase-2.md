# Vérifications manuelles — Phase 2

À effectuer avec un projet Supabase de test et des comptes sans données réelles. Aucune fiche de démonstration nominative n’est incluse dans le seed.

## Fiches, annuaire et archives

- En tant qu’administrateur, créer un membre avec et sans compte associé, avec coordonnées vides et renseignées, puis modifier la fiche.
- Vérifier le format `ADEIO-AAAA-XXXX`, l’unicité du numéro et la création automatique d’une première période de présence.
- Ajouter une période passée, une période active et une date de sortie ; filtrer les listes avec « présent en année ».
- Essayer les statuts actif, ancien, suspendu et décédé. Vérifier que l’annuaire ne montre que les membres actifs.
- Comme membre, consulter son profil et ses coordonnées privées ; essayer de lire le profil d’un autre membre.
- Désactiver la visibilité des anciens membres, puis essayer `/archives` avec un compte membre ; activer le réglage et comparer. Les coordonnées ne doivent apparaître dans aucune liste.
- Essayer les routes membres avec un visiteur et un compte sans rôle `member`.

## Import Excel et CSV

- Télécharger le modèle, importer un CSV avec virgules, un CSV avec point-virgule et un fichier `.xlsx` à en-têtes accentués.
- Vérifier l’aperçu, les validations de prénom/nom/année/statut/e-mail, le refus des fichiers autres que CSV/XLSX, de plus de 5 Mo et de plus de 250 lignes.
- Corriger les erreurs, lancer l’import et vérifier le rapport par ligne et la présence des périodes/coordonnées privées correspondantes.
- Essayer la route API avec un compte non administrateur, un jeton AAL1 quand MFA est requis, un corps trop grand et un lot de plus de 250 lignes.

## Photos, QR Codes et cartes PDF

- Importer une photo portrait de grande taille ; vérifier l’aperçu carré, la compression, le bucket privé et l’accès refusé à un autre membre.
- Avec consentement désactivé, vérifier qu’aucune photo n’apparaît sur la vérification publique. Avec consentement actif, scanner le QR et vérifier la photo et seulement les champs autorisés.
- Générer un QR Code, scanner le lien, puis le régénérer et confirmer que l’ancien lien devient invalide. Désactiver le nouveau et vérifier aussi son invalidation.
- Vérifier le message de vérification distinct pour un membre actif, un ancien membre, un statut non actif et un jeton invalide.
- Générer un PDF pour un membre puis plusieurs membres ; vérifier le format A4, le nombre de cartes par page, les textes, le QR et l’absence de photo sans consentement.
- Vérifier que les URL signées des photos expirent et qu’un membre sans autorisation ne peut pas consulter les cartes ou les QR d’un autre.

## Régression

- Vérifier à 375 px, 768 px et 1440 px les nouvelles pages, tableaux défilants, formulaires et états vides.
- Refaire les contrôles de connexion, MFA et administration consignés dans [les vérifications de la Phase 1](tests-manuels-phase-1.md).
