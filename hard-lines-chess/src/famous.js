// ── games worth watching ───────────────────────────────────────────────────
//
// Seven games from the record, to be played through a move at a time with the
// engine saying what it thinks of each one.
//
// WHAT IS VERIFIED HERE AND WHAT IS NOT, because the two are different kinds
// of claim and the app should not blur them.
//
//   THE MOVES ARE. Every game is replayed from the starting position through
//   this app's own move generator by tests/famous.test.mjs, and a single wrong
//   character in eighty-seven plies is an illegal move long before the end. A
//   game that does not replay does not ship.
//
//   A MATE IS. Where the record ends in mate, the final position is checked to
//   BE mate on the board. Four of these do.
//
//   A RESIGNATION IS NOT, and cannot be. "Black resigned" is a fact about a
//   room in Tilburg in 1991, not about the position, and nothing here can
//   check it — the board at the end of those three games is simply lost, not
//   finished. They are marked `resigned` rather than `checkmate` and the
//   screen says which it is showing.
//
//   THE NAMES AND DATES ARE NOT EITHER. Who played, where and when are matters
//   of record that this app has no way to test. They are reported as what they
//   are: the heading on a game score, not a measurement.
//
// Each `moment` names a ply and the move at it. The test checks the move it
// quotes really is the move at that ply, so a note cannot drift off the move
// it is about.

