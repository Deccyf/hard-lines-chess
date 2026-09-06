# Making it stronger, and how anybody would know

Notes on the engine, the opponent ladder and the coach: what is in there now,
what is missing, and what each missing thing is worth. Written to be acted on
in order.

The house rule applies to this document as much as to the app. Where a figure
below was measured, it says by what. Where it is an expectation from how these
things usually go, it says that instead — and an expectation is a reason to run
a match, not a reason to ship.

---

## 0. The two tools that had to exist first

Every idea about making a chess engine stronger is an idea that sounds right.
Null-move pruning sounds right. Bigger transposition tables sound right.
Some are worth a hundred points, some lose games, and reading the code tells
you which about half the time — which is the same as not knowing.

So before any of the rest of this:

**`tools/match.mjs`** — two engines, played off against each other. A candidate
is a copy of `search.js` (and `core.js` if it needs one) in
`tools/engine-candidates/<name>/`; anything it does not override comes from
`src/engine/`. Colours alternate and each opening is played twice, once from
each side, so an opening that favours White cannot favour one engine. It prints
the score, an Elo difference and a 95% interval, and says "NOT SEPARATED" when
the interval spans zero rather than reporting a small win.

```
cd tools && node match.mjs ./engine-candidates/stronger 120 100
```

**`tools/depth-probe.mjs`** — where a change paid, in twenty seconds rather
than an hour. A match gives one number for the whole engine, so a change that
helps in the middlegame and hurts in the endgame comes back as "not separated"
— true, and useless as a next step. This runs both builds on five positions at
three time controls and prints depth and nodes for each. It is what explained
the result in §1g.

**`tools/verify-candidate.mjs`** — the questions a match cannot answer. A match
tells you whether a change wins games; it does not tell you whether the change
is correct, and null-move pruning that returns a mate score it has not proved
will win most of its games and lose the one where it walks into mate. So:
perft on the five standard positions, no illegal move returned across several
hundred searches, and every one of the 42 forced mates in the app's own bank
still found and still reported as a mate.

```
cd tools && node verify-candidate.mjs ./engine-candidates/stronger
```

Nothing goes into `src/engine/` without passing the second and winning the
first.

---

## 1. The engine

### What is in there

Iterative deepening under a wall-clock budget; a transposition table with a
verification word against collisions; killer moves; the history heuristic;
MVV-LVA capture ordering; late move reductions; a check extension; quiescence
with delta pruning. The evaluation is material plus tapered piece-square
tables, a bishop-pair bonus and a doubled-pawn penalty — and deliberately
nothing else, because every extra term is a weight nobody here has measured.

That is a competent 1990s-shaped search. What follows is what it does not have.

### 1a. Null-move pruning — **built, in `tools/engine-candidates/stronger/`**

Pass the turn and search what is left, shallower. If the opponent still cannot
get the score below beta after being handed a free move, no real move of ours
is worse than that either, and the subtree goes. It is the largest single
saving available to a search this shape.

It is unsound in zugzwang, which is why it is switched off when the side to
move has nothing but pawns, when in check, and at the root.

### 1b. Principal variation search — **built, same candidate**

Today every move at a node gets the full window. The first move of a
well-ordered list is usually the best one; every move after it only needs to
answer "is this better than the best so far?", which is a window one point
wide, with a proper re-search on the rare occasion the answer is yes. The move
ordering already in this file is what makes that a saving rather than a
doubling.

### 1c. Check evasions in quiescence — **built, same candidate; this one is a bug**

`quiesce()` stands pat on the static evaluation and then looks at captures
only. In check, standing pat is false: you are not allowed to stop, and if
nothing gets you out you are checkmated. So a position that was mate at the
horizon came back scored as ordinary material, and the engine could not see it
was being mated one ply past where it stopped looking.

The fix is standard: in check, no stand-pat, generate every legal move, and
return a mate score when there are none.

### 1d. A transposition table that is not a `Map` of objects — **not built**

`this.tt` is a JavaScript `Map` keyed by a number, holding `{depth, score,
flag, move, check}` objects. Every store allocates an object; every probe
chases a pointer; and when it passes 2^18 entries the whole table is thrown
away rather than the one entry being replaced.

The standard shape is a flat `Int32Array` of fixed-width slots indexed by
`hash & mask`, with a replacement rule. This is pure speed and no behaviour
change, so it is the safest large change available. **Expected** to be worth
more in JavaScript than in a compiled language, precisely because allocation
and GC are what is being removed. Unmeasured.

