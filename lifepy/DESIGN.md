# Life.py design

The game bible: what the game is, why it works the way it does, and how to keep
building it. Anyone adding content (a person or an AI agent) should follow this.

## The promise

- **Day 1:** your first line of Python.
- **Week 1:** your first useful script.
- **Month 3:** you solve real problems from your own field in VS Code.

Players don't "study". They live a life, and Python is how they get things done
in it. Nobody needs to know what Python is when they start.

## Rules every mission follows

1. **It's a game, not a quiz.** Every lesson is a mission in a place, with
   people who talk, react and remember. Tasks are "your move" in the story, and
   finishing one earns XP, stars and a memory for the album.
2. **One thing at a time.** Each step has one job (a story line, an explanation
   or one task) and one main button at the bottom. Feedback appears in the
   bottom bar, never as a pop-up.
3. **Nobody types anything they haven't first seen, predicted and built.**
   Each new idea climbs the ladder: explain → watch → "what will Pip show?" →
   "which one works?" → change → build → fix → type with help → type alone.
4. **Problems come before concepts.** A script for one customer breaks when 60
   arrive, so the loop shows up as a superpower, not homework.
5. **Real Python only.** Solutions are plain Python on everyday data (names,
   sweets, guests, prices). Avoid game-only commands like `hero.move()`; those
   skills don't carry over to VS Code.
6. **Mistakes are explained, not punished.** A short plain title ("A quote mark
   is missing"), one sentence on how to fix it, and the real Python error message
   underneath. Wrong multiple-choice answers say why they're wrong.
7. **Doing first, naming later.** Jargon ("string", "function", "variable")
   appears only after a chapter, once the player has used the thing many times.
8. **Short and calm.** Lessons take 3–5 minutes and keep sentences short. Code
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

- **Pip** — a small, glossy blue robot with a glowing yellow face screen (a nod
  to Python's colours; named after `pip`), modelled in 3D. It floats over a soft
  glow, talks while it prints, spins and waves when you succeed and wobbles when
  it gets stuck. Faces: idle, asleep, talking, happy, oops, confused.
- **Mum, Grandma, an uncle, a cousin and three friends** — shaded, near-real
  portraits drawn from a small description (age, skin tone, hair style and
  colour, eye colour, clothes, glasses, beard, earrings, face shape). They
  breathe, blink, look towards Pip, and switch between five expressions:
  neutral, smiling, laughing, surprised and worried. Each hometown pack has its
  own family: in West Africa, Mummy wears a gele and Uncle Tunde has a beard; in
  the UK & US pack one friend has red curls and another has short coily hair.
  Families are mixed on purpose: the world is mixed.

## Hometown packs

Universal skeleton, local skin. A pack changes names, family words, food,
playground games and how the family looks. The Python never changes.

| | West Africa | South Asia | Latin America | UK & US |
|---|---|---|---|---|
| Mum / Grandma | Mummy / Grandma | Amma / Dadi | Mamá / Abuela | Mum / Grandma |
| Party food | jollof rice | biryani | tamales | pizza |
| Playground game | suwe | kho-kho | rayuela | hopscotch |

Next packs: East Africa, East Asia, the Middle East. Partner with local writers.

## Look and feel

A beautiful world the player wants to be in, that never competes with the lesson.

- History: the first version (busy cartoon scenes, many panels at once) was too
  much for beginners; the second (one calm column) was easy but felt like a
  question-and-answer session; the third put it inside a game with painted
  scenes. This version makes the world real-time 3D.
- **Every hometown is the best of its region.** The family home is modelled on
  the finest homes there: a Banana Island villa with a pool (West Africa), a
  contemporary villa with a jaali screen and rooftop chhatri (South Asia), a
  colonial hacienda under jacarandas (Latin America), a Georgian brick house
  (UK & US). Grandma lives next door in a classic bungalow; the park is across
  the road; the school, university, city and wedding venue lie further along it.
- **Light sells it.** Late-afternoon sun with long, soft shadows; a deep blue
  sky with moving clouds; reflections in glass, pools and Pip's shell; a soft
  glow on fairy lights and Pip's face; a gentle film grade and vignette.
- **Everything breathes, slowly:** fronds and grass in the wind, birds circling,
  balloons bobbing, swings swaying, dust in the kitchen sunbeam. The camera
  drifts like a hand-held film camera and glides between shots.
- **Places** in the missions: the birthday party in your garden, Grandma's
  kitchen with its shelves of sweet jars, the playground in the park.
- **Characters** are semi-realistic portraits in front of the 3D world, like a
  visual novel, so their faces stay expressive and readable on a phone. Only the people in the current moment are on stage (one or
  two plus Pip), and the speaker steps forward while the others dim slightly.
- **Interface:** a frosted-glass dialogue box with the speaker's name, a small
  mission bar at the top (map button, progress, XP), and one main button at the
  bottom. On wide screens the stage stays on the left and Pip's console sits on
  the right.
- **Type:** Lexend for everything you read (designed to make reading easier),
  JetBrains Mono for code.
- **Colour:** warm, muted places; one blue accent for actions, gold for XP and
  stars, green for success, orange for mistakes and hints. The code area is
  dark, like a real editor, with a file name (`birthday.py`, `playground.py`).
  Later chapters add VS Code features until the final chapter is VS Code itself.
- **Performance:** phones get fewer grass blades, smaller shadow maps and fewer
  pixels; if frames still drop, the game lowers resolution, then turns off
  glow, then shadows. Settings has a switch for the painted 2D look, which is
  also the automatic fallback without WebGL 2.
- Light and dark themes, works at phone width, respects reduced motion (no
  blinking, floating or sparkles; the camera holds still).

## Rewards

- **XP:** 15 for each solved step, 10 if you used a hint. Every 100 XP is a new
  player level.
- **Stars:** 3 for a clean mission (no hints and at most one mistake), 2 for
  a few mistakes or one or two hints, 1 otherwise. The best result is kept.
- **Memories:** each mission adds a polaroid of its moment ("Your 5th birthday.
  Pip woke up and said its first word.") to the album.
- **Chapters** end with a badge and the reveal of the real programming names.

## Ask Pip (AI helper)

On claude.ai, "Ask Pip" (inside a hint) can ask Claude a question. Pip's prompt asks for at most two
short sentences in everyday words, one step forward, never the full answer,
and no jargon. Outside claude.ai the button is hidden and the written hints
still work.

## Adding a level

1. Add an entry to `LEVELS` in `src/content.js` and its id to a chapter. Give
   it a `scene` (`home`, `kitchen`, `park`), a `cast` of one or two people
   (`mum`, `grandma`, `uncle`, `cousin`, `f1`–`f3`) and a `memory` caption. A
   round can set its own `cast` when someone new arrives.
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
