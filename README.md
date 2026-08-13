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
