// The words the interface is allowed to use.
//
// A CHESS APP SHOULD SPEAK CHESS, NOT ENGINE. "A 5-ply search" is engine
// vocabulary: a ply is half a move, and nobody sitting at a board counts in
// them. It was on the Watch screen next to one of the most famous moves ever
// played, and the person using the app asked what it meant — which is the only
// review of a phrase that matters.
//
// The same goes for the unit. An engine works in centipawns and the app used
// to print "0.37 of a pawn", which is a real convention and still reads oddly
// beside a board full of actual pawns. Club players count material in POINTS,
// so that is what the screens say.
//
// This scans every string the interface can show and fails on the banned
// words. It looks at src/body.html and the app files; the opening lessons in
// openings.js are prose about real pawns on real squares and are left alone.
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const BANNED = [
  // A WORD IS ONLY BANNED WHERE IT IS PROSE. `parsed.plies.length` and
  // `const ply = ...` are identifiers; nobody reads those. Every pattern here
  // needs a number or a sentence around the word, so the guard is precise and
  // does not cry wolf — a check that reports thirty identifiers is a check
  // people learn to skip, which is worse than not having one.
  { word: /\b\d+[- ]pl(?:y|ies)\b/i, why: 'a ply is half a move — say how many moves ahead' },
  { word: /\}\s*pl(?:y|ies)\b/i, why: 'a ply is half a move — say how many moves ahead' },
  { word: /(?:searched|looked|deep|ahead)[^.\n]{0,20}\bpl(?:y|ies)\b/i, why: 'a ply is half a move — say how many moves ahead' },
  { word: /\bcentipawns?\b/i, why: 'an engine unit — say points' },
  // The unit, but only where a NUMBER is being called a pawn. Real pawns on
  // real squares are the subject of half the opening prose and are fine.
  { word: /\}\s*(?:of a )?pawns?\b/, why: 'material is counted in points' },
  { word: /\b(?:half|a quarter of) a pawn\b/i, why: 'material is counted in points' },
  { word: /\bpawns? (?:ahead|up|behind|down|worse|better)\b/i, why: 'material is counted in points' },
  { word: /\bin pawns\b/i, why: 'material is counted in points' },
  { word: /\bpawns a move\b/i, why: 'material is counted in points' },
  // THE ONE THAT GOT THROUGH: the coach's own instructions told it to write
  // "White is winning by about five pawns", which no pattern above matches —
  // "five pawns" has no "up"/"ahead"/"of a" around it. A counted quantity of
  // pawns IS the unit; pawns standing on squares are the exception, so the
  // squares are what the guard lets past.
  { word: /\b(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten) pawns?\b(?!\s+(?:on|at|from|to|down|across|abreast|in front|and ))/i,
    why: 'material is counted in points' },
];

// Files whose strings reach a screen. openings.js, famous.js and
// notation-lessons.js are chess prose about pieces and are exempt by name.
const files = ['src/body.html', ...readdirSync(new URL('src/', root))
  .filter((f) => /^(app-|review|import|deviation|motifs|traps)/.test(f) && f.endsWith('.js'))
  .map((f) => 'src/' + f)];

/**
 * The strings a file can put on a screen — and nothing else.
 *
 * The first version of this scanned the whole source and failed on
 * `parsed.plies.length`, which is a property name and not something anybody
 * reads. A word only matters here if it can reach a person, so this pulls out
 * the string literals from JavaScript and the text and visible attributes from
 * the markup, and looks at those.
 */
/** A file's source with its comments removed — they quote the banned words. */
function copyOf(raw) {
  return raw
    // Trailing comments too — "// centipawns their move gave away" is an
    // explanation of a constant, not something anybody reads on a screen. URLs
    // are left alone, since "https://" is not a comment.
    .replace(/(^|\s)\/\/(?!\/)(?![^\n]*https?:).*$/gm, '$1')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

let checked = 0, bad = [];
for (const file of files) {
  const src = copyOf(readFileSync(new URL(file, root), 'utf8'));
  checked++;
  for (const { word, why } of BANNED) {
    const all = new RegExp(word.source, word.flags.includes('i') ? 'gi' : 'g');
    for (const m of src.matchAll(all)) {
      const line = src.slice(0, m.index).split('\n').length;
      const context = src.split('\n')[line - 1]?.trim().slice(0, 100) ?? '';
      bad.push(`${file}:${line}  "${m[0]}" — ${why}\n      ${context}`);
    }
  }
}

console.log(`${checked} files scanned for engine vocabulary`);
if (bad.length) {
  console.log('\nWORDS THE INTERFACE SHOULD NOT USE:');
  for (const b of bad) console.log('  ' + b);
  process.exit(1);
}
console.log('the interface speaks chess.');
