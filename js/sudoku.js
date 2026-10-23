/*
 * sudoku.js — grid model, candidate tracking, and a backtracking solver.
 *
 * Representation: a flat array of 81 cells, index = row * 9 + col, with
 * row 0 at the top. 0 means empty, 1-9 are digits.
 *
 * Candidates are held as a bitmask per cell: bit (d-1) set means digit d is
 * still possible. That makes "which digits can go here" a single integer and
 * makes elimination a single AND-NOT, which keeps the technique code readable
 * instead of drowning in array bookkeeping.
 */
(function (global) {
  'use strict';

  var ALL = 0x1FF; // bits 0..8 => digits 1..9

  // Precomputed geometry. Rows, columns and boxes are the 27 "units"; every
  // technique is expressed in terms of units and peers.
  var UNITS = [];
  var UNITS_OF = [];   // UNITS_OF[cell] = [unitIndex, ...] (3 entries)
  var PEERS = [];      // PEERS[cell] = [cell, ...] (20 entries)

  (function buildGeometry() {
    var i, r, c, b;

    for (r = 0; r < 9; r++) {
      var row = [];
      for (c = 0; c < 9; c++) row.push(r * 9 + c);
      UNITS.push(row);
    }
    for (c = 0; c < 9; c++) {
      var col = [];
      for (r = 0; r < 9; r++) col.push(r * 9 + c);
      UNITS.push(col);
    }
    for (b = 0; b < 9; b++) {
      var box = [];
      var br = Math.floor(b / 3) * 3;
      var bc = (b % 3) * 3;
      for (r = 0; r < 3; r++) {
        for (c = 0; c < 3; c++) box.push((br + r) * 9 + bc + c);
      }
      UNITS.push(box);
    }

    for (i = 0; i < 81; i++) {
      UNITS_OF.push([]);
      for (var u = 0; u < UNITS.length; u++) {
        if (UNITS[u].indexOf(i) >= 0) UNITS_OF[i].push(u);
      }
    }

    for (i = 0; i < 81; i++) {
      var peers = {};
      UNITS_OF[i].forEach(function (u) {
        UNITS[u].forEach(function (cell) {
          if (cell !== i) peers[cell] = true;
        });
      });
      PEERS.push(Object.keys(peers).map(Number));
    }
  })();

  function bit(digit) { return 1 << (digit - 1); }

  function digitsOf(mask) {
    var out = [];
    for (var d = 1; d <= 9; d++) if (mask & bit(d)) out.push(d);
    return out;
  }

  function popcount(mask) {
    var n = 0;
    while (mask) { mask &= mask - 1; n++; }
    return n;
  }

  // "R4C3" style names, 1-based, which is how humans describe cells.
  function cellName(index) {
    return 'R' + (Math.floor(index / 9) + 1) + 'C' + (index % 9 + 1);
  }

  function unitName(unitIndex) {
    if (unitIndex < 9) return 'row ' + (unitIndex + 1);
    if (unitIndex < 18) return 'column ' + (unitIndex - 9 + 1);
    return 'box ' + (unitIndex - 18 + 1);
  }

  function unitType(unitIndex) {
    if (unitIndex < 9) return 'row';
    if (unitIndex < 18) return 'column';
    return 'box';
  }

  function parse(text) {
    var clean = String(text).replace(/[^0-9.]/g, '');
    if (clean.length !== 81) {
      throw new Error('Expected 81 cells, got ' + clean.length);
    }
    var grid = new Array(81);
    for (var i = 0; i < 81; i++) {
      var ch = clean[i];
      grid[i] = (ch === '.' || ch === '0') ? 0 : parseInt(ch, 10);
    }
    return grid;
  }

  function format(grid) {
    var out = '';
    for (var i = 0; i < 81; i++) out += grid[i] === 0 ? '.' : String(grid[i]);
    return out;
  }

  function cloneGrid(grid) { return grid.slice(); }

  function isComplete(grid) {
    for (var i = 0; i < 81; i++) if (grid[i] === 0) return false;
    return true;
  }

  // A grid is valid when no unit contains a repeated digit.
  function isValid(grid) {
    for (var u = 0; u < UNITS.length; u++) {
      var seen = 0;
      var unit = UNITS[u];
      for (var k = 0; k < 9; k++) {
        var v = grid[unit[k]];
        if (v === 0) continue;
        var b = bit(v);
        if (seen & b) return false;
        seen |= b;
      }
    }
    return true;
  }

  /*
   * Candidate grid. For an empty cell the mask is every digit not already
   * present in one of its peers. For a filled cell the mask is empty (it is
   * solved, so it has no candidates).
   */
  function candidates(grid) {
    var cand = new Array(81);
    for (var i = 0; i < 81; i++) {
      if (grid[i] !== 0) { cand[i] = 0; continue; }
      var used = 0;
      var peers = PEERS[i];
      for (var p = 0; p < peers.length; p++) {
        var v = grid[peers[p]];
        if (v !== 0) used |= bit(v);
      }
      cand[i] = ALL & ~used;
    }
    return cand;
  }

  // ------------------------------------------------------------ brute solver

  /*
   * Backtracking solver used for two jobs: solving puzzles outright, and
   * counting solutions to prove uniqueness during puzzle generation.
   * `limit` stops counting early, which is all generation needs (it only
   * cares whether the count is 0, 1, or "more than one").
   */
  function countSolutions(grid, limit) {
    limit = limit || 2;
    var work = grid.slice();
    var found = 0;

    // A grid with conflicting givens has no solutions. Checking this first
    // matters: without it the search explores an enormous tree before
    // discovering the contradiction, which looks like a hang.
    if (!isValid(work)) return 0;

    function search() {
      if (found >= limit) return;

      // Most-constrained-cell-first: pick the empty cell with fewest options.
      // Without this the generator is far too slow on hard puzzles.
      var bestCell = -1;
      var bestMask = 0;
      var bestCount = 10;

      for (var i = 0; i < 81; i++) {
        if (work[i] !== 0) continue;
        var used = 0;
        var peers = PEERS[i];
        for (var p = 0; p < peers.length; p++) {
          var v = work[peers[p]];
          if (v !== 0) used |= bit(v);
        }
        var mask = ALL & ~used;
        var count = popcount(mask);
        if (count === 0) return;          // dead end
        if (count < bestCount) {
          bestCount = count;
          bestCell = i;
          bestMask = mask;
          if (count === 1) break;
        }
      }

      if (bestCell === -1) {              // no empty cells: a solution
        found++;
        return;
      }

      var digits = digitsOf(bestMask);
      for (var d = 0; d < digits.length; d++) {
        work[bestCell] = digits[d];
        search();
        work[bestCell] = 0;
        if (found >= limit) return;
      }
    }

    search();
    return found;
  }

  function solve(grid) {
    var work = grid.slice();
    if (!solveInPlace(work)) return null;
    return work;
  }

  function solveInPlace(work) {
    var bestCell = -1;
    var bestMask = 0;
    var bestCount = 10;

    for (var i = 0; i < 81; i++) {
      if (work[i] !== 0) continue;
      var used = 0;
      var peers = PEERS[i];
      for (var p = 0; p < peers.length; p++) {
        var v = work[peers[p]];
        if (v !== 0) used |= bit(v);
      }
      var mask = ALL & ~used;
      var count = popcount(mask);
      if (count === 0) return false;
      if (count < bestCount) {
        bestCount = count;
        bestCell = i;
        bestMask = mask;
        if (count === 1) break;
      }
    }

    if (bestCell === -1) return true;

    var digits = digitsOf(bestMask);
    for (var d = 0; d < digits.length; d++) {
      work[bestCell] = digits[d];
      if (solveInPlace(work)) return true;
      work[bestCell] = 0;
    }
    return false;
  }

  global.Sudoku = {
    ALL: ALL,
    UNITS: UNITS,
    UNITS_OF: UNITS_OF,
    PEERS: PEERS,
    bit: bit,
    digitsOf: digitsOf,
    popcount: popcount,
    cellName: cellName,
    unitName: unitName,
    unitType: unitType,
    parse: parse,
    format: format,
    cloneGrid: cloneGrid,
    isComplete: isComplete,
    isValid: isValid,
    candidates: candidates,
    countSolutions: countSolutions,
    solve: solve
  };
})(typeof window !== 'undefined' ? window : globalThis);
