import express from "express";
import { createServer as createViteServer } from "vite";
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
  const firebaseConfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), "firebase-applet-config.json"), "utf-8"));
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  console.log("[Firebase] initialized for backend sync");
} catch (e) {
  console.warn("[Firebase] Could not initialize sync, falling back to local files only:", e instanceof Error ? e.message : String(e));
}

const DATA_DIR = path.join(process.cwd(), ".data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

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
  },
  cronaca: {
    title: "Ultime Notizie Cronaca Italia 2024-2025 | SpotSmart Live",
    description: "Resta aggiornato sulla cronaca italiana e internazionale: le ultime notizie, inchieste e approfondimenti sui fatti che contano. Aggiornamenti real-time da ANSA e Adnkronos.",
    keywords: "cronaca italia oggi, notizie cronaca ultime ore, inchieste giudiziarie, sicurezza urbana 2025, politica italiana news",
    url: "https://spotsmart.it/explore/cronaca"
  },
  mondo: {
    title: "Notizie dal Mondo e Geopolitica 2025 | SpotSmart Estero",
    description: "Analisi approfondite su geopolitica, conflitti e sfide globali. Rimani informato sugli eventi che plasmano il nostro futuro con Reuters, BBC e fonti internazionali.",
    keywords: "notizie internazionali, geopolitica 2025, crisi medio oriente, elezioni usa 2024 analisi, breaking news mondo",
    url: "https://spotsmart.it/explore/mondo"
  },
  regioni: {
    title: "Notizie Locali e Cronaca Regionale | SpotSmart Territorio",
    description: "Le voci del territorio italiano in tempo reale. Cronaca, eventi e politica locale da Messaggero, Gazzettino e le principali testate regionali.",
    keywords: "notizie locali, cronaca regionale, news territorio, gazzettino, messaggero, eventi città italia",
    url: "https://spotsmart.it/explore/regioni"
  },
  tecnologia: {
    title: "Tecnologia, AI e Innovazione 2025 | SpotSmart Tech",
    description: "Scopri le innovazioni in AI generativa, robotica e cybersecurity. Il tuo portale sulle tendenze tech che stanno ridefinendo il futuro con Wired e TechCrunch.",
    keywords: "tecnologia 2025, ai generativa news, cybersecurity aziendale, robotica avanzata, realtà virtuale news, innovazione digitale",
    url: "https://spotsmart.it/explore/tecnologia"
  },
  finanza: {
    title: "Economia e Finanza: Mercati e Borse 2025 | SpotSmart Business",
    description: "Previsioni mercati globali, investimenti e andamento economico. Analisi per decisioni informate con Il Sole 24 Ore e CNBC. Borsa Italiana in tempo reale.",
    keywords: "mercati finanziari 2025, investimenti sicuri, borsa italiana oggi, inflazione italia news, economy globale, trading online",
    url: "https://spotsmart.it/explore/finanza"
  },
  sport: {
    title: "Ultime Notizie Sport, Risultati e Calciomercato | SpotSmart Sport",
    description: "Tutte le ultime notizie su Calcio Serie A, Tennis ATP, F1 e Olimpiadi. Risultati in diretta, interviste e analisi esclusive dalla Gazzetta e Tuttosport.",
    keywords: "risultati serie a 2025, calciomercato live, tennis atp news, formula 1 oggi, moto gp risultati, sport news italia",
    url: "https://spotsmart.it/explore/sport"
  },
  scienza: {
    title: "Scienza, Spazio e Medicina 2025 | SpotSmart Science",
    description: "Le scoperte che cambiano il mondo. Dalle missioni spaziali NASA ai progressi della medicina e ricerca scientifica. Resta aggiornato con Nature e ScienceDaily.",
    keywords: "scoperte scientifiche 2025, esplorazione spaziale, news medicina 2024, astronomia nasa, ricerca scientifica innovazione",
    url: "https://spotsmart.it/explore/scienza"
  },
  cultura: {
    title: "Cultura, Arte e Tendenze Sociali 2025 | SpotSmart Culture",
    description: "Esplora le nuove tendenze artistiche, letterarie e sociali. Approfondimenti su eventi, mostre e il dibattito culturale contemporaneo in Italia e nel mondo.",
    keywords: "eventi culturali 2025, arte contemporanea news, libri novità, festival cinema italia, tendenze sociali, mostre d'arte",
    url: "https://spotsmart.it/explore/cultura"
  },
  salute: {
    title: "Salute, Benessere e News Sanità Italia | SpotSmart Health",
    description: "Le ultime notizie sulla sanità pubblica, consigli per il benessere e aggiornamenti sulla prevenzione. Prendi cura di te con informazioni mediche affidabili.",
    keywords: "sanità italia 2025, benessere mentale news, prevenzione malattie, alimentazione sana, news medicina, stili di vita sani",
    url: "https://spotsmart.it/explore/salute"
  }
};

// Default AdSense data
const DEFAULT_ADSENSE = {
  enabled: false,
  client: "", // e.g. ca-pub-XXXXXXXXXXXXXXXX
  script: "", // Full script snippet
  adsTxt: "", // Content for ads.txt
  metaTag: "" // Meta tag verification
};