const FAMOUS_GAMES = [
  {
    id: 'opera',
    title: 'The Opera Game',
    white: 'Paul Morphy',
    black: 'Duke of Brunswick and Count Isouard',
    event: 'Paris',
    year: 1858,
    result: '1-0',
    ending: 'checkmate',
    why: 'Morphy played this in a box at the opera, against two amateurs sharing the black pieces, and it has been the first game shown to beginners ever since. Every move develops something or takes something away; nothing is spent on anything else. He is a rook and a queen down at the end and mates anyway.',
    moves: '1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8#',
    moments: [
      { ply: 19, san: 'Nxb5', note: 'A knight for a pawn, to open the file the rook has not reached yet. Count the material and it is bad; count who can move and it is not.' },
      { ply: 31, san: 'Qb8+', note: 'The queen goes to a square where it can be taken, and must be taken, because taking it puts the knight on the one square that stops the rook.' },
      { ply: 33, san: 'Rd8#', note: 'Mate with the last two pieces he has left.' },
    ],
  },
  {
    id: 'immortal',
    title: 'The Immortal Game',
    white: 'Adolf Anderssen',
    black: 'Lionel Kieseritzky',
    event: 'London, a casual game',
    year: 1851,
    result: '1-0',
    ending: 'checkmate',
    why: 'Not a tournament game — played between rounds — and the most famous game there is. Anderssen gives away a bishop, both rooks and the queen, and mates with the three minor pieces that are left.',
    moves: '1. e4 e5 2. f4 exf4 3. Bc4 Qh4+ 4. Kf1 b5 5. Bxb5 Nf6 6. Nf3 Qh6 7. d3 Nh5 8. Nh4 Qg5 9. Nf5 c6 10. g4 Nf6 11. Rg1 cxb5 12. h4 Qg6 13. h5 Qg5 14. Qf3 Ng8 15. Bxf4 Qf6 16. Nc3 Bc5 17. Nd5 Qxb2 18. Bd6 Bxg1 19. e5 Qxa1+ 20. Ke2 Na6 21. Nxg7+ Kd8 22. Qf6+ Nxf6 23. Be7#',
    moments: [
      { ply: 35, san: 'Bd6', note: 'Both rooks are hanging and he offers a bishop as well. The point is not the material; it is that Black’s queen and rook are on the wrong side of the board and cannot come back.' },
      { ply: 43, san: 'Qf6+', note: 'The queen goes too, and has to be taken.' },
      { ply: 45, san: 'Be7#', note: 'Mate by a bishop, a knight and a bishop, with a queen and two rooks given away to arrange it.' },
    ],
  },
  {
    id: 'evergreen',
    title: 'The Evergreen Game',
    white: 'Adolf Anderssen',
    black: 'Jean Dufresne',
    event: 'Berlin, a casual game',
    year: 1852,
    result: '1-0',
    ending: 'checkmate',
    why: 'Steinitz called it the evergreen in Anderssen’s laurel wreath. Black has a winning attack of his own and is one move too slow; the finish is a queen sacrifice that forces the king onto the square where the bishops are waiting.',
    moves: '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. b4 Bxb4 5. c3 Ba5 6. d4 exd4 7. O-O d3 8. Qb3 Qf6 9. e5 Qg6 10. Re1 Nge7 11. Ba3 b5 12. Qxb5 Rb8 13. Qa4 Bb6 14. Nbd2 Bb7 15. Ne4 Qf5 16. Bxd3 Qh5 17. Nf6+ gxf6 18. exf6 Rg8 19. Rad1 Qxf3 20. Rxe7+ Nxe7 21. Qxd7+ Kxd7 22. Bf5+ Ke8 23. Bd7+ Kf8 24. Bxe7#',
    moments: [
      { ply: 37, san: 'Rad1', note: 'The quiet move in the middle of the storm. Black is threatening mate; White brings the last piece to the file the king will end up on.' },
      { ply: 41, san: 'Qxd7+', note: 'The queen, for nothing, to pull the king onto d7 where the two bishops take turns.' },
      { ply: 47, san: 'Bxe7#', note: 'Mate, with the two bishops that were waiting for the king the queen sacrifice dragged out. Black is a queen and a rook up when it lands.' },
    ],
  },
  {
    id: 'century',
    title: 'The Game of the Century',
    white: 'Donald Byrne',
    black: 'Bobby Fischer',
    event: 'Rosenwald Memorial, New York',
    year: 1956,
    result: '0-1',
    ending: 'checkmate',
    why: 'Fischer was thirteen. He gives up his queen on move seventeen for a windmill of checks that never stops, and the pieces he gets for her chase the white king from one end of the board to the other.',
    moves: '1. Nf3 Nf6 2. c4 g6 3. Nc3 Bg7 4. d4 O-O 5. Bf4 d5 6. Qb3 dxc4 7. Qxc4 c6 8. e4 Nbd7 9. Rd1 Nb6 10. Qc5 Bg4 11. Bg5 Na4 12. Qa3 Nxc3 13. bxc3 Nxe4 14. Bxe7 Qb6 15. Bc4 Nxc3 16. Bc5 Rfe8+ 17. Kf1 Be6 18. Bxb6 Bxc4+ 19. Kg1 Ne2+ 20. Kf1 Nxd4+ 21. Kg1 Ne2+ 22. Kf1 Nc3+ 23. Kg1 axb6 24. Qb4 Ra4 25. Qxb6 Nxd1 26. h3 Rxa2 27. Kh2 Nxf2 28. Re1 Rxe1 29. Qd8+ Bf8 30. Nxe1 Bd5 31. Nf3 Ne4 32. Qb8 b5 33. h4 h5 34. Ne5 Kg7 35. Kg1 Bc5+ 36. Kf1 Ng3+ 37. Ke1 Bb4+ 38. Kd1 Bb3+ 39. Kc1 Ne2+ 40. Kb1 Nc3+ 41. Kc1 Rc2#',
    moments: [
      { ply: 22, san: 'Na4', note: 'A knight to the edge, which every book tells you not to do, offered to a pawn that cannot take it without losing the queen.' },
      { ply: 34, san: 'Be6', note: 'The move the game is remembered for. The queen is attacked and he ignores it: taking her lets the bishops and rooks in, and they never let go.' },
      { ply: 82, san: 'Rc2#', note: 'Mate, twenty-four moves after giving the queen away.' },
    ],
  },
  {
    id: 'kasparov-topalov',
    title: 'Kasparov’s Immortal',
    white: 'Garry Kasparov',
    black: 'Veselin Topalov',
    event: 'Hoogovens, Wijk aan Zee',
    year: 1999,
    result: '1-0',
    ending: 'resigned',
    why: 'Kasparov gives up a rook on move twenty-four and drives the black king from b8 to a4 and then all the way back to d1 — the length of the board, under check almost the whole way. It is the most analysed attacking game of the modern era.',
    moves: '1. e4 d6 2. d4 Nf6 3. Nc3 g6 4. Be3 Bg7 5. Qd2 c6 6. f3 b5 7. Nge2 Nbd7 8. Bh6 Bxh6 9. Qxh6 Bb7 10. a3 e5 11. O-O-O Qe7 12. Kb1 a6 13. Nc1 O-O-O 14. Nb3 exd4 15. Rxd4 c5 16. Rd1 Nb6 17. g3 Kb8 18. Na5 Ba8 19. Bh3 d5 20. Qf4+ Ka7 21. Rhe1 d4 22. Nd5 Nbxd5 23. exd5 Qd6 24. Rxd4 cxd4 25. Re7+ Kb6 26. Qxd4+ Kxa5 27. b4+ Ka4 28. Qc3 Qxd5 29. Ra7 Bb7 30. Rxb7 Qc4 31. Qxf6 Kxa3 32. Qxa6+ Kxb4 33. c3+ Kxc3 34. Qa1+ Kd2 35. Qb2+ Kd1 36. Bf1 Rd2 37. Rd7 Rxd7 38. Bxc4 bxc4 39. Qxh8 Rd3 40. Qa8 c3 41. Qa4+ Ke1 42. f4 f5 43. Kc1 Rd2 44. Qa7',
    moments: [
      { ply: 47, san: 'Rxd4', note: 'A rook for a pawn, to open a file towards a king that is about to have nowhere to stand.' },
      { ply: 51, san: 'Qxd4+', note: 'The king is dragged out. From here it is checked on nearly every move for twenty moves and cannot go back.' },
      { ply: 67, san: 'Qa1+', note: 'The black king has crossed the whole board — b8 to a4 and back to d1 — and is still being driven. It has been in check on nearly every move since move twenty-five.' },
    ],
  },
  {
    id: 'deep-blue',
    title: 'Deep Blue – Kasparov, game six',
    white: 'Deep Blue',
    black: 'Garry Kasparov',
    event: 'Rematch, New York',
    year: 1997,
    result: '1-0',
    ending: 'resigned',
    why: 'The game that ended the match and, for a lot of people, an era: the first time a reigning world champion lost a match to a machine. Kasparov walked into a known sacrifice on move eight and resigned on move nineteen — nineteen moves, the shortest loss of his career at that level.',
    moves: '1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Nd7 5. Ng5 Ngf6 6. Bd3 e6 7. N1f3 h6 8. Nxe6 Qe7 9. O-O fxe6 10. Bg6+ Kd8 11. Bf4 b5 12. a4 Bb7 13. Re1 Nd5 14. Bg3 Kc8 15. axb5 cxb5 16. Qd3 Bc6 17. Bf5 exf5 18. Rxe7 Bxe7 19. c4',
    moments: [
      { ply: 15, san: 'Nxe6', note: 'A knight for a pawn, and the black king can never castle again. This was known theory, not a discovery — which is the part that stung.' },
      { ply: 19, san: 'Bg6+', note: 'The king is pushed to d8 and the rooks on h8 and a8 take no further part in the game.' },
      { ply: 37, san: 'c4', note: 'Kasparov resigned here. He is not yet mated and not yet a piece down; the position is simply not defensible.' },
    ],
  },
  {
    id: 'short-timman',
    title: 'The king walk',
    white: 'Nigel Short',
    black: 'Jan Timman',
    event: 'Interpolis, Tilburg',
    year: 1991,
    result: '1-0',
    ending: 'resigned',
    why: 'With the position locked, Short walks his own king from h2 to g5 — up the board, past both armies, to help mate. It is the most famous king march in tournament chess and Timman resigned rather than see it arrive.',
    moves: '1. e4 Nf6 2. e5 Nd5 3. d4 d6 4. Nf3 g6 5. Bc4 Nb6 6. Bb3 Bg7 7. Qe2 Nc6 8. O-O O-O 9. h3 a5 10. a4 dxe5 11. dxe5 Nd4 12. Nxd4 Qxd4 13. Re1 e6 14. Nd2 Nd5 15. Nf3 Qc5 16. Qe4 Qb4 17. Bc4 Nb6 18. b3 Nxc4 19. bxc4 Re8 20. Rd1 Qc5 21. Qh4 b6 22. Be3 Qc6 23. Bh6 Bh8 24. Rd8 Bb7 25. Rad1 Bg7 26. R8d7 Rf8 27. Bxg7 Kxg7 28. R1d4 Rae8 29. Qf6+ Kg8 30. h4 h5 31. Kh2 Rc8 32. Kg3 Rce8 33. Kf4 Bc8 34. Kg5',
    moments: [
      { ply: 61, san: 'Kh2', note: 'The walk begins. Nothing is attacked, nothing is defended — the king is simply going somewhere, and Black has no way to stop it or to make progress elsewhere.' },
      { ply: 65, san: 'Kf4', note: 'A king on the fourth rank in a middlegame with queens on. It is safe because every black piece is tied to stopping mate on g7.' },
      { ply: 67, san: 'Kg5', note: 'Timman resigned. The king arrives beside its own queen, and Kh6 next move cannot be met.' },
    ],
  },
];
