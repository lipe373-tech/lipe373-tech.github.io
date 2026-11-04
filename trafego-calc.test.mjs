// Rodar com: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { preverConta, saldoEstimado, gastoDiario, registrarRecarga, atualizarSaldo, sanitizarConta, dataBrasilia, faixaConta, diasComValor, quantoRecarregar } from './trafego-calc.mjs';

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
