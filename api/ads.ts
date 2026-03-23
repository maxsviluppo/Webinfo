import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

// Shared Firebase init
function getDb() {
  if (getApps().length === 0) {
    const config = {
      apiKey: process.env.FIREBASE_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN,
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.FIREBASE_APP_ID,
    };
    initializeApp(config);
  }
  return getFirestore();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const db = getDb();
    const snap = await getDoc(doc(db, 'configs', 'adsense'));
    const data = snap.exists() ? snap.data() : {
      enabled: false, client: '', script: '', adsTxt: '', metaTag: ''
    };

    const adsTxt = data.adsTxt || `google.com, pub-1385801472165821, DIRECT, f08c47fec0942fa0`;
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.status(200).send(adsTxt);
  } catch (e) {
    res.status(200).send('google.com, pub-1385801472165821, DIRECT, f08c47fec0942fa0');
  }
}
