import { calcular, LETRAS } from "./score.js";

// ---------- utilitários ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const h = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = (v, d = 0) => (v === null || v === undefined || !isFinite(v) ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }));
const brl = (v) => (v === null || v === undefined || !isFinite(v) ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }));
const pct = (v, d = 0) => (v === null || v === undefined || !isFinite(v) ? "—" : nf(v * 100, d) + "%");
const num = (v) => {
  if (typeof v === "number") return v;
  let s = String(v ?? "").trim().replace(/[^\d,.-]/g, ""); if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s); return isFinite(n) ? n : null;
};
const dataBR = (iso) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");
const hora = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const STATUS = { diagnostico: "Em diagnóstico", proposta: "Proposta", contrato: "Contrato", encerrado: "Encerrado" };

const S = { user: null, cliente: null, avaliacoes: [], aval: null, apos: null };
const app = $("#app");

async function api(method, path, body) {
  const r = await fetch("/api" + path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && !path.startsWith("/auth")) { S.user = null; telaLogin(); throw new Error("sessao"); }
  if (!r.ok) throw new Error(d.erro || "Falha na comunicação com o servidor.");
  return d;
}

// ---------- gravação automática e sincronização ----------
const fila = { c: {}, cm: {}, a: {}, am: {} };
let timer = null, enviando = false, voo = { c: {}, a: {} };
function estado(txt, erro) { const e = $("#salvo"); if (e) { e.textContent = txt; e.classList.toggle("erro", !!erro); } }
function agenda() { estado("Salvando…"); clearTimeout(timer); timer = setTimeout(flush, 500); }
const temPendencia = () => enviando || Object.keys(fila.c).length || Object.keys(fila.cm).length || Object.keys(fila.a).length || Object.keys(fila.am).length;
async function flush() {
  if (enviando) return agenda();
  enviando = true;
  const lote = { c: fila.c, cm: fila.cm, a: fila.a, am: fila.am };
  fila.c = {}; fila.cm = {}; fila.a = {}; fila.am = {}; voo = { c: lote.c, a: lote.a };
  try {
    if (S.cliente && (Object.keys(lote.c).length || Object.keys(lote.cm).length)) {
      const r = await api("PATCH", `/clientes/${S.cliente.id}`, { ...lote.cm, ficha: lote.c });
      if (Number(r.rev) === Number(S.cliente.rev) + 1) S.cliente.rev = r.rev;
      lote.c = {}; lote.cm = {};
    }
    if (S.aval && (Object.keys(lote.a).length || Object.keys(lote.am).length)) {
      const r = await api("PATCH", `/avaliacoes/${S.aval.id}`, { ...lote.am, respostas: lote.a });
      if (Number(r.rev) === Number(S.aval.rev) + 1) S.aval.rev = r.rev;
      lote.a = {}; lote.am = {};
    }
    estado("Salvo às " + hora(new Date()));
  } catch (e) {
    for (const k of ["c", "cm", "a", "am"]) fila[k] = { ...lote[k], ...fila[k] };
    if (e.message !== "sessao") { estado("Sem conexão. Nova tentativa em instantes.", true); timer = setTimeout(flush, 4000); }
  } finally { enviando = false; voo = { c: {}, a: {} }; }
}
function salvaFicha(k, v) { S.cliente.ficha[k] = v; fila.c[k] = v; agenda(); S.apos?.(); }
function salvaCliente(campo, v) { S.cliente[campo] = v; fila.cm[campo] = v; agenda(); }
function salvaResp(qid, patch) { const r = { ...(S.aval.respostas[qid] || {}), ...patch }; S.aval.respostas[qid] = r; fila.a[qid] = r; agenda(); S.apos?.(); }
function salvaAval(campo, v) { S.aval[campo] = v; fila.am[campo] = v; agenda(); }
window.addEventListener("beforeunload", (e) => { if (temPendencia()) { e.preventDefault(); e.returnValue = ""; } });

async function sondar() {
  if (document.hidden || !S.user || !S.cliente || !location.hash.startsWith("#/c/")) return;
  try {
    let mudou = false;
    const rc = await api("GET", `/clientes/${S.cliente.id}?rev=${S.cliente.rev}`);
    if (rc.cliente) {
      const local = S.cliente.ficha, pend = { ...voo.c, ...fila.c };
      S.avaliacoes = rc.avaliacoes;
      S.cliente = { ...rc.cliente, ...fila.cm, ficha: { ...rc.cliente.ficha } };
      for (const k in pend) S.cliente.ficha[k] = local[k];
      mudou = true;
    }
    if (S.aval) {
      const ra = await api("GET", `/avaliacoes/${S.aval.id}?rev=${S.aval.rev}`);
      if (ra.avaliacao) {
        const local = S.aval.respostas, pend = { ...voo.a, ...fila.a };
        S.aval = { ...ra.avaliacao, ...fila.am, respostas: { ...ra.avaliacao.respostas } };
        for (const k in pend) S.aval.respostas[k] = local[k];
        mudou = true;
      }
    }
    if (mudou) { sincronizaDOM(); if (!temPendencia()) estado(`Atualizado por ${S.cliente.updated_by || "—"} às ${hora(S.cliente.updated_at)}`); }
  } catch { /* próxima rodada */ }
}
setInterval(sondar, 4000);
document.addEventListener("visibilitychange", sondar);

function valorDe(el) {
  if (el.dataset.f) return S.cliente.ficha[el.dataset.f];
  if (el.dataset.r) { const [q, k] = el.dataset.r.split("."); return (S.aval.respostas[q] || {})[k]; }
  if (el.dataset.cm) return S.cliente[el.dataset.cm];
}
function mostra(el, v) {
  if (el.type === "checkbox") { el.checked = !!v; return; }
  const txt = el.dataset.t && typeof v === "number" ? nf(v, Number.isInteger(v) ? 0 : 2) : v ?? "";
  if (el.value !== String(txt)) el.value = txt;
}
function sincronizaDOM() {
  for (const el of $$("[data-f],[data-r],[data-cm]")) if (el !== document.activeElement) mostra(el, valorDe(el));
  S.apos?.();
}
// captura genérica de campos
app.addEventListener("input", (e) => {
  const el = e.target;
  if (!(el.dataset.f || el.dataset.r || el.dataset.cm)) return;
  const v = el.type === "checkbox" ? el.checked : el.dataset.t ? num(el.value) : el.value;
  if (el.dataset.f) salvaFicha(el.dataset.f, v);
  else if (el.dataset.cm) { if (String(v).trim()) salvaCliente(el.dataset.cm, v); }
  else { const [q, k] = el.dataset.r.split("."); salvaResp(q, { [k]: v }); }
});
app.addEventListener("focusout", (e) => { const el = e.target; if (el.dataset?.t && (el.dataset.f || el.dataset.r)) mostra(el, valorDe(el)); });

