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

function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const toRow = (e) => ({
  id: e.id,
  title: e.deleted ? '' : (e.title || ''),
  content: e.deleted ? '' : (e.content || ''),
  mood: e.deleted ? null : (e.mood ?? null),
  created_at: e.created_at,
  deleted: !!e.deleted,
});

export function createSync({ sb, onStatus, onRemoteChange, onConflict }) {
  let current = null;   // promessa da sincronização em andamento
  let again = false;    // pediram outra sincronização durante a atual
  let timer = null;
  let interval = null;
  let started = false;

  // Conflito: a mesma anotação foi editada aqui E em outro aparelho desde a última sincronização.
  // Em vez de uma versão apagar a outra, a versão do outro aparelho vira uma anotação separada.
  async function saveConflictCopies(chunk) {
    const known = chunk.filter((e) => e.server_updated_at && !e.deleted);
    if (!known.length) return [];
    const { data, error } = await sb.from('entries').select(COLUMNS).in('id', known.map((e) => e.id));
    if (error) throw error;
    const byId = new Map((data || []).map((r) => [r.id, r]));
    const copies = [];
    for (const e of known) {
      const srv = byId.get(e.id);
      if (!srv || srv.deleted || srv.updated_at === e.server_updated_at) continue;
      if ((srv.title || '') === (e.title || '') && (srv.content || '') === (e.content || '')) continue;
      const copy = {
        id: newId(),
        title: srv.title ? `${srv.title} (versão de outro aparelho)` : 'Versão de outro aparelho',
        content: srv.content || '',
        mood: srv.mood ?? null,
        created_at: srv.created_at,
        rev: newId(),
        dirty: 1,
        deleted: false,
        updated_local: new Date().toISOString(),
      };
      await db.put(copy);
      copies.push(copy.id);
    }
    return copies;
  }

  async function sendRows(list) {
    const { data, error } = await sb.from('entries').upsert(list.map(toRow), { onConflict: 'id' }).select('id,updated_at');
    if (error) throw error;
    const stamp = new Map((data || []).map((r) => [r.id, r.updated_at]));
    for (const e of list) await db.markClean(e.id, e.rev, stamp.get(e.id));
  }

  // Envia o que mudou. Devolve { copies, failed }.
  async function push() {
    const dirty = await db.getDirty();
    const copies = [];
    let failed = 0;
    for (let i = 0; i < dirty.length; i += PUSH_CHUNK) {
      const chunk = dirty.slice(i, i + PUSH_CHUNK);
      copies.push(...await saveConflictCopies(chunk));
      try {
        await sendRows(chunk);
      } catch (e) {
        if (isNetworkError(e)) throw e;
        // Uma anotação com problema não pode travar as outras: tenta uma por uma.
        for (const one of chunk) {
          try { await sendRows([one]); } catch (e2) {
            if (isNetworkError(e2)) throw e2;
            failed++;
            console.warn('Anotação não enviada', one.id, e2);
          }
        }
      }
    }
    // As cópias de conflito também precisam subir.
    if (copies.length) {
      const fresh = (await Promise.all(copies.map((id) => db.get(id)))).filter(Boolean);
      if (fresh.length) await sendRows(fresh);
    }
    return { copies, failed };
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
        const { copies, failed } = await push();
        const changed = await pull();
        for (const id of copies) if (!changed.includes(id)) changed.push(id);
        const pending = await db.countDirty();
        if (failed) onStatus('error', new Error(`${failed} anotação(ões) não puderam ser enviadas`));
        else onStatus(pending ? 'pending' : 'synced');
        if (changed.length) onRemoteChange(changed);
        if (copies.length) onConflict?.(copies.length);
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
