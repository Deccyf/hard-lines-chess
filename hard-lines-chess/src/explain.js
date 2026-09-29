// ── why a move was played, and what it does ────────────────────────────────
//
// The Watch screen's commentary when Stockfish is one of the players. It used
// to say one thing about a move: whether a deeper search agreed with it, and if
// not, what it cost. That is a verdict, not an explanation, and against a
// strong player it says almost nothing at all — every move IS the best move,
// so every note read "the engine agrees".
//
// This says why. But only from things that were measured:
//
//   STOCKFISH'S OWN ANALYSIS, before and after the move: its best move, the
//   line it expects to follow, how it scores the position, and its next two
//   choices. The line is the engine's actual reason — it plays a move because
//   it expects that sequence, and prefers it to the runner-up by that much.
//
//   THE BOARD: what the move captured, whether it checks, castles, develops or
//   promotes; which of the other side's pieces it newly attacks, counted with
//   the move generator; whether it threatens mate if it were allowed another
//   move straight away.
//
//   THE MOTIF CLASSIFIER from motifs.js, which names a fork or a pin only when
//   replaying the line and counting on the board proves one. Every move is a
//   reply to the move before it, so running the classifier with the previous
//   move as "the mistake" and this move as "the punishment" says what this
//   move does to the other side; running it with this move as the mistake and
//   the best reply as the punishment says what a weaker move allows.
//
// WHAT IT WILL NOT SAY. A plan the line does not show. A strong move made for
// reasons twenty moves deep has, as its honest explanation, the line and the
// number — and that is what it gets, rather than a human-sounding story that
// was never computed.
//
// No state and no search except one small one for a mate threat, so every
// function here can be tested from canned analysis in node.

const EXPLAIN_VALUE = { [PAWN]: 1, [KNIGHT]: 3, [BISHOP]: 3, [ROOK]: 5, [QUEEN]: 9, [KING]: 100 };
const EXPLAIN_NAME = { [PAWN]: 'pawn', [KNIGHT]: 'knight', [BISHOP]: 'bishop', [ROOK]: 'rook', [QUEEN]: 'queen', [KING]: 'king' };
const EXPLAIN_HOME = {
  [WHITE]: { [KNIGHT]: ['b1', 'g1'], [BISHOP]: ['c1', 'f1'] },
  [BLACK]: { [KNIGHT]: ['b8', 'g8'], [BISHOP]: ['c8', 'f8'] },
};

/**
 * How many moves of Stockfish's line are printed — and, the same number, how
 * far its highlights are read. They were different once: the highlights
 * looked ten moves deep and the text printed six, so a note would say "White
 * castles" beside a line in which nobody did. What is pointed out has to be
 * in what is shown.
 */
const EXPLAIN_LINE_PLIES = 8;

const colourWord = (c) => (c === WHITE ? 'White' : 'Black');
const pieceWord = (piece) => EXPLAIN_NAME[typeOf(piece)];

/** A UCI string back to this board's move, or null if it is not legal here. */
function moveFromUci(board, uci) {
  if (!uci) return null;
  return board.legalMoves().find((m) => moveToUci(m) === uci) ?? null;
}

/**
 * A Stockfish score (from the side to move) as the app's own engine would
 * write it, so plainEval() can put it into words. A mate in N moves becomes a
 * score N moves inside the mate edge, which is how plainEval counts back to N.
 */
function scoreToApp(score) {
  if (!score) return 0;
  if (score.mate !== undefined) {
    if (score.mate === 0) return -CHECKMATE_SCORE;
    return score.mate > 0 ? CHECKMATE_SCORE - (2 * score.mate - 1) : -(CHECKMATE_SCORE - 2 * -score.mate);
  }
  return score.cp;
}

/**
 * The value of a move to the side that played it, from the two analyses
 * either side of it: the candidate's own score if Stockfish listed it among
 * its choices, otherwise the negation of the reply's best. A game that the
 * move finishes is worth what the finish is worth.
 */
function playedValue(uci, a0, a1, outcome) {
  if (outcome === 'checkmate') return 100000;
  if (outcome) return 0;
  const listed = a0?.lines?.find((l) => l.move === uci);
  if (listed) return stockfishValue(listed.score);
  if (a1?.lines?.length) return -stockfishValue(a1.lines[0].score);
  return null;
}

