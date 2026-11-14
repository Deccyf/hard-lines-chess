# The puzzle pack

`pack.txt` is the puzzles the Weak spots screen chooses from, and `pack.json`
says what is in it. Both are made by `tools/make-puzzle-pack.mjs` from the
Lichess puzzle database and committed here; `build.py` copies them beside the
page as `puzzle-pack.txt` and `puzzle-pack.json`. Without them the app builds
and runs, and the Weak spots screen says the build has no puzzles.

## Where the puzzles come from

The [Lichess puzzle database](https://database.lichess.org/#puzzles): every
puzzle on lichess.org, taken from real games, each with its themes and a
rating from how people did on it. Lichess releases it under
[CC0](https://creativecommons.org/publicdomain/zero/1.0/) — the public domain —
so there is nothing to attribute and nothing to restrict, and it is said here
because it is true and because that is where to go for a newer one.

## Making it again

```
# from the app's directory, with the database file downloaded
zstd -dc lichess_db_puzzle.csv.zst | node tools/make-puzzle-pack.mjs - --snapshot 2026-11-01
python3 build.py
npm test
```

`--snapshot` is the date of the database file, kept in `pack.json`. The same
file always gives the same pack: the choosing is random from a fixed seed.

## What is kept

- **Rated 400 to 2299**, with ratings from 600 to 2000 given twice the room of
  the ends, because that is where most players are.
- **Tested by people**: played at least 500 times, a popularity of at least 85
  on the database's scale of -100 to 100, and a rating deviation of 90 or less
  — a rating that has settled. An unpopular puzzle is usually one whose answer
  is arguable.
- **At most four moves for the solver.**
- **Two thirds of it is the themes the app can aim at** — the ones a mistake
  in a game crosses to, `WEAK_AIMS` in `src/weak-spots.js` — an equal number
  for each, spread over the ratings. Where a theme is rare at one rating its
  share is made up from the ratings nearest. The other third is anything.
- **Only themes the app has a use for** are kept on a row; how long the answer
  is and who played the game are left behind.

Every puzzle is **played through on this app's own move generator** before it
is kept: the position has to be one the app can set up, every move legal, the
last move the solver's, and a puzzle tagged as a mate has to end in mate in
the number of moves it says. What fails is dropped, and the tool prints how
many and why. `tests/puzzle-pack.test.mjs` does the same to one in ten of the
pack on every test run, and holds the pack to the size and hash in `pack.json`.

## The format

Lines starting with `#` describe the file; one of them, `# themes …`, lists
the themes in the order their letters stand for. Every other line is a puzzle,
tab-separated and in order of rating:

```
id <tab> rating <tab> a letter for each theme <tab> position (FEN) <tab> moves
```

The position and the moves are as the database has them: the position is the
one *before* the move that sets the puzzle up, and that move comes first. The
solver's moves are the second, fourth and so on. The id is the puzzle's id on
lichess.org.
