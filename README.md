# Sudoku Technique Teacher

A Sudoku trainer that explains **why**, not just **what**.

Most Sudoku apps hand you the answer. This one finds the simplest human
technique that applies to your current grid, explains the deduction in plain
English, highlights the squares involved, and only *then* offers to place the
digit. Difficulty is rated by which techniques a puzzle actually forces you to
use — not by how few clues it has.

Runs entirely in your browser. No accounts, no tracking, no dependencies,
no build step.

## Run it

Open `index.html` in a browser. That is the whole install.

Or serve it locally:

```bash
python3 -m http.server 8000
```

Then visit **http://127.0.0.1:8000**

## What it teaches

Nine techniques, ordered easiest to hardest. The engine applies them
cheapest-first, which is both how humans solve and how a puzzle gets rated.

| # | Technique | What it does |
|---|-----------|--------------|
| 1 | Naked single | One candidate left in a square |
| 2 | Hidden single | A digit fits in only one square of a unit |
| 3 | Naked pair | Two squares share the same two candidates |
| 4 | Hidden pair | Two digits confined to the same two squares |
| 5 | Pointing pair/triple | A digit in a box confined to one line |
| 6 | Box/line reduction | A digit on a line confined to one box |
| 7 | Naked triple | Three squares holding exactly three digits |
| 8 | Hidden triple | Three digits confined to three squares |
| 9 | X-wing | A digit restricted to a rectangle across two lines |

A puzzle's difficulty is the hardest technique in its solution path. A 24-clue
puzzle needing only singles is easier than a 30-clue puzzle needing an X-wing,
and the app tells you the difference.

## Why the difficulty levels look modest

The levels were **measured, not chosen**. Sampling 120 fully-carved puzzles and
rating each one showed what this technique suite can actually reach:

- Most puzzles land at difficulty 2 (hidden single).
- A tail reaches 6 (box/line reduction).
- Nothing reached 7–9, and roughly 39% of fully-carved puzzles are not solvable
  by these nine techniques at all.

So the top level is **Hard (up to difficulty 6)** and there is no "Expert". A
level that silently returns an easy puzzle would be a lie, and puzzles that
need techniques this app cannot explain would teach nothing.

Generation is stochastic: each level is a *ceiling*, and the app reports the
real measured rating on each puzzle rather than claiming the level was hit.
Over 20 runs per level:

| Level | Target | Observed | Exact hit | Unique | Solvable |
|-------|--------|----------|-----------|--------|----------|
| Beginner | 1 | 20× diff 1 | 20/20 | 20/20 | 20/20 |
| Easy | 2 | 20× diff 2 | 20/20 | 20/20 | 20/20 |
| Medium | 4 | 17× diff 4, 3× diff 3 | 17/20 | 20/20 | 20/20 |
| Hard | 6 | 10× diff 6, 5× diff 5, 5× diff 4 | 10/20 | 20/20 | 20/20 |

No puzzle ever exceeded its level's ceiling. Every puzzle has exactly one
solution, verified by the solver.

## How the hint system works

When you press **Hint**, the app:

1. Computes candidates for your current grid (not the original puzzle), so you
   get help with the position you are actually looking at.
2. Finds the easiest technique that applies *right now*.
3. Explains the reasoning, naming real cells (`R4C3`) and units.
4. Highlights the squares involved, and marks candidates it would eliminate.
5. Waits for you to press **Apply this** — it never fills in a digit silently.

If no implemented technique applies, it says so. It does not guess.

## Controls

| Key | Action |
|-----|--------|
| `1`–`9` | Enter a digit |
| `0` / `Backspace` | Clear the square |
| `N` | Toggle pencil-mark mode |
| `H` | Hint |
| Arrows | Move the selection |

Click any square first, then type. Undo reverses your last change, whatever it
was — a typed digit, a pencil mark, an applied hint, or a reveal.

## Tests

The explanations are only trustworthy if the logic is verified, so the
technique engine is tested harder than the UI.

```bash
bun test.js              # solver, geometry, uniqueness, soundness
bun technique-tests.js   # every technique fires and stays correct
bun mobile-check.js      # real device layout via DevTools emulation
```

What they check:

- **`test.js`** — 27 units, 20 peers each, correct parsing, solution of known
  puzzles, uniqueness counting, contradiction handling, and the critical
  property: **no technique may ever eliminate a candidate that belongs to the
  real solution.**
- **`technique-tests.js`** — all 9 techniques fire on purpose-built puzzles
  (a broken one would otherwise pass silently: an X-wing scoping bug did
  exactly that until this test was written), plus an exhaustive check that
  every elimination across many puzzles matches the unique solution.
- **`mobile-check.js`** — drives headless Chrome through the DevTools Protocol
  to emulate real viewports (320px to 1280px), because Chrome's layout viewport
  floors around 485px from the command line. Checks for horizontal overflow,
  square board, cells inside the board box, legible fonts, finger-sized
  controls, and clipped panels.

All three suites pass.

## Files

```
index.html            Markup and element IDs the app binds to
css/style.css         Dark theme, responsive layout
js/sudoku.js          Grid model, geometry, candidates, solver, uniqueness
js/techniques.js      The 9 techniques, each returning a self-describing step
js/generator.js       Puzzle generation and difficulty rating
js/app.js             Board rendering, input, hint flow, tutorial content
test.js               Core engine tests
technique-tests.js    Per-technique firing and soundness tests
mobile-check.js       Responsive layout verification
```

## A note on the design

Each technique returns a structured *step* object — technique, title,
difficulty, placements, eliminations, highlights, and the explanation prose —
rather than mutating candidates directly. The UI renders that object. This
means the explanation and the logic cannot drift apart: if the detector changes
what it does, the step it returns changes with it.
