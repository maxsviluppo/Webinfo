import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

function getDb() {
  if (getApps().length === 0) {
    initializeApp({
      apiKey: process.env.FIREBASE_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN,
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.FIREBASE_APP_ID,
    });
  }
  return getFirestore();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const db = getDb();

  try {
    if (req.method === 'GET') {
      const snap = await getDoc(doc(db, 'configs', 'analytics'));
      return res.status(200).json(snap.exists() ? snap.data() : { trackingId: '', enabled: false, verificationTag: '' });
    }
    if (req.method === 'POST') {
      const { auth, data } = req.body;
      if (!auth || auth.username !== 'admin' || auth.password !== 'accessometti') {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      await setDoc(doc(db, 'configs', 'analytics'), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
      return res.status(200).json({ success: true });
    }
    res.status(405).end();
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}
