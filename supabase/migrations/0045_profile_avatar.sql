-- Agent profile picture. Stored in the public 'media' bucket (0013); avatar_url holds the public URL.
-- Display name lives in profiles.full_name and color in profiles.avatar_color (both already exist).
alter table public.profiles
  add column if not exists avatar_url text;
