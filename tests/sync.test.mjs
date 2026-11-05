import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, userAgent: 'node' }, configurable: true });
globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};

const P = new URL('../js/', import.meta.url).href;
const db = await import(P + 'db.js');
const { createSync } = await import(P + 'sync.js');

// ---- Supabase simulado ----
const server = new Map();
let tick = Date.parse('2026-11-04T20:00:00Z');
const now = () => new Date(tick += 7).toISOString();
let hookUpsert = null;
const MAX_CONTENT = 200000;
let failNext = false;
const calls = { upsert: 0, select: 0 };

function builder() {
  const q = { filters: [], from: 0, to: 1e9 };
  const b = {
    upsert(rows) {
      calls.upsert++;
      const exec = async () => {
        if (failNext) { failNext = false; throw new TypeError('Failed to fetch'); }
        // como o Postgres: a gravação do lote é tudo ou nada (check constraint)
        if (rows.some((r) => (r.content || '').length > MAX_CONTENT)) {
          return { data: null, error: { message: 'new row violates check constraint "entries_content_check"', code: '23514' } };
        }
        const out = [];
        for (const r of rows) {
          const t = now();
          const row = { ...(server.get(r.id) || {}), ...r, updated_at: t };
          if (row.deleted) { row.title = ''; row.content = ''; row.mood = null; }
          server.set(r.id, row);
          out.push({ id: r.id, updated_at: t });
        }
        if (hookUpsert) { const h = hookUpsert; hookUpsert = null; await h(); }
        return { data: out, error: null };
      };
      return { select: () => ({ then: (res, rej) => exec().then(res, rej) }) };
    },
    select() { calls.select++; return b; },
    in(col, vals) { q.filters.push((r) => vals.includes(r[col])); return b; },
    gte(col, v) { q.filters.push((r) => Date.parse(r[col]) >= Date.parse(v)); return b; },
    order() { return b; },
    range(a, z) { q.from = a; q.to = z; return b; },
    then(res) {
      const rows = [...server.values()].filter((r) => q.filters.every((f) => f(r)))
        .sort((x, y) => x.updated_at.localeCompare(y.updated_at) || x.id.localeCompare(y.id));
      res({ data: rows.slice(q.from, q.to + 1), error: null });
    },
  };
  return b;
}
const sb = { from: () => builder() };

const statuses = [];
let remote = [];
let conflicts = 0;
const sync = createSync({
  sb, onStatus: (s) => statuses.push(s), onRemoteChange: (ids) => remote.push(...ids), onConflict: (n) => { conflicts += n; },
});
const last = () => statuses[statuses.length - 1];

// 1. entrada local é enviada
await db.put({ id: 'a', title: 'T', content: 'oi', mood: 4, created_at: now(), rev: 1, dirty: 1, deleted: false });
await sync.runNow();
assert.equal(server.get('a').content, 'oi');
assert.equal((await db.get('a')).dirty, 0);
assert.equal(last(), 'synced');
console.log('ok 1 envio');

// 2. edição durante o envio não é perdida
await db.put({ ...(await db.get('a')), content: 'v2', rev: 2, dirty: 1 });
hookUpsert = async () => { await db.put({ ...(await db.get('a')), content: 'v3', rev: 3, dirty: 1 }); };
await sync.runNow();
assert.equal((await db.get('a')).content, 'v3', 'local mantém v3');
assert.equal((await db.get('a')).dirty, 1, 'v3 continua pendente');
assert.equal(last(), 'pending');
await sync.runNow();
assert.equal(server.get('a').content, 'v3');
assert.equal((await db.get('a')).dirty, 0);
console.log('ok 2 edição concorrente');

// 3. mudança vinda de outro aparelho
remote = [];
server.set('b', { id: 'b', title: '', content: 'do celular', mood: null, created_at: now(), updated_at: now(), deleted: false });
server.set('a', { ...server.get('a'), content: 'editado no tablet', updated_at: now() });
await sync.runNow();
assert.equal((await db.get('b')).content, 'do celular');
assert.equal((await db.get('a')).content, 'editado no tablet');
assert.ok(remote.includes('a') && remote.includes('b'));
console.log('ok 3 recebe remoto');

// 4. remoto não sobrescreve edição local pendente
await db.put({ ...(await db.get('b')), content: 'local pendente', rev: 5, dirty: 1 });
hookUpsert = null;
server.set('b', { ...server.get('b'), content: 'remoto conflitante', updated_at: now() });
await sync.runNow();
assert.equal(server.get('b').content, 'local pendente', 'local enviado fica na anotação original');
assert.equal((await db.get('b')).content, 'local pendente');
{
  // ...e a versão do outro aparelho NÃO se perde: vira uma anotação separada
  const copia = [...server.values()].find((r) => r.content === 'remoto conflitante' && r.id !== 'b');
  assert.ok(copia, 'versão do outro aparelho guardada como cópia');
  assert.match(copia.title, /outro aparelho/);
  assert.equal((await db.get(copia.id)).dirty, 0, 'cópia já enviada');
  assert.equal(conflicts, 1);
}
console.log('ok 4 conflito (nada se perde)');

// 5. exclusão remota remove localmente
server.set('b', { ...server.get('b'), deleted: true, content: '', updated_at: now() });
await sync.runNow();
assert.equal(await db.get('b'), null);
console.log('ok 5 exclusão remota');

