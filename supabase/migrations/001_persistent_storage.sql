-- Run once in the Supabase SQL editor. Only backend service_role can access data.
create table if not exists public.hltpc_objects (
  store text not null,
  key text not null,
  value jsonb not null,
  kind text not null default 'json' check (kind in ('json', 'binary')),
  metadata jsonb not null default '{}'::jsonb,
  etag uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  primary key (store, key)
);
alter table public.hltpc_objects enable row level security;
revoke all on public.hltpc_objects from anon, authenticated;
grant all on public.hltpc_objects to service_role;

create or replace function public.hltpc_write_object(
  p_store text, p_key text, p_value jsonb, p_kind text,
  p_metadata jsonb, p_expected_etag uuid default null,
  p_only_if_new boolean default false
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  previous public.hltpc_objects%rowtype;
  next_etag uuid := gen_random_uuid();
begin
  -- Lock even absent keys, so two first writes cannot both succeed.
  perform pg_advisory_xact_lock(hashtextextended(p_store || ':' || p_key, 0));
  select * into previous from public.hltpc_objects
    where store = p_store and key = p_key for update;
  if (p_only_if_new and previous.etag is not null)
    or (p_expected_etag is not null and previous.etag is distinct from p_expected_etag) then
    return jsonb_build_object('modified', false);
  end if;
  if p_store = 'hltpc-content' and p_key = 'current' and previous.etag is not null then
    insert into public.hltpc_objects (store, key, value)
      values (p_store, 'history/' || lpad(coalesce(previous.value->>'_revision', '0'), 12, '0'),
        jsonb_build_object('content', previous.value, 'revision', previous.value->'_revision', 'backedUpAt', now()))
      on conflict do nothing;
  end if;
  insert into public.hltpc_objects(store, key, value, kind, metadata, etag)
    values (p_store, p_key, p_value, p_kind, p_metadata, next_etag)
    on conflict (store, key) do update set value = excluded.value,
      kind = excluded.kind, metadata = excluded.metadata, etag = excluded.etag, updated_at = now();
  return jsonb_build_object('modified', true, 'etag', next_etag);
end;
$$;
revoke all on function public.hltpc_write_object(text,text,jsonb,text,jsonb,uuid,boolean) from public, anon, authenticated;
grant execute on function public.hltpc_write_object(text,text,jsonb,text,jsonb,uuid,boolean) to service_role;

-- Private bucket: images are served by the authenticated backend through /api/media.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('hltpc-media', 'hltpc-media', false, 1500000, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;