### 1e. The exact endgame table the app already has — **not built, and this one is free**

`src/pawn-tb.js` solves king and pawn against king exactly: all 393,216
positions, win or draw, in about a second. The endgame trainer uses it to
referee. **The search does not consult it.** A search that probed it at the
leaves would play every king-and-pawn ending perfectly rather than
approximately — and the app already states, at length, that the search is not
merely imprecise in those endings but wrong.

Small, self-contained, and the only change here that makes the engine exactly
right about something rather than approximately better.

### 1f. Smaller things, in the order I would do them

- **Static null move / reverse futility.** At shallow depth, if the static
  evaluation minus a margin already beats beta, return. Cheap, standard.
- **Aspiration windows.** Start each iteration's window near the last
  iteration's score and widen on a fail. Modest.
- **Static exchange evaluation.** Used to skip losing captures in quiescence
  and to order captures better than MVV-LVA can. Worth real nodes.
- **Twofold repetition inside the search.** `isRepetition()` requires three
  occurrences, which is the right rule for claiming a draw and the wrong one
  inside a search: a repetition seen twice is already a draw by force, and
  treating it as one two plies earlier is standard.
- **Time management that is not a flat budget.** Every band gets a fixed
  movetime whatever the position. Spending longer when the best move changed
  between iterations, and less in a position with one legal reply, is free
  strength.

### 1g. What the candidate actually measured

`tools/engine-candidates/stronger/` holds 1a, 1b and 1c together. It is correct
by the verifier: perft passes on all five standard positions, no illegal move
in several hundred searches, all 42 forced mates still found.

**It is not shipped**, and the reason is the whole point of having the tools.

Over 120 games at 100ms a move it scored **52W 29D 39L = 55.4%**, which is an
Elo difference of **+38, with a 95% interval of −16 to +94**. That interval
spans zero. The point estimate leans in the candidate's favour and the
measurement does not establish it: 120 games cannot separate two engines less
than about ninety points apart, and this pair are closer than that. Read
honestly, the result is "probably a small gain, unproven" — which is not a
reason to ship a change to the thing every other measurement in this repository
is taken against.

The more useful half of the answer came from the depth probe, at a second a
move, against the current build:

| position | baseline | candidate | |
|---|---|---|---|
| opening | 7 ply | 7 ply | |
| middlegame | 6 ply | 7 ply | deeper |
| tactical | 7 ply | 8 ply | deeper |
| endgame | 14 ply | 14 ply | |
| **king and pawn** | **29 ply** | **25 ply** | **four plies shallower** |

So the search improvements work in the middle of the board and cost depth at
the end of it, and a 55.4% match score is the sum of those two — a small net
gain that the endgame regression is eating most of. Isolating them (candidates `no-pvs` and `pvs-only` in the
same directory) shows both changes lose depth in the pawn ending independently,
so it is not one culprit:

- **PVS loses depth where the move ordering is weakest.** A null-window scout
  is a saving only when the first move is usually best; when it is not, every
  fail-high costs a full re-search. The history heuristic here is indexed by
  from-square and to-square globally, which carries almost no information in an
  endgame with three pieces on the board.
- **Quiescence with check evasions has no cap.** In a pawn ending near
  promotion, checks are everywhere, and every evasion is now searched, and each
  of those can be in check again. Real engines extend checks only for the first
  ply or two of quiescence. This one does not, and pays for it exactly where
  checks are cheapest to give.

Both have specific fixes, and each is worth its own match:

1. Cap the check extension inside quiescence at one or two plies.
2. Index the history heuristic by (piece, to-square) rather than (from, to),
   and add counter-moves, before relying on PVS.

That is a better outcome than shipping the package would have been: the same
hour of measurement that refused it also said what to fix.

---

## 2. The bots

The bands are honest about being targets rather than ratings, and the ladder's
ordering is measured. Two things would make them better opponents rather than
merely better-labelled ones.

### 2a. The blunder model is uniform, and human blunders are not

Below about 1000 the difference between two players is how often they simply
drop a piece, and the bands reproduce that by playing a uniformly random legal
move at a stated rate. That is right in spirit and wrong in shape. A human
blunder is not a random move — it is a *plausible* move that loses material:
the natural developing move that hangs a knight, the recapture that walks into
a fork. A uniformly random move is as likely to be `1.h4` as `1.Nf3`, and
playing through a game against a weak band, that is what it feels like.

