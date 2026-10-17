// Plays the whole prototype in a real browser the way a beginner would:
// tapping tiles, typing line by line, running broken code before fixing it.
// Fails on any console error. Saves screenshots for review.
//
// Run with: node lifepy/build.mjs && node lifepy/tests/playthrough.mjs [screenshot-dir]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch (e) {
  playwright = require(join(execSync('npm root -g').toString().trim(), 'playwright'));
}
const { chromium } = playwright;

const here = dirname(fileURLToPath(import.meta.url));
const pageUrl = pathToFileURL(resolve(here, '../dist/lifepy.html')).href;
const shots = resolve(process.argv[2] || join(here, '../.screenshots'));
mkdirSync(shots, { recursive: true });

const launchOpts = process.env.PLAYWRIGHT_BROWSERS_PATH ? {} : {};
const browser = await chromium.launch(launchOpts).catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }));

const problems = [];

async function newPage(opts) {
  const context = await browser.newContext(opts);
  // Google Fonts may be unreachable in CI; the page must work with fallbacks.
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/fonts\.googleapis|ERR_FAILED|net::/.test(msg.text())) problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  return page;
}

async function shot(page, name) {
  await page.screenshot({ path: join(shots, `${name}.png`), fullPage: false });
}

async function clickOverlayPrimary(page) {
  const btn = page.locator('#overlay:not([hidden]) .ov-actions .btn.primary');
  await btn.waitFor({ timeout: 5000 });
  await btn.click();
}

async function typeLikeABeginner(page, text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    // After Enter the editor indents by itself, so skip the spaces a person wouldn't type.
    await page.keyboard.type(i === 0 ? lines[i] : lines[i].replace(/^ +/, ''), { delay: 5 });
    if (i < lines.length - 1) await page.keyboard.press('Enter');
  }
}

async function waitForWin(page) {
  await page.locator('#feedback .fb-win').waitFor({ timeout: 30000 });
}