// ---------- login ----------
function telaLogin(modo = "login", msg = "") {
  app.innerHTML = `<div class="login"><div class="card">
    <img src="/logo-v.png" alt="TODAI Consultoria">
    <form id="fl">
      ${msg ? `<div class="msg-erro">${h(msg)}</div>` : ""}
      <label class="campo"><span>E-mail</span><input type="email" name="email" required autocomplete="username"></label>
      ${modo === "definir" ? `<label class="campo"><span>Código de acesso</span><input type="password" name="codigo" required autocomplete="off"><small>Código fornecido na implantação do sistema.</small></label>` : ""}
      <label class="campo"><span>${modo === "definir" ? "Nova senha" : "Senha"}</span><input type="password" name="senha" required minlength="${modo === "definir" ? 10 : 1}" autocomplete="${modo === "definir" ? "new-password" : "current-password"}">${modo === "definir" ? "<small>Mínimo de 10 caracteres.</small>" : ""}</label>
      <button class="btn pri" style="justify-content:center">${modo === "definir" ? "Definir senha e entrar" : "Entrar"}</button>
      <button type="button" class="btn link sm" id="troca">${modo === "definir" ? "Voltar ao login" : "Primeiro acesso ou redefinição de senha"}</button>
    </form></div></div>`;
  $("#troca").onclick = () => telaLogin(modo === "definir" ? "login" : "definir");
  $("#fl").onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    try { S.user = await api("POST", modo === "definir" ? "/auth/definir-senha" : "/auth/login", d); rota(); }
    catch (er) { telaLogin(modo, er.message); }
  };
}

// ---------- moldura ----------
function moldura(conteudo, nav = "") {
  app.innerHTML = `<header class="topo"><div class="in">
    <a href="#/"><img src="/logo-h.png" alt="TODAI"></a>
    <nav><a href="#/" class="${nav === "clientes" ? "on" : ""}">Clientes</a><a href="#/config" class="${nav === "config" ? "on" : ""}">Questionário</a></nav>
    <div class="esp"></div><div class="salvo" id="salvo"></div>
    <span class="usuario">${h(S.user.nome)}</span><button class="btn sm" id="sair">Sair</button>
  </div></header><main>${conteudo}</main>`;
  $("#sair").onclick = async () => { await flush(); await api("POST", "/auth/logout", {}); S.user = null; telaLogin(); };
}

// ---------- lista de clientes ----------
async function telaClientes() {
  S.cliente = null; S.aval = null; S.apos = null;
  const { clientes } = await api("GET", "/clientes");
  moldura(`<div class="linha-tit"><h1>Clientes</h1><div class="esp"></div>
    ${clientes.length ? "" : `<button class="btn" id="exemplo">Criar cliente de exemplo</button>`}
    <button class="btn pri" id="novo">Novo cliente</button></div>
    <div class="card" style="padding:8px 12px">${clientes.length ? `<table class="t"><thead><tr><th>Cliente</th><th>Produto / serviço</th><th>Situação</th><th>Avaliações</th><th>Última alteração</th></tr></thead><tbody>
      ${clientes.map((c) => `<tr class="cl" data-id="${c.id}"><td><b>${h(c.nome)}</b></td><td>${h(c.produto || "")}</td><td><span class="tag ${c.status}">${STATUS[c.status]}</span></td><td>${c.avaliacoes}</td><td class="muted">${dataBR(c.updated_at)} · ${h(c.updated_by || "")}</td></tr>`).join("")}
    </tbody></table>` : `<div class="vazio"><h2>Nenhum cliente cadastrado</h2><p>Cadastre o primeiro cliente para iniciar a ficha e o diagnóstico.</p></div>`}</div>
    <dialog id="dlg"><form method="dialog"><h2>Novo cliente</h2><label class="campo"><span>Nome da empresa</span><input name="nome" required></label>
    <div class="ac"><button class="btn" value="x" formnovalidate>Cancelar</button><button class="btn pri" value="ok">Criar</button></div></form></dialog>`, "clientes");
  $$("tr.cl").forEach((tr) => (tr.onclick = () => (location.hash = `#/c/${tr.dataset.id}/ficha`)));
  const criar = async (nome, exemplo) => { const r = await api("POST", "/clientes", { nome, exemplo }); location.hash = `#/c/${r.id}/ficha`; };
  $("#novo").onclick = () => $("#dlg").showModal();
  $("#dlg").onclose = (e) => { const n = $("#dlg input").value.trim(); if (e.target.returnValue === "ok" && n) criar(n); };
  if ($("#exemplo")) $("#exemplo").onclick = () => criar("Empresa Exemplo (fictícia)", true);
}

