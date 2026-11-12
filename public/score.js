// Cálculo da maturidade. Usado no navegador e nos testes.
export const LETRAS = ["a", "b", "c", "d"];

export function calcular(quest, respostas = {}) {
  let pendentes = 0, naoAplica = 0, totalPerguntas = 0;
  const criterios = quest.criterios.map((c) => {
    let aplicaveis = 0, soma = 0, respondidas = 0;
    const perguntas = c.perguntas.map((p) => {
      totalPerguntas++;
      const r = respostas[p.id] || {};
      if (r.o === "na") { naoAplica++; return { ...p, na: true, fator: null }; }
      aplicaveis++;
      if (r.o === null || r.o === undefined) { pendentes++; return { ...p, pendente: true, fator: 0 }; }
      respondidas++; soma += c.fatores[r.o];
      return { ...p, opcao: r.o, fator: c.fatores[r.o] };
    });
    const pct = aplicaveis ? soma / aplicaveis : null;
    return { id: c.id, nome: c.nome, pontosMax: c.pontos, aplicaveis, respondidas, total: c.perguntas.length, pct, perguntas };
  });
  const base = criterios.filter((c) => c.pct !== null).reduce((s, c) => s + c.pontosMax, 0);
  const escala = base ? 100 / base : 0;
  for (const c of criterios) {
    c.max = c.pct === null ? 0 : c.pontosMax * escala;
    c.pontos = c.pct === null ? 0 : c.pct * c.max;
    for (const p of c.perguntas) {
      p.peso = p.na ? 0 : c.max / c.aplicaveis;
      p.obtido = p.peso * (p.fator || 0);
      p.perdido = p.peso - p.obtido;
    }
  }
  const soma = (l, f) => l.reduce((s, x) => s + f(x), 0);
  const prat = criterios.filter((c) => c.id !== "resultados"), res = criterios.filter((c) => c.id === "resultados");
  const bloco = (l) => { const mx = soma(l, (c) => c.max); return { pontos: soma(l, (c) => c.pontos), max: mx, pct: mx ? soma(l, (c) => c.pontos) / mx : null }; };
  const nota = soma(criterios, (c) => c.pontos);
  const faixas = [...quest.faixas].sort((a, b) => a.ate - b.ate);
  const faixa = faixas.find((f) => nota < f.ate) || faixas[faixas.length - 1];
  const lacunas = criterios.flatMap((c) => c.perguntas.filter((p) => !p.na && !p.pendente && p.perdido > 1e-9).map((p) => ({ ...p, criterio: c.nome, criterioId: c.id })))
    .sort((a, b) => b.perdido - a.perdido);
  return { nota, faixa, faixas, criterios, praticas: bloco(prat), resultados: bloco(res), pendentes, naoAplica, totalPerguntas, completo: pendentes === 0, lacunas };
}
