import express from "express";
import path from "path";
import fs from "fs";
import cors from "cors";
import Parser from "rss-parser";
import * as cheerio from "cheerio";
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

// Initialize Gemini AI (Universal SDK)
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

// Load Firebase Config for Cloud Sync
let db: any = null;
try {
  const firebaseConfigPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(firebaseConfigPath)) {
    const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf-8"));
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    console.log("[Firebase] initialized for backend sync");
  } else if (process.env.FIREBASE_CONFIG) {
    const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    console.log("[Firebase] initialized from ENV");
  }
} catch (e) {
  console.warn("[Firebase] Could not initialize sync:", e instanceof Error ? e.message : String(e));
}

const DATA_DIR = path.join(process.cwd(), ".data");
if (process.env.VERCEL !== '1' && !fs.existsSync(DATA_DIR)) {
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch(e) {}
}

const SEO_FILE = path.join(DATA_DIR, "seo_configs.json");
const SOURCES_FILE = path.join(DATA_DIR, "news_sources.json");
const ANALYTICS_FILE = path.join(DATA_DIR, "analytics_config.json");
const TRAFFIC_FILE = path.join(DATA_DIR, "traffic_stats.json");
const ADSENSE_FILE = path.join(DATA_DIR, "adsense_config.json");

// Unified Cache for RSS Feeds
let serverNewsCache: any[] = [];
let lastServerFetchTime = 0;
const SERVER_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Default SEO data
const DEFAULT_SEO = {
  all: {
    title: "SpotSmart Notizie 2024-2025 | Il tuo Hub Intelligente di Informazione",
    description: "SpotSmart 2024/2025: Il tuo hub intelligente per le notizie in tempo reale. Cronaca, Mondo, Tecnologia, Finanza e Scienza in un'unica piattaforma innovativa.",
    keywords: "notizie oggi, news tempo reale, attualità 2025, aggregatore notizie, informazione intelligente, spotsmart",
    url: "https://spotsmart.it/explore/all"
  }
};

const DEFAULT_ADSENSE = { enabled: false, client: "", script: "", adsTxt: "", metaTag: "" };
const DEFAULT_SOURCES = [
  { id: "si-001", url: "https://www.ansa.it/sito/ansait_rss.xml", cat: "Cronaca", name: "ANSA" },
  { id: "si-002", url: "https://www.tgcom24.mediaset.it/rss/homepage.xml", cat: "Cronaca", name: "TGCOM24" },
  { id: "si-037", url: "https://www.ilsole24ore.com/rss/finanza.xml", cat: "Finanza", name: "Il Sole 24 Ore" },
  { id: "si-024", url: "https://www.hdblog.it/feed/", cat: "Tecnologia", name: "HD Blog" },
  { id: "si-047", url: "https://www.gazzetta.it/rss/home.xml", cat: "Sport", name: "Gazzetta" }
];

let cachedSeo: any = null;
let cachedAdSense: any = null;
let cachedAnalytics: any = null;
let cachedSources: any = null;
let lastSync = 0;

async function syncCloudConfigs() {
  if (!db) return;
  const now = Date.now();
  if (now - lastSync < 60000 && cachedAdSense) return;

  try {
    const adsDoc = await getDoc(doc(db, 'configs', 'adsense'));
    if (adsDoc.exists()) cachedAdSense = adsDoc.data();
    
    const anaDoc = await getDoc(doc(db, 'configs', 'analytics'));
    if (anaDoc.exists()) cachedAnalytics = anaDoc.data();

    const seoDoc = await getDoc(doc(db, 'configs', 'seo'));
    if (seoDoc.exists()) cachedSeo = seoDoc.data();
    
    const srcDoc = await getDoc(doc(db, 'configs', 'sources'));
    if (srcDoc.exists()) cachedSources = srcDoc.data();
    
    lastSync = now;
    console.log("[Cloud] Configs synced");
  } catch (e) {
    console.warn("[Cloud] Sync failed:", e);
  }
}

function getSources() {
  if (cachedSources) return cachedSources;
  try { return JSON.parse(fs.readFileSync(SOURCES_FILE, "utf-8")); } catch (err) { return DEFAULT_SOURCES; }
}

const parser = new Parser({
  customFields: {
    item: [
      ['media:content', 'media:content', { keepArray: true }],
      ['media:thumbnail', 'media:thumbnail'],
      ['content:encoded', 'content:encoded'],
      ['image', 'image'],
      ['thumbnail', 'thumbnail'],
      ['yt:videoId', 'yt:videoId']
    ]
  }
});

