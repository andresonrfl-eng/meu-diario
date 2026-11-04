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
let failNext = false;
const calls = { upsert: 0, select: 0 };

function builder() {
  const q = { filters: [], from: 0, to: 1e9 };
  const b = {
    upsert(rows) {
      calls.upsert++;
      return {
        then: async (res, rej) => {
          try {
            if (failNext) { failNext = false; throw new TypeError('Failed to fetch'); }
            for (const r of rows) {
              const t = now();
              const row = { ...(server.get(r.id) || {}), ...r, updated_at: t };
              if (row.deleted) { row.title = ''; row.content = ''; row.mood = null; }
              server.set(r.id, row);
            }
            if (hookUpsert) { const h = hookUpsert; hookUpsert = null; await h(); }
            res({ error: null });
          } catch (e) { rej(e); }
        },
      };
    },
    select() { calls.select++; return b; },
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
const sync = createSync({ sb, onStatus: (s) => statuses.push(s), onRemoteChange: (ids) => remote.push(...ids) });
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
assert.equal(server.get('b').content, 'local pendente', 'local enviado vence');
assert.equal((await db.get('b')).content, 'local pendente');
console.log('ok 4 conflito');

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
console.log('TODOS OS TESTES PASSARAM');
process.exit(0);
