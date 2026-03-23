import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc, increment } from 'firebase/firestore';

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
  if (req.method === 'OPTIONS') return res.status(200).end();

  const db = getDb();
  const today = new Date().toDateString();

  try {
    const snap = await getDoc(doc(db, 'traffic', 'stats'));
    const data = snap.exists() ? snap.data() : { total: 0, today: 0, lastUpdate: today, history: {} };

    // Reset today if new day
    if (data.lastUpdate !== today) {
      data.today = 0;
      data.lastUpdate = today;
    }

    return res.status(200).json({ total: data.total || 0, today: data.today || 0 });
  } catch (e: any) {
    res.status(200).json({ total: 0, today: 0 });
  }
}
