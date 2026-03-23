import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import Parser from "rss-parser";
import * as cheerio from "cheerio";

const app = express();
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

app.use(cors());
app.use(express.json());

// Proxy for Article Loading (Taken from GamesPulse)
app.get("/api/proxy", async (req, res) => {
  const url = req.query.url as string;
  if (!url) return res.status(400).send("URL is required");

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      }
    });

    if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);

    let html = await response.text();
    
    // Inject <base> tag to fix relative links and images
    const baseUrl = new URL(url).origin;
    const baseTag = `<base href="${baseUrl}/">`;
    
    // Strip scripts for specific sites known to cause issues in iframes
    const troublesomeSites = ['engadget.com', 'yahoo.com', 'techcrunch.com', 'reuters.com', 'cnbc.com', 'ansa.it'];
    const needsStripping = troublesomeSites.some(site => url.toLowerCase().includes(site));

    if (needsStripping) {
      // Remove scripts and preload links to prevent rehydration crashes
      html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
      html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
      html = html.replace(/<link rel="preload" as="script" [^>]*>/gi, '');
      html = html.replace(/<next-route-announcer>[\s\S]*?<\/next-route-announcer>/gi, '');
    }

    // Add Base Tag for relative assets
    if (html.includes("<head>")) {
      html = html.replace("<head>", `<head>${baseTag}`);
    } else {
      html = `${baseTag}${html}`;
    }

    res.setHeader("Content-Type", "text/html");
    res.send(html);
  } catch (error) {
    console.error("Proxy error:", error);
    res.status(500).send("Failed to load content in SpotSmart");
  }
});

// Improved Metadata Extraction (Fully Synchronized with GamesPulse)
async function fetchMetaInfo(url: string) {
  if (!url) return { image: null, video: null };
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 seconds
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
    
    const image = $('meta[property="og:image"]').attr('content') || 
                  $('meta[name="twitter:image"]').attr('content') ||
                  $('meta[property="og:image:secure_url"]').attr('content') ||
                  $('meta[name="thumbnail"]').attr('content') ||
                  $('link[rel="image_src"]').attr('href') ||
                  $('link[rel="apple-touch-icon"]').attr('href') ||
                  $('meta[name="msapplication-TileImage"]').attr('content');
    
    let video = $('meta[property="og:video:url"]').attr('content') ||
                $('meta[property="og:video:secure_url"]').attr('content') ||
                $('meta[property="og:video"]').attr('content') ||
                $('meta[name="twitter:player"]').attr('content') ||
                $('meta[property="og:video:iframe"]').attr('content') ||
                $('meta[name="twitter:player:stream"]').attr('content') ||
                $('link[rel="alternate"][type="application/json+oembed"]').attr('href');

    if (!video) {
      video = $('video source').attr('src') || $('video').attr('src');
    }

    // Handle YouTube links in meta tags
    if (video && (video.includes('youtube.com') || video.includes('youtu.be'))) {
      const ytId = video.match(/(?:v=|embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1];
      if (ytId) video = `https://www.youtube.com/embed/${ytId}`;
    }

    let finalImage = image || null;
    if (finalImage && !finalImage.startsWith('http')) {
      try {
        finalImage = new URL(finalImage, url).href;
      } catch {
        finalImage = null;
      }
    }
    return { image: finalImage, video: video || null };
  } catch (e) {
    return { image: null, video: null };
  }
}

function extractImage(item: any) {
  // 1. Enclosure
  if (item.enclosure && item.enclosure.url) {
    if (item.enclosure.url.match(/\.(jpg|jpeg|png|webp|gif)/i)) return item.enclosure.url;
  }
  
  // 2. Media Content / Thumbnail
  const mediaTags = ["media:content", "media:thumbnail", "media:group", "image", "enclosure", "thumb"];
  for (const tag of mediaTags) {
    const content = item[tag];
    if (content) {
      if (Array.isArray(content)) {
        const firstWithUrl = content.find((c: any) => {
          const url = c.$?.url || c.url || (typeof c === 'string' ? c : null);
          return url && url.match(/\.(jpg|jpeg|png|webp|gif)/i);
        });
        if (firstWithUrl) return firstWithUrl.$?.url || firstWithUrl.url || (typeof firstWithUrl === 'string' ? firstWithUrl : null);
      }
      if (content.$ && content.$.url) {
        if (content.$.url.match(/\.(jpg|jpeg|png|webp|gif)/i)) return content.$.url;
      }
      if (content.url && content.url.match(/\.(jpg|jpeg|png|webp|gif)/i)) return content.url;
      if (typeof content === 'string' && content.match(/\.(jpg|jpeg|png|webp|gif)/i)) return content;
    }
  }
  
  // 3. Content/Description Regex
  const content = item.content || item["content:encoded"] || item.description || "";
  const imgMatches = content.matchAll(/<img[^>]+(?:src|data-src|srcset)="([^"> ]+)"/g);
  for (const match of imgMatches) {
    const url = match[1];
    if (!url.includes('pixel') && !url.includes('analytics') && !url.includes('doubleclick') && !url.includes('spacer')) {
      return url;
    }
  }

  return null;
}

