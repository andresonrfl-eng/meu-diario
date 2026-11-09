// Regras que protegem o texto do usuário ao usar a IA local.
import assert from 'node:assert/strict';
import {
  splitForCorrection, isSafeCorrection, diffWords, isPhantomTranscript, isStopCommand,
} from '../js/ai-text.js';

const rebuild = (chunks) => chunks.map((c) => c.text + c.sep).join('');

function test(name, fn) {
  fn();
  console.log('ok', name);
}

test('dividir preserva o texto exatamente', () => {
  const samples = [
    '',
    'uma linha só',
    'primeiro\n\nsegundo\n',
    '\ncomeça com quebra',
    `${'Frase de exemplo no diário. '.repeat(300)}\n\nFim.`,
    'x'.repeat(5000),
  ];
  for (const s of samples) assert.equal(rebuild(splitForCorrection(s)), s);
});

test('nenhum pedaço passa do limite', () => {
  const chunks = splitForCorrection('Palavra comprida aqui. '.repeat(500), 300);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.text.length <= 300, `pedaço com ${c.text.length}`);
});

test('aceita uma correção normal', () => {
  assert.equal(isSafeCorrection('hoje eu fui no medico e voltei mais tranquilo', 'Hoje eu fui ao médico e voltei mais tranquilo.'), true);
  assert.equal(isSafeCorrection('ola', 'Olá.'), true);
});

test('recusa resumo, resposta e texto vazio', () => {
  const longo = 'Hoje acordei com muita dor no pescoço e fiquei pensando no trabalho durante toda a manhã, sem conseguir descansar direito.';
  assert.equal(isSafeCorrection(longo, 'Dor no pescoço.'), false);
  assert.equal(isSafeCorrection(longo, ''), false);
  assert.equal(isSafeCorrection(longo, 'Sinto muito que você esteja passando por isso, procure descansar e fale com alguém de confiança sobre o que está sentindo hoje.'), false);
  assert.equal(isSafeCorrection('como você está?', 'Estou bem, obrigado por perguntar! E você, como vai?'), false);
});

test('diferença reconstrói o antes e o depois', () => {
  const before = 'hoje eu fui no medico\ne voltei';
  const after = 'Hoje eu fui ao médico\ne voltei.';
  const d = diffWords(before, after);
  assert.equal(d.filter((p) => p.type !== 'add').map((p) => p.text).join(''), before);
  assert.equal(d.filter((p) => p.type !== 'del').map((p) => p.text).join(''), after);
  assert.ok(d.some((p) => p.type === 'same'));
});

test('filtra frases inventadas pelo Whisper', () => {
  assert.equal(isPhantomTranscript('Legendas pela comunidade Amara.org'), true);
  assert.equal(isPhantomTranscript('Obrigado por assistir!'), true);
  assert.equal(isPhantomTranscript(' ... '), true);
  assert.equal(isPhantomTranscript('Obrigado pela conversa de hoje, foi muito boa.'), false);
});

test('reconhece o comando de parar', () => {
  assert.equal(isStopCommand('Parar ditado.'), true);
  assert.equal(isStopCommand('parar de ditar'), true);
  assert.equal(isStopCommand('Vou parar de ditar depois do almoço.'), false);
});

console.log('TODOS OS TESTES DE TEXTO DA IA PASSARAM');