async function playRound(page, round, x, tag, opts) {
  if (round.pre) {
    await page.click('#btn-pre');
  }
  const run = () => page.click('#btn-run');
  switch (round.mode) {
    case 'watch':
      await run();
      break;
    case 'change': {
      const fill = (round.fill || []).map(x.t);
      for (let i = 0; i < fill.length; i++) await page.fill(`#slot-${i}`, fill[i]);
      await run();
      break;
    }
    case 'build': {
      for (const piece of round.solution.map(x.t)) {
        await page.locator('.tray .tile', { has: page.locator('.tile-code', { hasText: new RegExp(`^${piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) }).first().click();
      }
      if (opts.shots) await shot(page, `${tag}-built`);
      await run();
      break;
    }
    case 'fix': {
      await run();
      await page.locator('#feedback .fb-oops, #feedback .fb-info').waitFor({ timeout: 10000 });
      const title = await page.locator('#feedback h3').innerText();
      opts.reactions.push(`${tag}: ${title}`);
      if (opts.shots) await shot(page, `${tag}-mistake`);
      await page.fill('#code-input', x.t(round.answer));
      await run();
      break;
    }
    case 'guided':
    case 'free': {
      const prefill = x.t(round.code || '');
      const target = x.t(round.answer || round.ghost);
      await page.click('#code-input');
      await page.keyboard.press('Control+End');
      const rest = target.slice(prefill.length);
      if (round.mode === 'guided') {
        const half = Math.floor(rest.length / 2);
        await typeLikeABeginner(page, rest.slice(0, half));
        if (opts.shots) await shot(page, `${tag}-typing`);
        await typeLikeABeginner(page, rest.slice(half));
        const typed = await page.inputValue('#code-input');
        if (typed !== target) problems.push(`${tag}: typing produced ${JSON.stringify(typed)}, expected ${JSON.stringify(target)}`);
      } else {
        await typeLikeABeginner(page, rest);
      }
      await run();
      break;
    }
  }
  await waitForWin(page);
  if (opts.shots) await shot(page, `${tag}-win`);
}

async function fullPlaythrough(viewport, label, colorScheme) {
  const page = await newPage({ viewport, colorScheme, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await page.goto(pageUrl);
  await page.waitForSelector('#screen-title:not([hidden])');
  await shot(page, `${label}-01-title`);
  await page.click('#btn-play');
  await shot(page, `${label}-02-stories`);
  await page.click('[data-story="growingup"]');
  await page.fill('#player-name', 'Ada');
  await shot(page, `${label}-03-setup`);
  await page.click('#setup-form button[type="submit"]');
  await page.waitForSelector('#screen-level:not([hidden])');
  await shot(page, `${label}-04-first-level`);

  const { chapters, levels } = await page.evaluate(() => ({
    chapters: LifePyContent.CHAPTERS.filter((c) => !c.locked).map((c) => c.levels),
    levels: Object.keys(LifePyContent.LEVELS),
  }));
  const C = await import(pathToFileURL(resolve(here, '../src/content.js')).href).then((m) => m.default || m);
  const x = C.makeContext('Ada', 'westafrica');
  const reactions = [];
  const order = chapters.flat();
  for (let li = 0; li < order.length; li++) {
    const id = order[li];
    const level = C.LEVELS[id];
    const intro = page.locator('#overlay:not([hidden])');
    if (await intro.count()) await clickOverlayPrimary(page);
    for (let ri = 0; ri < level.rounds.length; ri++) {
      const tag = `${label}-${id}-r${ri + 1}`;
      await playRound(page, level.rounds[ri], x, tag, { shots: label === 'desktop', reactions });
      await page.click('#btn-next');
    }
    if (label === 'desktop' && (id === 'c1l6' || id === 'c2l7')) {
      await page.waitForTimeout(400);
      await shot(page, `${label}-${id}-reveal`);
    }
    await clickOverlayPrimary(page);
  }
  // End of prototype: notes, then results.
  await page.fill('#ov-notes', 'The brackets were tricky at first.');
  await page.waitForTimeout(400);
  await shot(page, `${label}-90-end`);
  await clickOverlayPrimary(page);
  await page.waitForSelector('#screen-results:not([hidden])');
  await shot(page, `${label}-91-results`);
  const state = await page.evaluate(() => LifePyGame.state);
  const doneCount = Object.keys(state.done).length;
  if (doneCount !== levels.length) problems.push(`${label}: finished ${doneCount} of ${levels.length} levels`);
  await page.click('#btn-notebook');
  await shot(page, `${label}-92-notebook`);
  await page.click('#btn-brand');
  await shot(page, `${label}-93-map`);
  await page.context().close();
  return { reactions, points: state.points };
}

async function phoneSpotChecks() {
  const page = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  await page.goto(pageUrl);
  await shot(page, 'phone-01-title');
  await page.click('#btn-play');
  await page.click('[data-story="growingup"]');
  await page.fill('#player-name', 'Kemi');
  await page.click('.pack-option:nth-child(2) .pack-card');
  await page.click('#setup-form button[type="submit"]');
  await page.click('#btn-pre');
  await shot(page, 'phone-02-level');
  await page.click('#btn-run');
  await page.locator('#feedback .fb-win').waitFor({ timeout: 10000 });
  await shot(page, 'phone-03-win');
  // Jump to the build level and the guided level to see them at phone size.
  await page.evaluate(() => LifePyGame.startLevel('c1l3'));
  await shot(page, 'phone-04-build');
  await page.evaluate(() => LifePyGame.startLevel('c1l5'));
  await page.click('#code-input');
  await page.keyboard.type('print(', { delay: 5 });
  await shot(page, 'phone-05-guided');
  await page.evaluate(() => LifePyGame.startLevel('c2l5'));
  await page.click('#btn-run');
  await page.waitForTimeout(300);
  await shot(page, 'phone-06-hideseek');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 0) problems.push(`phone: page scrolls sideways by ${overflow}px`);
  await page.context().close();
}

async function slowAnimationCheck() {
  // With normal motion, check that hide-and-seek animates the count and that a
  // wrong answer, then a mistake, then a fix all behave.
  const page = await newPage({ viewport: { width: 1280, height: 860 } });
  await page.goto(pageUrl);
  await page.evaluate(() => {
    localStorage.setItem('lifepy.v1', JSON.stringify({ profile: { name: 'Sam', pack: 'ukus' }, done: {}, settings: { sound: false, voice: false } }));
  });
  await page.reload();
  await page.evaluate(() => LifePyGame.startLevel('c2l5'));
  await page.click('#btn-run');
  await page.waitForTimeout(1300);
  await shot(page, 'motion-01-counting');
  await page.locator('#feedback .fb-win').waitFor({ timeout: 15000 });
  await page.click('#btn-next');
  await page.fill('#slot-0', '20');
  await page.click('#btn-run');
  await page.locator('#feedback .fb-info').waitFor({ timeout: 15000 });
  const msg = await page.locator('#feedback').innerText();
  if (!/stopped at 19/.test(msg)) problems.push(`off-by-one message missing: ${msg}`);
  await shot(page, 'motion-02-off-by-one');
  await page.evaluate(() => LifePyGame.startLevel('c1l4'));
  await page.click('#btn-run');
  await page.locator('#feedback .fb-oops').waitFor({ timeout: 5000 });
  await page.waitForTimeout(400);
  await shot(page, 'motion-03-mouth-open');
  await page.click('#btn-hint');
  await page.click('#btn-hint');
  await page.click('#btn-showme');
  await shot(page, 'motion-04-hints');
  await page.context().close();
}

const desktop = await fullPlaythrough({ width: 1280, height: 860 }, 'desktop', 'light');
const phone = await fullPlaythrough({ width: 390, height: 844 }, 'phonefull', 'dark');
await phoneSpotChecks();
await slowAnimationCheck();
await browser.close();

console.log('Reactions seen while fixing bugs:');
for (const r of desktop.reactions) console.log('  ' + r);
console.log(`Points after a full playthrough: ${desktop.points} (desktop), ${phone.points} (phone)`);
console.log(`Screenshots: ${shots}`);
if (problems.length) {
  console.error('PROBLEMS:\n' + problems.map((p) => '  ' + p).join('\n'));
  process.exit(1);
}
console.log('Playthrough passed with no errors.');
