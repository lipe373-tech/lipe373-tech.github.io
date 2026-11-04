// Rodar com: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { preverConta, saldoEstimado, gastoDiario, registrarRecarga, atualizarSaldo, sanitizarConta, dataBrasilia, faixaConta, diasComValor, quantoRecarregar, contasEmAlerta, contasParaAvisar, textoAviso } from './trafego-calc.mjs';
import { enviarAvisos } from './trafego-servidor.mjs';

const HOJE = '2026-11-04';
const camp = (valorDia, extra = {}) => ({ id: String(valorDia), nome: 'c', valorDia, fim: '', status: 'ativa', ...extra });

test('R$ 500 com campanhas de 10, 20 e 30 por dia dura 8 dias', () => {
  const p = preverConta({ saldo: 500, saldoEm: HOJE + 'T12:00:00-03:00', campanhas: [camp(10), camp(20), camp(30)] }, HOJE);
  assert.equal(p.gastoDiario, 60);
  assert.equal(p.diasRestantes, 8);
  assert.equal(p.dataPrevista, '2026-11-12');
  assert.equal(p.semConsumo, false);
});

test('sem campanhas vale o gasto digitado', () => {
  assert.equal(preverConta({ saldo: 100, gastoDiario: 30 }, HOJE).diasRestantes, 3);
});

test('campanhas pausadas e encerradas não contam, e não voltam ao gasto digitado', () => {
  const conta = { saldo: 100, gastoDiario: 50, campanhas: [camp(10, { status: 'pausada' }), camp(20, { fim: '2026-11-03' })] };
  assert.equal(gastoDiario(conta, HOJE), 0);
  const p = preverConta(conta, HOJE);
  assert.equal(p.semConsumo, true);
  assert.equal(p.diasRestantes, null);
  assert.equal(p.dataPrevista, null);
});

test('gasto zero com saldo zero é sem consumo', () => {
  assert.equal(preverConta({ saldo: 0, gastoDiario: 0 }, HOJE).semConsumo, true);
});

test('saldo estimado desconta os dias decorridos e nunca fica negativo', () => {
  assert.equal(saldoEstimado({ saldo: 100, saldoEm: '2026-11-02T12:00:00-03:00', gastoDiario: 30 }, HOJE), 40);
  assert.equal(saldoEstimado({ saldo: 100, saldoEm: '2026-10-01T12:00:00-03:00', gastoDiario: 30 }, HOJE), 0);
});

test('conta zerada com gasto acaba hoje', () => {
  const p = preverConta({ saldo: 10, saldoEm: '2026-11-01T12:00:00-03:00', gastoDiario: 30 }, HOJE);
  assert.equal(p.saldoEstimado, 0);
  assert.equal(p.diasRestantes, 0);
  assert.equal(p.dataPrevista, HOJE);
  assert.equal(p.semConsumo, false);
});

test('campanha que termina antes do saldo acabar: recalcula por trechos', () => {
  // dias 4 e 5: 30 por dia; depois 20 por dia. 100 - 60 = 40, mais 2 dias de 20.
  const p = preverConta({ saldo: 100, campanhas: [camp(10, { fim: '2026-11-05' }), camp(20)] }, HOJE);
  assert.equal(p.diasRestantes, 4);
  assert.equal(p.dataPrevista, '2026-11-08');
});

test('o saldo sobra depois que todas as campanhas terminam: sem consumo', () => {
  const p = preverConta({ saldo: 100, campanhas: [camp(10, { fim: '2026-11-05' })] }, HOJE);
  assert.equal(p.semConsumo, true);
  assert.equal(p.saldoEstimado, 100);
});

test('saldo acaba exatamente no último dia da campanha', () => {
  assert.equal(preverConta({ saldo: 20, campanhas: [camp(10, { fim: '2026-11-05' })] }, HOJE).diasRestantes, 2);
});

test('saldo estimado também usa trechos no passado', () => {
  const conta = { saldo: 100, saldoEm: '2026-11-01T12:00:00-03:00', campanhas: [camp(10, { fim: '2026-11-01' }), camp(5)] };
  assert.equal(saldoEstimado(conta, HOJE), 100 - 15 - 5 - 5);
});

