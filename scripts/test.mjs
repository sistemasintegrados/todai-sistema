import assert from "node:assert";
import { readFileSync } from "node:fs";
import { calcular } from "../public/score.js";
const q = JSON.parse(readFileSync(new URL("../lib/questionario.json", import.meta.url)));
const ex = JSON.parse(readFileSync(new URL("../lib/exemplo.json", import.meta.url)));
const r = calcular(q, ex.respostas);
console.log("nota", r.nota.toFixed(2), r.faixa.nome, r.criterios.map((c) => c.pontos.toFixed(2)).join(" "), "praticas", r.praticas.pontos.toFixed(2), "/", r.praticas.max);
assert(Math.abs(r.nota - 33.09) < 0.1 && r.completo);
assert.equal(calcular(q, {}).pendentes, 37);
const todosD = Object.fromEntries(q.criterios.flatMap((c) => c.perguntas.map((p) => [p.id, { o: 3 }])));
assert(Math.abs(calcular(q, todosD).nota - 100) < 1e-9);
const comNA = { ...todosD, q16: { o: "na" }, q17: { o: "na" }, q18: { o: "na" }, q1: { o: "na" } };
const n = calcular(q, comNA); assert(Math.abs(n.nota - 100) < 1e-9 && n.naoAplica === 4);
const meio = { ...todosD, q2: { o: 0 }, q1: { o: "na" } }; // 1 de 5 aplicáveis zerada em Liderança
assert(Math.abs(calcular(q, meio).nota - (100 - 15 / 5)) < 1e-9);
console.log("ok");
