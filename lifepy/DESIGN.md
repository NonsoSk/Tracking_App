# Life.py design

The game bible: what the game is, why it works the way it does, and how to keep
building it. Anyone adding content (a person or an AI agent) should follow this.

## The promise

- **Day 1:** your first line of Python.
- **Week 1:** your first useful script.
- **Month 3:** you solve real problems from your own field in VS Code.

Players don't "study". They live a life, and Python is how they get things done
in it. Nobody needs to know what Python is when they start.

## Rules every level follows

1. **Nobody types anything they haven't first watched, changed, built and fixed.**
   Each new idea climbs the ladder: watch → change → build → fix → type with
   help → type alone → use it somewhere new.
2. **Problems come before concepts.** A script for one customer breaks when 60
   arrive, so the loop shows up as a superpower, not homework.
3. **Real Python only.** Solutions are plain Python on everyday data (names,
   sweets, guests, prices). Avoid game-only commands like `hero.move()`; those
   skills don't carry over to VS Code.
4. **Mistakes are story, not a red X.** Pip reacts to the mistake (mouth stuck
   open, hands stuck open, dizzy), and the real Python error message appears
   underneath it.
5. **Doing first, naming later.** Jargon ("string", "function", "variable")
   appears only after a chapter, once the player has used the thing many times.
6. **Short and rewarding.** Levels take 2–5 minutes; every success gives points,
   a sound and a visible change in the world.

## The four storylines

All four teach the same Python curriculum in different worlds. Python progress
and the player's Toolbox of functions they have written are shared between
stories.

### 1. Growing Up (built first)

From your 5th birthday to your wedding day. The life stages *are* the
curriculum: a child's problems are simple, an adult's are complex.

| Chapter | Life stage | Moments | Python |
|---|---|---|---|
| 1. First Words | Age 5 | Birthday present, naming Pip, guests at the door | `print`, quotes, brackets, errors |
| 2. The Playground | Age 6 | Sweet jars, sharing fairly, hide-and-seek, skipping | variables, maths, `//` `%`, `for`, `range`, indentation |
| 3. Primary School | Age 8 | Class register, lining up by height, times tables, report card | lists, sorting, averages, nested loops |
| 4. Secondary School | Age 13 | Timetable, class elections, secret coded notes, sports day | dictionaries, counting, strings, functions |
| 5. University | Age 18 | Hostel, monthly budget, group project, choosing a course | files, modules, data; career branches |
| 6. First Job | Age 23 | First salary and rent, automating boring work | classes, errors, real automation |
| 7. Love | Age 27 | Shared interests, meeting the parents, the proposal | sets, dates and times |
| 8. The Wedding | Age 29 | Two guest lists, seating plan, budget | everything: the final project |

Chapter 5 branches by career (medicine, business, engineering, data, the arts)
so people learn Python on problems from their own field.

### 2. The Big City (Lagos first)

Arrive with almost nothing and hustle your way up: rent day, generators, side
hustles, scripts that earn while you sleep. A second-hand laptop from Computer
Village holds half-finished scripts signed "O". Characters: Mama Ngozi (buka
owner), Emeka (laptop dealer), Chief Bankole (landlord), Tunde (best friend with
schemes), Conductor Small, Iya Alajo (savings circle), Aunty Funmi (nurse),
Halima (data analyst), Chidi (rival), Mummy (daily calls), Mallam Sule (suya
seller, secretly "O"). Python focus: automation, small business, freelancing.
City packs after Lagos: Nairobi, Mumbai, Manila, São Paulo, London.

### 3. Grandma's Kitchen

Grandma retires and hands you her struggling restaurant and a recipe book where
every recipe is a Python function. Lunch-rush pressure, collecting recipes,
growing from a roadside stall to a famous restaurant. Python focus: functions,
dictionaries, order queues, profit analysis, classes.

### 4. Case Files

A quiet town with strange records. Weekly mysteries solved by searching phone
logs and receipts. Python focus: data analysis (filtering, sorting, text,
CSV files, pandas, charts).

## Characters in the prototype

- **Pip** — blue robot with a yellow screen face and hands (a nod to Python's
  colours; named after `pip`). Faces: idle, sleep, talk, happy, confused,
  mouth stuck open, hands stuck open, dizzy, covering eyes, jump, clap.
- **Mum, Grandma, an uncle, a cousin, friends** — names, family words and food
  come from the hometown pack.

## Hometown packs

Universal skeleton, local skin. A pack changes names, family words, food,
playground games and skin tones. The Python never changes.

| | West Africa | South Asia | Latin America | UK & US |
|---|---|---|---|---|
| Mum / Grandma | Mummy / Grandma | Amma / Dadi | Mamá / Abuela | Mum / Grandma |
| Party food | jollof rice | biryani | tamales | pizza |
| Playground game | suwe | kho-kho | rayuela | hopscotch |

Next packs: East Africa, East Asia, the Middle East. Partner with local writers.

## Look and feel

- **Everything you press looks like a keyboard key**: thick outline, solid
  bottom edge, presses down. Build tiles are keycaps too.
- **The code area is a laptop tab** (`birthday.py`, `playground.py`). Later
  chapters add VS Code features (tabs, terminal, debugger) until the final
  chapter is VS Code itself.
- **Type:** Baloo 2 for headings, Atkinson Hyperlegible for reading (designed
  for legibility), JetBrains Mono for code.
- **Colour:** Pip blue and sunshine yellow, coral for mistakes, leaf green for
  success, with the same token colours used in the editor and on the tiles.
- **Art grows up with you:** bright, flat, crayon-simple scenes in childhood,
  more detailed later.
- Light and dark themes, works at phone width, respects reduced motion.

## Ask Pip (AI helper)

On claude.ai the page can ask Claude for a hint. Pip's prompt asks for at most two
short sentences in everyday words, one step forward, never the full answer,
and no jargon. Outside claude.ai the button is hidden and the written hints
still work.

## Adding a level

1. Add an entry to `LEVELS` in `src/content.js` and its id to a chapter.
2. Pick the ladder step for each round (`watch`, `change`, `build`, `fix`,
   `guided`, `free`) and write the story lines (`say`), the `task`, and a
   `check(result, x)` that returns `{ ok, msg }`.
3. Give every round `hints` and an answer (`answer`, `fill` or `solution`).
4. Run `node --test lifepy/tests/*.test.mjs`. It plays every round's answer in
   every hometown pack and confirms real Python agrees with PyMini.
5. Run `node lifepy/tests/playthrough.mjs` and look at the screenshots.

## Roadmap

1. **Now:** playtest Chapters 1–2 with 5–10 people who have never coded.
2. **Next 2–3 months:** Chapters 3–4, Toolbox, daily streak quests, the
   remaining storyline pilots (20 minutes each) to see which one players want.
3. **Then:** accounts and cloud saves, more hometown packs, career branches,
   the VS Code graduation (export your Toolbox as a real `.py` project).
