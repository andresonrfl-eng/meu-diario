// Bloqueio do app com PIN.
// O PIN fica só neste aparelho (não vai para a nuvem), guardado como hash PBKDF2-SHA256
// com sal aleatório — nunca o número em si. Protege contra quem pegar o aparelho destravado;
// não substitui a senha da conta (os dados da nuvem continuam protegidos pelo login + RLS).

const PIN_KEY = 'diario.pin';
const DELAY_KEY = 'diario.lockDelay';
const FAILS_KEY = 'diario.pinFails';
const ITERATIONS = 150000;
const MIN_LEN = 4;
const MAX_LEN = 6;

function readJSON(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function writeJSON(key, v) {
  try { if (v === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ }
}
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(pin, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return toB64(bits);
}

export function hasPin() {
  const r = readJSON(PIN_KEY);
  return !!(r && r.hash && r.salt && r.len);
}

async function savePin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pin, salt, ITERATIONS);
  writeJSON(PIN_KEY, { v: 1, salt: toB64(salt), hash, iter: ITERATIONS, len: pin.length });
  writeJSON(FAILS_KEY, null);
}

async function verifyPin(pin) {
  const r = readJSON(PIN_KEY);
  if (!r) return false;
  const h = await derive(pin, fromB64(r.salt), r.iter || ITERATIONS);
  // comparação em tempo constante
  if (h.length !== r.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ r.hash.charCodeAt(i);
  return diff === 0;
}

export function clearPin() {
  writeJSON(PIN_KEY, null);
  writeJSON(FAILS_KEY, null);
}

export function getLockDelay() {
  const v = Number(localStorage.getItem(DELAY_KEY));
  return Number.isFinite(v) && v >= 0 ? v : 0;
}
export function setLockDelay(sec) {
  try { localStorage.setItem(DELAY_KEY, String(sec)); } catch { /* ignore */ }
}

// Espera crescente após erros: 5 erros => 30 s, depois dobra (máx. 5 min).
function failState() { return readJSON(FAILS_KEY) || { n: 0, until: 0 }; }
function registerFail() {
  const f = failState();
  f.n += 1;
  if (f.n >= 5) f.until = Date.now() + Math.min(300, 30 * 2 ** (f.n - 5)) * 1000;
  writeJSON(FAILS_KEY, f);
  return f;
}

/**
 * Controla a tela de PIN.
 * ui: { screen, title, sub, dots, msg, keypad, cancel, forgot }
 * hooks: { beforeLock(), onUnlock(), onForgot() }
 */
export function createLock(ui, hooks = {}) {
  let mode = null;        // 'unlock' | 'verify' | 'create' | 'confirm'
  let buf = '';
  let first = '';
  let busy = false;
  let pending = null;     // resolve() da tarefa de configuração (criar/verificar)
  let waitTimer = null;

  const root = document.documentElement;
  const isOpen = () => !ui.screen.hidden;

  function setMsg(text, ok = false) {
    ui.msg.textContent = text || '';
    ui.msg.classList.toggle('ok', ok);
  }

  function expectedLen() {
    if (mode === 'unlock' || mode === 'verify') return readJSON(PIN_KEY)?.len || MIN_LEN;
    if (mode === 'confirm') return first.length;
    return null; // criando: de 4 a 6 dígitos
  }

  function renderDots() {
    const want = expectedLen();
    const total = want || Math.max(MIN_LEN, Math.min(MAX_LEN, buf.length + (buf.length < MAX_LEN ? 1 : 0)));
    const frag = document.createDocumentFragment();
    for (let i = 0; i < total; i++) {
      const d = document.createElement('span');
      d.className = 'lock-dot' + (i < buf.length ? ' on' : '');
      frag.append(d);
    }
    ui.dots.replaceChildren(frag);
    const okBtn = ui.keypad.querySelector('[data-key="ok"]');
    if (okBtn) okBtn.hidden = mode !== 'create';
    if (okBtn) okBtn.disabled = buf.length < MIN_LEN;
  }

  function render() {
    const texts = {
      unlock: ['Digite seu PIN', 'Seu diário está protegido.'],
      verify: ['Digite o PIN atual', 'Para confirmar que é você.'],
      create: ['Crie um PIN', 'De 4 a 6 números. Ele fica só neste aparelho.'],
      confirm: ['Confirme o PIN', 'Digite os mesmos números de novo.'],
    };
    const [t, s] = texts[mode] || texts.unlock;
    ui.title.textContent = t;
    ui.sub.textContent = s;
    ui.cancel.hidden = mode === 'unlock';
    ui.forgot.hidden = mode !== 'unlock' && mode !== 'verify';
    renderDots();
  }

  function shake() {
    ui.dots.classList.remove('shake');
    void ui.dots.offsetWidth; // reinicia a animação
    ui.dots.classList.add('shake');
    if (navigator.vibrate && navigator.userActivation?.hasBeenActive !== false) {
      try { navigator.vibrate(120); } catch { /* ignore */ }
    }
  }

  function open(m) {
    if (pending && m === 'unlock') { pending(false); pending = null; }
    mode = m;
    buf = '';
    first = '';
    setMsg('');
    ui.screen.hidden = false;
    render();
    showWait();
    // foca a tela para o teclado físico funcionar no PC
    setTimeout(() => ui.screen.focus({ preventScroll: true }), 0);
  }

  function close() {
    mode = null;
    buf = '';
    first = '';
    ui.screen.hidden = true;
    root.classList.remove('locked');
    clearTimeout(waitTimer);
  }

  function showWait() {
    clearTimeout(waitTimer);
    if (mode !== 'unlock' && mode !== 'verify') return;
    const f = failState();
    const left = Math.ceil((f.until - Date.now()) / 1000);
    if (left > 0) {
      setMsg(`Muitas tentativas. Aguarde ${left} s.`);
      waitTimer = setTimeout(showWait, 1000);
    } else if (ui.msg.textContent.startsWith('Muitas tentativas')) {
      setMsg('');
    }
  }

  async function submit() {
    if (busy) return;
    if (mode === 'create') {
      if (buf.length < MIN_LEN) { setMsg('Use pelo menos 4 números.'); return; }
      first = buf;
      buf = '';
      mode = 'confirm';
      setMsg('');
      render();
      return;
    }
    if (mode === 'confirm') {
      if (buf !== first) {
        shake();
        mode = 'create';
        buf = '';
        first = '';
        render();
        setMsg('Os PINs não conferem. Crie de novo.');
        return;
      }
      busy = true;
      try { await savePin(buf); } finally { busy = false; }
      const done = pending; pending = null;
      close();
      done?.(true);
      return;
    }
    // unlock / verify
    if (failState().until > Date.now()) { showWait(); buf = ''; renderDots(); return; }
    busy = true;
    let ok = false;
    try { ok = await verifyPin(buf); } finally { busy = false; }
    if (ok) {
      writeJSON(FAILS_KEY, null);
      const wasUnlock = mode === 'unlock';
      const done = pending; pending = null;
      close();
      if (wasUnlock) hooks.onUnlock?.();
      done?.(true);
    } else {
      const f = registerFail();
      shake();
      buf = '';
      renderDots();
      if (f.until > Date.now()) showWait();
      else setMsg(f.n >= 3 ? `PIN incorreto (${f.n} tentativas).` : 'PIN incorreto. Tente de novo.');
    }
  }

  function press(key) {
    if (!mode || busy) return;
    if (key === 'back') { buf = buf.slice(0, -1); renderDots(); return; }
    if (key === 'ok') { submit(); return; }
    if (!/^[0-9]$/.test(key)) return;
    if ((mode === 'unlock' || mode === 'verify') && failState().until > Date.now()) { showWait(); return; }
    if (buf.length >= MAX_LEN) return;
    buf += key;
    if (ui.msg.textContent && !ui.msg.textContent.startsWith('Muitas')) setMsg('');
    renderDots();
    const want = expectedLen();
    if (want && buf.length === want) setTimeout(submit, 120);
  }

  function cancel() {
    if (mode === 'unlock') return;
    const done = pending; pending = null;
    close();
    done?.(false);
  }

  ui.keypad.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-key]');
    if (b) press(b.dataset.key);
  });
  ui.cancel.addEventListener('click', cancel);
  ui.forgot.addEventListener('click', () => hooks.onForgot?.());
  document.addEventListener('keydown', (ev) => {
    if (!isOpen()) return;
    if (document.querySelector('dialog[open]')) return; // um diálogo de confirmação está por cima
    if (/^[0-9]$/.test(ev.key)) { ev.preventDefault(); press(ev.key); }
    else if (ev.key === 'Backspace') { ev.preventDefault(); press('back'); }
    else if (ev.key === 'Enter') { ev.preventDefault(); if (mode === 'create') press('ok'); }
    else if (ev.key === 'Escape') { ev.preventDefault(); cancel(); }
  });

  return {
    isLocked: () => mode === 'unlock',
    lock() {
      if (!hasPin() || mode === 'unlock') return;
      hooks.beforeLock?.();
      root.classList.add('locked');
      open('unlock');
    },
    close,
    // Criar ou trocar o PIN. Resolve true se salvou.
    async setup() {
      if (hasPin()) {
        const ok = await new Promise((res) => { pending = res; open('verify'); });
        if (!ok) return false;
      }
      return new Promise((res) => { pending = res; open('create'); });
    },
    // Pede o PIN atual (para remover). Resolve true se acertou.
    verify() {
      if (!hasPin()) return Promise.resolve(true);
      return new Promise((res) => { pending = res; open('verify'); });
    },
  };
}
