// ── bringing in games from Chess.com ───────────────────────────────────────
//
// Everything else in this app works on games it already has: the ones played
// here, and the ones pasted into Review one at a time. That is a bottleneck
// with a shape — the review, the tactics miner and the repertoire report all
// get better with more games, and pasting three hundred of them by hand is not
// something anybody does.
//
// Chess.com publishes every public game through an API that needs no key and
// no password: an archive list per player, a month of games per archive. This
// reads it.
//
// WHAT IT DOES NOT DO, and both are on purpose.
//
//   NO PASSWORD, EVER. The public endpoint is all this uses. Nothing here asks
//   for a Chess.com login, and if this app ever puts a password field on the
//   screen for a service that is not this one, something has gone wrong.
//
//   NOTHING LEAVES YOUR DEVICE. The request goes from your browser to
//   Chess.com and back. There is no server in this app to send anything to.
//   In the Android app it does not run at all, because the APK holds no
//   INTERNET permission — which is the promise that makes the rest of it
//   trustworthy, and is worth more than the convenience.

const CHESSCOM_API = 'https://api.chess.com/pub/player';

/** The archive list for a player. Usernames are case-insensitive there. */
const archivesUrl = (username) =>
  `${CHESSCOM_API}/${encodeURIComponent(String(username).trim().toLowerCase())}/games/archives`;

/**
 * One game from the API, as a row this app can store — or null when it is not
 * a game this app can use.
 *
 * WHAT IS REFUSED. Anything that is not standard chess: Chess960 has a
 * different starting position, and bughouse and crazyhouse have different
 * rules, so a review of one would be an engine confidently analysing a game it
 * does not know the rules of. Games with no movetext are refused too — an
 * abandoned game has nothing in it to look at.
 */
