// Simulação com DOIS aparelhos de verdade (cada um com seu próprio banco IndexedDB)
// falando com o mesmo "Supabase" simulado. Faz centenas de operações aleatórias
// (escrever, editar, excluir, cair a internet, sincronizar fora de ordem) e no fim confere:
//   1) os dois aparelhos e o servidor ficam IGUAIS (convergência);
//   2) nenhum texto escrito se perde (a última versão de cada aparelho existe em algum lugar),
//      exceto quando a anotação foi excluída de propósito.
import { IDBFactory } from 'fake-indexeddb';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

globalThis.window = globalThis;
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, userAgent: 'node' }, configurable: true, writable: true });
globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
console.warn = () => {}; // falhas simuladas de rede são esperadas
// IDs previsíveis para a simulação ser repetível
let uuidN = 0;
Object.defineProperty(globalThis.crypto, 'randomUUID', { value: () => `copia-${++uuidN}`, configurable: true });
const SEED = Number(process.env.SEED || 12345);

const SRC = fileURLToPath(new URL('../js/', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'diario-sim-'));

// Cada aparelho recebe uma cópia própria de db.js + sync.js (módulos e banco separados).
async function makeDevice(name) {
  const dir = join(tmp, name);
  (await import('node:fs')).mkdirSync(dir);
  copyFileSync(join(SRC, 'db.js'), join(dir, 'db.js'));
  copyFileSync(join(SRC, 'sync.js'), join(dir, 'sync.js'));
  globalThis.indexedDB = new IDBFactory(); // banco novo, só deste aparelho
  const db = await import(pathToFileURL(join(dir, 'db.js')).href);
  await db.getAll(); // abre a conexão com o banco deste aparelho
  const { createSync } = await import(pathToFileURL(join(dir, 'sync.js')).href);
  return { name, db, createSync, online: true };
}

// ---- servidor simulado (comportamento do Supabase + trigger do schema.sql) ----
const server = new Map();
let clock = Date.parse('2026-11-07T12:00:00Z');
const tick = () => new Date(clock += 1000).toISOString();
let currentDevice = null;

function builder() {
  const q = { filters: [], from: 0, to: 1e9 };
  const offline = () => currentDevice && !currentDevice.online;
  const b = {
    upsert(rows) {
      const exec = async () => {
        if (offline()) throw new TypeError('Failed to fetch');
        const out = [];
        for (const r of rows) {
          const t = tick();
          const row = { ...(server.get(r.id) || {}), ...r, updated_at: t };
          if (row.deleted) { row.title = ''; row.content = ''; row.mood = null; }
          server.set(r.id, row);
          out.push({ id: r.id, updated_at: t });
        }
        return { data: out, error: null };
      };
      return { select: () => ({ then: (res, rej) => exec().then(res, rej) }) };
    },
    select() { return b; },
    in(col, vals) { q.filters.push((r) => vals.includes(r[col])); return b; },
    gte(col, v) { q.filters.push((r) => Date.parse(r[col]) >= Date.parse(v)); return b; },
    order() { return b; },
    range(a, z) { q.from = a; q.to = z; return b; },
    then(res, rej) {
      if (offline()) { rej(new TypeError('Failed to fetch')); return; }
      const rows = [...server.values()].filter((r) => q.filters.every((f) => f(r)))
        .sort((x, y) => x.updated_at.localeCompare(y.updated_at) || x.id.localeCompare(y.id));
      res({ data: rows.slice(q.from, q.to + 1).map((r) => ({ ...r })), error: null });
    },
  };
  return b;
}

// gerador aleatório com semente (o teste é repetível)
let seed = SEED;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

const A = await makeDevice('celular');
const B = await makeDevice('pc');
let conflictCopies = 0;
for (const d of [A, B]) {
  d.sync = d.createSync({
    sb: { from: () => builder() },
    onStatus: () => {},
    onRemoteChange: () => {},
    onConflict: (n) => { conflictCopies += n; },
  });
}

async function on(dev, fn) {
  currentDevice = dev;
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: dev.online, userAgent: 'node' }, configurable: true, writable: true });
  try { return await fn(); } finally { currentDevice = null; }
}

const trace = [];
const ids = [];
const deletedIds = new Set();
const deletedTexts = []; // textos de anotações (ou cópias) excluídas de propósito
const lastWritten = new Map(); // "aparelho|id" -> último texto escrito naquele aparelho
let n = 0;
const uid = () => `e${++n}`;

