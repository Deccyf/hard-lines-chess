// ── the human-like opponent, on the Play screen ────────────────────────────
//
// The ladder's levels are this app's own engine, turned down: it calculates,
// and now and then it is made to play a random move. That is a way of being
// weak, and it is not the way people are weak. Nobody rated 1100 plays a
// random move one time in fourteen; they miss the fork, take the pawn that
// was bait, and play the natural move in the position where it loses.
//
// These levels play like that. Each is a network from the Maia project that
// was shown the games of players of one rating and learned which move they
// play (src/maia-net.js runs it, src/maia.js shows it the game and reads its
// answer, vendor/maia/README.md says whose it is). This file is the Play
// screen's side: finding out which levels there are, fetching one when it is
// wanted, and making its move.
//
// WHAT THE NUMBER IS, because the ladder's number is a different thing. A
// ladder level's number is a target this app aimed a setting at. This one is
// the Lichess rating of the players the network learned from. It is not a
// rating the network has earned by playing, and a Lichess number is not a
// Chess.com one. The screen says so where the level is chosen.
//
// IT CAN BE MISSING. The networks are files beside the page, and a copy of
// the page opened from a file has nothing beside it; a build can be made
// without them. Then there is no such group in the list and nothing else
// changes.

const Human = {
  // undefined: not asked yet. null: there are none here. Otherwise what
  // maia.json says: { levels: [{ level, file, bytes }] }.
  about: undefined,
  finding: null,
  // level -> the promise of its network, read and ready. A level that could
  // not be had is taken out again, so the next game asks afresh.
  nets: new Map(),
  // level -> 'fetching' | 'ready' | 'failed', for the note under the list.
  state: new Map(),
};

/** The file beside the page that says which levels there are. build.py always writes it. */
const HUMAN_ABOUT = 'maia.json';

/** What a human-like level is called, wherever it is named. */
const humanName = (level) => `Human-like ${level}`;

/** Find out which human-like levels are beside this page, once. Resolves with the list of them, which may be empty. */
function findHumanLike() {
  Human.finding ??= (async () => {
    if (location.protocol === 'file:') { Human.about = null; return []; }
    let response;
    try {
      response = await fetch(new URL(HUMAN_ABOUT, location.href).href);
    } catch {
      // No answer at all: asked again the next time, because "no connection
      // a moment ago" is not "no such levels".
      Human.about = null; Human.finding = null;
      return [];
    }
    let about = null;
    if (response.ok) { try { about = await response.json(); } catch { about = null; } }
    const levels = (Array.isArray(about?.levels) ? about.levels : [])
      .filter((l) => Number.isInteger(l?.level) && typeof l.file === 'string' && /^[\w.-]+$/.test(l.file))
      .sort((a, b) => a.level - b.level);
    if (about?.format !== 1 || !levels.length) { Human.about = null; return []; }
    Human.about = { levels };
    return humanLevels();
  })();
  return Human.finding;
}

/** The levels there are networks for, lowest first. */
function humanLevels() {
  return (Human.about?.levels ?? []).map((l) => l.level);
}

/**
 * The network for a level: fetched once, read once, kept for as long as the
 * page is open. Rejects, with the reason in words, when it cannot be had —
 * and forgets that it tried, so that the next game tries again.
 */
function humanNet(level) {
  if (!Human.nets.has(level)) {
    const entry = Human.about?.levels.find((l) => l.level === level);
    Human.state.set(level, 'fetching');
    if (Play.band.maia === level) describeBand();
    const reading = (async () => {
      if (!entry) throw new Error('there is no such level in this copy of the app');
      let response;
      try {
        response = await fetch(new URL(entry.file, location.href).href);
      } catch {
        throw new Error('its file could not be fetched');
      }
      if (!response.ok) throw new Error(`its file could not be fetched (the answer was ${response.status})`);
      return maiaReadNet(await maiaUnpack(await response.arrayBuffer()));
    })();
    Human.nets.set(level, reading);
    reading.then(
      () => { Human.state.set(level, 'ready'); },
      () => { Human.state.set(level, 'failed'); Human.nets.delete(level); },
    ).then(() => { if (Play.band.maia === level) describeBand(); });
  }
  return Human.nets.get(level);
}

/** What is said under the list when a human-like level is the one chosen. */
function humanNote(level) {
  const state = Human.state.get(level);
  const now = state === 'fetching' ? ' Fetching it…'
    : (state === 'failed' ? ' It could not be fetched just now; starting a game tries again.' : '');
  return `Plays the moves that players rated about ${level} on Lichess play — it learned from their games, mistakes included, and does not calculate. `
    + `The number is theirs, on Lichess's scale, not a strength measured for it.${now}`;
}

