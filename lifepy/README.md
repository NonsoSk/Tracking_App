# Life.py

A story game that teaches Python to people who have never seen a line of code.
You live a life with Pip, a little robot that only understands Python. Everything
you teach Pip is real Python, and Python's own error messages are explained in
plain words.

This folder is a playable prototype: a living 3D world for each of four
hometowns, the Growing Up storyline's first three chapters (20 missions of about
3–5 minutes each), a family and friends from each hometown, a photo album of
memories, Pip's notebook and a results page for playtests.

## Play it

- **On claude.ai:** open the published link. On claude.ai, Pip can also answer
  questions with **Ask Pip** (inside a hint).
- **Anywhere else:** open [`dist/lifepy.html`](dist/lifepy.html) in a browser.
  It is one self-contained file: send it over WhatsApp or email, or copy it to
  a phone, and it plays offline. Progress is saved in that browser.

## How it plays

- **First visit:** the title screen flies over your neighbourhood. Pip asks your
  name, then you pick where you grew up: each choice shows your mum and a live
  3D preview of the home you grow up in. The first mission starts straight away.
- **The world map:** your road through life, in 3D. Missions glow on the road
  outside the place they happen (home, Grandma's house, the park, the
  school), and the university, city and wedding venue wait further down the road. Drag
  or scroll to travel along it. One **Play** button always takes you to the next
  mission; tap any finished mission to replay it.
- **A mission:** a real-time 3D place (the birthday party in your garden,
  Grandma's kitchen, the park, the classroom, the schoolyard) with the people in the story and a 3D Pip. The
  story plays one line at a time in a dialogue box; tap to continue. When it's **your move**, the stage
  makes room for Pip's console below it (on wide screens it sits beside it).
  Pip says what your code printed in a speech bubble, the characters smile,
  laugh or look worried, and feedback slides up in the bottom bar: green when it
  worked, orange with Pip's explanation when it didn't.
- **Rewards:** XP for every solved step (more without hints), player levels,
  1–3 stars per mission, a polaroid **memory** for every mission in the
  album, a badge and the "real names" reveal at the end of each chapter.

## What's in the prototype

| Chapter | Missions | What players learn without being told |
|---|---|---|
| 1. First Words (age 5) | A present for you, Say my name, The pieces of a line, Bug hunt, Guests at the door, Party time | `print`, quote marks, brackets, reading errors, typing a line from memory |
| 2. The Playground (age 6) | Pip's jars, Jar mix-ups, More sweets, Share fairly, Hide and seek, Loop bugs, Skip and clap | variables, `+` and `-`, `//` and `%`, `for` loops, `range`, indentation |
| 3. Primary School (age 8) | The class register, Who's first?, Roll call, A new pupil, Line up by height, Times tables, Report card | lists, `len`, positions from 0, looping over a list, `.append`, `sorted`, `max` and `min`, loops inside loops, `sum` and averages |

Chapters 4–8 (secondary school to the wedding) and the other three stories show
as "Coming soon" on the map; they are not built yet. Missions open one at a time
as you finish the one before; testers can open them all (see below).

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
   results**. It shows time, tries, mistakes, hints and stars for every mission,
   the stories they want next and what they found hardest.
4. Press **Copy results** and paste them into a message to yourself.
5. In Settings, press **Start over for a new player** before handing the device
   to the next tester.
6. To try a later mission without playing through, turn on **Settings → Open
   every mission**. Every built mission can then be played from the map in any
   order. Turn it off again before a real playtest.

What to look for: missions with many mistakes or hints are where the design needs
work. The goal is that a tester can type a `print` line from memory by the end
of Chapter 1, write a small loop by the end of Chapter 2, and work out an
average from a list by the end of Chapter 3.

## The 3D world

Each hometown has its own neighbourhood, built from code when the game starts
(no images or models are downloaded, so it still works offline):

| Hometown | The family home | Around it |
|---|---|---|
| West Africa | A modern villa like the best of Banana Island, Lagos: white volumes, wood slats, floor-to-ceiling glass, a pool, a gated compound | Palms, flame trees and bougainvillea; the lagoon and city towers behind |
| South Asia | A contemporary villa in sandstone and white, with a carved jaali screen, a rooftop chhatri and a lotus pool | Coconut palms, neem and mango trees; the sea and skyline behind |
| Latin America | A Spanish colonial hacienda: clay-tile roofs, an arched arcade, a carved balcony, a stone fountain | Jacarandas in bloom, agaves; mountains all around |
| UK & US | A Georgian brick house: slate roof, chimneys, sash windows, a columned portico, iron railings | Oaks and maples, rolling green hills |

Late-afternoon sunlight with soft shadows, a sky with drifting clouds, palm
fronds and grass moving in the wind, birds, balloons that bob, swings that sway
and a glowing 3D Pip. Phones get a lighter version automatically, and the game
steps down further if a phone struggles. **Settings → 3D world** switches to the
painted 2D look, which is also used if a device can't run WebGL 2.

## How it works

The game is plain HTML, CSS and JavaScript. The 3D world uses three.js, bundled
into the same single file.

| File | What it does |
|---|---|
| `src/python.js` | PyMini, a small Python interpreter for the beginner subset. It reports errors with exactly the same wording as CPython 3.13 and translates code into plain words. |
| `src/content.js` | Storylines, hometown packs (names, food, how each family looks), chapters, missions (place, cast, memory, rounds and checks) and the notebook. Adding a mission means adding data here. |
| `src/art.js` | Lifelike character portraits (shaded skin, hair styles, blinking, five expressions), the 2D Pip, painted places and map for the simple look, and icons. All inline SVG. |
| `src/world/` | The 3D world: renderer, sky, light and colour grade (`index.js`, `sky.js`, `grade.js`); land, trees, palms, grass, water and birds (`nature.js`); the four family homes (`houses.js`); the neighbourhood, park, school and later landmarks (`town.js`); the party (`props.js`); Grandma's kitchen (`kitchen.js`); the classroom (`classroom.js`); the 3D Pip (`pip.js`); every surface painted in code (`textures.js`). |
| `src/game.js` | Title screen, world map, missions (stage, dialogue, Pip's console), the code editor, tiles, running code, reactions, hints, XP and stars, memories, results and the Ask Pip helper. |
| `src/style.css`, `src/page.html` | Look and layout. |
| `build.mjs` | Bundles the 3D world with esbuild, then everything into `dist/lifepy.html` (standalone) and `dist/artifact.html` (for claude.ai). About 1.1 MB. |

Why not run real CPython in the browser (Pyodide)? It is about 10 MB to
download, which is slow on many phones and networks, and the claude.ai page
can't fetch it. PyMini loads instantly and is checked against real Python on
every test run; anything outside the beginner subset is reported as "Pip hasn't
learned that yet" rather than guessed.

## Commands

```bash
npm install --prefix lifepy                    # once: three.js and esbuild for the 3D world
node lifepy/build.mjs                          # build dist/
node --test lifepy/tests/*.test.mjs            # interpreter vs CPython, and every mission's answers
node lifepy/tests/playthrough.mjs [shots-dir]  # plays the whole game in Chromium (2D), tours the 3D world, saves screenshots
```

The tests need `python3` (3.13 for exact error wording) and, for the
playthrough, Playwright with Chromium.

See [DESIGN.md](DESIGN.md) for the full game design: the four storylines,
characters, look and feel, and what to build next.