/** Stockfish's line as numbered moves, starting from `board`. */
function lineAsSan(board, ucis, limit = EXPLAIN_LINE_PLIES) {
  const copy = new Board(board.fen());
  const out = [];
  for (const uci of ucis.slice(0, limit)) {
    const move = moveFromUci(copy, uci);
    if (!move) break;
    const number = copy.turn === WHITE ? `${copy.fullmove}.` : (out.length === 0 ? `${copy.fullmove}…` : '');
    out.push(number + toSan(copy, move));
    copy.make(move);
  }
  return out.join(' ');
}

/**
 * What stands out in a line, counted by replaying it.
 *
 * Three things only, because they are the three a person reading a line of
 * moves most often misses: who castles, where the pieces are traded, and a
 * piece that moves more than once — the engine re-routing something, which is
 * a plan in the most literal sense. Anything else in the line is just moves.
 */
function lineHighlights(board, ucis, limit = EXPLAIN_LINE_PLIES) {
  const copy = new Board(board.fen());
  const castles = [];
  const trades = [];
  const journeys = new Map();     // square the piece stands on now -> { piece, path }
  let lastCaptureSq = null;
  for (const uci of ucis.slice(0, limit)) {
    const move = moveFromUci(copy, uci);
    if (!move) break;
    const from = moveFrom(move), to = moveTo(move);
    const piece = copy.squares[from];
    const flags = moveFlags(move);
    if (flags & FLAG_CASTLE) castles.push({ colour: colourOf(piece), side: to > from ? 'kingside' : 'queenside' });
    if (flags & FLAG_CAPTURE) {
      // A capture on the square the last capture happened on is the other half
      // of a trade.
      if (lastCaptureSq === to && !trades.includes(to)) trades.push(to);
      lastCaptureSq = to;
    } else {
      lastCaptureSq = null;
    }
    if (typeOf(piece) !== PAWN && typeOf(piece) !== KING && !(flags & FLAG_CASTLE)) {
      const trail = journeys.get(from) ?? { piece, path: [from] };
      journeys.delete(from);
      trail.path.push(to);
      journeys.set(to, trail);
    }
    // A piece captured mid-journey is gone, and so is its trail.
    if (flags & FLAG_CAPTURE) {
      for (const [sq, trail] of journeys) if (sq === to && trail.piece !== piece) journeys.delete(sq);
    }
    copy.make(move);
  }
  const travellers = [...journeys.values()].filter((t) => t.path.length >= 3);
  return { castles, trades, travellers };
}

