/*
 Detect and fix non-UTF-8 encoded text files (e.g., Latin-1/Windows-1252)
 Usage: node scripts/fix-encoding.js
*/
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const EXTS = new Set(['.js','.jsx','.ts','.tsx','.mjs','.cjs','.json','.html','.css','.md','.yml','.yaml','.env','.txt']);
const IGNORE_DIRS = new Set(['.git','node_modules','dist','build','out','.next','.cache','.venv','venv']);

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(p));
    else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (EXTS.has(ext)) out.push(p);
    }
  }
  return out;
}

function isUtf8Buffer(buf) {
  // If decoding as UTF-8 yields replacement char, it’s not strict UTF-8
  const s = buf.toString('utf8');
  return !s.includes('\uFFFD');
}

function convertLatin1ToUtf8(buf) {
  const latin = buf.toString('latin1');
  return Buffer.from(latin, 'utf8');
}

function run() {
  const files = listFiles(ROOT);
  let checked = 0, converted = 0, skipped = 0;
  const changed = [];
  for (const f of files) {
    checked++;
    try {
      const buf = fs.readFileSync(f);
      if (isUtf8Buffer(buf)) { skipped++; continue; }
      const out = convertLatin1ToUtf8(buf);
      fs.writeFileSync(f, out);
      converted++;
      changed.push(f);
    } catch (e) {
      console.error('Error processing', f, e.message);
    }
  }
  console.log(JSON.stringify({ checked, converted, skipped, changed }, null, 2));
}

run();

