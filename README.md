# boxman-jr

A friendly crate-pushing puzzle game for kids, right in your terminal.

Push every crate onto a marked spot. That's the whole game — but it gets
cleverer as you go. **102 puzzles**, starting with one you can solve in a single
move.

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
solvable, at most 4 crates, and never more than 25 pushes. The first puzzle takes
one move.

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

| Pack | Puzzles | What it's for |
|---|---|---|
| **First Steps** | 30 | Hand-designed. Starts at one move and builds up gently. |
| **The Warehouse** | 40 | Two and three crates, ordered by real difficulty. |
| **Big Puzzles** | 32 | Three and four crates for when they've got the hang of it. |

## If the graphics look wrong

The game draws real pixel art using half-block characters and 24-bit colour.
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

## Options

| Flag | Effect |
|---|---|
| `--ascii` | Plain text instead of pixel art |
| `--blocks=off` | Keep colour, drop the half-block graphics |
| `--color=MODE` | `truecolor`, `ansi256`, `ansi16` or `ascii` |
| `--levels=DIR` | Load your own level packs from a directory |
| `--selftest` | Show a graphics test pattern |
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
age-appropriate. Adding a puzzle that's too hard fails the build.

```bash
npm run build && node dist/main.js
```

## Licence

MIT — see [LICENSE](LICENSE).

All 102 puzzles are original to this project. The 30 in *First Steps* were
hand-designed; the rest were built by a generator that works backwards from a
solved position, then solved forwards to measure real difficulty and keep only
those an eight-year-old can finish.

This is a Sokoban-style puzzle game — an independent implementation of the
box-pushing genre, not affiliated with or endorsed by any other publisher.