async function write(dev) {
  const all = (await dev.db.getAll()).filter((e) => !e.deleted);
  if (!all.length || rnd() < 0.35) {
    const id = uid();
    ids.push(id);
    const content = `${dev.name} criou ${id} #${n}`;
    await dev.db.put({ id, title: '', content, mood: null, created_at: tick(), rev: `${id}-${n}`, dirty: 1, deleted: false });
    lastWritten.set(`${dev.name}|${id}`, content);
  } else {
    const e = pick(all);
    const content = `${e.content} | ${dev.name} editou #${++n}`; // continua escrevendo em cima
    await dev.db.put({ ...e, content, rev: `${e.id}-${n}`, dirty: 1 });
    lastWritten.set(`${dev.name}|${e.id}`, content);
    trace.push(`EDIT ${dev.name} ${e.id} base=${e.server_updated_at} -> ${content}`);
  }
}

async function remove(dev) {
  const all = (await dev.db.getAll()).filter((e) => !e.deleted);
  if (!all.length) return;
  const e = pick(all);
  deletedIds.add(e.id);
  deletedTexts.push(e.content);
  trace.push(`DEL ${dev.name} ${e.id} ${e.content}`);
  await dev.db.put({ ...e, title: '', content: '', mood: null, deleted: true, rev: `${e.id}-del-${++n}`, dirty: 1 });
}

for (let step = 0; step < 600; step++) {
  const dev = rnd() < 0.5 ? A : B;
  const r = rnd();
  if (r < 0.45) await write(dev);
  else if (r < 0.52) await remove(dev);
  else if (r < 0.60) dev.online = !dev.online;          // cai / volta a internet
  else {
    await on(dev, () => dev.sync.runNow());          // sincroniza
    for (const e of await dev.db.getAll()) trace.push(`${step} ${dev.name} online=${dev.online} ${e.id} dirty=${e.dirty} base=${e.server_updated_at} ${e.content}`);
  }
}

// fim do dia: internet volta nos dois e cada um sincroniza algumas vezes
A.online = true; B.online = true;
for (let i = 0; i < 3; i++) {
  await on(A, () => A.sync.runNow());
  await on(B, () => B.sync.runNow());
}

const view = async (dev) => (await dev.db.getAll()).filter((e) => !e.deleted)
  .map((e) => `${e.id}=${e.content}`).sort();
const srv = [...server.values()].filter((r) => !r.deleted).map((r) => `${r.id}=${r.content}`).sort();
const va = await view(A);
const vb = await view(B);

assert.deepEqual(va, srv, 'celular igual ao servidor');
assert.deepEqual(vb, srv, 'PC igual ao servidor');
assert.equal((await A.db.countDirty()) + (await B.db.countDirty()), 0, 'nada pendente');
console.log(`ok convergência: ${srv.length} anotações iguais nos 2 aparelhos e no servidor`);

// Uma versão está "salva" se ela (ou uma continuação escrita em cima dela) existe no final.
const finalContents = [...server.values()].filter((r) => !r.deleted).map((r) => r.content);
let checked = 0;
for (const [key, content] of lastWritten) {
  const id = key.split('|')[1];
  if (deletedIds.has(id)) continue; // excluída de propósito
  // o texto foi parar numa cópia (ou continuação) que a pessoa depois excluiu de propósito
  if (deletedTexts.some((c) => c.startsWith(content))) continue;
  if (!finalContents.some((c) => c.startsWith(content))) {
    const row = server.get(id);
    console.log('DEBUG', key, JSON.stringify(row));
    console.log('DEBUG A', JSON.stringify(await A.db.get(id)));
    console.log('DEBUG B', JSON.stringify(await B.db.get(id)));
    console.log('DEBUG semelhantes', finalContents.filter((c) => c.startsWith(content.slice(0, 40))));
    console.log('DEBUG log', JSON.stringify(trace.filter((t) => t.includes(id))));
  }
  assert.ok(finalContents.some((c) => c.startsWith(content)), `texto perdido: ${key} -> "${content}"`);
  checked++;
}
console.log(`ok nenhum texto perdido (${checked} últimas versões conferidas, ${conflictCopies} conflitos guardados como cópia)`);

rmSync(tmp, { recursive: true, force: true });
console.log('SIMULAÇÃO COM 2 APARELHOS PASSOU');
process.exit(0);
