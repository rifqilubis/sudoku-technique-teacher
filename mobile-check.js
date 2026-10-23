/*
 * mobile-check.js — verifies real phone layout via the DevTools Protocol.
 *
 * Chrome headless floors its layout viewport around 485px, so --window-size
 * cannot emulate a 360px phone. Emulation.setDeviceMetricsOverride can, which
 * is the only honest way to check that the board does not overflow on a small
 * screen.
 *
 * Run: bun mobile-check.js
 */
const { spawn } = require('child_process');
const path = require('path');

const PORT = 9333;
const PAGE = 'file://' + path.resolve(__dirname, 'index.html');

const chrome = spawn('google-chrome', [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=/tmp/mobile-check-profile',
  'about:blank'
], { stdio: ['ignore', 'ignore', 'ignore'] });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJSON(url) {
  const res = await fetch(url);
  return res.json();
}

async function waitForDevtools() {
  for (let i = 0; i < 100; i++) {
    try {
      const v = await getJSON(`http://127.0.0.1:${PORT}/json/version`);
      if (v.webSocketDebuggerUrl) return v.webSocketDebuggerUrl;
    } catch (e) { /* not up yet */ }
    await sleep(100);
  }
  throw new Error('DevTools never became available');
}

function makeClient(ws) {
  let nextId = 1;
  const pending = new Map();

  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });

  return function send(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error('timeout on ' + method));
        }
      }, 30000);
    });
  };
}

async function evaluate(send, expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (res.exceptionDetails) {
    throw new Error('page exception: ' + JSON.stringify(res.exceptionDetails));
  }
  return res.result.value;
}

// Waits until the app has generated a puzzle and rendered the board.
const READY_EXPR = `(function(){
  var b = document.getElementById('board');
  var s = document.getElementById('status');
  return !!(b && b.children.length === 81 && s &&
            s.textContent.length > 0 && s.textContent.indexOf('Generating') < 0);
})()`;

async function measure(send, width, height, dsf, mobile) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: dsf, mobile
  });
  await send('Page.navigate', { url: PAGE });

  for (let i = 0; i < 300; i++) {
    await sleep(100);
    try {
      if (await evaluate(send, READY_EXPR)) break;
    } catch (e) { /* navigation in progress */ }
  }

  return evaluate(send, `(function(){
    var vw = document.documentElement.clientWidth;
    var board = document.getElementById('board').getBoundingClientRect();
    var card = document.querySelector('.board-card').getBoundingClientRect();
    var cell = document.querySelector('#board .cell');
    var cellRect = cell.getBoundingClientRect();
    var font = parseFloat(getComputedStyle(cell).fontSize);
    var pad = document.getElementById('pad').getBoundingClientRect();
    var statusEl = document.getElementById('status').getBoundingClientRect();
    var layout = getComputedStyle(document.querySelector('.play-layout')).gridTemplateColumns;

    // Every cell must sit inside the board's box.
    var overflowCells = 0;
    var cells = document.querySelectorAll('#board .cell');
    for (var i = 0; i < cells.length; i++) {
      var r = cells[i].getBoundingClientRect();
      if (r.left < board.left - 1 || r.right > board.right + 1) overflowCells++;
    }

    // Text must not be clipped horizontally in the sidebar panels.
    var asides = document.querySelectorAll('aside .panel, .explain');
    var clipped = 0;
    for (var a = 0; a < asides.length; a++) {
      if (asides[a].scrollWidth - asides[a].clientWidth > 2) clipped++;
    }

    // Buttons must be finger-sized on touch screens. Board cells are excluded
    // by design — 81 of them cannot all be 32px tall on a phone.
    var small = 0;
    var btns = document.querySelectorAll('#pad button, .toolbar button, aside button, .tut-nav button, .tab');
    for (var k = 0; k < btns.length; k++) {
      var br = btns[k].getBoundingClientRect();
      if (br.width > 0 && br.height > 0 && br.height < 32) small++;
    }

    return {
      viewport: vw,
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      hOverflow: document.documentElement.scrollWidth - vw,
      boardW: Math.round(board.width),
      boardH: Math.round(board.height),
      boardRight: Math.round(board.right),
      boardLeft: Math.round(board.left),
      boardFits: board.right <= vw + 1 && board.left >= -1,
      boardFitsCard: board.width <= card.width + 1,
      square: Math.abs(board.width - board.height) < 2,
      cellW: +cellRect.width.toFixed(1),
      font: +font.toFixed(1),
      overflowCells: overflowCells,
      padRight: Math.round(pad.right),
      statusRight: Math.round(statusEl.right),
      columns: layout,
      clippedPanels: clipped,
      smallControls: small
    };
  })()`);
}

