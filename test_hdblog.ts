import Parser from "rss-parser";

const parser = new Parser({
  customFields: {
    item: [
      ['content:encoded', 'content:encoded'],
      ['description', 'description']
    ]
  }
});

async function test() {
  try {
    const feed = await parser.parseURL("https://www.hdblog.it/feed/");
    if (feed.items.length > 0) {
      const item = feed.items[0];
      console.log("Full Content Snippet (Encoded):", item['content:encoded']?.substring(0, 1000));
      console.log("Description:", item.description?.substring(0, 1000));
      const content = item['content:encoded'] || item.content || item.description || "";
      const imgMatch = content.match(/<img[^>]+src=["']([^"']+)["']/);
      console.log("Extracted Image with Regex:", imgMatch?.[1]);
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

test();
