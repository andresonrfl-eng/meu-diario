// Banco de dados LOCAL (IndexedDB) — guarda tudo no aparelho, funciona offline.
// Cada anotação: { id, title, content, mood, created_at, updated_local,
//                  server_updated_at, rev, dirty, deleted }
//  - rev:   contador local, aumenta a cada edição (evita perder edições durante a sincronização)
//  - dirty: 1 = ainda não enviada para a nuvem
//  - deleted: marcador de exclusão (enviado para a nuvem e depois removido do aparelho)

const DB_NAME = 'meu-diario';
const DB_VERSION = 1;
let dbPromise = null;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('entries')) d.createObjectStore('entries', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
      };
      req.onsuccess = () => {
        const d = req.result;
        d.onversionchange = () => { d.close(); dbPromise = null; };
        d.onclose = () => { dbPromise = null; };
        resolve(d);
      };
      req.onerror = () => { dbPromise = null; reject(req.error); };
      req.onblocked = () => console.warn('IndexedDB bloqueado por outra aba aberta.');
    });
  }
  return dbPromise;
}

// Executa uma transação. `work(tx, setResult)` deve disparar as requisições de forma síncrona.
async function run(stores, mode, work) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    let result;
    let tx;
    try {
      tx = d.transaction(stores, mode);
    } catch (e) {
      dbPromise = null; // conexão pode ter sido fechada; tenta reabrir na próxima
      reject(e);
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transação abortada'));
    try {
      work(tx, (v) => { result = v; });
    } catch (e) {
      try { tx.abort(); } catch { /* já finalizada */ }
      reject(e);
    }
  });
}

export function getAll() {
  return run('entries', 'readonly', (tx, set) => {
    const r = tx.objectStore('entries').getAll();
    r.onsuccess = () => set(r.result || []);
  });
}

export function put(entry) {
  return run('entries', 'readwrite', (tx) => { tx.objectStore('entries').put(entry); });
}

export async function getDirty() {
  return (await getAll()).filter((e) => e.dirty);
}

export async function countDirty() {
  return (await getDirty()).length;
}

// Depois de enviar para a nuvem: só marca como "limpo" se ninguém editou no meio-tempo.
// serverUpdatedAt = versão que ficou no servidor; é guardada mesmo se houve edição no meio
// (serve de "base" para detectar edições feitas em outro aparelho — ver sync.js).
export function markClean(id, rev, serverUpdatedAt) {
  return run('entries', 'readwrite', (tx) => {
    const s = tx.objectStore('entries');
    const r = s.get(id);
    r.onsuccess = () => {
      const rec = r.result;
      if (!rec) return;
      const base = serverUpdatedAt ? { server_updated_at: serverUpdatedAt } : {};
      if (rec.rev !== rev) {
        if (serverUpdatedAt) s.put({ ...rec, ...base });
        return;
      }
      if (rec.deleted) s.delete(id);
      else s.put({ ...rec, ...base, dirty: 0 });
    };
  });
}

// Aplica uma linha vinda da nuvem. Retorna true se algo mudou no aparelho.
// Se a cópia local tem edições não enviadas, a local vence (será enviada na próxima vez).
export function applyRemote(row) {
  return run('entries', 'readwrite', (tx, set) => {
    set(false);
    const s = tx.objectStore('entries');
    const r = s.get(row.id);
    r.onsuccess = () => {
      const rec = r.result;
      if (rec && rec.dirty) return;
      if (row.deleted) {
        if (rec) { s.delete(row.id); set(true); }
        return;
      }
      if (rec && rec.server_updated_at === row.updated_at) return;
      s.put({
        id: row.id,
        title: row.title ?? '',
        content: row.content ?? '',
        mood: row.mood ?? null,
        created_at: row.created_at,
        server_updated_at: row.updated_at,
        updated_local: row.updated_at,
        rev: rec?.rev || 0,
        dirty: 0,
        deleted: false,
      });
      set(true);
    };
  });
}

export function get(id) {
  return run('entries', 'readonly', (tx, set) => {
    const r = tx.objectStore('entries').get(id);
    r.onsuccess = () => set(r.result || null);
  });
}

export function getMeta(key) {
  return run('meta', 'readonly', (tx, set) => {
    const r = tx.objectStore('meta').get(key);
    r.onsuccess = () => set(r.result ?? null);
  });
}

export function setMeta(key, value) {
  return run('meta', 'readwrite', (tx) => { tx.objectStore('meta').put(value, key); });
}

export function clearAll() {
  return run(['entries', 'meta'], 'readwrite', (tx) => {
    tx.objectStore('entries').clear();
    tx.objectStore('meta').clear();
  });
}
