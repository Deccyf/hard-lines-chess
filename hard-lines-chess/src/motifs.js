// ── motifs: WHAT WAS DONE TO YOU ───────────────────────────────────────────
//
// A mistake already has a number on it by the time it gets here — the engine
// said the position was worth this much before and that much after. A number
// is not a lesson. This turns the number into a named motif, but only ever by
// REPLAYING THE MOVES AND COUNTING ON THE BOARD.
//
// THE RULE THAT OVERRIDES EVERY OTHER RULE IN THIS FILE: if a motif cannot be
// demonstrated by making moves and counting attackers, it is not named. An
// empty `themes` array and an empty `reason` is a correct answer and the most
// common one. A plausible invention — "this loses to a fork" because the score
// dropped by three pawns and forks are common — is worse than silence, because
// the whole point of the layer beneath is that it never asserts a tactic it
// has not verified. There is no model in here and no heuristic that guesses
// from the centipawn figure: `cpLoss` and `bestUci` are accepted and never
// read, because a theme inferred from a number is a guess wearing a name.
//
// VOICE. A game mistake describes what happened TO the player. `hangingPiece`
// means they left something loose, not that anybody "wins a knight". Every
// reason is written in the second person about their own pieces, because the
// screen that shows it is their game and not a puzzle solution.
//
// NO SEARCH. Everything here is replay and static counting, so the whole
// classification of a game costs less than one node of the engine. The one
// piece of real chess arithmetic is a static exchange evaluation, and even
// that is done by making the captures on the board rather than by a swap list,
// so an x-ray behind a captured piece and a defender that turns out to be
// pinned are both handled by the move generator rather than by a special case
// that could be wrong.
//
// Everything is inside one closure. The bundle is a single concatenated
// script, so a bare `const KING_STEPS` at the top level here would collide
// with a name in core.js and the whole page would die on a duplicate
// declaration before the first line ran.

