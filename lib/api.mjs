// API do sistema TODAI. Função pura: recebe Request e um pg.Pool, devolve Response.
import crypto from "node:crypto";
import QUESTIONARIO_PADRAO from "./questionario.json" with { type: "json" };
import EXEMPLO from "./exemplo.json" with { type: "json" };

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
const erro = (status, msg) => json({ erro: msg }, status);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (b) => Buffer.from(b).toString("base64url");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cfg() {
  const secret = process.env.SESSION_SECRET, code = process.env.SETUP_CODE;
  if (!secret || secret.length < 32 || !code || code.length < 12) throw new Error("config");
  const users = new Map();
  for (const item of (process.env.ALLOWED_USERS || "").split(",")) {
    const [email, nome] = item.split(":").map((s) => s.trim());
    if (email) users.set(email.toLowerCase(), nome || email);
  }
  return { secret, code, users };
}
const igual = (a, b) => {
  const x = crypto.createHash("sha256").update(String(a)).digest(), y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};
function hashSenha(senha, salt = crypto.randomBytes(16)) {
  const h = crypto.scryptSync(senha, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${b64(salt)}$${b64(h)}`;
}
function confereSenha(senha, guardado) {
  const [, s, h] = guardado.split("$");
  const calc = crypto.scryptSync(senha, Buffer.from(s, "base64url"), 64, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(calc, Buffer.from(h, "base64url"));
}
const DIAS = 30;
function criaSessao(email, secret) {
  const p = b64(JSON.stringify({ e: email, x: Date.now() + DIAS * 864e5 }));
  return `${p}.${crypto.createHmac("sha256", secret).update(p).digest("base64url")}`;
}
function leSessao(req, c) {
  const m = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.get("cookie") || "");
  if (!m) return null;
  const [p, sig] = m[1].split(".");
  if (!p || !sig || !igual(sig, crypto.createHmac("sha256", c.secret).update(p).digest("base64url"))) return null;
  try {
    const d = JSON.parse(Buffer.from(p, "base64url").toString());
    if (d.x < Date.now() || !c.users.has(d.e)) return null;
    return { email: d.e, nome: c.users.get(d.e) };
  } catch { return null; }
}
const cookie = (v, maxAge) => `sid=${v}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

const STATUS = ["diagnostico", "proposta", "contrato", "encerrado"];
const CLIENTE_COLS = "id, nome, status, ficha, rev, created_at, updated_at, updated_by";
const AVAL_META = "id, client_id, titulo, data::text AS data, concluido, rev, updated_at, updated_by";

function validaQuestionario(q) {
  if (!q || !Array.isArray(q.criterios) || !q.criterios.length || !Array.isArray(q.faixas) || !q.faixas.length) return "Estrutura inválida.";
  const ids = new Set();
  for (const c of q.criterios) {
    if (!c.id || !c.nome || !(Number(c.pontos) > 0)) return `Critério inválido: ${c.nome || "?"}`;
    if (!Array.isArray(c.fatores) || c.fatores.length !== 4 || c.fatores.some((f) => !(f >= 0 && f <= 1))) return `Fatores inválidos em ${c.nome}.`;
    if (!Array.isArray(c.perguntas)) return `Perguntas inválidas em ${c.nome}.`;
    for (const p of c.perguntas) {
      if (!p.id || ids.has(p.id)) return `Identificador de pergunta repetido ou ausente em ${c.nome}.`;
      ids.add(p.id);
      if (!p.texto || !Array.isArray(p.opcoes) || p.opcoes.length !== 4) return `Pergunta incompleta em ${c.nome}.`;
    }
  }
  return null;
}

export async function handle(req, pool) {
  let c;
  try { c = cfg(); } catch { return erro(500, "Servidor sem configuração de acesso."); }
  const url = new URL(req.url);
  const partes = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const m = req.method;
  const q = (text, params) => pool.query(text, params);

  if (m !== "GET") {
    const origem = req.headers.get("origin");
    if (origem && new URL(origem).host !== (req.headers.get("x-forwarded-host") || req.headers.get("host") || url.host)) return erro(403, "Origem não permitida.");
    if (!(req.headers.get("content-type") || "").includes("application/json")) return erro(415, "Formato não aceito.");
  }
  let body = {};
  if (m !== "GET") { try { body = await req.json(); } catch { return erro(400, "JSON inválido."); } }

  // ---------- autenticação ----------
  if (partes[0] === "auth") {
    if (partes[1] === "logout" && m === "POST") return json({ ok: true }, 200, { "set-cookie": cookie("", 0) });
    const email = String(body.email || "").trim().toLowerCase(), senha = String(body.senha || "");
    if (m !== "POST" || !email) return erro(400, "Requisição inválida.");
    const { rows: f } = await q("SELECT count(*)::int AS n FROM auth_fail WHERE email=$1 AND at > now() - interval '15 minutes'", [email]);
    if (f[0].n >= 8) return erro(429, "Muitas tentativas. Aguarde 15 minutos.");
    const falha = async (msg) => { await q("INSERT INTO auth_fail(email) VALUES($1)", [email]); await sleep(500); return erro(401, msg); };
    if (partes[1] === "definir-senha") {
      if (!c.users.has(email) || !igual(String(body.codigo || ""), c.code)) return falha("E-mail ou código de acesso inválido.");
      if (senha.length < 10) return erro(400, "A senha precisa ter ao menos 10 caracteres.");
      await q("INSERT INTO users(email,nome,pass_hash) VALUES($1,$2,$3) ON CONFLICT(email) DO UPDATE SET pass_hash=EXCLUDED.pass_hash", [email, c.users.get(email), hashSenha(senha)]);
      await q("DELETE FROM auth_fail WHERE email=$1", [email]);
      return json({ email, nome: c.users.get(email) }, 200, { "set-cookie": cookie(criaSessao(email, c.secret), DIAS * 86400) });
    }
    if (partes[1] === "login") {
      const { rows } = await q("SELECT pass_hash FROM users WHERE email=$1", [email]);
      if (!c.users.has(email) || !rows.length || !confereSenha(senha, rows[0].pass_hash)) return falha("E-mail ou senha inválidos.");
      await q("DELETE FROM auth_fail WHERE email=$1", [email]);
      return json({ email, nome: c.users.get(email) }, 200, { "set-cookie": cookie(criaSessao(email, c.secret), DIAS * 86400) });
    }
    return erro(404, "Não encontrado.");
  }

  const user = leSessao(req, c);
  if (!user) return erro(401, "Sessão expirada.");
  if (partes[0] === "me" && m === "GET") return json(user);

  const questionarioAtual = async () => {
    const { rows } = await q("SELECT value FROM settings WHERE key='questionario'");
    return rows.length ? rows[0].value : QUESTIONARIO_PADRAO;
  };

  // ---------- configuração ----------
  if (partes[0] === "questionario") {
    if (m === "GET") return json({ questionario: await questionarioAtual(), padrao: partes[1] === "padrao" ? QUESTIONARIO_PADRAO : undefined });
    if (m === "PUT") {
      const novo = body.questionario, e = validaQuestionario(novo);
      if (e) return erro(400, e);
      novo.versao = (Number((await questionarioAtual()).versao) || 1) + 1;
      await q("INSERT INTO settings(key,value) VALUES('questionario',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()", [JSON.stringify(novo)]);
      return json({ questionario: novo });
    }
  }

  // ---------- clientes ----------
  if (partes[0] === "clientes") {
    const id = partes[1];
    if (!id) {
      if (m === "GET") {
        const { rows } = await q(`SELECT c.id, c.nome, c.status, c.updated_at, c.updated_by, c.ficha->>'produto' AS produto,
          (SELECT count(*)::int FROM assessments a WHERE a.client_id=c.id) AS avaliacoes FROM clients c ORDER BY c.updated_at DESC`);
        return json({ clientes: rows });
      }
      if (m === "POST") {
        const nome = String(body.nome || "").trim();
        if (!nome) return erro(400, "Informe o nome do cliente.");
        const ex = body.exemplo === true;
        const { rows } = await q(`INSERT INTO clients(nome, ficha, updated_by) VALUES($1,$2,$3) RETURNING id`, [nome, JSON.stringify(ex ? EXEMPLO.ficha : {}), user.nome]);
        await q(`INSERT INTO assessments(client_id,titulo,questionario,respostas,updated_by) VALUES($1,'Diagnóstico inicial',$2,$3,$4)`,
          [rows[0].id, JSON.stringify(await questionarioAtual()), JSON.stringify(ex ? EXEMPLO.respostas : {}), user.nome]);
        return json({ id: rows[0].id }, 201);
      }
    }
    if (!UUID.test(id || "")) return erro(404, "Não encontrado.");
    if (partes[2] === "avaliacoes" && m === "POST") {
      let resp = {}, quest = await questionarioAtual();
      if (body.copiarDe) {
        if (!UUID.test(body.copiarDe)) return erro(400, "Origem inválida.");
        const { rows } = await q("SELECT questionario, respostas FROM assessments WHERE id=$1 AND client_id=$2", [body.copiarDe, id]);
        if (!rows.length) return erro(404, "Avaliação de origem não encontrada.");
        resp = rows[0].respostas; quest = rows[0].questionario;
      }
      const { rows } = await q(`INSERT INTO assessments(client_id,titulo,questionario,respostas,updated_by) VALUES($1,$2,$3,$4,$5) RETURNING id`,
        [id, String(body.titulo || "Reavaliação").slice(0, 120), JSON.stringify(quest), JSON.stringify(resp), user.nome]);
      await q("UPDATE clients SET rev=rev+1 WHERE id=$1", [id]);
      return json({ id: rows[0].id }, 201);
    }
    if (m === "GET") {
      const { rows } = await q(`SELECT ${CLIENTE_COLS} FROM clients WHERE id=$1`, [id]);
      if (!rows.length) return erro(404, "Cliente não encontrado.");
      if (url.searchParams.get("rev") === String(rows[0].rev)) return json({ inalterado: true });
      const { rows: av } = await q(`SELECT ${AVAL_META} FROM assessments WHERE client_id=$1 ORDER BY created_at`, [id]);
      return json({ cliente: rows[0], avaliacoes: av });
    }
    if (m === "PATCH") {
      const sets = ["rev=rev+1", "updated_at=now()", "updated_by=$2"], params = [id, user.nome];
      if (typeof body.nome === "string" && body.nome.trim()) { params.push(body.nome.trim().slice(0, 200)); sets.push(`nome=$${params.length}`); }
      if (STATUS.includes(body.status)) { params.push(body.status); sets.push(`status=$${params.length}`); }
      if (body.ficha && typeof body.ficha === "object" && !Array.isArray(body.ficha)) { params.push(JSON.stringify(body.ficha)); sets.push(`ficha=ficha || $${params.length}::jsonb`); }
      const { rows } = await q(`UPDATE clients SET ${sets.join(", ")} WHERE id=$1 RETURNING rev, updated_at, updated_by`, params);
      return rows.length ? json(rows[0]) : erro(404, "Cliente não encontrado.");
    }
    if (m === "DELETE") { await q("DELETE FROM clients WHERE id=$1", [id]); return json({ ok: true }); }
  }

  // ---------- avaliações ----------
  if (partes[0] === "avaliacoes" && UUID.test(partes[1] || "")) {
    const id = partes[1];
    if (m === "GET") {
      const { rows } = await q(`SELECT ${AVAL_META}, questionario, respostas FROM assessments WHERE id=$1`, [id]);
      if (!rows.length) return erro(404, "Avaliação não encontrada.");
      if (url.searchParams.get("rev") === String(rows[0].rev)) return json({ inalterado: true });
      return json({ avaliacao: rows[0] });
    }
    if (m === "PATCH") {
      const sets = ["rev=rev+1", "updated_at=now()", "updated_by=$2"], params = [id, user.nome];
      if (typeof body.titulo === "string" && body.titulo.trim()) { params.push(body.titulo.trim().slice(0, 120)); sets.push(`titulo=$${params.length}`); }
      if (/^\d{4}-\d{2}-\d{2}$/.test(body.data || "")) { params.push(body.data); sets.push(`data=$${params.length}`); }
      if (typeof body.concluido === "boolean") { params.push(body.concluido); sets.push(`concluido=$${params.length}`); }
      if (body.respostas && typeof body.respostas === "object" && !Array.isArray(body.respostas)) { params.push(JSON.stringify(body.respostas)); sets.push(`respostas=respostas || $${params.length}::jsonb`); }
      if (body.atualizarQuestionario === true) { params.push(JSON.stringify(await questionarioAtual())); sets.push(`questionario=$${params.length}`); }
      const { rows } = await q(`UPDATE assessments SET ${sets.join(", ")} WHERE id=$1 RETURNING rev, updated_at, updated_by, client_id`, params);
      if (!rows.length) return erro(404, "Avaliação não encontrada.");
      await q("UPDATE clients SET rev=rev+1, updated_at=now(), updated_by=$2 WHERE id=$1", [rows[0].client_id, user.nome]);
      return json(rows[0]);
    }
    if (m === "DELETE") {
      const { rows } = await q("SELECT client_id, (SELECT count(*)::int FROM assessments b WHERE b.client_id=a.client_id) AS n FROM assessments a WHERE id=$1", [id]);
      if (!rows.length) return erro(404, "Avaliação não encontrada.");
      if (rows[0].n <= 1) return erro(400, "O cliente precisa manter ao menos uma avaliação.");
      await q("DELETE FROM assessments WHERE id=$1", [id]);
      await q("UPDATE clients SET rev=rev+1 WHERE id=$1", [rows[0].client_id]);
      return json({ ok: true });
    }
  }
  return erro(404, "Não encontrado.");
}
