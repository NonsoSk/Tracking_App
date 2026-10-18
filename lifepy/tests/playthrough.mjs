// Plays the whole prototype in a real browser the way a beginner would:
// onboarding one question at a time, then every lesson screen by screen,
// tapping tiles, typing line by line, running broken code before fixing it,
// and getting some multiple-choice answers wrong first.
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
const C = require(resolve(here, '../src/content.js'));

const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }));
const problems = [];

async function newPage(opts) {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/fonts\.g|ERR_|net::/.test(msg.text())) problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  return page;
}

const shot = (page, name) => page.screenshot({ path: join(shots, `${name}.png`) });
const main = (page) => page.click('#btn-main');
const waitBar = (page, kind) => page.locator(`#lesson-bar.${kind}`).waitFor({ timeout: 30000 });

async function typeLikeABeginner(page, text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    // After Enter the editor indents by itself, so skip the spaces a person wouldn't type.
    await page.keyboard.type(i === 0 ? lines[i] : lines[i].replace(/^ +/, ''), { delay: 4 });
    if (i < lines.length - 1) await page.keyboard.press('Enter');
  }
}

async function onboard(page, name, packIndex, label) {
  await page.waitForSelector('#screen-welcome:not([hidden])');
  await shot(page, `${label}-01-welcome`);
  await page.click('#welcome-start');
  await page.fill('#player-name', name);
  await shot(page, `${label}-02-name`);
  await page.click('#name-next');
  await page.click(`#place-list .choice:nth-child(${packIndex + 1})`);
  await shot(page, `${label}-03-place`);
  await page.click('#place-next');
  await shot(page, `${label}-04-story`);
  await page.click('#story-next');
  await page.waitForSelector('#screen-lesson:not([hidden])');
}

async function playStep(page, x, tag, log, opts) {
  const info = await page.evaluate(() => {
    const L = LifePyGame.lesson;
    return { kind: L.kind, step: L.step, round: L.steps[L.step].round };
  });
  const R = C.LEVELS[tag.level].rounds[info.round];
  const name = `${tag.label}-${tag.level}-s${info.step + 1}-${info.kind === 'task' ? R.mode : info.kind}`;
  if (info.kind !== 'task') {
    if (opts.shots) await shot(page, name);
    await main(page);
    return;
  }
  switch (R.mode) {
    case 'watch':
      if (opts.shots) await shot(page, `${name}-before`);
      await main(page);
      break;
    case 'predict':
    case 'choice': {
      if (R.mode === 'choice' && !opts.wrongDone.has(R.mode)) {
        // Get one wrong first, the way a beginner might.
        const wrong = R.options.findIndex((_, i) => i !== R.answer);
        await page.click(`.options .choice[data-value="${wrong}"]`);
        await main(page);
        await waitBar(page, 'bad');
        log.push(`${tag.level} wrong choice: ${await page.locator('#feedback h3').innerText()}`);
        if (opts.shots) await shot(page, `${name}-wrong`);
        await main(page);
        opts.wrongDone.add(R.mode);
      }
      await page.click(`.options .choice[data-value="${R.answer}"]`);
      if (opts.shots) await shot(page, `${name}-picked`);
      await main(page);
      break;
    }
    case 'change': {
      const fill = (R.fill || []).map(x.t);
      for (let i = 0; i < fill.length; i++) await page.fill(`#slot-${i}`, fill[i]);
      await main(page);
      break;
    }
    case 'build': {
      for (const piece of R.solution.map(x.t)) {
        const esc = piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        await page.locator('#tray .tile', { has: page.locator('.tile-code', { hasText: new RegExp(`^${esc}$`) }) }).first().click();
      }
      if (opts.shots) await shot(page, `${name}-built`);
      await main(page);
      break;
    }
    case 'fix': {
      await main(page);
      await waitBar(page, 'bad');
      log.push(`${tag.level} bug: ${await page.locator('#feedback h3').innerText()}`);
      if (opts.shots) await shot(page, `${name}-mistake`);
      await main(page); // Try again
      await page.fill('#code-input', x.t(R.answer));
      await main(page);
      break;
    }
    default: {
      const prefill = x.t(R.code || '');
      const target = x.t(R.answer || R.ghost);
      await page.click('#code-input');
      await page.keyboard.press('Control+End');
      const rest = target.slice(prefill.length);
      const half = Math.floor(rest.length / 2);
      await typeLikeABeginner(page, rest.slice(0, half));
      if (opts.shots) await shot(page, `${name}-typing`);
      await typeLikeABeginner(page, rest.slice(half));
      const typed = await page.inputValue('#code-input');
      if (typed !== target) problems.push(`${name}: typed ${JSON.stringify(typed)}, expected ${JSON.stringify(target)}`);
      await main(page);
    }
  }
  await waitBar(page, 'good');
  if (opts.shots) await shot(page, `${name}-good`);
  await main(page); // Continue
}

