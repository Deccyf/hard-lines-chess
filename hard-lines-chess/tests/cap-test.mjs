// Hand-built rows the engine cannot produce, which is the point: the cap is a
// rule about kinds and must hold whatever the costs happen to be.
import { readFileSync } from 'node:fs';
const src = readFileSync('../src/review.js', 'utf8');
const ctx = {};
new Function('exports', src + '\nexports.capMateMoments = capMateMoments; exports.plainEval = plainEval; exports.scoreFinished = scoreFinished; exports.accuracyFrom = accuracyFrom; exports.MIN_JUDGED = MIN_JUDGED;')(ctx);
const { capMateMoments, plainEval, scoreFinished, accuracyFrom, MIN_JUDGED } = ctx;

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('  FAIL', name); } };

const row = (ply, kind, loss) => ({ ply, kind, loss, san: 'x' + ply, severity: 'blunder' });

// Seven missed mates and three material errors: the shape that took every slot.
const many = [
  row(1, 'material', 300), row(3, 'missed_mate', null), row(5, 'missed_mate', null),
  row(7, 'missed_mate', null), row(9, 'material', 250), row(11, 'missed_mate', null),
  row(13, 'missed_mate', null), row(15, 'missed_mate', null), row(17, 'missed_mate', null),
  row(19, 'material', 900),
];
let r = capMateMoments(many);
ok('material all kept', r.kept.filter((m) => m.kind === 'material').length === 3);
ok('one missed mate kept', r.kept.filter((m) => m.kind === 'missed_mate').length === 1);
ok('the EARLIEST missed mate', r.kept.find((m) => m.kind === 'missed_mate').ply === 3);
ok('six counted', r.capped.missed_mate === 6);
ok('no allowed counted', r.capped.allowed_mate === 0);
ok('order preserved', r.kept.map((m) => m.ply).join() === [1, 3, 9, 19].join());

// Both kinds present.
r = capMateMoments([row(2, 'allowed_mate', null), row(4, 'allowed_mate', null), row(6, 'missed_mate', null), row(8, 'missed_mate', null)]);
ok('one of each kept', r.kept.length === 2 && r.kept[0].kind === 'allowed_mate' && r.kept[1].kind === 'missed_mate');
ok('one of each counted', r.capped.allowed_mate === 1 && r.capped.missed_mate === 1);

// Cost must not decide anything: a cheap mate and an enormous material error.
r = capMateMoments([row(1, 'material', 12000), row(2, 'allowed_mate', null), row(3, 'allowed_mate', null)]);
ok('cost never decides', r.kept.map((m) => m.kind).join() === 'material,allowed_mate' && r.capped.allowed_mate === 1);

// Nothing to cap.
r = capMateMoments([row(1, 'material', 100), row(2, 'material', 200)]);
ok('no mates, nothing capped', r.kept.length === 2 && r.capped.allowed_mate === 0 && r.capped.missed_mate === 0);
r = capMateMoments([]);
ok('empty is empty', r.kept.length === 0);

// plainEval: who is winning, in words, from the named side.
ok('equal',      plainEval(20, 'White') === 'roughly equal');
ok('slight',     plainEval(120, 'White').startsWith('White is slightly better'));
ok('clear black', plainEval(-250, 'White').startsWith('Black is clearly better'));
ok('winning',    plainEval(900, 'Black').startsWith('Black is winning'));
ok('mate for',   plainEval(29996, 'White') === 'White forces checkmate in 2 moves');
ok('mate against', plainEval(-29998, 'White') === 'Black forces checkmate in 1 move');
ok('no score',   plainEval(null, 'White') === 'no score');
ok('never a bare decimal', !/^[-+]?\d+\.\d+$/.test(plainEval(313, 'White')));

// The sentinel itself is a mate that has happened, never one "in 1 move".
ok('checkmated, from the mated side',  plainEval(-30000, 'White') === 'checkmate — White is checkmated');
ok('checkmated, from the other side',  plainEval(30000, 'White') === 'checkmate — Black is checkmated');
ok('mate in 1 is still mate in 1',     plainEval(-29999, 'White') === 'Black forces checkmate in 1 move');

// A finished position: checkmate is the whole scale against the side to
// move, and every draw is nought.
ok('checkmate scores -MATE for the side to move', scoreFinished('checkmate') === -30000);
ok('checkmate is beyond the mate edge', Math.abs(scoreFinished('checkmate')) > 29000);
for (const draw of ['stalemate', 'fifty_move', 'repetition', 'insufficient']) ok(`${draw} scores nought`, scoreFinished(draw) === 0);

// Too few judged moves is NO accuracy, never a perfect one.
ok('threshold is ten', MIN_JUDGED === 10);
ok('zero moves: null, not 100%', accuracyFrom(0, 0).accuracy === null && accuracyFrom(0, 0).meanLoss === null);
ok('nine moves: still null', accuracyFrom(0, 9).accuracy === null);
ok('ten moves: a figure', accuracyFrom(0, 10).accuracy === 100 && accuracyFrom(0, 10).meanLoss === 0);
ok('mean loss is lost over counted', accuracyFrom(600, 12).meanLoss === 50 && accuracyFrom(600, 12).accuracy === 83);
ok('floor at nought', accuracyFrom(3000, 10).accuracy === 0);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
