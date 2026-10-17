// Plays every round of every level, in every hometown pack, with the intended
// answer (must pass its check) and with the deliberately broken code (must not),
// and confirms CPython agrees with PyMini on each program.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PyMini = require('../src/python.js');
const C = require('../src/content.js');

function cpython(code) {
  const r = spawnSync('python3', ['-c', code], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  const errLines = r.stderr.trim().split('\n');
  return { stdout: r.stdout, error: r.status !== 0 ? errLines[errLines.length - 1] : null };
}

function agreesWithCPython(code) {
  const mine = PyMini.run(code);
  const real = cpython(code);
  assert.equal(mine.output, real.stdout, `stdout differs for ${JSON.stringify(code)}`);
  assert.equal(mine.error ? mine.error.text : null, real.error, `error differs for ${JSON.stringify(code)}`);
  return mine;
}

function fillSlots(template, values) {
  let i = 0;
  return template.replace(/\[\[(.*?)\]\]/g, (m, def) => (values && values[i] !== undefined ? values[i++] : def));
}

function solutionCode(round, x) {
  switch (round.mode) {
    case 'watch': return x.t(round.code);
    case 'change': return x.t(fillSlots(round.code, round.fill));
    case 'build': {
      const line = C.joinTiles(round.solution.map(x.t));
      return round.code ? x.t(round.code).replace('{{BUILD}}', line) : line;
    }
    default: return x.t(round.answer || round.ghost);
  }
}

function check(round, r, x, code) {
  const ctx = { ...x, code };
  if (r.error) return { ok: false };
  return round.check ? round.check(r, ctx) : { ok: true };
}

const NAME = 'Ada';

for (const packId of Object.keys(C.PACKS)) {
  for (const chapter of C.CHAPTERS.filter((c) => !c.locked)) {
    for (const levelId of chapter.levels) {
      const level = C.LEVELS[levelId];
      level.rounds.forEach((round, i) => {
        test(`${packId} ${levelId} round ${i + 1} (${round.mode}): the answer works`, () => {
          const x = C.makeContext(NAME, packId);
          const code = solutionCode(round, x);
          const r = agreesWithCPython(code);
          const res = check(round, r, x, code);
          assert.ok(res.ok, `answer failed: ${JSON.stringify(code)} -> ${JSON.stringify(r.lines)} ${res.msg || ''}`);
          if (round.mode === 'build') {
            const extra = round.tiles.length - round.solution.length;
            assert.ok(extra >= 0, 'solution uses more tiles than exist');
            const pool = round.tiles.map((t) => (Array.isArray(t) ? t[0] : t));
            for (const piece of round.solution) {
              const k = pool.indexOf(piece);
              assert.ok(k >= 0, `tile ${piece} missing`);
              pool.splice(k, 1);
            }
          }
          if (round.mode === 'guided') {
            const prefill = x.t(round.code || '');
            assert.ok(x.t(round.ghost).startsWith(prefill), 'ghost must start with the prefilled code');
          }
        });

        if (round.mode === 'fix') {
          test(`${packId} ${levelId} round ${i + 1}: the broken code really is broken`, () => {
            const x = C.makeContext(NAME, packId);
            const code = x.t(round.code);
            const r = agreesWithCPython(code);
            const res = check(round, r, x, code);
            assert.ok(!res.ok, 'broken code passed the check');
          });
        }

        if (round.mode === 'change') {
          test(`${packId} ${levelId} round ${i + 1}: the untouched code does not pass`, () => {
            const x = C.makeContext(NAME, packId);
            const code = x.t(fillSlots(round.code));
            const r = agreesWithCPython(code);
            assert.ok(!check(round, r, x, code).ok, 'unchanged code passed');
          });
        }
      });
    }
  }
}

test('the off-by-one hint fires when counting to 19', () => {
  const round = C.LEVELS.c2l5.rounds[1];
  const x = C.makeContext(NAME, 'ukus');
  const code = fillSlots(round.code, ['20']);
  const res = round.check(PyMini.run(code), { ...x, code });
  assert.equal(res.ok, false);
  assert.match(res.msg, /stopped at 19/);
});

test('clapping without a loop is gently refused', () => {
  const round = C.LEVELS.c2l7.rounds[1];
  const x = C.makeContext(NAME, 'ukus');
  const code = 'print("Clap!")\nprint("Clap!")\nprint("Clap!")';
  const res = round.check(PyMini.run(code), { ...x, code });
  assert.equal(res.ok, false);
  assert.match(res.msg, /for loop/);
});

test('party check names who is still waiting', () => {
  const round = C.LEVELS.c1l6.rounds[0];
  const x = C.makeContext(NAME, 'westafrica');
  const code = 'print("Welcome Chioma")';
  const res = round.check(PyMini.run(code), { ...x, code });
  assert.equal(res.ok, false);
  assert.match(res.msg, /Still waiting at the door: Tolu and Emeka/);
});

test('accents do not matter when checking names', () => {
  const x = C.makeContext(NAME, 'latam');
  assert.ok(x.has('Hello Mama', x.P.mum));
  assert.ok(x.has('Welcome, Tio Carlos!', x.P.uncleKey));
  assert.ok(!x.has('Welcome Samantha', 'sam'));
});

test('tiles join into readable code', () => {
  assert.equal(C.joinTiles(['print', '(', '"', 'Thank you', '"', ')']), 'print("Thank you")');
  assert.equal(C.joinTiles(['sweets', '=', 'sweets', '+', '3']), 'sweets = sweets + 3');
});
