# Where these puzzles come from

The puzzles in this game are **Microban**, by **David W. Skinner**.

> These sets may be freely distributed provided they remain properly credited.
> -- David W. Skinner

Source: http://www.abelmartin.com/rj/sokobanJS/Skinner/David%20W.%20Skinner%20-%20Sokoban.htm

Skinner wrote four Microban sets between 2000 and 2010 - small puzzles, most of
them built around a single idea, and explicitly recommended by their author as
"good for beginners and children". This game ships the subset of three of them
that fits a terminal window, uses at most 4 crates, and can be solved
in at most 40 pushes - selected, verified and ordered by difficulty
using the solver in tools/, by tools/import-microban.ts:

- **Microban** (April 2000): 93 of its 155 puzzles
- **Microban II** (April 2002): 63 of its 135 puzzles
- **Microban III** (December 2009): 61 of its 101 puzzles

Each level file names the set and number it came from in its first line, so any
board here can be traced back to its place in the original collection.

**The MIT licence in this repository covers the game's code. It does not cover
these puzzles**, which remain David W. Skinner's work and are included here on
the terms quoted above.
