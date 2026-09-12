/**
 * Shared colour palette. Both renderers pull from here so the ASCII and
 * pixel-art modes look like the same game.
 */

import type { RGB } from './color.js';

export const theme = {
  wallLight: [122, 100, 88] as RGB,
  wallDark: [78, 62, 54] as RGB,
  wallEdge: [52, 41, 36] as RGB,

  floor: [36, 34, 46] as RGB,
  floorDot: [52, 49, 66] as RGB,

  crateLight: [214, 154, 72] as RGB,
  crateMid: [176, 116, 48] as RGB,
  crateDark: [124, 78, 30] as RGB,

  crateDoneLight: [126, 214, 118] as RGB,
  crateDoneMid: [78, 174, 82] as RGB,
  crateDoneDark: [46, 122, 58] as RGB,

  goal: [240, 200, 90] as RGB,
  goalDim: [150, 122, 54] as RGB,

  skin: [246, 205, 168] as RGB,
  shirt: [82, 152, 226] as RGB,
  shirtDark: [52, 106, 172] as RGB,
  hair: [70, 48, 38] as RGB,
  eye: [30, 28, 34] as RGB,

  stuck: [226, 92, 92] as RGB,

  text: [232, 230, 240] as RGB,
  textDim: [150, 148, 164] as RGB,
  accent: [246, 200, 96] as RGB,
  good: [126, 214, 118] as RGB,
  bad: [226, 92, 92] as RGB,
} as const;
