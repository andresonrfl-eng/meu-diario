// Voz: ditado (fala -> texto) e leitura em voz alta (texto -> fala).
// Pensado para reduzir o tempo olhando para baixo / digitando.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const IS_ANDROID = /Android/i.test(navigator.userAgent);

export const dictationSupported = !!SR;
export const speechSupported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

// Comandos falados de pontuação (o reconhecimento de voz em português não pontua sozinho).
const RULES = [
  [/\s+ponto de interroga[çc][ãa]o\s+/gi, '? '],
  [/\s+ponto de exclama[çc][ãa]o\s+/gi, '! '],
  [/\s+ponto final\s+/gi, '. '],
  [/\s+v[íi]rgula\s+/gi, ', '],
  [/\s+dois pontos\s+/gi, ': '],
  [/\s+(nova linha|novo par[áa]grafo|pr[óo]xima linha)\s+/gi, '\n'],
];

// Formata um trecho ditado considerando o texto que vem antes do cursor.
export function formatDictation(raw, before = '') {
  let t = ' ' + String(raw).trim() + ' ';
  for (const [re, rep] of RULES) {
    // aplica duas vezes para comandos seguidos ("vírgula vírgula")
    t = t.replace(re, rep).replace(re, rep);
  }
  t = t.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/^ +/, '').replace(/ +$/, '');
  if (!t) return '';
  // Maiúscula depois de ponto/exclamação/interrogação ou nova linha
  t = t.replace(/([.!?] +|\n)(\p{Ll})/gu, (_, a, b) => a + b.toUpperCase());
  const prev = before.replace(/[ \t]+$/, '');
  if (prev === '' || /[.!?\n]$/.test(prev)) t = t.replace(/^(\p{Ll})/u, (c) => c.toUpperCase());
  const needsSpace = before.length > 0 && !/\s$/.test(before) && !/^[.,!?:;\n]/.test(t);
  return (needsSpace ? ' ' : '') + t;
}

export function createDictation({ onFinal, onInterim, onStateChange, onError }) {
  let rec = null;
  let active = false;
  let restarts = [];

  function spawn() {
    rec = new SR();
    rec.lang = 'pt-BR';
    // No Android o modo contínuo repete frases; lá reiniciamos a cada frase.
    rec.continuous = !IS_ANDROID;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) onFinal(r[0].transcript);
        else interim += r[0].transcript;
      }
      onInterim(interim);
    };
    rec.onerror = (ev) => {
      if (['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported'].includes(ev.error)) {
        active = false;
        onError(ev.error);
        onStateChange(false);
      }
      // 'no-speech' e 'aborted' são normais: o onend reinicia.
    };
    rec.onend = () => {
      onInterim('');
      if (!active) return;
      // Proteção contra laço infinito de reinício (ex.: microfone travado)
      const now = Date.now();
      restarts = restarts.filter((t) => now - t < 5000);
      restarts.push(now);
      if (restarts.length > 8) {
        active = false;
        onStateChange(false);
        onError('loop');
        return;
      }
      try { rec.start(); } catch { setTimeout(() => { if (active) spawn(); }, 300); }
    };
    try {
      rec.start();
    } catch (e) {
      active = false;
      onStateChange(false);
      onError('start');
    }
  }

  return {
    start() {
      if (!SR || active) return;
      active = true;
      restarts = [];
      onStateChange(true);
      spawn();
    },
    stop() {
      if (!active && !rec) return;
      active = false;
      try { rec && rec.stop(); } catch { /* ignore */ }
      onInterim('');
      onStateChange(false);
    },
    get active() { return active; },
  };
}

// ---------- Leitura em voz alta ----------
let speakToken = 0;

function pickVoice() {
  const voices = window.speechSynthesis.getVoices();
  return voices.find((v) => /pt[-_]BR/i.test(v.lang)) || voices.find((v) => /^pt/i.test(v.lang)) || null;
}

// Quebra o texto em pedaços curtos (o Chrome corta falas muito longas).
function chunks(text) {
  const parts = [];
  // (sem lookbehind no regex: quebraria o app inteiro em iPhones com iOS < 16.4)
  for (const sentence of String(text).match(/[^.!?…\n]+[.!?…]*/g) || []) {
    let s = sentence.trim();
    while (s.length > 180) {
      let cut = s.lastIndexOf(',', 180);
      if (cut < 60) cut = s.lastIndexOf(' ', 180);
      if (cut < 60) cut = 180;
      parts.push(s.slice(0, cut + 1).trim());
      s = s.slice(cut + 1).trim();
    }
    if (s) parts.push(s);
  }
  return parts;
}

export function speak(text, onEnd) {
  if (!speechSupported) return false;
  const synth = window.speechSynthesis;
  synth.cancel();
  const token = ++speakToken;
  const parts = chunks(text);
  if (!parts.length) { onEnd?.(); return false; }
  const voice = pickVoice();
  parts.forEach((p, i) => {
    const u = new SpeechSynthesisUtterance(p);
    u.lang = 'pt-BR';
    if (voice) u.voice = voice;
    u.rate = 0.95;
    const finish = () => { if (token === speakToken) { speakToken++; onEnd?.(); } };
    if (i === parts.length - 1) u.onend = finish;
    u.onerror = () => {
      if (token !== speakToken) return; // erro causado por cancelamento intencional
      synth.cancel();
      finish();
    };
    synth.speak(u);
  });
  return true;
}

export function stopSpeaking() {
  if (!speechSupported) return;
  speakToken++;
  window.speechSynthesis.cancel();
}
