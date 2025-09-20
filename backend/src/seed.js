import fs from 'node:fs';
import path from 'node:path';
import { seedPowerstations, listPowerstations } from './db.js';

const IDS = [
  '6ef62eb2-7959-4c49-ad0a-0ce75565023a',
  // 13th missing in the provided list; can be added later
];

seedPowerstations(IDS);

// Generate a readable txt mapping (business name TBD)
const outDir = path.join(process.cwd(), 'backend', 'data');
fs.mkdirSync(outDir, { recursive: true });
const lines = listPowerstations().map((r, i) => `${String(i+1).padStart(2,'0')} | business: ${r.business_name || 'TBD'} | id: ${r.id}`);
fs.writeFileSync(path.join(outDir, 'logins.txt'), lines.join('\n'), 'utf-8');
console.log('Seed completed. Wrote backend/data/logins.txt');

