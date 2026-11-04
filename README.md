# Meu Diário

Diário pessoal online. Funciona no **celular, tablet e computador**, com as anotações guardadas na nuvem e sincronizadas entre todos os aparelhos.

Foi pensado para quem precisa **poupar o pescoço** (síndrome dolorosa miofascial cervical):

- **🎤 Ditar**: fale em vez de digitar e segure o aparelho na altura dos olhos. Diga "vírgula", "ponto final", "ponto de interrogação" ou "nova linha" para pontuar.
- **🔊 Ouvir**: o app lê a anotação em voz alta, sem precisar olhar para a tela.
- **Texto grande** e ajustável (A− / A+), tema claro/escuro.
- **Lembrete de pausa** opcional (a cada 15/20/30/45 min de escrita).

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
   - **Site URL**: o endereço do app no GitHub Pages (ex.: `https://SEU-USUARIO.github.io/meu-diario/`).
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
npm test        # testes da sincronização
```

## Privacidade
- O texto fica no seu aparelho (IndexedDB) e no seu projeto Supabase. Só você (logado) tem acesso — o acesso é bloqueado no próprio banco por RLS.
- Ao excluir uma anotação, o texto é apagado também na nuvem.
- Faça de vez em quando uma cópia em **Configurações → Cópia de segurança**.
