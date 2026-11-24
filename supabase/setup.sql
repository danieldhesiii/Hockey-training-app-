-- SHIFT Hockey optional backend, schema v1.
-- Review and run in a NEW dedicated Supabase project's SQL editor.
-- This script does not provision a project or modify any remote project itself.
-- Each owner has an independent copy of deterministic seed IDs.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $setup$
declare
  table_name text;
  existing_comment text;
begin
  foreach table_name in array array[
    'users','plan','phases','weeks','sessions','session_exercises','exercises',
    'set_logs','skill_logs','test_results','wellness_logs','personal_records','sync_queue'
  ] loop
    if to_regclass(format('public.%I',table_name)) is not null then
      select obj_description(to_regclass(format('public.%I',table_name)),'pg_class') into existing_comment;
      if existing_comment is distinct from 'SHIFT Hockey schema v1' then
        raise exception 'Existing public.% is not a SHIFT table. Use a new dedicated project.', table_name;
      end if;
    end if;
    execute format($ddl$
      create table if not exists public.%I (
        user_id uuid not null references auth.users(id) on delete cascade,
        id uuid not null,
        created_at timestamptz not null,
        updated_at timestamptz not null,
        change_id uuid not null,
        deleted boolean not null default false,
        data jsonb not null,
        server_updated_at timestamptz not null default clock_timestamp(),
        primary key (user_id,id),
        constraint object_payload check (jsonb_typeof(data) = 'object'),
        constraint payload_size check (pg_column_size(data) <= 300000),
        constraint matching_metadata check (
          data ?& array['id','createdAt','updatedAt','changeId','deleted']
          and jsonb_typeof(data->'id') = 'string'
          and jsonb_typeof(data->'createdAt') = 'string'
          and jsonb_typeof(data->'updatedAt') = 'string'
          and jsonb_typeof(data->'changeId') = 'string'
          and data->>'id' = id::text
          and (data->>'createdAt')::timestamptz = created_at
          and (data->>'updatedAt')::timestamptz = updated_at
          and data->>'changeId' = change_id::text
          and jsonb_typeof(data->'deleted') = 'boolean'
          and (data->>'deleted')::boolean = deleted
        )
      )
    $ddl$,table_name);
    execute format('comment on table public.%I is %L',table_name,'SHIFT Hockey schema v1');
    execute format('alter table public.%I enable row level security',table_name);
    -- Grants and RLS are separate controls. Do not rely on automatic grants.
    execute format('revoke all on table public.%I from public, anon, authenticated',table_name);
    execute format('grant select, insert, update on table public.%I to authenticated',table_name);
    execute format('drop policy if exists owner_select on public.%I',table_name);
    execute format('drop policy if exists owner_insert on public.%I',table_name);
    execute format('drop policy if exists owner_update on public.%I',table_name);
    execute format('create policy owner_select on public.%I for select to authenticated using ((select auth.uid()) = user_id)',table_name);
    execute format('create policy owner_insert on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)',table_name);
    execute format('create policy owner_update on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',table_name);
  end loop;
end;
$setup$;

grant usage on schema public to authenticated;