// ---------- cliente ----------
const chaveAval = (id) => "todai-aval-" + id;
async function carregaCliente(id) {
  if (!S.cliente || S.cliente.id !== id) {
    await flush();
    const r = await api("GET", `/clientes/${id}`);
    S.cliente = r.cliente; S.avaliacoes = r.avaliacoes; S.aval = null;
  }
  let aid; try { aid = sessionStorage.getItem(chaveAval(id)); } catch { /* sem armazenamento */ }
  if (!S.avaliacoes.some((a) => a.id === aid)) aid = S.avaliacoes[S.avaliacoes.length - 1].id;
  if (!S.aval || S.aval.id !== aid) S.aval = (await api("GET", `/avaliacoes/${aid}`)).avaliacao;
}
function molduraCliente(aba, conteudo) {
  const c = S.cliente, base = `#/c/${c.id}`;
  const abas = [["ficha", "Ficha"], ["calculo", "Cálculo comercial"], ["diag", "Diagnóstico"], ["resultado", "Resultado"], ["apresentacao", "Apresentação"]];
  const comAval = ["diag", "resultado", "apresentacao"].includes(aba);
  moldura(`<div class="cab"><h1>${h(c.nome)}</h1>
      ${comAval ? `<select id="selAval" title="Avaliação">${S.avaliacoes.map((a) => `<option value="${a.id}" ${a.id === S.aval.id ? "selected" : ""}>${h(a.titulo)} · ${dataBR(a.data)}</option>`).join("")}</select>
      <button class="btn sm" id="novaAval">Nova reavaliação</button>` : ""}
      <select id="selStatus">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === c.status ? "selected" : ""}>${v}</option>`).join("")}</select>
    </div>
    <div class="abas">${abas.map(([k, v]) => `<a href="${base}/${k}" class="${k === aba ? "on" : ""}">${v}</a>`).join("")}</div>
    ${conteudo}
    <dialog id="dlgAval"><form method="dialog"><h2>Nova reavaliação</h2>
      <p class="muted" style="margin:0">A reavaliação parte das respostas da avaliação selecionada, para que apenas o que mudou seja ajustado. A avaliação original permanece intacta.</p>
      <label class="campo"><span>Título</span><input name="titulo" value="Reavaliação ${new Date().toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" })}" required></label>
      <div class="ac"><button class="btn" value="x" formnovalidate>Cancelar</button><button class="btn pri" value="ok">Criar</button></div></form></dialog>`, "clientes");
  $("#selStatus").onchange = (e) => salvaCliente("status", e.target.value);
  if (comAval) {
    $("#selAval").onchange = async (e) => { await flush(); try { sessionStorage.setItem(chaveAval(c.id), e.target.value); } catch { /* */ } S.aval = null; rota(); };
    $("#novaAval").onclick = () => $("#dlgAval").showModal();
    $("#dlgAval").onclose = async (e) => {
      if (e.target.returnValue !== "ok") return;
      await flush();
      const r = await api("POST", `/clientes/${c.id}/avaliacoes`, { titulo: $("#dlgAval input").value, copiarDe: S.aval.id });
      try { sessionStorage.setItem(chaveAval(c.id), r.id); } catch { /* */ }
      S.cliente = null; rota();
    };
  }
}

// ---------- ficha ----------
const SINS = [
  "Você está disposto(a) a ter um novo sócio que irá cobrar, acompanhar e sugerir melhorias para o seu negócio, entrando com “olhar de dono”?",
  "Você irá se comprometer a realizar todas as tarefas e ações exigidas pela TODAI, respeitando rigorosamente os prazos (datas e horários) combinados?",
  "Você está ciente de que irá receber observações, sugestões, críticas, provocações e correções da TODAI que nem seu parente ou amigo mais próximo já lhe fez?",
];
const PESSOAS_ITENS = [["sat_salario", "Salário compatível com a função"], ["sat_regras", "Regras claras e definidas"], ["sat_ambiente", "Ambiente harmonioso"], ["sat_expectativa", "Clareza da expectativa com o colaborador"], ["sat_ferramentas", "Ferramentas compatíveis com a função"]];
const DEPTOS_PADRAO = ["Comercial / Vendas", "Financeiro", "Operação / Produção", "Pessoas", "Administrativo"];
const campo = (k, rot, o = {}) => {
  const v = S.cliente.ficha[k];
  const attrs = `data-f="${k}" ${o.t ? `data-t="${o.t}" inputmode="decimal"` : ""} ${o.ph ? `placeholder="${h(o.ph)}"` : ""}`;
  const val = o.t && typeof v === "number" ? nf(v, Number.isInteger(v) ? 0 : 2) : h(v ?? "");
  return `<label class="campo ${o.c || "c6"}"><span>${rot}</span>${o.area ? `<textarea ${attrs} rows="${o.area}">${val}</textarea>` : `<input ${attrs} value="${val}">`}${o.dica ? `<small>${o.dica}</small>` : ""}</label>`;
};
const nota10 = (valor, attr) => `<div class="nota10" ${attr}>${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<button type="button" data-n="${n}" class="${valor === n ? "sel" : ""}">${n}</button>`).join("")}</div>`;
function anosBase() { const a = new Date().getFullYear(); return [a - 3, a - 2, a - 1]; }

function telaFicha() {
  const f = S.cliente.ficha, an = anosBase();
  molduraCliente("ficha", `
  <div class="card secao"><h2>Identificação</h2><div class="grade">
    <label class="campo c6"><span>Cliente</span><input data-cm="nome" value="${h(S.cliente.nome)}"></label>
    ${campo("proprietario", "Proprietário(s)")}${campo("produto", "Produto / serviço ofertado")}${campo("tempo_vida", "Tempo de vida", { c: "c3" })}${campo("data_diagnostico", "Data da reunião de diagnóstico", { c: "c3", ph: "dd/mm/aaaa" })}
  </div></div>
  <div class="card secao"><h2>Os “3 sins”</h2>
    ${SINS.map((t, i) => `<label class="sim"><input type="checkbox" data-f="sim${i + 1}" ${f["sim" + (i + 1)] ? "checked" : ""}><span>${i + 1}) ${t}</span></label>`).join("")}
    <div class="grade" style="margin-top:12px">${campo("sins_obs", "Observações sobre os compromissos", { c: "c12", area: 2 })}</div></div>
  <div class="card secao"><h2>Liderança</h2><div class="grade">
    ${campo("gestor_direto", "Gestor direto")}${campo("gestores", "Gestores")}${campo("missao", "Missão", { c: "c12", area: 2 })}</div></div>
  <div class="card secao"><h2>Estratégia e planos</h2><div class="grade">
    ${campo("visao", "Visão", { c: "c12", area: 2 })}${campo("erp", "Tem ERP? Qual?")}
    ${campo("ticket_atual", "Ticket médio atual (R$)", { c: "c3", t: "n", dica: "Mínimo aceitável." })}${campo("ticket_desejado", "Ticket médio desejado (R$)", { c: "c3", t: "n" })}
    ${campo("capacidade_atual", "Capacidade instalada utilizada (%)", { c: "c3", t: "n" })}${campo("capacidade_desejada", "Utilização desejada (%)", { c: "c3", t: "n" })}
    ${campo("player1", "Principal player 1", { c: "c4" })}${campo("player2", "Principal player 2", { c: "c4" })}${campo("player3", "Concorrente mais forte", { c: "c4" })}
    ${campo("expectativa", "Expectativa com a TODAI", { area: 3, dica: "Reforçar presencialmente." })}${campo("mudanca_6m", "Mudança esperada nos próximos 6 meses", { area: 3, dica: "Reforçar presencialmente." })}</div></div>
  <div class="card secao"><h2>Clientes</h2><div class="grade">
    ${campo("carteira", "Volume atual da carteira (clientes)", { c: "c3", t: "n" })}${campo("clientes_novos", "Clientes novos por mês", { c: "c3", t: "n" })}${campo("leads", "Leads por mês", { c: "c3", t: "n" })}${campo("inadimplencia_cliente", "Inadimplência de clientes (%)", { c: "c3", t: "n" })}</div></div>
  <div class="card secao"><h2>Pessoas</h2><div class="grade">
    ${campo("colaboradores", "Número de colaboradores", { c: "c3", t: "n" })}${campo("colaboradores_quem", "Quem são (funções / áreas)", { c: "c8" })}
    ${campo("folha", "Custo da folha de pagamento (R$/mês)", { c: "c3", t: "n", dica: "Sem encargos." })}${campo("beneficios", "Benefícios oferecidos", { c: "c8" })}</div>
    <h3 style="margin:18px 0 6px">Percepção sobre a gestão de pessoas (0 a 10)</h3>
    ${PESSOAS_ITENS.map(([k, r]) => `<div class="lin-nota"><span>${r}</span>${nota10(f[k], `data-nf="${k}"`)}<span></span></div>`).join("")}</div>
  <div class="card secao"><h2>Processos</h2><div class="grade">
    ${campo("inadimplencia_fornecedor", "Inadimplência com fornecedores (%)", { c: "c3", t: "n" })}${campo("infraestrutura", "Despesas de infraestrutura (R$/mês)", { c: "c3", t: "n", dica: "Aluguel, condomínio, água e energia." })}${campo("contabilidade", "Contabilidade (situação e confiança)")}</div>
    <div class="linha-tit" style="margin:18px 0 6px"><h3>Nível de satisfação em cada departamento (0 a 10)</h3><div class="esp"></div><button class="btn sm" id="addDep">Adicionar departamento</button></div>
    <div id="deptos"></div></div>
  <div class="card secao"><h2>Resultados</h2><div class="grade">
    ${campo("faturamento_anual", "Faturamento médio anual (R$)", { c: "c4", t: "n" })}${campo("margem_lucro", "Margem de lucro média (%)", { c: "c4", t: "n" })}${campo("impostos", "Média de imposto pago por mês (R$)", { c: "c4", t: "n" })}
    ${campo("imposto_acumulado", "Imposto acumulado (situação)")}${campo("estoque", "Volume de estoque (se houver)")}
    ${campo("cresc1", `Crescimento em ${an[0]} (%)`, { c: "c3", t: "n" })}${campo("cresc2", `Crescimento em ${an[1]} (%)`, { c: "c3", t: "n" })}${campo("cresc3", `Crescimento em ${an[2]} (%)`, { c: "c3", t: "n" })}${campo("cresc_pretensao", `Pretensão para ${an[2] + 1} (%)`, { c: "c3", t: "n" })}</div></div>
  <div class="card secao"><h2>SWOT</h2><div class="swot">
    ${campo("swot_forcas", "Forças (da porta para dentro)", { c: "", area: 5, dica: "O que você destaca no pitch de vendas da sua empresa?" })}${campo("swot_fraquezas", "Fraquezas (da porta para dentro)", { c: "", area: 5, dica: "Qual é a maior dor?" })}
    ${campo("swot_oportunidades", "Oportunidades (da porta para fora)", { c: "", area: 5 })}${campo("swot_ameacas", "Ameaças (da porta para fora)", { c: "", area: 5 })}</div></div>
  <div class="card secao"><h2>Observações</h2><div class="grade">${campo("observacoes", "Anotações gerais do diagnóstico", { c: "c12", area: 6 })}</div></div>
  <div class="no-print" style="margin-top:24px;text-align:right"><button class="btn sm perigo" id="excluir">Excluir cliente</button></div>`);
  const deptos = () => (Array.isArray(S.cliente.ficha.deptos) ? S.cliente.ficha.deptos : DEPTOS_PADRAO.map((nome) => ({ nome, nota: null })));
  const desenhaDeptos = () => {
    if ($("#deptos").contains(document.activeElement)) return;
    $("#deptos").innerHTML = deptos().map((d, i) => `<div class="lin-nota"><input value="${h(d.nome)}" data-dn="${i}" placeholder="Departamento">${nota10(d.nota, `data-dd="${i}"`)}<button class="btn sm perigo" data-dx="${i}" title="Remover">Remover</button></div>`).join("");
  };
  desenhaDeptos();
  $("#deptos").oninput = (e) => { if (e.target.dataset.dn) { const l = deptos().map((d) => ({ ...d })); l[e.target.dataset.dn].nome = e.target.value; salvaFicha("deptos", l); } };
  $("#deptos").onclick = (e) => {
    const l = deptos().map((d) => ({ ...d })), b = e.target.closest("button"); if (!b) return;
    if (b.dataset.dx) l.splice(b.dataset.dx, 1);
    else if (b.dataset.n) { const i = b.parentElement.dataset.dd; l[i].nota = l[i].nota === Number(b.dataset.n) ? null : Number(b.dataset.n); }
    else return;
    salvaFicha("deptos", l); document.activeElement.blur(); desenhaDeptos();
  };
  $("#addDep").onclick = () => { salvaFicha("deptos", [...deptos(), { nome: "", nota: null }]); desenhaDeptos(); };
  app.querySelector("main").addEventListener("click", (e) => {
    const b = e.target.closest("[data-nf] button"); if (!b) return;
    const k = b.parentElement.dataset.nf, n = Number(b.dataset.n);
    salvaFicha(k, S.cliente.ficha[k] === n ? null : n);
  });
  S.apos = () => {
    for (const g of $$("[data-nf]")) for (const b of $$("button", g)) b.classList.toggle("sel", S.cliente.ficha[g.dataset.nf] === Number(b.dataset.n));
    desenhaDeptos();
  };
  $("#excluir").onclick = async () => {
    if (!confirm(`Excluir definitivamente o cliente “${S.cliente.nome}”, com a ficha e todas as avaliações?`)) return;
    await flush(); await api("DELETE", `/clientes/${S.cliente.id}`); S.cliente = null; location.hash = "#/";
  };
}

