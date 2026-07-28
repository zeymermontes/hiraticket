-- ============================================================
-- SOLO LOCAL — lo corre `supabase start` / `supabase db reset`.
-- Nunca se aplica a producción (no es una migración).
--
--   El stack local de la CLI crea las tablas con dueño `postgres`, y los default
--   privileges de ese rol en `public` dan a anon/authenticated solo Dxtm
--   (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN) — sin SELECT/INSERT/UPDATE/DELETE.
--   Supabase hosted sí otorga los CRUD, así que sin esto la app funciona en prod
--   y falla en local con "permission denied for table ...": todo lo que sea
--   SECURITY DEFINER (create_business, el trigger de profiles) corre bien y todo
--   lo que lee tablas directo (getMyBusiness) devuelve null.
--
--   Dar CRUD a anon/authenticated es lo mismo que hace Supabase hosted: quien
--   protege los datos son las RLS, no los grants. Así local reproduce prod.
-- ============================================================

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables    in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;

-- Para que las tablas/funciones que agreguen migraciones futuras nazcan con los
-- mismos permisos y no haya que volver a tocar este archivo.
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
