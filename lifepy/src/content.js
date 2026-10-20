/*
 * Life.py content: storylines, hometown packs, chapters, lessons and Pip's notebook.
 *
 * Text and code use {placeholders} filled from the player's name and hometown pack:
 * {name} {mum} {grandma} {uncle} {uncleSay} {cousin} {f1}-{f5} {teacher} {food} {game}.
 *
 * A lesson is a list of rounds. A round with `say` lines first gets a story screen,
 * then its own screen. Every new idea climbs the same ladder, one small step each:
 *   explain - a line of code with each piece labelled (`setup` is unseen code it relies on)
 *   watch   - read-only code, tap Run
 *   predict - read-only code, pick what Pip will show, then see it run
 *   choice  - pick the line that works
 *   change  - edit only the highlighted [[slot]] in the code
 *   build   - tap tiles into order ({{BUILD}} marks the line inside fixed code)
 *   fix     - broken code in the editor
 *   guided  - faint "ghost" code to type over
 *   free    - empty editor
 *
 * check(result, x) returns { ok, msg?, win? }. result comes from PyMini.run;
 * x gives t() for placeholders, has() for loose text matching, and the pack.
 */
(function (root) {
  'use strict';

  const PACKS = {
    westafrica: {
      id: 'westafrica',
      label: 'West Africa',
      places: 'Lagos, Accra, Dakar, Abuja',
      mum: 'Mummy',
      grandma: 'Grandma',
      uncle: 'Uncle Tunde',
      uncleSay: 'Uncle Tunde',
      uncleKey: 'tunde',
      teacher: 'Mrs Adeyemi',
      cousin: 'Chioma',
      friends: ['Tolu', 'Emeka', 'Amina', 'Kofi', 'Zainab'],
      food: 'jollof rice',
      game: 'suwe',
      looks: {
        mum: { age: 'adult', skin: '#7a4a2e', hair: 'gele', wrap: '#d9822b', shirt: '#2f7d6d', pattern: '#e8b04a', earrings: true, lashes: true, eyes: '#2a170e', lips: 1.25 },
        grandma: { age: 'elder', skin: '#6e4330', hair: 'greyCurly', hairColor: '#cfc8c0', shirt: '#8a3f5c', glasses: true, eyes: '#2a170e', lashes: true, faceW: 1.06, jaw: 0.66, lips: 1.15, nose: 1.1 },
        uncle: { age: 'adult', skin: '#5e3a26', hair: 'coilyShort', hairColor: '#1a1210', beard: true, shirt: '#3d5a99', collar: 'shirt', eyes: '#24140c', lips: 1.2, nose: 1.15 },
        cousin: { age: 'child', skin: '#8a5636', hair: 'puffs', hairColor: '#1c1310', shirt: '#e0a43a', lashes: true, eyes: '#2a170e', lips: 1.15 },
        f1: { age: 'child', skin: '#6a4029', hair: 'coilyShort', hairColor: '#1a1210', shirt: '#c65a46', eyes: '#24140c', lips: 1.15 },
        f2: { age: 'child', skin: '#7e4c30', hair: 'braids', hairColor: '#1c1310', shirt: '#5b84b8', lashes: true, eyes: '#2a170e', lips: 1.15 },
        f3: { age: 'child', skin: '#94603e', hair: 'coily', hairColor: '#1c1310', shirt: '#6aa36f', eyes: '#2a170e', faceW: 1.04 },
        f4: { age: 'child', skin: '#704530', hair: 'puffs', hairColor: '#1a1210', shirt: '#d9773a', lashes: true, eyes: '#24140c', lips: 1.15 },
        teacher: { age: 'adult', skin: '#6b4129', hair: 'bun', hairColor: '#1a1210', shirt: '#7a2e3a', glasses: true, earrings: true, lashes: true, eyes: '#24140c', lips: 1.2, faceW: 1.03 },
      },
    },
    southasia: {
      id: 'southasia',
      label: 'South Asia',
      places: 'Mumbai, Lahore, Dhaka, Colombo',
      mum: 'Amma',
      grandma: 'Dadi',
      uncle: 'Uncle Raj',
      uncleSay: 'Uncle Raj',
      uncleKey: 'raj',
      teacher: 'Mrs Sharma',
      cousin: 'Priya',
      friends: ['Arjun', 'Ayesha', 'Ravi', 'Meera', 'Kabir'],
      food: 'biryani',
      game: 'kho-kho',
      looks: {
        mum: { age: 'adult', skin: '#b07a55', hair: 'bun', hairColor: '#1d1512', shirt: '#b8394f', pattern: '#e9b44c', earrings: true, lashes: true, eyes: '#2e1a10', faceW: 0.96, jaw: 0.55 },
        grandma: { age: 'elder', skin: '#a06d4c', hair: 'bun', hairColor: '#d8d2ca', shirt: '#e3d6bf', glasses: true, eyes: '#2e1a10', lashes: true, jaw: 0.64 },
        uncle: { age: 'adult', skin: '#9c6a48', hair: 'short', hairColor: '#191311', mustache: true, shirt: '#e8e2d6', collar: 'shirt', eyes: '#2a170e', faceW: 1.04, jaw: 0.8 },
        cousin: { age: 'child', skin: '#b8835e', hair: 'long', hairColor: '#1d1512', shirt: '#7c5bb0', lashes: true, eyes: '#2e1a10' },
        f1: { age: 'child', skin: '#a8724f', hair: 'short', hairColor: '#191311', shirt: '#3f8a7a', eyes: '#2a170e' },
        f2: { age: 'child', skin: '#b17b56', hair: 'braids', hairColor: '#1d1512', shirt: '#e08b3a', lashes: true, eyes: '#2e1a10' },
        f3: { age: 'child', skin: '#9a6644', hair: 'curly', hairColor: '#1d1512', shirt: '#4b7fa8', eyes: '#2a170e' },
        f4: { age: 'child', skin: '#a26c4a', hair: 'puffs', hairColor: '#1d1512', shirt: '#3f8a7a', lashes: true, eyes: '#2e1a10' },
        teacher: { age: 'adult', skin: '#a87250', hair: 'long', hairColor: '#1d1512', shirt: '#2f6f8a', earrings: true, lashes: true, eyes: '#2e1a10', jaw: 0.56 },
      },
    },
    latam: {
      id: 'latam',
      label: 'Latin America',
      places: 'Mexico City, Bogotá, São Paulo, Lima',
      mum: 'Mamá',
      grandma: 'Abuela',
      uncle: 'Tío Carlos',
      uncleSay: 'Tio Carlos',
      uncleKey: 'carlos',
      teacher: 'Maestra López',
      cousin: 'Sofia',
      friends: ['Mateo', 'Camila', 'Diego', 'Lucia', 'Valentina'],
      food: 'tamales',
      game: 'rayuela',
      looks: {
        mum: { age: 'adult', skin: '#c48d68', hair: 'long', hairColor: '#2b1a12', shirt: '#c25b3f', earrings: true, lashes: true, eyes: '#4a2a17' },
        grandma: { age: 'elder', skin: '#b07c5a', hair: 'bun', hairColor: '#cfc8c0', shirt: '#4f6f8f', pattern: '#d8c79a', glasses: true, eyes: '#3a2112', lashes: true, faceW: 1.05 },
        uncle: { age: 'adult', skin: '#a8714c', hair: 'short', hairColor: '#20140e', mustache: true, shirt: '#e9e2d3', collar: 'shirt', eyes: '#3a2112', jaw: 0.78 },
        cousin: { age: 'child', skin: '#c99470', hair: 'curly', hairColor: '#2b1a12', shirt: '#e6b84a', lashes: true, eyes: '#4a2a17' },
        f1: { age: 'child', skin: '#b98260', hair: 'short', hairColor: '#20140e', shirt: '#3e7cb1', eyes: '#3a2112' },
        f2: { age: 'child', skin: '#c28a65', hair: 'long', hairColor: '#24160f', shirt: '#d0607a', lashes: true, eyes: '#4a2a17' },
        f3: { age: 'child', skin: '#8f5d3e', hair: 'coilyShort', hairColor: '#1a1210', shirt: '#e0a43a', eyes: '#2a170e' },
        f4: { age: 'child', skin: '#b47e5a', hair: 'braids', hairColor: '#24160f', shirt: '#4b7fa8', lashes: true, eyes: '#4a2a17' },
        teacher: { age: 'adult', skin: '#c08a66', hair: 'bun', hairColor: '#3a2416', shirt: '#7a5bb0', glasses: true, earrings: true, lashes: true, eyes: '#4a2a17' },
      },
    },
    ukus: {
      id: 'ukus',
      label: 'UK & US',
      places: 'London, Manchester, New York, Chicago',
      mum: 'Mum',
      grandma: 'Grandma',
      uncle: 'Uncle Sam',
      uncleSay: 'Uncle Sam',
      uncleKey: 'sam',
      teacher: 'Mrs Green',
      cousin: 'Lily',
      friends: ['Jack', 'Mia', 'Noah', 'Ava', 'Leo'],
      food: 'pizza',
      game: 'hopscotch',
      looks: {
        mum: { age: 'adult', skin: '#e8bfa0', hair: 'long', hairColor: '#8a5a32', shirt: '#4b7fa8', earrings: true, lashes: true, eyes: '#4a6a7a' },
        grandma: { age: 'elder', skin: '#e0b597', hair: 'greyCurly', hairColor: '#e2dcd4', shirt: '#9b6b8e', glasses: true, eyes: '#5b6e5a', lashes: true },
        uncle: { age: 'adult', skin: '#d9a888', hair: 'short', hairColor: '#4a3020', beard: true, shirt: '#5b7a4a', collar: 'shirt', eyes: '#3d5566' },
        cousin: { age: 'child', skin: '#efc6a6', hair: 'long', hairColor: '#c49a5a', shirt: '#e07a5f', lashes: true, eyes: '#4a6a7a' },
        f1: { age: 'child', skin: '#6e4530', hair: 'coilyShort', hairColor: '#1a1210', shirt: '#3e7cb1', eyes: '#24140c', lips: 1.15 },
        f2: { age: 'child', skin: '#e9bf9c', hair: 'curly', hairColor: '#b0532b', shirt: '#6aa36f', lashes: true, eyes: '#4d6b3d' },
        f3: { age: 'child', skin: '#c99a74', hair: 'short', hairColor: '#2b1a12', shirt: '#7c5bb0', eyes: '#3a2112' },
        f4: { age: 'child', skin: '#f0c8a6', hair: 'short', hairColor: '#8a5a32', shirt: '#c65a46', eyes: '#3d5566' },
        teacher: { age: 'adult', skin: '#e2b293', hair: 'long', hairColor: '#3a2a20', shirt: '#3d6f5a', glasses: true, lashes: true, eyes: '#5b6e5a', jaw: 0.58 },
      },
    },
  };

  const STORIES = [
    {
      id: 'growingup',
      title: 'Growing Up',
      tagline: 'From your 5th birthday to your wedding day.',
      ready: true,
      icon: 'cake',
    },
    {
      id: 'bigcity',
      title: 'The Big City',
      tagline: 'Arrive with almost nothing. Hustle your way up.',
      ready: false,
      icon: 'city',
    },
    {
      id: 'kitchen',
      title: 'Grandma\'s Kitchen',
      tagline: 'Save the family restaurant, one recipe at a time.',
      ready: false,
      icon: 'pot',
    },
    {
      id: 'casefiles',
      title: 'Case Files',
      tagline: 'Solve a town\'s mysteries with data.',
      ready: false,
      icon: 'search',
    },
  ];

  const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  const showed = (r) => (r.lines.length ? `Pip showed "${r.lines.join(' / ')}".` : 'Pip didn\'t show anything.');

  // Common check: the output must be exactly these lines.
  function exactly(lines, extra) {
    return (r, x) => {
      const want = lines.map((l) => x.t(l));
      if (r.lines.length === want.length && r.lines.every((l, i) => l === want[i])) return { ok: true };
      if (extra) {
        const res = extra(r, x);
        if (res) return res;
      }
      return { ok: false, msg: `${showed(r)} This time, make Pip show "${want.join(' / ')}".` };
    };
  }

  const countTo = (n) => Array.from({ length: n }, (_, i) => String(i + 1));

  const CHAPTERS = [
    {
      id: 'c1',
      n: 1,
      title: 'First Words',
      age: 'Age 5',
      blurb: 'Your birthday. A present with your name on it. A robot inside.',
      badge: 'First Words',
      file: 'birthday.py',
      reveal: {
        title: 'You just wrote real Python',
        text: 'Pip\'s language is called Python. Doctors, scientists, banks and the biggest tech companies use it every day.',
      },
      levels: ['c1l1', 'c1l2', 'c1l3', 'c1l4', 'c1l5', 'c1l6'],
    },
    {
      id: 'c2',
      n: 2,
      title: 'The Playground',
      age: 'Age 6',
      blurb: 'Jars of sweets, sharing fairly, and a very fast game of hide-and-seek.',
      badge: 'Playground Legend',
      file: 'playground.py',
      reveal: {
        title: 'You can make Pip remember and repeat',
        text: 'Jars, sharing signs and loops are real programming tools. Programmers use them to count stock, split bills and repeat jobs thousands of times.',
      },
      levels: ['c2l1', 'c2l2', 'c2l3', 'c2l4', 'c2l5', 'c2l6', 'c2l7'],
    },
    {
      id: 'c3',
      n: 3,
      title: 'Primary School',
      age: 'Age 8',
      blurb: 'The class register, lining up by height, times tables and your first report card.',
      badge: 'Top of the Class',
      file: 'school.py',
      reveal: {
        title: 'You can handle whole lists of data',
        text: 'Lists, sorting, totals and averages are how people handle data: class registers, patient records, sales. Loops inside loops build whole tables.',
      },
      levels: ['c3l1', 'c3l2', 'c3l3', 'c3l4', 'c3l5', 'c3l6', 'c3l7'],
    },
    { id: 'c4', n: 4, title: 'Secondary School', age: 'Age 13', locked: true, blurb: 'Timetables, class elections, and notes in secret code.' },
    { id: 'c5', n: 5, title: 'University', age: 'Age 18', locked: true, blurb: 'Leaving home, making money last the month, choosing your path.' },
    { id: 'c6', n: 6, title: 'First Job', age: 'Age 23', locked: true, blurb: 'First salary, first rent, automating the boring parts of work.' },
    { id: 'c7', n: 7, title: 'Love', age: 'Age 27', locked: true, blurb: 'Meeting the one, meeting the parents, planning the proposal.' },
    { id: 'c8', n: 8, title: 'The Wedding', age: 'Age 29', locked: true, blurb: 'Two families, one guest list. Pip carries the rings.' },
  ];

  const LEVELS = {
    // ---------------- Chapter 1: First Words ----------------
    c1l1: {
      title: 'A present for you',
      icon: 'gift',
      scene: 'home',
      cast: ['mum'],
      memory: 'Your 5th birthday. Pip woke up and said its first word.',
      rounds: [
        {
          mode: 'watch',
          say: [
            { who: 'mum', text: 'Happy 5th birthday, {name}! This present is for you.' },
            { who: 'narrator', text: 'Inside is a little robot called Pip. Pip only understands one language: Python.' },
          ],
          pip: 'sleep',
          code: 'print("Hello")',
          task: 'Pip is asleep. Tap Run to read Pip this line.',
          win: 'Pip woke up and said Hello!',
          learn: { term: 'print', text: '`print( )` tells Pip to show something on its screen.' },
        },
        {
          mode: 'predict',
          code: 'print("Happy birthday!")',
          task: 'Here\'s another line.',
          question: 'What will Pip show?',
          options: [['Happy birthday!'], ['print'], ['Hello']],
          answer: 0,
          why: {
            1: '`print` is the instruction. Pip shows the words inside the quote marks.',
            2: 'That was the last line. This line has different words inside the quotes.',
          },
          win: 'Right! Pip shows exactly the words inside the quotes.',
        },
      ],
    },

    c1l2: {
      title: 'Say my name',
      icon: 'chat',
      scene: 'home',
      cast: ['mum'],
      memory: 'Pip learned your name, and said hello to {mum}.',
      rounds: [
        {
          mode: 'change',
          say: [{ who: 'pip', text: 'Hello! Hello! Who are you?' }],
          code: 'print("[[Hello]]")',
          fill: ['{name}'],
          task: 'Change Hello to your name. Then tap Run.',
          check: (r, x) => {
            const said = r.lines.join(' ');
            if (!said.trim()) return { ok: false, msg: 'Pip didn\'t say anything. Put some words between the quotes.' };
            if (said === 'Hello') return { ok: false, msg: 'Pip still says Hello. Tap the word Hello and type your name instead.' };
            if (x.has(said, x.name)) return { ok: true, win: `"${x.name}!" Pip likes your name.` };
            return { ok: true, win: `Pip said "${said}". Next time, try your own name.` };
          },
          hints: ['Tap the word Hello, delete it, and type your name.', 'Keep the quote marks. Only change the word between them.'],
        },
        {
          mode: 'change',
          say: [{ who: 'mum', text: 'Can Pip say hello to me too?' }],
          code: 'print("[[Hello]]")',
          fill: ['Hello {mum}'],
          task: 'Make Pip say: Hello {mum}',
          check: (r, x) => (x.has(r.output, x.P.mum) ? { ok: true } : { ok: false, msg: `${showed(r)} Make sure the word {mum} is in there.` }),
          hints: ['Type Hello {mum} between the quotes.'],
          win: '{mum} laughs. "Hello, Pip!"',
        },
      ],
    },

    c1l3: {
      title: 'The pieces of a line',
      icon: 'blocks',
      scene: 'home',
      cast: ['mum'],
      memory: 'You put Pip\'s broken line back together.',
      rounds: [
        {
          mode: 'explain',
          title: 'Every line is made of pieces',
          code: 'print("Hello")',
          pieces: [['print', 'show'], ['(', 'start'], ['"', 'words begin'], ['Hello', 'the words'], ['"', 'words end'], [')', 'finish']],
          text: 'If one piece is missing, Pip gets confused. Brackets and quote marks always come in pairs.',
        },
        {
          mode: 'build',
          say: [{ who: 'narrator', text: 'Oops! Pip dropped the line and it broke into pieces.' }],
          tiles: ['print', '(', '"', '{mum}', '"', ')'],
          solution: ['print', '(', '"', '{mum}', '"', ')'],
          task: 'Tap the pieces in order to make Pip say {mum}. Then tap Run.',
          check: exactly(['{mum}']),
          hints: ['Start with `print`.', 'The order is: `print ( " {mum} " )`'],
          win: '{mum} smiles. "You fixed it!"',
        },
        {
          mode: 'build',
          tiles: ['print', '(', '"', 'Thank you', '"', ')', ')'],
          solution: ['print', '(', '"', 'Thank you', '"', ')'],
          task: 'Make Pip say Thank you. One piece is extra.',
          check: exactly(['Thank you']),
          hints: ['You need one `(` and one `)`.', 'The order is: `print ( " Thank you " )`'],
          win: '{mum} gives you and Pip a big hug.',
        },
      ],
    },

    c1l4: {
      title: 'Bug hunt',
      icon: 'bug',
      scene: 'home',
      cast: ['mum'],
      memory: 'Pip caught some bugs. You fixed every one.',
      rounds: [
        {
          mode: 'choice',
          say: [{ who: 'narrator', text: 'Pip ate too much cake and caught some bugs! Some lines don\'t work any more.' }],
          task: 'Pip only understands one of these lines.',
          question: 'Which one works?',
          options: [{ code: 'Print("Hello")' }, { code: 'print("Hello")' }, { code: 'prnit("Hello")' }],
          answer: 1,
          goal: ['Hello'],
          why: {
            0: 'Look at the capital P. Python cares about capital letters, so it must be `print` with a small p.',
            2: 'Look at the spelling: `prnit`. It must be `print`.',
          },
          win: 'Yes! Small letters and exact spelling: `print`.',
          learn: { term: 'Rule', text: 'Capital letters and spelling matter: `print`, not `Print` or `prnit`.' },
        },
        {
          mode: 'fix',
          code: 'print("Hello)',
          task: 'This line has a bug. Tap Run to see what happens, then fix it.',
          check: exactly(['Hello']),
          hints: ['Count the quote marks. There should be two.', 'Type a `"` right after Hello, before the `)`.'],
          answer: 'print("Hello")',
          learn: { term: 'Rule', text: 'Quote marks come in pairs: one before the words and one after.' },
        },
        {
          mode: 'fix',
          code: 'print("Hello"',
          task: 'Another bug. Run it, then fix it.',
          check: exactly(['Hello']),
          hints: ['Look at the very end of the line.', 'Type a `)` at the end.'],
          answer: 'print("Hello")',
          learn: { term: 'Rule', text: 'Brackets come in pairs: every `(` needs a `)`.' },
        },
        {
          mode: 'fix',
          code: 'print(Hello)',
          task: 'Last bug. Run it, then fix it.',
          check: exactly(['Hello']),
          hints: ['What\'s missing around the word Hello?', 'Put a `"` before Hello and another `"` after it.'],
          answer: 'print("Hello")',
          learn: { term: 'Rule', text: 'Words need quote marks. Without them, Pip thinks the word is a name.' },
          win: 'All better! Pip is bug-free.',
        },
      ],
    },

    c1l5: {
      title: 'Guests at the door',
      icon: 'door',
      scene: 'home',
      cast: ['grandma', 'uncle'],
      memory: '{grandma} and {uncle} came to your party.',
      rounds: [
        {
          mode: 'guided',
          cast: ['grandma'],
          say: [
            { who: 'narrator', text: 'Ding dong! {grandma} is at the door.' },
            { who: 'grandma', text: 'Where is the birthday child?' },
          ],
          ghost: 'print("Welcome {grandma}")',
          task: 'Type over the grey letters to welcome {grandma}.',
          check: (r, x) => (x.has(r.output, x.P.grandma) ? { ok: true } : { ok: false, msg: `${showed(r)} Make sure {grandma} is in the welcome.` }),
          hints: ['Copy the grey letters one by one. The highlighted key shows the next symbol.', 'You need: `print("Welcome {grandma}")`'],
          answer: 'print("Welcome {grandma}")',
          win: '{grandma} comes in and gives you a hug.',
        },
        {
          mode: 'guided',
          cast: ['uncle', 'grandma'],
          say: [
            { who: 'narrator', text: 'Ding dong! It\'s {uncle}.' },
            { who: 'uncle', text: 'Where\'s my favourite five-year-old?' },
          ],
          ghost: 'print("Welcome {uncleSay}")',
          task: 'Type over the grey letters to welcome {uncle}.',
          check: (r, x) => (x.has(r.output, x.P.uncleKey) ? { ok: true } : { ok: false, msg: `${showed(r)} Make sure {uncle} is in the welcome.` }),
          hints: ['You need: `print("Welcome {uncleSay}")`', 'On most keyboards `(` is Shift + 9 and `)` is Shift + 0. You can also tap the keys under the code.'],
          answer: 'print("Welcome {uncleSay}")',
          win: '{uncle} lifts you up in the air. "Five years old!"',
        },
      ],
    },

    c1l6: {
      title: 'Party time',
      icon: 'cake',
      scene: 'home',
      cast: ['cousin', 'f1'],
      memory: 'Everyone came to your party. {food} and cake for all!',
      rounds: [
        {
          mode: 'free',
          cast: ['cousin'],
          say: [
            { who: 'narrator', text: 'Ding dong! Your cousin {cousin} is here.' },
            { who: 'cousin', text: 'Happy birthday! Is there cake? I want cake!' },
          ],
          task: 'Make Pip welcome {cousin}. No grey letters this time.',
          check: (r, x) => (x.has(r.output, x.P.cousin) ? { ok: true } : { ok: false, msg: `${showed(r)} Make sure {cousin} is in the welcome.` }),
          hints: ['Start with `print` and an open bracket: `print(`', 'Like this: `print("Welcome {cousin}")`'],
          answer: 'print("Welcome {cousin}")',
          win: '{cousin} runs in, straight to the cake.',
        },
        {
          mode: 'free',
          cast: ['f1', 'f2'],
          say: [
            { who: 'narrator', text: '{f1} and {f2} arrive together.' },
            { who: 'f1', text: 'Happy birthday, {name}! Can Pip say hi to us too?' },
          ],
          task: 'Write two lines: one welcome for {f1} and one for {f2}.',
          check: (r, x) => {
            const names = [x.f(1), x.f(2)];
            const welcomed = names.filter((n) => x.has(r.output, n));
            if (welcomed.length === names.length) return { ok: true };
            if (!welcomed.length) return { ok: false, msg: 'Pip hasn\'t welcomed anyone yet. Start each line with print.' };
            const waiting = names.filter((n) => !welcomed.includes(n));
            return { ok: false, msg: `Pip welcomed ${welcomed[0]}. ${waiting[0]} is still waiting at the door. Press Enter for a new line.` };
          },
          hints: ['One line for each friend. Each line starts with `print`.', 'Press Enter after the first line to start the second.', 'Line 1: `print("Welcome {f1}")`  Line 2: `print("Welcome {f2}")`'],
          answer: 'print("Welcome {f1}")\nprint("Welcome {f2}")',
          win: 'Everyone is inside. Time for {food} and cake!',
        },
      ],
    },

    // ---------------- Chapter 2: The Playground ----------------
    c2l1: {
      title: 'Pip\'s jars',
      icon: 'jar',
      showJars: true,
      scene: 'kitchen',
      cast: ['grandma'],
      memory: '{grandma}\'s jar of sweets, just for you.',
      rounds: [
        {
          mode: 'explain',
          say: [
            { who: 'narrator', text: 'One year later. You\'re 6 now, and Pip goes everywhere with you.' },
            { who: 'grandma', text: 'Here, {name}. A jar of sweets, just for you.' },
          ],
          title: 'Pip keeps things in labelled jars',
          code: 'sweets = 5',
          pieces: [['sweets', 'the label'], ['=', 'put in'], ['5', 'what goes in']],
          text: 'This line puts 5 into a jar labelled sweets. The label goes on the left of `=`, the thing on the right.',
        },
        {
          mode: 'watch',
          code: 'sweets = 5\nprint(sweets)',
          task: 'Tap Run. Pip will look inside the jar.',
          win: 'Pip showed 5, what\'s inside the jar.',
        },
        {
          mode: 'predict',
          code: 'sweets = 3\nprint(sweets)',
          task: 'Read the two lines.',
          question: 'What will Pip show?',
          options: [['3'], ['sweets'], ['sweets = 3']],
          answer: 0,
          why: {
            1: 'There are no quote marks around sweets, so Pip looks inside the jar instead of saying the word.',
            2: '`print` shows what\'s inside the jar, not the whole line.',
          },
          win: 'Right! Pip looked inside the jar and found 3.',
        },
        {
          mode: 'change',
          say: [{ who: 'pip', text: 'How many sweets do you wish you had?' }],
          code: 'sweets = [[5]]\nprint(sweets)',
          fill: ['12'],
          task: 'Change 5 to any number, then tap Run.',
          check: (r) => {
            const n = r.vars.sweets;
            if (typeof n !== 'number') return { ok: false, msg: 'Pip needs a number for this jar. Type digits, like 12.' };
            if (n === 5) return { ok: false, msg: 'That\'s still 5. Change it to the number you wish for.' };
            if (n > 100) return { ok: true, win: `${r.lines[0]} sweets?! {mum} says you'll get a tummy ache.` };
            return { ok: true, win: `Pip put ${r.lines[0]} sweets in the jar.` };
          },
          hints: ['Tap the 5 and type a different number, like 12.'],
        },
      ],
    },

    c2l2: {
      title: 'Jar mix-ups',
      icon: 'jar',
      showJars: true,
      scene: 'kitchen',
      cast: ['grandma'],
      memory: 'The day you learned a word from a jar.',
      rounds: [
        {
          mode: 'choice',
          context: 'sweets = 5',
          task: 'The jar sweets has 5 inside.',
          question: 'Which line shows how many sweets are in the jar?',
          options: [{ code: 'print("sweets")' }, { code: 'print(sweets)' }],
          answer: 1,
          goal: ['5'],
          why: { 0: 'With quote marks, Pip shows the word "sweets". Without them, Pip looks inside the jar.' },
          win: 'Yes! No quote marks means Pip looks inside the jar.',
          learn: { term: 'Rule', text: '`"sweets"` with quote marks is just a word. `sweets` without them is the jar.' },
        },
        {
          mode: 'fix',
          code: 'sweets = 5\nprint(sweet)',
          task: 'Pip can\'t find the jar. Run it, then fix it.',
          check: exactly(['5']),
          hints: ['Compare the jar label on line 1 with line 2.', 'Change `sweet` to `sweets` on line 2.'],
          answer: 'sweets = 5\nprint(sweets)',
          learn: { term: 'Rule', text: 'Jar labels must be spelled exactly the same every time.' },
        },
      ],
    },

    c2l3: {
      title: 'More sweets',
      icon: 'plus',
      showJars: true,
      scene: 'kitchen',
      cast: ['uncle', 'grandma'],
      memory: '{uncle} and {grandma} filled up your jar.',
      rounds: [
        {
          mode: 'predict',
          cast: ['uncle'],
          say: [{ who: 'uncle', text: 'Here are 3 more sweets for your jar!' }],
          code: 'sweets = 5\nsweets = sweets + 3\nprint(sweets)',
          task: 'Line 2 adds 3 to the jar.',
          question: 'What will Pip show?',
          options: [['8'], ['5'], ['53']],
          answer: 0,
          why: {
            1: 'Line 2 changes the jar: it takes the 5, adds 3, and puts 8 back.',
            2: 'These are numbers, not words, so `+` adds them up: 5 + 3 is 8.',
          },
          win: 'Right! 5 + 3 is 8.',
          learn: { term: 'Adding', text: '`sweets = sweets + 3` takes what\'s in the jar, adds 3, and puts it back.' },
        },
        {
          mode: 'build',
          cast: ['grandma'],
          say: [{ who: 'grandma', text: 'And 2 more from me.' }],
          code: 'sweets = 8\n{{BUILD}}\nprint(sweets)',
          tiles: [['sweets', 'label'], ['=', 'put in'], ['sweets', 'label'], ['+', 'add'], ['2', 'number']],
          solution: ['sweets', '=', 'sweets', '+', '2'],
          task: 'Build the middle line so the jar gets 2 more. Then tap Run.',
          check: exactly(['10']),
          hints: ['The label goes first, then the `=` sign.', 'The line is: `sweets = sweets + 2`'],
          win: 'Pip counts 10 sweets.',
        },
        {
          mode: 'guided',
          cast: ['grandma'],
          say: [{ who: 'narrator', text: 'You ate 2 sweets. They were delicious.' }],
          code: 'sweets = 10\n',
          ghost: 'sweets = 10\nsweets = sweets - 2\nprint(sweets)',
          task: 'Type over the grey letters to take 2 out of the jar.',
          check: exactly(['8']),
          hints: ['Line 2 is: `sweets = sweets - 2`', 'Line 3 shows the jar: `print(sweets)`'],
          answer: 'sweets = 10\nsweets = sweets - 2\nprint(sweets)',
          win: '8 sweets left. Pip guards them carefully.',
        },
      ],
    },

    c2l4: {
      title: 'Share fairly',
      icon: 'people',
      showJars: true,
      scene: 'park',
      cast: ['f1', 'f2'],
      memory: 'You shared your sweets fairly at the playground.',
      rounds: [
        {
          mode: 'watch',
          say: [
            { who: 'narrator', text: 'At the playground, 5 friends want some of your 17 sweets.' },
            { who: 'pip', text: 'I know two sharing signs. `//` shares equally. `%` finds what\'s left over.' },
          ],
          code: 'sweets = 17\nfriends = 5\nprint(sweets // friends)\nprint(sweets % friends)',
          task: 'Tap Run to share 17 sweets between 5 friends.',
          win: 'Each friend gets 3, and 2 are left over.',
          learn: { term: 'Sharing signs', text: '`//` shares equally: `17 // 5` is 3 each. `%` is what\'s left over: `17 % 5` is 2.' },
        },
        {
          mode: 'predict',
          code: 'print(10 // 3)\nprint(10 % 3)',
          task: '10 sweets, 3 friends.',
          question: 'What will Pip show?',
          options: [['3', '1'], ['1', '3'], ['3.33']],
          answer: 0,
          why: {
            1: 'The first line shares out: 3 each. The second shows what\'s left over: 1.',
            2: '`//` shares out whole sweets only, so it\'s 3 each, with 1 left over.',
          },
          win: 'Right! 3 each, and 1 left over.',
        },
        {
          mode: 'change',
          say: [{ who: 'f1', text: 'Wait! 4 more of us want sweets too!' }],
          code: 'sweets = 17\nfriends = [[5]]\nprint(sweets // friends)\nprint(sweets % friends)',
          fill: ['9'],
          task: 'Now there are 9 friends. Change the number, then tap Run.',
          check: (r) => {
            const f = r.vars.friends;
            if (f === 9) return { ok: true };
            if (typeof f === 'number') return { ok: false, msg: `Pip shared between ${f} friends. There are 9 friends now.` };
            return { ok: false, msg: 'Friends should be a number. Type 9.' };
          },
          hints: ['Change the 5 to 9.'],
          win: 'Everyone gets 1 sweet, and 8 are left over. Lucky you!',
        },
      ],
    },

    c2l5: {
      title: 'Hide and seek',
      icon: 'tree',
      scene: 'park',
      cast: ['f2', 'f3'],
      memory: 'Hide and seek in the park. Pip counted to 20.',
      rounds: [
        {
          mode: 'watch',
          say: [
            { who: 'f2', text: 'Let\'s play hide and seek! {name}, you\'re it!' },
            { who: 'pip', text: 'I\'ll count for you. I can count really fast.' },
          ],
          code: 'for number in range(1, 11):\n    print(number)\nprint("Ready or not, here I come!")',
          task: 'Tap Run and watch Pip count.',
          win: 'Pip counted from 1 to 10, then shouted.',
          learn: { term: 'Loops', text: '`for number in range(1, 11):` repeats the pushed-in line, counting from 1 to 10.' },
        },
        {
          mode: 'predict',
          code: 'for number in range(1, 4):\n    print(number)',
          task: 'A shorter count.',
          question: 'What will Pip show?',
          options: [['1', '2', '3'], ['1', '2', '3', '4'], ['4']],
          answer: 0,
          why: {
            1: '`range` stops just before the last number, so it never reaches 4.',
            2: 'The pushed-in line runs once for every number: 1, then 2, then 3.',
          },
          win: 'Right! `range(1, 4)` counts 1, 2, 3. It stops just before 4.',
          learn: { term: 'Rule', text: '`range` stops just before the last number: `range(1, 4)` counts 1, 2, 3.' },
        },
        {
          mode: 'change',
          say: [{ who: 'f3', text: 'That was way too fast! Count to 20 this time.' }],
          code: 'for number in range(1, [[11]]):\n    print(number)\nprint("Ready or not, here I come!")',
          fill: ['21'],
          task: 'Change the code so Pip counts all the way to 20.',
          check: (r) => {
            const nums = r.lines.slice(0, -1);
            const want = countTo(20);
            if (nums.length === want.length && nums.every((v, i) => v === want[i])) return { ok: true };
            const last = nums[nums.length - 1];
            if (last === '19') return { ok: false, msg: 'Pip stopped at 19! `range` stops just before the last number. Try 21.' };
            if (!nums.length) return { ok: false, msg: 'Pip didn\'t count at all. The second number must be bigger than 1.' };
            return { ok: false, msg: `Pip counted to ${last}. Make it count to 20.` };
          },
          hints: ['`range(1, 11)` counts 1 to 10. It stops just before 11.', 'To stop at 20, the second number must be 21.'],
          win: 'Pip counted all the way to 20. Everyone had time to hide.',
        },
      ],
    },

    c2l6: {
      title: 'Loop bugs',
      icon: 'bug',
      scene: 'park',
      cast: ['f1'],
      memory: 'Pip learned to count for the little kids.',
      rounds: [
        {
          mode: 'fix',
          say: [{ who: 'narrator', text: 'Pip wants to count to 5 for the little kids, but the loop is broken.' }],
          code: 'for number in range(1, 6)\n    print(number)',
          task: 'Run it, then fix the loop.',
          check: exactly(countTo(5)),
          hints: ['Look at the end of line 1.', 'Type a `:` at the very end of line 1.'],
          answer: 'for number in range(1, 6):\n    print(number)',
          learn: { term: 'Rule', text: 'A loop line ends with a colon `:` which means "here\'s what to repeat".' },
        },
        {
          mode: 'fix',
          code: 'for number in range(1, 6):\nprint(number)',
          task: 'Pip doesn\'t know which line to repeat. Run it, then fix it.',
          check: exactly(countTo(5)),
          hints: ['Line 2 should be pushed in.', 'Tap at the start of line 2, then tap the "push in" key to add 4 spaces.'],
          answer: 'for number in range(1, 6):\n    print(number)',
          learn: { term: 'Rule', text: 'Lines inside a loop are pushed in with 4 spaces. That\'s how Pip knows what to repeat.' },
        },
      ],
    },

    c2l7: {
      title: 'Skip and clap',
      icon: 'loop',
      scene: 'park',
      cast: ['f2', 'f1'],
      memory: 'Five jumps, three claps and a bow.',
      rounds: [
        {
          mode: 'guided',
          say: [{ who: 'f2', text: 'I brought a skipping rope! Can Pip jump 5 times?' }],
          ghost: 'for jump in range(5):\n    print("Jump!")',
          task: 'Type over the grey letters. After the colon, press Enter: the next line pushes itself in.',
          check: (r) => {
            const jumps = r.lines.filter((l) => /jump/i.test(l)).length;
            if (jumps === 5 && r.lines.length === 5) return { ok: true };
            return { ok: false, msg: `Pip jumped ${jumps} time${jumps === 1 ? '' : 's'}. Make it 5.` };
          },
          hints: ['Line 1: `for jump in range(5):`', 'Line 2 starts with 4 spaces: `print("Jump!")`'],
          answer: 'for jump in range(5):\n    print("Jump!")',
          win: 'Five perfect jumps!',
        },
        {
          mode: 'free',
          say: [{ who: 'narrator', text: 'Everyone cheers.' }],
          task: 'Write a loop that makes Pip show Clap! 3 times.',
          check: (r, x) => {
            const claps = r.lines.filter((l) => /clap/i.test(l)).length;
            const usedLoop = /\bfor\b/.test(x.code);
            if (claps === 3 && usedLoop) return { ok: true };
            if (claps === 3) return { ok: false, msg: 'That works! But imagine clapping 100 times. Try it with a for loop, like the jumping one.' };
            return { ok: false, msg: `Pip clapped ${claps} time${claps === 1 ? '' : 's'}. Make it 3.` };
          },
          hints: ['Start with: `for clap in range(3):`', 'Press Enter, then write `print("Clap!")`'],
          answer: 'for clap in range(3):\n    print("Clap!")',
          win: 'Clap! Clap! Clap! Pip takes a bow.',
        },
      ],
    },

    // ---------------- Chapter 3: Primary School ----------------
    c3l1: {
      title: 'The class register',
      icon: 'book',
      scene: 'classroom',
      cast: ['teacher'],
      memory: 'Your first day at primary school. {teacher} took the register.',
      rounds: [
        {
          mode: 'explain',
          say: [
            { who: 'narrator', text: 'Two years later. You\'re 8, and it\'s your first day at primary school.' },
            { who: 'teacher', text: 'Good morning! First, let\'s see what\'s in your pencil case.' },
          ],
          title: 'A list keeps many things in one jar',
          code: 'pens = ["red", "blue", "green"]',
          pieces: [['pens', 'the label'], ['=', 'put in'], ['[', 'list starts'], ['"red"', 'first'], [',', 'and'], ['"blue"', 'second'], [',', 'and'], ['"green"', 'third'], [']', 'list ends']],
          text: 'Square brackets `[ ]` hold a list. Commas separate the things in it.',
        },
        {
          mode: 'watch',
          say: [{ who: 'teacher', text: 'Now, the class register. Pip, can you show it?' }],
          code: 'classmates = ["{f1}", "{f2}", "{f3}"]\nprint(classmates)',
          task: 'Tap Run to see the whole register.',
          win: 'Pip shows the whole list, brackets and all.',
          learn: { term: 'Lists', text: 'A list holds many things in order: `["{f1}", "{f2}", "{f3}"]`.' },
        },
        {
          mode: 'predict',
          code: 'classmates = ["{f1}", "{f2}", "{f3}"]\nprint(len(classmates))',
          task: '`len` counts how many things are in a list.',
          question: 'What will Pip show?',
          options: [['3'], ['{f1}'], ['1']],
          answer: 0,
          why: {
            1: '`len` counts the names. It doesn\'t show them.',
            2: 'There are three names in the list, so `len` gives 3.',
          },
          win: 'Right! Three classmates on the register.',
          learn: { term: 'len', text: '`len(classmates)` is how many things are in the list.' },
        },
        {
          mode: 'change',
          say: [{ who: 'teacher', text: 'And you\'re new! Add your name to the end of the register.' }],
          code: 'classmates = ["{f1}", "{f2}", "{f3}", "[[Your name]]"]\nprint(classmates)',
          fill: ['{name}'],
          task: 'Change Your name to your own name, then tap Run.',
          check: (r, x) => (x.has(r.output, x.name) ? { ok: true } : { ok: false, msg: `${showed(r)} Put your own name inside the last quote marks.` }),
          hints: ['Tap Your name and type your own name instead.', 'Keep the quote marks around it.'],
          win: '{teacher} smiles. "Welcome to the class, {name}!"',
        },
      ],
    },

    c3l2: {
      title: 'Who\'s first?',
      icon: 'search',
      scene: 'classroom',
      cast: ['teacher'],
      memory: 'Pip taught the class that computers count from 0.',
      rounds: [
        {
          mode: 'explain',
          say: [
            { who: 'teacher', text: 'Pip, who is first on the register?' },
            { who: 'pip', text: 'I count from 0! So the first one is number 0.' },
          ],
          title: 'Square brackets pick one thing from a list',
          setup: 'classmates = ["{f1}", "{f2}", "{f3}"]',
          code: 'print(classmates[0])',
          pieces: [['print', 'show'], ['(', 'start'], ['classmates', 'the list'], ['[', 'position'], ['0', '0 = the first'], [']', 'end'], [')', 'finish']],
          text: 'Python counts positions from 0. `[0]` is the first, `[1]` the second, `[2]` the third.',
        },
        {
          mode: 'predict',
          code: 'classmates = ["{f1}", "{f2}", "{f3}"]\nprint(classmates[1])',
          task: 'Remember: counting starts at 0.',
          question: 'What will Pip show?',
          options: [['{f2}'], ['{f1}'], ['{f3}']],
          answer: 0,
          why: {
            1: '{f1} is at position 0. Position 1 is the second name.',
            2: '{f3} is at position 2, the third name.',
          },
          win: 'Right! Position 1 is the second name.',
          learn: { term: 'Rule', text: 'Positions start at 0: `[0]` is the first thing, `[1]` the second.' },
        },
        {
          mode: 'fix',
          code: 'classmates = ["{f1}", "{f2}", "{f3}"]\nprint(classmates[3])',
          task: 'Pip wants the last name, but something is wrong. Run it, then fix it.',
          check: exactly(['{f3}']),
          hints: ['There are 3 names, at positions 0, 1 and 2.', 'Change `[3]` to `[2]`.'],
          answer: 'classmates = ["{f1}", "{f2}", "{f3}"]\nprint(classmates[2])',
          learn: { term: 'Rule', text: 'A list of 3 things has positions 0, 1 and 2. Asking for `[3]` is out of range.' },
          win: 'Found {f3}, at the end of the list.',
        },
        {
          mode: 'guided',
          say: [{ who: 'teacher', text: 'Who\'s first, and how many are we?' }],
          code: 'classmates = ["{f1}", "{f2}", "{f3}"]\n',
          ghost: 'classmates = ["{f1}", "{f2}", "{f3}"]\nprint(classmates[0])\nprint(len(classmates))',
          task: 'Type over the grey letters: the first name, then how many there are.',
          check: exactly(['{f1}', '3']),
          hints: ['Line 2: `print(classmates[0])`', 'Line 3: `print(len(classmates))`'],
          answer: 'classmates = ["{f1}", "{f2}", "{f3}"]\nprint(classmates[0])\nprint(len(classmates))',
          win: '{f1} first, and 3 of you.',
        },
      ],
    },

    c3l3: {
      title: 'Roll call',
      icon: 'loop',
      scene: 'classroom',
      cast: ['teacher', 'f1'],
      memory: 'Pip called the whole register in one go.',
      rounds: [
        {
          mode: 'watch',
          say: [{ who: 'teacher', text: 'Pip, can you call everyone on the register?' }],
          code: 'classmates = ["{f1}", "{f2}", "{f3}", "{cousin}"]\nfor name in classmates:\n    print("Present:", name)',
          task: 'Tap Run. The loop goes through the list one name at a time.',
          win: 'Everyone is here!',
          learn: { term: 'Loops over lists', text: '`for name in classmates:` repeats the pushed-in lines once for each name.' },
        },
        {
          mode: 'predict',
          code: 'snacks = ["apple", "biscuit", "orange"]\nfor snack in snacks:\n    print(snack)',
          task: 'Break time.',
          question: 'What will Pip show?',
          options: [['apple', 'biscuit', 'orange'], ['snacks'], ['orange']],
          answer: 0,
          why: {
            1: 'The loop shows each thing in the list, not the list\'s label.',
            2: 'The pushed-in line runs for every snack, not just the last one.',
          },
          win: 'Right! One line for each snack.',
        },
        {
          mode: 'guided',
          say: [{ who: 'f1', text: 'Can Pip say good morning to each of us?' }],
          code: 'classmates = ["{f1}", "{f2}", "{f3}"]\n',
          ghost: 'classmates = ["{f1}", "{f2}", "{f3}"]\nfor name in classmates:\n    print("Good morning", name)',
          task: 'Type over the grey letters. After the colon, press Enter.',
          check: (r, x) => {
            const names = [x.f(1), x.f(2), x.f(3)];
            const ok = r.lines.length === 3 && names.every((n, i) => x.has(r.lines[i], n) && /good morning/i.test(r.lines[i]));
            return ok ? { ok: true } : { ok: false, msg: `${showed(r)} Pip should say good morning to each name.` };
          },
          hints: ['Line 2: `for name in classmates:`', 'Line 3 is pushed in: `print("Good morning", name)`'],
          answer: 'classmates = ["{f1}", "{f2}", "{f3}"]\nfor name in classmates:\n    print("Good morning", name)',
          win: '"Good morning, Pip!" says the whole class.',
        },
        {
          mode: 'free',
          code: 'pets = ["Rex", "Bisi", "Milo"]\n',
          task: 'Write a loop that shows every name in the list `pets`, one per line.',
          check: (r, x) => {
            const want = ['Rex', 'Bisi', 'Milo'];
            const same = r.lines.length === 3 && r.lines.every((l, i) => l === want[i]);
            if (same && /\bfor\b/.test(x.code)) return { ok: true };
            if (same) return { ok: false, msg: 'That works! Now try it with a for loop, so it works for any number of pets.' };
            return { ok: false, msg: `${showed(r)} Show Rex, Bisi and Milo, one per line.` };
          },
          hints: ['Start with `for pet in pets:`', 'Then, pushed in: `print(pet)`'],
          answer: 'pets = ["Rex", "Bisi", "Milo"]\nfor pet in pets:\n    print(pet)',
          win: 'Rex, Bisi and Milo. The class pets are all present.',
        },
      ],
    },

    c3l4: {
      title: 'A new pupil',
      icon: 'plus',
      scene: 'classroom',
      cast: ['teacher', 'f4'],
      memory: '{f4} joined the class. You added them to the register.',
      rounds: [
        {
          mode: 'predict',
          say: [
            { who: 'narrator', text: 'Knock, knock. A new pupil joins the class.' },
            { who: 'f4', text: 'Hello! I\'m {f4}.' },
          ],
          code: 'classmates = ["{f1}", "{f2}", "{f3}"]\nclassmates.append("{f4}")\nprint(len(classmates))',
          task: '`append` adds something to the end of a list.',
          question: 'What will Pip show?',
          options: [['4'], ['3'], ['{f4}']],
          answer: 0,
          why: {
            1: '`append` added {f4}, so the list now has 4 names.',
            2: '`len` shows how many names there are, not the names.',
          },
          win: 'Right! Four classmates now.',
          learn: { term: 'append', text: '`classmates.append("{f4}")` adds {f4} to the end of the list.' },
        },
        {
          mode: 'build',
          code: 'classmates = ["{f1}", "{f2}", "{f3}"]\n{{BUILD}}\nprint(classmates)',
          tiles: [['classmates', 'the list'], ['.append', 'add to the end'], ['(', 'start'], ['"', 'quote'], ['{f4}', 'the name'], ['"', 'quote'], [')', 'finish']],
          solution: ['classmates', '.append', '(', '"', '{f4}', '"', ')'],
          task: 'Build the middle line to add {f4} to the register. Then tap Run.',
          check: (r, x) => (r.lines.length === 1 && x.has(r.output, x.f(4)) ? { ok: true } : { ok: false, msg: `${showed(r)} {f4} should be on the list.` }),
          hints: ['Start with the list\'s label: `classmates`.', 'The line is: `classmates.append("{f4}")`'],
          win: '{f4} is on the register.',
        },
        {
          mode: 'fix',
          code: 'classmates = ["{f1}", "{f2}"]\nclassmates.append("{f3})\nprint(classmates)',
          task: 'This line has a bug. Run it, then fix it.',
          check: (r, x) => (r.lines.length === 1 && x.has(r.output, x.f(3)) ? { ok: true } : { ok: false, msg: `${showed(r)} {f3} should be added to the list.` }),
          hints: ['Count the quote marks on line 2.', 'Add a `"` right after {f3}, before the `)`.'],
          answer: 'classmates = ["{f1}", "{f2}"]\nclassmates.append("{f3}")\nprint(classmates)',
          win: 'Fixed! {f3} is on the list.',
        },
      ],
    },

    c3l5: {
      title: 'Line up by height',
      icon: 'people',
      scene: 'schoolyard',
      cast: ['teacher', 'f2'],
      memory: 'Lining up in the schoolyard, shortest to tallest.',
      rounds: [
        {
          mode: 'watch',
          say: [{ who: 'teacher', text: 'Everyone outside! Line up from shortest to tallest, please.' }],
          code: 'heights = [128, 121, 134, 125]\nprint(sorted(heights))',
          task: 'Tap Run to sort the heights, in centimetres.',
          win: 'Shortest to tallest!',
          learn: { term: 'sorted', text: '`sorted(heights)` gives the list in order, from smallest to biggest.' },
        },
        {
          mode: 'predict',
          code: 'heights = [128, 121, 134, 125]\nprint(max(heights))',
          task: '`max` finds the biggest number in a list.',
          question: 'What will Pip show?',
          options: [['134'], ['121'], ['128']],
          answer: 0,
          why: {
            1: '121 is the smallest. `min` would find that one.',
            2: '`max` doesn\'t take the first number. It finds the biggest.',
          },
          win: 'Right! The tallest is 134 cm.',
          learn: { term: 'max and min', text: '`max(heights)` is the biggest number, `min(heights)` the smallest.' },
        },
        {
          mode: 'change',
          say: [{ who: 'f2', text: 'Who\'s the shortest? I think it\'s me!' }],
          code: 'heights = [128, 121, 134, 125]\nprint([[max]](heights))',
          fill: ['min'],
          task: 'Change it so Pip shows the shortest height.',
          check: exactly(['121'], (r) => (r.lines[0] === '134' ? { ok: false, msg: 'That\'s the tallest. Use `min` for the shortest.' } : null)),
          hints: ['`max` finds the biggest. Which word finds the smallest?', 'Change `max` to `min`.'],
          win: '121 cm. {f2} was right!',
        },
        {
          mode: 'free',
          code: 'heights = [128, 121, 134, 125]\n',
          task: 'Write two lines: show the heights sorted, then show the tallest.',
          check: exactly(['[121, 125, 128, 134]', '134']),
          hints: ['Line 2: `print(sorted(heights))`', 'Line 3: `print(max(heights))`'],
          answer: 'heights = [128, 121, 134, 125]\nprint(sorted(heights))\nprint(max(heights))',
          win: 'The line is perfect, and you know who\'s tallest.',
        },
      ],
    },

    c3l6: {
      title: 'Times tables',
      icon: 'blocks',
      scene: 'classroom',
      cast: ['teacher'],
      memory: 'Pip did the times tables faster than anyone.',
      rounds: [
        {
          mode: 'watch',
          say: [{ who: 'teacher', text: 'Times tables! Pip, the 2 times table, please.' }],
          code: 'for n in range(1, 6):\n    print(2, "x", n, "=", 2 * n)',
          task: 'Tap Run. One loop makes a whole times table.',
          win: 'Two, four, six, eight, ten!',
        },
        {
          mode: 'change',
          code: 'for n in range(1, 6):\n    print([[2]], "x", n, "=", [[2]] * n)',
          fill: ['5', '5'],
          task: 'Make it the 5 times table: change both 2s to 5.',
          check: exactly(['5 x 1 = 5', '5 x 2 = 10', '5 x 3 = 15', '5 x 4 = 20', '5 x 5 = 25']),
          hints: ['There are two 2s to change.', 'Change both of them to 5.'],
          win: 'Five, ten, fifteen, twenty, twenty-five!',
        },
        {
          mode: 'predict',
          say: [{ who: 'pip', text: 'What if I put a loop inside a loop?' }],
          code: 'for a in range(1, 3):\n    for b in range(1, 3):\n        print(a, "x", b)',
          task: 'The inside loop is pushed in twice.',
          question: 'What will Pip show?',
          options: [['1 x 1', '1 x 2', '2 x 1', '2 x 2'], ['1 x 1', '2 x 2'], ['1 x 2', '2 x 1']],
          answer: 0,
          why: {
            1: 'For each a, the inside loop runs all the way: b is 1, then 2.',
            2: 'Each a goes with every b, including when they\'re the same.',
          },
          win: 'Right! The inside loop runs fully for each turn of the outside one.',
          learn: { term: 'Loops inside loops', text: 'The inside loop runs all the way through for each turn of the outside loop.' },
        },
        {
          mode: 'guided',
          code: '',
          ghost: 'for a in range(1, 4):\n    for b in range(1, 4):\n        print(a, "x", b, "=", a * b)',
          task: 'Type over the grey letters to make a times table grid.',
          check: (r) => {
            const want = [];
            for (let a = 1; a < 4; a++) for (let b = 1; b < 4; b++) want.push(`${a} x ${b} = ${a * b}`);
            return r.lines.length === want.length && r.lines.every((l, i) => l === want[i]) ? { ok: true } : { ok: false, msg: `${showed(r)} Pip should show all 9 sums, from 1 x 1 to 3 x 3.` };
          },
          hints: ['Line 2 is pushed in once, line 3 twice. Enter does it for you after each colon.', 'Line 3: `print(a, "x", b, "=", a * b)`'],
          answer: 'for a in range(1, 4):\n    for b in range(1, 4):\n        print(a, "x", b, "=", a * b)',
          win: 'Nine sums in three lines. The class claps.',
        },
      ],
    },

    c3l7: {
      title: 'Report card',
      icon: 'star',
      scene: 'home',
      cast: ['mum', 'grandma'],
      memory: 'Your first report card. {mum} put it on the fridge.',
      rounds: [
        {
          mode: 'explain',
          say: [{ who: 'mum', text: 'Your report card came! Let\'s work out your average mark.' }],
          title: 'An average: add them up, then share',
          setup: 'marks = [78, 85, 92]',
          code: 'average = sum(marks) / len(marks)',
          pieces: [['average', 'the label'], ['=', 'put in'], ['sum(marks)', 'all marks added up'], ['/', 'divided by'], ['len(marks)', 'how many marks']],
          text: 'Add all the marks together, then divide by how many marks there are.',
        },
        {
          mode: 'watch',
          code: 'marks = [78, 85, 92]\nprint(sum(marks))\nprint(sum(marks) / len(marks))',
          task: 'Tap Run: first the total, then the average.',
          win: '255 marks in total, and 85.0 on average.',
          learn: { term: 'sum', text: '`sum(marks)` adds up everything in the list.' },
        },
        {
          mode: 'predict',
          code: 'marks = [70, 80]\nprint(sum(marks) / len(marks))',
          task: 'Two marks this time.',
          question: 'What will Pip show?',
          options: [['75.0'], ['150'], ['2']],
          answer: 0,
          why: {
            1: '150 is the total. Dividing it by the 2 marks gives the average.',
            2: '2 is how many marks there are, from `len(marks)`.',
          },
          win: 'Right! Dividing makes a decimal number: 75.0.',
        },
        {
          mode: 'free',
          say: [{ who: 'grandma', text: 'I want to know your average too!' }],
          code: 'marks = [64, 90, 77, 85]\n',
          task: 'Write a line that shows the average of `marks`. It should be 79.0.',
          check: (r, x) => {
            if (!r.lines.includes('79.0')) return { ok: false, msg: `${showed(r)} Add up the marks with \`sum\`, then divide by \`len\`.` };
            if (!/sum\s*\(/.test(x.code) || !/len\s*\(/.test(x.code)) return { ok: false, msg: 'Right number! Now work it out with `sum` and `len`, so it works for any marks.' };
            return { ok: true };
          },
          hints: ['The average is `sum(marks) / len(marks)`.', 'Line 2: `print(sum(marks) / len(marks))`'],
          answer: 'marks = [64, 90, 77, 85]\nprint(sum(marks) / len(marks))',
          win: '79.0! {grandma} puts your report card on the fridge.',
        },
      ],
    },
  };

  // Words for Pip's notebook. The programmer's name ("jargon") appears once the
  // chapter is finished: doing first, naming later.
  const NOTEBOOK = [
    { id: 'print', word: 'print( )', plain: 'Makes Pip show something on its screen.', jargon: 'a function', unlock: 'c1l1', chapter: 'c1' },
    { id: 'string', word: '"words in quote marks"', plain: 'The exact words for Pip to show.', jargon: 'a string', unlock: 'c1l1', chapter: 'c1' },
    { id: 'brackets', word: '( )', plain: 'Holds what you give to print.', jargon: 'parentheses', unlock: 'c1l3', chapter: 'c1' },
    { id: 'error', word: 'Pip\'s confused messages', plain: 'Python telling you it didn\'t understand a line.', jargon: 'an error message', unlock: 'c1l4', chapter: 'c1' },
    { id: 'variable', word: 'sweets = 5', plain: 'A labelled jar that holds something.', jargon: 'a variable', unlock: 'c2l1', chapter: 'c2' },
    { id: 'division', word: '//  and  %', plain: 'Share out equally, and what\'s left over.', jargon: 'floor division and modulo', unlock: 'c2l4', chapter: 'c2' },
    { id: 'loop', word: 'for … in range( ):', plain: 'Repeat the pushed-in lines, counting each time.', jargon: 'a for loop', unlock: 'c2l5', chapter: 'c2' },
    { id: 'indent', word: 'pushed-in lines', plain: '4 spaces at the start show that a line belongs to the loop.', jargon: 'indentation', unlock: 'c2l6', chapter: 'c2' },
    { id: 'list', word: '[ "red", "blue" ]', plain: 'Many things in one jar, in order.', jargon: 'a list', unlock: 'c3l1', chapter: 'c3' },
    { id: 'len', word: 'len( )', plain: 'How many things are in a list.', jargon: 'a built-in function', unlock: 'c3l1', chapter: 'c3' },
    { id: 'index', word: 'classmates[0]', plain: 'The thing at a position. Positions start at 0.', jargon: 'an index', unlock: 'c3l2', chapter: 'c3' },
    { id: 'append', word: '.append( )', plain: 'Adds something to the end of a list.', jargon: 'a list method', unlock: 'c3l4', chapter: 'c3' },
    { id: 'sorted', word: 'sorted( )  max( )  min( )', plain: 'In order, the biggest, and the smallest.', jargon: 'built-in functions', unlock: 'c3l5', chapter: 'c3' },
    { id: 'nested', word: 'a loop inside a loop', plain: 'The inside loop runs all the way for each turn of the outside one.', jargon: 'a nested loop', unlock: 'c3l6', chapter: 'c3' },
    { id: 'average', word: 'sum( ) / len( )', plain: 'Add everything up, then share by how many there are.', jargon: 'the mean', unlock: 'c3l7', chapter: 'c3' },
  ];

  // The x object given to checks, and the {placeholder} filler.
  function makeContext(name, packId) {
    const P = PACKS[packId] || PACKS.westafrica;
    const vars = {
      name,
      mum: P.mum,
      grandma: P.grandma,
      uncle: P.uncle,
      uncleSay: P.uncleSay,
      cousin: P.cousin,
      f1: P.friends[0],
      f2: P.friends[1],
      f3: P.friends[2],
      f4: P.friends[3],
      f5: P.friends[4],
      teacher: P.teacher,
      food: P.food,
      game: P.game,
    };
    const t = (s) => String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
    const has = (text, word) => {
      const w = norm(word);
      return !!w && (' ' + norm(text) + ' ').includes(' ' + w + ' ');
    };
    return { name, P, t, has, f: (n) => P.friends[n - 1], vars };
  }

  // Joins build tiles into a line of code: no spaces inside quotes or brackets,
  // single spaces elsewhere (print("Mummy"), sweets = sweets + 3).
  function joinTiles(tokens) {
    let out = '';
    let inString = false;
    tokens.forEach((tok, i) => {
      const prev = tokens[i - 1];
      if (i > 0) {
        const tight = prev === '(' || tok === ')' || tok === '(' || tok.startsWith('.') || (prev === '"' && inString) || (tok === '"' && inString);
        if (!tight) out += ' ';
      }
      out += tok;
      if (tok === '"') inString = !inString;
    });
    return out;
  }

  // Predict options can be written as a plain string for a one-line answer.
  const optionLines = (opt) => (Array.isArray(opt) ? opt : [opt]);

  const api = { PACKS, STORIES, CHAPTERS, LEVELS, NOTEBOOK, norm, makeContext, joinTiles, optionLines };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LifePyContent = api;
})(typeof window !== 'undefined' ? window : globalThis);
