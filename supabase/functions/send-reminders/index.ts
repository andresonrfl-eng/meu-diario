// Meu Diário — envia o lembrete diário (Web Push).
// Chamado a cada 5 min pelo pg_cron (supabase/lembretes.sql). Só envia para os aparelhos cujo
// horário chegou, uma vez por dia, e pula quem já escreveu no dia (se a pessoa escolheu isso).
//
// Segredos (Supabase > Edge Functions > Secrets):
//   VAPID_PRIVATE_KEY  — chave privada (nunca no código nem no repositório)
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem automaticamente nas funções.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

const VAPID_PUBLIC_KEY = 'BP7KuqyXTKEraMgLwhItHp9GwrGB7ti3z8GaWZ8rBTD-33f8bA7b2L6hNZsL_ef1iwItCYY1R7MGB4yUzws8-tM';
const APP_URL = 'https://andresonrfl-eng.github.io/meu-diario/';
const WINDOW_MIN = 30; // envia até 30 min depois do horário (se o agendador atrasar)

const MESSAGES = [
  'Que tal um respiro? Conte como foi seu dia. 🌅',
  'Um minutinho para você: como você está hoje?',
  'Seu diário está aqui quando quiser. Pode ditar, sem forçar o pescoço.',
  'Hora do seu respiro. O que ficou na sua cabeça hoje?',
  'Escrever um pouquinho já vale. Como foi o dia?',
];

type Sub = {
  endpoint: string;
  user_id: string;
  p256dh: string;
  auth: string;
  remind_at: string; // "HH:MM:SS"
  tz: string;
  skip_if_written: boolean;
  last_sent: string | null;
};

function localParts(date: Date, tz: string) {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date);
  } catch {
    return localParts(date, 'America/Sao_Paulo');
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

Deno.serve(async () => {
  const priv = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!priv) return new Response('VAPID_PRIVATE_KEY não configurada', { status: 500 });
  webpush.setVapidDetails(APP_URL, VAPID_PUBLIC_KEY, priv.trim());

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY'))!, {
    auth: { persistSession: false },
  });

  const { data: subs, error } = await sb.from('push_subscriptions').select('*');
  if (error) return new Response(error.message, { status: 500 });

  const now = new Date();
  let sent = 0, skipped = 0, removed = 0;

  for (const s of (subs ?? []) as Sub[]) {
    const { day, minutes } = localParts(now, s.tz);
    const [h, m] = s.remind_at.split(':').map(Number);
    const due = h * 60 + m;
    if (s.last_sent === day || minutes < due || minutes - due > WINDOW_MIN) continue;

    if (s.skip_if_written) {
      const since = new Date(now.getTime() - 26 * 3600 * 1000).toISOString();
      const { data: recent } = await sb.from('entries')
        .select('updated_at')
        .eq('user_id', s.user_id).eq('deleted', false).gte('updated_at', since);
      const wroteToday = (recent ?? []).some((r: { updated_at: string }) => localParts(new Date(r.updated_at), s.tz).day === day);
      if (wroteToday) {
        await sb.from('push_subscriptions').update({ last_sent: day }).eq('endpoint', s.endpoint);
        skipped++;
        continue;
      }
    }

    const body = MESSAGES[Math.floor(Math.random() * MESSAGES.length)];
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title: 'Meu Diário', body, url: APP_URL }),
        { TTL: 3 * 3600, urgency: 'normal' },
      );
      await sb.from('push_subscriptions').update({ last_sent: day }).eq('endpoint', s.endpoint);
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        // aparelho desinstalou o app ou cancelou a permissão
        await sb.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
        removed++;
      } else {
        console.error('Falha ao enviar lembrete', code, String(e));
      }
    }
  }

  return new Response(JSON.stringify({ sent, skipped, removed }), { headers: { 'Content-Type': 'application/json' } });
});
