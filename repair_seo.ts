import { initializeApp } from "firebase/app";
import { getFirestore, collection, doc, setDoc, Timestamp } from "firebase/firestore";
import fs from 'fs';
import path from 'path';

const firebaseConfig = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function repair() {
  console.log("Reparing SEO & Analytics in Firestore...");
  
  // 1. Repair SEO
  if (fs.existsSync('seo_configs.json')) {
    const seoData = JSON.parse(fs.readFileSync('seo_configs.json', 'utf8'));
    for (const [id, data] of Object.entries(seoData)) {
      console.log(`Syncing SEO: ${id}`);
      await setDoc(doc(db, 'seo_configs', id), {
        ...data as any,
        updatedAt: Timestamp.now()
      });
    }
  }

  // 2. Repair Analytics
  if (fs.existsSync('analytics_config.json')) {
    const analyticsData = JSON.parse(fs.readFileSync('analytics_config.json', 'utf8'));
    console.log("Syncing Analytics config...");
    await setDoc(doc(db, 'settings', 'analytics'), {
      ...analyticsData,
      updatedAt: Timestamp.now()
    });
  }

  console.log("Repair completed successfully!");
  process.exit(0);
}

repair().catch(err => {
  console.error("Repair failed:", err);
  process.exit(1);
});
