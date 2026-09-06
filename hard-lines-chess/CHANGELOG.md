# Changelog

## 1.0.0 — 2026-09-05

First release. A review by four independent passes found 38 reproducible bugs
in the pre-release code; every one is fixed here and pinned by a test or a
reproduction script under `tests/`.

### Data and game integrity
- A game was recorded twice when the opponent's clock flagged during its reply pause; `finishPlay` is now the only place a game ends and every deferred callback checks for it.
- A checkmated final position was scored as equal; it now scores as mate, a mating move is never a mistake, and the curve, bar and readout show it.
- The promotion picker could outlive its position and place a colourless piece; the board refuses moves by the wrong side and the picker is tied to the position it opened on.
- Drills with a missing or partial spaced-repetition card threw or retired themselves; cards are normalised on read and documents are versioned.
- An older copy in the account store could overwrite a newer local one; both carry timestamps and the newer wins, with failed writes retried.
- Castling rights were never reconciled with the board; a FEN with rights but no rook is now corrected and the correction reported.
- Take-back returned clock increment; clocks are stored per ply and restored.
- Changing the band mid-game changed the opponent; the opponent is frozen at the start of a game and the picker starts a new one.
- Fewer than ten judged moves produced a perfect accuracy and a strength estimate; both are now withheld and the reason stated.
- The installable kit's service worker never updated; its version is a content hash stamped at build time and the shell is served network-first.
- After any finished game, the first "New game" gave a board with no legal moves.

### Wrong on screen
- The coach's "back to the position you asked about" button did nothing.
- A failed coach call left a dangling turn, so the next question was refused.
- "Why not X?" was asked on the position after X.
- On a checkmated position the coach bundle claimed "roughly equal, 0 plies deep".
- The threat readout dropped the sign of the evaluation.
- The hanging-piece ring was the same colour as the dark square.
- In Test-me mode the branch panel printed the line under test.
- Opening cards were re-scheduled on every clean run, including same-day repeats; cards are now per branch and confirm rather than advance within a day.
- An unfinished game (`*`) was reported as truncated; so were `0-0` and `e8Q`.
- Blunder rates under one percent were rounded up in the band notes.
- The settings specimen promised a check it did not draw.
- The opponent book stayed off for the session after the first game was stored, and filed set-up games under standard-start keys.
- A floor-clamped estimate of zero fell out of the rolling median.
- A tactic whose reply was unreadable was reported as "the game ended".

### Robustness and strength leaks
- The teaching coach's look ran on the player's clock and could flag them; it now runs on nobody's.
- The coach's deep searches primed the opponent's transposition table; the coach has its own engine.
- A problem taken back past its ply was orphaned; it is withdrawn and the spacing gate re-armed.
- Threefold repetition was missed after a double pawn push; the en-passant square is only hashed when a capture is possible.
- Transposition-table keys were 32-bit and mate scores were stored ply-relative; entries carry a verification word and mate scores are adjusted at the boundary.
- Two coach line buttons pressed quickly interleaved into a line neither offered.
- A copy saved from the installed kit was itself uninstallable.
- The board rebuilt all 64 squares on every tap; it now diffs in place.
