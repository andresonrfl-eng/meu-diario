// Fotos de páginas: envio, recebimento, exclusão na nuvem e PDF seguro.
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, userAgent: 'node' }, configurable: true });
globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};

const P = new URL('../js/', import.meta.url).href;
const db = await import(`${P}db.js`);
const { createSync } = await import(`${P}sync.js`);
const { pdfSafe, pdfBodyWithMarks } = await import(`${P}pdf.js`);
const { samePages, pagesLabel } = await import(`${P}pages.js`);

const rows = new Map();
const files = new Map();
let tick = Date.parse('2026-11-10T12:00:00Z');
const stamp = () => new Date(tick += 11).toISOString();
let uploadFails = 0;
let upsertFailsWithNetwork = 0;

function table() {
  const q = { ids: null, since: null, from: 0, to: 1e9 };
  const result = () => {
    let out = [...rows.values()];
    if (q.ids) out = out.filter((r) => q.ids.includes(r.id));
    if (q.since) out = out.filter((r) => r.updated_at >= q.since);
    out.sort((a, b) => a.updated_at.localeCompare(b.updated_at));
    return { data: out.slice(q.from, q.to + 1), error: null };
  };
  const b = {
    upsert(list) {
      const exec = async () => {
        if (upsertFailsWithNetwork > 0) { upsertFailsWithNetwork--; throw new TypeError('Failed to fetch'); }
        const data = list.map((r) => {
          const row = { ...(rows.get(r.id) || {}), ...r, updated_at: stamp() };
          if (row.deleted) row.pages = [];
          rows.set(r.id, row);
          return { id: r.id, updated_at: row.updated_at };
        });
        return { data, error: null };
      };
      return { select: () => ({ then: (ok, no) => exec().then(ok, no) }) };
    },
    select: () => b,
    in: (_, ids) => { q.ids = ids; return b; },
    gte: (_, v) => { q.since = v; return b; },
    order: () => b,
    range: (a, z) => { q.from = a; q.to = z; return b; },
    then: (ok, no) => Promise.resolve(result()).then(ok, no),
  };
  return b;
}

const sb = {
  from: () => table(),
  storage: {
    from: () => ({
      async upload(path, blob) {
        if (uploadFails > 0) { uploadFails--; return { error: { message: 'Bucket cheio' } }; }
        files.set(path, blob);
        return { error: null };
      },
      async remove(paths) { paths.forEach((p) => files.delete(p)); return { error: null }; },
      async download(path) { return files.has(path) ? { data: files.get(path), error: null } : { data: null, error: { message: 'not found' } }; },
    }),
  },
};

let conflicts = 0;
const statuses = [];
const sync = createSync({ sb, onStatus: (s) => statuses.push(s), onRemoteChange() {}, onConflict: (n) => { conflicts += n; }, getUserId: () => 'u1' });
const blob = (text) => new Blob([text], { type: 'image/jpeg' });
const entry = (id, pages, extra = {}) => ({ id, title: '', content: '', mood: null, pages, created_at: stamp(), rev: `${id}-1`, dirty: 1, deleted: false, ...extra });

// 1
await db.putImage({ name: 'a.jpg', blob: blob('foto a'), uploaded: 0 });
await db.putLocal(entry('e1', ['a.jpg']));
await sync.runNow();
assert.ok(files.has('u1/a.jpg'), 'foto subiu para a pasta do usuário');
assert.deepEqual(rows.get('e1').pages, ['a.jpg']);
assert.equal((await db.getPendingImages()).length, 0);
console.log('ok 1 foto sobe junto com a anotação');

// 2
await sync.runNow();
assert.equal(files.size, 1);
console.log('ok 2 foto enviada não sobe de novo');

// 3
uploadFails = 1;
await db.putImage({ name: 'b.jpg', blob: blob('foto b'), uploaded: 0 });
await db.putLocal({ ...(await db.get('e1')), pages: ['a.jpg', 'b.jpg'], rev: 'e1-2', dirty: 1 });
await sync.runNow();
assert.equal(statuses.at(-1), 'error', 'avisa que algo não subiu');
assert.equal((await db.getPendingImages()).length, 1, 'continua pendente');
await sync.runNow();
assert.ok(files.has('u1/b.jpg'));
console.log('ok 3 foto recusada é tentada de novo');

// 4
const remote = { id: 'r1', title: '', content: '', mood: null, pages: ['c.jpg'], created_at: stamp(), updated_at: stamp(), deleted: false };
rows.set('r1', remote);
files.set('u1/c.jpg', blob('foto c'));
await sync.runNow();
assert.deepEqual((await db.get('r1')).pages, ['c.jpg']);
assert.equal(await db.getImage('c.jpg'), null, 'só baixa a imagem quando precisa');
assert.ok(await sync.downloadImage('c.jpg'));
assert.ok((await db.getImage('c.jpg')).blob);
console.log('ok 4 anotação de outro aparelho traz a foto sob demanda');

// 5
await db.putLocal({ ...(await db.get('e1')), title: '', content: '', pages: [], deleted: true, dirty: 1, rev: 'e1-3' });
await db.trashImages(['a.jpg', 'b.jpg']);
await sync.runNow();
assert.equal(files.has('u1/a.jpg') || files.has('u1/b.jpg'), false, 'excluir no app exclui as fotos da nuvem');
assert.equal(await db.getImage('a.jpg'), null);
assert.deepEqual(await db.getMeta('imageTrash'), []);
console.log('ok 5 excluir apaga as fotos da nuvem');

// 6
rows.set('r1', { ...rows.get('r1'), deleted: true, pages: [], updated_at: stamp() });
await sync.runNow();
assert.equal(await db.get('r1'), null);
assert.equal(await db.getImage('c.jpg'), null, 'libera o espaço no aparelho');
console.log('ok 6 exclusão em outro aparelho libera a foto');

