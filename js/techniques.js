/*
 * techniques.js — human solving techniques, each returning an explanation.
 *
 * The design rule for this file: a technique does not just mutate candidates,
 * it returns a structured *step* describing what it found, which cells it
 * touches, and why the deduction is valid. The UI renders that, so the
 * explanation and the logic can never drift apart.
 *
 * A step looks like:
 *   {
 *     technique: 'naked-single',
 *     title: 'Naked single',
 *     difficulty: 1,
 *     placements: [{ cell, digit }],       // digits to write in
 *     eliminations: [{ cell, digits }],    // candidates to remove
 *     highlights: [{ cell, role }],        // for drawing (role: focus/target/unit)
 *     unit: unitIndex | null,
 *     explanation: 'plain-English reasoning'
 *   }
 *
 * Techniques are ordered by difficulty and applied cheapest-first, which is
 * both how humans solve and how puzzle difficulty gets rated.
 */
(function (global) {
  'use strict';

  var Sudoku = global.Sudoku;
  var UNITS = Sudoku.UNITS;
  var UNITS_OF = Sudoku.UNITS_OF;
  var PEERS = Sudoku.PEERS;
  var bit = Sudoku.bit;
  var digitsOf = Sudoku.digitsOf;
  var popcount = Sudoku.popcount;
  var cellName = Sudoku.cellName;
  var unitName = Sudoku.unitName;

  function listNames(cells) {
    return cells.map(cellName).join(', ');
  }

  function digitList(digits) {
    return digits.slice().sort(function (a, b) { return a - b; }).join(', ');
  }

  // Where the digits of `unit` can still go: { digit: [cells] }.
  function digitPositions(cand, unitIndex) {
    var positions = {};
    for (var d = 1; d <= 9; d++) positions[d] = [];
    var unit = UNITS[unitIndex];
    for (var k = 0; k < 9; k++) {
      var cell = unit[k];
      var mask = cand[cell];
      for (var d2 = 1; d2 <= 9; d2++) {
        if (mask & bit(d2)) positions[d2].push(cell);
      }
    }
    return positions;
  }

  // --------------------------------------------------------------- 1. singles

  function nakedSingle(cand) {
    for (var cell = 0; cell < 81; cell++) {
      var mask = cand[cell];
      if (mask !== 0 && popcount(mask) === 1) {
        var digit = digitsOf(mask)[0];
        return {
          technique: 'naked-single',
          title: 'Naked single',
          difficulty: 1,
          placements: [{ cell: cell, digit: digit }],
          eliminations: [],
          highlights: [{ cell: cell, role: 'focus' }],
          unit: null,
          explanation:
            cellName(cell) + ' can only be ' + digit + '. Every other digit ' +
            'already appears in its row, column or box, so ' + digit + ' is the ' +
            'only value left for that square.'
        };
      }
    }
    return null;
  }

  function hiddenSingle(cand) {
    for (var u = 0; u < UNITS.length; u++) {
      var positions = digitPositions(cand, u);
      for (var d = 1; d <= 9; d++) {
        if (positions[d].length === 1) {
          var cell = positions[d][0];
          // A cell with a single candidate is a naked single; reporting it as
          // hidden would be technically true but pedagogically confusing.
          if (popcount(cand[cell]) === 1) continue;
          return {
            technique: 'hidden-single',
            title: 'Hidden single',
            difficulty: 2,
            placements: [{ cell: cell, digit: d }],
            eliminations: [],
            highlights: [
              { cell: cell, role: 'focus' },
              { cell: cell, role: 'unit' }
            ],
            unit: u,
            explanation:
              'In ' + unitName(u) + ', the digit ' + d + ' can only go in ' +
              cellName(cell) + '. Every other square in that unit already sees a ' +
              d + ', so ' + cellName(cell) + ' must be ' + d + ' even though it still ' +
              'has other candidates.'
          };
        }
      }
    }
    return null;
  }

  // ----------------------------------------------------------- 2. elimination

  function nakedPair(cand) {
    for (var u = 0; u < UNITS.length; u++) {
      var unit = UNITS[u];
      // Collect empty cells with exactly two candidates, grouped by mask.
      var pairs = {};
      for (var k = 0; k < 9; k++) {
        var cell = unit[k];
        var mask = cand[cell];
        if (mask === 0 || popcount(mask) !== 2) continue;
        (pairs[mask] = pairs[mask] || []).push(cell);
      }

      for (var key in pairs) {
        var cells = pairs[key];
        if (cells.length !== 2) continue;
        var digits = digitsOf(parseInt(key, 10));

        // Both digits must be removable from elsewhere in the unit.
        var affected = [];
        for (var j = 0; j < 9; j++) {
          var other = unit[j];
          if (other === cells[0] || other === cells[1]) continue;
          var extra = cand[other] & parseInt(key, 10);
          if (extra) affected.push({ cell: other, digits: digitsOf(extra) });
        }
        if (affected.length === 0) continue;

        var removed = affected.map(function (a) {
          return digitList(a.digits) + ' from ' + cellName(a.cell);
        }).join(', ');

        return {
          technique: 'naked-pair',
          title: 'Naked pair',
          difficulty: 3,
          placements: [],
          eliminations: affected,
          highlights: [
            { cell: cells[0], role: 'focus' },
            { cell: cells[1], role: 'focus' }
          ],
          unit: u,
          explanation:
            cellName(cells[0]) + ' and ' + cellName(cells[1]) + ' in ' +
            unitName(u) + ' contain only the digits ' + digitList(digits) + '. ' +
            'One of them must be ' + digits[0] + ' and the other must be ' +
            digits[1] + ', so no other square in this unit can be either digit. ' +
            'Removes ' + removed + '.'
        };
      }
    }
    return null;
  }

  function hiddenPair(cand) {
    for (var u = 0; u < UNITS.length; u++) {
      var positions = digitPositions(cand, u);
      // Digits that can only appear in exactly two squares.
      var candidates = [];
      for (var d = 1; d <= 9; d++) {
        if (positions[d].length === 2) candidates.push(d);
      }

      for (var i = 0; i < candidates.length; i++) {
        for (var j = i + 1; j < candidates.length; j++) {
          var a = candidates[i];
          var b = candidates[j];
          var same =
            positions[a][0] === positions[b][0] &&
            positions[a][1] === positions[b][1];
          if (!same) continue;

          var c1 = positions[a][0];
          var c2 = positions[a][1];
          var keep = bit(a) | bit(b);
          var extra1 = cand[c1] & ~keep;
          var extra2 = cand[c2] & ~keep;
          if (!extra1 && !extra2) continue;

          var affected = [];
          if (extra1) affected.push({ cell: c1, digits: digitsOf(extra1) });
          if (extra2) affected.push({ cell: c2, digits: digitsOf(extra2) });

          return {
            technique: 'hidden-pair',
            title: 'Hidden pair',
            difficulty: 4,
            placements: [],
            eliminations: affected,
            highlights: [
              { cell: c1, role: 'focus' },
              { cell: c2, role: 'focus' }
            ],
            unit: u,
            explanation:
              'In ' + unitName(u) + ', the digits ' + a + ' and ' + b +
              ' can only be placed in ' + cellName(c1) + ' and ' + cellName(c2) +
              '. Those two squares must hold ' + a + ' and ' + b + ' in some order, ' +
              'so every other candidate in them can be removed: ' +
              affected.map(function (x) {
                return digitList(x.digits) + ' from ' + cellName(x.cell);
              }).join(', ') + '.'
          };
        }
      }
    }
    return null;
  }

  function pointingPair(cand) {
    // A digit in a box confined to one row/column eliminates it from that line.
    for (var b = 18; b < 27; b++) {
      var positions = digitPositions(cand, b);
      for (var d = 1; d <= 9; d++) {
        var cells = positions[d];
        if (cells.length < 2) continue;

        var rows = cells.map(function (c) { return Math.floor(c / 9); });
        var cols = cells.map(function (c) { return c % 9; });

        if (rows.every(function (r) { return r === rows[0]; })) {
          var unitIndex = rows[0];       // row unit
          var affected = eliminateFromUnit(cand, unitIndex, d, cells);
          if (affected.length) {
            return pointingStep(b, d, cells, unitIndex, affected, 'row',
              rows[0] + 1);
          }
        }
        if (cols.every(function (c) { return c === cols[0]; })) {
          var colUnit = 9 + cols[0];
          var affectedCol = eliminateFromUnit(cand, colUnit, d, cells);
          if (affectedCol.length) {
            return pointingStep(b, d, cells, colUnit, affectedCol, 'column',
              cols[0] + 1);
          }
        }
      }
    }
    return null;
  }

  function eliminateFromUnit(cand, unitIndex, digit, exclude) {
    var unit = UNITS[unitIndex];
    var out = [];
    for (var k = 0; k < 9; k++) {
      var cell = unit[k];
      if (exclude.indexOf(cell) >= 0) continue;
      if (cand[cell] & bit(digit)) out.push({ cell: cell, digits: [digit] });
    }
    return out;
  }

  function pointingStep(boxIndex, digit, cells, lineUnit, affected, lineType, lineNumber) {
    return {
      technique: 'pointing-pair',
      title: 'Pointing ' + (cells.length === 2 ? 'pair' : 'triple'),
      difficulty: 5,
      placements: [],
      eliminations: affected,
      highlights: cells.map(function (c) { return { cell: c, role: 'focus' }; }),
      unit: boxIndex,
      explanation:
        'In ' + unitName(boxIndex) + ', the digit ' + digit + ' can only go in ' +
        listNames(cells) + '. Those squares all lie in ' + lineType + ' ' +
        lineNumber + ', so ' + digit + ' must appear somewhere on that ' + lineType +
        ' inside this box. That rules out ' + digit + ' from the rest of ' + lineType +
        ' ' + lineNumber + ': ' +
        affected.map(function (a) { return cellName(a.cell); }).join(', ') + '.'
    };
  }

  function boxLineReduction(cand) {
    // The mirror of pointing: a digit in a row/column confined to one box
    // eliminates it from the rest of that box.
    for (var u = 0; u < 18; u++) {
      var positions = digitPositions(cand, u);
      for (var d = 1; d <= 9; d++) {
        var cells = positions[d];
        if (cells.length < 2) continue;

        var boxes = cells.map(boxOf);
        if (!boxes.every(function (b) { return b === boxes[0]; })) continue;

        var boxUnit = 18 + boxes[0];
        var affected = eliminateFromUnit(cand, boxUnit, d, cells);
        if (!affected.length) continue;

        return {
          technique: 'box-line-reduction',
          title: 'Box/line reduction',
          difficulty: 6,
          placements: [],
          eliminations: affected,
          highlights: cells.map(function (c) { return { cell: c, role: 'focus' }; }),
          unit: u,
          explanation:
            'In ' + unitName(u) + ', the digit ' + d + ' can only go in ' +
            listNames(cells) + ', and all of those squares sit inside ' +
            unitName(boxUnit) + '. So ' + d + ' must be placed in that box on this ' +
            'line, which removes ' + d + ' from the rest of the box: ' +
            affected.map(function (a) { return cellName(a.cell); }).join(', ') + '.'
        };
      }
    }
    return null;
  }

  function boxOf(cell) {
    var r = Math.floor(cell / 9);
    var c = cell % 9;
    return Math.floor(r / 3) * 3 + Math.floor(c / 3);
  }

  // ------------------------------------------------------------- 3. advanced

  function nakedTriple(cand) {
    for (var u = 0; u < UNITS.length; u++) {
      var unit = UNITS[u];
      var cells = [];
      for (var k = 0; k < 9; k++) {
        var cell = unit[k];
        var mask = cand[cell];
        if (mask !== 0 && popcount(mask) >= 2 && popcount(mask) <= 3) {
          cells.push(cell);
        }
      }

      // Try every combination of three cells whose union is exactly 3 digits.
      for (var i = 0; i < cells.length; i++) {
        for (var j = i + 1; j < cells.length; j++) {
          for (var l = j + 1; l < cells.length; l++) {
            var union = cand[cells[i]] | cand[cells[j]] | cand[cells[l]];
            if (popcount(union) !== 3) continue;

            var trio = [cells[i], cells[j], cells[l]];
            var affected = [];
            for (var m = 0; m < 9; m++) {
              var other = unit[m];
              if (trio.indexOf(other) >= 0) continue;
              var extra = cand[other] & union;
              if (extra) affected.push({ cell: other, digits: digitsOf(extra) });
            }
            if (!affected.length) continue;

            return {
              technique: 'naked-triple',
              title: 'Naked triple',
              difficulty: 7,
              placements: [],
              eliminations: affected,
              highlights: trio.map(function (c) { return { cell: c, role: 'focus' }; }),
              unit: u,
              explanation:
                'In ' + unitName(u) + ', the three squares ' + listNames(trio) +
                ' between them can only contain the digits ' + digitList(digitsOf(union)) +
                '. Three squares holding exactly three digits means those digits are ' +
                'used up, so they can be removed from the rest of the unit: ' +
                affected.map(function (a) {
                  return digitList(a.digits) + ' from ' + cellName(a.cell);
                }).join(', ') + '.'
            };
          }
        }
      }
    }
    return null;
  }

  function hiddenTriple(cand) {
    for (var u = 0; u < UNITS.length; u++) {
      var positions = digitPositions(cand, u);
      // Consider digits restricted to at most three squares.
      var restricted = [];
      for (var d = 1; d <= 9; d++) {
        if (positions[d].length >= 2 && positions[d].length <= 3) restricted.push(d);
      }

      for (var i = 0; i < restricted.length; i++) {
        for (var j = i + 1; j < restricted.length; j++) {
          for (var l = j + 1; l < restricted.length; l++) {
            var trio = [restricted[i], restricted[j], restricted[l]];
            var cellSet = {};
            trio.forEach(function (d2) {
              positions[d2].forEach(function (c) { cellSet[c] = true; });
            });
            var cells = Object.keys(cellSet).map(Number);
            if (cells.length !== 3) continue;

            var keep = trio.reduce(function (acc, d3) { return acc | bit(d3); }, 0);
            var affected = [];
            cells.forEach(function (c) {
              var extra = cand[c] & ~keep;
              if (extra) affected.push({ cell: c, digits: digitsOf(extra) });
            });
            if (!affected.length) continue;

            return {
              technique: 'hidden-triple',
              title: 'Hidden triple',
              difficulty: 8,
              placements: [],
              eliminations: affected,
              highlights: cells.map(function (c) { return { cell: c, role: 'focus' }; }),
              unit: u,
              explanation:
                'In ' + unitName(u) + ', the digits ' + digitList(trio) +
                ' can only be placed in ' + listNames(cells) + '. Those three squares ' +
                'must therefore hold exactly those three digits, so their other ' +
                'candidates can go: ' +
                affected.map(function (a) {
                  return digitList(a.digits) + ' from ' + cellName(a.cell);
                }).join(', ') + '.'
            };
          }
        }
      }
    }
    return null;
  }

  function xWing(cand) {
    // For each digit, look for two rows where the digit has exactly two
    // positions in the same two columns (or the column/row mirror image).
    for (var d = 1; d <= 9; d++) {
      var byRow = [];
      var byCol = [];
      for (var r = 0; r < 9; r++) byRow.push([]);
      for (var c = 0; c < 9; c++) byCol.push([]);

      for (var cell = 0; cell < 81; cell++) {
        if (!(cand[cell] & bit(d))) continue;
        byRow[Math.floor(cell / 9)].push(cell);
        byCol[cell % 9].push(cell);
      }

      var rowResult = findXWing(cand, byRow, d, 'row');
      if (rowResult) return rowResult;
      var colResult = findXWing(cand, byCol, d, 'column');
      if (colResult) return colResult;
    }
    return null;
  }

  function findXWing(cand, lines, digit, orientation) {
    var pairs = [];
    for (var i = 0; i < 9; i++) {
      if (lines[i].length === 2) {
        var cross = lines[i].map(function (cell) {
          return orientation === 'row' ? cell % 9 : Math.floor(cell / 9);
        }).sort(function (a, b) { return a - b; });
        pairs.push({ line: i, cross: cross, cells: lines[i] });
      }
    }

    for (var a = 0; a < pairs.length; a++) {
      for (var b = a + 1; b < pairs.length; b++) {
        if (pairs[a].cross[0] !== pairs[b].cross[0]) continue;
        if (pairs[a].cross[1] !== pairs[b].cross[1]) continue;

        // The two "cross" lines are now fully claimed for this digit.
        var affected = [];
        for (var k = 0; k < 2; k++) {
          var crossLine = pairs[a].cross[k];
          for (var t = 0; t < 9; t++) {
            var cell = orientation === 'row' ? t * 9 + crossLine : crossLine * 9 + t;
            if (cand[cell] & bit(digit)) {
              // Skip the four corners of the rectangle.
              var isCorner = pairs[a].cells.indexOf(cell) >= 0 ||
                             pairs[b].cells.indexOf(cell) >= 0;
              if (!isCorner) affected.push({ cell: cell, digits: [digit] });
            }
          }
        }
        if (!affected.length) continue;

        var corners = pairs[a].cells.concat(pairs[b].cells);
        var lineType = orientation === 'row' ? 'row' : 'column';
        var crossType = orientation === 'row' ? 'column' : 'row';

        return {
          technique: 'x-wing',
          title: 'X-wing',
          difficulty: 9,
          placements: [],
          eliminations: affected,
          highlights: corners.map(function (c) { return { cell: c, role: 'focus' }; }),
          unit: null,
          explanation:
            'Look at the digit ' + digit + '. In ' + lineType + ' ' + (pairs[a].line + 1) +
            ' it can only go in two places, and in ' + lineType + ' ' +
            (pairs[b].line + 1) + ' it can only go in the same two ' + crossType +
            's (' + (pairs[a].cross[0] + 1) + ' and ' + (pairs[a].cross[1] + 1) + '). ' +
            'That forms a rectangle. Whichever way the ' + digit + 's are placed, ' +
            'both of those ' + crossType + 's get their ' + digit + ' from these four ' +
            'corners, so ' + digit + ' can be removed from the rest of those ' +
            crossType + 's: ' +
            affected.map(function (x) { return cellName(x.cell); }).join(', ') + '.'
        };
      }
    }
    return null;
  }

  // ----------------------------------------------------------------- registry

  // Ordered cheapest-first. The solver applies them in this order, which is
  // also what makes the difficulty rating meaningful.
  var ORDERED = [
    { id: 'naked-single', name: 'Naked single', difficulty: 1, find: nakedSingle },
    { id: 'hidden-single', name: 'Hidden single', difficulty: 2, find: hiddenSingle },
    { id: 'naked-pair', name: 'Naked pair', difficulty: 3, find: nakedPair },
    { id: 'hidden-pair', name: 'Hidden pair', difficulty: 4, find: hiddenPair },
    { id: 'pointing-pair', name: 'Pointing pair/triple', difficulty: 5, find: pointingPair },
    { id: 'box-line-reduction', name: 'Box/line reduction', difficulty: 6, find: boxLineReduction },
    { id: 'naked-triple', name: 'Naked triple', difficulty: 7, find: nakedTriple },
    { id: 'hidden-triple', name: 'Hidden triple', difficulty: 8, find: hiddenTriple },
    { id: 'x-wing', name: 'X-wing', difficulty: 9, find: xWing }
  ];

  function applyStep(grid, cand, step) {
    step.placements.forEach(function (p) {
      grid[p.cell] = p.digit;
      cand[p.cell] = 0;
      // Placing a digit removes it from all peers.
      PEERS[p.cell].forEach(function (peer) {
        if (cand[peer]) cand[peer] &= ~bit(p.digit);
      });
    });
    step.eliminations.forEach(function (e) {
      e.digits.forEach(function (d) {
        cand[e.cell] &= ~bit(d);
      });
    });
  }

  // Finds the easiest applicable step, or null if none apply.
  function findStep(grid, cand) {
    for (var i = 0; i < ORDERED.length; i++) {
      var step = ORDERED[i].find(cand);
      if (step) return step;
    }
    return null;
  }

  /*
   * Solves as far as human techniques allow, recording every step.
   * Returns { solved, stuck, steps, grid, candidates, maxDifficulty }.
   * "stuck" means no technique applied but the grid is not finished, which is
   * the honest signal that a puzzle is harder than the implemented suite.
   */
  function solveLogically(puzzle) {
    var grid = puzzle.slice();
    var cand = Sudoku.candidates(grid);
    var steps = [];
    var maxDifficulty = 0;
    var guard = 0;

    while (!Sudoku.isComplete(grid)) {
      if (++guard > 400) break;   // safety against a technique loop
      var step = findStep(grid, cand);
      if (!step) {
        return {
          solved: false,
          stuck: true,
          steps: steps,
          grid: grid,
          candidates: cand,
          maxDifficulty: maxDifficulty
        };
      }
      applyStep(grid, cand, step);
      steps.push(step);
      if (step.difficulty > maxDifficulty) maxDifficulty = step.difficulty;
    }

    return {
      solved: Sudoku.isComplete(grid),
      stuck: false,
      steps: steps,
      grid: grid,
      candidates: cand,
      maxDifficulty: maxDifficulty
    };
  }

  // Only the techniques up to a given difficulty, used to rate puzzles and to
  // let the UI reveal one technique at a time.
  function findStepUpTo(cand, maxDifficulty) {
    for (var i = 0; i < ORDERED.length; i++) {
      if (ORDERED[i].difficulty > maxDifficulty) break;
      var step = ORDERED[i].find(cand);
      if (step) return step;
    }
    return null;
  }

  global.Techniques = {
    ORDERED: ORDERED,
    findStep: findStep,
    findStepUpTo: findStepUpTo,
    applyStep: applyStep,
    solveLogically: solveLogically
  };
})(typeof window !== 'undefined' ? window : globalThis);
