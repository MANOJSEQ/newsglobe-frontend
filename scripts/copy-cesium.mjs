// scripts/copy-cesium.mjs
import { mkdirSync, existsSync, cpSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CESIUM_SRC = resolve(__dirname, "../node_modules/cesium/Build/Cesium");
const CESIUM_DEST = resolve(__dirname, "../public/cesium");

function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function main() {
  ensureDir(CESIUM_DEST);
  cpSync(CESIUM_SRC, CESIUM_DEST, { recursive: true });
  console.log(`✅ Cesium assets copied to ${CESIUM_DEST}`);
}

main();
