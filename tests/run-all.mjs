// Roda todos os testes: cenários de sincronização + simulação de 2 aparelhos com várias sementes.
// Uso: npm test        (SEEDS=60 npm test para uma rodada mais longa)
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));
const seeds = Number(process.env.SEEDS || 15);

function run(file, env = {}) {
  const r = spawnSync(process.execPath, [dir + file], { encoding: 'utf8', env: { ...process.env, ...env } });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
}

const a = run('sync.test.mjs');
console.log(a.out.split('\n').filter((l) => l.startsWith('ok') || l.includes('PASSARAM')).join('\n'));
if (!a.ok) { console.error(a.out); process.exit(1); }

let fails = 0;
for (let s = 1; s <= seeds; s++) {
  const r = run('two-devices.test.mjs', { SEED: String(s) });
  if (!r.ok) { fails++; console.error(`Simulação falhou com SEED=${s}\n${r.out}`); }
}
if (fails) process.exit(1);
console.log(`ok simulação com 2 aparelhos: ${seeds} rodadas de 600 operações, todas convergiram sem perder texto`);
console.log('TUDO CERTO');