test('centavos não erram no arredondamento para baixo', () => {
  assert.equal(preverConta({ saldo: 0.3, gastoDiario: 0.1 }, HOJE).diasRestantes, 3);
});

test('saldo enorme com gasto mínimo responde na hora', () => {
  const p = preverConta({ saldo: 1e7, gastoDiario: 0.01 }, HOJE);
  assert.equal(p.diasRestantes, 1e9);
  assert.equal(p.dataPrevista, null);
});

test('data de Brasília vira o dia às 3h UTC', () => {
  assert.equal(dataBrasilia('2026-11-05T02:59:00Z'), '2026-11-04');
  assert.equal(dataBrasilia('2026-11-05T03:00:00Z'), '2026-11-05');
});

test('recarga soma ao saldo estimado, reinicia a contagem e grava no histórico', () => {
  const conta = { saldo: 10, saldoEm: '2026-11-01T12:00:00-03:00', gastoDiario: 30, recargas: [] };
  const nova = registrarRecarga(conta, { id: 'r1', valor: 90, obs: 'pix' }, '2026-11-04T12:00:00-03:00');
  assert.equal(nova.saldo, 90);
  assert.equal(nova.saldoEm, '2026-11-04T15:00:00.000Z');
  assert.deepEqual(nova.recargas, [{ id: 'r1', data: HOJE, valor: 90, obs: 'pix' }]);
  assert.equal(conta.recargas.length, 0);
});

test('atualizar saldo substitui o valor e reinicia a contagem', () => {
  const nova = atualizarSaldo({ saldo: 10, saldoEm: '2026-11-01T12:00:00-03:00', gastoDiario: 30 }, 200, '2026-11-04T12:00:00-03:00');
  assert.equal(saldoEstimado(nova, HOJE), 200);
});

test('sanitizarConta aplica padrões e descarta campos desconhecidos', () => {
  const c = sanitizarConta({ clienteNome: 'A', saldo: '12.5', invasor: 1, campanhas: [null, { nome: 'x', valorDia: -5, fim: 'ontem', status: 'qualquer' }] });
  assert.equal(c.saldo, 12.5);
  assert.equal(c.alertaDias, 1);
  assert.equal(c.origem, 'manual');
  assert.equal(c.status, 'ativa');
  assert.equal('invasor' in c, false);
  assert.deepEqual(c.campanhas, [{ id: '', nome: 'x', valorDia: 0, fim: '', status: 'ativa' }]);
  assert.equal(sanitizarConta({ alertaDias: 0 }).alertaDias, 0);
});

test('cores seguem os dias restantes', () => {
  const dias = d => faixaConta({ semConsumo: false, diasRestantes: d, saldoEstimado: 10 });
  assert.deepEqual([0, 1, 2, 3, 4].map(dias), ['vermelho', 'vermelho', 'amarelo', 'amarelo', 'verde']);
  assert.equal(faixaConta({ semConsumo: true, saldoEstimado: 0 }), 'vermelho');
  assert.equal(faixaConta({ semConsumo: true, saldoEstimado: 50 }), 'neutro');
});

test('calculadora: quantos dias dura um valor, ignorando o saldo atual', () => {
  const conta = { saldo: 9999, saldoEm: '2026-11-01T12:00:00-03:00', gastoDiario: 60 };
  assert.equal(diasComValor(conta, 500, HOJE).diasRestantes, 8);
});

test('calculadora: quanto recarregar para durar X dias', () => {
  const conta = { saldo: 100, gastoDiario: 60 };
  const r = quantoRecarregar(conta, 5, HOJE);
  assert.deepEqual(r, { necessario: 300, recarregar: 200 });
  assert.equal(preverConta({ ...conta, saldo: 100 + r.recarregar }, HOJE).diasRestantes, 5);
  assert.equal(quantoRecarregar({ saldo: 1000, gastoDiario: 60 }, 5, HOJE).recarregar, 0);
});

test('calculadora: recarga respeita o término das campanhas', () => {
  const conta = { saldo: 0, campanhas: [camp(10, { fim: '2026-11-05' }), camp(20)] };
  assert.equal(quantoRecarregar(conta, 3, HOJE).recarregar, 30 + 30 + 20);
});

