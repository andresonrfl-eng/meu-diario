-- =====================================================================
-- Meu Diário — lembrete diário (notificações)
-- Como usar: Supabase > SQL Editor > cole este arquivo > Run. Idempotente.
-- Pré-requisito: a função "send-reminders" publicada (supabase/functions/send-reminders).
-- =====================================================================

-- Uma linha por aparelho que ativou o lembrete.
create table if not exists public.push_subscriptions (
  endpoint         text primary key check (char_length(endpoint) <= 1000),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  p256dh           text not null check (char_length(p256dh) <= 200),
  auth             text not null check (char_length(auth) <= 100),
  remind_at        time not null default '20:00',
  tz               text not null default 'America/Sao_Paulo' check (char_length(tz) <= 64),
  skip_if_written  boolean not null default true,
  last_sent        date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.push_subscriptions is 'Aparelhos que recebem o lembrete diário. Cada usuário só vê os seus (RLS).';

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

create or replace function public.push_subscriptions_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists push_subscriptions_before_write on public.push_subscriptions;
create trigger push_subscriptions_before_write
  before insert or update on public.push_subscriptions
  for each row execute function public.push_subscriptions_before_write();

alter table public.push_subscriptions enable row level security;
alter table public.push_subscriptions force row level security;

drop policy if exists "push_select_own" on public.push_subscriptions;
drop policy if exists "push_insert_own" on public.push_subscriptions;
drop policy if exists "push_update_own" on public.push_subscriptions;
drop policy if exists "push_delete_own" on public.push_subscriptions;

create policy "push_select_own" on public.push_subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "push_insert_own" on public.push_subscriptions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "push_update_own" on public.push_subscriptions
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "push_delete_own" on public.push_subscriptions
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.push_subscriptions from anon;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- ---------------------------------------------------------------------
-- Agendamento: a cada 5 minutos chama a função que envia os lembretes do horário.
-- A função só envia o que está na hora (e uma vez por dia por aparelho),
-- então chamá-la a mais não causa envios extras.
-- ---------------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'diario-lembretes') then
    perform cron.unschedule('diario-lembretes');
  end if;
end;
$$;

select cron.schedule(
  'diario-lembretes',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := 'https://fusyhpwqspbidtarkxbe.supabase.co/functions/v1/send-reminders',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $job$
);
