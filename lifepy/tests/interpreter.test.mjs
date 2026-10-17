// Compares PyMini with real CPython on beginner programs and beginner mistakes.
// Run with: node --test lifepy/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PyMini = require('../src/python.js');

function cpython(code) {
  const r = spawnSync('python3', ['-c', code], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  if (r.error) throw r.error;
  const errLines = r.stderr.trim().split('\n');
  return { stdout: r.stdout, error: r.status !== 0 ? errLines[errLines.length - 1] : null };
}

function mini(code) {
  const r = PyMini.run(code);
  return { stdout: r.output, error: r.error ? r.error.text : null, kind: r.error && r.error.kind };
}

// Programs and mistakes players are likely to write.
export const CORPUS = [
  // first words
  'print("Hello")',
  'print("Happy birthday!")',
  'print("Ada")',
  "print('Hello')",
  'print("Hello", "world")',
  'print()',
  'print("Hello",)',
  'print("Hello" "world")',
  'print("Welcome Grandma")\nprint("Welcome Uncle Tunde")\nprint("Welcome Chioma")',
  // mistakes with print
  'print("Hello)',
  'print("Hello"',
  'print("Hello"\nprint("x")',
  'Print("Hello")',
  'PRINT("Hello")',
  'prnit("Hello")',
  'prin("Hello")',
  'pritn("Hello")',
  'print(Hello)',
  'print "Hello"',
  'print Hello',
  'print("Hello" name)',
  'print(Hello world)',
  'print(Hello "world")',
  'print(""Hello"")',
  "print('Hello\")",
  'print("Hello"))',
  'print("a"]',
  'print[("Hello")]',
  'print(“Hello”)',
  'print("Hi" + )',
  'print("x") = 5',
  'print(sweets = 5)',
  'print("x", foo=1)',
  'print',
  '  print("Hello")',
  'print("Hello")\n  print("Hi")',
  'print("$")\nx = $5',
  // jars
  'sweets = 5\nprint(sweets)',
  'sweets = 5\nprint("sweets")',
  'sweets = 5\nprint(sweet)',
  'Sweets = 5\nprint(sweets)',
  'sweets = 5\nsweets = sweets + 3\nprint(sweets)',
  'sweets = 8\nsweets = sweets - 2\nprint(sweets)',
  'sweets = 5\nsweets + 3 = sweets\nprint(sweets)',
  '5 = sweets',
  'sweets = ',
  'sweets = 05',
  'sweets = 5sweets',
  'sweets == 5',
  'sweets = 1000000\nprint(sweets)',
  'True = 5',
  'x + 1 += 2',
  '5 += 1',
  'x = 1\nx += 2\nx -= 1\nx *= 10\nprint(x)\nx /= 4\nprint(x)\nx //= 2\nprint(x)',
  'x += 1',
  // sharing
  'sweets = 17\nfriends = 5\nprint(sweets // friends)\nprint(sweets % friends)',
  'sweets = 17\nfriends = 9\nprint(sweets // friends)\nprint(sweets % friends)',
  'sweets = 17\nfriends = 0\nprint(sweets // friends)',
  'print(1/0)',
  'print(1%0)',
  'print(1.0//0)',
  'print(1.0%0)',
  'print(0**-1)',
  'print(-7//2, -7%2, 7//-2, 7%-2, -7.5//2, -7.5%2, 1//0.1, 1%0.1)',
  'print(17 / 5, 10 / 2, 7 / 2, 2 ** 10, 2 ** -1, 10 ** 20, 2 ** 100)',
  'print(1e16, 1e-5, 2.0, 0.1+0.2, 1e15, 123456789012345678.0, -0.0, 3 * 1.1, 1/3, 10**20 / 3)',
  'print(round(2.5), round(3.5), round(-2.5), round(2.675, 2), round(0.125, 2), round(2.5, 0), round(1.005, 2), round(15, -1), round(25, -1), round(1234.5678, -2))',
  // hide and seek
  'for number in range(1, 11):\n    print(number)\nprint("Ready or not, here I come!")',
  'for number in range(1, 21):\n    print(number)\nprint("Ready or not, here I come!")',
  'for number in range(1, 20):\n    print(number)',
  'for number in range(1, 6)\n    print(number)',
  'for number in range(1, 6):\nprint(number)',
  'for number in range(1, 6):',
  'for number in range(1, 6):\n    print(number)\n  print("x")',
  'for number in range(1, 6): print(number)',
  'for number range(1, 6):\n    print(number)',
  'for i in range(3):\n    print(i)\nelse:\n    print("x")',
  'for jump in range(5):\n    print("Jump!")',
  'for clap in range(3):\n    print("Clap!")',
  'for i in range(10, 0, -2):\n    print(i)',
  'for i in range(0):\n    print(i)\nprint("done")',
  'for letter in "Pip":\n    print(letter)',
  'for friend in ["Tolu", "Emeka", "Amina"]:\n    print("Hi", friend)',
  'for i in range(1.5):\n    print(i)',
  'print(range(1, 2, 0))',
  'print(range())',
  'print(range(1,2,3,4))',
  'print(range(3), range(1, 5, 2), list(range(4)))',
  // conditions and loops
  'x = 3\nif x > 2:\n    print("big")\nelif x > 1:\n    print("mid")\nelse:\n    print("small")',
  'age = 6\nif age > 4:\n    print("You can play outside")\nelse:\n    print("Stay in")',
  'if x = 5:\n    print(1)',
  'if 5 > 3\n    print(1)',
  'if True:\n    print(1)\nelse\n    print(2)',
  'else:\n    print(1)',
  'while True print(1)',
  'x = 1\nwhile x < 100:\n    x = x * 2\nprint(x)',
  'i = 0\nwhile True:\n    i += 1\n    if i == 3:\n        continue\n    if i > 5:\n        break\n    print(i)',
  'break',
  'if True:\n    print(1)\n  print(2)',
  'print(5 == 5.0, "5" == 5, 1 < 2 < 3, not 0, None is None, 3 if 1 else 4)',
  'print(True and "x", 0 or "y", [] or [1], 1 and 0)',
  'print("a" < "b", [1, 2] < [1, 3], "Pip" in "Pipe", 3 in range(5), 7 not in [1, 2])',
  // strings, numbers, conversions
  'name = "Ada"\nprint("Happy birthday " + name)',
  'name = "Ada"\nprint(f"Happy birthday {name}!")',
  'age = 6\nprint("I am " + age)',
  'age = 6\nprint("I am " + str(age))',
  'age = 6\nprint("I am", age, "years old")',
  'print(5 + "a")',
  'print("5" * "3")',
  'print("ha" * 3, 3 * "ho", [0] * 3)',
  'print("a" * 2.5)',
  'print(len(5))',
  'print(len("a", "b"))',
  'print(len("Pip"), len("héllo"), len([1, 2, 3]), len(range(10)))',
  'print(int("abc"))',
  'print(float("abc"))',
  'print(str(5) + "a", int("  42 "), int("1_000"), float(" 2.5 "), int(True), int(3.9), int(-3.9), float(3))',
  'print(max(3, 7, 2), min([4, 1]), sum(range(5)), abs(-3.5), abs(-4), sum([1.5, 2]))',
  'print(max([]))',
  'print("a\\tb\\\\n", repr("it\'s"), repr(\'say "hi"\'), ["it\'s"], repr("a\\nb"))',
  'print(type(5), type("a"), type(2.0), type(True), type(None), type(range(3)), type(print), type(int))',
  'print("a" < 5)',
  'print(-"a")',
  'print("a" ** 2)',
  'print(5 in "abc")',
  'print("abc"[5])',
  'print([1][2])',
  'print("abc"["a"])',
  'print([1]["a"])',
  'print(5[0])',
  's = "abc"\ns[0] = "x"',
  'print(5())',
  'print("abc".upper(), "ABC".lower(), "hello world".title(), "  hi  ".strip(), "a-b-c".replace("-", "+"), "banana".count("a"))',
  'print("pip".capitalize(), "a b  c".split(), "a,b".split(","), "-".join(["a", "b"]), "Pip".startswith("P"), "42".isdigit())',
  '"abc".uper()',
  'x = [1, 2]\nx.apend(3)',
  'x = [3, 1, 2]\nx.append(4)\nx.sort()\nprint(x, x.pop(), x, x.index(2), x.count(1))\nx.reverse()\nprint(x)',
  'x = [1, 2, 3]\nx[0] = 9\nx[-1] = 7\nprint(x, x[1], x[-2])',
  'x = [1]\nx[5] = 2',
  'print(f"{3.14159:.2f} {1234567:,} {0.25:.0%} {5:>3}|{"ab":<4}|{7:03d}|{2.5:6.1f}|{-3:4}|{1234.5:,.2f}")',
  'print(f"Hi {name")',
  'print(f"Hi)',
  'print(f"{1+2} and {"x"!r} and {{braces}}")',
  'print("""a\nb""")',
  '"""abc',
  'print(math.pi)',
  'print(random.randint(1, 6))',
  'print(time)',
  'print(sweets // friends)',
  'x',
  'print(été)',
  'café = 3\nprint(café + 1)',
  'print(\U0001F600)',
  'print("\U0001F600 party")',
  'print(1, 2, sep="-", end="!\\n")\nprint("next")',
  'print("a", end="")\nprint("b")',
  'x = 5 6',
  'print(5 6)',
  'print("a" "b" 5)',
  'print(1,\n2',
  'print("Hi"\n',
  'x = (1 + 2) * 3\nprint(x, -x, +x, - -x)',
  'print(10 ** 20 * 10 ** 20, 7 // 2 * 2 + 7 % 2)',
  'print(True + True, True * 3, 5 - True, 1.5 + True)',
  'print(0.1 * 3, 100 / 3, 2 / 3, 1e300 * 1e10, -1e300 * 1e10)',
  'print(3 // 0.5, 7.5 % 2, -0.0 // 1, 5 % -3.0)',
  'a = b = 3\nprint(a, b)',
  'x = 1; y = 2; print(x + y)',
  'pass',
  'print(None, True, False)',
  'print(sorted([3, 1, 2]), sorted("pip"), list("ab"))',
  'print([1, [2, 3]], [], [None, True, "x"])',
];

for (const code of CORPUS) {
  test(`matches CPython: ${JSON.stringify(code)}`, () => {
    const expected = cpython(code);
    const actual = mini(code);
    assert.notEqual(actual.kind, 'internal', `internal error: ${actual.error}`);
    assert.notEqual(actual.kind, 'unsupported', `unexpectedly unsupported: ${actual.error}`);
    assert.equal(actual.stdout, expected.stdout, 'stdout differs');
    assert.equal(actual.error, expected.error, 'error differs');
  });
}

const UNSUPPORTED = [
  'def greet():\n    print("hi")',
  'import math',
  'x = {"a": 1}',
  'x = (1, 2)',
  'name = input("Name? ")',
  'print("abc"[1:2])',
  'print([x for x in range(3)])',
  'f = lambda x: x',
];

for (const code of UNSUPPORTED) {
  test(`reports unsupported: ${JSON.stringify(code)}`, () => {
    const r = PyMini.run(code);
    assert.equal(r.error && r.error.kind, 'unsupported', JSON.stringify(r.error));
  });
}

test('runaway loops stop instead of freezing', () => {
  const r = PyMini.run('while True:\n    pass');
  assert.equal(r.error.kind, 'toolong');
  const r2 = PyMini.run('x = 2\nwhile True:\n    x = x * x');
  assert.equal(r2.error.kind, 'toolong');
});

test('exports variables for level checks', () => {
  const r = PyMini.run('sweets = 17\nfriends = 9\nname = "Ada"\nratio = 2.5\nbag = [1, "x"]');
  assert.deepEqual(r.vars, { sweets: 17, friends: 9, name: 'Ada', ratio: 2.5, bag: [1, 'x'] });
});

test('error lines point at the right place', () => {
  assert.equal(PyMini.run('print("a")\nprint(b)').error.line, 2);
  assert.equal(PyMini.run('print("a")\nprint("b)').error.line, 2);
  assert.equal(PyMini.run('for i in range(3)\n    print(i)').error.line, 1);
  assert.equal(PyMini.run('for i in range(3):\nprint(i)').error.line, 2);
  assert.equal(PyMini.run('x = 1\nprint("a"').error.line, 2);
});

test('translates lines into plain words', () => {
  const lines = PyMini.explain('print("Hello")\nsweets = 5\nsweets = sweets + 3\nprint(sweets)\nprint(sweets // friends)\nfor number in range(1, 11):\n    print(number)\nfor jump in range(5):\n    print("Jump!")');
  assert.deepEqual(lines.map((l) => l && l.text), [
    'Show: Hello',
    'Put 5 in the jar labelled sweets',
    'Add 3 to the jar sweets',
    "Show what's in the jar sweets",
    'Show how many each when sweets is shared between friends',
    'Count number from 1 to 10, and each time:',
    'Show the current number',
    'Repeat 5 times (jump counts 0 to 4):',
    'Show: Jump!',
  ]);
  assert.equal(lines[6].depth, 1);
});

test('translation still works line by line when the program has a mistake', () => {
  const lines = PyMini.explain('print("Hello")\nprint("Oops)');
  assert.equal(lines[0].text, 'Show: Hello');
  assert.equal(lines[1].text, null);
});
