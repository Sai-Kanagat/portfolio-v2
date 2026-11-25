// One place that finds Playwright for every browser test. Order: PW_FROM (a package.json path), the local tools folder
// on the owner's machine, then this repository's own node_modules (what CI installs).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCAL = '/Users/saikanagat/saikanagat-analytics/tools/package.json';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const pwFrom = process.env.PW_FROM || (fs.existsSync(LOCAL) ? LOCAL : path.join(ROOT, 'package.json'));
export const pwRequire = createRequire(pwFrom);