-- One RPC call is one database transaction. ON CONFLICT locks the entity row
-- while comparing versions. Neither an earlier timestamp nor a lower tie UUID
-- can overwrite a newer version. The winning record is returned in input order.
create or replace function public.shift_push(p_changes jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  owner_id uuid := auth.uid();
  allowed_tables constant text[] := array[
    'users','plan','phases','weeks','sessions','session_exercises','exercises',
    'set_logs','skill_logs','test_results','wellness_logs','personal_records'
  ];
  item jsonb;
  payload jsonb;
  table_name text;
  row_id uuid;
  change_uuid uuid;
  created_time timestamptz;
  changed_time timestamptz;
  is_deleted boolean;
  winner jsonb;
  result jsonb := '[]'::jsonb;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    raise exception 'p_changes must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_changes) > 100 or pg_column_size(p_changes) > 30000000 then
    raise exception 'Push batch exceeds the allowed size' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(p_changes) loop
    table_name := item->>'table';
    if table_name is null or not (table_name = any(allowed_tables)) then
      raise exception 'Unsupported sync table' using errcode = '22023';
    end if;
    payload := item->'record';
    if payload is null or jsonb_typeof(payload) <> 'object' or pg_column_size(payload) > 300000
       or not (payload ?& array['id','createdAt','updatedAt','deleted','changeId'])
       or jsonb_typeof(payload->'deleted') <> 'boolean' then
      raise exception 'Invalid record payload' using errcode = '22023';
    end if;
    row_id := (payload->>'id')::uuid;
    change_uuid := (payload->>'changeId')::uuid;
    created_time := (payload->>'createdAt')::timestamptz;
    changed_time := (payload->>'updatedAt')::timestamptz;
    is_deleted := (payload->>'deleted')::boolean;
    if row_id is null or change_uuid is null or created_time is null or changed_time is null
       or not isfinite(created_time) or not isfinite(changed_time)
       or payload->>'id' <> row_id::text or payload->>'changeId' <> change_uuid::text then
      raise exception 'Invalid canonical record metadata' using errcode = '22023';
    end if;
    winner := null;
    execute format($upsert$
      insert into public.%I as existing
        (user_id,id,created_at,updated_at,change_id,deleted,data,server_updated_at)
      values ($1,$2,$3,$4,$5,$6,$7,clock_timestamp())
      on conflict (user_id,id) do update set
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        change_id = excluded.change_id,
        deleted = excluded.deleted,
        data = excluded.data,
        server_updated_at = clock_timestamp()
      where (excluded.updated_at,excluded.change_id) > (existing.updated_at,existing.change_id)
      returning data
    $upsert$,table_name)
    into winner using owner_id,row_id,created_time,changed_time,change_uuid,is_deleted,payload;
    if winner is null then
      execute format('select data from public.%I where user_id = $1 and id = $2',table_name)
      into winner using owner_id,row_id;
    end if;
    if winner is null then raise exception 'Unable to acknowledge this record'; end if;
    result := result || jsonb_build_array(jsonb_build_object('table',table_name,'record',winner));
  end loop;
  return result;
end;
$function$;

-- Keyset pagination visits the full cloud set, including tombstones, each sync.
-- A concurrent insertion before the cursor is picked up by the next sync.
-- No time or sequence cursor is persisted, avoiding permanent commit-order gaps.
create or replace function public.shift_pull(
  p_after_table text default null,
  p_after_id uuid default null,
  p_limit integer default 250
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  owner_id uuid := auth.uid();
  allowed_tables constant text[] := array[
    'users','plan','phases','weeks','sessions','session_exercises','exercises',
    'set_logs','skill_logs','test_results','wellness_logs','personal_records'
  ];
  table_name text;
  union_sql text := '';
  result jsonb;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'Page size must be between 1 and 500' using errcode = '22023';
  end if;
  if (p_after_table is null) <> (p_after_id is null)
     or (p_after_table is not null and not (p_after_table = any(allowed_tables))) then
    raise exception 'Invalid page cursor' using errcode = '22023';
  end if;
  foreach table_name in array allowed_tables loop
    if union_sql <> '' then union_sql := union_sql || ' union all '; end if;
    union_sql := union_sql || format('select %L::text as table_name,id,data from public.%I where user_id = $1',table_name,table_name);
  end loop;
  execute format($pull$
    select coalesce(jsonb_agg(jsonb_build_object('table',page.table_name,'record',page.data)
      order by page.table_name collate "C",page.id),'[]'::jsonb)
    from (
      select * from (%s) records
      where ($2::text is null or (table_name collate "C",id) > ($2::text collate "C",$3::uuid))
      order by table_name collate "C",id
      limit $4
    ) page
  $pull$,union_sql)
  into result using owner_id,p_after_table,p_after_id,p_limit;
  return result;
end;
$function$;

revoke all on function public.shift_push(jsonb) from public,anon,authenticated;
revoke all on function public.shift_pull(text,uuid,integer) from public,anon,authenticated;
grant execute on function public.shift_push(jsonb) to authenticated;
grant execute on function public.shift_pull(text,uuid,integer) to authenticated;
comment on function public.shift_push(jsonb) is 'SHIFT owner-scoped atomic last-write-wins push. Local sync_queue is excluded.';
comment on function public.shift_pull(text,uuid,integer) is 'SHIFT owner-scoped keyset pull including tombstones.';

commit;
