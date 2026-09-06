// ── the endgames ───────────────────────────────────────────────────────────
//
// Positions to convert, against a defence that does not co-operate. Every one
// of them is a technique with a name, and the point of a technique is that it
// works every time — so the app has to be able to tell you when yours did not,
// which is harder than it sounds and is why the two `referee` values exist.
//
// WHO JUDGES, AND WHY IT IS NOT ALWAYS THE SEARCH.
//
//   'table'  — king and pawn against king, solved exactly in pawn-tb.js. The
//              search cannot referee these: shown the drawn opposition it is
//              certain White is winning, and defending it once threw the draw
//              away on move one. Where the answer is a fact rather than an
//              estimate, the fact plays the defence AND grades the move, so
//              the app can say "that was still winning" or "that is a draw
//              now" the moment it stops being true. Nothing else can say that.
//
//   'engine' — a rook or a queen up. Here the search is fine: the advantage is
//              enormous, the defence is ordinary, and the goal (mate, or a
//              pawn promoted) is a fact about the board rather than a score.
//
// The prose is checked against the board by tests/endgames.test.mjs — the
// material each one claims, the side to move, the result, and that the budget
// is enough to actually do it in.

const ENDGAMES = [
  // ── the mates everyone is taught first ───────────────────────────────────
  {
    id: 'two-rooks',
    group: 'The first mates',
    name: 'Two rooks',
    fen: '8/8/8/4k3/8/8/R7/1R2K3 w - - 0 1',
    side: 'white',
    goal: 'mate',
    budget: 10,
    referee: 'engine',
    idea: 'Two rooks mate on their own. The king is not needed and should stay out of the way.',
    method: [
      'Cut the king off with one rook on a rank or file it cannot cross.',
      'Put the other rook on the next rank along, and the king is inside a box.',
      'Shrink the box one rank at a time. When a rook is attacked, slide it to the far end of its line rather than defending it.',
      'The last rank is mate.',
    ],
  },
  {
    id: 'queen-mate',
    group: 'The first mates',
    name: 'Queen and king',
    fen: '8/8/8/4k3/8/8/8/3QK3 w - - 0 1',
    side: 'white',
    goal: 'mate',
    budget: 12,
    referee: 'engine',
    idea: 'Walk the king to the edge with the queen a knight’s move away, then bring your own king up. The danger is stalemate, not defence.',
    method: [
      'Put the queen a knight’s move from the enemy king. It cannot approach her and her box shrinks every time it moves.',
      'Keep doing that until the king is on the edge.',
      'Now stop checking and walk your own king up to the square opposite.',
      'Only then deliver mate. A queen that takes every square away before the king arrives is a stalemate, not a mate.',
    ],
  },
  {
    id: 'rook-mate',
    group: 'The first mates',
    name: 'Rook and king',
    fen: '8/8/8/4k3/8/8/8/R3K3 w - - 0 1',
    side: 'white',
    goal: 'mate',
    budget: 20,
    referee: 'engine',
    idea: 'The rook cuts a line the king may not cross; your king does the pushing. Nothing happens until the two work together.',
    method: [
      'Cut the enemy king off with the rook on a rank or file.',
      'March your own king up until the two kings face each other with one square between them — the opposition.',
      'Check with the rook. The king must retreat a rank, and the cut moves with it.',
      'Repeat until the king is on the edge, then take the last rank away.',
    ],
  },

  // ── king and pawn: where the exact table earns its place ─────────────────
  {
    id: 'king-on-the-sixth',
    group: 'King and pawn',
    name: 'The king in front, on the sixth',
    fen: '3k4/8/3K4/3P4/8/8/8/8 w - - 0 1',
    side: 'white',
    goal: 'promote',
    budget: 10,
    referee: 'table',
    idea: 'A king on the sixth rank in front of its own pawn wins whoever is to move. That is the position to aim for in every pawn ending.',
    method: [
      'Do not push the pawn yet. The pawn is not what wins this.',
      'Step sideways with the king — the defender has to give ground.',
      'Push only when pushing gains a rank without letting the enemy king in front of the pawn.',
    ],
  },
  {
    id: 'opposition-fifth',
    group: 'King and pawn',
    name: 'Taking the opposition',
    fen: '4k3/8/8/3KP3/8/8/8/8 w - - 0 1',
    side: 'white',
    goal: 'promote',
    budget: 12,
    referee: 'table',
    idea: 'The king wins this, not the pawn. Two moves here win and the other six draw — and the one that looks most natural, pushing the pawn, is one of the six.',
    method: [
      'Advance the KING towards the sixth rank. Both king moves to the sixth win from here.',
      'A king on the sixth in front of its own pawn wins whoever is to move. That is the position you are heading for.',
      'Do not push. The pawn is not what wins this, and every pawn move here throws the win away.',
      'Push only once the king is already ahead of the pawn and cannot be shouldered aside.',
    ],
  },
  {
    id: 'square-rule',
    group: 'King and pawn',
    name: 'The square rule',
    fen: '8/8/4k3/P7/8/8/8/7K b - - 0 1',
    side: 'black',
    goal: 'draw',
    budget: 8,
    referee: 'table',
    idea: 'Draw a square with the pawn and its promotion square as one side. If your king can step into that square, the pawn is caught — and you do not need to count moves to know it.',
    method: [
      'The pawn is on a5, so the square is a5 to a8 to d8 to d5.',
      'Step into it. Every move after that, stay in it as the square shrinks.',
      'Catch the pawn, or reach the queening square before it does.',
    ],
  },
  {
    id: 'rook-pawn-corner',
    group: 'King and pawn',
    name: 'The rook pawn and the corner',
    fen: '8/7K/8/4k2P/8/8/8/8 b - - 0 1',
    side: 'black',
    goal: 'draw',
    budget: 8,
    referee: 'table',
    idea: 'A rook pawn is the one pawn that cannot win on its own. Reach the corner it is heading for and there is no square left to drive you out to — the edge of the board defends you.',
    method: [
      'Go towards the corner the pawn is going to, not away from it. Eight moves are legal here and one of them draws.',
      'Sit on the two squares in front of the pawn and shuffle between them.',
      'The attacking king has no room on the far side to squeeze from, so it can never take the opposition.',
      'Stalemate and repetition are both draws, and here they are the plan rather than an accident.',
    ],
  },

  // ── a rook ending worth knowing ──────────────────────────────────────────
  {
    id: 'lucena',
    group: 'Rook endings',
    name: 'Building the bridge',
    fen: '2K5/2P1k3/8/8/8/8/r7/3R4 w - - 0 1',
    side: 'white',
    goal: 'promote',
    budget: 12,
    referee: 'engine',
    idea: 'Pawn on the seventh, your king in front of it, and the only thing stopping you is a rook checking from behind. The bridge is how you stop the checks for good.',
    method: [
      'Put your rook on the fourth rank. It is not doing anything yet — that is the point.',
      'Bring the king out towards the checks.',
      'When the check comes, block it with the rook you already put on the fourth rank.',
      'Trade rooks or shelter behind it, and the pawn goes through.',
    ],
  },
];