// Initialize files if missing
if (!fs.existsSync(SEO_FILE)) fs.writeFileSync(SEO_FILE, JSON.stringify(DEFAULT_SEO, null, 2));
if (!fs.existsSync(ANALYTICS_FILE)) fs.writeFileSync(ANALYTICS_FILE, JSON.stringify({ trackingId: "", enabled: true, verificationTag: "" }, null, 2));
if (!fs.existsSync(ADSENSE_FILE)) fs.writeFileSync(ADSENSE_FILE, JSON.stringify(DEFAULT_ADSENSE, null, 2));


let cachedSeo: any = null;
function getSeoConfigs() {
  if (cachedSeo) return cachedSeo;
  try { 
    cachedSeo = JSON.parse(fs.readFileSync(SEO_FILE, "utf-8")); 
    return cachedSeo;
  } catch (err) { return DEFAULT_SEO; }
}
function saveSeoConfigs(configs: any) { 
  cachedSeo = configs;
  fs.writeFileSync(SEO_FILE, JSON.stringify(configs, null, 2)); 
}

// Config Cache for Production/Cloud
let cachedAdSense: any = null;
let cachedAnalytics: any = null;
let lastSync = 0;

async function syncCloudConfigs() {
  if (!db) return;
  const now = Date.now();
  if (now - lastSync < 60000 && cachedAdSense) return; // Sync every 60s max per instance

  try {
    const adsDoc = await getDoc(doc(db, 'configs', 'adsense'));
    if (adsDoc.exists()) cachedAdSense = adsDoc.data();
    
    const anaDoc = await getDoc(doc(db, 'configs', 'analytics'));
    if (anaDoc.exists()) cachedAnalytics = anaDoc.data();

    const seoDoc = await getDoc(doc(db, 'configs', 'seo'));
    if (seoDoc.exists()) cachedSeo = seoDoc.data();
    
    lastSync = now;
    console.log("[Cloud] All configs synced from Firestore");
  } catch (e) {
    console.warn("[Cloud] Sync failed, using local/cache fallback:", e);
  }
}

function getAnalytics() {
  if (cachedAnalytics) return cachedAnalytics;
  try { return JSON.parse(fs.readFileSync(ANALYTICS_FILE, "utf-8")); } 
  catch (err) { return { trackingId: "", enabled: true, verificationTag: "" }; }
}
function saveAnalytics(data: any) { 
  try { fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(data, null, 2)); } catch(e) {}
}

function getAdSense() {
  if (cachedAdSense) return cachedAdSense;
  try { return JSON.parse(fs.readFileSync(ADSENSE_FILE, "utf-8")); } 
  catch (err) { return DEFAULT_ADSENSE; }
}
function saveAdSense(data: any) { 
  try { fs.writeFileSync(ADSENSE_FILE, JSON.stringify(data, null, 2)); } catch(e) {}
}

const DEFAULT_SOURCES = [
  { id: "si-001", url: "https://www.ansa.it/sito/ansait_rss.xml", cat: "Cronaca", name: "ANSA" },
  { id: "si-002", url: "https://www.tgcom24.mediaset.it/rss/homepage.xml", cat: "Cronaca", name: "TGCOM24" },
  { id: "si-037", url: "https://www.ilsole24ore.com/rss/finanza.xml", cat: "Finanza", name: "Il Sole 24 Ore" },
  { id: "si-024", url: "https://www.hdblog.it/feed/", cat: "Tecnologia", name: "HD Blog" },
  { id: "si-047", url: "https://www.gazzetta.it/rss/home.xml", cat: "Sport", name: "Gazzetta" }
];

function getSources() {
  try { 
    const sources = JSON.parse(fs.readFileSync(SOURCES_FILE, "utf-8")); 
    return (Array.isArray(sources) && sources.length > 0) ? sources : DEFAULT_SOURCES;
  } catch (err) { return DEFAULT_SOURCES; }
}
function saveSources(sources: any) { fs.writeFileSync(SOURCES_FILE, JSON.stringify(sources, null, 2)); }

// Memory Buffers for Traffic to prevent Watcher Loops
let memoryTraffic = { total: 0, today: 0, lastUpdate: new Date().toDateString(), history: {} };
try {
  const data = JSON.parse(fs.readFileSync(TRAFFIC_FILE, "utf-8"));
  if (data.lastUpdate === memoryTraffic.lastUpdate) {
     memoryTraffic = data;
  } else {
     memoryTraffic = { ...data, today: 0, lastUpdate: memoryTraffic.lastUpdate };
  }
} catch (e) {}
let isTrafficDirty = false;

function recordVisit() {
  const today = new Date().toDateString();
  if (memoryTraffic.lastUpdate !== today) {
     memoryTraffic.today = 0;
     memoryTraffic.lastUpdate = today;
  }
  memoryTraffic.total += 1;
  memoryTraffic.today += 1;
  memoryTraffic.history[today] = (memoryTraffic.history[today] || 0) + 1;
  isTrafficDirty = true;
  return memoryTraffic;
}