(async () => {
  let ws;
  try {
    const wsUrl = await waitForDevtools();

    ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
    });

    const browserSend = makeClient(ws);

    // Create a page target and attach a session to it.
    const { targetId } = await browserSend('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await browserSend('Target.attachToTarget', { targetId, flatten: true });

    // Wrap the browser-level sender so every call targets this session.
    const send = (method, params) => new Promise((resolve, reject) => {
      const id = Math.floor(Math.random() * 1e9);
      const payload = JSON.stringify({ id, method, params: params || {}, sessionId });
      const handler = ev => {
        const msg = JSON.parse(ev.data);
        if (msg.id === id) {
          ws.removeEventListener('message', handler);
          if (msg.error) reject(new Error(JSON.stringify(msg.error)));
          else resolve(msg.result);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(payload);
      setTimeout(() => {
        ws.removeEventListener('message', handler);
        reject(new Error('timeout: ' + method));
      }, 30000);
    });

    await send('Page.enable');
    await send('Runtime.enable');

    const devices = [
      { label: 'iPhone SE     ', width: 320, height: 568, dsf: 2, mobile: true },
      { label: 'iPhone 12     ', width: 390, height: 844, dsf: 3, mobile: true },
      { label: 'Pixel 7       ', width: 412, height: 915, dsf: 2.6, mobile: true },
      { label: 'iPad mini     ', width: 744, height: 1133, dsf: 2, mobile: true },
      { label: 'Laptop        ', width: 1280, height: 800, dsf: 1, mobile: false }
    ];

    let failures = 0;
    for (const d of devices) {
      const m = await measure(send, d.width, d.height, d.dsf, d.mobile);

      const problems = [];
      // Chrome reserves ~15px for a classic scrollbar, so clientWidth can be
      // slightly under the requested width. That is not a layout failure.
      if (m.viewport > d.width || m.viewport < d.width - 20) {
        problems.push('viewport is ' + m.viewport + ' not ~' + d.width);
      }
      if (m.hOverflow > 2) problems.push('horizontal overflow ' + m.hOverflow + 'px');
      if (!m.boardFits) problems.push('board exceeds viewport (right=' + m.boardRight + ')');
      if (!m.boardFitsCard) problems.push('board wider than its card');
      if (!m.square) problems.push('board is not square');
      if (m.overflowCells > 0) problems.push(m.overflowCells + ' cells outside board');
      if (m.font < 11) problems.push('digit font too small: ' + m.font + 'px');
      // Cells must stay big enough to tap without hitting a neighbour. 24px is
      // the practical floor for a 9x9 grid on a 320px screen.
      if (m.cellW < 24) problems.push('cells too small to tap: ' + m.cellW + 'px');
      if (m.clippedPanels > 0) problems.push(m.clippedPanels + ' clipped panels');
      // Board cells are intentionally small on phones; only check the real
      // controls (pad and toolbar) for finger-sized targets.
      if (m.smallControls > 0) problems.push(m.smallControls + ' controls under 32px tall');

      if (problems.length) failures++;
      console.log(
        (problems.length ? 'FAIL  ' : 'PASS  ') + d.label +
        ' ' + String(d.width).padStart(4) + 'x' + d.height +
        '  board=' + m.boardW + 'px' +
        ' cell=' + m.cellW + 'px' +
        ' font=' + m.font + 'px' +
        ' overflow=' + m.hOverflow +
        (problems.length ? '\n        ' + problems.join('\n        ') : '')
      );
    }

    console.log(failures === 0
      ? '\nALL LAYOUT CHECKS PASSED'
      : '\n' + failures + ' DEVICE(S) FAILED');
    process.exitCode = failures === 0 ? 0 : 1;
  } catch (err) {
    console.error('mobile-check error:', err.message);
    process.exitCode = 1;
  } finally {
    try { if (ws) ws.close(); } catch (e) {}
    chrome.kill('SIGKILL');
  }
})();
