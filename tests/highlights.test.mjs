// Marca-texto: as marcações acompanham o texto sem perder nem trocar trechos.
import assert from 'node:assert/strict';
import {
  normalizeHighlights, applyHighlight, rebaseHighlights, rebaseWithParts, sameHighlights,
  highlightSegments, trimSelection, trimHighlights, MAX_HIGHLIGHTS,
} from '../js/highlights.js';
import { diffWords } from '../js/ai-text.js';

function test(name, fn) {
  fn();
  console.log('ok', name);
}
const marked = (text, list) => list.map((h) => `${h.color}:${text.slice(h.start, h.end)}`);

test('marcar, trocar de cor e desmarcar', () => {
  const t = 'Hoje eu fui ao médico e voltei tranquilo.';
  let l = applyHighlight([], 8, 21, 'yellow');
  assert.deepEqual(marked(t, l), ['yellow:fui ao médico']);
  l = applyHighlight(l, 15, 21, 'green');
  assert.deepEqual(marked(t, l), ['yellow:fui ao ', 'green:médico']);
  l = applyHighlight(l, 0, t.length, null);
  assert.deepEqual(l, []);
});

test('mesma cor encosta e vira um destaque só; cores diferentes não se misturam', () => {
  let l = applyHighlight([], 0, 4, 'red');
  l = applyHighlight(l, 4, 8, 'red');
  assert.deepEqual(l, [{ start: 0, end: 8, color: 'red' }]);
  l = applyHighlight(l, 2, 6, 'yellow');
  assert.deepEqual(l, [{ start: 0, end: 2, color: 'red' }, { start: 2, end: 6, color: 'yellow' }, { start: 6, end: 8, color: 'red' }]);
});

test('lista inválida vinda de fora é limpa', () => {
  const l = normalizeHighlights([
    { start: 5, end: 2, color: 'yellow' },
    { start: 0, end: 3, color: 'roxo' },
    { start: 'x', end: 4, color: 'green' },
    { start: 8, end: 50, color: 'green' },
    { start: 1, end: 6, color: 'red' },
    { start: 3, end: 9, color: 'yellow' },
    null,
  ], 10);
  assert.deepEqual(l, [{ start: 1, end: 6, color: 'red' }, { start: 6, end: 9, color: 'yellow' }, { start: 9, end: 10, color: 'green' }]);
  assert.deepEqual(normalizeHighlights(undefined), []);
  assert.equal(normalizeHighlights(Array.from({ length: 3000 }, (_, i) => ({ start: i * 2, end: i * 2 + 1, color: 'red' }))).length, MAX_HIGHLIGHTS);
});

test('escrever antes, depois e dentro do destaque', () => {
  const t = 'abc DESTAQUE def';
  const l = [{ start: 4, end: 12, color: 'yellow' }];
  const before = 'xx abc DESTAQUE def';
  assert.deepEqual(marked(before, rebaseHighlights(l, t, before)), ['yellow:DESTAQUE']);
  const glued = 'abc zDESTAQUE def'; // digitou colado no começo
  assert.deepEqual(marked(glued, rebaseHighlights(l, t, glued)), ['yellow:DESTAQUE']);
  const gluedEnd = 'abc DESTAQUEz def'; // digitou colado no fim
  assert.deepEqual(marked(gluedEnd, rebaseHighlights(l, t, gluedEnd)), ['yellow:DESTAQUE']);
  const inside = 'abc DESTA-QUE def';
  assert.deepEqual(marked(inside, rebaseHighlights(l, t, inside)), ['yellow:DESTA-QUE']);
  const after = 'abc DESTAQUE def e mais';
  assert.deepEqual(marked(after, rebaseHighlights(l, t, after)), ['yellow:DESTAQUE']);
});

test('apagar parte ou todo o destaque', () => {
  const t = 'abc DESTAQUE def';
  const l = [{ start: 4, end: 12, color: 'green' }];
  const cutStart = 'abc TAQUE def';
  assert.deepEqual(marked(cutStart, rebaseHighlights(l, t, cutStart)), ['green:TAQUE']);
  const cutAcross = 'abc DESTA'; // apagou do meio do destaque até o fim
  assert.deepEqual(marked(cutAcross, rebaseHighlights(l, t, cutAcross)), ['green:DESTA']);
  const gone = 'abc  def';
  assert.deepEqual(rebaseHighlights(l, t, gone), []);
  assert.deepEqual(rebaseHighlights(l, t, ''), []);
});

test('substituir um trecho que começa dentro do destaque', () => {
  const t = 'abcDEF';
  const l = [{ start: 3, end: 6, color: 'red' }];
  const replaced = 'abxEF'; // trocou "cD" por "x"
  assert.deepEqual(marked(replaced, rebaseHighlights(l, t, replaced)), ['red:EF']);
});

test('correção da IA mantém o destaque na palavra corrigida', () => {
  const before = 'hoje eu fui no medico e voltei tranquilo';
  const after = 'Hoje eu fui no médico e voltei tranquilo.';
  const l = [{ start: 15, end: 21, color: 'yellow' }, { start: 31, end: 40, color: 'green' }];
  assert.deepEqual(marked(before, l), ['yellow:medico', 'green:tranquilo']);
  const out = rebaseWithParts(l, diffWords(before, after));
  assert.deepEqual(marked(after, out), ['yellow:médico', 'green:tranquilo.']);
});

