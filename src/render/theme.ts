/**
 * Shared colour palette. Both renderers pull from here so the ASCII and
 * pixel-art modes look like the same game.
 *
 * The pixel art leans on three ideas that the first version of this file had no
 * colours for, and which are most of what makes a board readable at a glance:
 *
 *   outline   every object gets a near-black silhouette, so a crate reads as a
 *             crate and not as a differently-coloured patch of floor.
 *   shadow    floor in shade, cast below walls and under objects. Depth is what
 *             turns a flat grid into a room you are standing in.
 *   wallTop   the lit cap on a wall's top edge. Without it every wall tile is
 *             identical and the SHAPE of the maze is invisible.
 */

import type { RGB } from './color.js';

export const theme = {
  wallTop: [156, 132, 116] as RGB,
  wallLight: [122, 100, 88] as RGB,
  wallDark: [78, 62, 54] as RGB,
  wallMortar: [62, 50, 44] as RGB,
  wallEdge: [52, 41, 36] as RGB,

  floor: [36, 34, 46] as RGB,
  floorDot: [52, 49, 66] as RGB,
  shadow: [22, 21, 30] as RGB,

  /** Near-black silhouette shared by every object that sits on the floor. */
  outline: [20, 16, 24] as RGB,

  crateHighlight: [242, 194, 124] as RGB,
  crateLight: [214, 154, 72] as RGB,
  crateMid: [176, 116, 48] as RGB,
  crateDark: [124, 78, 30] as RGB,
  /** The metal strap around a crate, and its plank seams. */
  crateBand: [92, 56, 22] as RGB,

  crateDoneHighlight: [178, 240, 158] as RGB,
  crateDoneLight: [126, 214, 118] as RGB,
  crateDoneMid: [78, 174, 82] as RGB,
  crateDoneDark: [46, 122, 58] as RGB,
  crateDoneBand: [28, 84, 42] as RGB,

  goal: [240, 200, 90] as RGB,
  goalGlow: [255, 236, 158] as RGB,
  goalDim: [150, 122, 54] as RGB,

  skin: [246, 205, 168] as RGB,
  skinShadow: [212, 162, 124] as RGB,
  shirt: [82, 152, 226] as RGB,
  shirtLight: [132, 192, 246] as RGB,
  shirtDark: [48, 98, 162] as RGB,
  hair: [70, 48, 38] as RGB,
  hairLight: [104, 74, 56] as RGB,
  eye: [26, 24, 30] as RGB,
  mouth: [188, 104, 96] as RGB,

  stuck: [226, 92, 92] as RGB,

  text: [232, 230, 240] as RGB,
  textDim: [150, 148, 164] as RGB,
  accent: [246, 200, 96] as RGB,
  good: [126, 214, 118] as RGB,
  bad: [226, 92, 92] as RGB,
} as const;
