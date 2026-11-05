# Histórico do projeto — Meu Diário

Registro de cada sessão de trabalho (mais recente no topo). Serve para que qualquer nova sessão
do Claude Code saiba o que já foi feito. **Atualize ao final de cada sessão.**

---

## Situação atual (resumo rápido)
- **Versão:** 1.0.0 (`APP_VERSION` em `js/app.js`, `CACHE = 'diario-v1.0.0'` em `sw.js`)
- **App:** pronto e testado localmente (modo "só neste aparelho").
- **Nuvem (Supabase):** ⏳ **ainda não configurada** — `js/config.js` está vazio. O usuário precisa criar a
  conta/projeto no Supabase (passo a passo no README) e passar a URL + chave pública.
- **GitHub:** repositório público <https://github.com/andresonrfl-eng/meu-diario> (branch `main`).
  GitHub CLI logado como `andresonrfl-eng` (gh em `C:\Program Files\GitHub CLI\gh.exe`).
- **Endereço do app (GitHub Pages):** <https://andresonrfl-eng.github.io/meu-diario/> — publica sozinho a cada `git push`.

### Pendências
1. ~~Login no GitHub CLI → criar repositório e ativar GitHub Pages.~~ ✅ feito
2. Usuário criar projeto no Supabase → rodar `supabase/schema.sql` → configurar Site URL/Redirect URLs
   com o endereço do GitHub Pages → preencher `js/config.js` → subir versão do cache → publicar.
3. Testar login, sincronização real entre dois aparelhos, ditado no celular do usuário.

### Ideias para o futuro (não feitas)
- Criptografia de ponta a ponta (senha extra que nem o servidor conhece). Risco: esqueceu a senha = perdeu tudo.
- Bloqueio do app com PIN/biometria.
- Lembrete diário para escrever (notificação).
- Gráfico do humor ao longo do tempo (útil para levar à psicóloga).
- Importar backup .json.
- Exportar em PDF para mostrar na consulta.

---

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
