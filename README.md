# Meu Diário

Diário pessoal online. Funciona no **celular, tablet e computador**, com as anotações guardadas na nuvem e sincronizadas entre todos os aparelhos.

**Abrir o app:** <https://andresonrfl-eng.github.io/meu-diario/>

Foi pensado para quem precisa **poupar o pescoço** (síndrome dolorosa miofascial cervical):

- **🎤 Ditar**: fale em vez de digitar e segure o aparelho na altura dos olhos. Diga "vírgula", "ponto final", "ponto de interrogação" ou "nova linha" para pontuar.
- **🔊 Ouvir**: o app lê a anotação em voz alta, sem precisar olhar para a tela.
- **Texto grande** e ajustável (A− / A+), tema claro/escuro.
- **Lembrete de pausa** opcional (a cada 15/20/30/45 min de escrita).
- **Tela cheia** no computador: ☰ ou `Ctrl+B` esconde a lista de anotações.
- **IA no próprio computador** (PC com placa de vídeo compatível): ditado com Whisper e botão **✨ Corrigir**, que mostra o antes e depois. Sua voz e seu texto não saem da máquina; os modelos (3,6 GB) ficam numa pasta que você escolhe.

Outros recursos:

- Funciona **sem internet** e envia tudo quando a conexão volta.
- Salva sozinho enquanto você escreve.
- Humor do dia (😢 a 😄), busca e cópia de segurança (.txt / .json).
- Pode ser **instalado como aplicativo** na tela inicial.
- Cada pessoa só enxerga as próprias anotações (Row Level Security no banco).

---

## Como funciona (resumo técnico)

| Parte | Tecnologia |
|---|---|
| App (interface) | HTML + CSS + JavaScript puro, sem etapa de build. PWA (service worker + manifest). |
| Banco no aparelho | IndexedDB (funciona offline). |
| Servidor / banco na nuvem | [Supabase](https://supabase.com) (PostgreSQL + login por e-mail). Plano gratuito. |
| Hospedagem do app | GitHub Pages (gratuito). |

Arquivos principais: `index.html`, `css/styles.css`, `js/app.js` (interface), `js/db.js` (banco local),
`js/sync.js` (sincronização), `js/voice.js` (ditado e leitura), `js/config.js` (chaves da nuvem),
`sw.js` (offline), `supabase/schema.sql` (estrutura do banco). Histórico de mudanças em [HISTORICO.md](HISTORICO.md).

---

## Passo a passo para ativar a nuvem (feito uma única vez)

### 1. Criar o banco no Supabase
1. Crie uma conta gratuita em <https://supabase.com> e clique em **New project**.
   - Nome: `meu-diario` · Região: **South America (São Paulo)** · crie e guarde uma senha forte do banco.
2. No menu da esquerda, abra **SQL Editor → New query**, cole todo o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) e clique em **Run**.
3. Em **Authentication → URL Configuration**:
   - **Site URL**: `https://andresonrfl-eng.github.io/meu-diario/`
   - **Redirect URLs**: adicione o mesmo endereço (e `http://localhost:5173/` se quiser testar no computador).
4. Em **Project Settings → API** (ou **API Keys**), copie:
   - **Project URL** (ex.: `https://abcd1234.supabase.co`)
   - a chave **anon** / **publishable** (pública). **Nunca** use a `service_role` / `secret`.

### 2. Colocar as chaves no app
Abra [`js/config.js`](js/config.js) e preencha `SUPABASE_URL` e `SUPABASE_ANON_KEY`
(ou peça ao Claude Code: "configure o Supabase com a URL X e a chave Y").
Depois **aumente a versão** em `sw.js` (`CACHE = 'diario-v…'`) e publique.

### 3. Usar
Abra o endereço do app, toque em **Criar conta**, confirme pelo e-mail e entre.
Faça o mesmo login no celular, tablet e computador.

### Instalar na tela inicial
- **Android (Chrome)**: menu ⋮ → **Instalar app** / **Adicionar à tela inicial**.
- **iPhone/iPad (Safari)**: botão Compartilhar → **Adicionar à Tela de Início**.
- **Computador (Chrome/Edge)**: ícone de instalar na barra de endereço.

---

## Rodar no computador (desenvolvimento)

```bash
npm install     # só para os testes
npm start       # abre em http://localhost:5173
npm test        # testes da sincronização + simulação de 2 aparelhos
```

## Manutenção automática (não precisa fazer nada)
- **Banco sempre acordado:** o plano grátis do Supabase pausa o projeto após 7 dias sem uso. O GitHub
  (aba **Actions → Manter o Supabase acordado**) dá um "toque" a cada 3 dias. Se um dia ele falhar, o GitHub
  manda um e-mail; aí basta reativar o projeto em supabase.com/dashboard.
- **Atualizações:** o app se atualiza sozinho quando há versão nova.
- **Cópia de segurança:** uma vez por mês o app sugere baixar uma cópia (um toque).

## Se algo der errado
- **Aparece "Sem internet — salvo no aparelho":** tudo bem, o texto está guardado e sobe quando a conexão voltar.
- **Aparece "Erro ao sincronizar" por muito tempo:** abra ⚙ → **Sincronizar agora**. Se continuar, o projeto do
  Supabase pode ter sido pausado (reative no painel) — suas anotações continuam no aparelho.
- **Uma anotação aparece duplicada com "(versão de outro aparelho)":** ela foi editada em dois aparelhos ao mesmo
  tempo; o app guardou as duas versões para nada se perder. Junte o que quiser e exclua a que sobrar.
- **Esqueceu o PIN:** na tela do PIN, "Esqueci o PIN" → sai da conta naquele aparelho; entre de novo com e-mail e senha.
- **Esqueceu a senha:** na tela de login, digite o e-mail e toque em "Esqueci minha senha".

## Privacidade
- O texto fica no seu aparelho (IndexedDB) e no seu projeto Supabase. Só você (logado) tem acesso — o acesso é bloqueado no próprio banco por RLS.
- Ao excluir uma anotação, o texto é apagado também na nuvem.
- Faça de vez em quando uma cópia em **Configurações → Cópia de segurança** (o app lembra você).