function extractVideo(item: any) {
  const content = (item.content || item["content:encoded"] || item.description || "").toLowerCase();
  
  if (item['yt:videoId']) return `https://www.youtube.com/embed/${item['yt:videoId']}`;
  if (item.id && item.id.startsWith('yt:video:')) return `https://www.youtube.com/embed/${item.id.replace('yt:video:', '')}`;

  const ytMatch = content.match(/https?:\/\/(?:www\.)?(?:youtube\.com\/embed\/|youtu\.be\/|youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;
  
  const vimeoMatch = content.match(/https?:\/\/player\.vimeo\.com\/video\/(\d+)/);
  if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;

  const iframeMatch = content.match(/<iframe[^>]+src=["']([^"']+)["']/);
  if (iframeMatch) {
    const src = iframeMatch[1];
    if (src.includes('youtube.com') || src.includes('youtu.be')) {
      const ytId = src.match(/(?:v=|embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1];
      if (ytId) return `https://www.youtube.com/embed/${ytId}`;
    }
    if (src.includes('vimeo.com')) {
      const vimeoId = src.match(/vimeo\.com\/(?:video\/)?(\d+)/)?.[1];
      if (vimeoId) return `https://player.vimeo.com/video/${vimeoId}`;
    }
  }

  const videoFileMatch = content.match(/https?:\/\/[^"'>]+\.(mp4|webm|ogg)/);
  if (videoFileMatch) return videoFileMatch[0];

  if (item["media:content"]) {
    const media = Array.isArray(item["media:content"]) ? item["media:content"] : [item["media:content"]];
    const video = media.find((m: any) => m.$ && (m.$.type?.includes('video') || m.$.medium === 'video' || m.$.url?.match(/\.(mp4|webm|ogg)$/)));
    if (video && video.$.url) return video.$.url;
  }

  return null;
}

app.get("/api/news", async (req, res) => {
  const { url, category, source } = req.query;
  if (!url) return res.status(400).send("Feed URL is required");

  try {
    const feed = await parser.parseURL(url as string);
    let items = feed.items.map((item) => {
      return {
        id: item.guid || item.link || Math.random().toString(),
        title: item.title,
        url: item.link,
        summary: (item.contentSnippet || item.summary || "").substring(0, 200) + "...",
        category: category,
        source: source,
        imageUrl: extractImage(item),
        videoUrl: extractVideo(item),
        time: item.pubDate ? new Date(item.pubDate).toLocaleTimeString() : new Date().toLocaleTimeString()
      };
    });

    // Deep enhancement for items without media (max 10 per feed to keep it fast)
    const newsToEnhance = items.filter(item => !item.imageUrl || !item.videoUrl).slice(0, 10);
    if (newsToEnhance.length > 0) {
      await Promise.all(newsToEnhance.map(async (item) => {
        try {
          const meta = await fetchMetaInfo(item.url || "");
          if (!item.imageUrl && meta.image) item.imageUrl = meta.image;
          if (!item.videoUrl && meta.video) item.videoUrl = meta.video;
        } catch (e) {
          console.error(`Failed to enhance ${item.url}:`, e);
        }
      }));
    }

    // Final cleanup: if still no image, use a premium news fallback instead of picsum
    items = items.map(item => ({
      ...item,
      imageUrl: item.imageUrl || `https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&q=80&w=1600`
    }));

    res.send(items);
  } catch (error) {
    console.error("RSS Fetch error:", error);
    res.status(500).send("Failed to fetch news feed");
  }
});

async function startServer() {
  const PORT = 3000;
  
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
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
