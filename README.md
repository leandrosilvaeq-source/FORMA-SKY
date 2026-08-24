# Forma Sky

Plataforma operacional da Forma 3D Studio, com a assistente virtual **Sky**.

A especificação completa do projeto está em [`docs/`](docs):

- [`docs/01_ESPECIFICACAO_FUNCIONAL.md`](docs/01_ESPECIFICACAO_FUNCIONAL.md)
- [`docs/02_ESPECIFICACAO_TECNICA.md`](docs/02_ESPECIFICACAO_TECNICA.md)
- [`docs/03_MODELO_BANCO_DADOS.md`](docs/03_MODELO_BANCO_DADOS.md)
- [`docs/04_PLANO_IMPLEMENTACAO.md`](docs/04_PLANO_IMPLEMENTACAO.md)

## Stack

- **Frontend:** React + Vite + TypeScript, Tailwind CSS, shadcn/ui
- **Backend:** Supabase Edge Functions (a partir do Bloco 6)
- **Banco de dados:** PostgreSQL via Supabase
- **Arquivos:** Google Drive (referenciado por metadados no banco)
- **Testes:** Vitest + Testing Library
- **Lint/format:** ESLint + Prettier

## Estrutura de pastas

```text
FORMA-SKY/
├── docs/            especificações do projeto
├── frontend/        aplicação React + Vite
├── backend/         Edge Functions e regras de negócio (a partir do Bloco 6)
├── database/        seeds e scripts auxiliares de banco
├── integrations/    integrações externas isoladas (OpenAI, Drive, Instagram, etc.)
└── supabase/        configuração da Supabase CLI e migrations (supabase/migrations)
```

> As migrations oficiais do banco ficam em `supabase/migrations`, para que a
> Supabase CLI as reconheça e aplique diretamente (`supabase db push`).

## Como rodar o frontend localmente

```bash
cd frontend
npm install
cp .env.example .env.local   # preencher com URL e publishable key do projeto Supabase
npm run dev
```

### Scripts disponíveis (`frontend/`)

| Script                 | Descrição                          |
| ---------------------- | ----------------------------------- |
| `npm run dev`           | Servidor de desenvolvimento         |
| `npm run build`         | Build de produção (`tsc` + Vite)    |
| `npm run preview`       | Pré-visualiza o build de produção   |
| `npm run lint`          | ESLint                              |
| `npm run format`        | Formata os arquivos com Prettier    |
| `npm run format:check`  | Verifica formatação sem alterar     |
| `npm run test`          | Roda os testes (Vitest) uma vez     |
| `npm run test:watch`    | Roda os testes em modo watch        |

## Deploy do frontend (Vercel)

O frontend está configurado para deploy na Vercel (`frontend/vercel.json`), mas
**ainda não há uma URL pública verificada** — a configuração abaixo prepara o
projeto; a criação do projeto na Vercel e a autenticação da CLI continuam
sendo um passo manual, feito uma única vez por quem tem acesso à conta.

- **Root Directory:** `frontend`
- **Framework preset:** Vite
- **Install Command:** `npm ci` (usa `frontend/package-lock.json`)
- **Build Command:** `npm run build`
- **Output Directory:** `dist`
- **Node.js:** >= 20.19 (exigido pelo Vite 8 — ver `"engines"` em `frontend/package.json`)
- **SPA fallback:** `frontend/vercel.json` reescreve toda rota para
  `/index.html`, necessário porque o app usa `react-router-dom` com
  `BrowserRouter` (rotas como `/estoque/acessorios` precisam funcionar em
  acesso direto/refresh, não só em navegação client-side).

### Variáveis de ambiente na Vercel

Configurar como **Environment Variables** do projeto na Vercel (nunca no
Git), com os mesmos nomes já usados por `frontend/.env.local`:

| Nome | Conteúdo |
| --- | --- |
| `VITE_SUPABASE_URL` | URL pública do projeto Supabase (`https://tjhacqreupfqefntjevf.supabase.co`) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Chave publishable/anon (pública, protegida por RLS) |

Nunca configurar `SUPABASE_SERVICE_ROLE_KEY` (ou qualquer secret key) neste
projeto Vercel — o frontend nunca deve ter acesso a uma chave de service
role; ela só existe no ambiente das Edge Functions.

### Procedimento (preview e produção)

```bash
cd frontend
vercel login                 # uma vez, autentica a CLI (fluxo interativo/navegador)
vercel link                  # associa esta pasta a um projeto Vercel (Root Directory = frontend)
vercel                       # deploy de preview da branch atual
vercel --prod                # promove para produção — só depois de validação/aprovação
```

Alternativa: conectar o repositório GitHub à Vercel pela própria interface
web (Import Project) — nesse modo, cada push passa a gerar preview
automaticamente, e a branch de produção é escolhida explicitamente nas
configurações do projeto (não é decidida por este README).

## Banco de dados (Supabase)

O projeto Supabase já está criado e vinculado via CLI (`supabase link`), na
região São Paulo (`sa-east-1`), com autenticação por e-mail/senha e
confirmação de e-mail desativada.

Migrations ficam em `supabase/migrations/` e devem ser aplicadas com:

```bash
npx supabase db push
```

Nenhum segredo deve ser commitado. Consulte `.env.example` (raiz) e
`frontend/.env.example` para saber quais variáveis são necessárias.

## Filosofia de desenvolvimento

O desenvolvimento segue o plano de implementação incremental descrito em
`docs/04_PLANO_IMPLEMENTACAO.md`: cada bloco é revisado, implementado,
testado, demonstrado e só então versionado antes de avançar para o próximo.