test('alerta respeita o prazo de cada conta e ordena pelos mais urgentes', () => {
  const conta = (nome, saldo, extra = {}) => ({ nome, saldo, gastoDiario: 30, alertaDias: 1, status: 'ativa', ...extra });
  const nomes = contasEmAlerta([
    conta('amanhã', 40),
    conta('hoje', 10),
    conta('3 dias, avisa com 1', 90),
    conta('3 dias, avisa com 3', 90, { alertaDias: 3 }),
    conta('0 dias, avisa com 0', 10, { alertaDias: 0 }),
    conta('1 dia, avisa com 0', 40, { alertaDias: 0 }),
    conta('arquivada', 10, { status: 'arquivada' }),
    conta('sem consumo', 0, { gastoDiario: 0 }),
    conta('saldo sobra', 100, { campanhas: [camp(10, { fim: '2026-11-05' })] }),
  ], HOJE).map(x => x.conta.nome);
  assert.deepEqual(nomes.slice(0, 2).sort(), ['0 dias, avisa com 0', 'hoje']);
  assert.deepEqual(nomes.slice(2), ['amanhã', '3 dias, avisa com 3']);
});

test('texto do aviso', () => {
  const t = (...d) => textoAviso(d.map((diasRestantes, i) => ({ nome: 'Cliente ' + 'ABCDEFG'[i], diasRestantes }))).corpo;
  assert.equal(t(1), 'Cliente A acaba amanhã');
  assert.equal(t(0), 'Cliente A acaba hoje');
  assert.equal(t(1, 1, 1), '3 contas acabam amanhã: Cliente A, Cliente B e Cliente C');
  assert.equal(t(0, 1), '2 contas perto de acabar: Cliente A e Cliente B');
  assert.equal(t(3, 3), '2 contas acabam em 3 dias: Cliente A e Cliente B');
  assert.equal(t(1, 1, 1, 1, 1, 1, 1), '7 contas acabam amanhã: Cliente A, Cliente B, Cliente C, Cliente D, Cliente E e mais 2');
});

test('não repete o aviso da mesma conta no mesmo dia', () => {
  const contas = [{ id: 'a', saldo: 10, gastoDiario: 30, alertaDias: 1, status: 'ativa' }];
  assert.equal(contasParaAvisar(contas, { a: HOJE }, HOJE).length, 0);
  assert.equal(contasParaAvisar(contas, { a: '2026-11-03' }, HOJE).length, 1);
  assert.equal(contasParaAvisar(contas, {}, HOJE).length, 1);
});

/* Firestore e FCM falsos, só com o que o servidor usa. */
function bancoFalso(docs) {
  const banco = new Map(Object.entries(docs));
  const ref = path => ({
    path, id: path.split('/').pop(),
    get parent() { const p = path.split('/').slice(0, -1); return { parent: { id: p[p.length - 2] } }; },
  });
  const snap = chaves => ({ docs: chaves.map(k => ({ id: k.split('/').pop(), ref: ref(k), data: () => banco.get(k) })) });
  const db = {
    banco,
    collectionGroup: nome => ({ get: async () => snap([...banco.keys()].filter(k => k.split('/').at(-2) === nome)) }),
    collection: c => ({
      doc: u => ({
        collection: s => ({
          get: async () => {
            const pre = c + '/' + u + '/' + s + '/';
            if (db.falhaEm === u) throw new Error('falha simulada');
            return snap([...banco.keys()].filter(k => k.startsWith(pre)));
          },
          doc: id => ref(c + '/' + u + '/' + s + '/' + id),
        }),
      }),
    }),
    batch: () => {
      const ops = [];
      return { delete: r => ops.push(() => banco.delete(r.path)), set: (r, d) => ops.push(() => banco.set(r.path, d)), commit: async () => ops.forEach(o => o()) };
    },
  };
  return db;
}
const fcmFalso = (resultado = () => ({ success: true })) => ({
  enviadas: [],
  async sendEach(msgs) {
    this.enviadas.push(...msgs);
    const responses = msgs.map(resultado);
    return { responses, successCount: responses.filter(r => r.success).length };
  },
});
const CONTA = { clienteNome: 'Cliente A', saldo: 40, gastoDiario: 30, alertaDias: 1, status: 'ativa' };

