// spellMove(), against the notation the rest of the app writes.
//
// The notation screen takes a move apart and says why each character of it is
// there. That explanation is a SECOND implementation of the rules toSan()
// already implements, and two implementations of the same rules is exactly the
// shape of thing that drifts: a change to disambiguation in one and not the
// other would leave a screen confidently teaching a rule the app itself no
// longer follows, with nothing to notice.
//
// So they are held together here, on every legal move of every position of a
// few hundred random games — a hundred thousand or so moves, castling,
// promotion, en passant and the ambiguous ones included. The parts joined back
// together have to BE the string toSan() produces. Not similar to it.
import { readFileSync } from 'node:fs';

const src = [
  readFileSync(new URL('../src/engine/bundle.js', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/notation.js', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/notation-lessons.js', import.meta.url), 'utf8'),
].join('\n');
const { Board, toSan, spellMove, moveToUci, NOTATION_LESSONS } =
  new Function('window', src + '; return { Board, toSan, spellMove, moveToUci, NOTATION_LESSONS };')({});

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; } else { fail++; console.log('  FAIL', name, extra); }
};

// ── the lessons say what the engine says ───────────────────────────────────
const ids = new Set();
for (const lesson of NOTATION_LESSONS) {
  ok(`${lesson.id}: id is unique`, !ids.has(lesson.id));
  ids.add(lesson.id);
  ok(`${lesson.id}: has a rule worth reading`, typeof lesson.rule === 'string' && lesson.rule.length > 80);
  ok(`${lesson.id}: has a name`, typeof lesson.name === 'string' && lesson.name.length > 8);

  const board = new Board(lesson.fen);
  const move = board.legalMoves().find((m) => moveToUci(m) === lesson.uci);
  ok(`${lesson.id}: the move is legal in the position`, Boolean(move));
  if (!move) continue;
  const written = toSan(new Board(lesson.fen), move);
  ok(`${lesson.id}: the app writes ${lesson.san}`, written === lesson.san, `it writes ${written}`);
  const spelled = spellMove(new Board(lesson.fen), move);
  ok(`${lesson.id}: the explanation spells ${lesson.san}`, spelled.san === written, `it spells ${spelled.san}`);
  for (const part of spelled.parts) {
    ok(`${lesson.id}: "${part.text}" has a label`, typeof part.label === 'string' && part.label.length > 2);
    ok(`${lesson.id}: "${part.text}" has a reason`, typeof part.why === 'string' && part.why.length > 25);
  }
}

// ── and so does every move of a few hundred games ──────────────────────────
//
// A fixed seed, so a disagreement found here is a disagreement anybody can
// reproduce rather than one that appeared once on a Tuesday.
let seed = 20260906;
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

let moves = 0, positions = 0, mismatch = null;
const seen = { castle: 0, promo: 0, ep: 0, disambig: 0, check: 0, mate: 0 };
for (let game = 0; game < 400 && !mismatch; game++) {
  const board = new Board();
  for (let ply = 0; ply < 120; ply++) {
    const legal = board.legalMoves();
    if (!legal.length || board.outcome()) break;
    positions++;
    for (const move of legal) {
      // A fresh board for each, because both of these play the move to read the
      // check mark off the position afterwards.
      const fen = board.fen();
      const written = toSan(new Board(fen), move);
      const spelled = spellMove(new Board(fen), move);
      moves++;
      if (spelled.san !== written) { mismatch = { fen, uci: moveToUci(move), written, spelled: spelled.san }; break; }
      if (written.startsWith('O-O')) seen.castle++;
      if (written.includes('=')) seen.promo++;
      if (written.endsWith('#')) seen.mate++;
      else if (written.endsWith('+')) seen.check++;
      if (/^[NBRQK][a-h1-8]/.test(written) && written.length > (written.includes('x') ? 4 : 3)) seen.disambig++;
      if (written[1] === 'x' && written[0] >= 'a' && written[0] <= 'h') seen.ep++; // pawn captures, en passant among them
    }
    if (mismatch) break;
    board.make(legal[Math.floor(rand() * legal.length)]);
  }
}

ok('every move spells the same as it is written', mismatch === null,
  mismatch ? `${mismatch.uci} in ${mismatch.fen}: written ${mismatch.written}, spelled ${mismatch.spelled}` : '');

// A SAMPLE THAT NEVER MET THE HARD CASES WOULD PASS AND PROVE NOTHING. These
// are the cases the two implementations could disagree about at all, so if the
// walk did not reach them the walk is not the test it claims to be.
ok('the walk met castling', seen.castle > 20, `saw ${seen.castle}`);
ok('the walk met promotions', seen.promo > 20, `saw ${seen.promo}`);
ok('the walk met pawn captures', seen.ep > 200, `saw ${seen.ep}`);
ok('the walk met disambiguation', seen.disambig > 200, `saw ${seen.disambig}`);
ok('the walk met checks', seen.check > 200, `saw ${seen.check}`);
ok('the walk met mates', seen.mate > 5, `saw ${seen.mate}`);

console.log(`${NOTATION_LESSONS.length} lessons, ${positions} positions, ${moves} moves spelled, ${pass} checks passed, ${fail} failed`);
console.log(`  met: ${seen.castle} castling, ${seen.promo} promotions, ${seen.disambig} disambiguated, ${seen.check} checks, ${seen.mate} mates`);
if (fail) process.exit(1);