// ---------- cálculo comercial ----------
function contas(f) {
  const g = (k, d = null) => (typeof f[k] === "number" ? f[k] : d);
  const enc = g("p_encargos", 92), aum = g("p_aumento_lucro", 30), rot = g("p_rotativos", 80), meses = g("meses_contrato", 6);
  const receita = g("faturamento_anual") === null ? null : g("faturamento_anual") / 12;
  const folha = g("folha") === null ? null : g("folha") * (1 + enc / 100);
  const impostos = g("impostos"), infra = g("infraestrutura");
  const completo = [receita, folha, impostos, infra].every((x) => x !== null);
  const lucro = completo ? receita - folha - impostos - infra : null;
  const lucroProj = lucro === null ? null : lucro * (1 + aum / 100);
  const carteira = g("carteira"), ticket = g("ticket_atual"), ticketDes = g("ticket_desejado"), cap = g("capacidade_atual");
  const fatCalc = carteira !== null && ticket !== null ? carteira * ticket * 12 : null;
  const fatorCresc = cap === null ? null : 1 + (1 - cap / 100);
  const clientesPot = carteira !== null && fatorCresc !== null ? carteira * fatorCresc : null;
  const fatPrev = clientesPot !== null && ticketDes !== null ? clientesPot * ticketDes * 12 : null;
  const hon = g("honorario_mensal");
  const div = (a, b) => (a !== null && b ? a / b : null);
  return { enc, aum, rot, meses, receita, folha, impostos, infra, lucro, lucroProj, margem: div(lucro, receita), mediaSal: div(folha, g("colaboradores")),
    carteira, rotativos: carteira === null ? null : carteira * rot / 100, fatCalc, fatInf: g("faturamento_anual"), fatorCresc, clientesPot, fatPrev,
    crescPrev: fatPrev !== null && g("faturamento_anual") ? (fatPrev - g("faturamento_anual")) / g("faturamento_anual") : null,
    hon, honTotal: hon === null ? null : hon * meses, honRec: div(hon, receita), honLucro: div(hon, lucro), honLucroProj: div(hon, lucroProj) };
}
function telaCalculo() {
  molduraCliente("calculo", `
  <div class="card"><div class="linha-tit"><h2>Parâmetros</h2><span class="muted sm">Os demais valores vêm da Ficha.</span></div><div class="grade">
    ${campo("p_encargos", "Encargos sobre a folha (%)", { c: "c3", t: "n", ph: "92" })}${campo("p_rotativos", "Clientes rotativos (% da carteira)", { c: "c3", t: "n", ph: "80" })}
    ${campo("p_aumento_lucro", "Aumento de lucro projetado (%)", { c: "c3", t: "n", ph: "30" })}${campo("meses_contrato", "Duração do contrato (meses)", { c: "c3", t: "n", ph: "6" })}
    ${campo("honorario_mensal", "Honorário mensal proposto (R$)", { c: "c3", t: "n" })}</div></div>
  <div class="duas" style="margin-top:16px" id="calc"></div>`);
  S.apos = () => {
    const k = contas(S.cliente.ficha), neg = (v) => (v !== null && v < 0 ? "neg" : "");
    $("#calc").innerHTML = `
    <div class="card"><h2 style="margin-bottom:14px">Resultado mensal estimado</h2><dl class="kv">
      <dt>Receita (faturamento anual ÷ 12)</dt><dd>${brl(k.receita)}</dd>
      <dt>Folha com encargos (${nf(k.enc)}%)</dt><dd>${brl(k.folha)}</dd>
      <dt>Impostos</dt><dd>${brl(k.impostos)}</dd>
      <dt>Infraestrutura</dt><dd>${brl(k.infra)}</dd>
      <dt class="tot">Lucro estimado</dt><dd class="tot ${neg(k.lucro)}">${brl(k.lucro)}</dd>
      <dt>Margem estimada</dt><dd class="${neg(k.margem)}">${pct(k.margem, 1)}</dd>
      <dt>Lucro com aumento de ${nf(k.aum)}%</dt><dd>${brl(k.lucroProj)}</dd>
      <dt>Custo médio por colaborador</dt><dd>${brl(k.mediaSal)}</dd></dl></div>
    <div class="card"><h2 style="margin-bottom:14px">Carteira e faturamento</h2><dl class="kv">
      <dt>Clientes na carteira</dt><dd>${nf(k.carteira)}</dd>
      <dt>Clientes rotativos por mês (${nf(k.rot)}%)</dt><dd>${nf(k.rotativos)}</dd>
      <dt>Faturamento calculado (carteira × ticket × 12)</dt><dd>${brl(k.fatCalc)}</dd>
      <dt>Faturamento informado</dt><dd>${brl(k.fatInf)}</dd>
      <dt>Fator de crescimento pela capacidade ociosa</dt><dd>${k.fatorCresc === null ? "—" : nf(k.fatorCresc, 2) + "×"}</dd>
      <dt>Clientes potenciais</dt><dd>${nf(k.clientesPot, 1)}</dd>
      <dt class="tot">Faturamento anual previsto</dt><dd class="tot">${brl(k.fatPrev)}</dd>
      <dt>Crescimento sobre o informado</dt><dd class="${neg(k.crescPrev)}">${pct(k.crescPrev, 1)}</dd></dl></div>
    <div class="card"><h2 style="margin-bottom:14px">Honorário da consultoria</h2><dl class="kv">
      <dt>Honorário mensal</dt><dd>${brl(k.hon)}</dd>
      <dt>Total do contrato (${nf(k.meses)} meses)</dt><dd>${brl(k.honTotal)}</dd>
      <dt>Participação na receita mensal</dt><dd>${pct(k.honRec, 1)}</dd>
      <dt>Participação no lucro atual</dt><dd>${pct(k.honLucro, 1)}</dd>
      <dt>Participação no lucro projetado</dt><dd>${pct(k.honLucroProj, 1)}</dd></dl></div>`;
  };
  S.apos();
}

