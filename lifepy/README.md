# Life.py

A story game that teaches Python to people who have never seen a line of code.
You live a life with Pip, a little robot who only understands Python. Everything
you teach Pip is real Python, and Python's own error messages show up as Pip's
confused faces.

This folder is the first playable prototype: the story select screen, the
Growing Up storyline's first two chapters (13 levels, about 30–45 minutes), four
hometown packs, Pip's notebook and a results page for playtests.

## Play it

- **On claude.ai:** open the published link. On claude.ai, Pip can also give
  AI hints with the **Ask Pip** button.
- **Anywhere else:** open [`dist/lifepy.html`](dist/lifepy.html) in a browser.
  It is one self-contained file: send it over WhatsApp or email, or copy it to
  a phone, and it plays offline. Progress is saved in that browser.

## What's in the prototype

| Chapter | Levels | What players learn without being told |
|---|---|---|
| 1. First Words (age 5) | A present for you, Say my name, Pip dropped the words, Bug hunt, Guests at the door, Party time! | `print`, quotes, brackets, reading errors, typing a line from memory |
| 2. The Playground (age 6) | Pip's jars, Jar mix-ups, More sweets!, Share fairly, Hide and seek, Loop bugs, Skip and clap | variables, `+` and `-`, `//` and `%`, `for` loops, `range`, indentation |

Every idea goes up the same ladder, so nobody types anything they haven't
first watched, changed, built from tiles and fixed:

1. **Watch** – press Run on a line and see what happens
2. **Change** – edit one glowing part of a working line
3. **Build** – tap tiles into order (`print` = show, `( )` = Pip's hands, `" "` = exact words)
4. **Fix** – Pip has a bug; run it, read Pip's reaction, repair it
5. **Type with help** – faint letters to type over, with the next symbol key glowing
6. **Type alone** – an empty editor

Other things that help complete beginners:

- **Pip's translation** turns each line into plain words as you type ("Show: Hello",
  "Put 5 in the jar labelled sweets", "Count number from 1 to 10, and each time:").
- **Real errors, explained.** Pip reacts to the mistake (mouth stuck open for a
  missing quote, hands stuck open for a missing bracket) and the real Python
  message appears underneath.
- **No jargon until after.** "String", "function", "variable" and "loop" are only
  named at the end of a chapter, once players have used them many times.
- **Symbol keys** for `( ) " : =` and a "push in" key, phone curly quotes
  straightened automatically, the editor indents itself after a colon.
- **Hometown packs** (West Africa, South Asia, Latin America, UK & US) change
  names, family words, food and games. The Python stays the same.
- **Read aloud** speaks the story for players who prefer listening.

## Running a playtest with non-coders

1. Give each tester the link or the file. Don't explain anything about coding.
2. Sit beside them and **don't help**. Note where they pause, frown or ask.
3. When they finish (or after 30 minutes), open **For testers: see results**
   from the title screen. It shows time, runs, mistakes and hints for every
   level, the stories they want next and what they found hardest.
4. Press **Copy results** and paste them into a message to yourself.
5. Press **Start over for a new player** before handing the device to the
   next tester.

What to look for: levels with many mistakes or hints are where the design needs
work. The goal is that a tester can type a `print` line from memory by the end
of Chapter 1, and write a small loop by the end of Chapter 2.

## How it works

The game is plain HTML, CSS and JavaScript with no build dependencies.

| File | What it does |
|---|---|
| `src/python.js` | PyMini, a small Python interpreter for the beginner subset. It reports errors with exactly the same wording as CPython 3.13 and translates code into plain words. |
| `src/content.js` | Storylines, hometown packs, chapters, levels, checks and the notebook. Adding a level means adding data here. |
| `src/scenes.js` | Pip and the illustrated scenes, as inline SVG. |
| `src/game.js` | Screens, the code editor, tiles, running code, Pip's reactions, hints, progress, results and the Ask Pip helper. |
| `src/style.css`, `src/page.html` | Look and layout. |
| `build.mjs` | Bundles everything into `dist/lifepy.html` (standalone) and `dist/artifact.html` (for claude.ai). |

Why not run real CPython in the browser (Pyodide)? It is about 10 MB to
download, which is slow on many phones and networks, and the claude.ai page
can't fetch it. PyMini loads instantly and is checked against real Python on
every test run; anything outside the beginner subset is reported as "Pip hasn't
learned that yet" rather than guessed.

## Commands

```bash
node lifepy/build.mjs                          # build dist/
node --test lifepy/tests/*.test.mjs            # interpreter vs CPython, and every level's answers
node lifepy/tests/playthrough.mjs [shots-dir]  # plays the whole game in Chromium, saves screenshots
```

The tests need `python3` (3.13 for exact error wording) and, for the
playthrough, Playwright with Chromium.

See [DESIGN.md](DESIGN.md) for the full game design: the four storylines,
characters, look and feel, and what to build next.
