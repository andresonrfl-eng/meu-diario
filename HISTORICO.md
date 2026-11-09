# Histórico do projeto — Meu Diário

Registro de cada sessão de trabalho (mais recente no topo). Serve para que qualquer nova sessão
do Claude Code saiba o que já foi feito. **Atualize ao final de cada sessão.**

---

## Situação atual (resumo rápido)
- **Versão: 1.1.1** (`APP_VERSION = '1.1.1'` em `js/app.js`, `CACHE = 'diario-final-1.1.1'` em `sw.js`).
  A numeração foi "zerada" no 1.0 a pedido do usuário (antes ia até 1.5.1).
- **IA local no PC** (1.1): Whisper (ditado) + Gemma 4 (botão ✨ Corrigir), via WebGPU. Modelos em `D:\MeuDiario-IA`
  (3,6 GB) — **nunca no disco C:**, que está quase cheio. Só no computador; o celular segue com o ditado do navegador.
- **Bloqueio com PIN** (opcional, por aparelho) — `js/lock.js`.
- **Supabase acordado:** GitHub Actions `.github/workflows/manter-acordado.yml` chama `public.ping()` a cada 3 dias.
- **Aviso de cópia de segurança** mensal no app (banner "Baixar cópia").
- **Testes:** `npm test` = 14 cenários + simulação de 2 aparelhos (15 sementes × 600 operações). `SEEDS=60 npm test` para rodada longa.
- **Lembrete diário: DESISTIDO** pelo usuário ("muito complexo") — removido do app e da nuvem na v1.5.1.
- **Símbolo:** "sol no horizonte" = **respiro** (escolhido pelo usuário; respiro a qualquer hora, não só no fim do dia).
- **Visual:** "Calmo e natural" (sálvia/areia/pêssego) — tema padrão claro "Dia"; escuro = "Noite" (floresta).
  O usuário NÃO gostou do "Noite aconchegante" (v1.2.0), que foi substituído.
