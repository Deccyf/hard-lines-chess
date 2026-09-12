// The ladder, in 100-point bands.
//
// WHAT THE NUMBER ON THE LABEL IS. It is a TARGET, not a measurement. Nothing
// here has been played against rated humans, so calling a setting "800" is a
// statement about where it is aimed, and the page says so rather than printing
// it as a rating somebody earned. What HAS been measured is the ordering: the
// self-play run in calibrate.mjs checks that each band beats the one below it,
// because a ladder whose rungs are out of order is worse than no ladder.
//
// Three dials, and the mix changes as it climbs:
//
//   blunder  — how often it simply plays a random legal move. Below about 1000
//              this is the whole difference between two players. No amount of
//              shallow searching reproduces it: a one-ply search still sees a
//              hanging queen, so a weak band has to actually drop pieces.
//   depth    — how far it calculates when it is not blundering.
//   movetime — a ceiling, so a sharp position cannot stall a phone.
//
// The bands are stored as their LOWER bound; the label prints the range.
const BANDS = [
  { elo: 0,    depth: 1,  blunder: 0.60, movetime: 60 },
  { elo: 100,  depth: 1,  blunder: 0.50, movetime: 60 },
  { elo: 200,  depth: 1,  blunder: 0.42, movetime: 60 },
  { elo: 300,  depth: 2,  blunder: 0.36, movetime: 80 },
  { elo: 400,  depth: 2,  blunder: 0.30, movetime: 80 },
  { elo: 500,  depth: 2,  blunder: 0.25, movetime: 100 },
  { elo: 600,  depth: 3,  blunder: 0.21, movetime: 120 },
  { elo: 700,  depth: 3,  blunder: 0.17, movetime: 140 },
  { elo: 800,  depth: 3,  blunder: 0.14, movetime: 160 },
  { elo: 900,  depth: 4,  blunder: 0.11, movetime: 200 },
  { elo: 1000, depth: 4,  blunder: 0.09, movetime: 240 },
  { elo: 1100, depth: 5,  blunder: 0.07, movetime: 300 },
  { elo: 1200, depth: 5,  blunder: 0.055, movetime: 360 },
  { elo: 1300, depth: 6,  blunder: 0.045, movetime: 450 },
  { elo: 1400, depth: 6,  blunder: 0.035, movetime: 550 },
  { elo: 1500, depth: 7,  blunder: 0.027, movetime: 700 },
  { elo: 1600, depth: 8,  blunder: 0.020, movetime: 850 },
  { elo: 1700, depth: 9,  blunder: 0.014, movetime: 1000 },
  { elo: 1800, depth: 10, blunder: 0.009, movetime: 1200 },
  { elo: 1900, depth: 11, blunder: 0.005, movetime: 1500 },
  { elo: 2000, depth: 12, blunder: 0.002, movetime: 1800 },
  { elo: 2100, depth: 64, blunder: 0,     movetime: 2400 },
];

const bandLabel = (band, index, all) =>
  index === all.length - 1 ? `${band.elo}+` : `${band.elo}–${band.elo + 100}`;

const bandNote = (band) => {
  const parts = [];
  parts.push(band.depth >= 64 ? 'searches as deep as the clock allows' : `looks ${band.depth} ${band.depth === 1 ? 'move' : 'moves'} ahead`);
  // "0%" for a band that DOES blunder was a lie by rounding: band 2000 plays a
  // random move one time in five hundred, and a reader who saw 0% and then lost
  // a piece to it had been told something false.
  // And "about 1%" for a band that blunders 0.5% of the time was the same lie
  // by rounding one band up: below six percent the wording is one-in-N, which
  // never overstates by more than a rounding of N. bandNoteRate() reads the figure back so a test can hold
  // the printed rate to within a tenth of the stored one.
  // Below six percent a whole-number percentage is more than a tenth out
  // (1.4% printed as 1%, 4.5% as 5%), so one-in-N carries on up to there.
  const pct = band.blunder * 100;
  parts.push(band.blunder === 0
    ? 'never plays a random move'
    : (pct < 6
      ? `plays a random move about one time in ${Math.round(1 / band.blunder)}`
      : `plays a random move about ${Math.round(pct)}% of the time`));
  // Seconds, not milliseconds: "80ms" is an engine's unit, "0.08s" is a
  // person's. bandNoteRate() reads only the blunder rate back, so the time can
  // be worded freely.
  const seconds = band.movetime / 1000;
  parts.push(`${seconds < 1 ? seconds.toFixed(2).replace(/0$/, '') : seconds.toFixed(1)}s a move`);
  return parts.join(', ');
};

/** The blunder rate a note claims, read back from its own wording; 0 for "never". */
const bandNoteRate = (note) => {
  const inN = /one time in (\d+)/.exec(note);
  if (inN) return 1 / Number(inN[1]);
  const pct = /about (\d+)% of the time/.exec(note);
  if (pct) return Number(pct[1]) / 100;
  return 0;
};

/** Bands whose printed blunder rate is more than a tenth off the stored one. Pinned by a test; must be empty. */
const bandNoteDrift = () => BANDS.filter((band) => {
  const claimed = bandNoteRate(bandNote(band));
  return band.blunder === 0 ? claimed !== 0 : Math.abs(claimed - band.blunder) > band.blunder * 0.1;
});
