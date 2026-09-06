// ── one board, used by every screen ────────────────────────────────────────
//
// Play, the opening trainer and the drills all need a board that can be tapped,
// and three copies of "which squares can this piece reach" is three chances for
// them to disagree about the rules. This is the one.
//
// Tap-to-select then tap-to-move, rather than drag: on a phone a drag competes with the
// page's own scrolling, and a mis-drag that scrolls the page instead of moving
// a piece reads as the board being broken.
const GLYPH = {
  [PAWN]: '♟', [KNIGHT]: '♞', [BISHOP]: '♝',
  [ROOK]: '♜', [QUEEN]: '♛', [KING]: '♚',
};
// Unicode's own white set, for the "classic" style — outline shapes.
const GLYPH_WHITE = {
  [PAWN]: '♙', [KNIGHT]: '♘', [BISHOP]: '♗',
  [ROOK]: '♖', [QUEEN]: '♕', [KING]: '♔',
};
const LETTER = { [PAWN]: 'P', [KNIGHT]: 'N', [BISHOP]: 'B', [ROOK]: 'R', [QUEEN]: 'Q', [KING]: 'K' };

// The piece style is a page-wide choice read at draw time, so every board on
// every screen changes together the moment it is picked.
const PieceStyle = { current: 'hardlines' };

function pieceText(piece) {
  const type = typeOf(piece);
  if (PieceStyle.current === 'letters') return LETTER[type];
  if (PieceStyle.current === 'classic' && colourOf(piece) === WHITE) return GLYPH_WHITE[type];
  return GLYPH[type];
}

// Which highlight colour a right-click means. Chess.com's convention, so a
// habit formed there carries over: plain is red, shift green, alt blue,
// ctrl yellow.
function highlightFor(event, fallback = 1) {
  if (!event) return fallback;
  if (event.shiftKey) return 2;
  if (event.altKey) return 3;
  if (event.ctrlKey || event.metaKey) return 4;
  return fallback;
}

