// Sincronização aparelho <-> nuvem (Supabase).
// Estratégia: 1) envia o que mudou no aparelho; 2) baixa o que mudou na nuvem.
// Conflitos: a última edição enviada vence; edições locais ainda não enviadas nunca são sobrescritas.

import * as db from './db.js';

const PUSH_CHUNK = 100;
const PULL_PAGE = 500;
// Margem de segurança ao baixar: revisita os últimos 2 minutos para não perder
// alterações gravadas quase ao mesmo tempo em outro aparelho.
const PULL_OVERLAP_MS = 2 * 60 * 1000;
const COLUMNS = 'id,title,content,mood,created_at,updated_at,deleted';

function isNetworkError(e) {
  if (!navigator.onLine) return true;
  const msg = String(e?.message || e || '');
  return e instanceof TypeError || /failed to fetch|networkerror|network request failed|load failed|fetch/i.test(msg);
}

export function createSync({ sb, onStatus, onRemoteChange }) {
  let current = null;   // promessa da sincronização em andamento
  let again = false;    // pediram outra sincronização durante a atual
  let timer = null;
  let interval = null;
  let started = false;

  async function push() {
    const dirty = await db.getDirty();
    for (let i = 0; i < dirty.length; i += PUSH_CHUNK) {
      const chunk = dirty.slice(i, i + PUSH_CHUNK);
      const rows = chunk.map((e) => ({
        id: e.id,
        title: e.deleted ? '' : (e.title || ''),
        content: e.deleted ? '' : (e.content || ''),
        mood: e.deleted ? null : (e.mood ?? null),
        created_at: e.created_at,
        deleted: !!e.deleted,
      }));
      const { error } = await sb.from('entries').upsert(rows, { onConflict: 'id' });
      if (error) throw error;
      for (const e of chunk) await db.markClean(e.id, e.rev);
    }
  }

  async function pull() {
    const saved = await db.getMeta('cursor');
    let since = '1970-01-01T00:00:00Z';
    if (saved) {
      const t = Date.parse(saved);
      if (!Number.isNaN(t)) since = new Date(Math.max(0, t - PULL_OVERLAP_MS)).toISOString();
    }
    const changed = [];
    let last = saved;
    for (let from = 0; ; from += PULL_PAGE) {
      const { data, error } = await sb
        .from('entries')
        .select(COLUMNS)
        .gte('updated_at', since)
        .order('updated_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PULL_PAGE - 1);
      if (error) throw error;
      for (const row of data) {
        if (await db.applyRemote(row)) changed.push(row.id);
        last = row.updated_at;
      }
      if (data.length < PULL_PAGE) break;
    }
    if (last && last !== saved) await db.setMeta('cursor', last);
    return changed;
  }

  function run() {
    if (current) { again = true; return current; }
    if (!navigator.onLine) { onStatus('offline'); return Promise.resolve(); }
    current = (async () => {
      onStatus('syncing');
      try {
        await push();
        const changed = await pull();
        const pending = await db.countDirty();
        onStatus(pending ? 'pending' : 'synced');
        if (changed.length) onRemoteChange(changed);
      } catch (e) {
        console.warn('Falha na sincronização:', e);
        onStatus(isNetworkError(e) ? 'offline' : 'error', e);
      }
    })().finally(() => {
      current = null;
      if (again && started) { again = false; schedule(300); }
    });
    return current;
  }

  function schedule(ms = 1500) {
    if (!started) return;
    clearTimeout(timer);
    timer = setTimeout(run, ms);
  }

  const onOnline = () => schedule(300);
  const onOffline = () => onStatus('offline');
  const onVisible = () => { if (document.visibilityState === 'visible') schedule(300); };

  // Tempo real: o Supabase avisa quando algo muda na tabela (só as linhas do próprio
  // usuário, por causa do RLS). O aviso só dispara uma sincronização normal — os dados
  // continuam vindo pelo pull, que é a única fonte de verdade.
  let channel = null;
  function subscribeRealtime() {
    if (channel || typeof sb.channel !== 'function') return;
    try {
      channel = sb
        .channel('entries-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'entries' }, () => schedule(400))
        .subscribe((status) => {
          // Ao (re)conectar, sincroniza para pegar o que mudou enquanto estava desconectado.
          if (status === 'SUBSCRIBED') schedule(300);
        });
    } catch (e) {
      console.warn('Tempo real indisponível:', e);
      channel = null;
    }
  }
  function unsubscribeRealtime() {
    if (!channel) return;
    const ch = channel;
    channel = null;
    try { sb.removeChannel(ch); } catch { /* ignore */ }
  }

  function start() {
    if (started) return;
    started = true;
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    interval = setInterval(() => { if (document.visibilityState === 'visible') run(); }, 60 * 1000);
    subscribeRealtime();
    run();
  }

  function stop() {
    started = false;
    again = false;
    clearTimeout(timer);
    clearInterval(interval);
    unsubscribeRealtime();
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    document.removeEventListener('visibilitychange', onVisible);
  }

  // Espera a sincronização atual (se houver) e roda mais uma completa.
  async function runNow() {
    if (current) await current;
    return run();
  }

  return { start, stop, schedule, runNow };
}