function resetTraffic() {
  memoryTraffic = { 
    total: 0, 
    today: 0, 
    lastUpdate: new Date().toDateString(), 
    history: {} 
  };
  isTrafficDirty = true;
  // Also try to clear in Firestore if we have a connection
  if (db) {
     setDoc(doc(db, 'traffic', 'stats'), { ...memoryTraffic, lastUpdate: memoryTraffic.lastUpdate })
       .catch(e => console.error("[Cloud] Traffic reset sync failed:", e));
  }
  return memoryTraffic;
}

// Persist to disk every 30 seconds if dirty, to avoid triggering watchers constantly
setInterval(() => {
  if (isTrafficDirty) {
    try {
      fs.writeFileSync(TRAFFIC_FILE, JSON.stringify(memoryTraffic, null, 2));
      isTrafficDirty = false;
    } catch (e) {
      console.error("[Traffic] Failed to persist stats:", e);
    }
  }
}, 30000);

// Global app object
const app = express();

// AI Analysis Endpoint
app.post("/api/ai/analyze", express.json(), async (req, res) => {
  const { title, summary, content } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    return res.status(500).json({ error: "AI Key missing or default in .env" });
  }

  try {
    const prompt = `Analizza questa notizia e scrivi un commento editoriale originale di massimo 3 paragrafi. 
    Aggiungi anche una sezione "Inside Info" con 3 punti chiave. 
    Rispondi sempre in italiano professionale ed elegante.
    Notizia: 
    Titolo: ${title}
    Riassunto: ${summary}
    Testo: ${content || ""}`;

    const result = await ai.models.generateContent({
      model: "gemini-1.5-flash-8b",
      contents: [{ role: "user", parts: [{ text: prompt }] }]
    });

    res.json({ analysis: result.text });
  } catch (e) {
    console.error("AI Analysis error:", e);
    res.status(500).send("Analysis failed");
  }
});

// Legal & Static Pages for AdSense Approval
const getLegalTemplate = (title: string, content: string) => `
<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | SpotSmart</title>
  <style>
    body { font-family: sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 40px 20px; background: #020617; color: #fff; }
    h1 { color: #4f46e5; border-bottom: 2px solid #1e293b; padding-bottom: 10px; }
    p { color: #94a3b8; }
    .btn { display: inline-block; background: #4f46e5; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; margin-top: 20px; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <div class="content">${content}</div>
  <a href="/" class="btn">Torna alla Home</a>
</body>
</html>
`;

app.get("/privacy", (req, res) => res.send(getLegalTemplate("Privacy Policy", "<p>La tua privacy è importante per noi. Questa informativa spiega come raccogliamo e trattiamo i tuoi dati su SpotSmart...</p>")));
app.get("/terms", (req, res) => res.send(getLegalTemplate("Termini di Servizio", "<p>Utilizzando SpotSmart accetti i seguenti termini e condizioni d'uso...</p>")));
app.get("/contacts", (req, res) => res.send(getLegalTemplate("Contatti", "<p>Per supporto o informazioni editoriali: <strong>info@spotsmart.it</strong><br>Sede: Italia</p>")));

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

// Helper for SEO Injection
function injectMetadata(html: string, config: any, analytics: any, adsense: any, reqUrl: string, newsHtml = "") {
  const gaScript = (analytics?.enabled && analytics?.trackingId) ? `
    <script async src="https://www.googletagmanager.com/gtag/js?id=${analytics.trackingId}"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', '${analytics.trackingId}');
    </script>
  ` : '';

  let adsenseHead = "";
  let adsenseBody = "";
  
  if (adsense?.enabled && adsense?.script) {
     const scriptStr = adsense.script.trim();
     if (scriptStr.includes('<amp-auto-ads')) {
        // Extract script part for head
        const scriptMatch = scriptStr.match(/<script.*?src=.*?amp-auto-ads.*?><\/script>/i);
        adsenseHead = scriptMatch ? scriptMatch[0] : "";
        
        // Extract tag part for body
        const tagMatch = scriptStr.match(/<amp-auto-ads.*?>.*?<\/amp-auto-ads>/i);
        adsenseBody = tagMatch ? tagMatch[0] : "";
        
        // If they provided both but regex failed or they are separate, try to find the tag anywhere
        if (!adsenseBody && scriptStr.includes('<amp-auto-ads')) {
           adsenseBody = scriptStr.includes('</amp-auto-ads>') 
              ? scriptStr.substring(scriptStr.indexOf('<amp-auto-ads'), scriptStr.indexOf('</amp-auto-ads>') + 15)
              : scriptStr; 
        }
     } else {
        adsenseHead = scriptStr;
     }
  }

  const adsenseMeta = (adsense?.enabled && adsense?.metaTag && adsense?.metaTag.trim().startsWith('<')) ? adsense.metaTag : '';
  const analyticsMeta = (analytics?.enabled && analytics?.verificationTag && analytics?.verificationTag.trim().startsWith('<')) ? analytics.verificationTag : '';

  let injected = html;
  
  // 1. Title
  injected = injected.replace(/<title>(.*?)<\/title>/i, `<title>${config?.title || "SpotSmart"}</title>`);
  
  // 2. Head Tags
  const headTags = `
    <meta name="description" content="${config?.description || ""}" />
    <meta name="keywords" content="${config?.keywords || ""}" />
    <meta property="og:title" content="${config?.title || ""}" />
    <meta property="og:description" content="${config?.description || ""}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://spotsmart.it${reqUrl}" />
    <link rel="canonical" href="https://spotsmart.it${reqUrl}" />
    ${analyticsMeta}
    ${adsenseMeta}
    ${adsenseHead}
    ${gaScript}
  `;
  
  injected = injected.replace(/<\/head>/i, `${headTags}</head>`);
  
  // 3. Body Tags (right after <body>)
  if (adsenseBody) {
     injected = injected.replace(/<body.*?>/i, (match) => `${match}\n${adsenseBody}`);
  }

  // 4. SSR Content for AdSense Bot
  if (newsHtml) {
    const ssrSection = `
      <div id="ssr-news-content" style="opacity: 0.01; position: absolute; top: -10000px;">
        <header><h1>SpotSmart News Feed - ${config?.title}</h1></header>
        <section>${newsHtml}</section>
        <footer>
          <p>© 2024 SpotSmart - Informazione Intelligente</p>
          <nav><a href="/privacy">Privacy Policy</a> | <a href="/terms">Termini e Condizioni</a> | <a href="/contacts">Contatti</a></nav>
        </footer>
      </div>
    `;
    injected = injected.replace(/<div id="root"><\/div>/i, `${ssrSection}<div id="root"></div>`);
  }

  return injected;
}

