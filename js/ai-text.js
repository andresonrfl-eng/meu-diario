// Regras de texto da IA local, sem nenhuma dependência do navegador (testadas em tests/ai-text.test.mjs).

const MAX_CHUNK = 1200;

function normalizeWord(w) {
  return w.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^\p{L}\p{N}]/gu, '');
}

function words(s) {
  return String(s).split(/\s+/).map(normalizeWord).filter(Boolean);
}

// Divide o texto em pedaços que o modelo consegue revisar de uma vez.
// Juntar todos os `text` + `sep` reproduz o original exatamente.
export function splitForCorrection(text, max = MAX_CHUNK) {
  const out = [];
  const pushLong = (line, sep) => {
    let rest = line;
    while (rest.length > max) {
      const head = rest.slice(0, max);
      let cut = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
      if (cut < max / 3) cut = head.lastIndexOf(' ');
      if (cut < 1) cut = max - 1;
      const piece = rest.slice(0, cut + 1);
      const spaces = rest.slice(cut + 1).match(/^\s*/)[0];
      out.push({ text: piece, sep: spaces });
      rest = rest.slice(cut + 1 + spaces.length);
    }
    out.push({ text: rest, sep });
  };
  const parts = String(text).split(/(\n+)/);
  for (let i = 0; i < parts.length; i += 2) pushLong(parts[i], parts[i + 1] || '');
  return out;
}

// A resposta do modelo só é aceita se ainda for, claramente, o mesmo texto.
// Na dúvida fica o original: um modelo pequeno às vezes resume ou responde em vez de revisar.
export function isSafeCorrection(original, corrected) {
  const a = String(original).trim();
  const b = String(corrected).trim();
  if (!b) return false;
  if (a === b) return true;
  const ratio = b.length / a.length;
  if (a.length > 40 && (ratio < 0.8 || ratio > 1.25)) return false;
  if (a.length <= 40 && b.length > a.length + 20) return false;
  const wa = words(a);
  const wb = words(b);
  if (!wa.length) return false;
  const available = new Map();
  for (const w of wb) available.set(w, (available.get(w) || 0) + 1);
  let kept = 0;
  for (const w of wa) {
    const n = available.get(w) || 0;
    if (n > 0) { kept += 1; available.set(w, n - 1); }
  }
  return kept / wa.length >= 0.7;
}

function tokens(s) {
  return String(s).match(/\s+|[^\s]+/g) || [];
}

// Diferença palavra por palavra, para mostrar o antes e depois.
export function diffWords(before, after) {
  const a = tokens(before);
  const b = tokens(after);
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out = [];
  const push = (type, text) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text;
    else out.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { push('same', a[i]); i += 1; j += 1; }
    else if (i < a.length && (j === b.length || lcs[i + 1][j] >= lcs[i][j + 1])) { push('del', a[i]); i += 1; }
    else { push('add', b[j]); j += 1; }
  }
  return out;
}

// Frases que o Whisper costuma "inventar" em trechos com ruído ou quase sem fala.
const PHANTOM = [
  /^legendas? pela comunidade/i,
  /amara\.org/i,
  /^(obrigad[oa]s?( por assistir)?|tchau|até (a )?próxima)[.!]*$/i,
  /inscreva-se/i,
  /^[\s.,!?…♪-]*$/,
];
export function isPhantomTranscript(text) {
  const t = String(text).trim();
  return PHANTOM.some((re) => re.test(t));
}

export function isStopCommand(text) {
  return /^\s*parar (o )?(ditado|de ditar)[\s.!]*$/i.test(String(text));
}
