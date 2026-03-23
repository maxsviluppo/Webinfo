import fs from 'node:fs';
import path from 'node:path';

const ADSENSE_FILE = path.join(process.cwd(), "adsense_config.json");

const data = {
  enabled: true,
  client: "test-client",
  script: "test-script",
  adsTxt: "test-ads",
  metaTag: "test-meta"
};

try {
    fs.writeFileSync(ADSENSE_FILE, JSON.stringify(data, null, 2));
    console.log("Write success");
    const read = JSON.parse(fs.readFileSync(ADSENSE_FILE, 'utf-8'));
    console.log("Read back:", read.client === "test-client");
} catch (e) {
    console.error("Test failed:", e);
}