test('correção de só uma parte do texto (seleção) usa a posição certa', () => {
  const head = 'Primeira parte intocada. ';
  const region = 'as veses eu fico cansado';
  const fixed = 'Às vezes eu fico cansado.';
  const tail = '\nFim marcado.';
  const t = head + region + tail;
  const l = [
    { start: head.length + 12, end: head.length + 24, color: 'red' },
    { start: t.length - 8, end: t.length - 1, color: 'yellow' },
    { start: 0, end: 8, color: 'green' },
  ];
  assert.deepEqual(marked(t, normalizeHighlights(l)), ['green:Primeira', 'red:fico cansado', 'yellow:marcado']);
  const out = rebaseWithParts(normalizeHighlights(l), diffWords(region, fixed), head.length);
  const nt = head + fixed + tail;
  assert.deepEqual(marked(nt, out), ['green:Primeira', 'red:fico cansado.', 'yellow:marcado']);
});

test('pedaços para desenhar reconstroem o texto', () => {
  const t = 'um dois três quatro';
  const segs = highlightSegments(t, [{ start: 3, end: 7, color: 'yellow' }, { start: 13, end: 19, color: 'red' }]);
  assert.equal(segs.map((s) => s.text).join(''), t);
  assert.deepEqual(segs.filter((s) => s.color).map((s) => s.text), ['dois', 'quatro']);
  assert.equal(highlightSegments(t, [{ start: 10, end: 99, color: 'red' }]).map((s) => s.text).join(''), t);
});

test('seleção sem espaços nas pontas', () => {
  assert.deepEqual(trimSelection('  oi mundo \n', 0, 12), [2, 10]);
  assert.deepEqual(trimSelection('   ', 0, 3), [3, 3]);
});

test('desmarcar parte não deixa espaço destacado', () => {
  const t = 'eu preciso aprender a dizer não';
  const s0 = t.indexOf('aprender');
  let l = applyHighlight([], s0, t.length, 'green');
  l = trimHighlights(applyHighlight(l, s0, s0 + 8, null), t);
  assert.deepEqual(marked(t, l), ['green:a dizer não']);
  assert.deepEqual(trimHighlights([{ start: 2, end: 3, color: 'red' }], 'eu preciso'), []);
});

test('igualdade de listas', () => {
  assert.equal(sameHighlights([], undefined), true);
  assert.equal(sameHighlights([{ start: 1, end: 2, color: 'red' }], [{ start: 1, end: 2, color: 'red' }]), true);
  assert.equal(sameHighlights([{ start: 1, end: 2, color: 'red' }], [{ start: 1, end: 2, color: 'green' }]), false);
});

// Simulação: 4.000 edições aleatórias (digitar, apagar, colar) fora dos destaques nunca alteram
// o que está destacado; dentro, as marcações continuam válidas.
test('simulação de 4.000 edições aleatórias', () => {
  let seed = 7;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const words = ['hoje', 'eu', 'fui', 'ao', 'médico', 'e', 'voltei', 'calmo', '\n', 'mas', 'às', 'vezes'];
  let text = Array.from({ length: 80 }, () => words[rand(words.length)]).join(' ');
  let list = [];
  for (let i = 0; i < 4000; i++) {
    const op = rand(10);
    if (op < 3) {
      const a = rand(text.length);
      const b = Math.min(text.length, a + 1 + rand(15));
      list = applyHighlight(list, a, b, ['yellow', 'green', 'red', null][rand(4)]);
      continue;
    }
    const outside = [];
    let at = 0;
    for (const h of list) { if (h.start > at) outside.push([at, h.start]); at = h.end; }
    if (at < text.length) outside.push([at, text.length]);
    const touchHighlight = rand(4) === 0 || !outside.length;
    let p;
    let q;
    if (touchHighlight) {
      p = rand(text.length + 1);
      q = Math.min(text.length, p + rand(6));
    } else {
      const [a, b] = outside[rand(outside.length)];
      p = a + rand(b - a + 1);
      q = Math.min(b, p + rand(4));
    }
    const ins = op < 7 ? words[rand(words.length)] + ' ' : '';
    const before = list.map((h) => text.slice(h.start, h.end));
    const next = text.slice(0, p) + ins + text.slice(q);
    const moved = rebaseHighlights(list, text, next);
    for (const h of moved) {
      assert.ok(h.start >= 0 && h.end <= next.length && h.end > h.start, 'dentro do texto');
    }
    for (let k = 1; k < moved.length; k++) assert.ok(moved[k].start >= moved[k - 1].end, 'sem sobreposição');
    if (!touchHighlight) {
      assert.deepEqual(moved.map((h) => next.slice(h.start, h.end)), before, 'edição fora não muda o destacado');
    }
    text = next;
    list = moved;
  }
});

console.log('TODOS OS TESTES DO MARCA-TEXTO PASSARAM');
