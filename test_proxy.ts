async function testProxy() {
  const url = "https://www.hdblog.it/feed/"; // Testing feed first
  // Actually proxy is for the article URL
  const articleUrl = "https://www.hdblog.it/roborock/articoli/n594611/roborock-saros-20-qrevo-curv-2-flow-confronto/";
  
  try {
    const response = await fetch(articleUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      }
    });
    console.log("Response Status:", response.status);
    console.log("Response Headers:", JSON.stringify(Object.fromEntries(response.headers.entries()), null, 2));
    const text = await response.text();
    console.log("Response Text Length:", text.length);
    console.log("X-Frame-Options:", response.headers.get("X-Frame-Options"));
    console.log("CSP:", response.headers.get("Content-Security-Policy"));
    if (text.includes("Cloudflare") || text.includes("Access Denied")) {
        console.log("BLOCKED BY CLOUDFLARE/WAF");
    }
  } catch (err) {
    console.error("Fetch Error:", err);
  }
}

testProxy();