const MOTIFS = (function () {
  'use strict';

  // The fixed vocabulary. Nothing outside this list can ever be returned;
  // `classify` asserts membership before handing a theme back.
  const VOCABULARY = [
    'hangingPiece', 'fork', 'pin', 'skewer', 'discoveredAttack', 'backRankMate',
    'trappedPiece', 'exposedKing', 'mateIn1', 'mateIn2', 'mateIn3', 'missedMate',
    'lostMaterial',
  ];

  // Most specific first. A fork and a hanging piece are often both true of the
  // same move; the fork says more, so it leads. `lostMaterial` is last and is
  // only ever reached when nothing above it fired.
  const PRIORITY = [
    'backRankMate',
    'mateIn1', 'mateIn2', 'mateIn3', 'missedMate',
    'fork', 'skewer', 'pin', 'discoveredAttack',
    'hangingPiece', 'trappedPiece', 'exposedKing',
    'lostMaterial',
  ];

  const MAX_THEMES = 3;

  // Values in centipawns. The king's is a stand-in for "cannot be counted",
  // used only so a comparison against it always answers the same way.
  const VALUE = {
    [PAWN]: 100, [KNIGHT]: 320, [BISHOP]: 330, [ROOK]: 500, [QUEEN]: 900, [KING]: 100000,
  };

  const WORD = {
    [PAWN]: 'pawn', [KNIGHT]: 'knight', [BISHOP]: 'bishop',
    [ROOK]: 'rook', [QUEEN]: 'queen', [KING]: 'king',
  };

  // Own geometry rather than core.js's, which does not export its direction
  // tables. Same numbers; a 0x88 board only has one set.
  const KNIGHT_STEPS = [33, 31, 18, 14, -33, -31, -18, -14];
  const BISHOP_RAYS = [17, 15, -17, -15];
  const ROOK_RAYS = [16, 1, -16, -1];
  const KING_STEPS = [17, 16, 15, 1, -17, -16, -15, -1];

  const off = (sq) => (sq & 0x88) !== 0;
  const foe = (colour) => (colour === WHITE ? BLACK : WHITE);
  const valueOf = (piece) => VALUE[typeOf(piece)] || 0;
  const wordOf = (piece) => WORD[typeOf(piece)] || 'piece';
  const isSlider = (type) => type === BISHOP || type === ROOK || type === QUEEN;
  const raysFor = (type) => (type === BISHOP ? BISHOP_RAYS : type === ROOK ? ROOK_RAYS : KING_STEPS);

  // ── board questions ──────────────────────────────────────────────────────

  /** Every square the piece standing on `sq` attacks, occupied or not. */
  function attacksFrom(board, sq) {
    const piece = board.squares[sq];
    if (!piece) return [];
    const type = typeOf(piece);
    const out = [];

    if (type === PAWN) {
      const dir = colourOf(piece) === WHITE ? 16 : -16;
      for (const side of [-1, 1]) {
        const to = sq + dir + side;
        if (!off(to)) out.push(to);
      }
      return out;
    }

    if (type === KNIGHT || type === KING) {
      for (const d of (type === KNIGHT ? KNIGHT_STEPS : KING_STEPS)) {
        const to = sq + d;
        if (!off(to)) out.push(to);
      }
      return out;
    }

    for (const d of raysFor(type)) {
      let to = sq + d;
      while (!off(to)) {
        out.push(to);
        if (board.squares[to]) break;
        to += d;
      }
    }
    return out;
  }

  /** The squares of every `by`-coloured piece attacking `sq`. */
  function attackersOf(board, sq, by) {
    const out = [];

    // Where a pawn would have to STAND to attack this square, which is not
    // where a pawn can move to — the difference is the push.
    const pawnDir = by === WHITE ? -16 : 16;
    for (const side of [-1, 1]) {
      const from = sq + pawnDir + side;
      if (off(from)) continue;
      const p = board.squares[from];
      if (p && colourOf(p) === by && typeOf(p) === PAWN) out.push(from);
    }

    for (const d of KNIGHT_STEPS) {
      const from = sq + d;
      if (off(from)) continue;
      const p = board.squares[from];
      if (p && colourOf(p) === by && typeOf(p) === KNIGHT) out.push(from);
    }

    for (const d of KING_STEPS) {
      const from = sq + d;
      if (off(from)) continue;
      const p = board.squares[from];
      if (p && colourOf(p) === by && typeOf(p) === KING) out.push(from);
    }

    for (const pair of [[BISHOP_RAYS, BISHOP], [ROOK_RAYS, ROOK]]) {
      for (const d of pair[0]) {
        let from = sq + d;
        while (!off(from)) {
          const p = board.squares[from];
          if (p) {
            if (colourOf(p) === by && (typeOf(p) === pair[1] || typeOf(p) === QUEEN)) out.push(from);
            break;
          }
          from += d;
        }
      }
    }

    return out;
  }

  /**
   * Static exchange on `sq`: what the side to move gains by starting a capture
   * sequence there, never less than zero because nobody is forced to start it.
   *
   * The captures are MADE ON THE BOARD and the attackers recomputed each time
   * rather than resolved from a swap list. That costs a few make/unmake pairs
   * and buys two things a swap list gets wrong: a rook behind a bishop joins
   * the exchange the moment the bishop is gone, and a defender that is pinned
   * never joins it at all, because `legalMoves()` will not offer the recapture.
   *
   * Promotions are counted as the piece captured only — a capture that also
   * promotes is under-valued here, which errs towards saying nothing.
   */
  function exchangeAt(board, sq) {
    const victim = board.squares[sq];
    if (!victim) return 0;

    let cheapest = 0;
    let cheapestValue = Infinity;
    for (const move of board.legalMoves()) {
      if (moveTo(move) !== sq) continue;
      if (!(moveFlags(move) & FLAG_CAPTURE)) continue;
      const v = valueOf(board.squares[moveFrom(move)]);
      if (v < cheapestValue) { cheapestValue = v; cheapest = move; }
    }
    if (!cheapest) return 0;

    const gain = valueOf(victim);
    if (!board.make(cheapest)) return 0;
    const net = Math.max(0, gain - exchangeAt(board, sq));
    board.unmake();
    return net;
  }

  /** What the side to move nets by playing this capture, recaptures included. */
  function exchangeValue(board, move) {
    const to = moveTo(move);
    const victim = board.squares[to];
    if (!victim) return 0;                    // en passant lands on an empty square
    const gain = valueOf(victim);
    if (!board.make(move)) return 0;
    const net = gain - exchangeAt(board, to);
    board.unmake();
    return net;
  }

  /**
   * Is the piece on `sq` under a threat that actually wins something? Used
   * where it is the wrong side's turn to run a real exchange — a threat is
   * about the move AFTER next, and flipping the side to move on a board that
   * might be in check produces a position the generator was never meant to
   * see. Counting is enough here: undefended, or attacked by something cheaper.
   */
  function threatWins(board, sq, by) {
    const piece = board.squares[sq];
    if (!piece || colourOf(piece) === by) return false;
    const attackers = attackersOf(board, sq, by);
    if (!attackers.length) return false;
    const defenders = attackersOf(board, sq, colourOf(piece));
    if (!defenders.length) return true;
    let cheapest = Infinity;
    for (const from of attackers) cheapest = Math.min(cheapest, valueOf(board.squares[from]));
    return cheapest < valueOf(piece);
  }

  /** Material from `colour`'s point of view, kings excluded. */
  function balance(board, colour) {
    let total = 0;
    for (let sq = 0; sq < 128; sq++) {
      if (off(sq)) continue;
      const p = board.squares[sq];
      if (!p || typeOf(p) === KING) continue;
      total += (colourOf(p) === colour ? 1 : -1) * valueOf(p);
    }
    return total;
  }

  function uciToMove(board, uci) {
    if (typeof uci !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
    const from = nameToSquare(uci.slice(0, 2));
    const to = nameToSquare(uci.slice(2, 4));
    const promo = uci.length > 4 ? { q: QUEEN, r: ROOK, b: BISHOP, n: KNIGHT }[uci[4]] : 0;
    let fallback = null;
    for (const move of board.legalMoves()) {
      if (moveFrom(move) !== from || moveTo(move) !== to) continue;
      if (promo ? movePromo(move) === promo : movePromo(move) === 0) return move;
      if (!fallback) fallback = move;
    }
    return fallback;
  }

  /**
   * Play a line of UCI moves from `fen`, stopping at the first move that is not
   * legal — a line from an engine can be cut short or (after a rewind) simply
   * not fit the position, and half a line replayed correctly is worth more than
   * a whole one replayed into nonsense.
   */
  function replay(fen, ucis) {
    const board = new Board(fen);
    const steps = [];
    for (const uci of (ucis || [])) {
      const move = uciToMove(board, uci);
      if (move === null) break;
      const from = moveFrom(move);
      const to = moveTo(move);
      const mover = board.squares[from];
      if (!board.make(move)) break;
      steps.push({
        uci, move, from, to, mover,
        fenAfter: board.fen(),
        mate: board.outcome() === 'checkmate',
      });
    }
    return { board, steps };
  }

  // ── the motifs ───────────────────────────────────────────────────────────

  /**
   * Every pin and skewer an opponent slider holds over two of the player's
   * pieces: attacker, front piece, nothing between, a second player piece
   * behind. Which of the two is worth more decides the name, and the king
   * settles it either way — behind means pin, in front means skewer.
   */
  function relations(board, by) {
    const them = foe(by);
    const found = [];
    for (let sq = 0; sq < 128; sq++) {
      if (off(sq)) continue;
      const piece = board.squares[sq];
      if (!piece || colourOf(piece) !== by || !isSlider(typeOf(piece))) continue;

      for (const d of raysFor(typeOf(piece))) {
        let at = sq + d;
        while (!off(at) && !board.squares[at]) at += d;
        if (off(at)) continue;
        const front = board.squares[at];
        if (colourOf(front) !== them) continue;

        let behind = at + d;
        while (!off(behind) && !board.squares[behind]) behind += d;
        if (off(behind)) continue;
        const back = board.squares[behind];
        if (colourOf(back) !== them) continue;

        const frontValue = valueOf(front);
        const backValue = valueOf(back);
        if (frontValue === backValue) continue;   // neither name is true of it
        found.push({
          key: sq + ':' + at + ':' + behind,
          slider: piece, sliderSq: sq,
          front, frontSq: at,
          back, backSq: behind,
          kind: backValue > frontValue ? 'pin' : 'skewer',
        });
      }
    }
    return found;
  }

  /**
   * Does the piece that just moved to `sq` fork?
   *
   * Two branches, and the second is the one that needs a guard. Two targets
   * worth more than the forker is unambiguous. A check plus one other target
   * is a fork in the same sense — but only if the other target is a PIECE
   * worth taking: a queen that checks and also "attacks" a pawn defended by
   * the king has forked nothing, and naming that a fork is exactly the
   * confident invention this file exists to avoid. A pawn is not a piece.
   */
  function forkAt(board, sq, victimColour) {
    const mover = board.squares[sq];
    if (!mover) return null;
    const moverValue = valueOf(mover);
    const kingSq = board.kings[victimColour];

    let check = false;
    const targets = [];
    for (const to of attacksFrom(board, sq)) {
      const piece = board.squares[to];
      if (!piece || colourOf(piece) !== victimColour) continue;
      if (to === kingSq) { check = true; continue; }
      targets.push({ piece, sq: to });
    }

    const richer = targets.filter((t) => valueOf(t.piece) > moverValue);
    if (richer.length >= 2) return { mover, moverSq: sq, check: false, targets: richer };

    if (check) {
      const worth = targets.filter((t) => typeOf(t.piece) !== PAWN
        && (valueOf(t.piece) > moverValue || attackersOf(board, t.sq, victimColour).length === 0));
      if (worth.length >= 1) return { mover, moverSq: sq, check: true, targets: worth };
    }

    return null;
  }

  /**
   * A line opened by the move itself: a slider of theirs that now reaches one
   * of the player's pieces THROUGH the square the moving piece left. The
   * square being on the ray is the whole verification — without it any slider
   * that happens to point at something would qualify.
   */
  function discoveries(board, vacated, moverSq, by) {
    const them = foe(by);
    const out = [];
    for (let sq = 0; sq < 128; sq++) {
      if (off(sq) || sq === moverSq) continue;
      const piece = board.squares[sq];
      if (!piece || colourOf(piece) !== by || !isSlider(typeOf(piece))) continue;

      for (const d of raysFor(typeOf(piece))) {
        let at = sq + d;
        let through = false;
        while (!off(at)) {
          if (at === vacated) through = true;
          if (board.squares[at]) break;
          at += d;
        }
        if (off(at) || !through) continue;
        const target = board.squares[at];
        if (colourOf(target) !== them) continue;
        if (at !== board.kings[them] && !threatWins(board, at, by)) continue;
        out.push({ slider: piece, sliderSq: sq, target, targetSq: at, vacated });
      }
    }
    return out;
  }

  /**
   * Attacked, and nowhere to go. Every legal move of the piece is made and the
   * exchange on its destination counted, so "safe" means the opponent does not
   * win material there — a rook that can step onto a square defended twice and
   * attacked once has an escape, and a rook whose only flight square drops it
   * to a pawn does not.
   *
   * Not run while the player is in check: a piece that cannot move because the
   * king is under attack is immobilised by the check, not trapped, and saying
   * otherwise would report a "trapped rook" on every mating net.
   *
   * `spokenFor` holds the squares another theme has already named. A pinned
   * knight has no legal move BECAUSE it is pinned, and "the knight is pinned"
   * and "the knight has nowhere to go" are one fact wearing two names — the
   * second one earns its place only on a piece nothing else has mentioned.
   */
  function trapped(board, owner, spokenFor) {
    if (board.inCheck(owner)) return null;
    const them = foe(owner);

    for (let sq = 0; sq < 128; sq++) {
      if (off(sq)) continue;
      if (spokenFor && spokenFor.has(sq)) continue;
      const piece = board.squares[sq];
      if (!piece || colourOf(piece) !== owner) continue;
      const type = typeOf(piece);
      if (type === PAWN || type === KING) continue;   // neither is ever "trapped" usefully
      if (!threatWins(board, sq, them)) continue;

      let escape = false;
      const probe = new Board(board.fen());
      for (const move of probe.legalMoves()) {
        if (moveFrom(move) !== sq) continue;
        const to = moveTo(move);
        if (!probe.make(move)) continue;
        const lost = exchangeAt(probe, to);
        probe.unmake();
        if (lost <= 0) { escape = true; break; }
      }
      if (!escape) return { piece, sq };
    }
    return null;
  }

  /**
   * The player's king was mated on its own back rank, shut in by its own
   * pieces. Every escape square in front of the king has to be OCCUPIED BY THE
   * PLAYER'S OWN MEN and at least one of them a pawn — that is the difference
   * between a back-rank mate and any other mate that happens to land on the
   * first rank, and it is the whole reason the motif is worth naming: the
   * lesson is the missing luft.
   */
  function backRank(fenAfterMate, lastTo, victim) {
    const board = new Board(fenAfterMate);
    const kingSq = board.kings[victim];
    if (kingSq < 0) return null;

    const homeRank = victim === WHITE ? 0 : 7;
    if (rankOf(kingSq) !== homeRank) return null;

    // The mate has to come along the rank, from a rook or a queen. A knight
    // mate on the back rank is not a back-rank mate.
    const mater = board.squares[lastTo];
    if (!mater || colourOf(mater) === victim) return null;
    const materType = typeOf(mater);
    if (materType !== ROOK && materType !== QUEEN) return null;
    if (rankOf(lastTo) !== homeRank) return null;
    if (!attacksFrom(board, lastTo).includes(kingSq)) return null;

    const forward = victim === WHITE ? 16 : -16;
    const blockers = [];
    for (const side of [-1, 0, 1]) {
      const sq = kingSq + forward + side;
      if (off(sq)) continue;
      const piece = board.squares[sq];
      if (!piece || colourOf(piece) !== victim) return null;   // there was air
      blockers.push({ piece, sq });
    }
    if (!blockers.some((b) => typeOf(b.piece) === PAWN)) return null;
    return { kingSq, materSq: lastTo, mater, blockers };
  }

  /** Adjacent squares the king could actually stand on unharmed. */
  function airAroundKing(board, colour) {
    const kingSq = board.kings[colour];
    if (kingSq < 0) return 0;
    const them = foe(colour);
    let air = 0;
    for (const d of KING_STEPS) {
      const sq = kingSq + d;
      if (off(sq)) continue;
      const piece = board.squares[sq];
      if (piece && colourOf(piece) === colour) continue;   // its own man is in the way
      if (board.attacked(sq, them)) continue;
      air++;
    }
    return air;
  }

  // ── wording ──────────────────────────────────────────────────────────────

  const listOf = (parts) => (parts.length <= 1 ? (parts[0] || '')
    : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1]);

  const yours = (piece, sq) => 'your ' + wordOf(piece) + ' on ' + squareName(sq);
  const theirs = (piece, sq) => 'their ' + wordOf(piece) + ' on ' + squareName(sq);
  const target = (piece, sq, kingSq) => (sq === kingSq ? 'your king' : yours(piece, sq));

  function pawnsWord(cp) {
    const n = Math.max(1, Math.round(Math.abs(cp) / 100));
    return n === 1 ? 'about a pawn' : 'about ' + n + ' pawns';
  }

  const COUNT_WORD = { 1: 'one', 2: 'two', 3: 'three' };

  // ── the classifier ───────────────────────────────────────────────────────

  function classify(input) {
    const nothing = { themes: [], reason: '' };
    const found = {};       // theme -> the evidence that fired it

    if (!input || typeof input.fenBefore !== 'string') return nothing;

    let before;
    try {
      before = new Board(input.fenBefore);
    } catch (err) {
      return nothing;
    }
    if (before.kings[WHITE] < 0 || before.kings[BLACK] < 0) return nothing;

    const me = before.turn;
    const them = foe(me);

    const playedMove = uciToMove(before, input.playedUci);
    // A move that will not play is a broken record, not a mistake to explain.
    // The one thing still worth saying is the caller's own mate verdict.
    if (playedMove === null) {
      if (input.mate === 'missed') {
        return {
          themes: ['missedMate'],
          reason: 'You had a forced mate here and played something else.',
        };
      }
      return nothing;
    }

    const playedSan = toSan(before, playedMove);

    const after = new Board(input.fenBefore);
    if (!after.make(playedMove)) return nothing;

    // The punishing line. `replyUci` is the first move of it; a caller that
    // sends both gets one line, not the reply twice.
    const rest = Array.isArray(input.replyLine) ? input.replyLine.slice() : [];
    let line = rest;
    if (input.replyUci) line = (rest[0] === input.replyUci) ? rest : [input.replyUci].concat(rest);
    const { steps } = replay(after.fen(), line);

    // ── mate, which is the caller's measurement, not ours ──────────────────
    //
    // Whether a mate exists at all was decided by an engine search that is not
    // run here; what IS measured here is the distance, by replaying the line
    // until the board says checkmate. No mate in the line means no distance,
    // and no distance means no theme — the length of a line is not a proof.
    if (input.mate === 'missed') found.missedMate = true;
    if (input.mate === 'allowed') {
      for (let i = 0; i < steps.length; i++) {
        if (!steps[i].mate) continue;
        if (i % 2 !== 0) break;                 // mate delivered by the player: not theirs to allow
        const distance = (i / 2) + 1;
        if (distance <= 3) found['mateIn' + distance] = distance;
        break;
      }
    }

    // ── back rank, on whichever move of theirs delivered the mate ──────────
    for (let i = 0; i < steps.length; i++) {
      if (!steps[i].mate || i % 2 !== 0) continue;
      const evidence = backRank(steps[i].fenAfter, steps[i].to, me);
      if (evidence) found.backRankMate = evidence;
      break;
    }

    const reply = steps.length ? steps[0] : null;

    if (reply) {
      const afterReply = new Board(reply.fenAfter);

      // ── hanging: they took something of yours and kept the material ──────
      //
      // Not "undefended" but "the exchange loses", which is the same thing
      // when there is no defender and the honest answer when there is one.
      if (afterReply.squares[reply.to] && colourOf(reply.mover) === them) {
        const victimBoard = new Board(after.fen());
        const victim = victimBoard.squares[reply.to];
        if (victim && colourOf(victim) === me && typeOf(victim) !== KING) {
          const net = exchangeValue(victimBoard, reply.move);
          if (net > 0) {
            found.hangingPiece = {
              piece: victim,
              sq: reply.to,
              net,
              defended: attackersOf(victimBoard, reply.to, me).length > 0,
            };
          }
        }
      }

      // ── fork ─────────────────────────────────────────────────────────────
      const fork = forkAt(afterReply, reply.to, me);
      if (fork) found.fork = fork;

      // ── pin and skewer, but only ones the move CREATED ────────────────────
      //
      // A pin that was already there was not done by this move and is not what
      // went wrong on this ply.
      const had = {};
      for (const rel of relations(after, them)) had[rel.key] = true;
      for (const rel of relations(afterReply, them)) {
        if (had[rel.key]) continue;
        if (!found[rel.kind]) found[rel.kind] = rel;
      }

      // ── discovered attack ────────────────────────────────────────────────
      const opened = discoveries(afterReply, reply.from, reply.to, them);
      if (opened.length) {
        // The king first: a discovered check is the one worth naming.
        const kingSq = afterReply.kings[me];
        found.discoveredAttack = opened.find((d) => d.targetSq === kingSq) || opened[0];
      }

      // ── trapped ──────────────────────────────────────────────────────────
      const spokenFor = new Set();
      if (found.hangingPiece) spokenFor.add(found.hangingPiece.sq);
      if (found.fork) for (const t of found.fork.targets) spokenFor.add(t.sq);
      for (const kind of ['pin', 'skewer']) {
        if (found[kind]) { spokenFor.add(found[kind].frontSq); spokenFor.add(found[kind].backSq); }
      }
      if (found.discoveredAttack) spokenFor.add(found.discoveredAttack.targetSq);

      const stuck = trapped(afterReply, me, spokenFor);
      if (stuck) found.trappedPiece = stuck;
    }

    // ── the king's air, measured before and after YOUR move ────────────────
    //
    // Claimed only alongside a check in their line, because a king with less
    // air and nothing coming at it is a position, not a mistake. "Materially
    // fewer" is spelled out as: strictly fewer than it had, and down to one
    // flight square or none — a king going from five squares to four has not
    // been exposed by anything.
    const checkInLine = steps.some((s, i) => i % 2 === 0 && new Board(s.fenAfter).inCheck(me));
    if (checkInLine) {
      const airBefore = airAroundKing(before, me);
      const airAfter = airAroundKing(after, me);
      if (airAfter < airBefore && airAfter <= 1) {
        found.exposedKing = { before: airBefore, after: airAfter };
      }
    }

    // ── last resort: material really changed hands ─────────────────────────
    //
    // Counted on the board at both ends of the line, never inferred from
    // `cpLoss`, which includes every positional judgement the engine made.
    if (!Object.keys(found).length && steps.length) {
      const start = balance(after, me);
      const end = balance(new Board(steps[steps.length - 1].fenAfter), me);
      if (start - end >= 100) found.lostMaterial = { cp: start - end };
    }

    const themes = PRIORITY.filter((name) => found[name] !== undefined && VOCABULARY.includes(name))
      .slice(0, MAX_THEMES);

    return { themes, reason: themes.length ? reasonFor(themes, found, { me, playedSan }) : '' };
  }

  // ── one sentence, naming only what was counted ──────────────────────────

  function reasonFor(themes, found, ctx) {
    const mateThemes = ['mateIn1', 'mateIn2', 'mateIn3', 'missedMate'];
    const lead = themes.find((t) => mateThemes.indexOf(t) === -1) || themes[0];

    let sentence = sentenceFor(lead, found, ctx);
    if (!sentence) return '';

    const mate = themes.find((t) => t !== lead && t.indexOf('mateIn') === 0);
    if (mate) {
      sentence = sentence.replace(/\.$/, '') + ', and it is mate in ' + COUNT_WORD[found[mate]] + '.';
    } else if (lead !== 'missedMate' && themes.indexOf('missedMate') !== -1) {
      sentence = sentence.replace(/\.$/, '') + ', and you had a forced mate here instead.';
    }
    return sentence;
  }

  function sentenceFor(theme, found, ctx) {
    const e = found[theme];

    if (theme === 'hangingPiece') {
      const what = 'the ' + wordOf(e.piece) + ' on ' + squareName(e.sq);
      return e.defended
        ? 'You left ' + what + ' defended too lightly, and the exchange there costs you ' + pawnsWord(e.net) + '.'
        : 'You left ' + what + ' attacked and undefended.';
    }

    if (theme === 'fork') {
      const parts = e.targets.map((t) => yours(t.piece, t.sq));
      const list = e.check ? listOf(['your king'].concat(parts)) : listOf(parts);
      return 'Their ' + wordOf(e.mover) + ' on ' + squareName(e.moverSq) + ' forks ' + list + '.';
    }

    if (theme === 'pin') {
      return 'Their ' + wordOf(e.slider) + ' on ' + squareName(e.sliderSq)
        + ' pins ' + yours(e.front, e.frontSq) + ' against '
        + (typeOf(e.back) === KING ? 'your king on ' + squareName(e.backSq) : yours(e.back, e.backSq)) + '.';
    }

    if (theme === 'skewer') {
      return 'Their ' + wordOf(e.slider) + ' on ' + squareName(e.sliderSq)
        + ' skewers ' + (typeOf(e.front) === KING ? 'your king on ' + squareName(e.frontSq) : yours(e.front, e.frontSq))
        + ' with ' + yours(e.back, e.backSq) + ' behind it.';
    }

    if (theme === 'discoveredAttack') {
      return 'Moving off ' + squareName(e.vacated) + ' uncovered '
        + theirs(e.slider, e.sliderSq) + ' onto '
        + (typeOf(e.target) === KING ? 'your king on ' + squareName(e.targetSq) : yours(e.target, e.targetSq)) + '.';
    }

    if (theme === 'backRankMate') {
      const squares = e.blockers.map((b) => squareName(b.sq));
      return 'You were mated on the back rank by ' + theirs(e.mater, e.materSq)
        + ', with ' + listOf(squares) + ' blocked by your own pieces.';
    }

    if (theme === 'trappedPiece') {
      return 'Your ' + wordOf(e.piece) + ' on ' + squareName(e.sq)
        + ' is attacked and has no square to go to.';
    }

    if (theme === 'exposedKing') {
      return 'That left your king with '
        + (e.after === 0 ? 'no square to go to' : 'one square to go to')
        + ' where it had ' + e.before + ', and their line comes with check.';
    }

    if (theme === 'lostMaterial') {
      return 'The line that follows leaves you ' + pawnsWord(e.cp) + ' down.';
    }

    if (theme === 'missedMate') {
      return 'You had a forced mate here and played ' + ctx.playedSan + ' instead.';
    }

    if (theme.indexOf('mateIn') === 0) {
      return 'You allowed mate in ' + COUNT_WORD[found[theme]] + '.';
    }

    return '';
  }

  return { classify, VOCABULARY, PRIORITY };
})();

/**
 * Name the motif behind one mistake.
 *
 * @param {{fenBefore: string, playedUci: string, bestUci: ?string,
 *          replyUci: ?string, replyLine: ?string[], cpLoss: ?number,
 *          mate: ?('allowed'|'missed')}} input
 * @returns {{themes: string[], reason: string}}
 */
function classifyMistake(input) {
  return MOTIFS.classify(input || {});
}