function cleanXmlContent(xml: string): string {
  let cleaned = xml.replace(/&(?!(?:[a-zA-Z0-9]+|#[0-9]+|#x[0-9a-fA-F]+);)/g, '&amp;');
  cleaned = cleaned.replace(/<(title|description|content:encoded)>([\s\S]*?)<\/\1>/g, (match, tag, content) => {
    if (content.includes('<') && !content.trim().startsWith('<![CDATA[')) {
      return `<${tag}><![CDATA[${content}]]></${tag}>`;
    }
    return match;
  });
  return cleaned;
}

async function fetchMetaInfo(url: string) {
  if (!url) return { image: null, video: null };
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); 
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    clearTimeout(timeoutId);
    if (!response.ok) return { image: null, video: null };
    const html = await response.text();
    const $ = cheerio.load(html);
    let image = $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content');
    let video = $('meta[property="og:video:url"]').attr('content') || $('meta[name="twitter:player"]').attr('content') || $('iframe[src*="youtube.com"]').attr('src');
    if (video && video.includes('youtube.com')) {
       const ytId = video.match(/(?:v=|embed\/|watch\?v=)([a-zA-Z0-9_-]{11})/)?.[1];
       if (ytId) video = `https://www.youtube.com/embed/${ytId}`;
    }
    return { image: image || null, video: video || null };
  } catch (e) { return { image: null, video: null }; }
}

function extractImageUrl(item: any) {
  const contentEncoded = item["content:encoded"] || item.content || item.description || "";
  if (item.enclosure?.url?.match(/\.(jpg|jpeg|png|webp|gif)/i)) return item.enclosure.url;
  const mediaTags = ["media:content", "media:thumbnail", "image", "enclosure", "thumb"];
  for (const tag of mediaTags) {
    const content = item[tag];
    if (content) {
      if (Array.isArray(content)) {
        const first = content.find((c: any) => (c.url || c.$?.url)?.match(/\.(jpg|jpeg|png|webp|gif)/i));
        if (first) return first.url || first.$?.url;
      }
      if (content.url || content.$?.url) return content.url || content.$?.url;
    }
  }
  const imgMatch = contentEncoded.match(/<img[^>]+(?:src|data-src)=["']([^"'> ]+)["']/i);
  return imgMatch ? imgMatch[1] : null;
}

function extractVideoUrl(item: any) {
  const content = (item.content || item["content:encoded"] || item.description || "").toLowerCase();
  const ytMatch = content.match(/https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
  return ytMatch ? `https://www.youtube.com/embed/${ytMatch[1]}` : null;
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/news", async (req, res) => {
  const now = Date.now();
  const forceRefresh = req.query.refresh === 'true';
  if (!forceRefresh && serverNewsCache.length > 0 && (now - lastServerFetchTime < SERVER_CACHE_DURATION)) {
    return res.json(serverNewsCache);
  }

  try {
    const sources = getSources().filter((s: any) => s.active !== false).slice(0, 40);
    const feedPromises = sources.map(async (source: any) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000); 
      try {
        const response = await fetch(source.url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
        clearTimeout(timeoutId);
        if (!response.ok) return [];
        const xml = cleanXmlContent(await response.text());
        const feed = await parser.parseString(xml);
        return await Promise.all(feed.items.slice(0, 20).map(async (item) => {
          let image = extractImageUrl(item);
          let video = extractVideoUrl(item);
          if (!image) {
            const extra = await fetchMetaInfo(item.link || "");
            image = extra.image; if (!video) video = extra.video;
          }
          return {
            id: item.guid || item.link || Math.random().toString(),
            title: item.title,
            url: item.link,
            summary: (item.contentSnippet || item.summary || "").substring(0, 280) + "...",
            category: source.cat || "General",
            source: source.name || "Unknown",
            imageUrl: image || `https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&q=80&w=1600`,
            videoUrl: video || null,
            timestamp: item.pubDate ? new Date(item.pubDate).getTime() : now
          };
        }));
      } catch (e) { return []; }
    });

    const results = await Promise.allSettled(feedPromises);
    const allItems: any[] = [];
    results.forEach(res => { if (res.status === 'fulfilled') allItems.push(...res.value); });
    
    const today = new Date(); today.setHours(0,0,0,0);
    const sorted = allItems.sort((a,b) => b.timestamp - a.timestamp).slice(0, 400);
    
    serverNewsCache = sorted;
    lastServerFetchTime = now;
    res.json(sorted);
  } catch (e) { res.json(serverNewsCache); }
});

app.get("/api/admin/:type", async (req, res) => {
  await syncCloudConfigs();
  const { type } = req.params;
  if (type === 'seo') return res.json(cachedSeo || DEFAULT_SEO);
  if (type === 'adsense') return res.json(cachedAdSense || DEFAULT_ADSENSE);
  if (type === 'analytics') return res.json(cachedAnalytics || {});
  if (type === 'sources') return res.json(getSources());
  res.status(404).send("Not Found");
});

app.post("/api/admin/:type", async (req, res) => {
    const { type } = req.params;
    const { auth, data, sources, category } = req.body;
    if (auth?.username !== 'admin' || auth?.password !== 'accessometti') return res.status(401).send("Unauthorized");
    
    if (type === 'seo' && category) {
       const current = cachedSeo || DEFAULT_SEO;
       current[category] = data;
       if (db) await setDoc(doc(db, 'configs', 'seo'), current).catch(console.error);
       if (process.env.VERCEL !== '1') fs.writeFileSync(SEO_FILE, JSON.stringify(current, null, 2));
    }
    
    if (type === 'adsense') {
       if (db) await setDoc(doc(db, 'configs', 'adsense'), data).catch(console.error);
       if (process.env.VERCEL !== '1') fs.writeFileSync(ADSENSE_FILE, JSON.stringify(data, null, 2));
    }

    if (type === 'sources') {
       if (db) await setDoc(doc(db, 'configs', 'sources'), sources).catch(console.error);
       if (process.env.VERCEL !== '1') fs.writeFileSync(SOURCES_FILE, JSON.stringify(sources, null, 2));
    }

    res.send("Saved");
});

app.get("/api/proxy", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send("URL required");
  try {
    const response = await fetch(url as string, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    let html = await response.text();
    const baseUrl = new URL(url as string).origin;
    html = html.replace("<head>", `<head><base href="${baseUrl}/">`);
    res.setHeader("Content-Type", "text/html");
    res.send(html);
  } catch (e) { res.status(500).send("Proxy failed"); }
});

app.get("/ads.txt", async (req, res) => {
    await syncCloudConfigs();
    res.setHeader("Content-Type", "text/plain");
    res.send(cachedAdSense?.adsTxt || "");
});

export default app;
