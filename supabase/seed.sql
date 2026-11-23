-- Données de référence sans personnes réelles ni comptes privilégiés.
insert into public.settings(key, value)
values
  ('former_members_visibility', 'false'::jsonb),
  ('member_photo_consent_required', 'true'::jsonb),
  ('data_retention_years', '{"years": 5}'::jsonb)
on conflict (key) do nothing;

insert into public.executive_positions(title, sort_order) values
  ('Président', 10),
  ('Vice-président', 20),
  ('Secrétaire général', 30),
  ('Trésorier général', 40),
  ('Commissaire aux comptes', 50),
  ('Responsable de pôle', 60),
  ('Secrétariat', 70)
on conflict (title) do update set sort_order = excluded.sort_order, is_active = true;

insert into public.transaction_categories(name, direction) values
  ('Cotisations', 'income'),
  ('Dons et partenariats', 'income'),
  ('Activités associatives', 'income'),
  ('Fonctionnement', 'expense'),
  ('Activités et événements', 'expense'),
  ('Aide et solidarité', 'expense')
on conflict (name) do nothing;