// 6. exclusão local é enviada e apaga o texto no servidor
await db.put({ ...(await db.get('a')), title: '', content: '', deleted: true, rev: 9, dirty: 1 });
await sync.runNow();
assert.equal(server.get('a').deleted, true);
assert.equal(server.get('a').content, '');
assert.equal(await db.get('a'), null);
console.log('ok 6 exclusão local');

// 7. paginação (1200 linhas)
for (let i = 0; i < 1200; i++) {
  const id = 'p' + String(i).padStart(4, '0');
  server.set(id, { id, title: '', content: 'x' + i, mood: null, created_at: now(), updated_at: now(), deleted: false });
}
await sync.runNow();
const all = await db.getAll();
assert.equal(all.filter((e) => e.id.startsWith('p')).length, 1200);
console.log('ok 7 paginação');

// 8. queda de rede
await db.put({ id: 'c', title: '', content: 'offline', mood: null, created_at: now(), rev: 1, dirty: 1, deleted: false });
failNext = true;
await sync.runNow();
assert.equal(last(), 'offline');
assert.equal((await db.get('c')).dirty, 1);
await sync.runNow();
assert.equal(server.get('c').content, 'offline');
console.log('ok 8 sem internet e recuperação');

// 9. chamadas simultâneas não rodam duas sincronizações ao mesmo tempo
const before = calls.select;
await Promise.all([sync.runNow(), sync.runNow(), sync.runNow()]);
assert.ok(calls.select - before <= 3 * 3, 'sem explosão de chamadas');
console.log('ok 9 concorrência');

// 10. clearAll limpa cursor e dados
await db.clearAll();
assert.equal((await db.getAll()).length, 0);
assert.equal(await db.getMeta('cursor'), null);
console.log('ok 10 limpar');

// 11. tempo real: aviso do Supabase dispara uma sincronização; stop() remove o canal
{
  let handler = null; let removed = 0;
  const ch = {
    on(type, filter, cb) { assert.equal(type, 'postgres_changes'); assert.equal(filter.table, 'entries'); handler = cb; return ch; },
    subscribe(cb) { cb('SUBSCRIBED'); return ch; },
  };
  const sbRt = { from: () => builder(), channel: () => ch, removeChannel: (c) => { assert.equal(c, ch); removed++; } };
  const rtRemote = [];
  const rt = createSync({ sb: sbRt, onStatus: () => {}, onRemoteChange: (ids) => rtRemote.push(...ids) });
  rt.start();
  await rt.runNow();
  assert.ok(handler, 'assinou o canal');
  server.set('rt1', { id: 'rt1', title: '', content: 'chegou na hora', mood: null, created_at: now(), updated_at: now(), deleted: false });
  handler({ eventType: 'INSERT' });
  await new Promise((r) => setTimeout(r, 700));
  await rt.runNow();
  assert.equal((await db.get('rt1')).content, 'chegou na hora');
  assert.ok(rtRemote.includes('rt1'));
  rt.stop();
  assert.equal(removed, 1, 'canal removido ao parar');
  console.log('ok 11 tempo real');
}

// 12. uma anotação recusada pelo servidor não trava as outras
{
  conflicts = 0;
  await db.put({ id: 'grande', title: '', content: 'x'.repeat(MAX_CONTENT + 1), mood: null, created_at: now(), rev: 'g1', dirty: 1, deleted: false });
  await db.put({ id: 'normal', title: '', content: 'texto normal', mood: null, created_at: now(), rev: 'n1', dirty: 1, deleted: false });
  await sync.runNow();
  assert.equal(server.get('normal')?.content, 'texto normal', 'a normal subiu');
  assert.equal(server.get('grande'), undefined, 'a recusada não subiu');
  assert.equal((await db.get('grande')).dirty, 1, 'a recusada continua guardada no aparelho');
  assert.equal(last(), 'error');
  await db.put({ ...(await db.get('grande')), content: 'agora menor', rev: 'g2' });
  await sync.runNow();
  assert.equal(server.get('grande').content, 'agora menor');
  assert.equal(last(), 'synced');
  console.log('ok 12 anotação com problema não trava as outras');
}

// 13. editar logo depois de enviar (antes de baixar de volta) não gera cópia falsa
{
  conflicts = 0;
  await db.put({ id: 'f', title: '', content: 'v1', mood: null, created_at: now(), rev: 'f1', dirty: 1, deleted: false });
  hookUpsert = async () => { await db.put({ ...(await db.get('f')), content: 'v2', rev: 'f2', dirty: 1 }); };
  await sync.runNow();
  await sync.runNow();
  assert.equal(server.get('f').content, 'v2');
  assert.equal(conflicts, 0, 'nenhuma cópia falsa');
  assert.equal([...server.values()].filter((r) => /outro aparelho/.test(r.title || '')).length, 1, 'só a cópia do teste 4');
  console.log('ok 13 sem cópias falsas');
}

// 14. anotação antiga sem "base" conhecida: não cria cópia (vence a última, como antes)
{
  conflicts = 0;
  server.set('old', { id: 'old', title: '', content: 'servidor', mood: null, created_at: now(), updated_at: now(), deleted: false });
  await db.put({ id: 'old', title: '', content: 'aparelho', mood: null, created_at: now(), rev: 'o1', dirty: 1, deleted: false });
  await sync.runNow();
  assert.equal(server.get('old').content, 'aparelho');
  assert.equal(conflicts, 0);
  console.log('ok 14 registros antigos');
}
console.log('TODOS OS TESTES PASSARAM');
process.exit(0);
