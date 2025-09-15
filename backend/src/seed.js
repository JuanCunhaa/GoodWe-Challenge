import fs from 'node:fs';
import path from 'node:path';
import { seedPowerstations, listPowerstations } from './db.js';

const IDS = [
  'deaa8eb0-3f71-4b34-9680-09ab855fbc6c',
  '0ba50911-f58c-43ce-ad51-8b3081104eb2',
  '99b8d66c-4f9b-4432-b830-c51dd99ee1b7',
  'c91fdb38-d4b3-4eb5-a9cf-0f770a25f136',
  'b8f29159-70b6-414c-8782-d485da704238',
  'dfc20d8a-a0fc-4f47-b8e5-2cc0fdc95204',
  'f807c871-8ce8-4058-82d7-ebb29244ad9c',
  '12f28898-63f9-47fb-91ee-aead1ccc0a7f',
  '77d76fca-d526-45ea-a972-ed9f23fb8e9b',
  'e1a04ec3-953b-474f-a9ab-e14090074675',
  '6ef62eb2-7959-4c49-ad0a-0ce75565023a',
  '6a9870f1-b45a-4b7d-a6d8-629e0edeb5a5',
  // 13th missing in the provided list; can be added later
];

seedPowerstations(IDS);

// Generate a readable txt mapping (business name TBD)
const outDir = path.join(process.cwd(), 'backend', 'data');
fs.mkdirSync(outDir, { recursive: true });
const lines = listPowerstations().map((r, i) => `${String(i+1).padStart(2,'0')} | business: ${r.business_name || 'TBD'} | id: ${r.id}`);
fs.writeFileSync(path.join(outDir, 'logins.txt'), lines.join('\n'), 'utf-8');
console.log('Seed completed. Wrote backend/data/logins.txt');

