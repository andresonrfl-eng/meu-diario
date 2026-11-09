// Meu Diário — lógica da interface.
import * as db from './db.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { createSync } from './sync.js';
import {
  createDictation, dictationSupported, speechSupported, speak, stopSpeaking, formatDictation,
} from './voice.js';
import { createLock, hasPin, clearPin, getLockDelay, setLockDelay } from './lock.js';
import {
  localAIAvailable, savedFolder, chooseFolder, folderReady, createLocalAI, createWhisperDictation, listMics,
} from './ai.js';
import { splitForCorrection, isSafeCorrection, diffWords } from './ai-text.js';
import { createPdf } from './pdf.js';
import { preparePage, MAX_PAGES, pagesLabel, samePages } from './pages.js';
const APP_VERSION = '1.3';
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';
const CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const SAVE_DELAY_MS = 700;
const LIST_PAGE = 300;
const FONT_MIN = 15;
const FONT_MAX = 32;
const MOODS = { 1: '😢', 2: '😕', 3: '😐', 4: '🙂', 5: '😄' };
const MOOD_NAMES = { 1: 'Muito mal', 2: 'Mal', 3: 'Neutro', 4: 'Bem', 5: 'Muito bem' };

const $ = (sel) => document.querySelector(sel);
const el = {
  app: $('#app'),
  back: $('#btn-back'),
  sidebarBtn: $('#btn-sidebar'),
  newTop: $('#btn-new-top'),
  syncStatus: $('#sync-status'),
  settingsBtn: $('#btn-settings'),
  banner: $('#banner'),
  bannerText: $('#banner-text'),
  bannerClose: $('#banner-close'),
  bannerAction: $('#banner-action'),
  backupLast: $('#backup-last'),
  btnNew: $('#btn-new'),
  search: $('#search'),
  list: $('#entry-list'),
  emptyList: $('#empty-list'),
  editorEmpty: $('#editor-empty'),
  greet: $('#greet'),
  greetIcon: $('#greet-icon'),
  editor: $('#editor'),
  date: $('#entry-date'),
  saveState: $('#save-state'),
  title: $('#entry-title'),
  content: $('#entry-content'),
  moodBtns: [...document.querySelectorAll('.mood button[data-mood]')],
  interim: $('#voice-interim'),
  btnVoice: $('#btn-voice'),
  btnSpeak: $('#btn-speak'),
  btnCorrect: $('#btn-correct'),
  btnDelete: $('#btn-delete'),
  btnPhoto: $('#btn-photo'),
  btnPhotoNew: $('#btn-photo-new'),
  btnEntryPdf: $('#btn-entry-pdf'),
  btnExportPdf: $('#btn-export-pdf'),
  pageInput: $('#page-input'),
  pageCamera: $('#page-camera'),
  pagesStrip: $('#pages-strip'),
  photoSource: $('#photo-source'),
  photoTake: $('#photo-take'),
  photoPick: $('#photo-pick'),
  pageViewer: $('#page-viewer'),
  viewerImg: $('#viewer-img'),
  viewerCount: $('#viewer-count'),
  viewerPrev: $('#viewer-prev'),
  viewerNext: $('#viewer-next'),
  viewerRemove: $('#viewer-remove'),
  viewerClose: $('#viewer-close'),
  correct: $('#correct-dialog'),
  correctPreview: $('#correct-preview'),
  correctNote: $('#correct-note'),
  aiSection: $('#ai-section'),
  aiText: $('#ai-text'),
  btnAiFolder: $('#btn-ai-folder'),
  voiceEngine: $('#voice-engine'),
  micSelect: $('#mic-select'),
  // login
  auth: $('#auth-screen'),
  tabLogin: $('#tab-login'),
  tabSignup: $('#tab-signup'),
  authForm: $('#auth-form'),
  authEmail: $('#auth-email'),
  authPassword: $('#auth-password'),
  authMsg: $('#auth-msg'),
  authSubmit: $('#auth-submit'),
  authForgot: $('#auth-forgot'),
  authLocal: $('#auth-local'),
  // configurações
  settings: $('#settings-dialog'),
  accountText: $('#account-text'),
  btnSyncNow: $('#btn-sync-now'),
  btnLoginOpen: $('#btn-login-open'),
  btnLogout: $('#btn-logout'),
  fontDec: $('#font-dec'),
  fontInc: $('#font-inc'),
  fontValue: $('#font-value'),
  themeSelect: $('#theme-select'),
  pauseSelect: $('#pause-select'),
  btnExportTxt: $('#btn-export-txt'),
  btnExportJson: $('#btn-export-json'),
  appVersion: $('#app-version'),
  pinText: $('#pin-text'),
  btnPinSet: $('#btn-pin-set'),
  btnPinRemove: $('#btn-pin-remove'),
  pinDelayRow: $('#pin-delay-row'),
  pinDelay: $('#pin-delay'),
  lockScreen: $('#lock-screen'),  // outros diálogos
  recovery: $('#recovery-dialog'),
  recoveryForm: $('#recovery-form'),
  recoveryPassword: $('#recovery-password'),
  recoveryMsg: $('#recovery-msg'),
  confirm: $('#confirm-dialog'),
  confirmTitle: $('#confirm-title'),
  confirmText: $('#confirm-text'),
  confirmOk: $('#confirm-ok'),
  toast: $('#toast'),
};

const state = {
  entries: new Map(),  // id -> anotação (sem as excluídas)
  currentId: null,
  draft: null,         // anotação nova ainda não salva (não vai para a lista até ter conteúdo)
  mood: null,
  saveTimer: null,
  saveChain: Promise.resolve(),
  pendingWrites: new Map(), // id -> nº de gravações locais ainda não concluídas
  sb: null,
  user: null,
  sessionKnown: false,
  sync: null,
  syncStatus: 'local',
  localOnly: false,
  authMode: 'login',
  speaking: false,
  preparingVoice: false,
  correcting: false,
  aiFolderSet: false,
  listLimit: 300,        // a lista desenha aos poucos: quem tem milhares de anotações não sente lentidão
  pages: [],             // fotos da anotação aberta (nomes dos arquivos)
  pagesToken: 0,
  pageUrls: [],
  photoForNew: false,
  addingPages: false,
  viewerIndex: 0,
  viewerUrl: null,
  exportingPdf: false,
};

