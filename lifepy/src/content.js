/*
 * Life.py content: storylines, hometown packs, chapters, lessons and Pip's notebook.
 *
 * Text and code use {placeholders} filled from the player's name and hometown pack:
 * {name} {mum} {grandma} {uncle} {uncleSay} {cousin} {f1} {f2} {f3} {food} {game}.
 *
 * A lesson is a list of rounds. A round with `say` lines first gets a story screen,
 * then its own screen. Every new idea climbs the same ladder, one small step each:
 *   explain - a line of code with each piece labelled
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
      cousin: 'Chioma',
      friends: ['Tolu', 'Emeka', 'Amina', 'Kofi', 'Zainab'],
      food: 'jollof rice',
      game: 'suwe',
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
      cousin: 'Priya',
      friends: ['Arjun', 'Ayesha', 'Ravi', 'Meera', 'Kabir'],
      food: 'biryani',
      game: 'kho-kho',
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
      cousin: 'Sofia',
      friends: ['Mateo', 'Camila', 'Diego', 'Lucia', 'Valentina'],
      food: 'tamales',
      game: 'rayuela',
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
      cousin: 'Lily',
      friends: ['Jack', 'Mia', 'Noah', 'Ava', 'Leo'],
      food: 'pizza',
      game: 'hopscotch',
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
    { id: 'c3', n: 3, title: 'Primary School', age: 'Age 8', locked: true, blurb: 'The class register, lining up by height, your first report card.' },
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
      rounds: [
        {
          mode: 'guided',
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
          say: [{ who: 'narrator', text: 'Ding dong! It\'s {uncle}.' }],
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
      rounds: [
        {
          mode: 'free',
          say: [{ who: 'narrator', text: 'Ding dong! Your cousin {cousin} is here.' }],
          task: 'Make Pip welcome {cousin}. No grey letters this time.',
          check: (r, x) => (x.has(r.output, x.P.cousin) ? { ok: true } : { ok: false, msg: `${showed(r)} Make sure {cousin} is in the welcome.` }),
          hints: ['Start with `print` and an open bracket: `print(`', 'Like this: `print("Welcome {cousin}")`'],
          answer: 'print("Welcome {cousin}")',
          win: '{cousin} runs in, straight to the cake.',
        },
        {
          mode: 'free',
          say: [{ who: 'narrator', text: '{f1} and {f2} arrive together.' }],
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
      rounds: [
        {
          mode: 'predict',
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
          say: [{ who: 'friend', name: '{f1}', text: 'Wait! 4 more of us want sweets too!' }],
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
      rounds: [
        {
          mode: 'watch',
          say: [
            { who: 'friend', name: '{f2}', text: 'Let\'s play hide and seek! {name}, you\'re it!' },
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
          say: [{ who: 'friend', name: '{f3}', text: 'That was way too fast! Count to 20 this time.' }],
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
      rounds: [
        {
          mode: 'guided',
          say: [{ who: 'friend', name: '{f2}', text: 'I brought a skipping rope! Can Pip jump 5 times?' }],
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
        const tight = prev === '(' || tok === ')' || tok === '(' || (prev === '"' && inString) || (tok === '"' && inString);
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