// ---------- diagnóstico ----------
function navCriterios(R, atual) {
  return R.criterios.map((c) => { const ok = c.respondidas === c.aplicaveis; return `<a href="#/c/${S.cliente.id}/diag/${c.id}" class="${c.id === atual ? "on" : ""}">
    <div class="nm"><span>${h(c.nome)}</span><span>${c.respondidas + (c.total - c.aplicaveis)}/${c.total}</span></div>
    <div class="prog"><i class="${ok ? "ok" : ""}" style="width:${c.total ? ((c.respondidas + c.total - c.aplicaveis) / c.total) * 100 : 0}%"></i></div></a>`; }).join("");
}
function telaDiag(critId) {
  const q = S.aval.questionario, i = Math.max(0, q.criterios.findIndex((c) => c.id === critId)), c = q.criterios[i];
  const ano = Number((S.aval.data || "").slice(0, 4)) || new Date().getFullYear(), anos = [ano - 3, ano - 2, ano - 1];
  const R0 = calcular(q, S.aval.respostas);
  molduraCliente("diag", `<div class="diag">
    <aside class="card crit-nav"><div id="nav">${navCriterios(R0, c.id)}</div>
      <div style="padding:10px;border-top:1px solid var(--linha2);margin-top:8px" class="sm muted" id="resumo"></div></aside>
    <section>
      <div class="card"><div class="linha-tit" style="margin-bottom:8px"><h2>${i + 1}. ${h(c.nome)}</h2><div class="esp"></div>
        <label class="sm muted">Data da avaliação <input type="date" id="dtAval" value="${h(S.aval.data)}" style="width:auto;margin-left:6px"></label></div>
        <p class="muted" style="margin:0">${h(c.descricao || "")}</p></div>
      ${c.perguntas.map((p) => { const r = S.aval.respostas[p.id] || {}; return `<div class="card perg" id="${p.id}" data-q="${p.id}">
        <h3><b>${p.n ?? ""}.</b><span>${h(p.texto)}</span></h3>
        ${p.opcoes.map((o, k) => `<button type="button" class="opc" data-o="${k}"><span class="lt">${LETRAS[k]}</span><span>${h(o)}</span></button>`).join("")}
        <button type="button" class="opc na" data-o="na">Não se aplica</button>
        ${p.dica ? `<div class="dica">${h(p.dica)}</div>` : ""}
        ${c.id === "resultados" ? `<div class="grade" style="margin:8px 0">${anos.map((a, k) => `<label class="campo c3"><span>Resultado em ${a}</span><input data-r="${p.id}.v${k + 1}" data-t="n" inputmode="decimal" value="${typeof r["v" + (k + 1)] === "number" ? nf(r["v" + (k + 1)], Number.isInteger(r["v" + (k + 1)]) ? 0 : 2) : ""}"></label>`).join("")}
          <label class="campo c3"><span>Unidade</span><input data-r="${p.id}.un" value="${h(r.un ?? "")}" placeholder="%, nº, R$"></label></div>` : ""}
        <div class="grade" style="margin-top:8px"><label class="campo c6"><span>Evidências</span><textarea data-r="${p.id}.e" rows="2">${h(r.e ?? "")}</textarea></label>
        <label class="campo c6"><span>Pontos de melhoria</span><textarea data-r="${p.id}.m" rows="2">${h(r.m ?? "")}</textarea></label></div></div>`; }).join("")}
      <div class="rodape-crit">${i > 0 ? `<a class="btn" href="#/c/${S.cliente.id}/diag/${q.criterios[i - 1].id}">← ${h(q.criterios[i - 1].nome)}</a>` : "<span></span>"}
        ${i < q.criterios.length - 1 ? `<a class="btn pri" href="#/c/${S.cliente.id}/diag/${q.criterios[i + 1].id}">${h(q.criterios[i + 1].nome)} →</a>` : `<a class="btn pri" href="#/c/${S.cliente.id}/resultado">Ver resultado →</a>`}</div>
    </section></div>`);
  $("#dtAval").onchange = (e) => { if (e.target.value) salvaAval("data", e.target.value); };
  $(".diag section").addEventListener("click", (e) => {
    const b = e.target.closest(".opc"); if (!b) return;
    const qid = b.closest(".perg").dataset.q, v = b.dataset.o === "na" ? "na" : Number(b.dataset.o);
    salvaResp(qid, { o: (S.aval.respostas[qid] || {}).o === v ? null : v });
  });
  S.apos = () => {
    const R = calcular(q, S.aval.respostas);
    for (const el of $$(".perg")) {
      const o = (S.aval.respostas[el.dataset.q] || {}).o;
      for (const b of $$(".opc", el)) b.classList.toggle("sel", String(o) === b.dataset.o);
      el.classList.toggle("pend", o === null || o === undefined);
    }
    $("#nav").innerHTML = navCriterios(R, c.id);
    $("#resumo").innerHTML = R.completo ? `Diagnóstico completo.<br>Nota: <b>${nf(R.nota, 1)}</b>` : `${R.pendentes} pergunta(s) pendente(s) de ${R.totalPerguntas}.`;
  };
  S.apos();
}

