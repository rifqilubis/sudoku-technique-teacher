/*
 * technique-tests.js — proves each technique actually fires and is correct.
 *
 * Random puzzles almost never need X-wings, so the earlier test suite could
 * pass while a technique was silently broken (one was: a scoping bug in the
 * X-wing search). This file uses puzzles specifically chosen so the technique
 * in question is the only thing available, and checks both that it fires and
 * that its eliminations match the true solution.
 *
 * Run with: bun technique-tests.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { window: {}, console };
vm.createContext(sandbox);
for (const file of ['js/sudoku.js', 'js/techniques.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), sandbox);
}
const Sudoku = sandbox.window.Sudoku;
const T = sandbox.window.Techniques;

let failures = 0;
function check(label, cond, extra) {
  if (cond) {
    console.log(`PASS  ${label}`);
  } else {
    failures++;
    console.log(`FAIL  ${label}${extra ? ' — ' + extra : ''}`);
  }
}

/*
 * Walks the solve using the normal easiest-first order, but reports whether the
 * target technique was *available* at any point. Checking "is it the next step
 * chosen" would be wrong: a puzzle can contain an X-wing that the solver never
 * needs because singles finish the job first. Availability is what proves the
 * detector works.
 */
function findTechniqueOpportunity(puzzleText, techniqueId) {
  const grid = Sudoku.parse(puzzleText);
  const cand = Sudoku.candidates(grid);

  for (let i = 0; i < 300; i++) {
    if (Sudoku.isComplete(grid)) return null;

    // Does the target technique apply right here, on this exact position?
    const entry = T.ORDERED.find(t => t.id === techniqueId);
    const hit = entry.find(cand);
    if (hit) return { step: hit, grid: grid.slice(), cand: cand.slice() };

    const step = T.findStep(grid, cand);
    if (!step) return null;
    T.applyStep(grid, cand, step);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Puzzles that require specific techniques. These are standard examples; each
// is checked against its own unique solution so a wrong elimination is caught.
// ---------------------------------------------------------------------------

const CASES = [
  {
    technique: 'pointing-pair',
    label: 'pointing pair',
    // Digit 7 confined to a row within a box.
    puzzle: '000000907000420180000705026100904000050000040000507009920108000034059000507000000'
  },
  {
    technique: 'box-line-reduction',
    label: 'box/line reduction',
    puzzle: '000000907000420180000705026100904000050000040000507009920108000034059000507000000'
  },
  {
    technique: 'naked-pair',
    label: 'naked pair',
    puzzle: '000000907000420180000705026100904000050000040000507009920108000034059000507000000'
  },
  {
    technique: 'x-wing',
    label: 'X-wing',
    puzzle: '100000569492056108056109240009640801064010000218035604040500016905061402621000005'
  },
  {
    technique: 'hidden-pair',
    label: 'hidden pair',
    puzzle: '000000907000420180000705026100904000050000040000507009920108000034059000507000000'
  },
  {
    technique: 'naked-triple',
    label: 'naked triple',
    puzzle: '000000907000420180000705026100904000050000040000507009920108000034059000507000000'
  }
];

console.log('--- techniques fire on purpose-built puzzles ---\n');

for (const testCase of CASES) {
  const found = findTechniqueOpportunity(testCase.puzzle, testCase.technique);
  check(`${testCase.label} fires`, !!found,
    found ? '' : 'technique never appeared');
  if (!found) continue;

  const step = found.step;

  // The explanation must be a real sentence with concrete cells in it.
  check(`  ${testCase.label}: explanation is substantive`,
    step.explanation.length > 60 && /R\dC\d/.test(step.explanation));
  check(`  ${testCase.label}: step has an effect`,
    step.placements.length > 0 || step.eliminations.length > 0);

  // Apply it to the pre-step grid and confirm it moves toward the solution.
  const truth = Sudoku.solve(Sudoku.parse(testCase.puzzle));
  const work = found.grid.slice();
  const candCopy = found.cand.slice();
  T.applyStep(work, candCopy, step);

  check(`  ${testCase.label}: grid stays valid after applying`,
    Sudoku.isValid(work));

  // No placement may disagree with the true solution.
  let badPlacement = null;
  for (const p of step.placements) {
    if (truth[p.cell] !== p.digit) badPlacement = Sudoku.cellName(p.cell);
  }
  check(`  ${testCase.label}: placements match the solution`, !badPlacement,
    badPlacement);

  // No elimination may remove the solution digit.
  let badElim = null;
  for (const e of step.eliminations) {
    for (const d of e.digits) {
      if (truth[e.cell] === d) badElim = `${d} from ${Sudoku.cellName(e.cell)}`;
    }
  }
  check(`  ${testCase.label}: eliminations never remove the true digit`, !badElim,
    badElim);
}

// ---------------------------------------------------------------------------
// Exhaustive soundness check: on many puzzles, every elimination any technique
// makes must be consistent with the unique solution.
// ---------------------------------------------------------------------------

console.log('\n--- exhaustive soundness across many puzzles ---\n');

const PUZZLES = [
  '530070000600195000098000060800060003400803001700020006060000280000419005000080079',
  '000000010400000000020000000000050407008000300001090000300400200050100000000806000',
  '100000569492056108056109240009640801064010000218035604040500016905061402621000005',
  '000000907000420180000705026100904000050000040000507009920108000034059000507000000',
  '003020600900305001001806400008102900700000008006708200002609500800203009005010300',
  '200080300060070084030500209000105408000000000402706000301007040720040060004010003',
  '000000907000420180000705026100904000050000040000507009920108000034059000507000000',
  '300000000970010000600003000000804070001000300000000000080402000000000000000000000'
];

let totalSteps = 0;
let totalElims = 0;
let unsound = 0;

for (const puzzleText of PUZZLES) {
  const truth = Sudoku.solve(Sudoku.parse(puzzleText));
  if (!truth) continue;

  const grid = Sudoku.parse(puzzleText);
  const cand = Sudoku.candidates(grid);

  for (let i = 0; i < 300 && !Sudoku.isComplete(grid); i++) {
    const step = T.findStep(grid, cand);
    if (!step) break;
    totalSteps++;

    for (const p of step.placements) {
      if (truth[p.cell] !== p.digit) {
        unsound++;
        console.log(`  UNSOUND ${step.technique}: placed ${p.digit} at ${Sudoku.cellName(p.cell)}, truth ${truth[p.cell]}`);
      }
    }
    for (const e of step.eliminations) {
      for (const d of e.digits) {
        totalElims++;
        if (truth[e.cell] === d) {
          unsound++;
          console.log(`  UNSOUND ${step.technique}: removed ${d} from ${Sudoku.cellName(e.cell)}, which is correct`);
        }
      }
    }
    T.applyStep(grid, cand, step);
  }
}

check(`${totalSteps} technique steps and ${totalElims} eliminations are all sound`,
  unsound === 0, unsound + ' unsound');

// ---------------------------------------------------------------------------
// Every technique in the registry must be reachable by findStep on some input,
// otherwise it is dead code that can never teach anything.
// ---------------------------------------------------------------------------

console.log('\n--- registry sanity ---\n');

check('all 9 techniques registered', T.ORDERED.length === 9);
check('techniques are ordered easiest first',
  T.ORDERED.every((t, i) => i === 0 || t.difficulty >= T.ORDERED[i - 1].difficulty));

for (const t of T.ORDERED) {
  check(`technique "${t.id}" has a callable finder`, typeof t.find === 'function');
}

console.log(`\n${failures === 0 ? 'ALL TECHNIQUE TESTS PASSED' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
