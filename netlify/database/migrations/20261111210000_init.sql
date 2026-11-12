CREATE TABLE users (
  email TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE auth_fail (
  email TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'diagnostico',
  ficha JSONB NOT NULL DEFAULT '{}',
  rev BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);
CREATE TABLE assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  data DATE NOT NULL DEFAULT CURRENT_DATE,
  questionario JSONB NOT NULL,
  respostas JSONB NOT NULL DEFAULT '{}',
  concluido BOOLEAN NOT NULL DEFAULT FALSE,
  rev BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);
CREATE INDEX assessments_client ON assessments(client_id);
