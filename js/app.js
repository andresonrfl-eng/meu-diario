// Meu Diário — lógica da interface.
import * as db from './db.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { createSync } from './sync.js';
import {
  createDictation, dictationSupported, speechSupported, speak, stopSpeaking, formatDictation,
} from './voice.js';

const APP_VERSION = '1.0.0';
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';
const CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const SAVE_DELAY_MS = 700;
const FONT_MIN = 15;
const FONT_MAX = 32;
const MOODS = { 1: '😢', 2: '😕', 3: '😐', 4: '🙂', 5: '😄' };
const MOOD_NAMES = { 1: 'Muito mal', 2: 'Mal', 3: 'Neutro', 4: 'Bem', 5: 'Muito bem' };

const $ = (sel) => document.querySelector(sel);
const el = {
  app: $('#app'),
  back: $('#btn-back'),
  syncStatus: $('#sync-status'),
  settingsBtn: $('#btn-settings'),
  banner: $('#banner'),
  bannerText: $('#banner-text'),
  bannerClose: $('#banner-close'),
  btnNew: $('#btn-new'),
  search: $('#search'),
  list: $('#entry-list'),
  emptyList: $('#empty-list'),
  editorEmpty: $('#editor-empty'),
  editor: $('#editor'),
  date: $('#entry-date'),
  saveState: $('#save-state'),
  title: $('#entry-title'),
  content: $('#entry-content'),
  moodBtns: [...document.querySelectorAll('.mood button[data-mood]')],
  interim: $('#voice-interim'),
  btnVoice: $('#btn-voice'),
  btnSpeak: $('#btn-speak'),
  btnDelete: $('#btn-delete'),
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
  // outros diálogos
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

function showBanner(msg) {
  el.bannerText.textContent = msg;
  el.banner.hidden = false;
}

function confirmDialog(title, text, okLabel = 'OK') {
  return new Promise((resolve) => {
    el.confirmTitle.textContent = title;
    el.confirmText.textContent = text;
    el.confirmOk.textContent = okLabel;
    el.confirm.returnValue = '';
    const onClose = () => {
      el.confirm.removeEventListener('close', onClose);
      resolve(el.confirm.returnValue === 'ok');
    };
    el.confirm.addEventListener('close', onClose);
    el.confirm.showModal();
  });
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

function renderList() {
  const q = normalize(el.search.value.trim());
  const items = sortedEntries().filter((e) => !q || normalize(`${e.title} ${e.content}`).includes(q));
  const frag = document.createDocumentFragment();
  for (const e of items) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'entry-item';
    btn.dataset.id = e.id;
    if (e.id === state.currentId) btn.setAttribute('aria-current', 'true');

    const title = document.createElement('div');
    title.className = 'entry-item-title';
    const t = document.createElement('span');
    t.textContent = e.title.trim() || previewOf(e).slice(0, 50) || 'Sem título';
    title.append(t);
    if (e.mood && MOODS[e.mood]) {
      const m = document.createElement('span');
      m.textContent = MOODS[e.mood];
      m.title = MOOD_NAMES[e.mood];
      title.append(m);
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
  el.saveState.textContent = entry === state.draft ? 'Nova anotação' : (entry.dirty ? 'Salvo no aparelho' : '');
  const len = el.content.value.length;
  try { el.content.setSelectionRange(len, len); } catch { /* ignore */ }
  el.content.scrollTop = 0;
}

function stopVoice() {
  dictation?.stop();
  if (state.speaking) { stopSpeaking(); setSpeaking(false); }
}

async function openEntry(id) {
  if (id === state.currentId) { showEditorView(); return; }
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
  stopVoice();
  await flushSave();
  state.draft = {
    id: uuid(),
    title: '',
    content: '',
    mood: null,
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
  el.editor.hidden = true;
  el.editorEmpty.hidden = false;
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
  const isDraft = cur === state.draft;
  if (isDraft && !title.trim() && !content.trim() && mood == null) {
    el.saveState.textContent = 'Nova anotação';
    return state.saveChain;
  }
  if (!isDraft && cur.title === title && cur.content === content && (cur.mood ?? null) === mood) {
    el.saveState.textContent = cur.dirty ? 'Salvo no aparelho' : 'Salvo';
    return state.saveChain;
  }
  const updated = {
    ...cur,
    title,
    content,
    mood,
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
    .then(() => db.put(record))
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
  const tomb = { ...cur, title: '', content: '', mood: null, deleted: true, dirty: 1, rev: newRev() };
  state.entries.delete(cur.id);
  closeEditor();
  if (await queueWrite(tomb)) toast('Anotação excluída');
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
  ta.setRangeText(text, start, end, 'end');
  // mantém o final do texto visível
  if (ta.selectionEnd === ta.value.length) ta.scrollTop = ta.scrollHeight;
  onEdit();
}

const dictation = dictationSupported ? createDictation({
  onFinal: insertAtCursor,
  onInterim: (t) => { el.interim.textContent = t; el.interim.hidden = !t; },
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
    };
    toast(msgs[code] || 'O ditado parou. Toque em 🎤 Ditar para continuar.', 6000);
  },
}) : null;

function toggleDictation() {
  if (!dictation) {
    toast('Este navegador não tem ditado embutido. Use o 🎤 do teclado do celular para falar em vez de digitar.', 7000);
    return;
  }
  if (dictation.active) { dictation.stop(); return; }
  if (state.speaking) { stopSpeaking(); setSpeaking(false); }
  dictation.start();
  toast('Pode falar. Diga "vírgula", "ponto final" ou "nova linha" para pontuar.', 5000);
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
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
  setPref('theme', t);
  const dark = t === 'dark' || (t !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#20222a' : '#5865a8');
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
    const data = items.map(({ id, title, content, mood, created_at }) => ({ id, title, content, mood, created_at }));
    download(`meu-diario-${stamp}.json`, JSON.stringify({ app: 'meu-diario', version: 1, exported_at: new Date().toISOString(), entries: data }, null, 2), 'application/json');
  } else {
    const txt = items.slice().reverse().map((e) => {
      const head = `=== ${formatWhen(e.created_at)} ===`;
      const mood = e.mood ? `Humor: ${MOODS[e.mood]} ${MOOD_NAMES[e.mood]}\n` : '';
      const title = e.title.trim() ? `${e.title.trim()}\n` : '';
      return `${head}\n${title}${mood}\n${e.content.trim()}\n`;
    }).join('\n');
    download(`meu-diario-${stamp}.txt`, '﻿' + txt, 'text/plain;charset=utf-8');
  }
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
    if (!state.sync) state.sync = createSync({ sb: state.sb, onStatus: setStatus, onRemoteChange });
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

function renderAccount() {
  el.appVersion.textContent = `Meu Diário · versão ${APP_VERSION}`;
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
  el.list.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.entry-item');
    if (btn) openEntry(btn.dataset.id);
  });
  el.search.addEventListener('input', renderList);
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
  el.btnDelete.addEventListener('click', deleteCurrent);

  document.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); saveNow(); }
  });

  // Salva ao sair/minimizar o app
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
  window.addEventListener('pagehide', () => { flushSave(); });

  el.bannerClose.addEventListener('click', () => { el.banner.hidden = true; });

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
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker não registrado', e));
}

async function boot() {
  el.fontValue.textContent = String(applyFont(currentFont()));
  const theme = getPref('theme', 'auto');
  el.themeSelect.value = theme;
  applyTheme(theme);
  el.pauseSelect.value = getPref('pause', '20');
  if (!el.pauseSelect.value) el.pauseSelect.value = '20';

  bindEvents();
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

  if (!CONFIGURED) { setStatus('local'); return; }
  await bootSupabase();
}

boot();