/** A list as a person writes one: "a", "a and b", "a, b and c". */
function listWords(xs) {
  if (xs.length < 2) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/** The highlights in words, or ''. At most two, so the line is still the point. */
function highlightWords(h) {
  const parts = [];
  if (h.castles.length === 2 && h.castles[0].colour !== h.castles[1].colour) parts.push('both sides castle');
  else if (h.castles.length) parts.push(`${colourWord(h.castles[0].colour)} castles ${h.castles[0].side}`);
  if (h.trades.length) parts.push(`pieces are exchanged on ${listWords(h.trades.slice(0, 2).map(squareName))}`);
  const t = h.travellers[0];
  if (t) {
    const [start, ...rest] = t.path.map(squareName);
    const route = rest.length === 1 ? rest[0] : `${rest.slice(0, -1).join(', ')} and then ${rest[rest.length - 1]}`;
    parts.push(`the ${pieceWord(t.piece)} on ${start} goes on to ${route}`);
  }
  return parts.slice(0, 2).join(', and ');
}

/** What the move itself is, on the board — the facts a person sees first. */
function moveFacts(before, move, prev) {
  const from = moveFrom(move), to = moveTo(move), flags = moveFlags(move);
  const piece = before.squares[from];
  const after = new Board(before.fen());
  after.make(move);
  const facts = { piece, from, to, colour: colourOf(piece) };
  if (flags & FLAG_CASTLE) facts.castle = to > from ? 'kingside' : 'queenside';
  if (flags & FLAG_CAPTURE) {
    const victim = flags & FLAG_EP ? (PAWN | (facts.colour === WHITE ? BLACK : WHITE)) : before.squares[to];
    facts.capture = { piece: victim, sq: to };
    if (prev && (moveFlags(prev) & FLAG_CAPTURE) && moveTo(prev) === to) facts.recapture = true;
  }
  if (movePromo(move)) facts.promote = EXPLAIN_NAME[movePromo(move)];
  const home = EXPLAIN_HOME[facts.colour]?.[typeOf(piece)];
  if (home?.includes(squareName(from)) && before.fullmove <= 15) facts.develops = true;
  facts.check = after.inCheck();
  facts.outcome = after.outcome();
  return { facts, after };
}

/** The move's facts as one short sentence, or ''. */
function factsSentence(f) {
  if (f.outcome === 'checkmate') return 'Checkmate.';
  const bits = [];
  if (f.castle) bits.push(`castles ${f.castle}`);
  else if (f.recapture) bits.push(`recaptures on ${squareName(f.to)}`);
  else if (f.capture) bits.push(`takes the ${pieceWord(f.capture.piece)} on ${squareName(f.capture.sq)}`);
  else if (f.develops) bits.push(`develops the ${pieceWord(f.piece)} to ${squareName(f.to)}`);
  if (f.promote) bits.push(`promotes to a ${f.promote}`);
  if (f.check) bits.push('with check');
  if (!bits.length) return '';
  const text = bits.join(' ').replace(' with check', ', with check');
  return text[0].toUpperCase() + text.slice(1) + '.';
}

/** The same position with the other side to move — a pass — or null if that is not a position. */
function passedBoard(board) {
  if (board.inCheck() || board.outcome()) return null;
  const parts = board.fen().split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  let passed;
  try { passed = new Board(parts.join(' ')); } catch { return null; }
  // The side that just moved cannot be left in check by the pass.
  if (passed.inCheck(passed.turn === WHITE ? BLACK : WHITE)) return null;
  return passed;
}

/**
 * What a side can take, and is glad to: every legal capture of a piece that
 * is either undefended or worth more than the piece taking it. Counted with
 * the move generator on the board as given, with `board.turn` as the taker.
 */
function captureTargets(board) {
  const taker = board.turn;
  const owner = taker === WHITE ? BLACK : WHITE;
  const out = new Map();     // victim square -> { victim, attacker }
  for (const m of board.legalMoves()) {
    if (!(moveFlags(m) & FLAG_CAPTURE) || (moveFlags(m) & FLAG_EP)) continue;
    const victim = board.squares[moveTo(m)];
    if (!victim || typeOf(victim) === KING) continue;
    const attacker = board.squares[moveFrom(m)];
    const loose = !board.attacked(moveTo(m), owner);
    const cheaper = EXPLAIN_VALUE[typeOf(attacker)] < EXPLAIN_VALUE[typeOf(victim)];
    if (!loose && !cheaper) continue;
    const had = out.get(moveTo(m));
    if (!had || EXPLAIN_VALUE[typeOf(attacker)] < EXPLAIN_VALUE[typeOf(had.attacker)]) {
      out.set(moveTo(m), { victim, attacker, loose, sq: moveTo(m) });
    }
  }
  return out;
}

/**
 * What the move threatens: a piece of the other side's it newly attacks for
 * profit, or mate if it were allowed to move again. Null when it threatens
 * nothing that can be counted.
 *
 * NEWLY, because a piece that was already hanging before the move was not put
 * there by it. The mate threat is the one search in this file, and a small
 * one: the app's own engine, which is sharp over two or three moves and is
 * only asked whether a mate exists.
 */
function moveThreat(before, after, search) {
  const passed = passedBoard(after);
  if (!passed) return null;

  if (search) {
    const r = search(passed);
    if (r && r.move && r.score > MATE_EDGE) {
      const moves = Math.max(1, Math.ceil((CHECKMATE_SCORE - r.score) / 2));
      return { kind: 'mate', moves, san: toSan(passed, r.move) };
    }
  }

  const now = captureTargets(passed);
  const was = captureTargets(before);
  let best = null;
  for (const [sq, t] of now) {
    if (was.has(sq)) continue;
    if (!best || EXPLAIN_VALUE[typeOf(t.victim)] > EXPLAIN_VALUE[typeOf(best.victim)]) best = t;
  }
  return best ? { kind: 'piece', ...best } : null;
}

function threatSentence(t, mover) {
  if (!t) return '';
  const other = mover === 'White' ? 'Black' : 'White';
  if (t.kind === 'mate') {
    return t.moves === 1
      ? `It threatens mate with ${t.san}, so ${other} has to deal with that first.`
      : `It threatens a forced mate starting with ${t.san}.`;
  }
  const what = `${other}'s ${pieceWord(t.victim)} on ${squareName(t.sq)}`;
  return t.loose
    ? `It attacks ${what}, which nothing defends.`
    : `It attacks ${what} with a ${pieceWord(t.attacker)}.`;
}

/**
 * A motif from motifs.js, said in the third person about named sides.
 * `attacker` is the side doing it, `victim` the side it is done to.
 */
function tacticSentence(motif, attacker, victim) {
  if (!motif?.themes?.length) return '';
  const d = motif.details ?? {};
  const theirs = (piece, sq) => `${victim}'s ${pieceWord(piece)} on ${squareName(sq)}`;
  const own = (piece, sq) => `${attacker}'s ${pieceWord(piece)} on ${squareName(sq)}`;
  for (const theme of motif.themes) {
    const e = d[theme];
    if (theme === 'fork' && e) {
      const targets = e.targets.map((t) => `${pieceWord(t.piece)} on ${squareName(t.sq)}`);
      if (e.check) targets.unshift('king');
      return `${own(e.mover, e.moverSq)} forks ${victim}'s ${listWords(targets)}.`;
    }
    if (theme === 'pin' && e) {
      return `${own(e.slider, e.sliderSq)} pins ${theirs(e.front, e.frontSq)} to ${typeOf(e.back) === KING ? 'the king' : `the ${pieceWord(e.back)} on ${squareName(e.backSq)}`}.`;
    }
    if (theme === 'skewer' && e) {
      return `${own(e.slider, e.sliderSq)} skewers ${theirs(e.front, e.frontSq)}, with the ${pieceWord(e.back)} on ${squareName(e.backSq)} behind it.`;
    }
    if (theme === 'discoveredAttack' && e) {
      return `Moving off ${squareName(e.vacated)} uncovers ${own(e.slider, e.sliderSq)} onto ${typeOf(e.target) === KING ? `${victim}'s king` : theirs(e.target, e.targetSq)}.`;
    }
    if (theme === 'hangingPiece' && e) {
      return e.defended
        ? `${victim}'s ${pieceWord(e.piece)} on ${squareName(e.sq)} was defended too lightly, and the exchange there wins about ${Math.round(e.net / 100)} ${Math.round(e.net / 100) === 1 ? 'point' : 'points'}.`
        : `${victim} left the ${pieceWord(e.piece)} on ${squareName(e.sq)} undefended, and it falls.`;
    }
    if (theme === 'backRankMate' && e) {
      return `Mate on the back rank: ${victim}'s king is shut in by its own pieces.`;
    }
    if (theme === 'trappedPiece' && e) {
      return `${victim}'s ${pieceWord(e.piece)} on ${squareName(e.sq)} is attacked and has nowhere to go.`;
    }
    if (theme.startsWith('mateIn') && typeof e === 'number') {
      return `It forces mate in ${e === 1 ? 'one' : e === 2 ? 'two' : 'three'}.`;
    }
    if (theme === 'exposedKing' && e) {
      return `${victim}'s king is left with ${e.after === 0 ? 'no square' : 'one square'} to go to, and checks follow.`;
    }
    // lostMaterial is never said here. It is the classifier's last resort —
    // material counted at the far end of a line — and a line that the node
    // budget cut off mid-exchange counts a piece as lost that is about to be
    // taken back. The verdict already gives the cost, from the engine's score.
  }
  return '';
}

/**
 * Whether a motif is worth saying about THIS move, rather than merely true.
 *
 * THE CLASSIFIER WAS BUILT FOR MISTAKES, and on a mistake everything it finds
 * matters. Asked about every move of a game it finds things that are true and
 * irrelevant: a bishop on c4 "pinning" the f7 pawn to the knight behind it,
 * or a recapture in an exchange that one side started on purpose, written up
 * as the other side leaving a piece loose. So:
 *
 *   A MOVE ONLY PUNISHES SOMETHING THAT WAS GIVEN AWAY. "Black left the knight
 *   undefended" is said only when Stockfish scores the previous move as having
 *   cost at least half a point, and never of a recapture — a trade is a trade.
 *   The same goes for a piece being trapped or a king left bare.
 *
 *   A PIN HAS TO PIN SOMETHING. To the king or the queen, or a piece to one
 *   worth more — not a pawn to a knight.
 *
 *   A SKEWER HAS TO WIN SOMETHING. The classifier's skewer is any line with
 *   the dearer piece in front, which includes a bishop "skewering" a defended
 *   knight with a pawn behind it — true to the definition and nothing a
 *   player would call a skewer. So: something behind worth more than a pawn,
 *   and in front the king, or a piece worth more than the one doing it.
 *
 * Forks, skewers, discovered attacks and mates are facts about the move
 * itself, verified by the classifier, and are said whenever they happen.
 */
function significantMotif(motif, { prevLoss = null, recapture = false } = {}) {
  if (!motif?.themes?.length) return null;
  const gaveSomething = prevLoss !== null && prevLoss >= 50;
  const d = motif.details ?? {};
  const kept = motif.themes.filter((theme) => {
    const e = d[theme];
    if (theme === 'lostMaterial') return false;
    if (theme === 'hangingPiece') return gaveSomething && !recapture;
    if (theme === 'trappedPiece' || theme === 'exposedKing') return gaveSomething;
    if (theme === 'pin' && e) {
      const back = typeOf(e.back), front = typeOf(e.front);
      return back === KING || back === QUEEN || (front !== PAWN && EXPLAIN_VALUE[back] > EXPLAIN_VALUE[front]);
    }
    if (theme === 'skewer' && e) {
      const back = typeOf(e.back), front = typeOf(e.front);
      return back !== PAWN && (front === KING || EXPLAIN_VALUE[front] > EXPLAIN_VALUE[typeOf(e.slider)]);
    }
    return true;
  });
  return kept.length ? { ...motif, themes: kept } : null;
}

/** A difference in centipawns, as the screens say one: "0.4 of a point", "1.5 points". */
function pointsWords(cp) {
  const x = (cp / 100).toFixed(1);
  return cp < 100 ? `${x} of a point` : `${x} points`;
}

/**
 * Why this move and not the next one, by the count of the engine that chose
 * it: `gap` is how far behind its next best was. Stockfish's own words are
 * the plain ones; another engine's say whose count it is.
 */
function alternativeSentence(name, secondSan, gap) {
  const stockfish = name === 'Stockfish';
  if (gap >= 150) {
    return stockfish
      ? `It is the only good move here: the next best, ${secondSan}, is ${(gap / 100).toFixed(1)} points worse.`
      : `For ${name} it was the only good move: its next best, ${secondSan}, is ${(gap / 100).toFixed(1)} points worse.`;
  }
  if (gap <= 20) return stockfish ? `${secondSan} was just as good.` : `${name} rated ${secondSan} just as good.`;
  return stockfish
    ? `The next best was ${secondSan}, ${(gap / 100).toFixed(1)} of a point behind.`
    : `${name}'s next best was ${secondSan}, ${(gap / 100).toFixed(1)} of a point behind.`;
}

/**
 * Everything worth saying about one move.
 *
 * @param {object} p
 * @param {string}  p.fenBefore  the position the move was played in
 * @param {string}  p.uci        the move
 * @param {?string} p.prevFen    the position before the previous move, for "what this punishes"
 * @param {?string} p.prevUci    the previous move
 * @param {?object} p.aPrev      Stockfish on prevFen — what says whether the previous move gave anything away
 * @param {object}  p.a0         Stockfish on fenBefore (the mover to move)
 * @param {?object} p.a1         Stockfish after the move (the other side to move); null if the game ended
 * @param {?string} p.outcome    how the game stands after the move, from a board that knows the game's
 *                               history — a repetition, which a board made from the FEN alone cannot see
 * @param {boolean} p.isEngine   true when the mover IS Stockfish — its move is its choice by definition
 * @param {?string} p.chooser    the name of another engine that chose the move (Reckless), or null
 * @param {?object} p.own        that engine's own analysis of fenBefore — where its line comes from
 * @param {?Function} p.search   (board) -> {move, score}: a small search for a mate threat, or null to skip
 * @returns {{verdict: string, tone: string, sentences: string[], facts: object}}
 */
function explainMove(p) {
  const before = new Board(p.fenBefore);
  const move = moveFromUci(before, p.uci);
  if (!move) return { verdict: '', tone: 'note', sentences: [], facts: {} };
  const mover = colourWord(before.turn);
  const other = mover === 'White' ? 'Black' : 'White';
  const san = toSan(new Board(p.fenBefore), move);

  let prevMove = null;
  if (p.prevFen && p.prevUci) prevMove = moveFromUci(new Board(p.prevFen), p.prevUci);
  const { facts, after } = moveFacts(before, move, prevMove);
  if (p.outcome) facts.outcome = p.outcome;

  const a0 = p.a0, a1 = p.a1;
  const bestUci = a0?.best ?? null;
  const bestMove = moveFromUci(before, bestUci);
  const bestSan = bestMove ? toSan(new Board(p.fenBefore), bestMove) : null;
  const bestValue = a0?.lines?.length ? stockfishValue(a0.lines[0].score) : null;
  const value = playedValue(p.uci, a0, a1, facts.outcome);
  const loss = bestValue !== null && value !== null ? Math.max(0, bestValue - value) : 0;
  const isBest = p.isEngine || p.uci === bestUci || loss < 20;

  // THE SCORE ON THE BOARD NOW, from White's side, in words.
  let whiteNow = null;
  if (facts.outcome === 'checkmate') whiteNow = mover === 'White' ? CHECKMATE_SCORE : -CHECKMATE_SCORE;
  else if (facts.outcome) whiteNow = 0;
  else if (a1?.lines?.length) {
    const s = scoreToApp(a1.lines[0].score);           // from the side now to move
    whiteNow = after.turn === WHITE ? s : -s;
  }
  const evalWords = facts.outcome && facts.outcome !== 'checkmate'
    ? 'The game is drawn'
    : whiteNow === null ? '' : plainEval(whiteNow, 'White').replace(/^./, (c) => c.toUpperCase());
  // A verdict, and then where the game stands — when that is known.
  const withEval = (text) => (evalWords ? `${text}. ${evalWords}.` : `${text}.`);

  const depth = a0?.depth ?? 0;
  const ahead = depth ? `looking about ${Math.max(1, Math.round(depth / 2))} moves ahead` : '';

  // A MATE IS NOT A NUMBER OF POINTS. Scores carry mates as values pushed past
  // anything a position can be worth, so the difference between a mate and a
  // pawn up is a meaningless 990-odd "points". Where a mate is involved the
  // verdict says what happened to it instead.
  const MATE_VALUE = 90000;
  const allowsMate = value !== null && value <= -MATE_VALUE && (bestValue === null || bestValue > -MATE_VALUE);
  const missesMate = bestValue !== null && bestValue >= MATE_VALUE && (value === null || value < MATE_VALUE);
  const bestMate = a0?.lines?.[0]?.score?.mate;
  const slowerWin = missesMate && value !== null && value >= 300;

  const sentences = [];
  const out = { facts: { san, mover, loss, isBest, bestSan, depth, whiteNow, ...facts }, sentences };

  if (facts.outcome === 'checkmate') {
    out.verdict = `Checkmate. ${mover} wins.`;
    out.tone = 'good-note';
    const tactic = p.prevFen ? tacticSentence(classifyMistake({
      fenBefore: p.prevFen, playedUci: p.prevUci, replyUci: p.uci, replyLine: [p.uci],
    }), mover, other) : '';
    if (tactic && /back rank/.test(tactic)) sentences.push(tactic);
    return out;
  }

  // ── a move Stockfish would play, or did — or another engine chose ────────
  //
  // ANOTHER ENGINE'S MOVE IS EXPLAINED LIKE STOCKFISH'S OWN — what it does, what
  // it threatens, the line it expects — from that engine's analysis, because
  // its line is ITS reason. Stockfish's opinion of it is the verdict: two of
  // the strongest engines there are, agreeing or not, and by how much. It is
  // not called a mistake; at this budget each is right far more often than
  // either can prove the other wrong, and the rest of the game says who was.
  const chooser = p.chooser ?? null;
  const reasoner = chooser ? { name: chooser, analysis: p.own ?? null } : { name: 'Stockfish', analysis: a0 };
  if (isBest || chooser) {
    if (!chooser) {
      out.tone = 'good-note';
      out.verdict = p.isEngine
        ? withEval(`Stockfish's choice${ahead ? `, ${ahead}` : ''}`)
        : withEval(`Stockfish agrees${ahead ? `, ${ahead}` : ''}`);
    } else {
      const ownDepth = p.own?.depth ?? 0;
      const chosen = `${chooser}'s choice${ownDepth ? `, looking about ${Math.max(1, Math.round(ownDepth / 2))} moves ahead` : ''}`;
      if (isBest) {
        out.tone = 'good-note';
        out.verdict = withEval(`${chosen}. Stockfish agrees`);
      } else if (missesMate) {
        out.tone = slowerWin ? 'note' : 'bad-note';
        out.verdict = withEval(`${chosen}. Stockfish sees a forced mate instead: ${bestSan}, mating in ${bestMate}`);
      } else if (allowsMate) {
        out.tone = 'bad-note';
        out.verdict = withEval(`${chosen}. Stockfish thinks it lets ${other} force mate, which ${bestSan} did not`);
      } else {
        out.tone = loss >= 150 ? 'bad-note' : 'note';
        out.verdict = withEval(`${chosen}. Stockfish would have played ${bestSan}, ${pointsWords(loss)} better by its count`);
      }
    }

    // 1. WHAT IT DOES TO THE OTHER SIDE, when the board proves a motif — the
    //    previous move as the mistake, this one as the punishment.
    const line = (reasoner.analysis?.lines?.find((l) => l.move === p.uci)?.pv) ?? [p.uci, ...(a1?.lines?.[0]?.pv ?? [])];
    let tactic = '';
    if (p.prevFen && p.prevUci) {
      // What the previous move cost its player, from Stockfish either side of
      // it: its best before, against the reply's best after (negated, as the
      // reply's score is from the other side).
      const prevLoss = p.aPrev?.lines?.length && a0?.lines?.length
        ? stockfishValue(p.aPrev.lines[0].score) + stockfishValue(a0.lines[0].score)
        : null;
      const motif = significantMotif(
        classifyMistake({ fenBefore: p.prevFen, playedUci: p.prevUci, replyUci: p.uci, replyLine: line }),
        { prevLoss, recapture: facts.recapture },
      );
      if (motif) tactic = tacticSentence(motif, mover, other);
    }
    if (tactic) sentences.push(tactic);

    // 2. WHAT IT IS, on the board.
    const plain = factsSentence(facts);
    if (plain && !(tactic && facts.capture && !facts.recapture)) sentences.push(plain);

    // 3. WHAT IT THREATENS, if anything that can be counted.
    const threat = moveThreat(before, after, p.search);
    const threatText = threatSentence(threat, mover);
    if (threatText && !tactic) sentences.push(threatText);

    // 4. THE LINE IT EXPECTS, which is its reason in its own terms.
    const expected = line.slice(1);
    if (expected.length >= 2) {
      const moves = lineAsSan(after, expected);
      // Read from the position AFTER the move, so a piece's journey starts on
      // the square it stands on now — "the knight on c3 goes on to e2", not
      // "the knight on b1", which is where it no longer is.
      const words = highlightWords(lineHighlights(after, expected));
      sentences.push(`The line ${reasoner.name} expects: ${moves}${words ? ` — ${words}` : ''}.`);
    }

    // 5. WHY THIS AND NOT THE NEXT ONE, by the count of the engine that chose it.
    const lines = reasoner.analysis?.lines ?? [];
    const rest = lines.filter((l) => l.move !== p.uci);
    const played = lines.find((l) => l.move === p.uci);
    const top = chooser ? (played ? stockfishValue(played.score) : null)
      : bestValue === null ? null : (p.uci === bestUci ? bestValue : value ?? bestValue);
    if (rest.length && top !== null) {
      const second = rest[0];
      const secondMove = moveFromUci(before, second.move);
      const secondSan = secondMove ? toSan(new Board(p.fenBefore), secondMove) : second.move;
      sentences.push(alternativeSentence(reasoner.name, secondSan, top - stockfishValue(second.score)));
    }

    // 6. AND WHERE STOCKFISH DISAGREES BY A REAL MARGIN, what it wanted instead.
    if (chooser && !isBest) {
      const wanted = a0?.lines?.[0];
      const reply = a1?.lines?.[0];
      if (missesMate && wanted?.pv?.length && bestMate > 0) {
        sentences.push(`The mate Stockfish saw: ${lineAsSan(before, wanted.pv, Math.min(2 * bestMate - 1, 9))}.`);
      } else if (allowsMate && reply?.pv?.length && reply.score?.mate > 0) {
        sentences.push(`The mate Stockfish expects: ${lineAsSan(after, reply.pv, Math.min(2 * reply.score.mate - 1, 9))}.`);
      } else if (loss >= 50 && wanted?.pv?.length >= 2 && bestMove) {
        const afterBest = new Board(p.fenBefore);
        afterBest.make(bestMove);
        const moves = lineAsSan(afterBest, wanted.pv.slice(1), 4);
        sentences.push(`Stockfish wanted ${bestSan}${moves ? `, expecting ${moves}` : ''}.`);
      }
    }
    return out;
  }

  // ── a move Stockfish would not have played ───────────────────────────────
  let severity = severityFor(loss);
  if (slowerWin) {
    // Still winning, just not by force: a slower win, not a lost game.
    severity = 'inaccuracy';
    out.verdict = withEval(`Not the quickest: Stockfish's ${bestSan} forces mate in ${bestMate}, and this lets that go`);
  } else if (missesMate) {
    severity = 'blunder';
    out.verdict = withEval(`Blunder: it misses a forced mate — Stockfish's ${bestSan} mates in ${bestMate}`);
  } else if (allowsMate) {
    severity = 'blunder';
    out.verdict = withEval(`Blunder: this lets ${other} force mate, which Stockfish's ${bestSan} did not`);
  } else {
    const cost = `${(loss / 100).toFixed(1)} points`;
    out.verdict = severity
      ? withEval(`${severity[0].toUpperCase()}${severity.slice(1)}: about ${cost} worse than Stockfish's ${bestSan}`)
      : withEval(`Slightly worse than Stockfish's ${bestSan}`);
  }
  out.tone = severity === 'blunder' || severity === 'mistake' ? 'bad-note' : 'note';

  const plain = factsSentence(facts);
  if (plain) sentences.push(plain);

  // WHAT IT ALLOWS: the other side's best reply, and what the board says that
  // reply does — this move as the mistake, the reply as the punishment.
  //
  // Not said of a missed mate: there the story is the mate, and the other
  // side's best reply to a quiet move is beside the point.
  const reply = a1?.lines?.[0];
  if (reply?.move && severity && reply.score?.mate > 0) {
    // A mate is its own explanation: the whole of it, as far as the line goes.
    const moves = lineAsSan(after, reply.pv, Math.min(2 * reply.score.mate - 1, 9));
    sentences.push(`It allows mate in ${reply.score.mate}: ${moves}.`);
  } else if (reply?.move && severity && !missesMate) {
    const replyMove = moveFromUci(after, reply.move);
    const replySan = replyMove ? toSan(new Board(after.fen()), replyMove) : reply.move;
    // A mistake did give something away, by definition, so the significance
    // rule is asked with the cost already known.
    const motif = significantMotif(
      classifyMistake({ fenBefore: p.fenBefore, playedUci: p.uci, replyUci: reply.move, replyLine: reply.pv }),
      { prevLoss: loss },
    );
    const tactic = motif ? tacticSentence(motif, other, mover) : '';
    // Without a named motif the refutation is shown rather than described: the
    // moves are the explanation, and they are Stockfish's.
    const line = reply.pv.length >= 2 ? lineAsSan(after, reply.pv, 4) : '';
    sentences.push(tactic
      ? `It allows ${replySan}. ${tactic}`
      : `It allows ${replySan}${line ? ` — ${line}` : ''}.`);
  }

  // WHAT STOCKFISH WANTED, and the line that went with it.
  const wanted = a0?.lines?.[0];
  if (missesMate && wanted?.pv?.length && bestMate > 0) {
    const moves = lineAsSan(before, wanted.pv, Math.min(2 * bestMate - 1, 9));
    sentences.push(`The mate Stockfish saw: ${moves}.`);
  } else if (wanted?.pv?.length >= 2 && bestSan) {
    const afterBest = new Board(p.fenBefore);
    afterBest.make(bestMove);
    const moves = lineAsSan(afterBest, wanted.pv.slice(1), 4);
    sentences.push(`Stockfish wanted ${bestSan}${moves ? `, expecting ${moves}` : ''}.`);
  }
  return out;
}