// ---------- Utilidades ----------
const fmtDate = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
function formatWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${fmtDate.format(d)} · ${fmtTime.format(d)}`;
}
function normalize(s) {
  return String(s).toLocaleLowerCase('pt-BR').normalize('NFD').replace(/\p{Diacritic}/gu, '');
}
function getPref(key, def) {
  try { const v = localStorage.getItem('diario.' + key); return v === null ? def : v; } catch { return def; }
}
function setPref(key, value) {
  try { localStorage.setItem('diario.' + key, String(value)); } catch { /* ignore */ }
}
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // alternativa para navegadores antigos
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const isMobile = () => window.matchMedia('(max-width: 899px)').matches;

let toastTimer = null;
function toast(msg, ms = 3500) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, ms);
}

let bannerKind = null;
let bannerOnAction = null;
function showBanner(msg, { kind = 'info', action = null, onAction = null } = {}) {
  el.bannerText.textContent = msg;
  bannerKind = kind;
  bannerOnAction = onAction;
  el.bannerAction.hidden = !action;
  if (action) el.bannerAction.textContent = action;
  el.banner.hidden = false;
}
function hideBanner() {
  el.banner.hidden = true;
  if (bannerKind === 'backup') setPref('backupNagAt', Date.now());
  bannerKind = null;
  bannerOnAction = null;
}

// ---------- Lembrete de cópia de segurança ----------
const DAY = 24 * 3600 * 1000;
function renderBackupInfo() {
  const t = Number(getPref('lastBackup', '0'));
  el.backupLast.textContent = t
    ? `Última cópia baixada neste aparelho: ${fmtDate.format(new Date(t))}.`
    : 'Você ainda não baixou nenhuma cópia neste aparelho.';
}
function checkBackupReminder() {
  if (!state.entries.size || lock.isLocked()) return;
  if (!el.banner.hidden) return; // não cobre outro aviso
  const now = Date.now();
  const last = Number(getPref('lastBackup', '0'));
  const nag = Number(getPref('backupNagAt', '0'));
  if (now - nag < 3 * DAY) return; // fechou o aviso há pouco
  const oldest = Math.min(...[...state.entries.values()].map((e) => Date.parse(e.created_at) || now));
  const due = last ? now - last > 30 * DAY : now - oldest > 14 * DAY;
  if (!due) return;
  showBanner('💾 Que tal guardar uma cópia das suas anotações? Leva um toque e o arquivo fica no seu aparelho.', {
    kind: 'backup',
    action: 'Baixar cópia',
    onAction: () => exportData('txt'),
  });
}

// Abre um <dialog> com botões value="ok"/"cancel" e diz qual foi escolhido.
function askDialog(dialog) {
  return new Promise((resolve) => {
    dialog.returnValue = '';
    // Não depende só do evento "close": em alguns navegadores ele não dispara depois do envio
    // do formulário do diálogo (o botão "Excluir" parecia não fazer nada).
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      dialog.removeEventListener('submit', onSubmit);
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('close', onClose);
      if (dialog.open) dialog.close();
      resolve(ok);
    };
    const onSubmit = (ev) => { ev.preventDefault(); finish(ev.submitter?.value === 'ok'); };
    const onCancel = () => finish(false);
    const onClose = () => finish(dialog.returnValue === 'ok');
    dialog.addEventListener('submit', onSubmit);
    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('close', onClose);
    dialog.showModal();
  });
}

function confirmDialog(title, text, okLabel = 'OK') {
  el.confirmTitle.textContent = title;
  el.confirmText.textContent = text;
  el.confirmOk.textContent = okLabel;
  return askDialog(el.confirm);
}

// ---------- Status de sincronização ----------
const STATUS = {
  local: ['Só neste aparelho', ''],
  connecting: ['Conectando…', ''],
  syncing: ['Sincronizando…', ''],
  synced: ['✓ Sincronizado', 'ok'],
  pending: ['Aguardando envio…', 'warn'],
  offline: ['Sem internet — salvo no aparelho', 'warn'],
  error: ['Erro ao sincronizar', 'err'],
  loggedOut: ['Não conectado', 'warn'],
};
function setStatus(key, err) {
  state.syncStatus = key;
  const [text, cls] = STATUS[key] || STATUS.local;
  el.syncStatus.textContent = text;
  el.syncStatus.className = 'sync-status' + (cls ? ' ' + cls : '');
  el.syncStatus.title = err?.message ? `${text}: ${err.message}` : text;
  if (key === 'synced' || key === 'pending') refreshDirtyFlags().catch((e) => console.warn(e));
}

// Após sincronizar, atualiza na memória a marcação "ainda não enviada".
// Só copia o estado do banco quando a versão (rev) é a mesma, para nunca
// descartar uma edição que ainda está sendo gravada.
async function refreshDirtyFlags() {
  const all = await db.getAll();
  const byId = new Map(all.map((r) => [r.id, r]));
  let changed = false;
  for (const [id, mem] of state.entries) {
    const rec = byId.get(id);
    if (rec && rec.rev === mem.rev && rec.dirty !== mem.dirty) {
      state.entries.set(id, { ...mem, dirty: rec.dirty, server_updated_at: rec.server_updated_at });
      changed = true;
    }
  }
  if (changed) renderList();
}

// ---------- Lista ----------
function sortedEntries() {
  return [...state.entries.values()].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

function previewOf(e) {
  const text = (e.content || '').replace(/\s+/g, ' ').trim();
  return text.slice(0, 160);
}

// Texto já preparado para a busca. Cada edição cria um objeto novo, então nunca fica desatualizado.
const searchText = new WeakMap();
function searchableText(e) {
  let text = searchText.get(e);
  if (text === undefined) {
    text = normalize(`${e.title} ${e.content}`);
    searchText.set(e, text);
  }
  return text;
}

function renderList() {
  const q = normalize(el.search.value.trim());
  const items = sortedEntries().filter((e) => !q || searchableText(e).includes(q));
  const visible = items.slice(0, state.listLimit);
  const frag = document.createDocumentFragment();
  for (const e of visible) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'entry-item';
    btn.dataset.id = e.id;
    if (e.mood && MOODS[e.mood]) btn.dataset.mood = String(e.mood);
    if (e.id === state.currentId) btn.setAttribute('aria-current', 'true');

    const title = document.createElement('div');
    title.className = 'entry-item-title';
    const t = document.createElement('span');
    const pageCount = e.pages?.length || 0;
    t.textContent = e.title.trim() || previewOf(e).slice(0, 50) || (pageCount ? 'Página do diário' : 'Sem título');
    title.append(t);
    if (e.mood && MOODS[e.mood]) {
      const m = document.createElement('span');
      m.textContent = MOODS[e.mood];
      m.title = MOOD_NAMES[e.mood];
      title.append(m);
    }
    if (pageCount) {
      const p = document.createElement('span');
      p.textContent = `📷${pageCount > 1 ? ` ${pageCount}` : ''}`;
      p.title = pagesLabel(pageCount);
      title.append(p);
    }

    const prev = document.createElement('div');
    prev.className = 'entry-item-preview';
    prev.textContent = e.title.trim() ? previewOf(e) : '';
    if (!prev.textContent) prev.hidden = true;

    const date = document.createElement('div');
    date.className = 'entry-item-date';
    date.textContent = formatWhen(e.created_at);

    btn.append(title, prev, date);
    if (e.dirty && CONFIGURED && state.user) {
      const d = document.createElement('div');
      d.className = 'entry-item-dirty';
      d.textContent = 'ainda não enviada para a nuvem';
      btn.append(d);
    }
    li.append(btn);
    frag.append(li);
  }
  if (items.length > visible.length) {
    const li = document.createElement('li');
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'btn block list-more';
    more.textContent = `Mostrar mais (${items.length - visible.length})`;
    li.append(more);
    frag.append(li);
  }
  el.list.replaceChildren(frag);

  if (!items.length) {
    el.emptyList.hidden = false;
    el.emptyList.textContent = q ? 'Nada encontrado para essa busca.' : 'Seu diário está vazio. Que tal escrever a primeira anotação?';
  } else {
    el.emptyList.hidden = true;
  }
}

async function loadEntries() {
  const all = await db.getAll();
  state.entries.clear();
  for (const e of all) if (!e.deleted) state.entries.set(e.id, e);
  renderList();
}

// ---------- Navegação (celular: lista <-> editor) ----------
function showEditorView() {
  if (el.app.classList.contains('show-editor')) return;
  el.app.classList.add('show-editor');
  if (isMobile()) history.pushState({ view: 'editor' }, '');
}
function showListView(fromPopState = false) {
  if (!el.app.classList.contains('show-editor')) return;
  el.app.classList.remove('show-editor');
  if (!fromPopState && history.state?.view === 'editor') history.back();
}

// ---------- Editor ----------
function currentEntry() {
  if (!state.currentId) return null;
  if (state.draft && state.draft.id === state.currentId) return state.draft;
  return state.entries.get(state.currentId) || null;
}

function setMoodUI(mood) {
  state.mood = mood ?? null;
  for (const b of el.moodBtns) b.setAttribute('aria-pressed', String(Number(b.dataset.mood) === state.mood));
}

function fillEditor(entry) {
  el.editorEmpty.hidden = true;
  el.editor.hidden = false;
  el.date.textContent = formatWhen(entry.created_at);
  el.title.value = entry.title || '';
  el.content.value = entry.content || '';
  setMoodUI(entry.mood);
  state.pages = [...(entry.pages || [])];
  renderPages();
  el.saveState.textContent = entry === state.draft ? 'Nova anotação' : (entry.dirty ? 'Salvo no aparelho' : '');
  const len = el.content.value.length;
  try { el.content.setSelectionRange(len, len); } catch { /* ignore */ }
  el.content.scrollTop = 0;
}

function stopVoice() {
  dictation?.stop();
  if (state.speaking) { stopSpeaking(); setSpeaking(false); }
}

// Enquanto a IA revisa, o texto aberto não pode ser trocado.
function busyCorrecting() {
  if (state.correcting) toast('Aguarde a IA terminar a revisão.');
  return state.correcting;
}

async function openEntry(id) {
  if (id === state.currentId) { showEditorView(); return; }
  if (busyCorrecting()) return;
  stopVoice();
  await flushSave();
  const entry = state.entries.get(id);
  if (!entry) return;
  state.draft = null;
  state.currentId = id;
  fillEditor(entry);
  renderList();
  showEditorView();
}

async function newEntry() {
  if (busyCorrecting()) return;
  stopVoice();
  await flushSave();
  state.draft = {
    id: uuid(),
    title: '',
    content: '',
    mood: null,
    pages: [],
    created_at: new Date().toISOString(),
    rev: 0,
    dirty: 1,
    deleted: false,
  };
  state.currentId = state.draft.id;
  fillEditor(state.draft);
  renderList();
  showEditorView();
  // No celular, focar abre o teclado. Só focamos no computador/tablet grande.
  if (!isMobile()) el.content.focus();
}

function closeEditor() {
  stopVoice();
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  state.currentId = null;
  state.draft = null;
  state.pages = [];
  renderPages();
  el.editor.hidden = true;
  el.editorEmpty.hidden = false;
  renderGreeting();
  showListView();
  renderList();
}

function onEdit() {
  noteActivity();
  el.saveState.textContent = 'Editando…';
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => { saveNow(); }, SAVE_DELAY_MS);
}

// Salva a anotação aberta. As gravações são enfileiradas (saveChain) para manter a ordem.
function saveNow() {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  const cur = currentEntry();
  if (!cur) return state.saveChain;
  const title = el.title.value;
  const content = el.content.value;
  const mood = state.mood;
  const pages = [...state.pages];
  const isDraft = cur === state.draft;
  if (isDraft && !title.trim() && !content.trim() && mood == null && !pages.length) {
    el.saveState.textContent = 'Nova anotação';
    return state.saveChain;
  }
  if (!isDraft && cur.title === title && cur.content === content && (cur.mood ?? null) === mood && samePages(cur.pages, pages)) {
    el.saveState.textContent = cur.dirty ? 'Salvo no aparelho' : 'Salvo';
    return state.saveChain;
  }
  const updated = {
    ...cur,
    title,
    content,
    mood,
    pages,
    rev: newRev(),
    dirty: 1,
    updated_local: new Date().toISOString(),
  };
  // Atualiza a memória ANTES de gravar, para que a próxima edição parta desta versão.
  if (isDraft) state.draft = null;
  state.entries.set(updated.id, updated);
  queueWrite(updated).then((ok) => {
    if (ok && state.currentId === updated.id && !state.saveTimer) el.saveState.textContent = 'Salvo no aparelho';
  });
  renderList();
  return state.saveChain;
}

// Cada gravação recebe uma versão única (rev). Assim, se a anotação for editada
// enquanto é enviada para a nuvem (ou em outra aba), a versão nova nunca é marcada
// como "enviada" por engano.
function newRev() { return uuid(); }

// Grava no banco local em fila (mantém a ordem) e avisa as outras abas abertas.
function queueWrite(record) {
  state.pendingWrites.set(record.id, (state.pendingWrites.get(record.id) || 0) + 1);
  let ok = false;
  state.saveChain = state.saveChain
    .then(() => db.putLocal(record))
    .then(() => {
      ok = true;
      tabs?.postMessage({ type: 'changed', ids: [record.id] });
      state.sync?.schedule(record.deleted ? 300 : 1500);
    })
    .catch((e) => {
      console.error('Erro ao salvar', e);
      if (state.currentId === record.id) el.saveState.textContent = '⚠ Erro ao salvar';
      toast('Não foi possível salvar no aparelho. Copie seu texto por segurança.', 6000);
    })
    .finally(() => {
      const n = (state.pendingWrites.get(record.id) || 1) - 1;
      if (n > 0) state.pendingWrites.set(record.id, n); else state.pendingWrites.delete(record.id);
    });
  return state.saveChain.then(() => ok);
}

// Outras abas/janelas do app abertas no mesmo aparelho
const tabs = 'BroadcastChannel' in window ? new BroadcastChannel('meu-diario') : null;
if (tabs) {
  tabs.onmessage = (ev) => {
    if (ev.data?.type === 'changed' && Array.isArray(ev.data.ids)) onRemoteChange(ev.data.ids, { fromTab: true });
    if (ev.data?.type === 'logout') location.reload();
  };
}

function flushSave() {
  if (state.saveTimer) return saveNow();
  return state.saveChain;
}

async function deleteCurrent() {
  const cur = currentEntry();
  if (!cur) return;
  const ok = await confirmDialog(
    'Excluir esta anotação?',
    CONFIGURED && state.user
      ? 'Ela será apagada deste e de todos os seus aparelhos. Isso não pode ser desfeito.'
      : 'Ela será apagada deste aparelho. Isso não pode ser desfeito.',
    'Excluir',
  );
  if (!ok) return;
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  if (cur === state.draft) { closeEditor(); return; }
  const tomb = { ...cur, title: '', content: '', mood: null, pages: [], deleted: true, dirty: 1, rev: newRev() };
  state.entries.delete(cur.id);
  closeEditor();
  if (await queueWrite(tomb)) {
    await db.trashImages(cur.pages).catch((e) => console.warn(e));
    toast('Anotação excluída');
  }
}

// Mudanças feitas fora desta tela: baixadas da nuvem ou gravadas por outra aba.
async function onRemoteChange(ids, { fromTab = false } = {}) {
  // O banco local é compartilhado entre abas: avisa as outras que ele mudou.
  if (!fromTab) tabs?.postMessage({ type: 'changed', ids });
  const skipped = new Set();
  for (const id of ids) {
    // Esta tela tem uma gravação pendente para essa anotação: a versão da memória é a mais nova.
    if (state.pendingWrites.has(id) || (id === state.currentId && state.saveTimer)) { skipped.add(id); continue; }
    const rec = await db.get(id);
    if (rec && !rec.deleted) state.entries.set(id, rec);
    else state.entries.delete(id);
  }
  const openId = state.currentId;
  if (openId && ids.includes(openId) && !skipped.has(openId) && !state.draft) {
    const rec = state.entries.get(openId);
    if (!rec) {
      closeEditor();
      toast(fromTab ? 'Esta anotação foi excluída em outra janela.' : 'Esta anotação foi excluída em outro aparelho.');
    } else if (!state.saveTimer && !dictation?.active) {
      // A própria anotação volta da nuvem após cada envio; só avisa se o conteúdo mudou de fato.
      let differs = false;
      const selStart = el.content.selectionStart;
      if (el.title.value !== rec.title) { el.title.value = rec.title; differs = true; }
      if (el.content.value !== rec.content) {
        el.content.value = rec.content;
        differs = true;
        try { el.content.setSelectionRange(selStart, selStart); } catch { /* ignore */ }
      }
      if ((rec.mood ?? null) !== state.mood) { setMoodUI(rec.mood); differs = true; }
      if (!state.addingPages && !samePages(rec.pages, state.pages)) {
        state.pages = [...(rec.pages || [])];
        renderPages();
        differs = true;
      }
      if (differs) el.saveState.textContent = fromTab ? 'Atualizado em outra janela' : 'Atualizado de outro aparelho';
      else if (!rec.dirty) el.saveState.textContent = 'Salvo na nuvem ✓';
    }
  }
  renderList();
}

// ---------- Voz ----------
function insertAtCursor(raw) {
  const ta = el.content;
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? start;
  const text = formatDictation(raw, ta.value.slice(0, start));
  if (!text) return;
  if (ta.value.length - (end - start) + text.length > ta.maxLength && ta.maxLength > 0) {
    toast('Esta anotação chegou ao tamanho máximo. Crie uma nova para continuar.', 6000);
    return;
  }
  ta.setRangeText(text, start, end, 'end');
  // mantém o final do texto visível
  if (ta.selectionEnd === ta.value.length) ta.scrollTop = ta.scrollHeight;
  onEdit();
}

function showInterim(text) {
  el.interim.textContent = text;
  el.interim.hidden = !text;
}

let dictationEntry = null; // anotação que estava aberta quando o ditado começou
const dictationEvents = {
  // A transcrição chega um pouco depois da fala: nunca deixa cair em outra anotação.
  onFinal: (text) => { if (state.currentId === dictationEntry) insertAtCursor(text); },
  onInterim: showInterim,
  onStateChange: (on) => {
    el.btnVoice.classList.toggle('recording', on);
    el.btnVoice.setAttribute('aria-pressed', String(on));
    el.btnVoice.textContent = on ? '⏹ Parar ditado' : '🎤 Ditar';
  },
  onError: (code) => {
    const msgs = {
      'not-allowed': 'Permita o uso do microfone para ditar (ícone de cadeado na barra de endereço).',
      'service-not-allowed': 'O ditado não está disponível neste navegador. Use o microfone do teclado.',
      'audio-capture': 'Nenhum microfone encontrado.',
      network: 'O ditado precisa de internet neste navegador. Use o microfone do teclado.',
      model: 'A transcrição falhou. Toque em 🎤 Ditar para tentar de novo.',
    };
    toast(msgs[code] || 'O ditado parou. Toque em 🎤 Ditar para continuar.', 6000);
  },
};

const localAI = createLocalAI({
  onProgress: ({ loaded, total }) => {
    if (total) showInterim(`⏳ Preparando a IA deste computador… ${Math.min(100, Math.round((loaded / total) * 100))}%`);
  },
});
const browserDictation = dictationSupported ? createDictation(dictationEvents) : null;
const whisperDictation = createWhisperDictation({
  ai: localAI,
  getMic: () => getPref('mic', 'default'),
  ...dictationEvents,
});
let dictation = browserDictation;

// Liga a IA à pasta dos modelos (pede para escolher na primeira vez). Precisa vir de um toque do usuário.
async function ensureLocalAI() {
  let dir = await savedFolder();
  if (!dir) {
    const ok = await confirmDialog(
      'Onde guardar a IA deste computador?',
      'Escolha uma pasta (de preferência em um disco com espaço, como D:\\MeuDiario-IA). Se ela estiver vazia, o app baixa cerca de 4,8 GB uma única vez. Depois disso, sua voz e seu texto não saem do computador.',
      'Escolher pasta',
    );
    if (!ok) return false;
    try {
      dir = await chooseFolder();
    } catch {
      return false; // desistiu na janela de escolher pasta
    }
    state.aiFolderSet = false;
  }
  if (!await folderReady(dir)) {
    toast('Permita o acesso à pasta da IA para usar este recurso.', 6000);
    return false;
  }
  if (!state.aiFolderSet) {
    await localAI.setFolder(dir);
    state.aiFolderSet = true;
  }
  return true;
}

// Ditado no computador: Whisper na própria máquina. Sem ele, o ditado do navegador.
async function startWhisper() {
  if (!await ensureLocalAI()) return true; // desistiu: não troca para o ditado do Google sem avisar
  showInterim('⏳ Preparando a transcrição…');
  await localAI.loadWhisper();
  if (state.currentId !== dictationEntry) { showInterim(''); return true; }
  dictation = whisperDictation;
  await dictation.start();
  return true;
}

async function toggleDictation() {
  if (dictation?.active) { dictation.stop(); return; }
  if (state.preparingVoice) return;
  if (state.speaking) { stopSpeaking(); setSpeaking(false); }
  dictationEntry = state.currentId;
  if (!isMobile() && getPref('voiceEngine', 'whisper') === 'whisper' && await localAIAvailable()) {
    state.preparingVoice = true;
    el.btnVoice.disabled = true;
    try {
      await startWhisper();
      return;
    } catch (e) {
      console.warn('Whisper indisponível', e);
      showInterim('');
      toast('A transcrição deste computador não abriu. Usando o ditado do navegador.', 6000);
    } finally {
      state.preparingVoice = false;
      el.btnVoice.disabled = false;
    }
  }
  if (!browserDictation) {
    toast('Este navegador não tem ditado embutido. Use o 🎤 do teclado do celular para falar em vez de digitar.', 7000);
    return;
  }
  dictation = browserDictation;
  dictation.start();
  toast('Pode falar. Diga "vírgula", "ponto final" ou "nova linha" para pontuar.', 5000);
}

// ---------- Correção com IA ----------
function renderCorrectionPreview(parts) {
  const frag = document.createDocumentFragment();
  for (const { type, text } of parts) {
    const node = type === 'same' ? document.createElement('span') : document.createElement(type === 'add' ? 'ins' : 'del');
    node.textContent = text;
    frag.append(node);
  }
  el.correctPreview.replaceChildren(frag);
}

async function correctText() {
  if (state.correcting || !currentEntry()) return;
  const ta = el.content;
  const hasSelection = ta.selectionEnd > ta.selectionStart;
  const start = hasSelection ? ta.selectionStart : 0;
  const end = hasSelection ? ta.selectionEnd : ta.value.length;
  const original = ta.value.slice(start, end);
  if (!original.trim()) { toast('Não há texto para corrigir.'); return; }
  dictation?.stop();
  if (state.speaking) { stopSpeaking(); setSpeaking(false); }

  state.correcting = true;
  el.btnCorrect.disabled = true;
  const id = state.currentId;
  try {
    if (!await ensureLocalAI()) return;
    ta.readOnly = true; // o texto não pode mudar enquanto a IA revisa
    await flushSave();
    const snapshot = ta.value;
    showInterim('⏳ Preparando a correção…');
    await localAI.loadCorrector();

    const chunks = splitForCorrection(original);
    const todo = chunks.filter((c) => c.text.trim()).length;
    const parts = [];
    const preview = [];
    let done = 0;
    let kept = 0;
    for (const chunk of chunks) {
      let fixed = chunk.text;
      if (chunk.text.trim()) {
        done += 1;
        showInterim(`✨ Revisando o texto… ${done} de ${todo}`);
        const answer = await localAI.correct(chunk.text);
        if (isSafeCorrection(chunk.text, answer)) fixed = answer;
        else kept += 1;
      }
      parts.push(fixed + chunk.sep);
      preview.push(...diffWords(chunk.text, fixed), { type: 'same', text: chunk.sep });
    }
    showInterim('');

    const corrected = parts.join('');
    if (corrected === original) {
      toast(kept ? 'A IA não conseguiu revisar este texto com segurança. Nada foi alterado.' : 'Nenhum erro encontrado ✓', 5000);
      return;
    }
    renderCorrectionPreview(preview);
    el.correctNote.textContent = kept
      ? 'Em riscado, o que sai; em destaque, o que entra. Alguns trechos ficaram como estavam, porque a IA não os revisou com segurança.'
      : 'Em riscado, o que sai; em destaque, o que entra.';
    if (!await askDialog(el.correct)) return;
    if (state.currentId !== id || ta.value !== snapshot) {
      toast('O texto mudou enquanto a IA revisava. Nada foi alterado.', 6000);
      return;
    }
    ta.setRangeText(corrected, start, end, 'preserve');
    onEdit();
    toast('Correções aplicadas ✓');
  } catch (e) {
    console.warn('Falha na correção', e);
    showInterim('');
    toast('A IA não conseguiu corrigir agora. Seu texto continua como estava.', 6000);
  } finally {
    ta.readOnly = false;
    state.correcting = false;
    el.btnCorrect.disabled = false;
  }
}

async function renderLocalAI() {
  const available = !isMobile() && await localAIAvailable();
  el.aiSection.hidden = !available;
  el.btnCorrect.hidden = !available;
  if (!available) return;
  const dir = await savedFolder();
  el.aiText.textContent = dir
    ? `Os modelos estão na pasta "${dir.name}". Sua voz e seu texto são processados aqui e não saem do computador.`
    : 'Ao usar o ditado ou o botão Corrigir pela primeira vez, o app pede uma pasta para guardar a IA (cerca de 4,8 GB).';
  el.btnAiFolder.textContent = dir ? 'Trocar pasta' : 'Escolher pasta';
  el.voiceEngine.value = getPref('voiceEngine', 'whisper');
  const mics = await listMics().catch(() => []);
  const options = (mics.length ? mics : [{ id: 'default', label: 'Padrão do Windows' }]).map(({ id, label }) => {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = label;
    return option;
  });
  el.micSelect.replaceChildren(...options);
  el.micSelect.value = getPref('mic', 'default');
  if (!el.micSelect.value) el.micSelect.value = options[0].value;
}

async function onChooseAiFolder() {
  try {
    const dir = await chooseFolder();
    if (await folderReady(dir)) {
      await localAI.setFolder(dir);
      state.aiFolderSet = true;
      toast('Pasta da IA definida ✓');
    }
  } catch { /* desistiu de escolher */ }
  renderLocalAI();
}

function setSpeaking(on) {
  state.speaking = on;
  el.btnSpeak.setAttribute('aria-pressed', String(on));
  el.btnSpeak.textContent = on ? '⏹ Parar leitura' : '🔊 Ouvir';
}

function toggleSpeak() {
  if (!speechSupported) { toast('Este navegador não consegue ler em voz alta.'); return; }
  if (state.speaking) { stopSpeaking(); setSpeaking(false); return; }
  dictation?.stop();
  const text = [el.title.value.trim(), el.content.value.trim()].filter(Boolean).join('.\n');
  if (!text) { toast('Não há texto para ler.'); return; }
  if (speak(text, () => setSpeaking(false))) setSpeaking(true);
}

// ---------- Lembrete de pausa ----------
let lastActivity = 0;
let activeMs = 0;
function noteActivity() { lastActivity = Date.now(); }
setInterval(() => {
  const mins = Number(getPref('pause', '20'));
  if (!mins || document.visibilityState !== 'visible') return;
  if (Date.now() - lastActivity < 60 * 1000) {
    activeMs += 30 * 1000;
    if (activeMs >= mins * 60 * 1000) {
      activeMs = 0;
      showBanner('🌿 Hora de uma pausa: solte os ombros, levante o olhar para a frente e mova o pescoço devagar. Se quiser, continue ditando por voz.');
    }
  }
}, 30 * 1000);

// ---------- Preferências ----------
function applyFocus(on) {
  el.app.classList.toggle('focus', on);
  setPref('focus', on ? '1' : '0');
  const label = on ? 'Mostrar a lista de anotações' : 'Esconder a lista de anotações';
  el.sidebarBtn.setAttribute('aria-pressed', String(on));
  el.sidebarBtn.setAttribute('aria-label', label);
  el.sidebarBtn.title = `${label} (Ctrl+B)`;
}
function toggleFocus() {
  if (isMobile()) return; // no celular a lista e o editor já são telas separadas
  applyFocus(!el.app.classList.contains('focus'));
}

function applyFont(px) {
  const v = Math.min(FONT_MAX, Math.max(FONT_MIN, px));
  document.documentElement.style.setProperty('--editor-font', v + 'px');
  el.fontValue.textContent = String(v);
  setPref('font', v);
  return v;
}
function currentFont() {
  const v = parseInt(getPref('font', '19'), 10);
  return Number.isFinite(v) ? v : 19;
}
function applyTheme(t) {
  if (t !== 'dark' && t !== 'auto') t = 'light';
  document.documentElement.setAttribute('data-theme', t);
  setPref('theme3', t);
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#161d19' : '#f4f1ea');
}

// Saudação da tela inicial conforme a hora do dia.
function renderGreeting() {
  const h = new Date().getHours();
  let greet = 'Boa noite';
  let icon = '🌙';
  if (h >= 5 && h < 12) { greet = 'Bom dia'; icon = '🌤️'; }
  else if (h >= 12 && h < 18) { greet = 'Boa tarde'; icon = '☀️'; }
  el.greet.textContent = greet;
  el.greetIcon.textContent = icon;
}

// ---------- Exportar ----------
function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function exportData(kind) {
  await flushSave();
  const items = sortedEntries();
  if (!items.length) { toast('Não há anotações para exportar.'); return; }
  const stamp = new Date().toISOString().slice(0, 10);
  if (kind === 'json') {
    const data = items.map(({ id, title, content, mood, created_at, pages }) => ({ id, title, content, mood, created_at, pages: pages || [] }));
    download(`meu-diario-${stamp}.json`, JSON.stringify({ app: 'meu-diario', version: 1, exported_at: new Date().toISOString(), entries: data }, null, 2), 'application/json');
  } else {
    const txt = items.slice().reverse().map((e) => {
      const head = `=== ${formatWhen(e.created_at)} ===`;
      const mood = e.mood ? `Humor: ${MOODS[e.mood]} ${MOOD_NAMES[e.mood]}\n` : '';
      const title = e.title.trim() ? `${e.title.trim()}\n` : '';
      const photos = e.pages?.length ? `[${pagesLabel(e.pages.length)}: veja no PDF]\n` : '';
      return `${head}\n${title}${mood}${photos}\n${e.content.trim()}\n`;
    }).join('\n');
    download(`meu-diario-${stamp}.txt`, '﻿' + txt, 'text/plain;charset=utf-8');
  }
  setPref('lastBackup', Date.now());
  renderBackupInfo();
  toast('Cópia baixada ✓ Guarde o arquivo num lugar seguro (ex.: Google Drive).', 5000);
}

async function exportPdf(scope) {
  if (state.exportingPdf) return;
  await flushSave();
  const current = currentEntry();
  const items = scope === 'current' ? (current && current !== state.draft ? [current] : []) : sortedEntries().slice().reverse();
  if (!items.length) { toast(scope === 'current' ? 'Escreva algo antes de gerar o PDF.' : 'Não há anotações para exportar.'); return; }
  state.exportingPdf = true;
  el.btnEntryPdf.disabled = true;
  el.btnExportPdf.disabled = true;
  const stamp = new Date().toISOString().slice(0, 10);
  try {
    toast('Gerando o PDF…', 60000);
    const { doc, missing } = await createPdf(items.map((e) => ({
      title: e.title,
      content: e.content,
      whenText: formatWhen(e.created_at),
      moodText: MOOD_NAMES[e.mood] || '',
      pages: e.pages || [],
    })), {
      getPage: async (name) => {
        const blob = await getPageBlob(name);
        return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
      },
      onProgress: (done, total) => { if (total > 1) toast(`Gerando o PDF… ${done} de ${total}`, 60000); },
    });
    doc.save(scope === 'current' ? `anotacao-${stamp}.pdf` : `meu-diario-${stamp}.pdf`);
    if (scope === 'all') { setPref('lastBackup', Date.now()); renderBackupInfo(); }
    toast(missing ? `PDF baixado, mas ${missing} foto(s) não entraram por falta de conexão.` : 'PDF baixado ✓', 6000);
  } catch (e) {
    console.warn('Falha ao gerar o PDF', e);
    toast(e?.message === 'sem-biblioteca'
      ? 'É preciso internet na primeira vez que o PDF é gerado.'
      : 'Não foi possível gerar o PDF.', 6000);
  } finally {
    state.exportingPdf = false;
    el.btnEntryPdf.disabled = false;
    el.btnExportPdf.disabled = false;
  }
}

// ---------- Fotos de páginas do diário físico ----------
async function getPageBlob(name) {
  const local = await db.getImage(name);
  if (local?.blob) return local.blob;
  if (!navigator.onLine || !state.sync) return null;
  return state.sync.downloadImage(name);
}

function renderPages() {
  const token = ++state.pagesToken;
  state.pageUrls.forEach((u) => URL.revokeObjectURL(u));
  state.pageUrls = [];
  el.pagesStrip.hidden = !state.pages.length;
  el.pagesStrip.replaceChildren(...state.pages.map((name, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'page-thumb';
    button.dataset.index = String(index);
    button.setAttribute('aria-label', `Abrir a foto ${index + 1} de ${state.pages.length}`);
    getPageBlob(name).then((blob) => {
      if (token !== state.pagesToken) return;
      if (!blob) { button.textContent = 'Foto ainda não chegou'; return; }
      const url = URL.createObjectURL(blob);
      state.pageUrls.push(url);
      const img = document.createElement('img');
      img.alt = `Página ${index + 1}`;
      img.decoding = 'async';
      img.src = url;
      button.append(img);
    }).catch((e) => console.warn(e));
    return button;
  }));
}

function choosePhoto(forNew) {
  if (busyCorrecting()) return;
  state.photoForNew = forNew;
  if (isMobile()) el.photoSource.showModal();
  else el.pageInput.click();
}

async function addPages(input) {
  const files = [...input.files];
  input.value = '';
  if (!files.length) return;
  if (state.photoForNew) {
    state.photoForNew = false;
    await newEntry();
  }
  const id = state.currentId;
  if (!id) return;
  const room = MAX_PAGES - state.pages.length;
  if (room <= 0) { toast(`Cada anotação guarda até ${MAX_PAGES} fotos. Crie outra para continuar.`, 6000); return; }
  state.addingPages = true;
  el.btnPhoto.disabled = true;
  const chosen = files.slice(0, room);
  let failed = 0;
  try {
    for (let i = 0; i < chosen.length && state.currentId === id; i++) {
      el.saveState.textContent = `Preparando foto ${i + 1} de ${chosen.length}…`;
      try {
        const blob = await preparePage(chosen[i]);
        if (state.currentId !== id) break;
        const name = `${uuid()}.jpg`;
        await db.putImage({ name, blob, uploaded: 0 });
        state.pages = [...state.pages, name];
        renderPages();
      } catch (e) {
        console.warn('Foto não adicionada', e);
        failed += 1;
      }
    }
    if (state.currentId === id) {
      noteActivity();
      await saveNow();
    }
    if (failed) toast(`${failed} imagem(ns) não puderam ser abertas. Use fotos em JPG ou PNG.`, 6000);
    else if (files.length > room) toast(`Só couberam ${room} fotos nesta anotação.`, 6000);
    else toast(chosen.length > 1 ? `${chosen.length} fotos adicionadas ✓` : 'Foto adicionada ✓');
  } finally {
    state.addingPages = false;
    el.btnPhoto.disabled = false;
  }
}

async function showViewerPage(index) {
  if (!state.pages.length) { closeViewer(); return; }
  state.viewerIndex = Math.max(0, Math.min(state.pages.length - 1, index));
  el.viewerCount.textContent = `${state.viewerIndex + 1} de ${state.pages.length}`;
  el.viewerPrev.disabled = state.viewerIndex === 0;
  el.viewerNext.disabled = state.viewerIndex === state.pages.length - 1;
  const wanted = state.pages[state.viewerIndex];
  const blob = await getPageBlob(wanted);
  if (wanted !== state.pages[state.viewerIndex] || !el.pageViewer.open) return;
  if (state.viewerUrl) URL.revokeObjectURL(state.viewerUrl);
  state.viewerUrl = blob ? URL.createObjectURL(blob) : null;
  if (state.viewerUrl) el.viewerImg.src = state.viewerUrl;
  else el.viewerImg.removeAttribute('src');
}

function openViewer(index) {
  el.pageViewer.showModal();
  showViewerPage(index);
}

function closeViewer() {
  if (el.pageViewer.open) el.pageViewer.close();
}

async function removeViewerPage() {
  const name = state.pages[state.viewerIndex];
  if (!name) return;
  const ok = await confirmDialog('Retirar esta foto?', 'Ela será apagada deste e de todos os seus aparelhos. Isso não pode ser desfeito.', 'Retirar');
  if (!ok) return;
  state.pages = state.pages.filter((n) => n !== name);
  renderPages();
  await saveNow();
  await db.trashImages([name]);
  state.sync?.schedule(300);
  if (state.pages.length) showViewerPage(state.viewerIndex);
  else closeViewer();
}

// ---------- Conta / Supabase ----------
function appUrl() { return location.origin + location.pathname; }

function translateAuthError(error) {
  const m = String(error?.message || error || '');
  if (/invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/email not confirmed/i.test(m)) return 'Confirme seu e-mail antes de entrar (veja sua caixa de entrada e o spam).';
  if (/already registered|already exists/i.test(m)) return 'Já existe uma conta com esse e-mail. Use "Entrar".';
  if (/password should be at least|weak password|password.*characters/i.test(m)) return 'A senha é fraca. Use pelo menos 8 caracteres, misturando letras e números.';
  if (/rate limit|too many|security purposes/i.test(m)) return 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';
  if (/invalid email|unable to validate email/i.test(m)) return 'E-mail inválido.';
  if (/failed to fetch|network|load failed/i.test(m)) return 'Sem conexão com a internet.';
  if (/same.*password|different from the old/i.test(m)) return 'A nova senha precisa ser diferente da anterior.';
  return 'Algo deu errado: ' + m;
}

function setAuthMsg(text, ok = false) {
  el.authMsg.textContent = text;
  el.authMsg.classList.toggle('ok', ok);
  el.authMsg.hidden = !text;
}

function setAuthMode(mode) {
  state.authMode = mode;
  const login = mode === 'login';
  el.tabLogin.classList.toggle('active', login);
  el.tabSignup.classList.toggle('active', !login);
  el.tabLogin.setAttribute('aria-selected', String(login));
  el.tabSignup.setAttribute('aria-selected', String(!login));
  el.authSubmit.textContent = login ? 'Entrar' : 'Criar conta';
  el.authPassword.autocomplete = login ? 'current-password' : 'new-password';
  el.authForgot.hidden = !login;
  setAuthMsg('');
}

function showAuth() {
  if (!CONFIGURED) return;
  el.auth.hidden = false;
  setAuthMsg('');
}
function hideAuth() { el.auth.hidden = true; }

async function onAuthSubmit(ev) {
  ev.preventDefault();
  if (!state.sb) { setAuthMsg('Sem conexão com o servidor. Verifique a internet e tente de novo.'); return; }
  const email = el.authEmail.value.trim();
  const password = el.authPassword.value;
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) { setAuthMsg('Digite um e-mail válido.'); return; }
  if (password.length < 8) { setAuthMsg('A senha precisa ter pelo menos 8 caracteres.'); return; }
  el.authSubmit.disabled = true;
  try {
    if (state.authMode === 'login') {
      const { error } = await state.sb.auth.signInWithPassword({ email, password });
      if (error) setAuthMsg(translateAuthError(error));
      else el.authPassword.value = '';
    } else {
      const { data, error } = await state.sb.auth.signUp({ email, password, options: { emailRedirectTo: appUrl() } });
      if (error) setAuthMsg(translateAuthError(error));
      else if (!data.session) {
        setAuthMode('login');
        setAuthMsg('Conta criada! Enviamos um link de confirmação para o seu e-mail. Abra o link e depois entre aqui.', true);
      } else el.authPassword.value = '';
    }
  } catch (e) {
    setAuthMsg(translateAuthError(e));
  } finally {
    el.authSubmit.disabled = false;
  }
}

async function onForgot() {
  if (!state.sb) { setAuthMsg('Sem conexão com o servidor.'); return; }
  const email = el.authEmail.value.trim();
  if (!email) { setAuthMsg('Digite seu e-mail acima e toque de novo em "Esqueci minha senha".'); el.authEmail.focus(); return; }
  el.authForgot.disabled = true;
  try {
    const { error } = await state.sb.auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
    if (error) setAuthMsg(translateAuthError(error));
    else setAuthMsg('Se existir uma conta com esse e-mail, você receberá um link para criar uma nova senha.', true);
  } catch (e) {
    setAuthMsg(translateAuthError(e));
  } finally {
    el.authForgot.disabled = false;
  }
}

async function onRecoverySubmit(ev) {
  ev.preventDefault();
  const password = el.recoveryPassword.value;
  const show = (t, ok = false) => { el.recoveryMsg.textContent = t; el.recoveryMsg.classList.toggle('ok', ok); el.recoveryMsg.hidden = !t; };
  if (password.length < 8) { show('A senha precisa ter pelo menos 8 caracteres.'); return; }
  const { error } = await state.sb.auth.updateUser({ password });
  if (error) { show(translateAuthError(error)); return; }
  el.recoveryPassword.value = '';
  el.recovery.close();
  toast('Senha alterada com sucesso.');
}

async function handleSession(session) {
  const user = session?.user || null;
  const uid = user?.id || null;
  if (state.sessionKnown && uid === (state.user?.id || null)) return;
  state.sessionKnown = true;
  state.user = user;

  if (user) {
    const prevUid = await db.getMeta('uid');
    if (prevUid && prevUid !== user.id) {
      // Outra pessoa usou este aparelho antes: não misturar os diários.
      await db.clearAll();
      closeEditor();
      await loadEntries();
    }
    await db.setMeta('uid', user.id);
    state.localOnly = false;
    setPref('localOnly', '0');
    hideAuth();
    if (!state.sync) {
      state.sync = createSync({
        sb: state.sb,
        onStatus: setStatus,
        onRemoteChange,
        getUserId: () => state.user?.id,
        onConflict: (n) => toast(n > 1
          ? `${n} anotações foram editadas em dois aparelhos ao mesmo tempo. Guardamos as duas versões de cada uma ("versão de outro aparelho").`
          : 'Uma anotação foi editada em dois aparelhos ao mesmo tempo. Guardamos as duas versões ("versão de outro aparelho").', 8000),
      });
    }
    state.sync.start();
  } else {
    state.sync?.stop();
    state.sync = null;
    if (state.localOnly) { hideAuth(); setStatus('local'); } else { setStatus('loggedOut'); showAuth(); }
  }
  renderAccount();
  renderList();
}

async function bootSupabase() {
  if (state.sb || !CONFIGURED) return;
  setStatus('connecting');
  try {
    const { createClient } = await import(SUPABASE_JS);
    state.sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'diario-auth' },
    });
  } catch (e) {
    console.warn('Não foi possível carregar o Supabase', e);
    setStatus('offline');
    return; // tenta de novo quando a internet voltar (evento "online")
  }
  state.sb.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      el.recoveryMsg.hidden = true;
      if (!el.recovery.open) el.recovery.showModal();
    }
    // setTimeout: a documentação do Supabase recomenda não chamar o cliente dentro deste callback
    setTimeout(() => { handleSession(session).catch((e) => console.error(e)); }, 0);
  });
}

async function logout() {
  stopVoice();
  await flushSave();
  // Para a sincronização automática ANTES de apagar os dados locais, para que
  // nenhuma sincronização em andamento traga anotações de volta depois da limpeza.
  const sync = state.sync;
  sync?.stop();
  if (sync && navigator.onLine) await sync.runNow();
  const left = await db.countDirty();
  if (left) {
    const ok = await confirmDialog(
      'Há anotações não enviadas',
      `${left} anotação(ões) ainda não foram enviadas para a nuvem. Se sair agora, elas serão perdidas neste aparelho. Conecte-se à internet e espere aparecer "✓ Sincronizado" para sair com segurança.`,
      'Sair mesmo assim',
    );
    if (!ok) { sync?.start(); return; }
  }
  state.sync = null;
  closeEditor();
  await db.clearAll();
  state.entries.clear();
  renderList();
  el.settings.close();
  try {
    await state.sb.auth.signOut({ scope: 'local' });
  } catch (e) {
    console.warn(e);
  }
  tabs?.postMessage({ type: 'logout' });
  // Garante a tela de login mesmo se o evento não disparar
  await handleSession(null);
}

// ---------- Bloqueio com PIN ----------
const lock = createLock({
  screen: el.lockScreen,
  title: $('#lock-title'),
  sub: $('#lock-sub'),
  dots: $('#lock-dots'),
  msg: $('#lock-msg'),
  keypad: $('#lock-keypad'),
  cancel: $('#lock-cancel'),
  forgot: $('#lock-forgot'),
}, {
  beforeLock() {
    flushSave();
    stopVoice();
    // Diálogos ficam acima de tudo na tela: sem isto, o texto e as fotos apareceriam por cima do bloqueio.
    document.querySelectorAll('dialog[open]:not(#recovery-dialog)').forEach((d) => d.close());
    el.toast.hidden = true;
  },
  onForgot: forgotPin,
  onUnlock: () => setTimeout(checkBackupReminder, 800),
});

async function forgotPin() {
  // Tem conta salva neste aparelho, mas ainda não conectou (sem internet): não apagar nada.
  let savedSession = false;
  try { savedSession = !!localStorage.getItem('diario-auth'); } catch { /* ignore */ }
  if (CONFIGURED && !state.user && savedSession) {
    toast('Conecte-se à internet para recuperar o acesso. Suas anotações estão seguras.', 6000);
    if (!state.sb) bootSupabase();
    return;
  }
  if (CONFIGURED && state.user) {
    if (!navigator.onLine) {
      toast('Conecte-se à internet para recuperar o acesso. Suas anotações estão seguras.', 6000);
      return;
    }
    const ok = await confirmDialog(
      'Esqueceu o PIN?',
      'Para criar um PIN novo, você vai sair da conta neste aparelho. Depois é só entrar de novo com seu e-mail e senha: suas anotações estão guardadas na nuvem e voltam sozinhas.',
      'Sair e entrar de novo',
    );
    if (!ok) return;
    await logout();
    if (state.user) return; // desistiu de sair (havia anotações não enviadas)
  } else {
    const ok = await confirmDialog(
      'Esqueceu o PIN?',
      'Sem uma conta na nuvem, o PIN só pode ser removido apagando as anotações guardadas neste aparelho. Isso não pode ser desfeito.',
      'Apagar e remover o PIN',
    );
    if (!ok) return;
    closeEditor();
    await db.clearAll();
    state.entries.clear();
    renderList();
  }
  clearPin();
  lock.close();
  renderPin();
  toast('PIN removido. Você pode criar um novo em ⚙ Configurações.', 5000);
}

function renderPin() {
  const on = hasPin();
  el.pinText.textContent = on
    ? 'O app pede o PIN ao abrir. O PIN vale só neste aparelho; em cada aparelho você cria o seu.'
    : 'Peça um PIN de 4 a 6 números para abrir o diário neste aparelho. Ninguém que pegar o aparelho consegue ler suas anotações.';
  el.btnPinSet.textContent = on ? 'Trocar PIN' : 'Criar PIN';
  el.btnPinRemove.hidden = !on;
  el.pinDelayRow.hidden = !on;
  el.pinDelay.value = String(getLockDelay());
  if (!el.pinDelay.value) el.pinDelay.value = '0';
}

async function onPinSet() {
  const had = hasPin();
  el.settings.close();
  const ok = await lock.setup();
  if (ok) toast(had ? 'PIN trocado ✓' : 'PIN criado ✓ O app vai pedir o PIN ao abrir.', 4500);
  renderPin();
  if (!lock.isLocked()) { renderAccount(); el.settings.showModal(); }
}

async function onPinRemove() {
  el.settings.close();
  const ok = await lock.verify();
  if (ok) { clearPin(); toast('PIN removido.'); }
  renderPin();
  if (!lock.isLocked()) { renderAccount(); el.settings.showModal(); }
}

// Bloqueia ao sair do app (na hora ou depois do tempo escolhido).
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (!hasPin()) return;
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now();
    if (getLockDelay() === 0) lock.lock();
  } else if (hiddenAt && Date.now() - hiddenAt >= getLockDelay() * 1000) {
    lock.lock();
  }
});

function renderAccount() {
  el.appVersion.textContent = `Meu Diário · versão ${APP_VERSION}`;
  renderLocalAI().catch((e) => console.warn(e));
  renderPin();
  renderBackupInfo();
  el.btnSyncNow.hidden = !(CONFIGURED && state.user);
  el.btnLogout.hidden = !(CONFIGURED && state.user);
  el.btnLoginOpen.hidden = !(CONFIGURED && !state.user);
  if (!CONFIGURED) {
    el.accountText.textContent = 'A sincronização na nuvem ainda não foi configurada. Suas anotações estão salvas somente neste aparelho.';
  } else if (state.user) {
    el.accountText.textContent = `Conectado como ${state.user.email}. Suas anotações são sincronizadas com todos os aparelhos em que você entrar.`;
  } else {
    el.accountText.textContent = 'Você não está conectado. As anotações ficam só neste aparelho até você entrar.';
  }
}

// ---------- Eventos ----------
function bindEvents() {
  el.btnNew.addEventListener('click', () => { newEntry(); });
  el.newTop.addEventListener('click', () => { newEntry(); });
  el.sidebarBtn.addEventListener('click', toggleFocus);
  el.list.addEventListener('click', (ev) => {
    if (ev.target.closest('.list-more')) {
      state.listLimit += LIST_PAGE;
      renderList();
      return;
    }
    const btn = ev.target.closest('.entry-item');
    if (btn) openEntry(btn.dataset.id);
  });
  let searchTimer = null;
  el.search.addEventListener('input', () => {
    state.listLimit = LIST_PAGE;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderList, 80); // espera a pessoa terminar a letra seguinte
  });
  el.back.addEventListener('click', () => { flushSave(); stopVoice(); showListView(); });
  window.addEventListener('popstate', () => {
    if (el.app.classList.contains('show-editor')) { flushSave(); stopVoice(); showListView(true); }
  });

  el.title.addEventListener('input', onEdit);
  el.content.addEventListener('input', onEdit);
  for (const b of el.moodBtns) {
    b.addEventListener('click', () => {
      const m = Number(b.dataset.mood);
      setMoodUI(state.mood === m ? null : m);
      onEdit();
    });
  }
  el.btnVoice.addEventListener('click', toggleDictation);
  el.btnSpeak.addEventListener('click', toggleSpeak);
  el.btnCorrect.addEventListener('click', correctText);
  el.btnDelete.addEventListener('click', deleteCurrent);
  el.btnPhoto.addEventListener('click', () => choosePhoto(false));
  el.btnPhotoNew.addEventListener('click', () => choosePhoto(true));
  el.photoTake.addEventListener('click', () => { el.photoSource.close(); el.pageCamera.click(); });
  el.photoPick.addEventListener('click', () => { el.photoSource.close(); el.pageInput.click(); });
  el.pageInput.addEventListener('change', () => { addPages(el.pageInput).catch((e) => console.warn(e)); });
  el.pageCamera.addEventListener('change', () => { addPages(el.pageCamera).catch((e) => console.warn(e)); });
  el.pagesStrip.addEventListener('click', (ev) => {
    const thumb = ev.target.closest('.page-thumb');
    if (thumb) openViewer(Number(thumb.dataset.index));
  });
  el.viewerPrev.addEventListener('click', () => showViewerPage(state.viewerIndex - 1));
  el.viewerNext.addEventListener('click', () => showViewerPage(state.viewerIndex + 1));
  el.viewerRemove.addEventListener('click', () => { removeViewerPage().catch((e) => console.warn(e)); });
  el.viewerClose.addEventListener('click', closeViewer);
  el.pageViewer.addEventListener('close', () => {
    if (state.viewerUrl) URL.revokeObjectURL(state.viewerUrl);
    state.viewerUrl = null;
    el.viewerImg.removeAttribute('src');
  });
  el.pageViewer.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowLeft') showViewerPage(state.viewerIndex - 1);
    if (ev.key === 'ArrowRight') showViewerPage(state.viewerIndex + 1);
  });
  el.btnEntryPdf.addEventListener('click', () => exportPdf('current'));
  el.btnExportPdf.addEventListener('click', () => exportPdf('all'));
  el.btnAiFolder.addEventListener('click', onChooseAiFolder);
  el.voiceEngine.addEventListener('change', () => setPref('voiceEngine', el.voiceEngine.value));
  el.micSelect.addEventListener('change', () => setPref('mic', el.micSelect.value));

  document.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); saveNow(); }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'b') { ev.preventDefault(); toggleFocus(); }
  });

  // Salva ao sair/minimizar o app
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
  window.addEventListener('pagehide', () => { flushSave(); });

  el.bannerClose.addEventListener('click', hideBanner);
  el.bannerAction.addEventListener('click', () => { const fn = bannerOnAction; hideBanner(); fn?.(); });

  // Login
  el.tabLogin.addEventListener('click', () => setAuthMode('login'));
  el.tabSignup.addEventListener('click', () => setAuthMode('signup'));
  el.authForm.addEventListener('submit', onAuthSubmit);
  el.authForgot.addEventListener('click', onForgot);
  el.authLocal.addEventListener('click', () => {
    state.localOnly = true;
    setPref('localOnly', '1');
    hideAuth();
    setStatus('local');
    renderAccount();
  });
  el.recoveryForm.addEventListener('submit', onRecoverySubmit);

  // Configurações
  el.settingsBtn.addEventListener('click', () => { renderAccount(); el.settings.showModal(); });
  el.btnSyncNow.addEventListener('click', async () => {
    if (!state.sync) return;
    el.btnSyncNow.disabled = true;
    await flushSave();
    await state.sync.runNow();
    el.btnSyncNow.disabled = false;
    if (state.syncStatus === 'synced') toast('Tudo sincronizado ✓');
  });
  el.btnLoginOpen.addEventListener('click', () => {
    el.settings.close();
    state.localOnly = false;
    setPref('localOnly', '0');
    if (!state.sb) { toast('Sem conexão com o servidor. Tente quando estiver com internet.'); bootSupabase(); return; }
    setAuthMode('login');
    showAuth();
  });
  el.btnLogout.addEventListener('click', logout);
  el.btnPinSet.addEventListener('click', onPinSet);
  el.btnPinRemove.addEventListener('click', onPinRemove);
  el.pinDelay.addEventListener('change', () => setLockDelay(Number(el.pinDelay.value) || 0));
  el.fontDec.addEventListener('click', () => applyFont(currentFont() - 2));
  el.fontInc.addEventListener('click', () => applyFont(currentFont() + 2));
  el.themeSelect.addEventListener('change', () => applyTheme(el.themeSelect.value));
  el.pauseSelect.addEventListener('change', () => { setPref('pause', el.pauseSelect.value); activeMs = 0; });
  el.btnExportTxt.addEventListener('click', () => exportData('txt'));
  el.btnExportJson.addEventListener('click', () => exportData('json'));

  window.addEventListener('online', () => { if (CONFIGURED && !state.sb) bootSupabase(); });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      // Procura versão nova sempre que o app volta para a tela.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    })
    .catch((e) => console.warn('Service worker não registrado', e));
  // Versão nova instalada: recarrega sozinho quando for seguro (nada sendo digitado ou ditado).
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    const tryReload = () => {
      const busy = state.saveTimer || state.pendingWrites.size || dictation?.active || state.correcting ||
        (document.activeElement === el.content || document.activeElement === el.title);
      if (busy && document.visibilityState === 'visible') { setTimeout(tryReload, 4000); return; }
      reloading = true;
      location.reload();
    };
    tryReload();
  });
}

async function boot() {
  el.fontValue.textContent = String(applyFont(currentFont()));
  const theme = getPref('theme3', 'light');
  el.themeSelect.value = theme;
  if (!el.themeSelect.value) el.themeSelect.value = 'light';
  applyTheme(el.themeSelect.value);
  renderGreeting();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme(el.themeSelect.value));
  el.pauseSelect.value = getPref('pause', '20');
  if (!el.pauseSelect.value) el.pauseSelect.value = '20';
  applyFocus(getPref('focus', '0') === '1');

  bindEvents();
  if (hasPin()) lock.lock();
  else document.documentElement.classList.remove('locked');
  registerServiceWorker();
  navigator.storage?.persist?.().catch(() => {});

  state.localOnly = getPref('localOnly', '0') === '1';
  try {
    await loadEntries();
  } catch (e) {
    console.error(e);
    showBanner('⚠ Não foi possível abrir o armazenamento do aparelho. Se estiver em uma janela anônima, abra o app em uma janela normal.');
  }
  renderAccount();
  // espera a primeira sincronização trazer as anotações antes de decidir
  setTimeout(checkBackupReminder, 6000);

  if (!CONFIGURED) { setStatus('local'); return; }
  await bootSupabase();
}

boot();
