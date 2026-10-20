// Plays every round of every lesson, in every hometown pack, with the intended
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
    case 'explain':
      return (round.setup ? x.t(round.setup) + '\n' : '') + x.t(round.code);
    case 'watch':
    case 'predict':
      return x.t(round.code);
    case 'change': return x.t(fillSlots(round.code, round.fill));
    case 'build': {
      const line = C.joinTiles(round.solution.map(x.t));
      return round.code ? x.t(round.code).replace('{{BUILD}}', line) : line;
    }
    default: return x.t(round.answer || round.ghost);
  }
}

function check(round, r, x, code) {
  if (r.error) return { ok: false };
  return round.check ? round.check(r, { ...x, code }) : { ok: true };
}

const NAME = 'Ada';
const levelIds = C.CHAPTERS.filter((c) => !c.locked).flatMap((c) => c.levels);

for (const packId of Object.keys(C.PACKS)) {
  for (const levelId of levelIds) {
    const level = C.LEVELS[levelId];
    level.rounds.forEach((round, i) => {
      const name = `${packId} ${levelId} round ${i + 1} (${round.mode})`;

      if (round.mode === 'choice') {
        test(`${name}: only the right option works`, () => {
          const x = C.makeContext(NAME, packId);
          assert.ok(round.goal, 'choice rounds need a goal output');
          round.options.forEach((opt, k) => {
            const code = (round.context ? x.t(round.context) + '\n' : '') + x.t(opt.code);
            const r = agreesWithCPython(code);
            const works = !r.error && r.lines.join('\n') === round.goal.map(x.t).join('\n');
            assert.equal(works, k === round.answer, `option ${k} ${JSON.stringify(opt.code)} works=${works}`);
            if (k !== round.answer) assert.ok(round.why && round.why[k], `option ${k} needs a "why"`);
          });
        });
        return;
      }

      test(`${name}: the answer works`, () => {
        const x = C.makeContext(NAME, packId);
        const code = solutionCode(round, x);
        const r = agreesWithCPython(code);
        if (round.mode === 'predict') {
          const opts = round.options.map((o) => C.optionLines(o).map(x.t));
          assert.deepEqual(r.lines, opts[round.answer], 'the right prediction must match what Pip shows');
          opts.forEach((o, k) => {
            if (k !== round.answer) {
              assert.notDeepEqual(o, r.lines, `wrong option ${k} matches the output`);
              assert.ok(round.why && round.why[k], `option ${k} needs a "why"`);
            }
          });
          return;
        }
        if (round.mode === 'explain') {
          assert.equal(r.error, null);
          assert.equal(round.pieces.map((p) => p[0]).join(''), x.t(round.code).replace(/\s+/g, ''), 'pieces must spell the code');
          return;
        }
        const res = check(round, r, x, code);
        assert.ok(res.ok, `answer failed: ${JSON.stringify(code)} -> ${JSON.stringify(r.lines)} ${res.msg || ''}`);
        if (round.mode === 'build') {
          const pool = round.tiles.map((t) => (Array.isArray(t) ? t[0] : t));
          for (const piece of round.solution) {
            const k = pool.indexOf(piece);
            assert.ok(k >= 0, `tile ${piece} missing`);
            pool.splice(k, 1);
          }
        }
        if (round.mode === 'guided') {
          assert.ok(x.t(round.ghost).startsWith(x.t(round.code || '')), 'ghost must start with the prefilled code');
        }
        if (['change', 'build', 'fix', 'guided', 'free'].includes(round.mode)) {
          assert.ok(round.hints && round.hints.length, 'typing rounds need hints');
        }
      });

      if (round.mode === 'fix') {
        test(`${name}: the broken code really is broken`, () => {
          const x = C.makeContext(NAME, packId);
          const code = x.t(round.code);
          const r = agreesWithCPython(code);
          assert.ok(!check(round, r, x, code).ok, 'broken code passed the check');
        });
      }

      if (round.mode === 'change') {
        test(`${name}: the untouched code does not pass`, () => {
          const x = C.makeContext(NAME, packId);
          const code = x.t(fillSlots(round.code));
          const r = agreesWithCPython(code);
          assert.ok(!check(round, r, x, code).ok, 'unchanged code passed');
        });
      }
    });
  }
}

test('every round with a story has lines to show, and every lesson starts gently', () => {
  for (const id of levelIds) {
    for (const round of C.LEVELS[id].rounds) {
      if (round.say) assert.ok(round.say.length >= 1 && round.say.length <= 2, `${id}: keep story screens to 1-2 lines`);
      if (round.task) assert.ok(round.task.length <= 110, `${id}: task text is too long: ${round.task}`);
    }
  }
});

test('the off-by-one hint fires when counting to 19', () => {
  const round = C.LEVELS.c2l5.rounds[2];
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

test('the two-friend check says who is still waiting', () => {
  const round = C.LEVELS.c1l6.rounds[1];
  const x = C.makeContext(NAME, 'westafrica');
  const code = 'print("Welcome Tolu")';
  const res = round.check(PyMini.run(code), { ...x, code });
  assert.equal(res.ok, false);
  assert.match(res.msg, /Emeka is still waiting/);
});

test('accents do not matter when checking names', () => {
  const x = C.makeContext(NAME, 'latam');
  assert.ok(x.has('Hello Mama', x.P.mum));
  assert.ok(x.has('Welcome, Tio Carlos!', x.P.uncleKey));
  assert.ok(!x.has('Welcome Samantha', 'sam'));
});

test('tiles join into readable code', () => {
  assert.equal(C.joinTiles(['print', '(', '"', 'Thank you', '"', ')']), 'print("Thank you")');
  assert.equal(C.joinTiles(['names', '.append', '(', '"', 'Kofi', '"', ')']), 'names.append("Kofi")');
  assert.equal(C.joinTiles(['sweets', '=', 'sweets', '+', '3']), 'sweets = sweets + 3');
});