The change is small: draw the blunder from the well-ordered move list rather
than uniformly — say, from the moves the ordering already ranks plausibly,
weighted towards those that lose material. It is measurable: the distribution
of centipawn loss per move in the app's own review, compared against the same
distribution from real games at that rating.

### 2b. Nothing in a band knows it is losing

There is no contempt term, so a weak band happily repeats into a draw from a
winning position, and a strong band does the same against a weak one. A small
draw penalty scaled by band would make the ladder's games finish more like
games.

---

## 3. The coach

The on-device coach was the right decision — it made the phone able to do the
thing the README advertises — and its limits are the bundle's limits. It can
say what the engine measured. The engine measures material, mobility through
the piece-square tables, and nothing else.

### 3a. It cannot talk about a plan because the evaluation has no plans in it

"What should I do here?" is answered with the best move and a score. The
answer a person wants is "your bishop has no diagonal and your rooks have no
file". The evaluation computes neither, so the coach cannot say either.

Adding the standard positional terms — open and half-open files, passed pawns,
isolated and backward pawns, king safety, knight outposts — has two payoffs at
once: the engine gets stronger, and every one of those terms is a *countable
fact about the board* that the coach can put in a sentence with a number behind
it. That is the only route to plan-level advice that does not break the house
rule.

Each term needs a weight, and a weight nobody measured is worse than a missing
term — so each goes in behind `tools/match.mjs`, one at a time.

### 3b. Repertoire deviation — the biggest training feature that is missing

The apps that people actually improve with (ChessAtlas, RepertoireLab,
Chessbook) all do the same thing: they take your real games and find the move
where you left your preparation. This app has both halves already — 25
verified openings in `src/openings.js` and every reviewed game stored with its
PGN — and does not join them.

The join is: walk each stored game against the repertoire, find the first ply
that leaves it, and report the move you played, the move the book plays, and
what the review said the position was worth afterwards. No engine work at all.
It would make the Openings screen say "you have left the Italian at move 6 in
four of your last ten games, and you were half a pawn worse each time", which
is a sentence worth more than any amount of extra search depth.

### 3c. Mistakes are counted but not classified over time

Progress shows accuracy and mean loss. It does not show that eleven of your
last twenty blunders were the same motif. `src/motifs.js` already classifies
individual mistakes; nothing aggregates them across games. Also no engine work.

---

## 4. Where this app already stands against the ones people pay for

Worth stating, because the gaps above are shorter than they look. Spaced
repetition (SM-2, in `src/store.js`), puzzles mined from your own games, review
with motif classification, a solved endgame table, an opening repertoire with
per-move explanations checked against a board, and a coach that cannot make
things up — those are all here, and several of them are things the paid apps
do worse or not at all.

The three things they have that this does not are deviation detection (§3b),
weakness reports over time (§3c), and automatic import from Lichess or
Chess.com. The last is impossible in the Android app on purpose: it holds no
`INTERNET` permission, which is why it can promise that nothing leaves the
device. Pasting a PGN already works, and in the installed web app an import
would be possible if it were ever wanted.

There is one more, and it is a scheduling detail: the SM-2 scheduler here is
the 1987 algorithm. FSRS is the modern replacement and is what the current
generation of trainers use. It is a drop-in for `SRS` in `src/store.js` and
would be measurable against the stored review history.

---

## 5. In order

| # | Change | Effort | What it buys | Measured? |
|---|--------|--------|--------------|-----------|
| 1 | §3b repertoire deviation | small | the best training feature missing | n/a — a feature, not a strength change |
| 2 | §1a–c fix the endgame regression, then re-match | small | unlocks a change already measured at +38 (unproven) | `tools/match.mjs` |
| 3 | §1e probe the K+P table in the search | small | exact play in the endings the app says the search gets wrong | mate/endgame suites |
| 4 | §3c mistake clustering over time | small | "you keep losing pieces to forks" | n/a |
| 5 | §1d typed-array transposition table | medium | speed, no behaviour change | match |
| 6 | §3a positional evaluation terms | medium, one at a time | strength AND plan-level coaching | match, per term |
| 7 | §2a plausible blunders | small | opponents that feel like opponents | loss distribution vs. real games |
| 8 | §1f the rest of the search | small each | incremental | match |

