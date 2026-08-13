# Forma Sky — Frontend

Aplicação React + Vite + TypeScript do sistema Forma Sky.

Consulte o [README principal](../README.md) para visão geral do projeto,
stack e documentação funcional/técnica.

## Setup

```bash
npm install
cp .env.example .env.local   # preencher com URL e publishable key do projeto Supabase
npm run dev
```

## Scripts

| Script                 | Descrição                         |
| ---------------------- | --------------------------------- |
| `npm run dev`          | Servidor de desenvolvimento       |
| `npm run build`        | Build de produção (`tsc` + Vite)  |
| `npm run preview`      | Pré-visualiza o build de produção |
| `npm run lint`         | ESLint                            |
| `npm run format`       | Formata os arquivos com Prettier  |
| `npm run format:check` | Verifica formatação sem alterar   |
| `npm run test`         | Roda os testes (Vitest) uma vez   |
| `npm run test:watch`   | Roda os testes em modo watch      |

## Estrutura

```text
src/
├── components/
│   ├── layout/       layout autenticado (AppLayout)
│   ├── ui/           componentes shadcn/ui
│   └── ProtectedRoute.tsx
├── context/
│   └── AuthContext.tsx   sessão Supabase Auth (e-mail/senha)
├── lib/
│   ├── supabase.ts   cliente supabase-js
│   └── utils.ts
├── pages/
│   ├── LoginPage.tsx
│   └── HomePage.tsx
└── test/
    └── setup.ts
```
