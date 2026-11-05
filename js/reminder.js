// Lembrete diário por notificação (Web Push).
// O aparelho se inscreve no serviço de notificações do navegador e guarda a inscrição
// na tabela push_subscriptions (Supabase). A função send-reminders envia na hora escolhida.
import { VAPID_PUBLIC_KEY } from './config.js';

const PREF = 'diario.reminder';

export const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

export function getReminderPrefs() {
  try {
    const v = JSON.parse(localStorage.getItem(PREF) || 'null');
    if (v && typeof v.time === 'string') return { on: !!v.on, time: v.time, skip: v.skip !== false };
  } catch { /* ignore */ }
  return { on: false, time: '20:00', skip: true };
}
function savePrefs(p) {
  try { localStorage.setItem(PREF, JSON.stringify(p)); } catch { /* ignore */ }
}

function keyToBytes(b64url) {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function currentSubscription() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

// Ativa (ou atualiza) o lembrete neste aparelho. Lança Error com mensagem amigável.
export async function enableReminder(sb, { time, skip }) {
  if (!pushSupported) {
    throw new Error(isIOS && !isStandalone
      ? 'No iPhone/iPad, primeiro instale o app na Tela de Início (Compartilhar → Adicionar à Tela de Início) e abra por lá.'
      : 'Este navegador não permite notificações.');
  }
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') {
    throw new Error('As notificações estão bloqueadas. Libere nas permissões do navegador (ícone de cadeado ao lado do endereço) e tente de novo.');
  }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(VAPID_PUBLIC_KEY) });
  }
  const json = sub.toJSON();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';
  const { error } = await sb.from('push_subscriptions').upsert({
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    remind_at: time,
    tz,
    skip_if_written: skip,
    // null: se o horário escolhido foi há menos de 30 min, o lembrete de hoje ainda sai
    last_sent: null,
  }, { onConflict: 'endpoint' });
  if (error) throw new Error('Não foi possível salvar o lembrete na nuvem. Verifique a internet e tente de novo.');
  savePrefs({ on: true, time, skip });
}

// Desativa neste aparelho (apaga a inscrição na nuvem e no navegador).
export async function disableReminder(sb) {
  const prefs = getReminderPrefs();
  savePrefs({ ...prefs, on: false });
  if (!pushSupported) return;
  try {
    const sub = await currentSubscription();
    if (sub) {
      if (sb) await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      await sub.unsubscribe();
    }
  } catch (e) {
    console.warn('Falha ao desativar lembrete', e);
  }
}
