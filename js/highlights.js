// Marca-texto: trechos destacados guardados como posições no texto ({ start, end, color }).
// Regras puras, sem navegador (testadas em tests/highlights.test.mjs).

export const HL_COLORS = ['yellow', 'green', 'red'];
export const MAX_HIGHLIGHTS = 2000;

// Deixa a lista válida: posições inteiras dentro do texto, cores conhecidas, em ordem,
// sem sobreposição (o trecho que começa antes vence) e com vizinhos da mesma cor unidos.
export function normalizeHighlights(list, length = Infinity) {
  const valid = (Array.isArray(list) ? list : [])
    .map((h) => ({
      start: Math.max(0, Math.floor(Number(h?.start))),
      end: Math.min(length, Math.floor(Number(h?.end))),
      color: h?.color,
    }))
    .filter((h) => Number.isFinite(h.start) && Number.isFinite(h.end) && h.end > h.start && HL_COLORS.includes(h.color))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out = [];
  for (const h of valid) {
    const prev = out[out.length - 1];
    if (prev && h.start <= prev.end && h.color === prev.color) {
      prev.end = Math.max(prev.end, h.end);
    } else if (prev && h.start < prev.end) {
      if (h.end > prev.end) out.push({ ...h, start: prev.end });
    } else {
      out.push({ ...h });
    }
  }
  return out.slice(0, MAX_HIGHLIGHTS);
}

// Pinta (ou, com color = null, despinta) o trecho [start, end).
export function applyHighlight(list, start, end, color) {
  const out = [];
  for (const h of list) {
    if (h.end <= start || h.start >= end) { out.push(h); continue; }
    if (h.start < start) out.push({ ...h, end: start });
    if (h.end > end) out.push({ ...h, start: end });
  }
  if (color && end > start) out.push({ start, end, color });
  return normalizeHighlights(out);
}

// Ajusta as marcações a uma edição: o trecho antigo [p, oldEnd) virou o novo [p, newEnd).
// Escrever logo antes ou logo depois de um destaque não o estica; escrever dentro, sim.
function rebaseEdit(list, p, oldEnd, newEnd) {
  const delta = newEnd - oldEnd;
  const mapStart = (o) => {
    if (o >= oldEnd) return o + delta;
    if (o <= p) return o;
    return newEnd; // começava dentro do trecho trocado
  };
  const mapEnd = (o) => {
    if (o <= p) return o;
    if (o >= oldEnd) return o + delta;
    return p; // terminava dentro do trecho trocado
  };
  const out = [];
  for (const h of list) {
    const start = mapStart(h.start);
    const end = mapEnd(h.end);
    if (end > start) out.push({ ...h, start, end });
  }
  return out;
}

// Depois de qualquer mudança no texto (digitar, ditar, colar, desfazer, voltar da nuvem).
export function rebaseHighlights(list, oldText, newText) {
  if (!list.length || oldText === newText) return list;
  const oldLen = oldText.length;
  const newLen = newText.length;
  const lim = Math.min(oldLen, newLen);
  let p = 0;
  while (p < lim && oldText.charCodeAt(p) === newText.charCodeAt(p)) p++;
  let s = 0;
  while (s < lim - p && oldText.charCodeAt(oldLen - 1 - s) === newText.charCodeAt(newLen - 1 - s)) s++;
  return normalizeHighlights(rebaseEdit(list, p, oldLen - s, newLen - s), newLen);
}

// Para a correção da IA: usa a diferença palavra por palavra (ai-text.js diffWords),
// assim uma palavra corrigida dentro de um destaque continua destacada.
// offset = onde o trecho revisado começa no texto inteiro.
export function rebaseWithParts(list, parts, offset = 0) {
  if (!list.length) return list;
  const blocks = [];
  let o = offset;
  let block = null;
  for (const part of parts) {
    const len = part.text.length;
    if (part.type === 'same') {
      if (block) { blocks.push(block); block = null; }
      o += len;
      continue;
    }
    if (!block) block = { at: o, del: 0, add: 0 };
    if (part.type === 'del') { block.del += len; o += len; } else { block.add += len; }
  }
  if (block) blocks.push(block);
  // Do fim para o começo: as posições anteriores ainda valem no texto antigo.
  let out = list;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    out = rebaseEdit(out, b.at, b.at + b.del, b.at + b.add);
  }
  return normalizeHighlights(out);
}

export function sameHighlights(a, b) {
  const x = a || [];
  const y = b || [];
  return x.length === y.length && x.every((h, i) => h.start === y[i].start && h.end === y[i].end && h.color === y[i].color);
}

// Pedaços do texto para desenhar: [{ text, color|null }].
export function highlightSegments(text, list) {
  const out = [];
  let at = 0;
  for (const h of list) {
    const start = Math.min(h.start, text.length);
    const end = Math.min(h.end, text.length);
    if (end <= start || start < at) continue;
    if (start > at) out.push({ text: text.slice(at, start), color: null });
    out.push({ text: text.slice(start, end), color: h.color });
    at = end;
  }
  if (at < text.length) out.push({ text: text.slice(at), color: null });
  return out;
}

// Depois de marcar ou desmarcar: nenhum destaque começa ou termina em espaço
// (desmarcar "aprender" em "aprender a dizer" deixa "a dizer", não " a dizer").
export function trimHighlights(list, text) {
  const out = [];
  for (const h of list) {
    const [start, end] = trimSelection(text, h.start, Math.min(h.end, text.length));
    if (end > start) out.push({ ...h, start, end });
  }
  return out;
}

// Seleção sem os espaços e quebras de linha das pontas (marcar "  palavra " marca só "palavra").
export function trimSelection(text, start, end) {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(text[s])) s++;
  while (e > s && /\s/.test(text[e - 1])) e--;
  return [s, e];
}