// ---------- gráficos ----------
const corFaixa = (i, n) => [["var(--fraco)"], ["var(--fraco)", "var(--otimo)"], ["var(--fraco)", "var(--regular)", "var(--otimo)"], ["var(--fraco)", "var(--regular)", "var(--bom)", "var(--otimo)"]][Math.min(n, 4) - 1]?.[i] || "var(--bom)";
const polar = (cx, cy, r, grau) => [cx + r * Math.cos((grau * Math.PI) / 180), cy + r * Math.sin((grau * Math.PI) / 180)];
function velocimetro(R, w = 420) {
  const cx = 210, cy = 200, r = 150, esp = 26, ang = (v) => 180 + (Math.max(0, Math.min(100, v)) / 100) * 180;
  let ini = 0;
  const arcos = R.faixas.map((f, i) => {
    const a0 = ang(ini) + (i ? 0.8 : 0), a1 = ang(f.ate) - (i < R.faixas.length - 1 ? 0.8 : 0), [x0, y0] = polar(cx, cy, r, a0), [x1, y1] = polar(cx, cy, r, a1), meio = (ini + f.ate) / 2, [tx, ty] = polar(cx, cy, r + 30, ang(meio));
    const s = `<path d="M${x0} ${y0} A${r} ${r} 0 0 1 ${x1} ${y1}" fill="none" stroke="${corFaixa(i, R.faixas.length)}" stroke-width="${esp}" opacity="${R.faixa === f ? 1 : 0.28}"><title>${h(f.nome)}: de ${ini} a ${f.ate}</title></path>
      <text x="${tx}" y="${ty}" text-anchor="middle" font-size="12" font-weight="${R.faixa === f ? 700 : 500}" fill="${R.faixa === f ? "#0D2036" : "#7B8997"}">${h(f.nome)}</text>`;
    ini = f.ate; return s;
  }).join("");
  const [px, py] = polar(cx, cy, r - 30, ang(R.nota));
  return `<svg viewBox="0 0 420 250" width="${w}" style="max-width:100%;height:auto" role="img" aria-label="Nota geral ${nf(R.nota, 1)} de 100, faixa ${h(R.faixa.nome)}">${arcos}
    <line x1="${cx}" y1="${cy}" x2="${px}" y2="${py}" stroke="#0D2036" stroke-width="4" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="9" fill="#0D2036"/>
    <text x="${cx - r - 2}" y="${cy + 22}" text-anchor="middle" font-size="11" fill="#7B8997">0</text><text x="${cx + r + 2}" y="${cy + 22}" text-anchor="middle" font-size="11" fill="#7B8997">100</text>
    <text x="${cx}" y="${cy + 44}" text-anchor="middle" font-size="36" font-weight="800" fill="#0D2036">${nf(R.nota, 1)}</text></svg>`;
}
function radar(R, ant, w = 520) {
  const cx = 260, cy = 215, r = 140, n = R.criterios.length, ang = (i) => -90 + (360 / n) * i;
  const pts = (l) => l.map((c, i) => polar(cx, cy, r * (c.pct || 0), ang(i)).map((v) => v.toFixed(1)).join(",")).join(" ");
  const aneis = [0.25, 0.5, 0.75, 1].map((k) => `<polygon points="${R.criterios.map((_, i) => polar(cx, cy, r * k, ang(i)).map((v) => v.toFixed(1)).join(",")).join(" ")}" fill="none" stroke="#DCE3E8" stroke-width="1"/>`).join("");
  const eixos = R.criterios.map((c, i) => {
    const [x, y] = polar(cx, cy, r, ang(i)), [lx, ly] = polar(cx, cy, r + 16, ang(i)), anc = Math.abs(lx - cx) < 12 ? "middle" : lx > cx ? "start" : "end", pal = c.nome.split(" e ");
    return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#DCE3E8"/><text x="${lx}" y="${ly + (ly < cy - r ? -14 : 2)}" text-anchor="${anc}" font-size="12" fill="#4A5B6B"><tspan font-weight="600">${h(pal[0])}${pal[1] ? " e" : ""}</tspan>${pal[1] ? `<tspan x="${lx}" dy="14" font-weight="600">${h(pal[1])}</tspan>` : ""}<tspan x="${lx}" dy="14" fill="#0D2036" font-weight="700">${c.pct === null ? "N/A" : pct(c.pct)}</tspan></text>`;
  }).join("");
  const marcas = R.criterios.map((c, i) => { const [x, y] = polar(cx, cy, r * (c.pct || 0), ang(i)); return `<circle cx="${x}" cy="${y}" r="5" fill="#005479" stroke="#fff" stroke-width="2"><title>${h(c.nome)}: ${pct(c.pct)} (${nf(c.pontos, 1)} de ${nf(c.max, 1)} pontos)</title></circle>`; }).join("");
  return `<svg viewBox="0 0 520 440" width="${w}" style="max-width:100%;height:auto" role="img" aria-label="Percentual de atendimento por critério">${aneis}${eixos}
    ${[25, 50, 75].map((v) => `<text x="${cx + 4}" y="${cy - (r * v) / 100 + 4}" font-size="9" fill="#9AA7B2">${v}%</text>`).join("")}
    ${ant ? `<polygon points="${pts(ant.criterios)}" fill="none" stroke="#7B8997" stroke-width="2" stroke-dasharray="5 4"/>` : ""}
    <polygon points="${pts(R.criterios)}" fill="#005479" fill-opacity=".14" stroke="#005479" stroke-width="2" stroke-linejoin="round"/>${marcas}</svg>`;
}
const selo = (R) => `<span class="selo" style="background:${corFaixa(R.faixas.indexOf(R.faixa), R.faixas.length)}">${h(R.faixa.nome)}</span>`;

