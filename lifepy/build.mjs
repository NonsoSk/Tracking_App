// Bundles lifepy/src into single self-contained HTML files:
//   dist/lifepy.html   - open it in any browser, or send it to a phone; works offline
//   dist/artifact.html - the same page without the document wrapper, for publishing on claude.ai
// Run with: node lifepy/build.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const src = (f) => readFileSync(join(root, 'src', f), 'utf8');

const parts = {
  STYLE: src('style.css'),
  PYTHON: src('python.js'),
  CONTENT: src('content.js'),
  ART: src('art.js'),
  GAME: src('game.js'),
};

for (const [name, text] of Object.entries(parts)) {
  if (/<\/(script|style)/i.test(text)) throw new Error(`${name} contains a closing tag that would break the inlined page`);
}

let page = src('page.html');
for (const [name, text] of Object.entries(parts)) {
  const marker = `/*@@${name}@@*/`;
  if (!page.includes(marker)) throw new Error(`page.html is missing ${marker}`);
  page = page.replace(marker, () => text);
}

const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
</head>
<body>
${page}
</body>
</html>
`;

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'artifact.html'), page);
writeFileSync(join(root, 'dist', 'lifepy.html'), standalone);
console.log(`Built dist/lifepy.html and dist/artifact.html (${Math.round(standalone.length / 1024)} KB)`);
