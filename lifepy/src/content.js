/*
 * Life.py content: storylines, hometown packs, chapters, levels and Pip's notebook.
 *
 * Text and code use {placeholders} filled from the player's name and hometown pack:
 * {name} {mum} {grandma} {uncle} {uncleSay} {cousin} {f1} {f2} {f3} {food} {game}.
 *
 * Every new idea climbs the same ladder: watch, change, build, fix, type with help,
 * type alone. Round modes match those steps:
 *   watch  - read-only code, press Run
 *   change - edit only the glowing [[slots]] in the code
 *   build  - tap tiles into order ({{BUILD}} marks the line inside fixed code)
 *   fix    - broken code in the editor
 *   guided - faint "ghost" code to type over
 *   free   - empty editor
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
      places: 'Lagos, Accra, Dakar, Abuja…',
      mum: 'Mummy',
      grandma: 'Grandma',
      uncle: 'Uncle Tunde',
      uncleSay: 'Uncle Tunde',
      uncleKey: 'tunde',
      cousin: 'Chioma',
      friends: ['Tolu', 'Emeka', 'Amina', 'Kofi', 'Zainab', 'Seyi', 'Ama', 'Ike', 'Halima'],
      food: 'jollof rice',
      game: 'suwe',
      skins: ['#5b3a24', '#7a4a2c', '#8d5524', '#6a3f25', '#9b6339'],
    },
    southasia: {
      id: 'southasia',
      label: 'South Asia',
      places: 'Mumbai, Lahore, Dhaka, Colombo…',
      mum: 'Amma',
      grandma: 'Dadi',
      uncle: 'Uncle Raj',
      uncleSay: 'Uncle Raj',
      uncleKey: 'raj',
      cousin: 'Priya',
      friends: ['Arjun', 'Ayesha', 'Ravi', 'Meera', 'Kabir', 'Sana', 'Dev', 'Nisha', 'Imran'],
      food: 'biryani',
      game: 'kho-kho',
      skins: ['#a0663f', '#8d5524', '#b87a4b', '#7d4b2a', '#c68642'],
    },
    latam: {
      id: 'latam',
      label: 'Latin America',
      places: 'Mexico City, Bogotá, São Paulo, Lima…',
      mum: 'Mamá',
      grandma: 'Abuela',
      uncle: 'Tío Carlos',
      uncleSay: 'Tio Carlos',
      uncleKey: 'carlos',
      cousin: 'Sofia',
      friends: ['Mateo', 'Camila', 'Diego', 'Lucia', 'Valentina', 'Santi', 'Isa', 'Tomas', 'Ana'],
      food: 'tamales',
      game: 'rayuela',
      skins: ['#c68642', '#8d5524', '#e0ac69', '#a0663f', '#5b3a24'],
    },
    ukus: {
      id: 'ukus',
      label: 'UK & US',
      places: 'London, Manchester, New York, Chicago…',
      mum: 'Mum',
      grandma: 'Grandma',
      uncle: 'Uncle Sam',
      uncleSay: 'Uncle Sam',
      uncleKey: 'sam',
      cousin: 'Lily',
      friends: ['Jack', 'Mia', 'Noah', 'Ava', 'Leo', 'Zara', 'Omar', 'Ella', 'Kai'],
      food: 'pizza',
      game: 'hopscotch',
      skins: ['#f1c27d', '#8d5524', '#e0ac69', '#5b3a24', '#c68642'],
    },
  };

  const STORIES = [
    {
      id: 'growingup',
      title: 'Growing Up',
      tagline: 'From your 5th birthday to your wedding day.',
      blurb: 'Live a whole life with Pip, the little robot who only speaks Python. Count in hide-and-seek, share sweets fairly, pass coded notes in class, and one day plan a wedding.',
      ready: true,
      art: 'growingup',
    },
    {
      id: 'bigcity',
      title: 'The Big City',
      tagline: 'Arrive with almost nothing. Hustle your way up.',
      blurb: 'Rent is due Sunday, the power keeps going off, and the buka next door can\'t count change fast enough. Your second-hand laptop runs Python. First stop: Lagos.',
      ready: false,
      art: 'bigcity',
    },
    {
      id: 'kitchen',
      title: 'Grandma\'s Kitchen',
      tagline: 'Save the family restaurant, one recipe at a time.',
      blurb: 'Grandma retires and hands you her struggling restaurant and a battered recipe book. Every recipe is written in Python, because a recipe is just a function.',
      ready: false,
      art: 'kitchen',
    },
    {
      id: 'casefiles',
      title: 'Case Files',
      tagline: 'A quiet town. Strange records. You and Pip investigate.',
      blurb: 'The school fund is short and someone changed the clinic\'s records. Search phone logs and receipts with Python until only one suspect is left.',
      ready: false,
      art: 'casefiles',
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
      blurb: 'Your birthday. A box with your name on it. A robot inside.',
      badge: 'First Words',
      file: 'birthday.py',
      reveal: {
        title: 'You just wrote real Python!',
        text: 'Pip\'s language is called Python. Scientists, doctors, banks and the biggest tech companies use it every day. You\'ve been writing it since your 5th birthday.',
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
      intro: 'One year later. You\'re 6, and Pip goes everywhere with you.',
      reveal: {
        title: 'Playground legend!',
        text: 'Jars, sharing signs and loops are real programming tools. Programmers use exactly these to count stock, split bills and repeat jobs thousands of times.',
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
      scene: 'birthday',
      sceneStart: { gift: 'closed', pip: 'hidden', guests: [], door: [] },
      rounds: [
        {
          mode: 'watch',
          say: [{ who: 'mum', text: 'Happy 5th birthday, {name}! This box has your name on it. Go on, open it!' }],
          pre: {
            label: 'Open the present',
            say: [
              { who: 'narrator', text: 'Inside the box is a little robot, fast asleep.' },
              { who: 'narrator', text: 'A card says: "Hi! I\'m Pip. I only understand one language. Press Run to read me this line."' },
            ],
            scene: { gift: 'open', pip: 'sleep' },
          },
          code: 'print("Hello")',
          task: 'Press Run to read the line to Pip.',
          win: 'Pip woke up and said its first word!',
        },
        {
          mode: 'watch',
          say: [{ who: 'narrator', text: 'There\'s a second card in the box. What do you think Pip will say this time?' }],
          code: 'print("Happy birthday!")',
          task: 'Press Run.',
          win: 'Pip said exactly the words inside the quotes.',
          learn: { term: 'print', text: 'print makes Pip show something. Pip shows the words inside the quotes.' },
        },
      ],
    },

    c1l2: {
      title: 'Say my name',
      scene: 'birthday',
      sceneStart: { gift: 'open', pip: 'idle', guests: [], door: [] },
      rounds: [
        {
          mode: 'change',
          say: [
            { who: 'pip', text: 'Hello! Hello! … Who are you?' },
            { who: 'narrator', text: 'Pip wants to learn your name.' },
          ],
          code: 'print("[[Hello]]")',
          fill: ['{name}'],
          task: 'Tap the word Hello and change it to your name. Then press Run.',
          check: (r, x) => {
            const said = r.lines.join(' ');
            if (!said.trim()) return { ok: false, msg: 'Pip didn\'t say anything. Put some words between the quotes.' };
            if (said === 'Hello') return { ok: false, msg: 'Pip still says Hello. Change the word between the quotes first.' };
            if (x.has(said, x.name)) return { ok: true, win: `"${x.name}! ${x.name}!" Pip likes your name.` };
            return { ok: true, win: `Pip said "${said}"! Next time, try your own name.` };
          },
          hints: ['Tap on Hello, delete it, and type your name.', 'Keep the quotes. Only change the word between them.'],
        },
        {
          mode: 'change',
          say: [{ who: 'mum', text: 'Can Pip say hello to me too?' }],
          code: 'print("[[Hello]]")',
          fill: ['Hello {mum}'],
          task: 'Change the words so Pip says hello to {mum}. For example: Hello {mum}',
          check: (r, x) => {
            if (x.has(r.output, x.P.mum)) return { ok: true };
            return { ok: false, msg: `${showed(r)} Make sure the word {mum} is in there.` };
          },
          hints: ['Type Hello {mum} between the quotes.'],
          win: '{mum} laughs. "Hello, Pip!"',
        },
      ],
    },

    c1l3: {
      title: 'Pip dropped the words',
      scene: 'birthday',
      sceneStart: { gift: 'open', pip: 'idle', guests: [], door: [] },
      rounds: [
        {
          mode: 'build',
          say: [{ who: 'narrator', text: 'Pip tripped over the wrapping paper and the line broke into pieces!' }],
          tiles: ['print', '(', '"', '{mum}', '"', ')'],
          solution: ['print', '(', '"', '{mum}', '"', ')'],
          task: 'Tap the pieces in the right order to rebuild the line. Then press Run.',
          check: exactly(['{mum}']),
          hints: ['Every line starts with print.', 'After print comes ( — Pip\'s hands opening.', 'The order is: print ( " {mum} " )'],
          learn: { term: 'The pieces', text: 'print = show.  ( ) = Pip\'s hands.  " " = exact words.' },
          win: '{mum} smiles. "You fixed it!"',
        },
        {
          mode: 'build',
          say: [{ who: 'narrator', text: 'Now say thank you to {mum} for the present. Careful: one piece is extra.' }],
          tiles: ['print', '(', '"', 'Thank you', '"', ')', ')'],
          solution: ['print', '(', '"', 'Thank you', '"', ')'],
          task: 'Build the line so Pip says Thank you. You won\'t need every piece.',
          check: exactly(['Thank you']),
          hints: ['Pip has two hands: one ( and one ).', 'The order is: print ( " Thank you " )'],
          win: '{mum} gives you and Pip a big hug.',
        },
      ],
    },

    c1l4: {
      title: 'Bug hunt',
      scene: 'birthday',
      sceneStart: { gift: 'open', pip: 'idle', guests: [], door: [] },
      rounds: [
        {
          mode: 'fix',
          say: [
            { who: 'narrator', text: 'Oh no. Pip ate too much cake and caught some bugs!' },
            { who: 'narrator', text: 'Press Run to see what goes wrong. Then fix the line so Pip says Hello.' },
          ],
          code: 'print("Hello)',
          task: 'Press Run first. Then fix the line so Pip says Hello.',
          check: exactly(['Hello']),
          hints: ['Count the " marks. How many are there?', 'Add a " right after Hello, before the ).'],
          answer: 'print("Hello")',
          learn: { term: 'Rule', text: 'Quotes come in pairs: one " before the words and one after.' },
        },
        {
          mode: 'fix',
          say: [{ who: 'pip', text: '*hic* … something\'s wrong again!' }],
          code: 'print("Hello"',
          task: 'Press Run, then fix the line.',
          check: exactly(['Hello']),
          hints: ['Look at the very end of the line.', 'Add a ) at the end to close Pip\'s hands.'],
          answer: 'print("Hello")',
          learn: { term: 'Rule', text: 'Brackets come in pairs: ( opens Pip\'s hands and ) closes them.' },
        },
        {
          mode: 'fix',
          say: [{ who: 'pip', text: 'I feel strange. Who is Print?' }],
          code: 'Print("Hello")',
          task: 'Press Run, then fix the line.',
          check: exactly(['Hello']),
          hints: ['Look at the very first letter.', 'Change the big P to a small p.'],
          answer: 'print("Hello")',
          learn: { term: 'Rule', text: 'Capital letters matter. print, not Print.' },
        },
        {
          mode: 'fix',
          say: [{ who: 'pip', text: 'Prnit? Is that a word?' }],
          code: 'prnit("Hello")',
          task: 'Press Run, then fix the line.',
          check: exactly(['Hello']),
          hints: ['Read the first word slowly, letter by letter.', 'It should be print: p, r, i, n, t.'],
          answer: 'print("Hello")',
          learn: { term: 'Rule', text: 'Spelling matters. Pip only knows print spelled p-r-i-n-t.' },
        },
        {
          mode: 'fix',
          say: [{ who: 'pip', text: 'Last bug. I promise.' }],
          code: 'print(Hello)',
          task: 'Press Run, then fix the line.',
          check: exactly(['Hello']),
          hints: ['What\'s missing around the word Hello?', 'Put a " before Hello and another " after it.'],
          answer: 'print("Hello")',
          learn: { term: 'Rule', text: 'Words need quotes. Without quotes, Pip thinks the word is a name.' },
          win: 'All better! Pip is bug-free.',
        },
      ],
    },

    c1l5: {
      title: 'Guests at the door',
      scene: 'birthday',
      sceneStart: { gift: 'open', pip: 'idle', guests: [], door: [] },
      rounds: [
        {
          mode: 'guided',
          say: [
            { who: 'narrator', text: 'Ding dong! {grandma} is at the door.' },
            { who: 'grandma', text: 'Where is the birthday child?' },
          ],
          scene: { door: ['{grandma}'] },
          ghost: 'print("Welcome {grandma}")',
          task: 'Type the faint letters to make Pip welcome {grandma}. The glowing key shows the symbol you need next.',
          check: (r, x) => (x.has(r.output, x.P.grandma) ? { ok: true } : { ok: false, msg: `${showed(r)} Make sure {grandma} is in the welcome.` }),
          onWin: { guests: ['{grandma}'], door: [] },
          hints: ['Copy the faint letters exactly, one by one.', 'You need: print ( " Welcome {grandma} " )'],
          answer: 'print("Welcome {grandma}")',
          win: '{grandma} comes in and pinches your cheek.',
        },
        {
          mode: 'guided',
          say: [{ who: 'narrator', text: 'Ding dong! It\'s {uncle}.' }],
          scene: { door: ['{uncle}'] },
          ghost: 'print("Welcome {uncleSay}")',
          task: 'Type the faint letters to welcome {uncle}.',
          check: (r, x) => (x.has(r.output, x.P.uncleKey) ? { ok: true } : { ok: false, msg: `${showed(r)} Make sure {uncle} is in the welcome.` }),
          onWin: { guests: ['{uncle}'], door: [] },
          hints: ['You need: print ( " Welcome {uncleSay} " )'],
          answer: 'print("Welcome {uncleSay}")',
          learn: { term: 'Keyboard tip', text: 'On most keyboards, ( is Shift + 9 and ) is Shift + 0. You can always tap the symbol buttons instead.' },
          win: '{uncle} lifts you up in the air. "Five years old!"',
        },
      ],
    },

    c1l6: {
      title: 'Party time!',
      scene: 'birthday',
      sceneStart: { gift: 'open', pip: 'idle', guests: ['{grandma}', '{uncle}'], door: [] },
      rounds: [
        {
          mode: 'free',
          say: [
            { who: 'narrator', text: 'Ding dong, ding dong, ding dong! {cousin}, {f1} and {f2} all arrive at once.' },
            { who: 'pip', text: 'So many people! Can you write a line for each one?' },
          ],
          scene: { door: ['{cousin}', '{f1}', '{f2}'] },
          task: 'Write one line for each guest so Pip welcomes all three. No faint letters this time. You can do it!',
          check: (r, x) => {
            const names = [x.P.cousin, x.f(1), x.f(2)];
            const welcomed = names.filter((n) => x.has(r.output, n));
            if (welcomed.length === names.length) return { ok: true };
            const waiting = names.filter((n) => !welcomed.includes(n));
            if (!welcomed.length) return { ok: false, msg: 'Pip hasn\'t welcomed anyone yet. Start each line with print.' };
            return { ok: false, msg: `Pip welcomed ${welcomed.join(' and ')}. Still waiting at the door: ${waiting.join(' and ')}.` };
          },
          onRun: (r, x) => {
            const names = [x.P.cousin, x.f(1), x.f(2)];
            const inside = names.filter((n) => x.has(r.output, n));
            return { guests: [x.P.grandma, x.P.uncle, ...inside], door: names.filter((n) => !inside.includes(n)) };
          },
          hints: ['One line for each guest. Each line starts with print.', 'The first line could be: print("Welcome {cousin}")', 'Press Enter to start a new line for the next guest.'],
          answer: 'print("Welcome {cousin}")\nprint("Welcome {f1}")\nprint("Welcome {f2}")',
          win: 'Everyone is inside. Time for {food} and cake!',
        },
      ],
    },

    // ---------------- Chapter 2: The Playground ----------------
    c2l1: {
      title: 'Pip\'s jars',
      scene: 'jars',
      sceneStart: { count: null, pip: 'idle' },
      rounds: [
        {
          mode: 'watch',
          say: [
            { who: 'narrator', text: 'One year later. You\'re 6 now, and Pip goes everywhere with you.' },
            { who: 'grandma', text: 'Here, {name}. A jar of sweets, just for you.' },
            { who: 'pip', text: 'I keep track of things in labelled jars. Watch!' },
          ],
          code: 'sweets = 5\nprint(sweets)',
          task: 'Press Run and watch the jar.',
          win: 'Line 1 put 5 in the jar labelled sweets. Line 2 showed what\'s inside.',
          learn: { term: 'Jars', text: 'sweets = 5 puts 5 in a jar labelled sweets. The name goes on the left, the thing goes on the right.' },
        },
        {
          mode: 'change',
          say: [{ who: 'pip', text: 'How many sweets do you wish you had?' }],
          code: 'sweets = [[5]]\nprint(sweets)',
          fill: ['12'],
          task: 'Change 5 to any number you like, then press Run.',
          check: (r) => {
            const n = r.vars.sweets;
            if (typeof n !== 'number') return { ok: false, msg: 'Pip needs a number for this jar. Type digits, like 12.' };
            if (n === 5) return { ok: false, msg: 'That\'s still 5. Change it to the number you wish for.' };
            if (n > 100) return { ok: true, win: `${r.lines[0]} sweets?! {mum} says you'll get a tummy ache.` };
            if (n < 0) return { ok: true, win: 'Negative sweets? Pip is very confused, but it works!' };
            return { ok: true, win: `Pip put ${r.lines[0]} sweets in the jar.` };
          },
          hints: ['Tap the 5 and type a different number, like 12.'],
        },
      ],
    },

    c2l2: {
      title: 'Jar mix-ups',
      scene: 'jars',
      sceneStart: { count: 5, pip: 'idle' },
      rounds: [
        {
          mode: 'fix',
          say: [{ who: 'narrator', text: 'Pip is meant to tell you how many sweets are in the jar. Something\'s not right.' }],
          code: 'sweets = 5\nprint("sweets")',
          task: 'Press Run. Then fix it so Pip shows the number in the jar.',
          check: exactly(['5'], (r) => (r.lines.join() === 'sweets'
            ? { ok: false, msg: 'Pip showed the word "sweets" because it\'s in quotes, and quotes mean exact words. Take the quotes away so Pip looks inside the jar.' }
            : null)),
          hints: ['Quotes mean "show these exact words".', 'Remove both " marks around sweets on line 2.'],
          answer: 'sweets = 5\nprint(sweets)',
          learn: { term: 'Rule', text: '"sweets" in quotes is just the word. sweets without quotes is the jar.' },
        },
        {
          mode: 'fix',
          say: [{ who: 'pip', text: 'Hmm. Which jar am I meant to look in?' }],
          code: 'sweets = 5\nprint(sweet)',
          task: 'Press Run, then fix it.',
          check: exactly(['5']),
          hints: ['Compare the jar name on line 1 with the one on line 2.', 'Change sweet to sweets on line 2.'],
          answer: 'sweets = 5\nprint(sweets)',
          learn: { term: 'Rule', text: 'Jar names must be spelled exactly the same every time.' },
        },
      ],
    },

    c2l3: {
      title: 'More sweets!',
      scene: 'jars',
      sceneStart: { count: 5, pip: 'idle' },
      rounds: [
        {
          mode: 'build',
          say: [{ who: 'uncle', text: 'Here are 3 more sweets for your jar!' }],
          code: 'sweets = 5\n{{BUILD}}\nprint(sweets)',
          tiles: [['sweets', 'jar name'], ['=', 'put in'], ['sweets', 'jar name'], ['+', 'add'], ['3', 'number']],
          solution: ['sweets', '=', 'sweets', '+', '3'],
          task: 'Build the middle line so the jar gets 3 more sweets. Then press Run.',
          check: exactly(['8']),
          hints: ['The jar\'s name goes first, then the = sign.', 'After = comes: sweets + 3'],
          learn: { term: 'Adding', text: 'sweets = sweets + 3 means: take what\'s in the jar, add 3, and put it back.' },
          win: 'Pip counts 8 sweets.',
        },
        {
          mode: 'guided',
          say: [{ who: 'narrator', text: 'You ate 2 sweets. They were delicious.' }],
          code: 'sweets = 8\n',
          ghost: 'sweets = 8\nsweets = sweets - 2\nprint(sweets)',
          task: 'Type the faint letters to take 2 sweets out of the jar.',
          check: exactly(['6']),
          hints: ['Line 2 is: sweets = sweets - 2', 'Line 3 shows the jar: print(sweets)'],
          answer: 'sweets = 8\nsweets = sweets - 2\nprint(sweets)',
          win: '6 sweets left. Pip guards them carefully.',
        },
      ],
    },

    c2l4: {
      title: 'Share fairly',
      scene: 'share',
      sceneStart: { sweets: 17, friends: 5, each: null, left: null, pip: 'idle' },
      rounds: [
        {
          mode: 'watch',
          say: [
            { who: 'narrator', text: 'At the playground, your friends spot your sweets. Everyone wants some!' },
            { who: 'pip', text: 'I know two special signs for sharing. // shares things out equally. % finds what\'s left over.' },
          ],
          code: 'sweets = 17\nfriends = 5\nprint(sweets // friends)\nprint(sweets % friends)',
          task: 'Press Run to share 17 sweets between 5 friends.',
          win: 'Each friend gets 3, and 2 are left over. Pip thinks you should keep those.',
          learn: { term: 'Sharing signs', text: '// shares equally: 17 // 5 is 3 each.  % is what\'s left over: 17 % 5 is 2.' },
        },
        {
          mode: 'change',
          say: [
            { who: 'friend', name: '{f1}', text: 'Wait for us! We want sweets too!' },
            { who: 'narrator', text: '4 more friends run over. Now there are 9.' },
          ],
          code: 'sweets = 17\nfriends = [[5]]\nprint(sweets // friends)\nprint(sweets % friends)',
          fill: ['9'],
          task: 'Change the number of friends to 9, then press Run.',
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
      scene: 'hideseek',
      sceneStart: { phase: 'ready', number: null, pip: 'idle' },
      rounds: [
        {
          mode: 'watch',
          say: [
            { who: 'friend', name: '{f2}', text: 'Let\'s play hide and seek! {name}, you\'re it!' },
            { who: 'pip', text: 'I\'ll count for you. I can count really fast.' },
          ],
          code: 'for number in range(1, 11):\n    print(number)\nprint("Ready or not, here I come!")',
          task: 'Press Run and watch Pip count.',
          win: 'Pip counted from 1 to 10. The pushed-in line is the one Pip repeats.',
          learn: { term: 'Loops', text: 'for number in range(1, 11): repeats the pushed-in lines, counting from 1 to 10.' },
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
            if (last === '19') return { ok: false, msg: 'Pip stopped at 19! range stops just before the last number. Try 21.' };
            if (!nums.length) return { ok: false, msg: 'Pip didn\'t count at all. The second number must be bigger than 1.' };
            return { ok: false, msg: `Pip counted to ${last}. Make it count to 20.` };
          },
          hints: ['range(1, 11) counts 1 to 10. It stops just before 11.', 'To stop at 20, the second number must be 21.'],
          learn: { term: 'Rule', text: 'range stops just before the last number: range(1, 21) counts 1 to 20.' },
          win: 'Pip counted all the way to 20. Everyone had time to hide.',
        },
      ],
    },

    c2l6: {
      title: 'Loop bugs',
      scene: 'hideseek',
      sceneStart: { phase: 'ready', number: null, pip: 'idle' },
      rounds: [
        {
          mode: 'fix',
          say: [{ who: 'narrator', text: 'Pip wants to count to 5 for the little kids, but the loop is broken.' }],
          code: 'for number in range(1, 6)\n    print(number)',
          task: 'Press Run, then fix the loop.',
          check: exactly(countTo(5)),
          hints: ['Look at the end of line 1.', 'Add a : at the very end of line 1.'],
          answer: 'for number in range(1, 6):\n    print(number)',
          learn: { term: 'Rule', text: 'A loop line ends with a colon : which means "here\'s what to repeat".' },
        },
        {
          mode: 'fix',
          say: [{ who: 'pip', text: 'Which line am I supposed to repeat?' }],
          code: 'for number in range(1, 6):\nprint(number)',
          task: 'Press Run, then fix the loop.',
          check: exactly(countTo(5)),
          hints: ['Line 2 should be pushed in.', 'Put 4 spaces at the start of line 2. The ⇥ button does it for you.'],
          answer: 'for number in range(1, 6):\n    print(number)',
          learn: { term: 'Rule', text: 'Lines inside a loop are pushed in with 4 spaces. That\'s how Pip knows what to repeat.' },
        },
      ],
    },

    c2l7: {
      title: 'Skip and clap',
      scene: 'rope',
      sceneStart: { action: 'jump', pip: 'idle' },
      rounds: [
        {
          mode: 'guided',
          say: [{ who: 'friend', name: '{f2}', text: 'I brought a skipping rope! Can Pip jump 5 times?' }],
          ghost: 'for jump in range(5):\n    print("Jump!")',
          task: 'Type the faint letters. After the colon, press Enter: the next line pushes itself in.',
          check: (r) => {
            const jumps = r.lines.filter((l) => /jump/i.test(l)).length;
            if (jumps === 5 && r.lines.length === 5) return { ok: true };
            return { ok: false, msg: `Pip jumped ${jumps} time${jumps === 1 ? '' : 's'}. Make it 5.` };
          },
          hints: ['Line 1: for jump in range(5):', 'Line 2 starts with 4 spaces: print("Jump!")'],
          answer: 'for jump in range(5):\n    print("Jump!")',
          win: 'Five perfect jumps!',
        },
        {
          mode: 'free',
          say: [{ who: 'narrator', text: 'Everyone cheers. Now make Pip clap 3 times, using a loop.' }],
          scene: { action: 'clap' },
          task: 'Write a loop that makes Pip show Clap! 3 times.',
          check: (r, x) => {
            const claps = r.lines.filter((l) => /clap/i.test(l)).length;
            const usedLoop = /\bfor\b/.test(x.code);
            if (claps === 3 && usedLoop) return { ok: true };
            if (claps === 3) return { ok: false, msg: 'That works! But imagine clapping 100 times. Try it with a for loop, like the jumping one.' };
            return { ok: false, msg: `Pip clapped ${claps} time${claps === 1 ? '' : 's'}. Make it 3.` };
          },
          hints: ['Start with: for clap in range(3):', 'On the next line, push in 4 spaces and write print("Clap!")'],
          answer: 'for clap in range(3):\n    print("Clap!")',
          win: 'Clap! Clap! Clap! Pip takes a bow.',
        },
      ],
    },
  };

  // Words for Pip's notebook. The programmer's name ("jargon") appears once the
  // chapter is finished: doing first, naming later.
  const NOTEBOOK = [
    { id: 'print', word: 'print( )', plain: 'Makes Pip show something on the screen.', jargon: 'a function: a command that does a job', unlock: 'c1l1', chapter: 'c1' },
    { id: 'string', word: '"words in quotes"', plain: 'The exact words for Pip to show.', jargon: 'a string', unlock: 'c1l1', chapter: 'c1' },
    { id: 'brackets', word: '( )', plain: 'Pip\'s hands. They hold what you give to print.', jargon: 'parentheses: they pass things into a function', unlock: 'c1l3', chapter: 'c1' },
    { id: 'error', word: 'Pip\'s confused faces', plain: 'Python telling you it didn\'t understand a line.', jargon: 'an error message', unlock: 'c1l4', chapter: 'c1' },
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

  const api = { PACKS, STORIES, CHAPTERS, LEVELS, NOTEBOOK, norm, makeContext, joinTiles };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LifePyContent = api;
})(typeof window !== 'undefined' ? window : globalThis);