// 7 foto em uso por outra anotação (cópia de conflito) não é apagada
await db.putImage({ name: 'd.jpg', blob: blob('foto d'), uploaded: 0 });
await db.putLocal(entry('e2', ['d.jpg']));
await db.putLocal(entry('e3', ['d.jpg']));
await sync.runNow();
await db.trashImages(['d.jpg']);
await sync.runNow();
assert.ok(files.has('u1/d.jpg'));
console.log('ok 7 foto usada por outra anotação continua na nuvem');

// 8 conflito com queda de rede: uma única cópia
conflicts = 0;
await db.putLocal(entry('e4', [], { content: 'v1' }));
await sync.runNow();
rows.set('e4', { ...rows.get('e4'), content: 'versão do outro aparelho', updated_at: stamp() });
await db.putLocal({ ...(await db.get('e4')), content: 'versão daqui', rev: 'e4-2', dirty: 1 });
const countCopies = () => [...rows.values()].filter((r) => /outro aparelho/i.test(r.title || '')).length;
upsertFailsWithNetwork = 2;
await sync.runNow();
await sync.runNow();
await sync.runNow();
await sync.runNow();
assert.equal(countCopies(), 1, 'a queda de rede não pode multiplicar a cópia');
assert.equal(rows.get('e4').content, 'versão daqui');
console.log('ok 8 queda de rede não multiplica cópias de conflito');

// 9 limpar tudo apaga as fotos do aparelho
await db.putImage({ name: 'z.jpg', blob: blob('z'), uploaded: 0 });
await db.clearAll();
assert.equal(await db.getImage('z.jpg'), null);
console.log('ok 9 sair da conta apaga as fotos do aparelho');

// 10 PDF
assert.equal(pdfSafe('Coração às vezes: não é fácil'), 'Coração às vezes: não é fácil');
assert.equal(pdfSafe('“aspas” – travessão… fim 😄'), '"aspas" - travessão... fim');
assert.equal(pdfSafe('linha 1\r\nlinha 2'), 'linha 1\nlinha 2');
assert.equal(pdfSafe(null), '');
assert.equal(pagesLabel(1), '1 foto de página');
assert.equal(pagesLabel(3), '3 fotos de páginas');
assert.equal(samePages(['a'], ['a']), true);
assert.equal(samePages(undefined, []), true);
assert.equal(samePages(['a', 'b'], ['b', 'a']), false);
console.log('ok 10 texto seguro para o PDF');

// 11 marca-texto: sobe, desce, entra no conflito e some ao excluir
{
  const hl = [{ start: 0, end: 4, color: 'yellow' }];
  await db.putLocal(entry('h1', [], { content: 'Hoje foi bom', highlights: hl }));
  await sync.runNow();
  assert.deepEqual(rows.get('h1').highlights, hl, 'marcações sobem com a anotação');
  rows.set('h2', { id: 'h2', title: '', content: 'Outro aparelho', mood: null, pages: [], highlights: [{ start: 6, end: 14, color: 'green' }], created_at: stamp(), updated_at: stamp(), deleted: false });
  rows.set('h3', { id: 'h3', title: '', content: 'Sem coluna', mood: null, pages: [], created_at: stamp(), updated_at: stamp(), deleted: false });
  await sync.runNow();
  assert.deepEqual((await db.get('h2')).highlights, [{ start: 6, end: 14, color: 'green' }], 'marcações descem');
  assert.deepEqual((await db.get('h3')).highlights, [], 'linha antiga sem marcações vira lista vazia');
  // só a marcação mudou nos dois aparelhos: guarda as duas versões
  conflicts = 0;
  rows.set('h1', { ...rows.get('h1'), highlights: [{ start: 5, end: 8, color: 'red' }], updated_at: stamp() });
  await db.putLocal({ ...(await db.get('h1')), highlights: [{ start: 9, end: 12, color: 'green' }], rev: 'h1-2', dirty: 1 });
  await sync.runNow();
  assert.equal(conflicts, 1, 'marcação diferente nos dois aparelhos não se perde');
  const copy = [...rows.values()].find((r) => r.content === 'Hoje foi bom' && r.id !== 'h1');
  assert.deepEqual(copy.highlights, [{ start: 5, end: 8, color: 'red' }]);
  await db.putLocal({ ...(await db.get('h1')), title: '', content: '', highlights: [], deleted: true, dirty: 1, rev: 'h1-3' });
  await sync.runNow();
  assert.deepEqual(rows.get('h1').highlights, [], 'excluída não guarda marcações');
  console.log('ok 11 marca-texto sincroniza entre aparelhos');
}

// 12 PDF com marca-texto: posições continuam certas mesmo quando o PDF tira emojis
{
  const text = 'Oi 😄 tudo bem? Hoje… ótimo';
  const start = text.indexOf('tudo');
  const hl = [{ start, end: start + 'tudo bem'.length, color: 'yellow' }, { start: text.indexOf('ótimo'), end: text.length, color: 'red' }];
  const { clean, marks } = pdfBodyWithMarks(text, hl);
  assert.equal(clean, 'Oi  tudo bem? Hoje... ótimo');
  assert.deepEqual(marks.map((m) => `${m.color}:${clean.slice(m.start, m.end)}`), ['yellow:tudo bem', 'red:ótimo']);
  assert.equal(pdfBodyWithMarks('sem nada', []).marks.length, 0);
  console.log('ok 12 marca-texto no PDF');
}

console.log('TODOS OS TESTES DE FOTOS PASSARAM');
process.exit(0);