function makeBoardView(el, options = {}) {
  const view = {
    el,
    board: new Board(options.fen),
    orientation: options.orientation ?? WHITE,
    selected: -1,
    legal: [],
    interactive: options.interactive !== false,
    lastMove: null,
    marks: [],            // squares to ring, e.g. the move a lesson is asking for
    arrows: [],           // [{ from, to, kind }] — see drawArrows()
    onMove: options.onMove ?? (() => {}),
    onIllegal: options.onIllegal ?? (() => {}),
    promotion: null,       // { board, hash } while the promotion overlay is open for THIS view
    grid: null,            // the 64 cells, built once per orientation — see build()
    frame: null,
    cells: new Map(),      // sq -> cell element
    builtFor: null,        // the orientation the cells were built for
    // A locked board is still interactive in the sense that it will be again
    // in a moment — the opponent is thinking — so taps are ignored WITHOUT a
    // redraw, which would kill the slide of the move just played.
    locked: false,
    hangs: [],            // squares whose piece is attacked and undefended
    highlights: new Map(),// sq -> 1..4, the user's own marks
    userArrows: [],       // [{from, to}] the user drew
    showDots: true,
    longPress: 1,         // which highlight a long-press on a phone means
    press: null,          // an in-progress long-press, see wireGestures()
    onHighlightsChange: options.onHighlightsChange ?? (() => {}),

    setFen(fen, { lastMove = null, marks = [], arrows = [], keepUser = false } = {}) {
      // A promotion still being asked about belongs to the board being
      // replaced; the choice can no longer mean anything.
      this.closePromotion();
      this.board = new Board(fen);
      this.selected = -1;
      this.lastMove = lastMove;
      this.marks = marks;
      this.arrows = arrows;
      this.hangs = [];
      if (!keepUser) { this.highlights = new Map(); this.userArrows = []; }
      this.refresh();
    },

    /** Every arrow to draw: the app's, then the user's own on top. */
    allArrows() {
      return [...this.arrows, ...this.userArrows.map((a) => ({ ...a, kind: 'user' }))];
    },

    clearUser() {
      if (!this.highlights.size && !this.userArrows.length) return false;
      this.highlights = new Map();
      this.userArrows = [];
      this.onHighlightsChange();
      return true;
    },

    toggleHighlight(sq, colour) {
      if (this.highlights.get(sq) === colour) this.highlights.delete(sq);
      else this.highlights.set(sq, colour);
      this.onHighlightsChange();
      this.draw();
    },

    toggleUserArrow(from, to) {
      const at = this.userArrows.findIndex((a) => a.from === from && a.to === to);
      if (at >= 0) this.userArrows.splice(at, 1);
      else this.userArrows.push({ from, to });
      this.onHighlightsChange();
      this.draw();
    },

    refresh() {
      this.legal = this.interactive ? this.board.legalMoves() : [];
      this.draw();
    },

    squares() {
      const out = [];
      const ranks = this.orientation === WHITE ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
      const files = this.orientation === WHITE ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
      for (const r of ranks) for (const f of files) out.push((r << 4) | f);
      return out;
    },

    /**
     * The 64 cells, the frame and the coordinates — built ONCE per
     * orientation, with the gestures wired once. draw() then changes classes
     * and pieces in place. Rebuilding the grid on every tap was what cut a
     * slide short whenever anything else changed (a highlight, a hanging
     * mark), and what forced those changes to wait on timers.
     */
    build() {
      const grid = document.createElement('div');
      grid.className = 'board';
      grid.setAttribute('role', 'grid');
      grid.setAttribute('aria-label', 'Chess board');
      this.cells = new Map();

      for (const sq of this.squares()) {
        const cell = document.createElement('div');
        const light = (fileOf(sq) + rankOf(sq)) % 2 === 1;
        cell.className = 'sq ' + (light ? 'light' : 'dark');
        cell.dataset.sq = sq;
        cell.setAttribute('role', 'gridcell');
        cell.setAttribute('aria-label', squareName(sq));
        this.cells.set(sq, cell);
        grid.appendChild(cell);
      }

      this.wireGestures(grid);

      const frame = document.createElement('div');
      frame.className = 'board-frame';
      frame.appendChild(grid);

      const files = this.orientation === WHITE ? 'abcdefgh' : 'hgfedcba';
      const coords = document.createElement('div');
      coords.className = 'coords';
      coords.setAttribute('aria-hidden', 'true');
      coords.innerHTML = [...files].map((f) => `<span>${f}</span>`).join('');

      this.el.innerHTML = '';
      this.el.appendChild(frame);
      this.el.appendChild(coords);
      this.grid = grid;
      this.frame = frame;
      this.builtFor = this.orientation;
    },

    /** The grid is stale when it was never built, was built the other way up, or somebody emptied the host. */
    needsBuild() {
      return !this.grid || this.builtFor !== this.orientation || this.grid.parentElement !== this.frame || this.frame.parentElement !== this.el;
    },

    draw() {
      if (this.needsBuild()) this.build();

      const targets = this.selected >= 0
        ? this.legal.filter((m) => moveFrom(m) === this.selected).map(moveTo) : [];
      const captures = this.selected >= 0
        ? this.legal.filter((m) => moveFrom(m) === this.selected && (moveFlags(m) & FLAG_CAPTURE)).map(moveTo) : [];
      const checkSquare = this.board.inCheck() ? this.board.kings[this.board.turn] : -1;

      for (const [sq, cell] of this.cells) {
        const light = (fileOf(sq) + rankOf(sq)) % 2 === 1;
        let cls = 'sq ' + (light ? 'light' : 'dark');
        if (sq === this.selected) cls += ' sel';
        else if (this.marks.includes(sq)) cls += ' mark';
        else if (sq === checkSquare) cls += ' check';
        else if (this.hangs.includes(sq)) cls += ' hang';
        else if (this.lastMove && (sq === moveFrom(this.lastMove) || sq === moveTo(this.lastMove))) cls += ' last';
        if (this.highlights.has(sq)) cls += ' hl-' + this.highlights.get(sq);
        const dotted = targets.includes(sq) && this.showDots;
        if (dotted && captures.includes(sq)) cls += ' cap';
        if (cell.className !== cls) cell.className = cls;

        // The piece span is REUSED when the same piece is still there, which
        // is what keeps a slide in progress alive across a redraw.
        const piece = this.board.squares[sq];
        let span = cell.querySelector(':scope > .piece');
        if (piece) {
          const want = 'piece ' + (colourOf(piece) === WHITE ? 'w' : 'b');
          const text = pieceText(piece);
          if (!span) {
            span = document.createElement('span');
            span.className = want;
            span.textContent = text;
            cell.insertBefore(span, cell.firstChild);
          } else {
            if (span.textContent !== text) span.textContent = text;
            if (span.className !== want && span.className !== want + ' sliding') span.className = want + (span.classList.contains('sliding') ? ' sliding' : '');
          }
        } else if (span) {
          span.remove();
        }

        let dot = cell.querySelector(':scope > .dot');
        if (dotted && !dot) {
          dot = document.createElement('span');
          dot.className = 'dot';
          cell.appendChild(dot);
        } else if (!dotted && dot) {
          dot.remove();
        }
      }

      this.redrawArrows();
    },

    /** Replace the arrow layer only, leaving the squares — and any slide in
     *  progress on them — alone. */
    redrawArrows() {
      if (this.needsBuild()) { this.draw(); return; }
      this.frame.querySelector(':scope > .arrows')?.remove();
      if (this.arrows.length || this.userArrows.length) this.frame.appendChild(this.drawArrows());
    },

    /**
     * Taps, long-presses and right-drags, on the grid rather than per cell.
     *
     * A tap moves. A RIGHT-CLICK on a square marks it (shift/alt/ctrl pick the
     * colour), a right-DRAG between two squares draws an arrow, and on a phone
     * a LONG-PRESS marks the square — the same gestures chess.com uses, so
     * nothing new has to be learned. A plain tap on an empty square with
     * nothing selected wipes every mark, which is also how chess.com does it.
     */
    wireGestures(grid) {
      const squareAt = (event) => {
        const cell = event.target.closest?.('.sq');
        return cell ? Number(cell.dataset.sq) : -1;
      };
      // Press state lives on the VIEW, not in this closure: a long-press
      // redraws the board, which builds a new grid with new listeners, and
      // the click that follows the release lands on the new grid. A closure
      // variable would not know the press had fired and would treat that
      // click as a tap — which wiped the mark a moment after making it.
      let rightFrom = -1;

      grid.addEventListener('contextmenu', (e) => e.preventDefault());

      grid.addEventListener('pointerdown', (e) => {
        const sq = squareAt(e);
        if (sq < 0) return;
        if (e.button === 2) { rightFrom = sq; return; }
        if (e.button !== 0) return;
        if (e.pointerType === 'mouse') return;
        clearTimeout(this.press?.timer);
        const press = { sq, x: e.clientX, y: e.clientY, fired: false, timer: 0 };
        press.timer = setTimeout(() => {
          press.fired = true;
          this.toggleHighlight(sq, this.longPress);
          if (navigator.vibrate) navigator.vibrate(12);
        }, 450);
        this.press = press;
      });
      grid.addEventListener('pointermove', (e) => {
        const press = this.press;
        if (!press || press.fired) return;
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) { clearTimeout(press.timer); this.press = null; }
      });
      const endPress = () => { if (this.press) clearTimeout(this.press.timer); };
      grid.addEventListener('pointercancel', () => { endPress(); this.press = null; });
      // The click that follows a fired long-press is swallowed — ONE click,
      // and only if it comes soon. Some browsers send no click at all after a
      // long-press, and a flag left set would eat the next real tap.
      grid.addEventListener('touchend', () => {
        const press = this.press;
        if (!press?.fired) return;
        setTimeout(() => { if (this.press === press) this.press = null; }, 350);
      }, { passive: true });
      grid.addEventListener('pointerup', (e) => {
        if (e.button === 2 && rightFrom >= 0) {
          const to = squareAt(e);
          if (to === rightFrom) this.toggleHighlight(to, highlightFor(e));
          else if (to >= 0) this.toggleUserArrow(rightFrom, to);
          rightFrom = -1;
          return;
        }
        endPress();
      });
      grid.addEventListener('click', (e) => {
        const sq = squareAt(e);
        const fired = this.press?.fired;
        endPress();
        this.press = null;
        if (fired || sq < 0) return;
        this.tap(sq, e);
      });
    },

    /**
     * Arrows over the board.
     *
     * THE COLOURS MEAN THE SAME THING EVERYWHERE, and they are the ones the
     * sibling training app already uses: RED is the move you played, GREEN is
     * the move the engine wanted, BLUE is a move being played AT you. Two apps
     * with different colour schemes for the same three ideas would be two
     * things to learn instead of one.
     *
     * Drawn in board coordinates — the viewBox is 0 0 8 8, so a square is one
     * unit and every measurement below is a fraction of a square rather than a
     * pixel. That is what makes the arrows scale exactly with the board at any
     * size, which pixel maths does not.
     */
    drawArrows() {
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'arrows');
      svg.setAttribute('viewBox', '0 0 8 8');
      svg.setAttribute('aria-hidden', 'true');

      const centre = (sq) => {
        const file = fileOf(sq), rank = rankOf(sq);
        return this.orientation === WHITE
          ? { x: file + 0.5, y: (7 - rank) + 0.5 }
          : { x: (7 - file) + 0.5, y: rank + 0.5 };
      };

      for (const { from, to, kind } of this.allArrows()) {
        const a = centre(from), b = centre(to);
        const dx = b.x - a.x, dy = b.y - a.y;
        const length = Math.hypot(dx, dy);
        if (length === 0) continue;

        const ux = dx / length, uy = dy / length;
        const head = 0.34;          // arrowhead length, in squares
        const width = 0.13;         // shaft width
        const spread = 0.19;        // half-width of the head

        // The shaft stops where the head begins, and both start a little way
        // off the origin square's centre so the piece underneath stays visible.
        const startGap = 0.28;
        const sx = a.x + ux * startGap, sy = a.y + uy * startGap;
        const tipX = b.x - ux * 0.06, tipY = b.y - uy * 0.06;
        const baseX = tipX - ux * head, baseY = tipY - uy * head;

        const px = -uy, py = ux;    // perpendicular, for the head's corners
        const headPoints = [
          `${tipX},${tipY}`,
          `${baseX + px * spread},${baseY + py * spread}`,
          `${baseX - px * spread},${baseY - py * spread}`,
        ].join(' ');

        // EACH ARROW IS DRAWN TWICE: a wider halo underneath, then the colour.
        //
        // Vermilion is the dark square on this board, so a red arrow on one is
        // a 1.0 contrast ratio — not hard to read, actually invisible. Measured
        // before this was added: every arrow colour failed against one square
        // colour or the other, in both themes.
        //
        // The halo is the opposite lightness to the arrows, so on squares where
        // the colour disappears the outline carries the shape, and on squares
        // where the outline disappears the colour does. Every square is covered
        // by one or the other, which is a property a single colour cannot have
        // against two very different backgrounds.
        for (const layer of ['halo', 'ink']) {
          const shaft = document.createElementNS(NS, 'line');
          shaft.setAttribute('x1', sx); shaft.setAttribute('y1', sy);
          shaft.setAttribute('x2', baseX); shaft.setAttribute('y2', baseY);
          shaft.setAttribute('stroke-width', layer === 'halo' ? width + 0.075 : width);
          shaft.setAttribute('class', layer === 'halo' ? 'arrow arrow-halo' : `arrow arrow-${kind}`);
          svg.appendChild(shaft);

          const headShape = document.createElementNS(NS, 'polygon');
          headShape.setAttribute('points', headPoints);
          if (layer === 'halo') {
            headShape.setAttribute('class', 'arrow-head arrow-halo-head');
            headShape.setAttribute('stroke-width', 0.075);
          } else {
            headShape.setAttribute('class', `arrow-head arrow-${kind}`);
          }
          svg.appendChild(headShape);
        }
      }

      return svg;
    },

    tap(sq, event = null) {
      if (!this.interactive || this.locked) {
        // Even a board that cannot be moved on can have its marks wiped.
        if (this.clearUser()) this.draw();
        return;
      }

      const candidates = this.legal.filter((m) => moveFrom(m) === this.selected && moveTo(m) === sq);

      if (this.selected >= 0 && candidates.length) {
        // Several moves between the same two squares means a promotion, and the
        // only thing separating them is the piece. Ask rather than assume a
        // queen — underpromotion is rare and losing to it because the board
        // decided for you is worse than one extra tap.
        if (candidates.length > 1) { this.askPromotion(candidates); return; }
        this.play(candidates[0]);
        return;
      }

      const piece = this.board.squares[sq];
      const wasSelected = this.selected;
      this.selected = (piece && colourOf(piece) === this.board.turn) ? sq : -1;
      if (this.selected < 0 && wasSelected < 0) this.clearUser();
      this.draw();
    },

    /**
     * The overlay is PINNED TO THE POSITION IT WAS OPENED ON. The buttons
     * close over moves from one board; if the board has been replaced or has
     * moved on by the time one is pressed (the overlay does not stop the
     * keyboard reaching Reset or Load), the choice is dropped and the overlay
     * closed — a stale "b8=Q" once put a colourless queen on the start
     * position and deleted the pawn there.
     */
    askPromotion(candidates) {
      const overlay = document.getElementById('promo');
      const box = document.getElementById('promoChoices');
      if (!overlay || !box) { this.play(candidates[0]); return; }
      const pinned = { board: this.board, hash: this.board.hash, view: this };
      this.promotion = pinned;
      const stale = () => this.promotion !== pinned || this.board !== pinned.board || this.board.hash !== pinned.hash;

      box.innerHTML = '';
      for (const move of candidates) {
        const btn = document.createElement('button');
        btn.className = 'piece ' + (this.board.turn === WHITE ? 'w' : 'b');
        btn.type = 'button';
        btn.textContent = pieceText(movePromo(move) | this.board.turn);
        btn.setAttribute('aria-label', { [QUEEN]: 'Queen', [ROOK]: 'Rook', [BISHOP]: 'Bishop', [KNIGHT]: 'Knight' }[movePromo(move)]);
        btn.addEventListener('click', () => {
          if (stale()) { this.closePromotion(); return; }
          this.closePromotion();
          this.play(move);
        });
        box.appendChild(btn);
      }

      // Focus stays inside: Tab and Shift+Tab cycle the choices, Escape
      // closes. Wired once on the overlay; it reads which view owns it.
      if (!overlay.dataset.trapped) {
        overlay.dataset.trapped = '1';
        overlay.addEventListener('keydown', (e) => {
          const buttons = [...overlay.querySelectorAll('button')];
          if (!buttons.length) return;
          if (e.key === 'Tab') {
            e.preventDefault();
            const at = buttons.indexOf(document.activeElement);
            const next = e.shiftKey ? (at <= 0 ? buttons.length - 1 : at - 1) : (at < 0 || at === buttons.length - 1 ? 0 : at + 1);
            buttons[next].focus();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            overlay.__owner?.closePromotion({ deselect: true });
          }
        });
      }
      overlay.__owner = this;
      overlay.hidden = false;
      box.firstChild?.focus();
    },

    /** Hide the overlay if this view opened it. */
    closePromotion({ deselect = false } = {}) {
      const overlay = document.getElementById('promo');
      if (!this.promotion) {
        return;
      }
      this.promotion = null;
      if (overlay && overlay.__owner === this) { overlay.hidden = true; overlay.__owner = null; }
      if (deselect) { this.selected = -1; this.draw(); }
    },

    play(move) {
      const san = toSan(this.board, move);
      const uci = moveToUci(move);
      this.selected = -1;
      this.onMove({ move, san, uci, view: this });
    },

    /**
     * Apply a move to this board without asking anybody.
     *
     * SLIDES RATHER THAN TELEPORTS. A piece that simply appears on its new
     * square tells you nothing about what moved — which matters most for the
     * opponent's move, the one you did not watch happen. The technique is to
     * redraw first, then put the moved piece back where it started with a
     * transform and remove it, so the browser animates the difference; measuring
     * before and after is the only way to get the distance right at any board
     * size.
     *
     * Castling moves two pieces and en passant removes one that is not on the
     * destination square, so the rook is animated too and the captured pawn is
     * simply gone — animating a piece leaving the board would draw attention to
     * the wrong thing.
     */
    apply(move, { animate = true } = {}) {
      const from = moveFrom(move), to = moveTo(move);
      const flags = moveFlags(move);
      const before = animate ? this.rects() : null;

      // A move the rules refuse changes nothing, including the last-move
      // squares — marking a move that was never made is the worse of the two.
      if (!this.board.make(move)) return false;
      this.lastMove = move;
      this.refresh();

      if (!animate || !before) return true;

      const slides = [[from, to]];
      if (flags & FLAG_CASTLE) {
        slides.push([to > from ? from + 3 : from - 4, to > from ? from + 1 : from - 1]);
      }

      for (const [origin, destination] of slides) this.slide(before, origin, destination);
      return true;
    },

    /** Where every square is on screen right now, by square index. */
    rects() {
      const map = new Map();
      for (const cell of this.el.querySelectorAll('.sq')) {
        map.set(Number(cell.dataset.sq), cell.getBoundingClientRect());
      }
      return map;
    },

    slide(before, origin, destination) {
      const start = before.get(origin);
      const cell = this.el.querySelector(`.sq[data-sq="${destination}"]`);
      const piece = cell?.querySelector('.piece');
      if (!start || !piece) return;

      const end = cell.getBoundingClientRect();
      const dx = start.left - end.left;
      const dy = start.top - end.top;
      if (dx === 0 && dy === 0) return;

      // A span reused from the previous draw may still be sliding; the start
      // position has to be set with the transition OFF or it eases there.
      piece.classList.remove('sliding');
      piece.style.transform = `translate(${dx}px, ${dy}px)`;
      // Force the browser to take that starting position as a fact before the
      // transition is turned on. Without the read, both styles land in the same
      // frame and there is nothing to animate between.
      void piece.offsetWidth;
      piece.classList.add('sliding');
      piece.style.transform = '';

      const done = () => {
        piece.classList.remove('sliding');
        piece.removeEventListener('transitionend', done);
      };
      piece.addEventListener('transitionend', done);
    },
  };

  view.refresh();
  return view;
}