async function fullPlaythrough(viewport, label, colorScheme, packIndex) {
  const page = await newPage({ viewport, colorScheme, reducedMotion: 'reduce' });
  await page.goto(pageUrl);
  await onboard(page, 'Ada', packIndex, label);
  const x = C.makeContext('Ada', Object.keys(C.PACKS)[packIndex]);
  const log = [];
  const opts = { shots: label === 'desktop' || label === 'phone', wrongDone: new Set() };
  const order = C.CHAPTERS.filter((c) => !c.locked).flatMap((c) => c.levels);
  for (const id of order) {
    await page.waitForSelector('#screen-lesson:not([hidden])');
    const steps = await page.evaluate(() => LifePyGame.lesson.steps.length);
    for (let s = 0; s < steps; s++) await playStep(page, x, { label, level: id }, log, opts);
    await page.waitForSelector('#screen-done:not([hidden])');
    if (opts.shots && (id === 'c1l1' || id === 'c1l6' || id === 'c2l7')) await shot(page, `${label}-${id}-done`);
    await page.click('#done-buttons .btn.primary');
  }
  // End of the prototype: vote and leave a note, then home.
  await page.click('#vote-row .choice:first-child');
  await page.fill('#end-notes', 'The brackets were tricky at first.');
  if (opts.shots) await shot(page, `${label}-90-end`);
  await page.click('#done-buttons .btn.primary');
  await page.waitForSelector('#screen-home:not([hidden])');
  await shot(page, `${label}-91-home-finished`);
  const state = await page.evaluate(() => LifePyGame.state);
  if (Object.keys(state.done).length !== order.length) problems.push(`${label}: finished ${Object.keys(state.done).length} of ${order.length} lessons`);
  await page.click('#btn-notebook');
  await shot(page, `${label}-92-notebook`);
  await page.click('#screen-notebook [data-go="home"]');
  await page.click('#btn-settings');
  await shot(page, `${label}-93-settings`);
  await page.click('#btn-results');
  await shot(page, `${label}-94-results`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 0) problems.push(`${label}: page scrolls sideways by ${overflow}px`);
  await page.context().close();
  return { log, points: state.points };
}

async function spotChecks() {
  const page = await newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.goto(pageUrl);
  await page.evaluate(() => localStorage.setItem('lifepy.v1', JSON.stringify({ profile: { name: 'Sam', pack: 'ukus' }, done: { c1l1: true }, points: 15, settings: { sound: false, voice: false } })));
  await page.reload();
  await page.waitForSelector('#screen-home:not([hidden])');
  await shot(page, 'spot-01-home');

  // Hints: two hints, then the answer, then "put it in for me".
  await page.evaluate(() => LifePyGame.startLesson('c1l6'));
  await page.click('#btn-main'); // story
  await page.click('#btn-hint');
  await page.waitForSelector('#lesson-bar.hint');
  await page.click('#fb-more');
  await page.click('#btn-main'); // Got it
  await page.click('#btn-hint');
  await page.click('#fb-answer');
  await shot(page, 'spot-02-answer');
  await page.click('#fb-use');
  await page.click('#btn-main');
  await page.waitForSelector('#lesson-bar.good');

  // A wrong prediction shows the right answer and moves on.
  await page.evaluate(() => LifePyGame.startLesson('c2l5'));
  await page.click('#btn-main'); // story
  await page.click('#btn-main'); // run the count
  await page.waitForSelector('#lesson-bar.good');
  await page.click('#btn-main');
  await page.click('.options .choice[data-value="1"]');
  await page.click('#btn-main');
  await page.waitForSelector('#lesson-bar.bad');
  await shot(page, 'spot-03-wrong-predict');

  // The off-by-one message when counting to 20 with range(1, 20).
  await page.click('#btn-main');
  await page.click('#btn-main'); // story
  await page.fill('#slot-0', '20');
  await page.click('#btn-main');
  await page.waitForSelector('#lesson-bar.bad');
  const msg = await page.locator('#feedback').innerText();
  if (!/stopped at 19/.test(msg)) problems.push(`off-by-one message missing: ${msg}`);

  // Leaving a lesson asks first.
  await page.click('#lesson-close');
  await page.waitForSelector('#fb-leave');
  await shot(page, 'spot-04-leave');
  await page.click('#fb-leave');
  await page.waitForSelector('#screen-home:not([hidden])');
  await page.context().close();
}

const desktop = await fullPlaythrough({ width: 1280, height: 860 }, 'desktop', 'light', 0);
const phone = await fullPlaythrough({ width: 390, height: 844 }, 'phone', 'dark', 1);
await spotChecks();
await browser.close();

console.log('What beginners saw when they made mistakes:');
for (const r of desktop.log) console.log('  ' + r);
console.log(`Points after a full playthrough: ${desktop.points} (desktop), ${phone.points} (phone)`);
console.log(`Screenshots: ${shots}`);
if (problems.length) {
  console.error('PROBLEMS:\n' + problems.map((p) => '  ' + p).join('\n'));
  process.exit(1);
}
console.log('Playthrough passed with no errors.');
