-- bump_published_stats was declared with p_id uuid, but published_itineraries.id
-- is a text slug ("pub_xxxxxx" minted client-side). Every call therefore failed
-- the uuid cast and views/copies never persisted to the server. Retype to text.
-- Run in the Supabase SQL editor (or supabase db push) once per environment.

drop function if exists public.bump_published_stats(p_id uuid, p_kind text);

create or replace function public.bump_published_stats(p_id text, p_kind text)
returns void as $$
begin
  if p_kind = 'views' then
    update public.published_itineraries set views = views + 1 where id = p_id;
  elsif p_kind = 'copies' then
    update public.published_itineraries set copies = copies + 1 where id = p_id;
  end if;
end;
$$ language plpgsql security definer;

grant execute on function public.bump_published_stats(text, text) to anon, authenticated;
