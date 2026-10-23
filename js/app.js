/*
 * app.js — board rendering, input handling, and the hint system.
 *
 * The teaching model here is deliberate: the app never places a digit for you
 * silently. Every hint explains *why* in words and highlights the squares
 * involved, so the reasoning is the thing being learned, not the answer.
 */
(function () {
  'use strict';

  var Sudoku = window.Sudoku;
  var T = window.Techniques;
  var Generator = window.Generator;

  var state = {
    puzzle: null,        // original givens (0 = empty)
    solution: null,      // the unique solution
    grid: null,          // current player grid
    cand: null,          // current candidate masks
    notes: null,         // player pencil marks, array of masks
    selected: -1,
    noteMode: false,
    stepHistory: [],     // applied hint steps, for the explanation list
    history: [],         // snapshots for undo, newest last
    mistakeCount: 0,
    hintsUsed: 0,
    level: 'easy',
    lastHint: null,
    completed: false
  };

  var els = {};
  var cells = [];

  // ------------------------------------------------------------- bootstrap

  function init() {
    els.board = document.getElementById('board');
    els.pad = document.getElementById('pad');
    els.status = document.getElementById('status');
    els.explain = document.getElementById('explain');
    els.stepList = document.getElementById('step-list');
    els.levelSelect = document.getElementById('level-select');
    els.newBtn = document.getElementById('new-btn');
    els.hintBtn = document.getElementById('hint-btn');
    els.checkBtn = document.getElementById('check-btn');
    els.notesBtn = document.getElementById('notes-btn');
    els.undoBtn = document.getElementById('undo-btn');
    els.solveBtn = document.getElementById('solve-btn');
    els.ratingBadge = document.getElementById('rating-badge');
    els.progress = document.getElementById('progress');

    buildBoard();
    buildPad();
    bindControls();
    buildTutorialNav();
    buildTechniqueLibrary();
    newGame();
  }

  function buildBoard() {
    els.board.innerHTML = '';
    cells = [];
    for (var i = 0; i < 81; i++) {
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell';
      cell.dataset.index = String(i);
      cell.dataset.row = String(Math.floor(i / 9));
      cell.dataset.col = String(i % 9);
      cell.setAttribute('aria-label', Sudoku.cellName(i));
      cell.addEventListener('click', onCellClick);
      els.board.appendChild(cell);
      cells.push(cell);
    }
  }

  function buildPad() {
    els.pad.innerHTML = '';
    for (var d = 1; d <= 9; d++) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.digit = String(d);
      btn.innerHTML = d + '<span class="count" id="count-' + d + '"></span>';
      btn.addEventListener('click', function (event) {
        enterDigit(parseInt(event.currentTarget.dataset.digit, 10));
      });
      els.pad.appendChild(btn);
    }
  }

  function bindControls() {
    els.newBtn.addEventListener('click', newGame);
    els.hintBtn.addEventListener('click', requestHint);
    els.checkBtn.addEventListener('click', checkProgress);
    els.notesBtn.addEventListener('click', toggleNotes);
    els.undoBtn.addEventListener('click', undo);
    els.solveBtn.addEventListener('click', revealSolution);
    els.levelSelect.addEventListener('change', function () {
      state.level = els.levelSelect.value;
      newGame();
    });

    document.addEventListener('keydown', function (event) {
      if (event.target.tagName === 'SELECT' || event.target.tagName === 'INPUT') return;

      if (event.key >= '1' && event.key <= '9') {
        enterDigit(parseInt(event.key, 10));
      } else if (event.key === 'Backspace' || event.key === 'Delete' || event.key === '0') {
        enterDigit(0);
      } else if (event.key === 'n' || event.key === 'N') {
        toggleNotes();
      } else if (event.key === 'h' || event.key === 'H') {
        requestHint();
      } else if (event.key === 'ArrowLeft' && state.selected >= 0) {
        moveSelection(-1); event.preventDefault();
      } else if (event.key === 'ArrowRight' && state.selected >= 0) {
        moveSelection(1); event.preventDefault();
      } else if (event.key === 'ArrowUp' && state.selected >= 0) {
        moveSelection(-9); event.preventDefault();
      } else if (event.key === 'ArrowDown' && state.selected >= 0) {
        moveSelection(9); event.preventDefault();
      }
    });
  }

  function moveSelection(delta) {
    var next = state.selected + delta;
    if (next < 0 || next > 80) return;
    // Keep horizontal movement inside the same row.
    if (Math.abs(delta) === 1 && Math.floor(next / 9) !== Math.floor(state.selected / 9)) return;
    state.selected = next;
    render();
    cells[next].focus();
  }

  // -------------------------------------------------------------- new game

  function newGame() {
    state.level = els.levelSelect.value;
    setStatus('Generating a puzzle…');

    // Generation is fast but not instant; defer so the status paints first.
    setTimeout(function () {
      var generated = Generator.generate(state.level);
      if (!generated) {
        setStatus('Could not generate a puzzle. Try another level.', 'error');
        return;
      }

      state.puzzle = generated.puzzle;
      state.solution = generated.solution;
      state.grid = generated.puzzle.slice();
      state.cand = Sudoku.candidates(state.grid);
      state.notes = new Array(81).fill(0);
      state.selected = -1;
      state.stepHistory = [];
      state.history = [];
      state.mistakeCount = 0;
      state.hintsUsed = 0;
      state.lastHint = null;
      state.completed = false;
      state.noteMode = false;
      els.notesBtn.classList.remove('active');

      var r = generated.rating;
      // Report the measured rating, not just the level that was requested.
      // Generation is stochastic: "Hard" is a ceiling of technique 6 and often
      // lands at 4 or 5, so claiming the level was hit would be false.
      els.ratingBadge.textContent = r.hardestTechnique
        ? 'Needs: ' + r.hardestTechnique + ' · level ' + r.maxDifficulty + '/9'
        : 'No techniques needed';
      els.ratingBadge.className = 'badge level';
      els.ratingBadge.title = r.steps + ' logical steps · ' +
        r.clueCount + ' clues · ' + generated.label + ' requested';

      render();
      renderPad();
      renderSteps();
      clearExplanation();
      setStatus('Puzzle ready. Click a square, then type a digit.');
    }, 30);
  }

  // --------------------------------------------------------------- rendering

  function render() {
    var selectedValue = state.selected >= 0 ? state.grid[state.selected] : 0;

    for (var i = 0; i < 81; i++) {
      var cell = cells[i];
      var value = state.grid[i];
      var isGiven = state.puzzle[i] !== 0;

      cell.className = 'cell';
      cell.dataset.row = String(Math.floor(i / 9));
      cell.dataset.col = String(i % 9);

      // Remove previous content.
      cell.textContent = '';

      if (isGiven) {
        cell.classList.add('given');
        cell.textContent = String(value);
      } else if (value !== 0) {
        cell.classList.add('user');
        if (value !== state.solution[i]) cell.classList.add('wrong');
        cell.textContent = String(value);
      } else if (state.notes[i]) {
        // Render pencil marks as a 3x3 mini grid.
        var notesEl = document.createElement('div');
        notesEl.className = 'notes';
        for (var d = 1; d <= 9; d++) {
          var span = document.createElement('span');
          span.textContent = (state.notes[i] & Sudoku.bit(d)) ? String(d) : '';
          notesEl.appendChild(span);
        }
        cell.appendChild(notesEl);
      }

      // Peer highlighting while a cell is selected.
      if (state.selected >= 0 && i !== state.selected) {
        if (Sudoku.PEERS[state.selected].indexOf(i) >= 0) cell.classList.add('peer');
        if (selectedValue !== 0 && state.grid[i] === selectedValue) {
          cell.classList.add('same-digit');
        }
      }

      if (i === state.selected) cell.classList.add('selected');

      // Apply any active hint highlighting.
      if (state.lastHint) {
        applyHintHighlight(cell, i, state.lastHint);
      }

      cell.setAttribute('aria-label',
        Sudoku.cellName(i) + (value ? ': ' + value : ': empty') +
        (isGiven ? ' (given)' : ''));
    }

    renderProgress();
  }

  function applyHintHighlight(cell, index, hint) {
    var step = hint.step;
    var roles = {};
    for (var h = 0; h < step.highlights.length; h++) {
      var hl = step.highlights[h];
      if (hl.cell === index) roles[hl.role] = true;
    }
    if (roles.focus) cell.classList.add('hint-focus');
    if (roles.target) cell.classList.add('hint-target');
    if (roles.unit) cell.classList.add('hint-unit');

    for (var e = 0; e < step.eliminations.length; e++) {
      if (step.eliminations[e].cell === index) cell.classList.add('hint-elim');
    }
    for (var p = 0; p < step.placements.length; p++) {
      if (step.placements[p].cell === index) cell.classList.add('hint-target');
    }
  }

  function renderProgress() {
    var filled = 0;
    for (var i = 0; i < 81; i++) if (state.grid[i] !== 0) filled++;
    els.progress.textContent = filled + ' / 81 filled';
  }

  function renderPad() {
    var counts = {};
    for (var d = 1; d <= 9; d++) counts[d] = 0;
    for (var i = 0; i < 81; i++) {
      if (state.grid[i] !== 0) counts[state.grid[i]]++;
    }

    for (var digit = 1; digit <= 9; digit++) {
      var btn = els.pad.querySelector('[data-digit="' + digit + '"]');
      var countEl = document.getElementById('count-' + digit);
      if (countEl) countEl.textContent = counts[digit] + '/9';
      if (btn) btn.classList.toggle('done', counts[digit] >= 9);
    }
  }

  function renderSteps() {
    if (state.stepHistory.length === 0) {
      els.stepList.innerHTML = '<div class="muted">No hints used yet.</div>';
      return;
    }

    var html = '';
    for (var i = state.stepHistory.length - 1; i >= 0; i--) {
      var step = state.stepHistory[i];
      var summary = step.placements.length
        ? 'Placed ' + step.placements.map(function (p) {
            return p.digit + ' in ' + Sudoku.cellName(p.cell);
          }).join(', ')
        : 'Removed ' + step.eliminations.length + ' candidate' +
          (step.eliminations.length === 1 ? '' : 's');
      html += '<div class="step-item" data-step="' + i + '">' +
        '<div class="step-name">' + step.title + '</div>' +
        '<div class="step-sum">' + summary + '</div>' +
        '</div>';
    }
    els.stepList.innerHTML = html;

    // Clicking a past step re-displays its explanation and highlights.
    Array.prototype.forEach.call(els.stepList.querySelectorAll('.step-item'), function (item) {
      item.addEventListener('click', function () {
        var index = parseInt(item.dataset.step, 10);
        var step = state.stepHistory[index];
        state.lastHint = { step: step };
        showExplanation(step);
        render();
      });
    });
  }

  // ---------------------------------------------------------------- input

  function onCellClick(event) {
    if (state.completed) return;
    var index = parseInt(event.currentTarget.dataset.index, 10);
    state.selected = index;
    state.lastHint = null;
    render();
  }

  function enterDigit(digit) {
    if (state.completed) return;
    if (state.selected < 0) {
      setStatus('Click a square first.', 'warn');
      return;
    }
    var index = state.selected;
    if (state.puzzle[index] !== 0) {
      setStatus('That square is a given clue — it cannot be changed.', 'warn');
      return;
    }

    if (state.noteMode) {
      snapshot(digit === 0 ? 'clearing notes' : 'a pencil mark');
      if (digit === 0) {
        state.notes[index] = 0;
      } else {
        state.notes[index] ^= Sudoku.bit(digit);
      }
      render();
      return;
    }

    if (digit === 0) {
      snapshot('an entry');
      state.grid[index] = 0;
      state.cand = Sudoku.candidates(state.grid);
      render();
      renderPad();
      return;
    }

    // Reject a digit that already exists in the same unit: this is not a
    // "mistake to be scored", it is simply an illegal Sudoku move.
    if (conflicts(state.grid, index, digit)) {
      setStatus('That digit already appears in this row, column or box.', 'warn');
      return;
    }

    snapshot('your entry');
    state.grid[index] = digit;
    state.notes[index] = 0;
    state.cand = Sudoku.candidates(state.grid);

    if (digit !== state.solution[index]) {
      state.mistakeCount++;
      setStatus('Not quite — that digit does not fit here. Press Check for details.', 'error');
    } else {
      setStatus('Correct.');
    }

    render();
    renderPad();
    checkCompletion();
  }

  function conflicts(grid, index, digit) {
    var peers = Sudoku.PEERS[index];
    for (var p = 0; p < peers.length; p++) {
      if (grid[peers[p]] === digit) return true;
    }
    return false;
  }

  function toggleNotes() {
    state.noteMode = !state.noteMode;
    els.notesBtn.classList.toggle('active', state.noteMode);
    setStatus(state.noteMode
      ? 'Pencil-mark mode on: digits toggle candidate marks instead of placing.'
      : 'Pencil-mark mode off.');
  }

  function checkCompletion() {
    for (var i = 0; i < 81; i++) {
      if (state.grid[i] !== state.solution[i]) return false;
    }
    state.completed = true;
    setStatus('Solved! ' + (state.hintsUsed === 0
      ? 'With no hints at all — impressive.'
      : 'You used ' + state.hintsUsed + ' hint' + (state.hintsUsed === 1 ? '' : 's') + '.'), 'win');
    return true;
  }

  function checkProgress() {
    var wrong = [];
    for (var i = 0; i < 81; i++) {
      if (state.grid[i] !== 0 && state.grid[i] !== state.solution[i]) wrong.push(i);
    }
    if (wrong.length === 0) {
      setStatus('Everything you have entered so far is correct.', 'win');
    } else {
      setStatus(wrong.length + ' square' + (wrong.length === 1 ? '' : 's') +
        ' wrong: ' + wrong.map(Sudoku.cellName).join(', '), 'error');
    }
  }

  // ---------------------------------------------------------------- hints

  /*
   * The hint is the core teaching moment. It finds the easiest applicable
   * technique on the *player's* current grid, explains it in words, highlights
   * the squares, and only then offers to apply it. Applying is a separate
   * button press so the explanation is read first.
   */
  function requestHint() {
    if (state.completed) return;

    var cand = Sudoku.candidates(state.grid);
    var step = T.findStep(state.grid, cand);

    if (!step) {
      // Either solved or beyond the suite's reach.
      if (Sudoku.isComplete(state.grid)) {
        checkCompletion();
        return;
      }
      setStatus('No technique in this app applies here. That usually means ' +
        'the puzzle needs a more advanced method than is implemented.', 'warn');
      return;
    }

    state.hintsUsed++;
    state.lastHint = { step: step };
    showExplanation(step);
    render();

    setStatus('Hint: ' + step.title + '. Read the explanation, then apply it if you like.');
  }

  function showExplanation(step) {
    var dots = '';
    for (var i = 1; i <= 9; i++) {
      dots += '<i class="' + (i <= step.difficulty ? 'on' : '') + '"></i>';
    }

    els.explain.innerHTML =
      '<div class="head">' +
        '<span class="badge">' + step.title + '</span>' +
        '<span class="difficulty-dots" title="Difficulty ' + step.difficulty + ' of 9">' +
          dots + '</span>' +
      '</div>' +
      '<div class="body">' + formatExplanation(step.explanation) + '</div>' +
      '<div class="row wrap" style="margin-top:12px;">' +
        '<button class="btn primary" id="apply-hint" type="button">Apply this</button>' +
        '<button class="btn" id="dismiss-hint" type="button">Dismiss</button>' +
      '</div>';

    var applyBtn = document.getElementById('apply-hint');
    if (applyBtn) {
      applyBtn.addEventListener('click', function () { applyHint(step); });
    }
    var dismissBtn = document.getElementById('dismiss-hint');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', function () {
        state.lastHint = null;
        clearExplanation();
        render();
      });
    }
  }

  // Bold the cell names so the explanation is easy to scan.
  function formatExplanation(text) {
    return text
      .replace(/\b(R\dC\d)\b/g, '<strong>$1</strong>')
      .replace(/\b(row \d|column \d|box \d)\b/gi, '<strong>$1</strong>');
  }

  function applyHint(step) {
    snapshot('the hint');
    for (var p = 0; p < step.placements.length; p++) {
      var placement = step.placements[p];
      state.grid[placement.cell] = placement.digit;
      state.notes[placement.cell] = 0;
    }
    // Eliminations affect pencil marks the player has made.
    for (var e = 0; e < step.eliminations.length; e++) {
      var elim = step.eliminations[e];
      for (var d = 0; d < elim.digits.length; d++) {
        state.notes[elim.cell] &= ~Sudoku.bit(elim.digits[d]);
      }
    }

    state.cand = Sudoku.candidates(state.grid);
    state.stepHistory.push(step);
    state.lastHint = null;

    render();
    renderPad();
    renderSteps();
    clearExplanation();
    setStatus('Applied: ' + step.title + '.');

    checkCompletion();
  }

  function clearExplanation() {
    els.explain.innerHTML =
      '<div class="head"><span class="badge level">How it works</span></div>' +
      '<div class="empty">Press <strong>Hint</strong> when you are stuck. ' +
      'The app will find the simplest technique that applies to your current ' +
      'grid and explain the reasoning in plain English — it will not just ' +
      'hand you the answer.</div>';
  }

  function undo() {
    // Undo is snapshot-based: every change pushes the full grid and note state
    // first, so undo always reverses the most recent action whatever kind it
    // was. Tracking "which hint was last applied" was not enough — it ignored
    // typed digits entirely, so Undo could skip over your own entry.
    if (!state.history.length) {
      setStatus('Nothing to undo.', 'warn');
      return;
    }
    var snap = state.history.pop();
    state.grid = snap.grid;
    state.notes = snap.notes;
    state.stepHistory.length = snap.stepCount;
    state.completed = snap.completed;
    state.cand = Sudoku.candidates(state.grid);
    state.lastHint = null;

    render();
    renderPad();
    renderSteps();
    setStatus('Undid ' + snap.label + '.');
  }

  function snapshot(label) {
    state.history.push({
      grid: state.grid.slice(),
      notes: state.notes.slice(),
      stepCount: state.stepHistory.length,
      completed: state.completed,
      label: label
    });
    if (state.history.length > 300) state.history.shift();
  }

  function revealSolution() {
    snapshot('revealing the solution');
    state.grid = state.solution.slice();
    state.cand = Sudoku.candidates(state.grid);
    state.completed = true;
    state.lastHint = null;
    render();
    renderPad();
    setStatus('Solution revealed. Start a new puzzle to try again.', 'warn');
  }

  function setStatus(text, kind) {
    els.status.textContent = text;
    els.status.className = 'status' + (kind ? ' ' + kind : '');
  }

  // -------------------------------------------------------------- tutorial

  var TUTORIAL = [
    {
      id: 'basics',
      label: 'How Sudoku works',
      html:
        '<h2>How Sudoku works</h2>' +
        '<div class="sub">The rules are simpler than they look.</div>' +
        '<p>Fill the 9×9 grid so that every <strong>row</strong>, every ' +
        '<strong>column</strong>, and every <strong>3×3 box</strong> contains ' +
        'the digits 1 to 9, each exactly once. That is the entire rule set.</p>' +
        '<p>The grid starts with some digits already filled in. Those are ' +
        '<strong>givens</strong> — they are always correct and never change. ' +
        'A well-formed puzzle has exactly one solution, so you never have to ' +
        'guess: every square can be deduced from the givens by logic.</p>' +
        '<h4>Rows, columns and boxes are called "units"</h4>' +
        '<p>Each row is a unit, each column is a unit, and each 3×3 box is a ' +
        'unit. There are 27 units in total. Every square belongs to exactly ' +
        'three of them: one row, one column, one box.</p>' +
        '<h4>Peers</h4>' +
        '<p>Two squares that share a unit are called <strong>peers</strong>. ' +
        'Each square has exactly 20 peers — the other 8 in its row, 8 in its ' +
        'column, and 4 remaining in its box. The single most useful fact in ' +
        'Sudoku: <em>a square can never hold the same digit as any of its peers.</em></p>' +
        '<div class="callout">This is why pencil marks matter. For any empty ' +
        'square, the digits it could possibly hold are 1–9 minus everything ' +
        'already visible in its 20 peers. Often that leaves only two or three ' +
        'options.</div>' +
        '<h4>How to use this app</h4>' +
        '<ul>' +
        '<li>Click a square, then type a digit (or click the number pad).</li>' +
        '<li>Press <kbd>N</kbd> to switch to pencil-mark mode and record candidates.</li>' +
        '<li>Press <kbd>H</kbd> or click <strong>Hint</strong> when stuck. The app ' +
        'explains the reasoning rather than just giving the answer.</li>' +
        '<li><strong>Check</strong> tells you which of your entries are wrong, ' +
        'without revealing the right ones.</li>' +
        '</ul>'
    },
    {
      id: 'candidates',
      label: 'Pencil marks',
      html:
        '<h2>Pencil marks</h2>' +
        '<div class="sub">Writing down what a square could be.</div>' +
        '<p>A <strong>candidate</strong> is a digit that could legally go in a ' +
        'square. Every technique in Sudoku works by reasoning about candidates, ' +
        'so writing them down is not a beginner crutch — it is the actual method.</p>' +
        '<h4>How to compute candidates for one square</h4>' +
        '<ol>' +
        '<li>Look along its row and cross out any digits already there.</li>' +
        '<li>Look along its column and cross out any digits already there.</li>' +
        '<li>Look at its 3×3 box and cross out any digits already there.</li>' +
        '<li>Whatever survives is the candidate list.</li>' +
        '</ol>' +
        '<p>In this app, press <kbd>N</kbd> to enter pencil-mark mode, select a ' +
        'square, and press digits to toggle them on and off. The marks show as ' +
        'a small 3×3 grid inside the square.</p>' +
        '<div class="callout warn"><strong>A warning about over-marking.</strong> ' +
        'Beginners often write every candidate in every square, then drown. On a ' +
        'paper puzzle, mark candidates only in squares that have two or three ' +
        'options, or in units you are actively working on. Clutter hides the ' +
        'patterns you are looking for.</div>' +
        '<h4>Why candidates shrink</h4>' +
        '<p>Every time you place a digit, it disappears from the candidates of ' +
        'all 20 of its peers. That cascade is what makes Sudoku solvable: each ' +
        'placement creates new constraints somewhere else.</p>'
    },
    {
      id: 'singles',
      label: 'Singles',
      html:
        '<h2>The two singles</h2>' +
        '<div class="sub">Where almost every puzzle begins.</div>' +
        '<h4>Naked single</h4>' +
        '<p>A square has only <em>one</em> candidate left. That digit must go ' +
        'there — there is nothing else it could be.</p>' +
        '<p><em>Example:</em> a square whose row contains 1,2,3, its column ' +
        'contains 4,5,6, and its box contains 7,8. Only 9 remains, so the square ' +
        'is 9. Obvious once you see it, but you only see it if you compute ' +
        'candidates.</p>' +
        '<h4>Hidden single</h4>' +
        '<p>Within a unit, a digit can only go in <em>one</em> square — even ' +
        'though that square may have several candidates. The digit is "hidden" ' +
        'because the square does not look forced until you check where that ' +
        'particular digit can go.</p>' +
        '<p><em>Example:</em> in row 4, look only at where a 7 could go. If ' +
        'every empty square in that row except one sees a 7 somewhere in its ' +
        'column or box, then that one square must be 7.</p>' +
        '<div class="callout"><strong>Which to look for first?</strong> Scan ' +
        'rows and columns for hidden singles before hunting naked singles — ' +
        'there are 27 units to check, so hidden singles are usually more ' +
        'numerous and easier to spot.</div>' +
        '<p>These two techniques alone solve most easy and medium puzzles. If ' +
        'you are ever stuck on an easy puzzle, you have almost certainly missed ' +
        'a hidden single somewhere.</p>'
    },
    {
      id: 'elimination',
      label: 'Pairs &amp; pointing',
      html:
        '<h2>Elimination techniques</h2>' +
        '<div class="sub">You do not always place a digit — sometimes you remove a candidate.</div>' +
        '<p>From here on, techniques do not fill squares directly. They ' +
        '<strong>eliminate candidates</strong>, which eventually creates a ' +
        'single somewhere else. This is the mental shift that separates ' +
        'beginners from intermediate solvers.</p>' +
        '<h4>Naked pair</h4>' +
        '<p>Two squares in the same unit both have exactly the same two ' +
        'candidates, say 4 and 7. One of them must be 4 and the other must be 7, ' +
        'in some order. Therefore <em>no other square in that unit</em> can be 4 ' +
        'or 7. Remove those candidates from the rest of the unit.</p>' +
        '<h4>Hidden pair</h4>' +
        '<p>The mirror image. Two digits can only be placed in the same two ' +
        'squares within a unit. Those two squares must hold those two digits, so ' +
        'every <em>other</em> candidate in those two squares can be removed. ' +
        'This is powerful because it can strip a square with five candidates ' +
        'down to two.</p>' +
        '<h4>Pointing pair (and triple)</h4>' +
        '<p>Inside a box, if a digit can only go in squares that all lie in one ' +
        'row (or one column), then that digit must be placed in that row within ' +
        'this box. So it cannot appear elsewhere in that row outside the box.</p>' +
        '<p><em>Picture it:</em> in the top-left box, the only places a 6 can go ' +
        'are the two squares in its bottom row. The 6 for this box is on that ' +
        'row — so cross 6 out everywhere else in that row.</p>' +
        '<h4>Box/line reduction</h4>' +
        '<p>The reverse of pointing. If a digit in a <em>row</em> can only go in ' +
        'squares inside one box, then that box must contain the digit on that ' +
        'row, so remove it from the rest of the box.</p>' +
        '<div class="callout">Pointing and box/line reduction are the same idea ' +
        'seen from two directions: a digit confined to the intersection of a ' +
        'line and a box. Learn to check both directions and you will catch far ' +
        'more of them.</div>'
    },
    {
      id: 'advanced',
      label: 'Triples &amp; X-wing',
      html:
        '<h2>Harder patterns</h2>' +
        '<div class="sub">Same logic, more squares.</div>' +
        '<h4>Naked triple</h4>' +
        '<p>Three squares in a unit whose candidates together use exactly three ' +
        'digits. They need not each have three candidates — for example ' +
        '{1,2}, {2,3}, {1,3} counts, as does {1,2,3}, {1,2}, {2,3}. What matters ' +
        'is that the union is three digits across three squares. Those three ' +
        'digits are consumed, so remove them from the rest of the unit.</p>' +
        '<h4>Hidden triple</h4>' +
        '<p>Three digits that can only be placed in the same three squares of a ' +
        'unit. Those squares must hold those digits, so all other candidates in ' +
        'them can go.</p>' +
        '<h4>X-wing</h4>' +
        '<p>This one is worth reading twice. Take a single digit, say 5. Suppose ' +
        'that in row 2 the 5 can only go in two squares, and in row 7 the 5 can ' +
        'also only go in exactly the same two columns. Those four squares form a ' +
        'rectangle.</p>' +
        '<p>Now reason: either the 5s are in the top two corners, or in the ' +
        'bottom two. Either way, <em>both of those two columns</em> get their 5 ' +
        'from one of these four squares. So 5 can be removed from every other ' +
        'square in those two columns.</p>' +
        '<p>The same works with rows and columns swapped: two columns each ' +
        'restricted to the same two rows eliminates the digit from the rest of ' +
        'those rows.</p>' +
        '<div class="callout warn"><strong>Why it is called a wing.</strong> The ' +
        'four squares with their connecting lines look like an X. The name is ' +
        'just a visual mnemonic — the logic above is all there is to it.</div>' +
        '<h4>What this app can and cannot do</h4>' +
        '<p>The nine techniques above are implemented and can be explained. ' +
        'Puzzles needing swordfish, XY-wings, chains or uniqueness arguments are ' +
        'beyond this app, and it will tell you so rather than guessing. That is ' +
        'deliberate: a wrong explanation teaches worse habits than no ' +
        'explanation.</p>'
    },
    {
      id: 'practice',
      label: 'How to practise',
      html:
        '<h2>How to get better</h2>' +
        '<div class="sub">A routine that actually builds skill.</div>' +
        '<h4>1. Work at the right level</h4>' +
        '<p>If you finish a puzzle without ever being stuck, it is too easy to ' +
        'teach you anything. If you guess more than once, it is too hard. The ' +
        'sweet spot is a puzzle where you pause two or three times, think, and ' +
        'then find the deduction yourself.</p>' +
        '<h4>2. Never guess</h4>' +
        '<p>Guessing destroys the feedback loop that makes Sudoku instructive. ' +
        'When you guess and get it wrong, you learn nothing about <em>why</em> ' +
        'you were wrong. When you are stuck, use a hint — but read the ' +
        'explanation and then apply it yourself in the next puzzle.</p>' +
        '<h4>3. Name the technique you used</h4>' +
        '<p>After each deduction, say to yourself which technique it was: ' +
        '"that was a hidden single", "that was a pointing pair". Naming turns ' +
        'a lucky spot into a reusable tool.</p>' +
        '<h4>4. Slow down on eliminations</h4>' +
        '<p>Most errors are not wrong placements — they are over-eager ' +
        'eliminations. Before removing a candidate, re-verify the pattern. ' +
        'A naked pair requires <em>exactly</em> two candidates in each of the ' +
        'two squares, not "about two".</p>' +
        '<h4>5. Use the app honestly</h4>' +
        '<p>The hints are there to teach, not to win. A useful habit: give ' +
        'yourself two minutes of genuine effort before pressing Hint. If you ' +
        'press it immediately every time, you are watching Sudoku rather than ' +
        'learning it.</p>' +
        '<div class="callout">Progress in Sudoku is not measured by finishing ' +
        'faster. It is measured by needing fewer hints, and by recognising ' +
        'patterns you previously had to be shown.</div>'
    }
  ];

  function buildTutorialNav() {
    var nav = document.getElementById('tut-nav');
    var body = document.getElementById('tut-body');
    nav.innerHTML = '';

    TUTORIAL.forEach(function (section, index) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.innerHTML = section.label;
      btn.dataset.index = String(index);
      if (index === 0) btn.classList.add('active');
      btn.addEventListener('click', function () {
        Array.prototype.forEach.call(nav.querySelectorAll('button'), function (b) {
          b.classList.remove('active');
        });
        btn.classList.add('active');
        body.innerHTML = '<div class="tut-card">' + section.html + '</div>';
        body.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      nav.appendChild(btn);
    });

    body.innerHTML = '<div class="tut-card">' + TUTORIAL[0].html + '</div>';
  }

  // ------------------------------------------------------- technique library

  var TECHNIQUE_DOCS = {
    'naked-single': 'A square with only one candidate left. The easiest possible deduction, and the foundation of everything else.',
    'hidden-single': 'A digit that fits in only one square of a unit. Often more numerous than naked singles, so worth scanning for first.',
    'naked-pair': 'Two squares in a unit sharing the same two candidates. Those digits are used up, so remove them from the rest of the unit.',
    'hidden-pair': 'Two digits confined to the same two squares in a unit. Those squares must hold those digits, so strip their other candidates.',
    'pointing-pair': 'A digit in a box confined to one row or column. It must appear there, so remove it from the rest of that line.',
    'box-line-reduction': 'The mirror of pointing: a digit in a line confined to one box eliminates that digit from the rest of the box.',
    'naked-triple': 'Three squares whose combined candidates total exactly three digits. Remove those digits from the rest of the unit.',
    'hidden-triple': 'Three digits confined to the same three squares. Those squares hold only those digits, so their other candidates go.',
    'x-wing': 'A digit restricted to the same two positions across two rows (or columns), forming a rectangle. Eliminates that digit from the rest of the two crossing lines.'
  };

  function buildTechniqueLibrary() {
    var grid = document.getElementById('tech-grid');
    grid.innerHTML = '';

    T.ORDERED.forEach(function (technique) {
      var card = document.createElement('div');
      card.className = 'tech-card';

      var dots = '';
      for (var i = 1; i <= 9; i++) {
        dots += '<i class="' + (i <= technique.difficulty ? 'on' : '') + '"></i>';
      }

      card.innerHTML =
        '<div class="tech-head">' +
          '<h4>' + technique.name + '</h4>' +
          '<span class="difficulty-dots" title="Difficulty ' + technique.difficulty + ' of 9">' +
            dots + '</span>' +
        '</div>' +
        '<div class="body">' + (TECHNIQUE_DOCS[technique.id] || '') + '</div>';

      grid.appendChild(card);
    });
  }

  // ------------------------------------------------------------------ tabs

  function initTabs() {
    var tabs = document.querySelectorAll('.tab');
    Array.prototype.forEach.call(tabs, function (tab) {
      tab.addEventListener('click', function () {
        Array.prototype.forEach.call(tabs, function (t) { t.classList.remove('active'); });
        tab.classList.add('active');

        Array.prototype.forEach.call(document.querySelectorAll('.view'), function (v) {
          v.classList.remove('active');
        });
        var target = document.getElementById('view-' + tab.dataset.view);
        if (target) target.classList.add('active');
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      init();
      initTabs();
    });
  } else {
    init();
    initTabs();
  }
})();
