# Instruções para o Claude Code — Meu Diário

**Antes de qualquer coisa, leia [HISTORICO.md](HISTORICO.md)**: ele resume tudo o que já foi feito,
decisões tomadas e pendências. **Ao final de cada sessão em que algo mudar, adicione uma nova entrada
no topo do HISTORICO.md** (data, o que mudou, por quê, pendências).

## Sobre o usuário
- Fala português (Brasil). Responda e escreva textos do app em pt-BR.
- Tem síndrome dolorosa miofascial cervical: evitar flexionar o pescoço. Recursos de voz,
  texto grande e pouca necessidade de olhar para baixo são prioridade de produto.
- O diário foi recomendado pela psicóloga: tom acolhedor, privacidade é essencial.

## Projeto
PWA estática (sem build) + Supabase. Veja README.md para a arquitetura e o passo a passo.
- `js/app.js` interface · `js/db.js` IndexedDB · `js/sync.js` sincronização · `js/voice.js` voz · `js/lock.js` PIN
- `js/ai.js` IA local (pasta, worker, ditado Whisper) · `js/ai-worker.js` modelos · `js/ai-text.js` regras de texto da IA · `js/mic-worklet.js` microfone
- `js/config.js` URL + chave pública do Supabase (vazio = modo só no aparelho)
- `supabase/schema.sql` tabela `entries` + RLS + trigger + `ping()` (idempotente)
- `.github/workflows/manter-acordado.yml` toque no banco a cada 3 dias (plano grátis pausa após 7 dias)
- `npm test` = `tests/sync.test.mjs` (cenários) + `tests/two-devices.test.mjs` (simulação de 2 aparelhos)

## Regras importantes
- **Sempre** que mudar qualquer arquivo do app, aumente `CACHE` em `sw.js` e `APP_VERSION` em `js/app.js`
  (senão os aparelhos continuam com a versão antiga em cache).
- Nada de dependências com build. Bibliotecas externas só pelo jsDelivr com versão fixa
  (e liberar no Content-Security-Policy do `index.html`).
- Nunca renderizar texto do usuário com `innerHTML` (risco de XSS) — use `textContent`.
- Não usar lookbehind em regex (`(?<=`): quebra o app inteiro no iOS < 16.4.
- Nunca colocar a chave `service_role`/`secret` do Supabase no código.
- Sincronização: cada gravação local recebe um `rev` único; `markClean` só limpa se o `rev` não mudou.
  Não troque isso por contador numérico (gera colisão entre abas).
- Conflitos: antes de enviar, o sync compara `server_updated_at` (base) com o servidor; se outro aparelho
  mudou o texto, guarda a versão dele como anotação separada. Não remova isso (evita perder texto).
- Rode `npm test` depois de mexer em `db.js` ou `sync.js`.
- Diálogos de confirmação: não dependa só do evento `close` do `<dialog>` (não dispara em alguns navegadores);
  use `confirmDialog` em `app.js`.
- Ao mudar o desenho do ícone, mude também o NOME dos arquivos (PCs guardam o ícone pelo nome).
- No Windows PowerShell 5.1 não use `Set-Content`/`Get-Content` para editar arquivos (estraga acentos).
- O usuário desistiu do lembrete por notificação: não ofereça de novo sem ele pedir.
- IA local: modelos só na pasta escolhida pelo usuário (`D:\MeuDiario-IA` neste PC), nunca no cache do navegador (disco C: cheio).
  Mantenha `isSafeCorrection` e a confirmação antes de aplicar: a IA não pode alterar o texto sem o usuário ver.