app.use(cors());
app.use(express.json());

// Ads.txt for AdSense
app.get("/ads.txt", async (req, res) => {
  await syncCloudConfigs();
  const adsense = getAdSense();
  res.header("Content-Type", "text/plain");
  res.send(adsense.adsTxt || "google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0");
});

// Proxy for Article Loading (Improved with Reading Mode & Stability)
app.get("/api/proxy", async (req, res) => {
  const url = req.query.url as string;
  const mode = req.query.mode as string; // 'read' for reader view
  
  if (!url) return res.status(400).send("URL is required");

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });

    if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);

    let html = await response.text();
    const $ = cheerio.load(html);
    
    // Inject <base> tag to fix relative links
    const baseUrl = new URL(url).origin;
    const baseTag = `<base href="${baseUrl}/">`;

    if (mode === 'read') {
      // READING MODE: Extract only relevant content
      // Remove noise
      $('script, style, iframe, ads, .ads, .adv, aside, header, footer, nav, .menu, .sidebar, .comments, .related').remove();
      
      // User explicitly asked "senza immagini" (without images)
      $('img, picture, svg, video, figure').remove();

      // Find main content
      let content = $('article').html() || 
                    $('.article-body').html() || 
                    $('.post-content').html() || 
                    $('.content').html() || 
                    $('#main-content').html() || 
                    $('main').html() || 
                    $('body').html();

      // Basic styling for the clean view
      const cleanHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          ${baseTag}
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { 
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
              line-height: 1.6; 
              color: #1a1a1a; 
              max-width: 800px; 
              margin: 0 auto; 
              padding: 2rem 1.5rem;
              background: #fff;
            }
            h1, h2, h3 { line-height: 1.2; margin-top: 2rem; color: #000; }
            p { margin-bottom: 1.5rem; font-size: 1.1rem; }
            a { color: #4f46e5; text-decoration: none; }
            a:hover { text-decoration: underline; }
            ul, ol { margin-bottom: 1.5rem; padding-left: 1.5rem; }
            li { margin-bottom: 0.5rem; }
            blockquote { border-left: 4px solid #e5e7eb; padding-left: 1rem; margin-left: 0; font-style: italic; color: #4b5563; }
            .read-time { color: #6b7280; font-size: 0.875rem; margin-bottom: 2rem; display: block; }
          </style>
        </head>
        <body>
          ${content}
        </body>
        </html>
      `;
      return res.send(cleanHtml);
    }
    
    // ORIGINAL MODE: Strip scripts and fix frame-breaking
    const troublesomeSites = [
      'engadget.com', 'yahoo.com', 'techcrunch.com', 'reuters.com', 'cnbc.com', 
      'ansa.it', 'hdblog.it', 'wired.it', 'tomshw.it', 'dday.it', 'macitynet.it',
      'theverge.com', 'vox.com', 'polygon.com', 'repubblica.it', 'corriere.it'
    ];
    const needsStripping = troublesomeSites.some(site => url.toLowerCase().includes(site));

    if (needsStripping) {
      html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
      html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
      html = html.replace(/<link rel="preload" as="script" [^>]*>/gi, '');
      
      // Expanded frame-breaking protection (GAMESPULSE ELITE STABILITY)
      html = html.replace(/if\s*\(top\s*!==\s*self\)\s*\{[\s\S]*?\}/gi, '');
      html = html.replace(/if\s*\(window\.top\s*!==\s*window\.self\)\s*\{[\s\S]*?\}/gi, '');
      html = html.replace(/if\s*\(parent\s*!==\s*self\)\s*\{[\s\S]*?\}/gi, '');
      html = html.replace(/top\.location\.href\s*=\s*(self|window)\.location\.href/gi, '');
      html = html.replace(/window\.top\s*=\s*window/gi, '');
      html = html.replace(/location\.replace/g, '//location.replace');
    }

    // Extra script for frame isolation and interaction handling
    const frameScript = `
      <script>
        (function() {
          // Absolute Isolation
          try {
            window.top = window.self;
            window.parent = window.self;
            Object.defineProperty(window, 'top', { get: function() { return window.self; } });
            Object.defineProperty(window, 'parent', { get: function() { return window.self; } });
          } catch(e) {}

          // Prevent app-hangs from heavy scripts that might still be alive
          window.onerror = function() { return true; };
          
          document.addEventListener('DOMContentLoaded', () => {
             document.documentElement.style.overflowX = 'hidden';
             document.body.style.overflowX = 'hidden';
             
             // Open all links in top window if they try to escape
             document.querySelectorAll('a').forEach(a => {
               if (a.target === '_top' || a.target === '_parent') {
                 a.target = '_blank';
               }
             });
          });
        })();
      </script>
    `;

    if (html.includes("<head>")) {
      html = html.replace("<head>", `<head>${baseTag}${frameScript}`);
    } else {
      html = `${baseTag}${frameScript}${html}`;
    }

    res.setHeader("Content-Type", "text/html");
    res.send(html);
  } catch (error) {
    console.error("Proxy error:", error);
    res.status(500).send("Failed to load content in SpotSmart");
  }
});


// Improved Metadata Extraction (Fully Synchronized with GamesPulse)
// Improved Metadata Extraction (Fully Synchronized with GamesPulse + Enhancements)
async function fetchMetaInfo(url: string) {
  if (!url) return { image: null, video: null };
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000); 
    const response = await fetch(url, { 
      signal: controller.signal,
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      } 
    });
    clearTimeout(timeoutId);
    if (!response.ok) return { image: null, video: null };
    const html = await response.text();
    const $ = cheerio.load(html);
    
    let image = $('meta[property="og:image"]').attr('content') || 
                $('meta[name="twitter:image"]').attr('content') ||
                $('meta[property="og:image:secure_url"]').attr('content') ||
                $('meta[name="thumbnail"]').attr('content') ||
                $('link[rel="image_src"]').attr('href') ||
                $('link[rel="apple-touch-icon"]').attr('href') ||
                $('meta[name="msapplication-TileImage"]').attr('content');
    
    // Source-specific image improvements (GamesPulse DNA)
    if (image) {
      if (url.includes('gamestar.de')) image = image.replace(/_teaser_\d+x\d+\./, '_full.');
      if (url.includes('ansa.it')) image = image.replace(/_thumb\./, '_big.');
      if (url.includes('ilsole24ore.com')) image = image.replace(/_L\./, '_H.');
    }

    let video = $('meta[property="og:video:url"]').attr('content') ||
                $('meta[property="og:video:secure_url"]').attr('content') ||
                $('meta[property="og:video"]').attr('content') ||
                $('meta[name="twitter:player"]').attr('content') ||
                $('meta[property="og:video:iframe"]').attr('content') ||
                $('meta[name="twitter:player:stream"]').attr('content') ||
                $('link[rel="alternate"][type="application/json+oembed"]').attr('href');

    if (!video) {
      // Look for YT/Vimeo iframes specifically (found in many news sites)
      const ytIframe = $('iframe[src*="youtube.com"], iframe[src*="youtu.be"]').attr('src');
      if (ytIframe) video = ytIframe;
      else video = $('video source').attr('src') || $('video').attr('src');
    }

    // Standardize YouTube URLs to embed format
    if (video && (video.includes('youtube.com') || video.includes('youtu.be'))) {
      const ytId = video.match(/(?:v=|embed\/|youtu\.be\/|watch\?v=)([a-zA-Z0-9_-]{11})/)?.[1];
      if (ytId) video = `https://www.youtube.com/embed/${ytId}`;
    }

    if (video && video.includes('vimeo.com')) {
      const vimeoId = video.match(/vimeo\.com\/(?:video\/)?(\d+)/)?.[1];
      if (vimeoId) video = `https://player.vimeo.com/video/${vimeoId}`;
    }

    let finalImage = image || null;
    if (finalImage && !finalImage.startsWith('http')) {
      try { finalImage = new URL(finalImage, url).href; } catch { finalImage = null; }
    }
    return { image: finalImage, video: video || null };
  } catch (e) {
    return { image: null, video: null };
  }
}

function extractImageUrl(item: any) {
  // Gems for Gematsu/4Gamer/Japanese feeds (GamesPulse DNA)
  const isGematsu = item.link?.toLowerCase().includes('gematsu.com');
  const is4Gamer = item.link?.toLowerCase().includes('4gamer.net');
  const contentEncoded = item["content:encoded"] || item.content || item.description || "";

  if (isGematsu && contentEncoded) {
     const gematsuImg = contentEncoded.match(/<img[^>]+(?:src|data-src)=["']([^"'> ]+)["']/i);
     if (gematsuImg && gematsuImg[1] && !gematsuImg[1].includes('pixel')) return gematsuImg[1];
  }

  // 1. Enclosure
  if (item.enclosure && item.enclosure.url) {
    if (item.enclosure.url.match(/\.(jpg|jpeg|png|webp|gif)/i)) return item.enclosure.url;
  }
  
  // 2. Media Tags
  const mediaTags = ["media:content", "media:thumbnail", "media:group", "image", "enclosure", "thumb"];
  for (const tag of mediaTags) {
    const content = item[tag];
    if (content) {
      if (Array.isArray(content)) {
        const firstWithUrl = content.find((c: any) => {
          const url = c.$?.url || c.url || (typeof c === 'string' ? c : null);
          return url && typeof url === 'string' && url.match(/\.(jpg|jpeg|png|webp|gif)/i);
        });
        if (firstWithUrl) return firstWithUrl.$?.url || firstWithUrl.url || (typeof firstWithUrl === 'string' ? firstWithUrl : null);
      }
      if (content.$ && content.$.url) {
        if (typeof content.$.url === 'string' && content.$.url.match(/\.(jpg|jpeg|png|webp|gif)/i)) return content.$.url;
      }
      if (content.url && typeof content.url === 'string' && content.url.match(/\.(jpg|jpeg|png|webp|gif)/i)) return content.url;
    }
  }
  
  // 3. Content Regex
  const imgMatches = contentEncoded.matchAll(/<img[^>]+(?:src|data-src|srcset|original-src)=["']([^"'> ]+)["']/gi);
  for (const match of imgMatches) {
    const url = match[1];
    if (!url.includes('pixel') && !url.includes('analytics') && !url.includes('doubleclick') && !url.includes('spacer') && !url.includes('emoji')) {
      return url;
    }
  }

  return null;
}

function extractVideoUrl(item: any) {
  const content = (item.content || item["content:encoded"] || item.description || "").toLowerCase();
  
  if (item['yt:videoId']) return `https://www.youtube.com/embed/${item['yt:videoId']}`;
  if (item.id && item.id.startsWith('yt:video:')) return `https://www.youtube.com/embed/${item.id.replace('yt:video:', '')}`;

  // Robust YouTube / Vimeo Regex (GamesPulse DNA)
  const ytMatch = content.match(/https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
  if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;
  
  const vimeoMatch = content.match(/vimeo\.com\/(?:video\/)?(\d+)/i) || content.match(/player\.vimeo\.com\/video\/(\d+)/i);
  if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;

  const iframeMatch = content.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  if (iframeMatch) {
    const src = iframeMatch[1];
    if (src.includes('youtube.com') || src.includes('youtu.be')) {
      const ytId = src.match(/(?:v=|embed\/|youtu\.be\/|v\/)([a-zA-Z0-9_-]{11})/i)?.[1];
      if (ytId) return `https://www.youtube.com/embed/${ytId}`;
    }
    if (src.includes('vimeo.com')) {
      const vimeoId = src.match(/vimeo\.com\/(?:video\/)?(\d+)/i)?.[1];
      if (vimeoId) return `https://player.vimeo.com/video/${vimeoId}`;
    }
  }

  return null;
}

function cleanXmlContent(xml: string): string {
  let cleaned = xml;
  // 1. Fix unescaped ampersands in titles/descriptions (common in brittle Italian feeds)
  cleaned = cleaned.replace(/&(?!(?:[a-zA-Z0-9]+|#[0-9]+|#x[0-9a-fA-F]+);)/g, '&amp;');
  
  // 2. Fix unquoted attributes
  cleaned = cleaned.replace(/<([a-zA-Z0-9:_.-]+)\s+([^>]*?)\s*>/g, (match, tagName, attrs) => {
    const sanitizedAttrs = attrs.replace(/([a-zA-Z0-9:_.-]+)(?!=)(\s|$)/g, '$1=""$2');
    return `<${tagName} ${sanitizedAttrs}>`;
  });

  // 2.5 Fix numeric attribute names (XML doesn't allow them, but some feeds use them)
  cleaned = cleaned.replace(/(\s)([0-9][a-zA-Z0-9:_.-]*=)/g, '$1attr_$2');
  cleaned = cleaned.replace(/(\s[a-zA-Z0-9:_.-]+)\s*=\s*(["'])/g, '$1=$2');

  // 3. Ensure HTML content within RSS tags is wrapped in CDATA if it contains tags
  cleaned = cleaned.replace(/<(title|description|content:encoded)>([\s\S]*?)<\/\1>/g, (match, tag, content) => {
    if (content.includes('<') && !content.trim().startsWith('<![CDATA[')) {
      return `<${tag}><![CDATA[${content}]]></${tag}>`;
    }
    return match;
  });

  return cleaned;
}

interface NewsItem {
  id: string;
  title: string;
  url: string;
  summary: string;
  category: string;
  source: string;
  imageUrl: string | null;
  videoUrl: string | null;
  time: string;
  timestamp: number;
}

app.get("/api/news", async (req, res) => {
  const forceRefresh = req.query.refresh === 'true';
  const now = Date.now();
  
  // Return cache if available and not expired
  if (!forceRefresh && serverNewsCache.length > 0 && (now - lastServerFetchTime < SERVER_CACHE_DURATION)) {
    return res.json(serverNewsCache);
  }

  try {
    const sources = getSources().filter((s: any) => s.active !== false);
    console.log(`[Unified Fetch] Gathering news from ${sources.length} active sources...`);
    
    const feedPromises = sources.slice(0, 40).map(async (source: any) => { // High-speed selection of top 40 sources
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // Sharp 5s timeout for agility
      try {
        // Cache Buster (GP DNA): Add refresh param to force sources to bypass their own cache
        const fetchUrl = source.url + (source.url.includes('?') ? '&' : '?') + `_ss_refresh=${now}`;
        
        const response = await fetch(fetchUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'application/rss+xml, application/xml, text/xml, */*',
            'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
            'Cache-Control': 'no-cache'
          }
        });
        clearTimeout(timeoutId);
        if (!response.ok) return [];
        
        let rawXml = await response.text();
        const xml = cleanXmlContent(rawXml);
        const feed = await parser.parseString(xml);
        const items = feed.items || [];
        
        return await Promise.all(items.slice(0, 25).map(async (item) => {
          let image = extractImageUrl(item);
          let video = extractVideoUrl(item);
          
          // Deep metadata fetch for items lacking media
          if (!image || !video) {
            try {
              const meta = await fetchMetaInfo(item.link || "");
              if (!image && meta.image) image = meta.image;
              if (!video && meta.video) video = meta.video;
            } catch (e) {}
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
            time: item.pubDate ? new Date(item.pubDate).toLocaleTimeString() : new Date().toLocaleTimeString(),
            timestamp: item.pubDate ? new Date(item.pubDate).getTime() : now
          };
        }));
      } catch (e) {
        clearTimeout(timeoutId);
        return [];
      }
    });

    const results = await Promise.allSettled(feedPromises);
    const allItems: any[] = [];
    results.forEach(res => {
      if (res.status === 'fulfilled') allItems.push(...res.value);
    });

    // Helper to shuffle array (GP DNA)
    const shuffleArray = (array: any[]) => {
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
      }
      return array;
    };

    // Unified Modern Logic (GP DNA): Today vs Recent (max 5 days) vs Older
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTs = today.getTime();
    
    // Strict freshness filter: Ignore anything older than 5 days for the main feed
    const minFreshnessTs = todayTs - (5 * 24 * 60 * 60 * 1000);

    const freshItems = allItems.filter(item => item.timestamp >= minFreshnessTs);
    
    const todayItems = freshItems.filter(item => item.timestamp >= todayTs);
    const recentItems = freshItems.filter(item => item.timestamp < todayTs);

    const shuffledToday = shuffleArray([...todayItems]);
    const sortedRecent = recentItems.sort((a, b) => b.timestamp - a.timestamp);

    const finalResult = [...shuffledToday, ...sortedRecent].slice(0, 800);

    console.log(`[Unified Fetch] SUCCESS - Sending ${finalResult.length} items to client.`);
    serverNewsCache = finalResult;
    lastServerFetchTime = Date.now();
    res.json(finalResult);
  } catch (error) {
    console.error("FATAL Unified RSS Fetch error:", error);
    // NEVER send 500, return cache or empty array to keep UI flowing
    return res.json(serverNewsCache.length > 0 ? serverNewsCache : []);
  }
});

app.get("/api/admin/seo", async (req, res) => {
  await syncCloudConfigs();
  res.json(getSeoConfigs());
});

app.post("/api/admin/seo", express.json(), async (req, res) => {
  const { auth, category, data } = req.body;
  if (auth?.username !== 'admin' || auth?.password !== 'accessometti') return res.status(401).send("Unauthorized");
  const current = getSeoConfigs();
  current[category] = data;
  saveSeoConfigs(current);
  if (db) await setDoc(doc(db, 'configs', 'seo'), current).catch(console.error);
  res.send("Saved");
});

app.get("/api/admin/sources", (req, res) => res.json(getSources()));
app.post("/api/admin/sources", express.json(), (req, res) => {
  const { auth, sources } = req.body;
  if (auth?.username !== 'admin' || auth?.password !== 'accessometti') return res.status(401).send("Unauthorized");
  saveSources(sources);
  res.send("Saved");
});

app.get("/api/admin/analytics", async (req, res) => {
  await syncCloudConfigs();
  res.json(getAnalytics());
});

app.post("/api/admin/analytics", express.json(), async (req, res) => {
  const { auth, data } = req.body;
  if (auth?.username !== 'admin' || auth?.password !== 'accessometti') return res.status(401).send("Unauthorized");
  saveAnalytics(data);
  cachedAnalytics = data;
  if (db) await setDoc(doc(db, 'configs', 'analytics'), data).catch(console.error);
  res.send("Saved");
});

app.get("/api/admin/adsense", async (req, res) => {
  await syncCloudConfigs();
  const data = getAdSense();
  res.json(data);
});

app.post("/api/admin/adsense", express.json(), async (req, res) => {
  const { auth, data } = req.body;
  if (auth?.username !== 'admin' || auth?.password !== 'accessometti') return res.status(401).send("Unauthorized");
  
  if (!data) return res.status(400).send("No data provided");

  // Instant update memory to avoid loop/delay
  cachedAdSense = data;
  saveAdSense(data);

  // Sync to Cloud as well
  if (db) {
    try {
      await setDoc(doc(db, 'configs', 'adsense'), data);
      console.log("[Cloud] AdSense synced to Firestore successfully");
    } catch (e) {
      console.error("[Cloud] AdSense sync failed:", e);
    }
  }

  res.send("Saved Successfully");
});

// AdSense ads.txt serving
app.get("/ads.txt", (req, res) => {
  const adsense = getAdSense();
  res.type("text/plain");
  res.send(adsense.adsTxt || "");
});

app.get("/api/admin/traffic", (req, res) => res.json(memoryTraffic));
app.post("/api/admin/traffic/reset", express.json(), (req, res) => {
  const { auth } = req.body;
  if (auth?.username !== 'admin' || auth?.password !== 'accessometti') return res.status(401).send("Unauthorized");
  const resetData = resetTraffic();
  res.json(resetData);
});

async function fetchInitialNews() {
  const topSources = [
    { url: "https://www.ansa.it/sito/ansait_rss.xml", name: "ANSA", cat: "Cronaca" },
    { url: "https://www.hdblog.it/feed/", name: "HD Blog", cat: "Tecnologia" },
    { url: "https://www.ilsole24ore.com/rss/finanza.xml", name: "Il Sole 24 Ore", cat: "Finanza" }
  ];
  
  let newsHtml = "";
  for (const source of topSources) {
    try {
      const response = await fetch(source.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const xml = await response.text();
      const feed = await parser.parseString(cleanXmlContent(xml));
      feed.items.slice(0, 4).forEach(item => {
        newsHtml += `
          <article style="margin-bottom: 20px; border-bottom: 1px solid #eee; padding-bottom: 10px;">
            <h2 style="font-size: 1.2rem; color: #333;">${item.title}</h2>
            <p style="font-size: 0.9rem; color: #666;">${(item.contentSnippet || item.summary || "").substring(0, 400)}...</p>
            <div style="font-size: 0.7rem; color: #999; text-transform: uppercase;">Fonte: ${source.name} | Categoria: ${source.cat}</div>
            <a href="${item.link}" style="font-size: 0.8rem; color: #4f46e5;">Leggi di più</a>
          </article>
        `;
      });
    } catch (e) {
      console.warn(`[SSR] Fetch failed for ${source.name}`);
    }
  }
  return newsHtml;
}

async function startServer() {
  const PORT = 3000;
  
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { 
        middlewareMode: true,
        watch: {
          ignored: ['**/.data/**', '**/traffic_stats.json', '**/adsense_config.json', '**/seo_configs.json', '**/analytics_config.json', '**/news_sources.json']
        }
      },
      appType: "custom", 
    });
    app.use(vite.middlewares);
    
    app.get("*", async (req, res, next) => {
      const url = req.originalUrl;
      if (url.includes('.') && !url.includes('.html')) return next();
      
      try {
        await syncCloudConfigs();
        let template = fs.readFileSync(path.resolve(process.cwd(), "index.html"), "utf-8");
        template = await vite.transformIndexHtml(url, template);
        
        const urlPath = req.path.split('/').filter(Boolean).pop()?.toLowerCase() || 'all';
        const configs = getSeoConfigs();
        const config = configs[urlPath] || configs.all;
        const analytics = getAnalytics();
        const adsense = getAdSense();
        
        const ssrNews = await fetchInitialNews();
        recordVisit();
        const html = injectMetadata(template, config, analytics, adsense, url, ssrNews);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath, { index: false }));
    
    app.get("*", async (req, res) => {
      const url = req.originalUrl;
      if (url.includes('.') && !url.includes('.html')) {
        return res.sendFile(path.join(distPath, req.path));
      }

      try {
        await syncCloudConfigs();
        const template = fs.readFileSync(path.join(distPath, "index.html"), "utf-8");
        
        const urlPath = req.path.split('/').filter(Boolean).pop()?.toLowerCase() || 'all';
        const configs = getSeoConfigs();
        const config = configs[urlPath] || configs.all;
        const analytics = getAnalytics();
        const adsense = getAdSense();
        
        const ssrNews = await fetchInitialNews();
        recordVisit();
        const html = injectMetadata(template, config, analytics, adsense, url, ssrNews);
        res.send(html);
      } catch (e) {
        res.status(500).send("Server Error during SSR");
      }
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`SpotSmart server running on http://localhost:${PORT}`);
  });
}

if (process.env.VERCEL !== '1') {
  startServer();
}

export default app;
