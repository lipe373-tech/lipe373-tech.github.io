/* Aviso diário da aba Tráfego. Recebe db e messaging prontos para poder ser testado sem
   Firebase; a credencial fica só em api/trafego-avisos.mjs. */
import { contasParaAvisar, dataBrasilia, sanitizarConta, textoAviso } from './trafego-calc.mjs';

// só estes códigos significam que o token morreu; outro erro não pode apagar aparelho
const TOKEN_MORTO = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);

async function avisarUsuario(db, messaging, uid, aparelhos, hoje) {
  const base = db.collection('financeiro').doc(uid);
  const [contasSnap, avisosSnap] = await Promise.all([base.collection('trafego_contas').get(), base.collection('trafego_avisos').get()]);
  const contas = contasSnap.docs.map(d => ({ ...sanitizarConta(d.data()), id: d.id }));
  const ultimos = Object.fromEntries(avisosSnap.docs.map(d => [d.id, d.data().dia]));
  const pendentes = contasParaAvisar(contas, ultimos, hoje);
  if (!pendentes.length) return { contas: 0, enviados: 0, removidos: 0 };

  const { titulo, corpo } = textoAviso(pendentes.map(({ conta, previsao }) => ({ nome: conta.clienteNome, diasRestantes: previsao.diasRestantes })));
  const resposta = await messaging.sendEach(aparelhos.map(a => ({
    token: a.token,
    data: { titulo, corpo },
    webpush: { headers: { Urgency: 'high', TTL: '86400' } },
  })));

  const lote = db.batch();
  let removidos = 0;
  resposta.responses.forEach((r, i) => {
    if (!r.success && TOKEN_MORTO.has(r.error?.code)) { lote.delete(aparelhos[i].ref); removidos++; }
  });
  // sem nenhuma entrega, não marca: a conta continua pendente para o próximo envio
  if (resposta.successCount > 0) pendentes.forEach(({ conta }) => lote.set(base.collection('trafego_avisos').doc(conta.id), { dia: hoje }));
  await lote.commit();
  return { contas: pendentes.length, enviados: resposta.successCount, removidos };
}

export async function enviarAvisos({ db, messaging, hoje = dataBrasilia() }) {
  const snap = await db.collectionGroup('trafego_aparelhos').get();
  const porUsuario = new Map();
  snap.docs.forEach(d => {
    const uid = d.ref.parent.parent.id;
    if (!porUsuario.has(uid)) porUsuario.set(uid, []);
    if (d.data().token) porUsuario.get(uid).push({ token: d.data().token, ref: d.ref });
  });
  const total = { usuarios: porUsuario.size, contas: 0, enviados: 0, removidos: 0, falhas: 0 };
  for (const [uid, aparelhos] of porUsuario) {
    if (!aparelhos.length) continue;
    try {
      const r = await avisarUsuario(db, messaging, uid, aparelhos, hoje); // falha de um usuário não impede os outros
      total.contas += r.contas; total.enviados += r.enviados; total.removidos += r.removidos;
    } catch (e) {
      console.error('falha ao avisar usuário', e?.code || e?.message);
      total.falhas++;
    }
  }
  return total;
}
