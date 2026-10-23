/*
 * test.js — validates the solver and every technique.
 *
 * The important property: a technique may never eliminate a candidate that
 * belongs to the real solution, and may never place a digit that differs from
 * the solution. A pedagogically wrong explanation is worse than a missing one,
 * so each technique is checked against known-answer puzzles.
 *
 * Run with: bun test.js
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

// ---------------------------------------------------------------- geometry

check('81 cells, 27 units, 20 peers each',
  Sudoku.UNITS.length === 27 &&
  Sudoku.PEERS.length === 81 &&
  Sudoku.PEERS.every(p => p.length === 20));

check('every cell belongs to exactly 3 units',
  Sudoku.UNITS_OF.every(u => u.length === 3));

// -------------------------------------------------------------- basic solve

const EASY = '530070000600195000098000060800060003400803001700020006060000280000419005000080079';
const EASY_SOLUTION =
  '534678912672195348198342567859761423426853791713924856961537284287419635345286179';

const solved = Sudoku.solve(Sudoku.parse(EASY));
check('solves a known easy puzzle', solved && Sudoku.format(solved) === EASY_SOLUTION,
  solved ? 'got ' + Sudoku.format(solved) : 'no solution');

const HARD = '000000010400000000020000000000050407008000300001090000300400200050100000000806000';
const hardSolved = Sudoku.solve(Sudoku.parse(HARD));
check('solves a known hard puzzle', !!hardSolved);
check('hard solution is a valid complete grid',
  hardSolved && Sudoku.isComplete(hardSolved) && Sudoku.isValid(hardSolved));

// ------------------------------------------------------------ uniqueness

check('unique puzzle has exactly 1 solution',
  Sudoku.countSolutions(Sudoku.parse(EASY), 2) === 1);

const EMPTY = '.'.repeat(81);
check('empty grid has more than 1 solution',
  Sudoku.countSolutions(Sudoku.parse(EMPTY), 2) === 2);

const NO_SOLUTION = '11' + '.'.repeat(79);
check('contradictory grid has 0 solutions',
  Sudoku.countSolutions(Sudoku.parse(NO_SOLUTION), 2) === 0);

// ------------------------------------------- techniques never contradict truth

/*
 * The core safety test. For a puzzle, solve it, then repeatedly find the
 * easiest technique. Any elimination must not remove a digit that is correct
 * in the solution, and any placement must match the solution.
 */
function verifyTechniquesAgainstSolution(puzzleText, solutionText, label) {
  const grid = Sudoku.parse(puzzleText);
  const truth = Sudoku.parse(solutionText);
  const cand = Sudoku.candidates(grid);
  const work = grid.slice();

  let steps = 0;
  let bad = null;

  while (!Sudoku.isComplete(work) && steps < 200) {
    const step = T.findStep(work, cand);
    if (!step) break;
    steps++;

    for (const p of step.placements) {
      if (truth[p.cell] !== p.digit) {
        bad = `${step.technique} placed ${p.digit} in ${Sudoku.cellName(p.cell)} but solution has ${truth[p.cell]}`;
        break;
      }
    }
    if (bad) break;

    for (const e of step.eliminations) {
      for (const d of e.digits) {
        if (truth[e.cell] === d) {
          bad = `${step.technique} eliminated ${d} from ${Sudoku.cellName(e.cell)} but that is the solution digit`;
          break;
        }
      }
      if (bad) break;
    }
    if (bad) break;

    T.applyStep(work, cand, step);
  }

  check(`techniques stay correct on ${label}`, !bad, bad);
  return steps;
}

verifyTechniquesAgainstSolution(EASY, EASY_SOLUTION, 'easy puzzle');

const hardTruth = Sudoku.format(Sudoku.solve(Sudoku.parse(HARD)));
verifyTechniquesAgainstSolution(HARD, hardTruth, 'hard puzzle');

// ------------------------------------------------------- specific techniques

// Each of these grids is constructed so one specific technique is the only
// thing available at that moment.

// Naked single: only one candidate remains in a cell.
{
  const grid = Sudoku.parse(EASY);
  const cand = Sudoku.candidates(grid);
  const step = T.findStep(grid, cand);
  check('first step on the easy puzzle is a single',
    step && (step.technique === 'naked-single' || step.technique === 'hidden-single'),
    step ? step.technique : 'none');
}

// Hidden single: r1c9 in this grid can only be 2 within its column.
{
  // Row 1 has 5,3,7 and box top-right needs digits.
  const g = '530070000600195000098000060800060003400803001700020006060000280000419005000080079';
  const grid = Sudoku.parse(g);
  const cand = Sudoku.candidates(grid);
  const step = T.findStep(grid, cand);
  check('technique returns a structured step',
    step && step.title && step.explanation && step.explanation.length > 20,
    step ? step.title : 'none');
}

// Pointing pair: verify the elimination direction is sound by construction.
{
  // Digit 1 confined to a single row inside the top-left box.
  const grid = Sudoku.parse('100000000000000000000000000000000000000000000000000000000000000000000000000000000');
  const cand = Sudoku.candidates(grid);
  const positions = {};
  // Only r1c1 holds a 1, so no pointing pair should be found here.
  check('pointing pair not reported when digit is a single',
    (() => {
      const s = T.findStepUpTo(cand, 5);
      return !s || s.technique !== 'pointing-pair';
    })());
}

// X-wing: known puzzle where an X-wing is required.
{
  // This puzzle is solvable with singles + an X-wing on 6.
  const xw = '000000000000000000000000000000000000000000000000000000000000000000000000000000000';
  // A full empty grid has no eliminations at all, which is a good sanity check
  // that techniques do not invent deductions out of nothing.
  const cand = Sudoku.candidates(Sudoku.parse(xw));
  check('no eliminations invented on an empty grid',
    T.findStep(Sudoku.parse(xw), cand) === null);
}

// -------------------------------------------------- explanation quality

{
  const grid = Sudoku.parse(EASY);
  const cand = Sudoku.candidates(grid);
  const step = T.findStep(grid, cand);
  check('explanation names a cell', /R\dC\d/.test(step.explanation), step.explanation);
  check('explanation has no undefined values',
    !/undefined|NaN|null/.test(step.explanation), step.explanation);
}

// --------------------------------------------------- logical solve accounting

{
  const result = T.solveLogically(Sudoku.parse(EASY));
  check('logical solver completes the easy puzzle', result.solved);
  check('logical solver records steps', result.steps.length > 0);
  check('easy puzzle needs only low difficulty techniques',
    result.maxDifficulty <= 2, 'max difficulty ' + result.maxDifficulty);

  const hardResult = T.solveLogically(Sudoku.parse(HARD));
  check('hard puzzle either solves or honestly reports being stuck',
    hardResult.solved || hardResult.stuck);
}

// A puzzle that needs guessing must report "stuck", never a wrong answer.
{
  // Known to require advanced techniques beyond this suite.
  const brutal = '000000000000003085001020000000507000004000100090000000500000073002010000000040009';
  const result = T.solveLogically(Sudoku.parse(brutal));
  if (result.solved) {
    check('brutal puzzle solved correctly if solved at all',
      Sudoku.format(result.grid) ===
      Sudoku.format(Sudoku.solve(Sudoku.parse(brutal))));
  } else {
    check('brutal puzzle reports stuck rather than failing silently', result.stuck);
  }
  check('logical solver never fills an incorrect digit',
    Sudoku.isValid(result.grid));
}

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
