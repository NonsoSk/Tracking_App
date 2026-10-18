# Life.py

A story game that teaches Python to people who have never seen a line of code.
You live a life with Pip, a little robot that only understands Python. Everything
you teach Pip is real Python, and Python's own error messages are explained in
plain words.

This folder is a playable prototype: onboarding, the Growing Up storyline's
first two chapters (13 lessons of about 3–5 minutes each), four hometown packs,
Pip's notebook and a results page for playtests.

## Play it

- **On claude.ai:** open the published link. On claude.ai, Pip can also answer
  questions with **Ask Pip** (inside a hint).
- **Anywhere else:** open [`dist/lifepy.html`](dist/lifepy.html) in a browser.
  It is one self-contained file: send it over WhatsApp or email, or copy it to
  a phone, and it plays offline. Progress is saved in that browser.

## How a beginner moves through it

- **First visit:** one question per screen: your name, where you grew up, which
  story. Then the first lesson starts.
- **Home:** one big button to continue, plus the list of lessons.
- **A lesson:** one screen at a time, a progress bar at the top and one main
  button at the bottom (Continue, Run or Check). Feedback slides up in that bar:
  green when it worked, orange with Pip's explanation when it didn't.

## What's in the prototype

| Chapter | Lessons | What players learn without being told |
|---|---|---|
| 1. First Words (age 5) | A present for you, Say my name, The pieces of a line, Bug hunt, Guests at the door, Party time | `print`, quote marks, brackets, reading errors, typing a line from memory |
| 2. The Playground (age 6) | Pip's jars, Jar mix-ups, More sweets, Share fairly, Hide and seek, Loop bugs, Skip and clap | variables, `+` and `-`, `//` and `%`, `for` loops, `range`, indentation |

Every idea is taught in small steps, so nobody types anything they haven't
first seen, predicted and built:

1. **Explain** – a line of code with each piece labelled
2. **Watch** – tap Run and see what Pip shows
3. **What will Pip show?** – pick the output before it runs
4. **Which one works?** – spot the correct line among small mistakes
5. **Change** – edit one highlighted part of a working line
6. **Build** – tap tiles into order
7. **Fix** – run a line with a bug, read the explanation, repair it
8. **Type with help** – grey letters to type over, with the next symbol key highlighted
9. **Type alone** – an empty editor

Other things that help complete beginners:

- **In plain words** under the code turns each line into a sentence ("Show:
  Hello", "Put 5 in the jar labelled sweets").
- **Pip's screen** shows the output, and **Pip's jars** show what each variable
  holds.
- **Errors in plain words** ("A quote mark is missing") with the real Python
  message underneath, so players learn to read it.
- **No jargon until after.** "String", "function", "variable" and "loop" are only
  named at the end of a chapter, once players have used them many times.
- **Symbol keys** for the symbols each step needs, phone curly quotes
  straightened automatically, and the editor indents itself after a colon.
- **Hints, then the answer.** Every typing step has hints, then "Show me the
  answer", which can put it in the editor.
- **Hometown packs** (West Africa, South Asia, Latin America, UK & US) change
  names, family words and food. The Python stays the same.
- **Listen** reads each story screen aloud; Settings can make it automatic.

## Running a playtest with non-coders

1. Give each tester the link or the file. Don't explain anything about coding.
2. Sit beside them and **don't help**. Note where they pause, frown or ask.
3. When they finish (or after 30 minutes), open **Settings → See playtest
   results**. It shows time, tries, mistakes and hints for every lesson, the
   stories they want next and what they found hardest.
4. Press **Copy results** and paste them into a message to yourself.
5. In Settings, press **Start over for a new player** before handing the device
   to the next tester.

What to look for: lessons with many mistakes or hints are where the design needs
work. The goal is that a tester can type a `print` line from memory by the end
of Chapter 1, and write a small loop by the end of Chapter 2.

## How it works

The game is plain HTML, CSS and JavaScript with no build dependencies.

| File | What it does |
|---|---|
| `src/python.js` | PyMini, a small Python interpreter for the beginner subset. It reports errors with exactly the same wording as CPython 3.13 and translates code into plain words. |
| `src/content.js` | Storylines, hometown packs, chapters, lessons, checks and the notebook. Adding a lesson means adding data here. |
| `src/art.js` | Pip's face, line icons and avatars, as inline SVG. |
| `src/game.js` | Onboarding, home, lesson screens, the code editor, tiles, running code, explanations, hints, progress, results and the Ask Pip helper. |
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
node --test lifepy/tests/*.test.mjs            # interpreter vs CPython, and every lesson's answers
node lifepy/tests/playthrough.mjs [shots-dir]  # plays the whole game in Chromium, saves screenshots
```

The tests need `python3` (3.13 for exact error wording) and, for the
playthrough, Playwright with Chromium.

See [DESIGN.md](DESIGN.md) for the full game design: the four storylines,
characters, look and feel, and what to build next.
