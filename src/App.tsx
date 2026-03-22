/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Newspaper, TrendingUp, Clock, Share2, ExternalLink, Menu, X, Settings, User as UserIcon, Heart, LogOut, BookOpen, LayoutGrid, Globe, Cpu, Music, Gamepad2, Palette, FlaskConical, Search, RefreshCw, Info, Send, Trophy } from 'lucide-react';
import { auth, loginWithGoogle, logout, onAuthStateChanged, db, handleFirestoreError, OperationType, User } from './firebase';
import { collection, doc, setDoc, deleteDoc, onSnapshot, query, where, Timestamp, getDoc } from 'firebase/firestore';

interface NewsItem {
  id: string;
  title: string;
  url: string;
  summary: string;
  category: string;
  source: string;
  imageUrl: string;
  videoUrl?: string;
  time: string;
}

const variants = {
  enter: (direction: number) => ({
    x: direction > 0 ? '100%' : '-100%',
    opacity: 0,
    scale: 0.95,
    rotateY: direction > 0 ? 30 : -30,
    filter: 'blur(10px)',
  }),
  center: {
    zIndex: 1,
    x: 0,
    opacity: 1,
    scale: 1,
    rotateY: 0,
    filter: 'blur(0px)',
    transition: {
      x: { type: "spring", stiffness: 250, damping: 28 },
      opacity: { duration: 0.3 },
      scale: { duration: 0.4, ease: "easeOut" },
      rotateY: { type: "spring", stiffness: 200, damping: 25 },
      filter: { duration: 0.3 }
    }
  },
  exit: (direction: number) => ({
    zIndex: 0,
    x: direction < 0 ? '100%' : '-100%',
    opacity: 0,
    scale: 0.95,
    rotateY: direction < 0 ? 30 : -30,
    filter: 'blur(10px)',
    transition: {
      x: { type: "spring", stiffness: 250, damping: 28 },
      opacity: { duration: 0.2 },
      filter: { duration: 0.2 }
    }
  })
};

const FEEDS = [
  { url: "https://www.ansa.it/sito/ansait_rss.xml", cat: "Cronaca", name: "ANSA" },
  { url: "https://www.tgcom24.mediaset.it/rss/homepage.xml", cat: "Cronaca", name: "TGCOM24" },
  { url: "https://www.adnkronos.com/rss/home", cat: "Cronaca", name: "Adnkronos" },
  { url: "https://www.reuters.com/arc/outboundfeeds/rss/category/world/?outputType=xml", cat: "Mondo", name: "Reuters" },
  { url: "https://feeds.bbci.co.uk/news/world/rss.xml", cat: "Mondo", name: "BBC News" },
  { url: "https://www.wired.it/feed/", cat: "Tecnologia", name: "Wired IT" },
  { url: "https://www.punto-informatico.it/feed/", cat: "Tecnologia", name: "Punto Informatico" },
  { url: "https://leganerd.com/feed/", cat: "Tecnologia", name: "Lega Nerd" },
  { url: "https://www.ilsole24ore.com/rss/economia.xml", cat: "Finanza", name: "Il Sole 24 Ore" },
  { url: "https://feeds.feedburner.com/MilanoFinanzaUltimiLanci", cat: "Finanza", name: "Milano Finanza" },
  { url: "https://www.gazzetta.it/rss/home.xml", cat: "Sport", name: "Gazzetta" },
  { url: "https://www.tuttosport.com/rss/calcio", cat: "Sport", name: "TuttoSport" },
  { url: "https://www.focus.it/rss", cat: "Scienza", name: "Focus" },
  { url: "https://www.artribune.com/feed/", cat: "Cultura", name: "Artribune" },
  { url: "https://www.minimaetmoralia.it/wp/feed/", cat: "Cultura", name: "Minima&Moralia" }
];

const CATEGORIES = [
  { id: 'all', label: 'Tutte', icon: Globe, color: 'bg-indigo-600', border: 'border-indigo-400/30' },
  { id: 'cronaca', label: 'Cronaca', icon: BookOpen, color: 'bg-slate-700', border: 'border-slate-500/30' },
  { id: 'mondo', label: 'Mondo', icon: Globe, color: 'bg-blue-500', border: 'border-blue-400/30' },
  { id: 'tecnologia', label: 'Tecnologia', icon: Cpu, color: 'bg-blue-600', border: 'border-blue-400/30' },
  { id: 'finanza', label: 'Finanza', icon: TrendingUp, color: 'bg-emerald-600', border: 'border-emerald-400/30' },
  { id: 'sport', label: 'Sport', icon: Trophy, color: 'bg-red-600', border: 'border-red-400/30' },
  { id: 'scienza', label: 'Scienza', icon: FlaskConical, color: 'bg-slate-700', border: 'border-slate-500/30' },
  { id: 'cultura', label: 'Cultura', icon: Palette, color: 'bg-pink-600', border: 'border-pink-400/30' },
];

