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
- `js/app.js` interface · `js/db.js` IndexedDB · `js/sync.js` sincronização · `js/voice.js` voz
- `js/config.js` URL + chave pública do Supabase (vazio = modo só no aparelho)
- `supabase/schema.sql` tabela `entries` + RLS + trigger (idempotente)
- `tests/sync.test.mjs` testes da sincronização (`npm test`, usa fake-indexeddb)

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
- Rode `npm test` depois de mexer em `db.js` ou `sync.js`.