// ---------- resultado ----------
let compararCom = "";
async function telaResultado() {
  const q = S.aval.questionario, outras = S.avaliacoes.filter((a) => a.id !== S.aval.id);
  if (!outras.some((a) => a.id === compararCom)) compararCom = "";
  let ant = null;
  if (compararCom) { const a = (await api("GET", `/avaliacoes/${compararCom}`)).avaliacao; ant = { ...calcular(a.questionario, a.respostas), titulo: a.titulo }; }
  molduraCliente("resultado", `<div id="res"></div>`);
  S.apos = () => {
    const R = calcular(q, S.aval.respostas), dAnt = (c) => { const a = ant?.criterios.find((x) => x.id === c.id); return a && a.pct !== null && c.pct !== null ? (c.pct - a.pct) * 100 : null; };
    $("#res").innerHTML = `
    ${R.completo ? "" : `<div class="aviso"><b>Resultado parcial.</b> Há ${R.pendentes} pergunta(s) sem resposta, contabilizadas como zero até serem respondidas. <a href="#/c/${S.cliente.id}/diag/${R.criterios.find((c) => c.respondidas < c.aplicaveis).id}">Ir para as pendências</a></div>`}
    <div class="duas">
      <div class="card" style="text-align:center"><h2 style="text-align:left">Nível de maturidade da gestão</h2>${velocimetro(R)}<div>${selo(R)}${ant ? `<div class="muted sm" style="margin-top:8px">${h(ant.titulo)}: ${nf(ant.nota, 1)} → variação de ${nf(R.nota - ant.nota, 1)} ponto(s)</div>` : ""}</div></div>
      <div class="card" style="text-align:center"><div class="linha-tit" style="margin-bottom:0"><h2>Atendimento por critério</h2><div class="esp"></div>
        ${outras.length ? `<select id="cmp" style="width:auto"><option value="">Sem comparação</option>${outras.map((a) => `<option value="${a.id}" ${a.id === compararCom ? "selected" : ""}>Comparar com: ${h(a.titulo)}</option>`).join("")}</select>` : ""}</div>
        ${radar(R, ant)}${ant ? `<div class="legenda"><span><i></i>${h(S.aval.titulo)}</span><span><i class="ant"></i>${h(ant.titulo)}</span></div>` : ""}</div>
    </div>
    <div class="tiles" style="margin-top:16px">
      <div class="tile"><div class="rot">Nota geral</div><div class="val">${nf(R.nota, 1)}</div><div class="sub">de 100 pontos</div></div>
      <div class="tile"><div class="rot">Práticas de gestão</div><div class="val">${pct(R.praticas.pct)}</div><div class="sub">${nf(R.praticas.pontos, 1)} de ${nf(R.praticas.max, 1)} pontos (critérios 1 a 7)</div></div>
      <div class="tile"><div class="rot">Resultados</div><div class="val">${pct(R.resultados.pct)}</div><div class="sub">${nf(R.resultados.pontos, 1)} de ${nf(R.resultados.max, 1)} pontos</div></div>
      <div class="tile"><div class="rot">Respostas</div><div class="val">${R.totalPerguntas - R.pendentes - R.naoAplica}<span style="font-size:16px;color:var(--tx3)"> / ${R.totalPerguntas - R.naoAplica}</span></div><div class="sub">${R.naoAplica} não se aplica(m)</div></div>
    </div>
    <div class="card" style="margin-top:16px"><h2 style="margin-bottom:10px">Notas por critério</h2><table class="t"><thead><tr><th>Critério</th><th class="n">Pontos</th><th class="n">Máximo</th><th class="n">Atendimento</th>${ant ? `<th class="n">Variação</th>` : ""}<th style="width:32%"></th></tr></thead><tbody>
      ${R.criterios.map((c, i) => `<tr><td><a href="#/c/${S.cliente.id}/diag/${c.id}" style="text-decoration:none;color:inherit"><b>${i + 1}. ${h(c.nome)}</b></a></td><td class="n">${nf(c.pontos, 2)}</td><td class="n">${nf(c.max, 1)}</td><td class="n"><b>${c.pct === null ? "N/A" : pct(c.pct)}</b></td>${ant ? `<td class="n">${dAnt(c) === null ? "—" : (dAnt(c) > 0 ? "+" : "") + nf(dAnt(c)) + " p.p."}</td>` : ""}<td><div class="barra" title="${h(c.nome)}: ${pct(c.pct)}"><i style="width:${(c.pct || 0) * 100}%"></i></div></td></tr>`).join("")}
      <tr><td><b>Total</b></td><td class="n"><b>${nf(R.nota, 2)}</b></td><td class="n"><b>100</b></td><td class="n"><b>${nf(R.nota)}%</b></td>${ant ? `<td class="n"><b>${nf(R.nota - ant.nota, 1)}</b></td>` : ""}<td></td></tr></tbody></table></div>
    <div class="card" style="margin-top:16px"><div class="linha-tit"><h2>Prioridades de melhoria</h2><span class="muted sm">Perguntas ordenadas pelos pontos que a empresa deixa de obter na nota geral.</span></div>
      ${R.lacunas.length ? `<table class="t"><thead><tr><th>#</th><th>Pergunta</th><th>Resposta</th><th class="n">Pontos perdidos</th><th>Evidências e pontos de melhoria</th></tr></thead><tbody>
      ${R.lacunas.slice(0, 15).map((p, i) => { const r = S.aval.respostas[p.id] || {}; return `<tr><td>${i + 1}</td><td style="max-width:360px"><a href="#/c/${S.cliente.id}/diag/${p.criterioId}" style="text-decoration:none;color:inherit"><span class="muted sm">${h(p.criterio)}</span><br>${h(p.texto)}</a></td><td><b>${LETRAS[p.opcao].toUpperCase()}</b></td><td class="n"><b>${nf(p.perdido, 2)}</b><br><span class="muted sm">de ${nf(p.peso, 2)}</span></td><td class="sm">${r.e ? `<b>Evidência:</b> ${h(r.e)}<br>` : ""}${r.m ? `<b>Melhoria:</b> ${h(r.m)}` : ""}</td></tr>`; }).join("")}</tbody></table>` : `<p class="muted">Sem lacunas registradas.</p>`}</div>`;
    if ($("#cmp")) $("#cmp").onchange = (e) => { compararCom = e.target.value; telaResultado(); };
  };
  S.apos();
}

// ---------- apresentação ----------
function telaApresentacao() {
  const q = S.aval.questionario;
  molduraCliente("apresentacao", `<div class="linha-tit no-print"><span class="muted">Slides no formato 16:9. A exportação usa a impressão do navegador com destino “Salvar como PDF”.</span><div class="esp"></div>
    <label class="sm"><input type="checkbox" id="incLac" checked> Incluir slide de prioridades</label><button class="btn pri" id="pdf">Exportar PDF</button></div><div class="palco" id="palco"></div>`);
  const rod = (n) => `<div class="rod"><span>${h(S.cliente.nome)} · Diagnóstico de maturidade da gestão</span><img src="/logo-h.png" alt="TODAI"></div>`;
  S.apos = () => {
    const R = calcular(q, S.aval.respostas), mes = new Date(S.aval.data + "T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    const slides = [
      `<div class="slide capa"><div class="fx"></div><h2>Diagnóstico de maturidade<br>da gestão</h2><div class="cli">${h(S.cliente.nome)}</div><div class="dt">${h(mes.charAt(0).toUpperCase() + mes.slice(1))}</div><div class="marca"><img src="/logo-h.png" alt="TODAI Consultoria"></div></div>`,
      `<div class="slide"><h2>Nível de maturidade da gestão</h2><div class="sub">Nota geral em uma escala de 0 a 100 pontos</div>
        <div class="s-corpo" style="grid-template-columns:1.25fr 1fr"><div style="text-align:center">${velocimetro(R, 600)}<div style="margin-top:6px;transform:scale(1.5)">${selo(R)}</div></div>
        <div style="display:grid;gap:18px"><div class="s-tile"><div class="rot">Práticas de gestão (critérios 1 a 7)</div><div class="val">${pct(R.praticas.pct)}</div><div class="muted">${nf(R.praticas.pontos, 1)} de ${nf(R.praticas.max, 1)} pontos</div></div>
        <div class="s-tile"><div class="rot">Resultados (critério 8)</div><div class="val">${pct(R.resultados.pct)}</div><div class="muted">${nf(R.resultados.pontos, 1)} de ${nf(R.resultados.max, 1)} pontos</div></div></div></div>${rod()}</div>`,
      `<div class="slide"><h2>Notas por critério</h2><div class="sub">Percentual de atendimento em cada critério do modelo</div>
        <div class="s-corpo" style="grid-template-columns:1fr 1.1fr"><div style="text-align:center">${radar(R, null, 560)}</div>
        <table class="s-tab">${R.criterios.map((c, i) => `<tr><td>${i + 1}. ${h(c.nome)}</td><td><div class="barra"><i style="width:${(c.pct || 0) * 100}%"></i></div></td><td class="n">${c.pct === null ? "N/A" : pct(c.pct)}</td></tr>`).join("")}
        <tr><td><b>Nota geral</b></td><td></td><td class="n" style="font-size:22px;color:var(--azul)">${nf(R.nota, 1)}</td></tr></table></div>${rod()}</div>`,
    ];
    if ($("#incLac").checked && R.lacunas.length) slides.push(`<div class="slide"><h2>Principais oportunidades de melhoria</h2><div class="sub">Pontos com maior impacto potencial sobre a nota geral</div>
      <div class="s-corpo" style="align-items:start;margin-top:28px"><div class="s-lac">${R.lacunas.slice(0, 6).map((p, i) => `<div><b>${i + 1}</b><span><small>${h(p.criterio)}</small>${h(p.texto.charAt(0) + p.texto.slice(1).toLowerCase())}</span></div>`).join("")}</div></div>${rod()}</div>`);
    $("#palco").innerHTML = slides.map((s) => `<div class="slide-wrap">${s}</div>`).join("");
    escala();
  };
  const escala = () => $$(".slide-wrap").forEach((w) => (w.firstElementChild.style.transform = `scale(${w.clientWidth / 1280})`));
  window.onresize = escala;
  $("#incLac").onchange = S.apos;
  $("#pdf").onclick = () => window.print();
  S.apos();
}

