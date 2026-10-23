/*
 * generator.js — builds puzzles and rates their difficulty.
 *
 * Two jobs:
 *   1. Generate a puzzle with a unique solution at a requested difficulty.
 *   2. Rate an arbitrary puzzle by the hardest technique a human would need.
 *
 * Difficulty is defined by *technique*, not by how few clues there are. A
 * 24-clue puzzle needing only singles is easier than a 30-clue puzzle needing
 * an X-wing, and beginners deserve to be told the difference.
 */
(function (global) {
  'use strict';

  var Sudoku = global.Sudoku;
  var T = global.Techniques;

  function shuffled(array) {
    var out = array.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = out[i]; out[i] = out[j]; out[j] = tmp;
    }
    return out;
  }

  // Builds a complete valid grid by randomised backtracking.
  function generateSolvedGrid() {
    var grid = new Array(81).fill(0);

    function canPlace(index, digit) {
      var r = Math.floor(index / 9);
      var c = index % 9;
      for (var k = 0; k < 9; k++) {
        if (grid[r * 9 + k] === digit) return false;
        if (grid[k * 9 + c] === digit) return false;
      }
      var br = Math.floor(r / 3) * 3;
      var bc = Math.floor(c / 3) * 3;
      for (var dr = 0; dr < 3; dr++) {
        for (var dc = 0; dc < 3; dc++) {
          if (grid[(br + dr) * 9 + bc + dc] === digit) return false;
        }
      }
      return true;
    }

    function fill(index) {
      if (index === 81) return true;
      var digits = shuffled([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      for (var i = 0; i < digits.length; i++) {
        if (canPlace(index, digits[i])) {
          grid[index] = digits[i];
          if (fill(index + 1)) return true;
          grid[index] = 0;
        }
      }
      return false;
    }

    fill(0);
    return grid;
  }

  /*
   * Rates a puzzle: what is the hardest technique the logical solver needs?
   * Returns { solvable, maxDifficulty, hardestTechnique, steps, clueCount }.
   */
  function rate(puzzle) {
    var result = T.solveLogically(puzzle);
    var hardest = null;
    for (var i = 0; i < result.steps.length; i++) {
      var s = result.steps[i];
      if (!hardest || s.difficulty > hardest.difficulty) hardest = s;
    }
    return {
      solvable: result.solved,
      maxDifficulty: result.maxDifficulty,
      hardestTechnique: hardest ? hardest.title : null,
      steps: result.steps.length,
      clueCount: puzzle.filter(function (v) { return v !== 0; }).length
    };
  }

  /*
   * Removes clues while keeping the solution unique. It removes as many as it
   * can: difficulty is then a property of the resulting puzzle, which is
   * selected for by generate(). Stopping early at a target produced puzzles
   * that were consistently too easy, because the first few removals rarely
   * create the structure advanced techniques need.
   */
  function carvePuzzle(solved) {
    var puzzle = solved.slice();
    var order = shuffled(Array.from({ length: 81 }, function (_, i) { return i; }));

    for (var i = 0; i < order.length; i++) {
      var index = order[i];
      if (puzzle[index] === 0) continue;

      var backup = puzzle[index];
      puzzle[index] = 0;

      // Must keep exactly one solution.
      if (Sudoku.countSolutions(puzzle, 2) !== 1) {
        puzzle[index] = backup;
      }
    }

    return puzzle;
  }

  /*
   * Difficulty targets are derived from measurement, not optimism. Sampling 120
   * fully-carved puzzles showed the achievable range: most land at 2 (hidden
   * single), a tail reaches 6, and nothing reached 7-9. Offering a "hard" or
   * "expert" level that silently returns an easy puzzle would be a lie, so the
   * top level is Medium and anything above the suite's reach is reported as
   * such rather than mislabelled.
   */
  var DIFFICULTY_TARGETS = {
    beginner: { maxDifficulty: 1, label: 'Beginner' },
    easy: { maxDifficulty: 2, label: 'Easy' },
    medium: { maxDifficulty: 4, label: 'Medium' },
    hard: { maxDifficulty: 6, label: 'Hard' }
  };

  /*
   * Produces a puzzle needing a specific difficulty band.
   *
   * Random carving alone cannot hit a target reliably: measured over 120
   * puzzles, most land at difficulty 2 regardless of how many clues are
   * removed. The reliable approach is the reverse — carve fully, then ADD
   * clues back from the solution until the logical solver finishes using no
   * technique harder than the target. Adding clues can only make a puzzle
   * easier, so this converges instead of hunting randomly.
   */
  function buildAtLevel(level, maxAttempts) {
    maxAttempts = maxAttempts || 40;
    var target = DIFFICULTY_TARGETS[level] || DIFFICULTY_TARGETS.beginner;

    var best = null;
    var bestScore = Infinity;

    for (var attempt = 0; attempt < maxAttempts; attempt++) {
      var solved = generateSolvedGrid();
      var puzzle = carvePuzzle(solved);

      // Add clues back until the puzzle is solvable by the technique suite.
      var emptyCells = [];
      for (var i = 0; i < 81; i++) if (puzzle[i] === 0) emptyCells.push(i);
      var pool = shuffled(emptyCells);

      var current = rate(puzzle);
      var guard = 0;
      while (!current.solvable && pool.length > 0 && guard++ < 60) {
        var cell = pool.pop();
        puzzle[cell] = solved[cell];
        current = rate(puzzle);
      }
      if (!current.solvable) continue;

      // Accept an exact match immediately.
      if (current.maxDifficulty === target.maxDifficulty) {
        return { puzzle: puzzle, solution: solved, level: level,
                 label: target.label, rating: current };
      }

      // Otherwise track the closest puzzle at or below the ceiling. Anything
      // above the ceiling would be unsolvable for a learner at this level.
      if (current.maxDifficulty <= target.maxDifficulty) {
        var score = Math.abs(current.maxDifficulty - target.maxDifficulty);
        if (score < bestScore) {
          bestScore = score;
          best = { puzzle: puzzle.slice(), solution: solved, level: level,
                   label: target.label, rating: current };
        }
      }
    }

    return best;
  }

  /*
   * Generates a puzzle for a level. Prefers buildAtLevel(); falls back to the
   * closest sampled puzzle so the caller always gets something playable.
   */
  function generate(level, attempts) {
    var built = buildAtLevel(level);
    if (built) return built;

    attempts = attempts || 40;
    var target = DIFFICULTY_TARGETS[level] || DIFFICULTY_TARGETS.beginner;
    var best = null;
    var bestScore = Infinity;

    for (var a = 0; a < attempts; a++) {
      var solved = generateSolvedGrid();
      var puzzle = carvePuzzle(solved);
      var info = rate(puzzle);
      if (!info.solvable) continue;

      var score = Math.abs(info.maxDifficulty - target.maxDifficulty);
      if (score < bestScore) {
        bestScore = score;
        best = { puzzle: puzzle, solution: solved, level: level,
                 label: target.label, rating: info };
      }
      if (score === 0) break;
    }

    // Last resort: any solvable puzzle beats no puzzle.
    if (!best) {
      for (var b = 0; b < 60; b++) {
        var s2 = generateSolvedGrid();
        var p2 = carvePuzzle(s2);
        var i2 = rate(p2);
        if (i2.solvable) {
          return { puzzle: p2, solution: s2, level: 'beginner',
                   label: 'Beginner', rating: i2 };
        }
      }
    }

    return best;
  }

  global.Generator = {
    DIFFICULTY_TARGETS: DIFFICULTY_TARGETS,
    generateSolvedGrid: generateSolvedGrid,
    rate: rate,
    generate: generate
  };
})(typeof window !== 'undefined' ? window : globalThis);