test('servidor: avisa todos os aparelhos e não repete no mesmo dia', async () => {
  const db = bancoFalso({
    'financeiro/u1/trafego_contas/c1': CONTA,
    'financeiro/u1/trafego_aparelhos/x': { token: 't1' },
    'financeiro/u1/trafego_aparelhos/y': { token: 't2' },
  });
  const fcm = fcmFalso();
  const r = await enviarAvisos({ db, messaging: fcm, hoje: HOJE });
  assert.deepEqual(r, { usuarios: 1, contas: 1, enviados: 2, removidos: 0, falhas: 0 });
  assert.equal(fcm.enviadas[0].data.corpo, 'Cliente A acaba amanhã');
  assert.deepEqual(db.banco.get('financeiro/u1/trafego_avisos/c1'), { dia: HOJE });
  await enviarAvisos({ db, messaging: fcm, hoje: HOJE });
  assert.equal(fcm.enviadas.length, 2);
  await enviarAvisos({ db, messaging: fcm, hoje: '2026-11-05' });
  assert.equal(fcm.enviadas.length, 4, 'no dia seguinte avisa de novo os dois aparelhos');
});

test('servidor: cada usuário recebe só as próprias contas', async () => {
  const db = bancoFalso({
    'financeiro/u1/trafego_contas/c1': CONTA,
    'financeiro/u1/trafego_aparelhos/x': { token: 't1' },
    'financeiro/u2/trafego_contas/c2': { ...CONTA, clienteNome: 'Cliente B' },
    'financeiro/u2/trafego_aparelhos/y': { token: 't2' },
  });
  const fcm = fcmFalso();
  await enviarAvisos({ db, messaging: fcm, hoje: HOJE });
  assert.deepEqual(fcm.enviadas.map(m => [m.token, m.data.corpo]), [['t1', 'Cliente A acaba amanhã'], ['t2', 'Cliente B acaba amanhã']]);
});

test('servidor: remove só token morto', async () => {
  const db = bancoFalso({
    'financeiro/u1/trafego_contas/c1': CONTA,
    'financeiro/u1/trafego_aparelhos/morto': { token: 'morto' },
    'financeiro/u1/trafego_aparelhos/rede': { token: 'rede' },
    'financeiro/u1/trafego_aparelhos/bom': { token: 'bom' },
  });
  const fcm = fcmFalso(m => m.token === 'bom' ? { success: true } : { success: false, error: { code: m.token === 'morto' ? 'messaging/registration-token-not-registered' : 'messaging/internal-error' } });
  const r = await enviarAvisos({ db, messaging: fcm, hoje: HOJE });
  assert.equal(r.removidos, 1);
  assert.equal(db.banco.has('financeiro/u1/trafego_aparelhos/morto'), false);
  assert.equal(db.banco.has('financeiro/u1/trafego_aparelhos/rede'), true);
});

test('servidor: sem nenhuma entrega, a conta continua pendente', async () => {
  const db = bancoFalso({ 'financeiro/u1/trafego_contas/c1': CONTA, 'financeiro/u1/trafego_aparelhos/x': { token: 't' } });
  await enviarAvisos({ db, messaging: fcmFalso(() => ({ success: false, error: { code: 'messaging/internal-error' } })), hoje: HOJE });
  assert.equal(db.banco.has('financeiro/u1/trafego_avisos/c1'), false);
});

test('servidor: falha de um usuário não impede os outros', async () => {
  const db = bancoFalso({
    'financeiro/u1/trafego_aparelhos/x': { token: 't1' },
    'financeiro/u2/trafego_contas/c2': CONTA,
    'financeiro/u2/trafego_aparelhos/y': { token: 't2' },
  });
  db.falhaEm = 'u1';
  const erro = console.error; console.error = () => {};
  const r = await enviarAvisos({ db, messaging: fcmFalso(), hoje: HOJE }).finally(() => { console.error = erro; });
  assert.equal(r.falhas, 1);
  assert.equal(r.enviados, 1);
});

test('servidor: sem conta em alerta não envia nada', async () => {
  const db = bancoFalso({ 'financeiro/u1/trafego_contas/c1': { ...CONTA, saldo: 9000 }, 'financeiro/u1/trafego_aparelhos/x': { token: 't' } });
  const fcm = fcmFalso();
  await enviarAvisos({ db, messaging: fcm, hoje: HOJE });
  assert.equal(fcm.enviadas.length, 0);
});
