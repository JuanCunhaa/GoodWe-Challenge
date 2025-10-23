/**
 * Normalize text files to UTF-8 without mojibake and strip BOM.
 * Heuristic: if the Latin1->UTF8 roundtrip reduces typical mojibake markers, keep it.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGET_DIRS = [
  path.join(ROOT, 'frontend', 'src'),
  path.join(ROOT, 'backend', 'src'),
  path.join(ROOT),
];
const EXTS = new Set(['.js','.jsx','.ts','.tsx','.mjs','.cjs','.json','.md','.css','.html','.yml','.yaml']);
const IGNORE_DIRS = new Set(['.git','node_modules','dist','build','out','.next','.cache','.venv','venv','piper']);

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

function stripBom(s) { return s.replace(/^\uFEFF+/, ''); }

function scoreBad(s) {
  // Count common mojibake markers and replacement chars
  const patterns = [
    /Ã/g, /Â/g, /�/g, /ǜ/g, /Ǹ/g, /Ǧ/g, /ǭ/g, /ǟ/g, /�?/g, /�/g
  ];
  let n = 0; for (const re of patterns) { const m = s.match(re); if (m) n += m.length; }
  return n;
}

function tryLatin1ToUtf8Fix(text) {
  // Iteratively try to improve by treating current string as latin1 -> utf8
  let cur = stripBom(text);
  let best = cur; let bestScore = scoreBad(cur);
  for (let i=0; i<3; i++) {
    const cand = stripBom(Buffer.from(cur, 'latin1').toString('utf8'));
    const sc = scoreBad(cand);
    if (sc < bestScore) { best = cand; bestScore = sc; cur = cand; } else { break; }
  }
  return best;
}

function run() {
  const files = TARGET_DIRS.flatMap(listFiles);
  let changed = 0, checked = 0;
  for (const f of files) {
    try {
      checked++;
      const buf = fs.readFileSync(f);
      let text = buf.toString('utf8');
      const before = text;
      text = tryLatin1ToUtf8Fix(text);
      // Always strip leading BOMs
      text = stripBom(text);
      if (text !== before) {
        fs.writeFileSync(f, text, 'utf8');
        changed++;
      }
    } catch (e) {
      // ignore
    }
  }
  console.log(JSON.stringify({ checked, changed }, null, 2));
}

run();
