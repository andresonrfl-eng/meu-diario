-- =====================================================================
-- Meu Diário — estrutura do banco de dados (Supabase / PostgreSQL)
-- Como usar: Supabase > SQL Editor > New query > cole este arquivo > Run.
-- Pode ser executado mais de uma vez sem problemas (idempotente).
-- =====================================================================

create table if not exists public.entries (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null default '' check (char_length(title) <= 300),
  content     text not null default '' check (char_length(content) <= 200000),
  mood        smallint check (mood between 1 and 5),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false
);

comment on table public.entries is 'Anotações do diário. Cada usuário só enxerga as próprias (RLS).';
comment on column public.entries.deleted is 'Marcador de exclusão para sincronizar a exclusão entre aparelhos (o texto é apagado).';

create index if not exists entries_user_updated_idx on public.entries (user_id, updated_at);

-- updated_at é SEMPRE definido pelo servidor (o relógio do celular pode estar errado).
-- user_id também não pode ser trocado depois de criado.
create or replace function public.entries_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
  end if;
  -- Anotação excluída não guarda texto
  if new.deleted then
    new.title := '';
    new.content := '';
    new.mood := null;
  end if;
  return new;
end;
$$;

drop trigger if exists entries_before_write on public.entries;
create trigger entries_before_write
  before insert or update on public.entries
  for each row execute function public.entries_before_write();

-- ---------------------------------------------------------------------
-- Segurança: Row Level Security — cada pessoa só lê/escreve o que é seu.
-- ---------------------------------------------------------------------
alter table public.entries enable row level security;
alter table public.entries force row level security;

drop policy if exists "entries_select_own" on public.entries;
drop policy if exists "entries_insert_own" on public.entries;
drop policy if exists "entries_update_own" on public.entries;
drop policy if exists "entries_delete_own" on public.entries;

create policy "entries_select_own" on public.entries
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "entries_insert_own" on public.entries
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "entries_update_own" on public.entries
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "entries_delete_own" on public.entries
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Visitantes não autenticados não têm acesso algum.
revoke all on public.entries from anon;
grant select, insert, update, delete on public.entries to authenticated;

-- ---------------------------------------------------------------------
-- "Toque" para o projeto grátis não ser pausado por falta de uso.
-- Chamado a cada 3 dias pelo GitHub (.github/workflows/manter-acordado.yml).
-- Não lê nem devolve nenhum dado: só responde a hora do servidor.
-- ---------------------------------------------------------------------
create or replace function public.ping()
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$ select now() $$;

revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;

-- ---------------------------------------------------------------------
-- Tempo real: avisa os outros aparelhos logo que algo muda.
-- O Realtime respeita o RLS: cada pessoa só recebe avisos das próprias anotações.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'entries'
  ) then
    alter publication supabase_realtime add table public.entries;
  end if;
end;
$$;