export default function App() {
  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState(0);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [favorites, setFavorites] = useState<Record<string, any>>({});
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [isCategoryMenuOpen, setIsCategoryMenuOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [showCookieBanner, setShowCookieBanner] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const splashBg = useMemo(() => `https://picsum.photos/seed/${Math.random()}/1920/1080`, []);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedCategoryData = CATEGORIES.find(c => c.id === selectedCategory);
  const SelectedCategoryIcon = selectedCategoryData?.icon;

  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 3500);
    const consent = localStorage.getItem('cookieConsent');
    if (!consent) {
      setTimeout(() => setShowCookieBanner(true), 4000);
    }
    return () => clearTimeout(timer);
  }, []);

  // Reset to home view after login/logout
  useEffect(() => {
    setSelectedCategory('all');
    setShowFavoritesOnly(false);
    setIsMenuOpen(false);
    setCurrentIndex(0);
    setSearchQuery('');
    setIsSearchOpen(false);
    setIsCategoryMenuOpen(false);
  }, [user]);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Create user doc if not exists
        const userRef = doc(db, 'users', currentUser.uid);
        try {
          const userSnap = await getDoc(userRef);
          if (!userSnap.exists()) {
            await setDoc(userRef, {
              uid: currentUser.uid,
              email: currentUser.email,
              displayName: currentUser.displayName,
              photoURL: currentUser.photoURL,
              role: 'user'
            });
          }
        } catch (err) {
          console.error("Error setting up user doc:", err);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Favorites Listener & Expiration Check
  useEffect(() => {
    if (!user) {
      setFavorites({});
      return;
    }

    const q = query(collection(db, 'favorites'), where('userId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const favs: Record<string, any> = {};
      const now = Timestamp.now();
      
      snapshot.docs.forEach(async (docSnap) => {
        const data = docSnap.data();
        // Check expiration (24 hours)
        if (data.expiresAt && data.expiresAt.toMillis() < now.toMillis()) {
          try {
            await deleteDoc(doc(db, 'favorites', docSnap.id));
          } catch (err) {
            handleFirestoreError(err, OperationType.DELETE, `favorites/${docSnap.id}`);
          }
        } else {
          favs[data.newsId] = { ...data, id: docSnap.id };
        }
      });
      setFavorites(favs);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'favorites');
    });

    return () => unsubscribe();
  }, [user]);

  // Fetch Real News Feeds
  const fetchSingleFeed = async (feed: typeof FEEDS[0]) => {
    const proxies = [
      (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
      (url: string) => `https://corsproxy.org/?${encodeURIComponent(url)}`,
      (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
      (url: string) => `https://api.codetabs.com/v1/proxy?url=${encodeURIComponent(url)}`,
      (url: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
      (url: string) => `https://thingproxy.freeboard.io/fetch/${url}`,
    ];

    for (const getProxyUrl of proxies) {
      try {
        const proxyUrl = getProxyUrl(feed.url);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 seconds timeout

        const response = await fetch(proxyUrl, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        let xmlText = "";
        if (proxyUrl.includes('allorigins.win/get')) {
          const data = await response.json();
          xmlText = data.contents;
        } else {
          xmlText = await response.text();
        }

        if (!xmlText) throw new Error("Empty response");
        
        const lowerText = xmlText.toLowerCase();
        if (lowerText.includes("access denied") || lowerText.includes("forbidden") || lowerText.includes("blocked by cloudflare")) {
          throw new Error("Request blocked by source or proxy");
        }

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, "text/xml");
        if (!xmlDoc.documentElement) throw new Error("Invalid XML document");
        
        const parseError = xmlDoc.getElementsByTagName("parsererror");
        if (parseError.length > 0) throw new Error("XML parsing error");

        const items = Array.from(xmlDoc.querySelectorAll("item, entry")).slice(0, 10);

        const parsedItems: NewsItem[] = items.map((item, idx) => {
          const title = item.querySelector("title")?.textContent || "Senza Titolo";
          let link = item.querySelector("link")?.textContent || "#";
          if (link === "#" || link.trim() === "") {
            link = item.querySelector("link")?.getAttribute("href") || "#";
          }

          const desc = item.querySelector("description")?.textContent || 
                       item.querySelector("summary")?.textContent || 
                       item.querySelector("content")?.textContent || "";

          const parseImageAndVideo = () => {
            let img = `https://picsum.photos/seed/${feed.cat.toLowerCase()}-${idx}/1600/900`;
            let vid: string | undefined = undefined;

            const getTag = (tagName: string) => {
              const tags = item.getElementsByTagNameNS("*", tagName);
              if (tags.length > 0) return tags[0];
              const localTags = item.getElementsByTagName(tagName);
              if (localTags.length > 0) return localTags[0];
              const prefixedTags = item.getElementsByTagName(`media:${tagName}`);
              if (prefixedTags.length > 0) return prefixedTags[0];
              return null;
            };

            // Search for video in tags (media:content or enclosure)
            const mContents = Array.from(item.getElementsByTagNameNS("*", "content")).concat(
              Array.from(item.getElementsByTagName("media:content")),
              Array.from(item.getElementsByTagName("content"))
            );

            for (const content of mContents) {
              const type = content.getAttribute("type") || "";
              const url = content.getAttribute("url");
              if (url && type.startsWith("video/")) {
                vid = url;
              } else if (url && type.startsWith("image/") && !img.includes('http')) {
                img = url;
              } else if (url && !img.includes('http')) {
                img = url;
              }
            }

            const mContent = getTag("content");
            if (mContent?.getAttribute("url")) {
              const url = mContent.getAttribute("url")!;
              if (mContent.getAttribute("type")?.startsWith("video/")) vid = url;
              else img = url;
            }
            
            const enclosure = item.querySelector("enclosure");
            if (enclosure?.getAttribute("url")) {
              const url = enclosure.getAttribute("url")!;
              const type = enclosure.getAttribute("type") || "";
              if (type.startsWith("video/")) vid = url;
              else if (type.startsWith("image/")) img = url;
              else if (!img.includes('http')) img = url;
            }

            if (!img.includes('http')) {
              const mThumb = getTag("thumbnail");
              if (mThumb?.getAttribute("url")) img = mThumb.getAttribute("url")!;
              
              const mGroup = getTag("group");
              if (mGroup) {
                const gContent = mGroup.getElementsByTagNameNS("*", "content")[0] || mGroup.getElementsByTagName("content")[0];
                if (gContent?.getAttribute("url")) img = gContent.getAttribute("url")!;
              }

              const contentEncoded = item.getElementsByTagName("content:encoded")[0]?.textContent || "";
              const fullContent = item.querySelector("content")?.textContent || "";
              const combinedContent = desc + contentEncoded + fullContent;
              const imgRegex = /<img[^>]+src=["']([^"']+)["']/;
              const foundImg = combinedContent.match(imgRegex);
              if (foundImg && foundImg[1] && !foundImg[1].includes('feedburner')) {
                let url = foundImg[1];
                if (url.startsWith('//')) url = 'https:' + url;
                img = url;
              }
            }

            return { img, vid };
          };

          const { img, vid } = parseImageAndVideo();

          // Enhanced category detection
          let finalCat = feed.cat;
          const rssCat = item.querySelector("category")?.textContent?.toLowerCase();
          if (rssCat) {
            const catMap: Record<string, string> = {
              'sport': 'Sport', 'calcio': 'Sport', 'finanza': 'Finanza', 'economia': 'Finanza',
              'borsa': 'Finanza', 'tecnologia': 'Tecnologia', 'tech': 'Tecnologia',
              'scienza': 'Scienza', 'cultura': 'Cultura', 'politica': 'Mondo',
              'esteri': 'Mondo', 'cronaca': 'Cronaca'
            };
            for (const [key, val] of Object.entries(catMap)) {
              if (rssCat.includes(key)) {
                finalCat = val;
                break;
              }
            }
          }

          const pubDate = item.querySelector("pubDate")?.textContent || 
                          item.querySelector("published")?.textContent || 
                          item.querySelector("updated")?.textContent;
          
          const time = pubDate ? new Date(pubDate).toLocaleDateString('it-IT', { hour: '2-digit', minute: '2-digit' }) : "Recentemente";

          return {
            id: `${feed.name}-${idx}-${Date.now()}`,
            title: title,
            url: link,
            summary: desc.replace(/<[^>]*>?/gm, '').substring(0, 800) + "...",
            category: finalCat,
            source: feed.name,
            imageUrl: img,
            videoUrl: vid,
            time: time
          };
        });
        
        return parsedItems;
      } catch (e) {
        // Continue to next proxy
      }
    }

    // Return empty array if all proxies fail
    return [];
  };

  const fetchAllFeeds = async () => {
    setLoading(true);
    setNewsItems([]); // Clear existing items on manual refresh
    
    // 1. First step: Load ~20-30 news items immediately (first 3 reliable feeds)
    const initialFeeds = FEEDS.slice(0, 3);
    const initialResults = await Promise.all(initialFeeds.map(feed => fetchSingleFeed(feed)));
    const initialItems = initialResults.flat().sort(() => Math.random() - 0.5);
    
    setNewsItems(initialItems);
    setLoading(false); // Stop main loading spinner after first step

    // 2. Background loading: Process remaining feeds in batches of 10
    const remainingFeeds = FEEDS.slice(3);
    const batchSize = 10;
    
    for (let i = 0; i < remainingFeeds.length; i += batchSize) {
      const batch = remainingFeeds.slice(i, i + batchSize);
      
      // Process batch in parallel
      const batchResults = await Promise.all(batch.map(async (feed) => {
        const items = await fetchSingleFeed(feed);
        setNewsItems(prev => {
          const existingIds = new Set(prev.map(item => item.id));
          const newItems = items.filter(item => !existingIds.has(item.id));
          return [...prev, ...newItems].sort(() => Math.random() - 0.5);
        });
        return items;
      }));
      
      // Optional: small delay between batches to keep UI smooth
      if (i + batchSize < remainingFeeds.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  };

  useEffect(() => {
    fetchAllFeeds();
  }, []);

  const toggleFavorite = async (news: NewsItem) => {
    if (!user) {
      loginWithGoogle();
      return;
    }

    const favId = `${user.uid}_${news.id}`;
    if (favorites[news.id]) {
      try {
        await deleteDoc(doc(db, 'favorites', favId));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `favorites/${favId}`);
      }
    } else {
      const now = Timestamp.now();
      const expiresAt = new Timestamp(now.seconds + 24 * 60 * 60, now.nanoseconds);
      try {
        await setDoc(doc(db, 'favorites', favId), {
          userId: user.uid,
          newsId: news.id,
          title: news.title,
          summary: news.summary,
          category: news.category,
          imageUrl: news.imageUrl,
          url: news.url,
          source: news.source,
          createdAt: now,
          expiresAt: expiresAt
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `favorites/${favId}`);
      }
    }
  };

  const paginate = (newDirection: number) => {
    const nextIndex = currentIndex + newDirection;
    if (nextIndex >= 0 && nextIndex < displayedNews.length) {
      setDirection(newDirection);
      setCurrentIndex(nextIndex);
    }
  };

  const displayedNews = (showFavoritesOnly 
    ? Object.values(favorites).sort((a: any, b: any) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)) 
    : newsItems)
    .filter(item => {
      // If showing favorites, we might want to see all of them regardless of category
      // but let's keep the category filter if the user explicitly selected one.
      // However, the user request suggests they expect to see their favorites when they click the heart.
      const category = item.category || 'Generale';
      const matchesCategory = selectedCategory === 'all' || 
        category.toLowerCase().includes(selectedCategory.toLowerCase()) || 
        selectedCategory.toLowerCase().includes(category.toLowerCase());
      
      const matchesSearch = !searchQuery || 
        (item.title && item.title.toLowerCase().includes(searchQuery.toLowerCase())) || 
        (item.summary && item.summary.toLowerCase().includes(searchQuery.toLowerCase()));

      return matchesCategory && matchesSearch;
    });
  const currentItem = displayedNews[currentIndex];

  return (
    <div className="h-svh w-full bg-black overflow-hidden relative flex items-center justify-center font-montserrat text-slate-200">
      <AnimatePresence>
        {showSplash && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1, ease: "easeInOut" }}
            className="fixed inset-0 z-[200] flex flex-col items-center justify-center overflow-hidden"
          >
            {/* Random Background */}
            <motion.div 
              initial={{ scale: 1.1 }}
              animate={{ scale: 1 }}
              transition={{ duration: 5, ease: "linear" }}
              className="absolute inset-0 z-0"
            >
              <img 
                src={splashBg} 
                alt="Splash Background" 
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            </motion.div>

            {/* Content */}
            <div className="relative z-10 flex flex-col items-center text-center">
              <motion.p 
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.5, duration: 0.8 }}
                className="text-white/60 uppercase tracking-[0.4em] text-xs font-bold mb-6"
              >
                Benvenuti in
              </motion.p>
              
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.8, duration: 1, ease: [0.16, 1, 0.3, 1] }}
                className="relative"
              >
                {/* Logo Placeholder - User should upload their logo as /logo.png */}
                <img 
                  src="/logocompletook.png" 
                  alt="SpotSmart Logo" 
                  className="w-72 md:w-96 h-auto drop-shadow-[0_0_50px_rgba(255,255,255,0.4)]"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    // Fallback if image fails
                    (e.target as HTMLImageElement).src = "https://picsum.photos/seed/logo/400/200?blur=2";
                  }}
                />
              </motion.div>

              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: 100 }}
                transition={{ delay: 1.2, duration: 1.5, ease: "easeInOut" }}
                className="h-[1px] bg-white/20 mt-12 mb-4"
              />
              
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 2, duration: 0.5 }}
                className="text-white/30 text-[10px] uppercase tracking-widest"
              >
                Caricamento notizie intelligenti...
              </motion.p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.main 
        initial={{ opacity: 0 }}
        animate={{ 
          opacity: 1,
          scale: isMenuOpen ? 0.96 : 1
        }}
        transition={{ 
          duration: 0.4,
          ease: [0.16, 1, 0.3, 1] // Custom quintic ease-out
        }}
        className="relative z-10 w-full h-full flex items-center"
      >
        <div className="relative w-full h-full group" ref={containerRef}>
          {/* Backdrop Blur Overlay when Menu is Open */}
          <AnimatePresence>
            {isMenuOpen && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => {
                  setIsMenuOpen(false);
                  setIsCategoryMenuOpen(false);
                }}
                className="absolute inset-0 bg-black/40 z-[95]"
              />
            )}
          </AnimatePresence>

          {/* Fixed Buttons at Bottom Right */}
          <div className="absolute bottom-[30px] right-10 z-[100] flex items-center gap-4">
            <AnimatePresence>
              {!isMenuOpen && (
                <div className="flex items-center gap-3">
                  <motion.button
                    initial={{ opacity: 0, x: 20, scale: 0.5 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={{ opacity: 0, x: 20, scale: 0.5 }}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => {
                      if (displayedNews[currentIndex]) {
                        window.open(displayedNews[currentIndex].url, '_blank');
                      }
                    }}
                    className="w-12 h-12 rounded-full bg-white/5 backdrop-blur-md border border-white/5 text-white/50 flex items-center justify-center shadow-lg hover:bg-white/10 hover:text-white transition-all"
                  >
                    <ExternalLink className="w-5 h-5" />
                  </motion.button>
                </div>
              )}
            </AnimatePresence>
            <div className="relative">
              <AnimatePresence>
                {isMenuOpen && (
                  <motion.div
                    variants={{
                      hidden: { opacity: 0 },
                      show: {
                        opacity: 1,
                        transition: {
                          staggerChildren: 0.08,
                          delayChildren: 0.05,
                          ease: [0.16, 1, 0.3, 1]
                        }
                      },
                      exit: {
                        opacity: 0,
                        transition: {
                          staggerChildren: 0.04,
                          staggerDirection: -1
                        }
                      }
                    }}
                    initial="hidden"
                    animate="show"
                    exit="exit"
                    className="absolute bottom-full right-0 mb-6 flex flex-col gap-4"
                  >
                    {[
                      { 
                        icon: RefreshCw, 
                        label: 'Aggiorna', 
                        action: fetchAllFeeds 
                      },
                      { 
                        icon: Info, 
                        label: 'Info & Privacy', 
                        action: () => setIsInfoOpen(true)
                      },
                      { 
                        icon: LayoutGrid, 
                        label: 'Categorie', 
                        action: () => setIsCategoryMenuOpen(!isCategoryMenuOpen)
                      },
                      { 
                        icon: Heart, 
                        label: showFavoritesOnly ? 'Tutte' : 'Preferiti', 
                        isActive: showFavoritesOnly,
                        action: () => {
                          const nextVal = !showFavoritesOnly;
                          setShowFavoritesOnly(nextVal);
                          if (nextVal) {
                            setSelectedCategory('all');
                            setCurrentIndex(0);
                            setSearchQuery('');
                          }
                        }
                      },
                      { 
                        icon: user ? LogOut : UserIcon, 
                        label: user ? 'Logout' : 'Profilo', 
                        isActive: !!user,
                        action: user ? logout : loginWithGoogle 
                      },
                      { 
                        icon: Send, 
                        label: 'Invia App', 
                        action: () => {
                          if (navigator.share) {
                            navigator.share({
                              title: 'SpotSmart',
                              text: 'Leggi le ultime notizie su SpotSmart!',
                              url: 'https://spotsmart.it'
                            }).catch(() => {});
                          }
                        }
                      },
                      { 
                        icon: Share2, 
                        label: 'Condividi', 
                        action: () => {
                          if (displayedNews[currentIndex]) {
                            navigator.share?.({
                              title: displayedNews[currentIndex].title,
                              url: displayedNews[currentIndex].url
                            }).catch(() => {});
                          }
                        } 
                      },
                    ].map((item, i) => (
                        <motion.div 
                          key={i} 
                          variants={{
                            hidden: { opacity: 0, scale: 0.4, y: 40, x: 20, rotate: -20 },
                            show: { 
                              opacity: 1, 
                              scale: 1, 
                              y: 0,
                              x: 0,
                              rotate: 0,
                              transition: { 
                                type: "spring", 
                                stiffness: 500, 
                                damping: 30,
                                mass: 0.5
                              }
                            },
                            exit: { 
                              opacity: 0, 
                              scale: 0.4, 
                              y: 20,
                              transition: { duration: 0.2, ease: "easeIn" }
                            }
                          }}
                          className="relative group flex justify-end"
                        >
                        <motion.button
                          whileHover={{ scale: 1.15, x: -5 }}
                          whileTap={{ scale: 0.9 }}
                          onClick={() => { item.action(); if (item.label !== 'Categorie') setIsMenuOpen(false); }}
                          className={`w-12 h-12 rounded-full flex items-center justify-center backdrop-blur-xl border border-white/20 shadow-2xl transition-all relative ${
                            (item.isActive) 
                              ? 'bg-indigo-500/40 border-indigo-400/50 text-white' 
                              : (item.label === 'Categorie' && isCategoryMenuOpen)
                                ? `${selectedCategoryData?.color.replace('bg-', 'bg-')}/40 border-indigo-400/50 text-white`
                                : 'bg-white/10 text-white/80 hover:bg-white/20 hover:text-white'
                          } ${isCategoryMenuOpen && item.label !== 'Categorie' ? 'opacity-20' : 'opacity-100'}`}
                        >
                          <motion.div layoutId={item.isActive ? "active-menu-icon" : undefined}>
                            <item.icon className={`w-5 h-5 ${item.isActive ? 'fill-current' : ''}`} />
                          </motion.div>
                          <span className="absolute right-full mr-4 px-3 py-1 text-white text-[10px] font-bold uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                            {item.label}
                          </span>
                        </motion.button>

                        {item.label === 'Categorie' && (
                          <AnimatePresence>
                            {isCategoryMenuOpen && (
                              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                                {CATEGORIES.map((cat, ci, arr) => {
                                  const angle = (Math.PI / 2) + (Math.PI * (ci / (arr.length - 1))); // From 90 to 270 degrees
                                  const radius = 112;
                                  const x = Math.cos(angle) * radius;
                                  const y = Math.sin(angle) * radius;
                                  
                                  return (
                                    <motion.button
                                      key={cat.id}
                                      initial={{ x: 0, y: 0, opacity: 0, scale: 0 }}
                                      animate={{ x, y, opacity: 1, scale: 1 }}
                                      exit={{ x: 0, y: 0, opacity: 0, scale: 0 }}
                                      transition={{ 
                                        delay: ci * 0.03, 
                                        type: 'spring', 
                                        stiffness: 350, 
                                        damping: 25,
                                        mass: 0.8
                                      }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedCategory(cat.id);
                                        setIsCategoryMenuOpen(false);
                                        setIsMenuOpen(false);
                                        setCurrentIndex(0);
                                      }}
                                      className={`absolute pointer-events-auto w-[44px] h-[44px] rounded-full flex items-center justify-center backdrop-blur-xl border border-white/20 shadow-xl transition-all group/cat ${
                                        selectedCategory === cat.id 
                                          ? `${cat.color} text-white` 
                                          : 'bg-white/20 text-white/80 hover:bg-white/30 hover:text-white'
                                      }`}
                                      style={{ left: '50%', top: '50%', marginLeft: '-22px', marginTop: '-22px' }}
                                    >
                                      <motion.div layoutId={selectedCategory === cat.id ? "active-cat-icon" : undefined}>
                                        <cat.icon className="w-4 h-4" />
                                      </motion.div>
                                      <span 
                                        className="absolute px-2 py-0.5 text-white text-[9px] font-bold uppercase tracking-wider opacity-0 group-hover/cat:opacity-100 transition-opacity pointer-events-none whitespace-nowrap drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]"
                                        style={{
                                          left: x < 0 ? 'auto' : '120%',
                                          right: x < 0 ? '120%' : 'auto',
                                          top: '50%',
                                          transform: 'translateY(-50%)'
                                        }}
                                      >
                                        {cat.label}
                                      </span>
                                    </motion.button>
                                  );
                                })}
                              </div>
                            )}
                          </AnimatePresence>
                        )}
                      </motion.div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {isMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, x: 20, scale: 0.5 }}
                    animate={{ opacity: 1, x: -70, scale: 1 }}
                    exit={{ opacity: 0, x: 20, scale: 0.5 }}
                    className="absolute top-1/2 -translate-y-1/2 right-0 flex items-center"
                  >
                    {isSearchOpen ? (
                      <motion.div 
                        layoutId="search-bubble"
                        initial={{ width: 48, opacity: 0 }}
                        animate={{ width: 260, opacity: 1 }}
                        exit={{ width: 48, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                        className="h-12 bg-white/10 backdrop-blur-xl border border-white/20 rounded-full flex items-center px-4 shadow-[0_0_20px_rgba(255,255,255,0.1)] overflow-hidden"
                      >
                        <Search className="w-5 h-5 text-white/60 mr-2 shrink-0" />
                        <input
                          ref={searchInputRef}
                          type="text"
                          value={searchQuery}
                          onChange={(e) => {
                            setSearchQuery(e.target.value);
                            setCurrentIndex(0);
                          }}
                          placeholder="Cerca articoli..."
                          className="bg-transparent border-none outline-none text-white text-sm w-full placeholder:text-white/40"
                          onBlur={() => {
                            if (!searchQuery) setIsSearchOpen(false);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') setIsMenuOpen(false);
                            if (e.key === 'Escape') {
                              setIsSearchOpen(false);
                              setSearchQuery('');
                            }
                          }}
                        />
                        {searchQuery && (
                          <button 
                            onClick={() => {
                              setSearchQuery('');
                              searchInputRef.current?.focus();
                            }}
                            className="ml-2 text-white/40 hover:text-white transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </motion.div>
                    ) : (
                      <motion.button
                        layoutId="search-bubble"
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => {
                          setIsSearchOpen(true);
                          setTimeout(() => searchInputRef.current?.focus(), 100);
                        }}
                        className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-white flex items-center justify-center shadow-lg"
                      >
                        <Search className="w-5 h-5" />
                      </motion.button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {selectedCategory !== 'all' && !isMenuOpen && (
                  <motion.button
                    initial={{ opacity: 0, y: 20, scale: 0.5 }}
                    animate={{ opacity: 1, y: -125, scale: 1 }}
                    exit={{ opacity: 0, y: 20, scale: 0.5 }}
                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => {
                      setSelectedCategory('all');
                      setCurrentIndex(0);
                    }}
                    className={`absolute bottom-0 right-1 w-12 h-12 rounded-full text-white flex items-center justify-center shadow-lg border z-[90] ${selectedCategoryData?.color || 'bg-indigo-600'} ${selectedCategoryData?.border || 'border-indigo-400/30'}`}
                  >
                    <motion.div layoutId="active-cat-icon">
                      {SelectedCategoryIcon && <SelectedCategoryIcon className="w-5 h-5" />}
                    </motion.div>
                  </motion.button>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {!isMenuOpen && (
                  <motion.button
                    initial={{ opacity: 0, y: 20, scale: 0.5 }}
                    animate={{ opacity: 1, y: -65, scale: 1 }}
                    exit={{ opacity: 0, y: 20, scale: 0.5 }}
                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => {
                      if (!user) {
                        loginWithGoogle();
                        return;
                      }
                      if (currentItem) {
                        toggleFavorite(currentItem as NewsItem);
                      }
                    }}
                    className={`absolute bottom-0 right-1 w-12 h-12 rounded-full flex items-center justify-center shadow-lg border z-[90] transition-all ${
                      currentItem && favorites[currentItem.id]
                        ? 'bg-pink-600 border-pink-400/30 text-white' 
                        : 'bg-white/10 border-white/10 text-white/60 hover:text-white hover:bg-white/20'
                    } ${!user ? 'opacity-40 grayscale-[0.5]' : 'opacity-100'}`}
                  >
                    <motion.div layoutId="active-fav-icon">
                      <Heart className={`w-5 h-5 ${currentItem && favorites[currentItem.id] ? 'fill-white' : ''}`} />
                    </motion.div>
                  </motion.button>
                )}
              </AnimatePresence>

              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                animate={{ rotate: isMenuOpen ? -60 : 0 }}
                transition={{ type: "spring", stiffness: 400, damping: 25 }}
                onClick={() => {
                  setIsMenuOpen(!isMenuOpen);
                  if (isMenuOpen) {
                    setIsCategoryMenuOpen(false);
                    setIsSearchOpen(false);
                  }
                }}
                className={`w-14 h-14 rounded-full flex items-center justify-center border transition-all shadow-2xl backdrop-blur-md z-[100] p-0 overflow-hidden ${isMenuOpen ? 'bg-white/20 border-white/40' : 'bg-white/5 border-white/10 hover:bg-white/10 opacity-90 hover:opacity-100'}`}
              >
                <AnimatePresence mode="wait">
                  <motion.div
                    key={isMenuOpen ? 'close' : 'menu'}
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    transition={{ duration: 0.2 }}
                    className="w-full h-full flex items-center justify-center"
                  >
                    {isMenuOpen ? (
                      <X className="w-6 h-6 text-white" />
                    ) : (
                      <img src="/logo.png" className="w-10 h-10 object-contain" alt="Logo" />
                    )}
                  </motion.div>
                </AnimatePresence>
              </motion.button>
            </div>
          </div>

          <div className="relative w-full h-full overflow-hidden flex flex-col bg-black">
            <div className="flex-1 relative overflow-hidden">
              {loading && newsItems.length === 0 ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black z-50">
                  <motion.img
                    src="/logocompletook.png"
                    animate={{ 
                      scale: [1, 1.05, 1],
                      opacity: [0.6, 1, 0.6]
                    }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                    className="w-48 md:w-64 h-auto drop-shadow-[0_0_30px_rgba(255,255,255,0.2)] mb-8"
                  />
                  <p className="text-white/40 font-bold uppercase tracking-widest text-xs animate-pulse">Caricamento Notizie...</p>
                </div>
              ) : (
                <AnimatePresence initial={false} custom={direction} mode="popLayout">
                {currentItem ? (
                      <motion.div
                        key={currentItem.id}
                        custom={direction}
                        variants={variants}
                        initial="enter"
                        animate="center"
                        exit="exit"
                        drag="x"
                        dragConstraints={{ left: 0, right: 0 }}
                        dragElastic={0.8}
                        onDragEnd={(e, { offset, velocity }) => {
                          const swipe = Math.abs(offset.x) > 50 || Math.abs(velocity.x) > 200;
                          if (swipe) {
                            const nextIndex = currentIndex + (offset.x > 0 ? -1 : 1);
                            if (nextIndex >= 0 && nextIndex < displayedNews.length) {
                              setDirection(offset.x > 0 ? -1 : 1);
                              setCurrentIndex(nextIndex);
                            }
                          }
                        }}
                        transition={{
                          x: { type: "spring", stiffness: 300, damping: 30 },
                          opacity: { duration: 0.2 }
                        }}
                        className="absolute inset-0 flex flex-col cursor-grab active:cursor-grabbing preserve-3d"
                      >
                        <div className="absolute inset-x-0 top-0 h-[70%] z-0 bg-black overflow-hidden">
                          {currentItem.videoUrl ? (
                            <video
                              src={currentItem.videoUrl}
                              autoPlay
                              loop
                              muted
                              playsInline
                              className="w-full h-full object-cover opacity-80 scale-150 origin-top"
                            />
                          ) : (
                            <div className="relative w-full h-full scale-150 origin-top">
                              <img 
                                src={currentItem.imageUrl} 
                                alt={currentItem.title}
                                referrerPolicy="no-referrer"
                                className="absolute inset-0 w-full h-full object-cover object-top blur-2xl opacity-40 scale-110"
                              />
                              <img 
                                src={currentItem.imageUrl} 
                                alt={currentItem.title}
                                referrerPolicy="no-referrer"
                                className="relative w-full h-full object-contain object-top z-10"
                              />
                            </div>
                          )}
                          {/* Bottom-focused Vignette/Gradient - 80% Increased Intensity */}
                          <div className="absolute inset-x-0 bottom-0 h-[80%] z-20 pointer-events-none bg-gradient-to-t from-black via-black/90 to-transparent opacity-100" />
                          <div className="absolute inset-x-0 bottom-0 h-1/2 z-20 pointer-events-none bg-gradient-to-t from-black to-transparent opacity-100" />
                          <div className="absolute inset-0 z-20 pointer-events-none shadow-[inset_0_-250px_200px_-100px_rgba(0,0,0,1)]" />
                        </div>

                      <div className="relative z-20 flex-1 flex flex-col justify-end p-8 md:p-16 pt-0 pb-28 md:pb-36 mt-0">
                        <motion.div 
                          initial="hidden"
                          animate="visible"
                          variants={{
                            hidden: { opacity: 0 },
                            visible: {
                              opacity: 1,
                              transition: {
                                staggerChildren: 0.15,
                                delayChildren: 0.2
                              }
                            }
                          }}
                          className="max-w-2xl space-y-4"
                        >
                          <div className="overflow-hidden">
                            <h2 className="text-3xl md:text-5xl font-black text-white leading-tight tracking-tighter uppercase flex flex-wrap gap-x-3">
                              {currentItem.title.split(' ').map((word, i) => (
                                <motion.span
                                  key={i}
                                  variants={{
                                    hidden: { y: "100%", opacity: 0, filter: 'blur(10px)' },
                                    visible: { 
                                      y: 0, 
                                      opacity: 1, 
                                      filter: 'blur(0px)',
                                      transition: { type: "spring", stiffness: 200, damping: 20 }
                                    }
                                  }}
                                  className="inline-block drop-shadow-[0_0_15px_rgba(255,255,255,0.4)]"
                                  style={{
                                    textShadow: '0 0 10px rgba(255,255,255,0.3), 0 0 20px rgba(255,255,255,0.2)'
                                  }}
                                >
                                  {word}
                                </motion.span>
                              ))}
                            </h2>
                          </div>
                          
                          <motion.div
                            variants={{
                              hidden: { opacity: 0, x: -30 },
                              visible: { 
                                opacity: 1, 
                                x: 0,
                                transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] }
                              }
                            }}
                            className="relative"
                          >
                            <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-pink-500 to-purple-600 shadow-[0_0_10px_rgba(236,72,153,0.5)]" />
                            <p className="text-lg md:text-xl text-white/90 font-medium leading-tight pl-6 drop-shadow-md italic line-clamp-8 max-w-md">
                              {currentItem.summary}
                            </p>
                          </motion.div>

                          <motion.div
                            variants={{
                              hidden: { opacity: 0, scale: 0.8 },
                              visible: { 
                                opacity: 1, 
                                scale: 1,
                                transition: { delay: 0.6, duration: 0.4 }
                              }
                            }}
                            className="flex items-center gap-4 pt-2"
                          >
                            <div className="flex items-center gap-2">
                              <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border ${selectedCategoryData?.border || 'border-white/20'} ${selectedCategoryData?.color || 'bg-white/10'} text-white shadow-[0_0_15px_rgba(255,255,255,0.1)]`}>
                                {currentItem.category}
                              </span>
                              {favorites[currentItem.id] && (
                                <motion.div
                                  initial={{ scale: 0, rotate: -45 }}
                                  animate={{ scale: 1, rotate: 0 }}
                                  className="w-6 h-6 rounded-full bg-pink-500 flex items-center justify-center shadow-[0_0_15px_rgba(236,72,153,0.6)]"
                                >
                                  <Heart className="w-3 h-3 text-white fill-white" />
                                </motion.div>
                              )}
                            </div>
                            <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">
                              {currentItem.source} • {currentItem.time}
                            </span>
                          </motion.div>

                        </motion.div>
                      </div>
                    </motion.div>
                ) : !showFavoritesOnly ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black p-8 text-center">
                    <motion.div
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="max-w-md space-y-6"
                    >
                      <div className="w-20 h-20 bg-white/5 border border-white/10 rounded-3xl flex items-center justify-center mx-auto mb-8">
                        <Search className="w-10 h-10 text-white/20" />
                      </div>
                      <h3 className="text-3xl font-black text-white uppercase tracking-tighter">Nessuna Notizia</h3>
                      <p className="text-white/40 text-lg font-medium leading-relaxed">
                        Non abbiamo trovato articoli per questa categoria o ricerca. Prova a cambiare filtri o aggiorna i feed.
                      </p>
                      <button 
                        onClick={fetchAllFeeds}
                        className="px-10 py-5 bg-indigo-600 text-white font-black uppercase tracking-tighter text-sm hover:bg-indigo-500 transition-all shadow-[0_0_30px_rgba(79,70,229,0.3)]"
                      >
                        Aggiorna Feed
                      </button>
                    </motion.div>
                  </div>
                ) : (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="absolute inset-0 flex flex-col items-center justify-center text-white/40 gap-6 p-8 text-center"
                  >
                    <div className="w-24 h-24 rounded-full bg-white/5 flex items-center justify-center border border-white/10 mb-2">
                      <Heart className="w-10 h-10 opacity-20" />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Nessun preferito</h3>
                      <p className="text-sm text-white/40 max-w-xs mx-auto">Salva le notizie che ti interessano cliccando sull'icona del cuore.</p>
                    </div>
                    <button 
                      onClick={() => setShowFavoritesOnly(false)}
                      className="px-8 py-3 rounded-full bg-white/10 border border-white/20 text-white font-bold uppercase text-xs tracking-[0.2em] hover:bg-white/20 transition-all active:scale-95"
                    >
                      Esplora Notizie
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
              )}
            </div>
          </div>
        </div>
      </motion.main>

      <style dangerouslySetInnerHTML={{ __html: `
        .perspective-1000 {
          perspective: 1000px;
        }
        .preserve-3d {
          transform-style: preserve-3d;
        }
      `}} />

      {/* Info Modal */}
      <AnimatePresence>
        {isInfoOpen && (
          <motion.div
            initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
            animate={{ opacity: 1, backdropFilter: 'blur(10px)' }}
            exit={{ opacity: 0, backdropFilter: 'blur(0px)' }}
            className="fixed inset-0 z-[300] bg-black/80 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="w-full max-w-2xl max-h-[85vh] bg-slate-900/90 border border-white/10 rounded-3xl overflow-hidden shadow-2xl flex flex-col"
            >
              <div className="p-6 md:p-8 flex items-center justify-between border-b border-white/5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
                    <Info className="w-5 h-5 text-indigo-400" />
                  </div>
                  <h3 className="text-xl font-bold text-white">Info & Privacy</h3>
                </div>
                <button 
                  onClick={() => setIsInfoOpen(false)}
                  className="w-10 h-10 rounded-full hover:bg-white/5 flex items-center justify-center transition-colors"
                >
                  <X className="w-6 h-6 text-white/40" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-8 scrollbar-hide focus-visible:outline-none">
                <section>
                  <h4 className="text-indigo-400 font-bold uppercase text-xs tracking-widest mb-4">Informazioni Legali</h4>
                  <div className="space-y-4 text-white/60 text-sm leading-relaxed">
                    <p>
                      <strong>SpotSmart</strong> (spotsmart.it) è un'applicazione ideata e progettata da <strong>Castro Massimo</strong>, responsabile del trattamento e della conservazione dei dati personali.
                    </p>
                    <p>
                      Email di contatto: <a href="mailto:castromassimo@gmail.com" className="text-indigo-400 hover:underline">castromassimo@gmail.com</a>
                    </p>
                  </div>
                </section>

                <section>
                  <h4 className="text-indigo-400 font-bold uppercase text-xs tracking-widest mb-4">GDPR & Privacy</h4>
                  <div className="space-y-4 text-white/60 text-sm leading-relaxed">
                    <p>
                      I dati degli utenti (preferiti e profili) sono conservati esclusivamente presso i server protetti di <strong>Firebase (Google Cloud)</strong> nel pieno rispetto delle normative vigenti.
                    </p>
                    <p>
                      Il periodo di conservazione dei dati è limitato al tempo strettamente necessario per l'erogazione del servizio o come previsto dalle norme di legge sulla conservazione dei dati digitali.
                    </p>
                    <p>
                      Gli utenti hanno il diritto in qualsiasi momento di richiedere la visione, la modifica o la cancellazione dei propri dati scrivendo all'indirizzo email sopra indicato.
                    </p>
                  </div>
                </section>

                <section>
                  <h4 className="text-indigo-400 font-bold uppercase text-xs tracking-widest mb-4">Cookie Policy</h4>
                  <div className="space-y-4 text-white/60 text-sm leading-relaxed">
                    <p>
                      Utilizziamo esclusivamente cookie tecnici necessari al corretto funzionamento dell'app e alla memorizzazione delle tue preferenze di sessione.
                    </p>
                  </div>
                </section>
              </div>

              <div className="p-6 bg-white/5 text-center">
                <p className="text-[10px] text-white/20 uppercase tracking-[0.3em]">SpotSmart App © 2026 - Versione 1.0.0</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cookie Banner */}
      <AnimatePresence>
        {showCookieBanner && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-6 left-6 right-6 md:left-auto md:right-10 md:w-96 z-[400]"
          >
            <div className="bg-slate-900/95 backdrop-blur-xl border border-white/10 p-5 rounded-2xl shadow-2xl flex flex-col gap-4">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-indigo-500/10 flex items-center justify-center shrink-0">
                  <Globe className="w-5 h-5 text-indigo-400" />
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-white/80 font-medium leading-normal">
                    Utilizziamo i cookie per migliorare la tua esperienza. <button onClick={() => {setIsInfoOpen(true); setIsMenuOpen(false);}} className="text-indigo-400 underline underline-offset-4 hover:text-indigo-300">Leggi di più</button>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => {
                    localStorage.setItem('cookieConsent', 'accepted');
                    setShowCookieBanner(false);
                  }}
                  className="flex-1 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-xs font-bold uppercase tracking-widest transition-colors"
                >
                  Accetto
                </button>
                <button 
                  onClick={() => {
                    localStorage.setItem('cookieConsent', 'rejected');
                    setShowCookieBanner(false);
                  }}
                  className="flex-1 px-4 py-2 bg-white/5 hover:bg-white/10 text-white/60 rounded-lg text-xs font-bold uppercase tracking-widest transition-colors"
                >
                  Rifiuto
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