// ---------- configuração do questionário ----------
async function telaConfig() {
  S.cliente = null; S.aval = null; S.apos = null;
  let { questionario: q } = await api("GET", "/questionario");
  const desenha = () => {
    const tot = q.criterios.reduce((s, c) => s + (Number(c.pontos) || 0), 0);
    moldura(`<div class="linha-tit"><div><h1>Questionário de diagnóstico</h1><div class="muted">Versão ${q.versao}. As alterações valem para as próximas avaliações; as já criadas preservam o questionário com que foram respondidas.</div></div><div class="esp"></div>
      <button class="btn" id="padrao">Restaurar padrão MPE Brasil</button><button class="btn pri" id="gravar">Salvar questionário</button></div>
      <div class="card"><h2 style="margin-bottom:12px">Faixas de maturidade</h2><div class="grade">${q.faixas.map((f, i) => `<label class="campo c3"><span>Faixa ${i + 1}</span><input data-fx="${i}.nome" value="${h(f.nome)}"></label><label class="campo c3"><span>Até (pontos)</span><input data-fx="${i}.ate" value="${f.ate}" inputmode="decimal"></label>`).join("")}</div></div>
      <div class="linha-tit" style="margin:20px 0 10px"><h2>Critérios e perguntas</h2><div class="esp"></div><span class="${Math.abs(tot - 100) < 1e-6 ? "muted" : "msg-erro"}">Soma dos pontos: ${nf(tot, 2)}${Math.abs(tot - 100) < 1e-6 ? "" : " (a nota final é sempre normalizada para 100)"}</span></div>
      ${q.criterios.map((c, i) => `<details class="cfg" data-c="${i}"><summary>${i + 1}. ${h(c.nome)}<span>${c.perguntas.length} perguntas · ${nf(c.pontos, 2)} pontos</span></summary><div class="corpo">
        <div class="fat"><label class="campo"><span>Pontos do critério</span><input data-cc="pontos" value="${c.pontos}" inputmode="decimal"></label>
        ${c.fatores.map((f, k) => `<label class="campo"><span>Alternativa ${LETRAS[k].toUpperCase()} (%)</span><input data-cf="${k}" value="${nf(f * 100, 2)}" inputmode="decimal"></label>`).join("")}</div>
        <label class="campo" style="margin-top:12px"><span>Descrição do critério</span><textarea data-cc="descricao" rows="3">${h(c.descricao || "")}</textarea></label>
        ${c.perguntas.map((p, j) => `<div class="cfg-q" data-p="${j}"><div style="display:flex;gap:8px;align-items:center"><b>${p.n ?? ""}.</b><div class="esp" style="flex:1"></div><button class="btn sm perigo" data-del>Remover pergunta</button></div>
          <textarea data-pp="texto" rows="2">${h(p.texto)}</textarea>
          ${p.opcoes.map((o, k) => `<div class="op"><b>${LETRAS[k]})</b><textarea data-po="${k}" rows="2">${h(o)}</textarea></div>`).join("")}
          <label class="campo"><span>Orientação ao consultor (opcional)</span><input data-pp="dica" value="${h(p.dica || "")}"></label></div>`).join("")}
        <button class="btn sm" data-add style="margin-top:12px">Adicionar pergunta</button></div></details>`).join("")}`, "config");
    const abertos = new Set();
    $("main").oninput = (e) => {
      const el = e.target, d = el.dataset, ci = el.closest("[data-c]")?.dataset.c, pi = el.closest("[data-p]")?.dataset.p;
      if (d.fx) { const [i, k] = d.fx.split("."); q.faixas[i][k] = k === "ate" ? num(el.value) ?? 0 : el.value; }
      else if (d.cc) q.criterios[ci][d.cc] = d.cc === "pontos" ? num(el.value) ?? 0 : el.value;
      else if (d.cf) q.criterios[ci].fatores[d.cf] = Math.max(0, Math.min(1, (num(el.value) ?? 0) / 100));
      else if (d.pp) q.criterios[ci].perguntas[pi][d.pp] = el.value;
      else if (d.po) q.criterios[ci].perguntas[pi].opcoes[d.po] = el.value;
    };
    const redesenha = (ci) => { desenha(); const d = $(`details[data-c="${ci}"]`); if (d) d.open = true; };
    $("main").onclick = (e) => {
      const ci = e.target.closest("[data-c]")?.dataset.c;
      if (e.target.matches("[data-del]")) { if (confirm("Remover esta pergunta do questionário?")) { q.criterios[ci].perguntas.splice(e.target.closest("[data-p]").dataset.p, 1); redesenha(ci); } }
      else if (e.target.matches("[data-add]")) {
        const todas = q.criterios.flatMap((c) => c.perguntas), n = Math.max(0, ...todas.map((p) => p.n || 0)) + 1;
        q.criterios[ci].perguntas.push({ id: "q" + Date.now().toString(36), n, texto: "", opcoes: ["", "", "", ""], dica: "" }); redesenha(ci);
      }
    };
    $("#gravar").onclick = async () => { try { q = (await api("PUT", "/questionario", { questionario: q })).questionario; desenha(); estado("Questionário salvo (versão " + q.versao + ")"); } catch (er) { alert(er.message); } };
    $("#padrao").onclick = async () => { if (confirm("Substituir o questionário em edição pelo padrão MPE Brasil? A alteração só é gravada ao salvar.")) { q = { ...(await api("GET", "/questionario/padrao")).padrao, versao: q.versao }; desenha(); } };
  };
  desenha();
}

// ---------- roteador ----------
async function rota() {
  window.onresize = null;
  if (!S.user) { try { S.user = await api("GET", "/me"); } catch { return; } }
  const p = location.hash.replace(/^#\/?/, "").split("/");
  try {
    if (p[0] === "config") { await flush(); return await telaConfig(); }
    if (p[0] === "c" && p[1]) {
      await carregaCliente(p[1]); S.apos = null;
      const t = { ficha: telaFicha, calculo: telaCalculo, diag: () => telaDiag(p[3]), resultado: telaResultado, apresentacao: telaApresentacao }[p[2]] || telaFicha;
      await t(); window.scrollTo(0, 0); return;
    }
    await flush(); await telaClientes();
  } catch (e) { if (e.message !== "sessao") { moldura(`<div class="card vazio"><h2>Não foi possível carregar</h2><p>${h(e.message)}</p><a class="btn" href="#/">Voltar aos clientes</a></div>`); } }
}
window.addEventListener("hashchange", rota);
rota();
