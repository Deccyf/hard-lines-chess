# Maia, vendored

The human-like opponent on the Play screen: nine networks that play the moves
people of one rating play.

| | |
|---|---|
| what | the nine Maia networks, `maia-1100` to `maia-1900`, one for each hundred points |
| whose | the Maia project — Reid McIlroy-Young, Siddhartha Sen, Jon Kleinberg and Ashton Anderson, *Aligning Superhuman AI with Human Behavior: Chess as a Model System*, KDD 2020, <https://doi.org/10.1145/3394486.3403219>; <https://maiachess.com> |
| source | <https://github.com/CSSLab/maia-chess> at `749204cf5979ce7f8b0412e804a4ee7c83c49ff8`, folder `maia_weights` |
| changed | nothing: the files here are the published files, byte for byte |
| size | 1.2 to 1.3 MB each, 11.6 MB in all |
| checksums | `nets.json` beside these files lists each one's size and sha256; `build.py` refuses to build if a file is not the one listed |
| licence | GPL-3.0 — `LICENSE` beside these files |

## What a Maia network is

Not an engine. Each was trained on millions of games from Lichess between
players whose ratings were both in one hundred-point band, and asked one
question of every position: which move did the person play? So what it
gives back for a position is, for every move, how likely a player of that
rating is to play it. It does not search, and it has no opinion about who is
winning that this app uses.

The number in a network's name is the Lichess rating of the players it
learned from. It is not a rating the network has earned, and Lichess numbers
are not Chess.com numbers.

## How it is used

The files are in the format of the Leela Chess Zero engine — a gzipped
protobuf of weights. Leela itself is an engine built to search, and is not
here: these networks are run without searching at all. The network is small
enough (six blocks of sixty-four filters) to run in a few
hundred lines of ordinary JavaScript, a few hundredths of a second a move on
a laptop: `src/maia-net.js` reads the file and does the sums, and
`src/maia.js` shows it the position the way Leela does and reads its answer
back. Both follow Leela's source (<https://github.com/LeelaChessZero/lc0>,
GPL-3.0) for the format, for how a position is drawn, and for which number
belongs to which move; `tests/fixtures/lc0-policy.json` is Leela's own table
of the 1,858 moves, and `tests/maia.test.mjs` holds the numbering to it.

The Maia project's own bots play the likeliest move every time. This app
draws its move from the likely ones instead, in proportion to how likely each
is, so that the same position does not always get the same reply.

`build.py` copies each file beside every build of the page as
`maia-<level>.bin` — the same bytes under a name no web server or packager
will try to unpack on the way — and writes `maia.json`, which is how the page
knows which levels it has. The page fetches a network the first time its level
is chosen; the installed website keeps it from then on, across updates. The
Android app has all nine inside it.

## Updating it

The published networks have not changed since 2020 and are not expected to.
If they ever do: replace the files, write their sizes and hashes into
`nets.json`, give the copies beside the page a new name so that a kept copy
of the old file is not mistaken for the new one, and run the suites.
