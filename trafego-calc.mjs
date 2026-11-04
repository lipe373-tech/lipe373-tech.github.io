/* Cálculos da aba Tráfego. Sem dependências: o mesmo arquivo serve ao app e ao cron.
   Datas são 'AAAA-MM-DD' no fuso de Brasília; dinheiro é calculado em centavos para
   evitar erro de arredondamento (0,30 / 0,10 tem que dar 3, não 2). */

const FUSO = 'America/Sao_Paulo';
const centavos = v => Math.round((Number(v) || 0) * 100);
const reais = c => c / 100;

export function dataBrasilia(agora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(agora));
}
const utc = dia => Date.parse(dia + 'T00:00:00Z');
export const diasEntre = (de, ate) => Math.round((utc(ate) - utc(de)) / 86400000);
export const somarDias = (dia, n) => new Date(utc(dia) + n * 86400000).toISOString().slice(0, 10);

const campanhasDe = conta => (Array.isArray(conta.campanhas) ? conta.campanhas : []);
const rodaNoDia = (c, dia) => c.status === 'ativa' && (!c.fim || dia <= c.fim); // o dia do término ainda gasta

function gastoCentavos(conta, dia) {
  const campanhas = campanhasDe(conta);
  if (!campanhas.length) return centavos(conta.gastoDiario);
  return campanhas.filter(c => rodaNoDia(c, dia)).reduce((soma, c) => soma + centavos(c.valorDia), 0);
}
export const gastoDiario = (conta, hoje) => reais(gastoCentavos(conta, hoje));

function saldoEstimadoCentavos(conta, hoje) {
  let saldo = centavos(conta.saldo);
  if (!conta.saldoEm) return Math.max(0, saldo);
  // cada dia já decorrido desconta o gasto que valia naquele dia
  for (let dia = dataBrasilia(conta.saldoEm); dia < hoje && saldo > 0; dia = somarDias(dia, 1)) saldo -= gastoCentavos(conta, dia);
  return Math.max(0, saldo);
}
export const saldoEstimado = (conta, hoje) => reais(saldoEstimadoCentavos(conta, hoje));

/* Próximo dia em que o gasto muda: o dia seguinte ao término mais próximo. */
function proximaMudanca(conta, dia) {
  const fins = campanhasDe(conta).filter(c => rodaNoDia(c, dia) && c.fim).map(c => c.fim).sort();
  return fins.length ? somarDias(fins[0], 1) : null;
}

/* Previsão da conta. diasRestantes e dataPrevista ficam null quando semConsumo é true:
   sem gasto hoje, ou o saldo sobra depois que todas as campanhas terminam. */
export function preverConta(conta, hoje = dataBrasilia()) {
  const saldoInicial = saldoEstimadoCentavos(conta, hoje);
  const resultado = { saldoEstimado: reais(saldoInicial), gastoDiario: gastoDiario(conta, hoje), diasRestantes: null, dataPrevista: null, semConsumo: true };
  // acima de 100 anos não há data útil a mostrar (e Date estoura com valores absurdos)
  const acabaEm = dias => ({ ...resultado, diasRestantes: dias, dataPrevista: dias > 36500 ? null : somarDias(hoje, dias), semConsumo: false });
  let saldo = saldoInicial, dias = 0, dia = hoje;
  for (;;) {
    const gasto = gastoCentavos(conta, dia);
    if (gasto <= 0) return saldo <= 0 && dias > 0 ? acabaEm(dias) : resultado;
    const mudanca = proximaMudanca(conta, dia);
    const duracao = mudanca ? diasEntre(dia, mudanca) : Infinity;
    const cabem = Math.floor(saldo / gasto);
    if (cabem < duracao) return acabaEm(dias + cabem);
    saldo -= gasto * duracao;
    dias += duracao;
    dia = mudanca;
  }
}

/* Cor do cartão: vermelho hoje, amanhã ou zerado; amarelo 2 ou 3 dias; verde mais de 3. */
export function faixaConta(p) {
  if (p.semConsumo) return p.saldoEstimado <= 0 ? 'vermelho' : 'neutro';
  return p.diasRestantes <= 1 ? 'vermelho' : p.diasRestantes <= 3 ? 'amarelo' : 'verde';
}

/* Calculadora: quanto tempo dura um valor, com o gasto atual e os términos já cadastrados. */
export const diasComValor = (conta, valor, hoje = dataBrasilia()) => preverConta({ ...conta, saldo: valor, saldoEm: '' }, hoje);

/* Calculadora inversa: quanto recarregar para a conta durar X dias a partir de hoje. */
export function quantoRecarregar(conta, dias, hoje = dataBrasilia()) {
  let total = 0;
  for (let i = 0; i < Math.min(dias, 3650); i++) total += gastoCentavos(conta, somarDias(hoje, i));
  return { necessario: reais(total), recarregar: reais(Math.max(0, total - saldoEstimadoCentavos(conta, hoje))) };
}

/* Recarga soma ao saldo estimado (não ao informado) e reinicia a contagem: conta zerada
   há dias não pode "dever" o gasto desses dias depois de recarregada. */
export function registrarRecarga(conta, { id, valor, data, obs = '' }, agora = new Date()) {
  const quando = new Date(agora);
  const base = saldoEstimadoCentavos(conta, dataBrasilia(quando));
  return {
    ...conta,
    saldo: reais(base + centavos(valor)),
    saldoEm: quando.toISOString(),
    recargas: [...(conta.recargas || []), { id, data: data || dataBrasilia(quando), valor: Number(valor) || 0, obs }],
  };
}
export const atualizarSaldo = (conta, valor, agora = new Date()) => ({ ...conta, saldo: Number(valor) || 0, saldoEm: new Date(agora).toISOString() });

/* Limpa os dados antes de gravar ou ao carregar: só campos conhecidos, com tipo e tamanho.
   Os limites devem bater com contaValida() em firestore.rules. */
const texto = (v, max = 500) => (v == null ? '' : String(v)).slice(0, max);
const numero = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };
const dataOuVazio = v => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '');
const lista = (v, max, fn) => (Array.isArray(v) ? v : []).filter(x => x && typeof x === 'object').slice(-max).map(fn);

export function sanitizarConta(x = {}) {
  return {
    clienteNome: texto(x.clienteNome, 200),
    clienteId: texto(x.clienteId, 60),
    origem: x.origem === 'meta' ? 'meta' : 'manual',
    metaId: texto(x.metaId, 60),
    saldo: numero(x.saldo),
    saldoEm: texto(x.saldoEm, 40),
    gastoDiario: numero(x.gastoDiario),
    campanhas: lista(x.campanhas, 100, c => ({ id: texto(c.id, 60), nome: texto(c.nome, 200), valorDia: numero(c.valorDia), fim: dataOuVazio(c.fim), status: c.status === 'pausada' ? 'pausada' : 'ativa' })),
    recargas: lista(x.recargas, 1000, r => ({ id: texto(r.id, 60), data: dataOuVazio(r.data), valor: numero(r.valor), obs: texto(r.obs) })),
    alertaDias: x.alertaDias == null || x.alertaDias === '' ? 1 : Math.min(60, Math.floor(numero(x.alertaDias))),
    obs: texto(x.obs, 4000),
    status: x.status === 'arquivada' ? 'arquivada' : 'ativa',
  };
}
