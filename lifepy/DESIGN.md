# Life.py design

The game bible: what the game is, why it works the way it does, and how to keep
building it. Anyone adding content (a person or an AI agent) should follow this.

## The promise

- **Day 1:** your first line of Python.
- **Week 1:** your first useful script.
- **Month 3:** you solve real problems from your own field in VS Code.

Players don't "study". They live a life, and Python is how they get things done
in it. Nobody needs to know what Python is when they start.

## Rules every lesson follows

1. **One thing at a time.** Each screen has one job and one main button at the
   bottom. Story screens and task screens are separate. Feedback appears in the
   bottom bar, never as a pop-up.
2. **Nobody types anything they haven't first seen, predicted and built.**
   Each new idea climbs the ladder: explain → watch → "what will Pip show?" →
   "which one works?" → change → build → fix → type with help → type alone.
3. **Problems come before concepts.** A script for one customer breaks when 60
   arrive, so the loop shows up as a superpower, not homework.
4. **Real Python only.** Solutions are plain Python on everyday data (names,
   sweets, guests, prices). Avoid game-only commands like `hero.move()`; those
   skills don't carry over to VS Code.
5. **Mistakes are explained, not punished.** A short plain title ("A quote mark
   is missing"), one sentence on how to fix it, and the real Python error message
   underneath. Wrong multiple-choice answers say why they're wrong.
6. **Doing first, naming later.** Jargon ("string", "function", "variable")
   appears only after a chapter, once the player has used the thing many times.
7. **Short and calm.** Lessons take 3–5 minutes and keep sentences short. Code
   inside sentences is always shown in code font.

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

- **Pip** — a small blue screen with a yellow face (a nod to Python's colours;
  named after `pip`). Faces: idle, asleep, happy, oops, confused.
- **Mum, Grandma, an uncle, a cousin, friends** — they appear as their initial in
  a soft colour, speaking in chat bubbles. Names, family words and food come from
  the hometown pack.

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

Calm and grown-up, not cartoonish. Playtesters found the first version (busy
illustrated scenes, thick outlines, many panels at once) hard to follow.

- **One column**, lots of space, one main button at the bottom.
- **Type:** Lexend for everything you read (designed to make reading easier),
  JetBrains Mono for code.
- **Colour:** a soft grey-green background, one blue accent for actions, green
  for success, orange for mistakes and hints. The code area is dark, like a real
  editor, with a file name (`birthday.py`, `playground.py`). Later chapters add
  VS Code features until the final chapter is VS Code itself.
- **Pictures:** simple line icons on story screens instead of illustrated scenes.
- Light and dark themes, works at phone width, respects reduced motion.

## Ask Pip (AI helper)

On claude.ai, "Ask Pip" (inside a hint) can ask Claude a question. Pip's prompt asks for at most two
short sentences in everyday words, one step forward, never the full answer,
and no jargon. Outside claude.ai the button is hidden and the written hints
still work.

## Adding a level

1. Add an entry to `LEVELS` in `src/content.js` and its id to a chapter.
2. Pick the ladder step for each round (`explain`, `watch`, `predict`, `choice`,
   `change`, `build`, `fix`, `guided`, `free`). Write at most two story lines
   (`say`), a short `task`, and for typing steps a `check(result, x)` that
   returns `{ ok, msg }`. Put code inside sentences between backticks.
3. Give every typing round `hints` and an answer (`answer`, `fill` or
   `solution`); give every wrong multiple-choice option a `why`.
4. Run `node --test lifepy/tests/*.test.mjs`. It plays every round's answer in
   every hometown pack, checks that each "what will Pip show?" answer matches
   real Python, and confirms real Python agrees with PyMini.
5. Run `node lifepy/tests/playthrough.mjs` and look at the screenshots.

## Roadmap

1. **Now:** playtest Chapters 1–2 with 5–10 people who have never coded.
2. **Next 2–3 months:** Chapters 3–4, Toolbox, daily streak quests, the
   remaining storyline pilots (20 minutes each) to see which one players want.
3. **Then:** accounts and cloud saves, more hometown packs, career branches,
   the VS Code graduation (export your Toolbox as a real `.py` project).
