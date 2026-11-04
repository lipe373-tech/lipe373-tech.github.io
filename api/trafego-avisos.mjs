// Disparada pelo Vercel Cron uma vez por dia (ver vercel.json). Exige CRON_SECRET.
import { timingSafeEqual } from 'node:crypto';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { enviarAvisos } from '../trafego-servidor.mjs';

function autorizado(cabecalho, segredo) {
  const a = Buffer.from(String(cabecalho || '')), b = Buffer.from('Bearer ' + segredo);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || !process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.error('faltam variáveis de ambiente');
    return res.status(500).json({ erro: 'não configurado' });
  }
  if (!autorizado(req.headers.authorization, segredo)) return res.status(401).json({ erro: 'não autorizado' });
  try {
    if (!getApps().length) initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    return res.status(200).json(await enviarAvisos({ db: getFirestore(), messaging: getMessaging() }));
  } catch (e) {
    console.error('falha no aviso diário', e?.code || e?.message);
    return res.status(500).json({ erro: 'falha ao enviar' });
  }
}