/** Whoever a game is against, as the level list's value: "400", or "human-1500". */
const opponentValue = (band) => (band.maia ? `human-${band.maia}` : String(band.elo));

/** The opponent a value from the level list stands for, or the ladder's first level when it stands for none. */
function opponentFor(value) {
  const human = /^human-(\d+)$/.exec(String(value));
  if (human && humanLevels().includes(Number(human[1]))) return { maia: Number(human[1]) };
  return BANDS.find((b) => b.elo === Number(value)) ?? BANDS[0];
}

/** Whoever a game is against, named: "400–500", or "Human-like 1500". */
const opponentName = (band) => (band.maia ? humanName(band.maia) : bandLabelFor(band.elo));

/** What a saved game keeps of its opponent: the ladder's level, or the human-like one. */
const opponentKept = (band) => (band.maia ? { maia: band.maia } : { band: band.elo });

/** Who a saved game was against, in the middle of a sentence: "level 400–500", or "the human-like 1500". */
const opponentWords = (game) => (game.maia ? `the human-like ${game.maia}` : `level ${bandLabelFor(game.band)}`);

/** The record a game against this opponent is counted in: one table for the ladder, one for the human-like levels. */
function opponentRecord(band) {
  const table = band.maia ? (App.history.maia ??= {}) : App.history.bands;
  const key = band.maia ?? band.elo;
  return (table[key] ??= { w: 0, d: 0, l: 0 });
}

/**
 * Every position of the game being played, oldest first, as the network is
 * to be shown them. Replayed from the game's own moves: the board on the
 * screen knows where it is, and this needs where it has been.
 */
function playPositions() {
  const board = new Board(Play.game.startFen ?? undefined);
  const fens = [board.fen()];
  for (const played of Play.moves) {
    const move = board.legalMoves().find((m) => moveToUci(m) === played.uci);
    if (!move) break;
    board.make(move);
    fens.push(board.fen());
  }
  return fens;
}

/**
 * The human-like opponent's move, for engineMove(): the network is had, the
 * game is shown to it, and one of its likely moves is played.
 *
 * AFTER THE PLAYER'S PIECE HAS ARRIVED, NOT WHILE IT IS MOVING. The sums are
 * a few hundredths of a second on a laptop and a few tenths on a phone, on
 * the page's own thread, and done straight away they would be done in the
 * middle of the slide and stop it dead. So they wait for the pause every
 * reply waits for anyway, and are done when nothing is moving.
 */
function humanMove(alive, startedAt) {
  const level = Play.game.band.maia;
  const fens = playPositions();
  const stop = () => { clearInterval(Play.ticker); Play.thinking = false; Play.view.locked = false; };
  const fail = (why) => { if (!alive()) return; stop(); Play.fault = why; renderPlayStatus(); };

  humanNet(level).then((net) => {
    setTimeout(() => {
      if (!alive()) return;
      let chosen;
      try {
        chosen = maiaChoose(maiaChances(Play.view.board, maiaForward(net, maiaPlanes(fens))));
      } catch (e) {
        fail(e?.message ?? String(e));
        return;
      }
      stop();
      finishEngineMove({ move: chosen?.move ?? null, human: chosen });
    }, Math.max(0, MIN_REPLY_MS - (Date.now() - startedAt)));
  }, (e) => fail(e?.message ?? String(e)));
}

/**
 * What the panel beside the board is about. Against the ladder it is the
 * engine's view of the position. This opponent has no view of the position —
 * it never weighs one up — so the panel says the one thing there is to say
 * about its move instead: how many players like it would have made it.
 */
function describePlayReadout() {
  const human = Boolean(Play.game?.band.maia);
  $('playEvalTitle').textContent = human ? 'Its last move' : 'Evaluation';
  $('playEvalKey').textContent = human ? 'Players like it who play that move' : 'From your side, in points';
  $('playEvalNote').textContent = human
    ? 'This opponent does not weigh the position up, so there is no evaluation. The figure is the share of players of its rating the network expects to make the move it just made.'
    : 'The engine\'s assessment. Positive means it considers you better.';
}

/** A share, as the panel prints it: "34%", and never "0%" for a move that was played. */
const humanShare = (chance) => `${Math.max(1, Math.round(chance * 100))}%`;
