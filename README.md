# Sistema TODAI

Ficha do cliente, diagnóstico de maturidade da gestão (questionário MPE Brasil), resultado e apresentação.

- `public/` — interface (HTML, CSS e JavaScript sem etapa de build). `score.js` contém o cálculo da nota.
- `lib/api.mjs` — API (autenticação, clientes, avaliações, questionário).
- `netlify/functions/api.mjs` — função Netlify que expõe a API em `/api/*`.
- `netlify/database/migrations/` — estrutura do banco (Netlify Database / Postgres).
- `scripts/test.mjs` — teste do cálculo (`npm test`). `scripts/dev.mjs` — servidor local (`DATABASE_URL=... npm run dev`).

Variáveis de ambiente no Netlify: `SESSION_SECRET`, `SETUP_CODE`, `ALLOWED_USERS` (`email:Nome,email:Nome`).