- **App:** publicado e conectado à nuvem.
- **Nuvem (Supabase):** ✅ projeto "meu diario" (ref `fusyhpwqspbidtarkxbe`, região us-east-1, plano Free).
  Schema aplicado; Site URL = endereço do Pages; Redirect URLs = Pages/** e localhost:5173/**.
  `js/config.js` usa a chave **publishable** (`sb_publishable_…`). Acesso anônimo à tabela testado: bloqueado (401).
- **GitHub:** repositório público <https://github.com/andresonrfl-eng/meu-diario> (branch `main`).
  GitHub CLI logado como `andresonrfl-eng` (gh em `C:\Program Files\GitHub CLI\gh.exe`).
- **Endereço do app (GitHub Pages):** <https://andresonrfl-eng.github.io/meu-diario/> — publica sozinho a cada `git push`.

### Pendências
1. ~~Login no GitHub CLI → criar repositório e ativar GitHub Pages.~~ ✅ feito
2. ~~Projeto Supabase + schema + URLs + config.js~~ ✅ feito
3. ~~Usuário criar a conta no app e confirmar o e-mail.~~ ✅ feito em 05/11/2026 — login funcionou.
4. ~~Testar sincronização e ditado~~ ✅ — tempo real confirmado pelo usuário nos aparelhos dele (05/11/2026). Itens originais: login, sincronização real entre dois aparelhos, ditado no celular do usuário.

### Ideias para o futuro (não feitas)
- Criptografia de ponta a ponta (senha extra que nem o servidor conhece). Risco: esqueceu a senha = perdeu tudo.
- Digital/biometria além do PIN.
- ~~Lembrete diário (notificação)~~ — usuário desistiu; não oferecer de novo.
- ~~Gráfico de dor~~ — usuário não quer. Gráfico do humor / resumo da semana: "só se for de extra".
- Bloquear cadastro de contas novas no Supabase — sugerido; o usuário disse "deixa tá bom" (07/11/2026).
  Fica como está (cadastro aberto; estranhos não veem nada por causa do RLS). Não insistir.
- Importar backup .json.
- Exportar em PDF para mostrar na consulta.

---

## Sessão 2 (continuação) — 09/11/2026 — Ditado preso em "Ouvindo" (v1.1.1)
- Sintoma: no PC do usuário o ditado ficava em "Ouvindo" e nenhum texto aparecia. IA, pasta e permissões estavam ok.
- Causa: `getUserMedia` sem `deviceId` fazia o Chrome escolher o **Steam Streaming Microphone** (virtual e mudo). O microfone
  real do usuário é o NVIDIA Broadcast, padrão do Windows. Volume medido com fala: bom (média ~0,06; limite do detector 0,012).
- Correção: sempre pede o aparelho com `deviceId: { exact }` (o escolhido em ⚙ ou `default`); seletor de microfone nas
  Configurações; o painel mostra o microfone em uso e avisa se nenhuma voz for captada nos primeiros 10 s do ditado.
- O NVIDIA Broadcast corta para silêncio absoluto (zero) quando ninguém fala: isso é normal, não indica defeito.

## Sessão 2 — 09/11/2026 — Tela cheia, voz com Whisper e correção com IA (v1.1)
Pedido: esconder a barra lateral, um bom modo de voz no PC com transcrição e uma IA que corrija ortografia e
gramática. O usuário quis uma IA **boa e gratuita** e pediu que os downloads fossem para o **disco D:** (C: sem espaço).

**Barra lateral:** botão ☰ no topo ou `Ctrl+B` (só no computador); a preferência fica em `diario.focus`. Com a lista
escondida, o editor ocupa toda a largura e aparece "Escrever agora" no topo.

**Por que IA local:** Gemini grátis permite revisão humana do conteúdo (termos de mar/2026) e, no Groq, não ficou
confirmado que os dados não são usados para treino — ruim para um diário terapêutico. A IA embutida do Chrome não tem
português confirmado. O PC do usuário (RTX 5060 Ti 8 GB, 16 GB RAM) roda tudo localmente, sem chave e sem custo.

**Como funciona:**
- `js/ai-worker.js` (worker): Transformers.js 4.3.1 pelo jsDelivr, WebGPU, modelos com revisão fixa:
  `onnx-community/whisper-small` e `onnx-community/gemma-4-E2B-it-ONNX` (q4f16).
- Modelos numa pasta escolhida pelo usuário (File System Access; o identificador fica no IndexedDB `diario-ia`), por
  `env.customCache`. `useBrowserCache`/`useWasmCache` desligados: o Cache do navegador ficaria no C:. Sem pasta, o worker
  recusa (`sem-pasta`). Layout: `<pasta>/<repo>/<arquivo>`, igual ao que foi baixado em `D:\MeuDiario-IA`.
- `js/ai.js`: pasta, cliente do worker (fecha após 10 min sem uso para liberar a placa de vídeo) e ditado: microfone a
  16 kHz (`js/mic-worklet.js`), corta por silêncio (800 ms) ou 25 s. Dizer "parar ditado" desliga.
- `js/ai-text.js` (testado em `tests/ai-text.test.mjs`): divide o texto, compara antes/depois e **recusa respostas que não
  sejam o mesmo texto** (`isSafeCorrection`), porque o Gemma obedeceu a "escreva um poema" no teste. Filtra frases inventadas pelo Whisper.
- Corrigir nunca altera direto: mostra riscado/destaque e só aplica com confirmação. Com seleção, corrige só a seleção.

**Testado neste PC:** áudio de 12 s transcrito sem erros em <4 s; Gemma carrega em ~11 s e revisa parágrafo longo em ~6 s;
desabafo com perguntas foi só revisado. Tela real ponta a ponta com microfone simulado e o fluxo Corrigir (aplicar e manter);
gravação e leitura da pasta testadas numa pasta temporária; celular sem mudanças; `npm test` ok.

**Não testado:** a janela nativa de escolher pasta e o microfone real (exigem a pessoa). Na 1ª vez no app, escolher
`D:\MeuDiario-IA`: os modelos já estão lá. Cuidado: `D:\MeuDiario-IA` fica fora do repositório.

## Sessão 1 (continuação) — 07/11/2026 — Revisão geral e VERSÃO FINAL 1.0
Pedido: "deixar pronto para usar todo dia sem me preocupar" — revisão completa, testes de simulação, correções.

**Bugs encontrados e corrigidos:**
1. **Excluir não funcionava** (e "Sair"/"Esqueci o PIN" podiam travar): o diálogo de confirmação dependia só do
   evento `close`, que em alguns Chromium não dispara depois do envio do `<form method="dialog">`. Agora
   `confirmDialog` resolve pelo `submit` (com `submitter.value`), `cancel` (Esc) ou `close` — o que vier primeiro.
2. **Edição em dois aparelhos ao mesmo tempo podia apagar texto** (vencia a última enviada). Agora, antes de
   enviar, o `sync.js` confere no servidor se a anotação mudou desde a última versão conhecida
   (`server_updated_at`, que o upsert devolve via `.select('id,updated_at')` e o `markClean` guarda); se mudou e o
   texto é diferente, a versão do outro aparelho vira uma **anotação separada** "(versão de outro aparelho)" e o app
   avisa com um toast. Registros antigos sem base conhecida seguem a regra antiga (sem cópias falsas).
3. **Uma anotação recusada pelo servidor travava o envio de todas** (o lote de 100 é tudo-ou-nada). Agora, se o lote
   falhar por erro que não é de rede, envia uma por uma; as recusadas ficam no aparelho e o status mostra erro.
   Também: `maxlength=200000` no texto (limite do banco) e o ditado respeita esse limite.
4. **"Esqueci o PIN" sem internet** podia cair no caminho "sem conta" e apagar anotações ainda não enviadas.
   Agora, com sessão salva e sem conexão, só pede para conectar.
5. Service worker guardava páginas com `?code=...` (links de confirmação) como cópias separadas → chave sem `?`.

**Novidades:**
- Aviso mensal de cópia de segurança (14 dias após a 1ª anotação, depois a cada 30 dias; "X" adia 3 dias).
  Configurações mostram a data da última cópia.
- `public.ping()` no banco (só devolve a hora) + GitHub Actions a cada 3 dias → o projeto grátis não é pausado.
  O mesmo workflow faz um commit "batimento" se o repositório ficar 45 dias parado (o GitHub desliga agendamentos
  após 60 dias sem atividade). Testado (workflow_dispatch): HTTP 200. **Atenção:** o login do `gh` não tem o escopo
  `workflow`, então `git push` recusa mudanças em `.github/workflows/` — o arquivo foi criado pelo site do GitHub.
  Para editar de novo: pelo site, ou `gh auth refresh -s workflow` (o usuário precisa autorizar no navegador).
- Supabase limpo: removidos pg_cron, pg_net e a função send-reminders. Security Advisor: 0 erros, 1 aviso
  ("Leaked password protection" — só existe no plano pago).

**Testes:** `tests/sync.test.mjs` (14 cenários) + `tests/two-devices.test.mjs` (dois aparelhos com bancos
separados, 600 operações aleatórias: escrever, editar, excluir, cair internet, sincronizar fora de ordem;
confere que celular = PC = servidor e que nenhuma versão escrita se perde). Rodado com 60 sementes: 60/60 ok.
No navegador: criar/salvar/recarregar, busca sem acento, título com HTML (não executa), excluir/cancelar,
aviso de cópia, PIN completo, celular e tema escuro.

## Sessão 1 (continuação) — 06/11/2026 — Lembrete removido (v1.5.1)
- Na hora de configurar (colar a chave secreta e desligar "Verify JWT"), o usuário achou complexo demais e
  pediu para deixar a notificação de lado. **Não oferecer de novo sem ele pedir.**
- Removido: seção nas Configurações, `js/reminder.js`, eventos `push`/`notificationclick` do service worker,
  `VAPID_PUBLIC_KEY` do `js/config.js`, `supabase/lembretes.sql` e o código da função (continuam no histórico do git,
  commit `0ecba7a`, se um dia quiser retomar).
- Nuvem: agendamento `diario-lembretes` desligado (`cron.unschedule`) e tabela `push_subscriptions` apagada.
  A Edge Function `send-reminders` ainda existe no painel, mas está inerte (sem chave e ninguém a chama);
  pode ser apagada em Edge Functions → send-reminders → Settings → Delete. As chaves VAPID foram descartadas.
- Alternativa simples se ele quiser lembrete no futuro: um alarme diário no celular ou evento repetido no calendário.

## Sessão 1 (continuação) — 06/11/2026 — Lembrete diário (v1.5.0) — removido na v1.5.1
- Como funciona: cada aparelho que liga o lembrete (⚙ → Lembrete diário) se inscreve no Web Push do navegador
  e grava a inscrição em `push_subscriptions` (RLS: só as próprias linhas). O pg_cron (`diario-lembretes`,
  a cada 5 min) chama a Edge Function `send-reminders`, que envia para quem chegou o horário (janela de 30 min),
  uma vez por dia (`last_sent`), e pula quem já escreveu no dia se `skip_if_written`. Inscrições mortas (404/410)
  são apagadas. Ao sair da conta, o lembrete do aparelho é desligado.
- Chaves VAPID: a **pública** está em `js/config.js` e na função; a **privada** NÃO está no repositório — vai só
  no segredo `VAPID_PRIVATE_KEY` da função (o usuário cola; Claude não digita chaves em formulários).
- A função foi publicada pelo editor do painel (cópia de `supabase/functions/send-reminders/index.ts`).
  Ela precisa de "Verify JWT" desligado porque o cron chama sem token; é seguro porque a função só envia
  lembretes que já estão na hora e não devolve dados.
- iPhone: só funciona com o app instalado na Tela de Início (iOS 16.4+); o app explica isso na tela.
- Service worker: eventos `push` (mostra a notificação com o ícone do sol) e `notificationclick` (abre o app).

## Sessão 1 (continuação) — 06/11/2026 — Bloqueio com PIN (v1.4.0)
- Usuário escolheu, entre as sugestões: **PIN** e **lembrete diário** (não quer gráfico de dor; resumo da semana
  "só se for de extra").
- `js/lock.js`: PIN de 4 a 6 números, guardado só no aparelho em `localStorage['diario.pin']` como hash
  PBKDF2-SHA256 (150 mil iterações, sal aleatório) — nunca o número. Comparação em tempo constante.
  5 erros → espera de 30 s, dobrando até 5 min (`diario.pinFails`).
- Tela de bloqueio com teclado numérico grande (76 px), bolinhas, tremida ao errar; funciona com teclado do PC.
  `js/theme.js` põe `html.locked` antes de desenhar a página, então o conteúdo nunca aparece antes do PIN.
- Bloqueia ao abrir o app e ao sair dele: "Sempre que sair do app" (padrão) ou depois de 1/5/15 min fora
  (`diario.lockDelay`). Antes de bloquear: salva, para ditado/leitura, fecha Configurações.
- Configurações → "Bloqueio com PIN": Criar / Trocar (pede o atual) / Remover (pede o atual).
- **Esqueci o PIN:** com conta → sai da conta neste aparelho (limpa dados locais) e remove o PIN; entra de novo
  com e-mail e senha e tudo volta da nuvem. Sem conta → só apagando as anotações do aparelho (avisa que é definitivo).
- Limitação honesta: protege contra quem pega o aparelho; os dados locais não são criptografados.
- Testado no navegador: criar, confirmar, bloquear ao recarregar e ao sair, PIN errado, espera após 5 erros,
  teclado físico, trocar, remover, esqueci o PIN.

## Sessão 1 (continuação) — 05/11/2026 — Ícone novo no PC (v1.3.2)
- No celular, reinstalar trocou o ícone; no PC (Windows) **não**, mesmo desinstalando — o navegador/Windows
  reaproveita o ícone guardado pelo mesmo endereço de arquivo.
- Solução: arquivos renomeados para `icons/sol.svg`, `sol-192.png`, `sol-512.png`, `sol-maskable-512.png`
  (manifest, index.html, sw.js e `tools/make-icons.mjs`). **Regra: ao mudar o desenho do ícone, mude também o
  nome dos arquivos**, senão os PCs continuam com o antigo.
- Mesmo assim o PC mostrava o antigo. Diagnóstico: o Chrome JÁ tinha o ícone novo
  (`...\Chrome\User Data\Default\Web Applications\Manifest Resources\hbknjjdmdbpahgnpoeljfolknmmpjmkm\Icons`
  e o `.ico` em `_crx_hbknjjdmdbpahgnpoeljfolknmmpjmkm\Meu Diário.ico`); os atalhos (Área de Trabalho e
  Menu Iniciar → Apps do Chrome) apontam para esse `.ico`. O que estava velho era o **cache de ícones do
  Windows** (mesmo caminho de arquivo). Atualizado com `ie4uinit.exe -show`; se não bastar, reiniciar o PC.
- Cuidado no Windows PowerShell 5.1: `Get-Content`/`Set-Content` estragam acentos (dupla codificação UTF-8).
  Para editar arquivos, use as ferramentas de edição ou Node, não Set-Content.

## Sessão 1 (continuação) — 05/11/2026 — Símbolo "sol no horizonte" (v1.3.1)
- Usuário perguntou por que uma planta; mostrei opções dentro do tema e ele escolheu o **sol no horizonte**,
  com o significado de **respiro** (pode ser no meio do dia, não só no fim).
- Ícone do app: meio sol pêssego sobre linha de horizonte cor de areia + duas linhas curtas (água calma), fundo sálvia.
- Topo e tela de login usam o mesmo desenho em SVG embutido (classes `.mark-sun`/`.mark-line`, sem estilo inline
  por causa do CSP). Login ganhou a frase "Um respiro no seu dia." Saudação da tarde: ☀️.

## Sessão 1 (continuação) — 05/11/2026 — Visual "Calmo e natural" + atualização confiável (v1.3.0)
- **Bug de atualização corrigido:** o usuário não via a versão nova. Causa: o GitHub Pages manda o navegador
  guardar os arquivos por 10 min (`Cache-Control: max-age=600`) e o service worker usava esse cache HTTP — a
  versão nova podia até ser instalada com CSS antigo. Agora: `install` usa `cache: 'reload'`, a busca usa
  `cache: 'no-cache'` (confere ETag), registro com `updateViaCache: 'none'`, `reg.update()` ao voltar para o app
  e recarga automática no `controllerchange` quando nada está sendo digitado/ditado.
- Usuário não gostou do "Noite aconchegante" → pediu a opção 2, **Calmo e natural**:
  areia `#f4f1ea`, sálvia `#5f7f6b`, pêssego `#e9b49a`; manchas suaves tipo aquarela no fundo; cartões brancos
  sem borda com sombra leve; editor num painel arredondado; humor como bolinha colorida nos cartões.
  Fontes: Nunito (interface e títulos) + Lora (texto do diário); Fraunces removida.
- Tema: chave `diario.theme3`, padrão "light" (Dia); opções Dia / Noite (floresta escura) / Seguir o aparelho.
- Ícone: folha cor de areia com sol pêssego em fundo sálvia. Saudação com 🌤️/🌿/🌙.
- ✅ Usuário confirmou: a atualização chegou nos aparelhos dele e **gostou do visual** (manter este estilo).

## Sessão 1 (continuação) — 05/11/2026 — Novo visual "Noite aconchegante" (v1.2.0) — substituído na v1.3.0
- Usuário achou o visual genérico; entre 3 propostas (caderno de papel / calmo e natural / noite aconchegante)
  escolheu **Noite aconchegante**.
- `css/styles.css` reescrito: céu azul-noite com brilhos suaves e estrelas (só CSS), âmbar `#f0b45a` como
  destaque e lilás `#a99cf0` para seleção/foco; cartões translúcidos; botões em pílula; humor com brilho.
  Cartões da lista com faixa colorida conforme o humor (`data-mood`). Tema claro "Amanhecer" (creme/lavanda).
- Fontes pelo jsDelivr (versões fixas, `@fontsource-variable`): **Fraunces** (títulos), **Lora** (texto do diário),
  **Nunito** (interface). CSP `font-src` liberado para jsdelivr; o service worker guarda as fontes (offline).
- Tema: padrão agora é "dark" (Noite). Preferência mudou de chave para `diario.theme2` (para todos começarem no
  visual novo); opções: Noite / Amanhecer / Seguir o aparelho (`data-theme="auto"`).
- Tela inicial com saudação pela hora (Bom dia/Boa tarde/Boa noite + ícone).
- Ícone novo: lua crescente âmbar com estrelas lilás (`icons/icon.svg` + `tools/make-icons.mjs`).
- Conferido no navegador: PC e celular, Noite e Amanhecer, configurações; sem erros no console.

## Sessão 1 (continuação) — 05/11/2026 — Sincronização em tempo real (v1.1.0)
- Usuário testou: sincronização entre aparelhos ✅ e ditado no celular ✅. Pediu que fosse em tempo real
  (antes dependia do timer de 60 s ou de reabrir o app).
- Supabase: tabela `entries` adicionada à publicação `supabase_realtime` (também no `schema.sql`, idempotente).
- `js/sync.js`: assina `postgres_changes` da tabela; cada aviso só agenda uma sincronização normal (400 ms) —
  o pull continua sendo a única fonte de verdade. Ao (re)conectar o canal, sincroniza também. `stop()` remove o canal.
  O RLS vale para o Realtime: cada usuário só recebe avisos das próprias linhas.
- Testado: conexão Realtime com a chave publishable aceita; novo teste 11 em `tests/sync.test.mjs` (11/11 passando).
- Atraso esperado: ~2–3 s (700 ms para salvar + 1,5 s para enviar + aviso + baixar).

## Sessão 1 (continuação) — 05/11/2026 — Nuvem conectada (v1.0.1)
- Usuário criou o projeto Supabase (região us-east-1, não São Paulo — funciona igual, só um pouco mais de latência).
- Via Claude in Chrome: schema rodado no SQL Editor (aviso de "operações destrutivas" é só pelos `drop ... if exists`),
  Site URL e Redirect URLs configuradas, chave publishable copiada para `js/config.js`.
- Se o usuário já tinha escrito no modo "só neste aparelho", essas anotações sobem ao entrar na conta
  (não há `uid` anterior salvo, então nada é apagado).

## Sessão 1 (continuação) — 04/11/2026 — Publicação
- Login no GitHub CLI (dica: `gh auth login --web` no terminal do app travava esperando Enter; rodar com
  `echo "" | gh auth login ... --web` em segundo plano funcionou — basta o usuário digitar o código no navegador).
- Criado repositório público `andresonrfl-eng/meu-diario` (público porque GitHub Pages grátis exige;
  os textos ficam no Supabase, não no GitHub) e ativado GitHub Pages na branch `main`, pasta `/`.

## Sessão 1 — 04/11/2026 — Criação do app

**Pedido:** diário online (recomendado pela psicóloga), com banco de dados e servidor na nuvem,
sincronizando celular/tablet/PC. Usuário tem dor cervical e não pode flexionar muito o pescoço.

**Decisões:**
- **PWA** (site instalável) em vez de app de loja: um só código para Android, iPhone, tablet e PC, sem custo.
- **Supabase** (PostgreSQL + autenticação, plano grátis) como servidor/banco. Segurança por **RLS**:
  cada usuário só acessa as próprias linhas.
- **GitHub Pages** para hospedar (grátis, HTTPS — necessário para microfone e service worker).
- **Offline-first**: tudo é salvo primeiro no IndexedDB do aparelho e sincronizado depois.
- Sem build/bundler: arquivos estáticos simples, fáceis de manter.

**O que foi feito:**
- Interface responsiva (lista + editor no PC; telas separadas no celular com botão voltar e suporte
  ao "voltar" do Android). Tema claro/escuro automático.
- Editor com salvamento automático (700 ms), título opcional, humor 1–5, busca sem acento.
- **Ditado por voz** (Web Speech API, pt-BR) com comandos de pontuação e maiúsculas automáticas;
  no Android reinicia a cada frase (evita frases repetidas, bug conhecido do Chrome Android).
- **Leitura em voz alta** dividindo o texto em trechos curtos (Chrome corta falas longas).
- Tamanho de texto ajustável, lembrete de pausa para o pescoço, exportação .txt/.json.
- Login/cadastro/esqueci a senha/criar nova senha (Supabase Auth); opção "continuar sem conta".
- Sincronização (`js/sync.js`): envia pendentes (upsert em lotes de 100) e baixa alterações por
  `updated_at` (definido pelo servidor), páginas de 500, margem de 2 min para não perder gravações
  simultâneas. Exclusão vira "marcador" que apaga o texto no servidor.
- Service worker: rede primeiro (timeout 4 s) com cópia offline; biblioteca do Supabase em cache.
- Ícones gerados por script (`tools/make-icons.mjs`), manifest para instalação.
- `supabase/schema.sql`: tabela `entries`, índices, trigger (updated_at do servidor, user_id imutável,
  texto apagado ao excluir), RLS + políticas, acesso revogado para anônimos.
- Testes automatizados da sincronização (`npm test`, 10 cenários) — todos passando.

**Revisão detalhada — problemas encontrados e corrigidos:**
1. **Perda de edição durante o envio**: se o texto fosse editado enquanto subia para a nuvem, podia ser
   marcado como enviado sem ter sido. → controle por versão (`rev`) + gravação em fila.
2. **Duas abas/janelas abertas** (ex.: app instalado + navegador) podiam gerar a mesma versão e perder
   texto. → `rev` agora é um identificador único por gravação + aviso entre abas (BroadcastChannel).
3. **Sair da conta** com sincronização em andamento podia trazer anotações de volta após limpar o
   aparelho. → sincronização é parada e concluída antes da limpeza.
4. **Celular**: título longo deixava a página mais larga que a tela (rolagem lateral). → corrigido no CSS.
5. Marcação "ainda não enviada" não sumia após sincronizar. → atualização dos indicadores após cada sync.
6. Aviso "Atualizado de outro aparelho" aparecia após cada envio próprio. → só avisa se o texto mudou.
7. Regex com *lookbehind* quebraria o app inteiro em iPhones antigos (iOS < 16.4). → reescrito.
8. Leitura em voz alta: erro no meio do texto deixava o botão no estado errado. → tratado.
9. Service worker: aviso de erro não tratado quando offline. → tratado.

**Limitações conhecidas:**
- Ditado embutido depende do navegador (Chrome/Edge/Safari ok; Firefox não). Alternativa: microfone do teclado.
- Conflito entre dois aparelhos editando a MESMA anotação ao mesmo tempo: vence a última enviada.
- Precisa de iOS 15.4+ (uso de `<dialog>`).
