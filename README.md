# boxman-jr

A friendly crate-pushing puzzle game for kids, right in your terminal.

Push every crate onto a marked spot. That's the whole game — but it gets
cleverer as you go. **91 puzzles** from the classic *Microban* set, starting
with one you can solve in a single move.

```bash
npx boxman-jr
```

No install, no setup. Works on Windows, macOS and Linux.

## Built for young players

This is designed for roughly 7–10 year olds, and the whole thing is arranged so
a child never gets stuck, frustrated, or told off by the computer:

- **Unlimited undo** — press `U` or `Backspace` as much as you like. Nothing is
  ever unrecoverable, so experimenting is safe.
- **You can't lose.** No timers, no move limits, no failure screen.
- **Gentle nudges.** If a crate gets pushed somewhere it can never come back
  from, the game says so kindly instead of letting a child wander confused.
- **A way out.** After a real struggle on one puzzle, the game quietly offers to
  try a different one. Skipping costs nothing and you can always come back.
- **Controls are always on screen.** No manual to remember.
- **It remembers.** Progress is saved automatically; next time you pick up where
  you left off.

Every puzzle is verified by an automated solver before it ships: guaranteed
solvable, at most 4 crates, and never more than 40 pushes. The first puzzle takes
one move.

The solver also measures how much *thinking* each puzzle needs, not just how
long it is, by counting the positions it had to search. That number is what the
puzzles are **ordered by**, so the difficulty climbs steadily instead of
flattening out into rows of puzzles that all feel the same — and the build fails
if anyone drops a puzzle into a pack where the curve would dip.

## Controls

| Key | What it does |
|---|---|
| Arrow keys or `W A S D` | Move |
| `U` or `Backspace` | Undo — as much as you like |
| `R` | Start this puzzle again |
| `Esc` | Choose a different puzzle |
| `H` | Help |
| `Q` | Quit |

## The puzzles

The puzzles are **Microban**, by **David W. Skinner** — 155 small Sokoban
puzzles released in 2000, each one built around a single idea, and recommended
by their author as a good set for beginners and for children.

> These sets may be freely distributed provided they remain properly credited.
> — David W. Skinner

Source: <http://www.abelmartin.com/rj/sokobanJS/Skinner/David%20W.%20Skinner%20-%20Sokoban.htm>

This game ships the 91 of them that fit a terminal window, use at most four
crates, and can be solved in at most forty pushes — selected, verified and
sorted by difficulty with the solver in `tools/`. Full credit, and the licence
terms, are in `levels/microban1/CREDITS.md`.

**The MIT licence in this repository covers the game's code. It does not cover
the puzzles**, which remain David W. Skinner's work.

| Pack | Puzzles | What it's for |
|---|---|---|
| **Warming Up** | 30 | One to four crates. A single push, rising to about twenty. |
| **Getting Tricky** | 31 | Where you start having to plan the order you push things in. |
| **Proper Puzzles** | 30 | Up to forty pushes, for when they've got the hang of it. |

## Graphics

The game draws real pixel art using half-block characters and 24-bit colour: one
terminal character holds two stacked pixels, so a tile is drawn at anything from
4×4 up to 24×24 pixels.

Which of those you get depends on the size of your window, and **rows are what
matter** — a tile of N pixels costs N columns but also N/2 rows, so a taller
window buys detail faster than a wider one. The game picks the largest tile that
fits and says so on the title screen when a bigger window would help.

## If the graphics look wrong

Most terminals handle this well, including Windows Terminal and PowerShell on
Windows 10 or later.

Older Windows consoles using a raster font can't draw those characters. The
first time you run on Windows the game shows a test pattern and asks whether it
looks right — answer `n` and it switches to a clean text mode and remembers.

To check or force it yourself:

```bash
npx boxman-jr --selftest
```

```bash
npx boxman-jr --ascii
```

**Seeing `#` and `@` when you expected pixel art?** Ask for it back:

```bash
npx boxman-jr --pixel-art
```

That sticks, so you only need it once. `--ascii` does the opposite and is
always a one-off — it never quietly becomes your permanent setting. If you
answered the Windows graphics question wrong, `--reset-graphics` forgets the
answer without touching any solved puzzles.

## Options

| Flag | Effect |
|---|---|
| `--ascii` | Plain text instead of pixel art (this run only) |
| `--pixel-art` | Force pixel art back on, and remember it |
| `--blocks=off` | Keep colour, drop the half-block graphics |
| `--color=MODE` | `truecolor`, `ansi256`, `ansi16` or `ascii` |
| `--levels=DIR` | Load your own level packs from a directory |
| `--selftest` | Show a graphics test pattern |
| `--reset-graphics` | Forget the saved graphics choice, keep puzzle progress |
| `--reset-progress` | Start again from the first puzzle |

`NO_COLOR` is respected.

## Making your own puzzles

Levels are plain text files, so a curious child can open one in any text editor
and build their own. The format is the standard Sokoban one:

```
#######
#     #
# @$. #
#     #
#######
```

| Character | Meaning |
|---|---|
| `#` | Wall |
| `@` | Where you start |
| `$` | A crate |
| `.` | A spot to push a crate onto |
| `*` | A crate already on a spot |
| `+` | You, standing on a spot |
| (space) | Floor |

Drop `.sok` files into a folder with a `pack.json` alongside them, and point the
game at it:

```bash
npx boxman-jr --levels=./my-puzzles
```

Adding puzzles never disturbs saved progress — records are keyed by a stable
level id rather than by position, so you can insert a puzzle anywhere in a pack.

## Development

```bash
npm install && npm test
```

The test suite checks the game rules, the undo system, the renderer, and — most
importantly — **solves every shipped puzzle** to prove it's solvable and
age-appropriate. Adding a puzzle that's too hard fails the build, and so does
adding one that's too easy for where it sits, one that repeats a puzzle already
in the game, or a run of puzzles that all feel the same length.

```bash
npm run build && node dist/main.js
```

The limits live in `tools/difficulty.ts`, read by both the test suite and the
importer, so a puzzle can only ship if it meets the bar the importer was
filtering for. To rebuild the packs from the Microban collection in
`tools/data/` — solving, rating and re-sorting every puzzle:

```bash
npx tsc -p tsconfig.test.json
node dist-test/tools/import-microban.js --dry-run
```

## Licence

The **code** is MIT — see [LICENSE](LICENSE).

The **puzzles** are not. They are *Microban* by **David W. Skinner**, included
here under his terms: "These sets may be freely distributed provided they remain
properly credited." Every level file names the puzzle it came from, and
[`levels/microban1/CREDITS.md`](levels/microban1/CREDITS.md) carries the full
credit. If you fork this, keep it.

This is a Sokoban-style puzzle game — an independent implementation of the
box-pushing genre, not affiliated with or endorsed by any other publisher.