function chessComGame(game, username) {
  if (!game || typeof game !== 'object') return null;
  if (game.rules && game.rules !== 'chess') return null;
  if (typeof game.pgn !== 'string' || !game.pgn.trim()) return null;

  const me = String(username).trim().toLowerCase();
  const white = game.white?.username ?? '?';
  const black = game.black?.username ?? '?';
  const iAmWhite = String(white).toLowerCase() === me;
  const iAmBlack = String(black).toLowerCase() === me;
  // A game the named player is not in cannot have a side, and every screen
  // downstream needs one to say whose mistake a mistake was.
  if (!iAmWhite && !iAmBlack) return null;

  // A Chess960 game can also be marked by its FEN header rather than by
  // `rules`, so the movetext is checked as well as the metadata.
  if (/\[Variant\s+"(?!Standard)/i.test(game.pgn)) return null;

  const outcome = game.white?.result;
  const result = outcome === 'win' ? '1-0'
    : (game.black?.result === 'win' ? '0-1'
      : (outcome ? '1/2-1/2' : '*'));

  // THE RATINGS WERE BEING THROWN AWAY. The API returns both players' rating
  // for the game, and this kept the usernames and dropped the numbers — so the
  // app estimated your strength from how much each move cost while your actual
  // rating, on the day, for that game, sat in the response unread. It is the
  // one figure here that is not this app's opinion, and everything that wants
  // to know whether you are getting better should be anchored to it.
  const myRating = Number(iAmWhite ? game.white?.rating : game.black?.rating);
  const theirRating = Number(iAmWhite ? game.black?.rating : game.white?.rating);

  return {
    at: (game.end_time ?? 0) * 1000 || Date.now(),
    white,
    black,
    result,
    side: iAmWhite ? 'white' : 'black',
    pgn: game.pgn,
    url: game.url ?? null,
    timeClass: game.time_class ?? null,
    // An unrated game's rating is not a rating, so it is not kept as one.
    myRating: game.rated !== false && Number.isFinite(myRating) ? myRating : null,
    theirRating: game.rated !== false && Number.isFinite(theirRating) ? theirRating : null,
    // "600", "180+2". The clocks in the movetext are only readable as time
    // spent when the starting time is known, and this is where it is written.
    timeControl: game.time_control ?? null,
    rated: game.rated !== false,
    // NOT REVIEWED. It has been imported, which is not the same thing, and
    // every screen that averages accuracy has to be able to tell the
    // difference — otherwise importing three hundred games would report three
    // hundred reviews whose accuracy nobody measured.
    reviewed: false,
    accuracy: null,
    meanLoss: null,
    mistakes: [],
    source: 'chess.com',
  };
}

/**
 * A month of games, filtered and newest first, with a count of each reason a
 * game did not make it.
 *
 * THE THREE OUTCOMES ARE COUNTED SEPARATELY because they mean different
 * things to a person reading the summary. "Already here" is the import working
 * — you asked twice. "Not standard chess" is a game this app cannot analyse.
 * Rolling them together produced a first-ever import that claimed three games
 * were already here on a device that had never held one, which is a sentence
 * that makes a reader distrust every other number on the screen.
 *
 * `existing` is whatever is already stored. Games are identified by their
 * Chess.com URL where there is one and by end time and colour where there is
 * not, because two of your games cannot end at the same second with you on the
 * same side.
 *
 * A GAME ALREADY HERE IS STILL WORTH LOOKING AT, because what this app keeps
 * about a game has grown. The ratings and the time control were not kept at
 * all until recently, and an import that only ever adds would have left every
 * game brought in before then without them for good — a rating chart that
 * starts on the day the feature shipped, with hundreds of games behind it that
 * have the numbers sitting in Chess.com's answer. So a duplicate whose stored
 * copy is missing something this one has is filled in where it lies, and
 * counted separately: it is neither a new game nor nothing happening.
 *
 * Only ever ADDING what is absent. Nothing already stored is overwritten —
 * a reviewed game's own findings are not the importer's to touch.
 */
const BACKFILL = ['myRating', 'theirRating', 'timeControl', 'timeClass', 'url', 'rated'];

function chessComMonth(games, username, existing = []) {
  const seen = new Map();
  for (const row of existing) {
    if (row?.url) seen.set(row.url, row);
    if (row?.at) seen.set(`${row.at}|${row.side}`, row);
  }

  const rows = [];
  let unusable = 0, duplicate = 0, updated = 0;
  for (const raw of games ?? []) {
    const row = chessComGame(raw, username);
    if (!row) { unusable++; continue; }
    const key = row.url ?? `${row.at}|${row.side}`;
    const already = seen.get(key) ?? seen.get(`${row.at}|${row.side}`);
    if (already) {
      duplicate++;
      let filled = false;
      for (const field of BACKFILL) {
        const have = already[field];
        if ((have === undefined || have === null) && row[field] !== undefined && row[field] !== null) {
          already[field] = row[field];
          filled = true;
        }
      }
      if (filled) updated++;
      continue;
    }
    seen.set(key, row);
    seen.set(`${row.at}|${row.side}`, row);
    rows.push(row);
  }
  rows.sort((a, b) => b.at - a.at);
  return { rows, unusable, duplicate, updated, found: (games ?? []).length };
}

/**
 * A short line about what an import brought in, or why it brought nothing.
 *
 * Every number here is one of the counts above, and they add up: found is
 * added plus duplicate plus unusable. A summary whose numbers do not add up is
 * how the first version of this told somebody their brand-new install already
 * had three of their games.
 */
function importSummary({ found = 0, added = 0, duplicate = 0, unusable = 0, updated = 0, months = 0 }) {
  const month = (n) => `${n} ${n === 1 ? 'month' : 'months'}`;
  if (!found) return `No games at all in the ${month(months)} looked at.`;

  const parts = [];
  if (added) parts.push(`${added} ${added === 1 ? 'game' : 'games'} brought in from ${month(months)}.`);
  else parts.push(`Nothing new in ${month(months)}.`);
  if (duplicate) parts.push(`${duplicate} ${duplicate === 1 ? 'was' : 'were'} already here.`);
  // Said plainly, because "already here" and "already here and now has your
  // rating on it" are different outcomes and only one of them is worth
  // running the import again for.
  if (updated) parts.push(`${updated} of those gained the rating and time control this app did not used to keep.`);
  if (unusable) parts.push(`${unusable} skipped: not standard chess, no moves, or not your game.`);
  return parts.join(' ');
}
