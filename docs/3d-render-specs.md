# 3D render spec sheets (Blender)

The portal uses seven 3D objects. Until each render exists, the page shows a labelled grey placeholder of the
same size; it is never faked with CSS. When a render is ready, save it in `static/img/3d/` with the file name
below and it replaces every placeholder for that object automatically (no code change). In production, run
`collectstatic` (or rebuild the Docker image) after adding files.

## Rules for every object

| | |
|---|---|
| Look | Photoreal product shot. Calm, premium, industrial. Never cartoon, never toy-like, no outlines. |
| Background | Transparent (alpha). No floor, no backdrop. The page adds a soft drop shadow. |
| Light | Large soft key from top-left (about 45°), gentle fill from the right, thin rim light from behind so edges read on the blue hero and on dark mode. Light falls from above, like the cards. |
| Camera | 50–85 mm, three-quarter view from slightly above (15–25° down). Object centred, 8–10% empty margin all round. |
| Colour | Brand blue `#0033A1`, deep blue `#00257A`, sky `#1E9BE9` only as a reflection, gold `#B0700E` only on the offer-accepted object. No red. |
| Surfaces | Real roughness and bevels (0.5–2 mm), subtle micro-scratches, no plastic shine. |
| Output | WebP with alpha (PNG accepted), sRGB, at 2× the largest size shown. Under 250 KB each. |
| Check | Must read on both the white page and the dark navy page (`#0B1224`), and on the blue hero for the first two. |

## The seven objects

| # | Object | File name | Where it appears | Shown at (largest) | Export at |
|---|---|---|---|---|---|
| 1 | White HDPE hard hat with Indorama decal | `white-hdpe-hard-hat-with-indorama-decal.webp` | Careers hero, My tasks hero, careers empty state, 404 | 280 × 200 | 1120 × 800 |
| 2 | Polycarbonate safety goggles | `polycarbonate-safety-goggles.webp` | Sign-in page | 260 × 180 | 1040 × 720 |
| 3 | Staff ID badge on a navy lanyard | `staff-id-badge-on-a-navy-lanyard.webp` | Onboarding (no new joiners) | 200 × 240 | 800 × 960 |
| 4 | Leather portfolio, offer letter, gold pen | `leather-portfolio-offer-letter-gold-pen.webp` | Offer accepted (reserved) | 280 × 200 | 1120 × 800 |
| 5 | Lab beaker of polymer pellets | `lab-beaker-of-polymer-pellets.webp` | Most empty states: talent, CV intake, notifications, staff, pipeline | 200 × 150 | 800 × 600 |
| 6 | Brushed steel valve wheel | `brushed-steel-valve-wheel.webp` | Requisitions (none yet), 403 no access | 220 × 220 | 880 × 880 |
| 7 | Tablet with an interview calendar | `tablet-with-an-interview-calendar.webp` | Interviews (none scheduled), requisition interviews tab | 280 × 200 | 1120 × 800 |

### 1. White HDPE hard hat with Indorama decal
- Model: standard cap-style safety helmet with a front brim and a ratchet suspension visible underneath at an angle.
- Material: white HDPE, slightly satin (roughness about 0.35), very faint mould texture. Moulded ridges on the crown.
- Decal: the Indorama logo exactly as supplied, as a flat printed decal on the front. Do not recolour, redraw,
  crop or stretch it. Keep it upright and fully legible.
- Pose: three-quarter front view, brim towards the camera-left, resting on nothing (floating, shadow added by the page).

### 2. Polycarbonate safety goggles
- Model: indirect-vent goggles with a wraparound clear lens and a woven navy strap (`#00257A`).
- Material: lens clear polycarbonate with a faint blue edge tint and real refraction; frame soft matte grey TPE.
- Pose: lens facing three-quarter left, strap loosely curved behind. Keep reflections soft, no hard hotspots.

### 3. Staff ID badge on a navy lanyard
- Model: rigid card holder with a plain badge (photo area as a soft grey block, two grey text bars; no real names
  or faces), navy lanyard (`#00257A`) with a small metal clip.
- Pose: badge upright, slight turn to the left, lanyard falling in a gentle curve above it (portrait framing).

### 4. Leather portfolio, offer letter, gold pen
- Model: open dark navy leather portfolio, a single sheet of paper with grey text lines (no readable text), a gold
  fountain pen lying diagonally across it.
- Material: leather with fine grain; gold `#B0700E` brushed metal on the pen only. This is the one place gold appears,
  so it feels like a success moment.

### 5. Lab beaker of polymer pellets
- Model: 250 ml borosilicate glass beaker with white graduation marks, two-thirds full of small white and pale blue
  polymer/fertiliser pellets.
- Material: clear glass with realistic thickness and refraction; pellets matte with slight variation in size.

### 6. Brushed steel valve wheel
- Model: round industrial gate-valve handwheel with four spokes and a short stem, no pipe.
- Material: brushed stainless steel (anisotropic highlights), small worn edges. Optional thin navy paint ring on the rim.
- Pose: three-quarter view so the depth of the rim and spokes reads clearly (square framing).

### 7. Tablet with an interview calendar
- Model: slim tablet in landscape, dark bezel, on a subtle angle; screen shows a simple week calendar in the portal's
  blues (white background, three blue event blocks, no readable text).
- Material: matte aluminium back edge, glass screen with a soft reflection from the key light.

## Hand-off checklist
- [ ] Seven files with the exact names above in `static/img/3d/`.
- [ ] Transparent backgrounds, sRGB, 2× size, under 250 KB each.
- [ ] Checked on white, on `#0B1224` and (objects 1 and 2) on the blue hero.
- [ ] Logo on the hard hat exactly as supplied.
