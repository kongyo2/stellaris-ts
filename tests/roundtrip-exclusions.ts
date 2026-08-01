export interface RoundtripExclusion {
  readonly path: string;
  readonly reason: string;
}

export const roundtripExclusions: readonly RoundtripExclusion[] = [
  {
    path: "common/HOW_TO_MAKE_NEW_SHIPS.txt",
    reason: "Contains uncommented English ship-authoring prose interleaved with examples, so it is not a PDX script.",
  },
  {
    path: "common/edicts/99_README_EDICTS.txt",
    reason: "Contains three uncommented English documentation headings that are not valid PDX entries.",
  },
  {
    path: "common/scripted_loc/scripted_loc_ruloc.txt",
    reason: "The vanilla defined_text block opened at line 312 is missing its closing brace at end of file.",
  },
  {
    path: "gfx/models/effects/nomads.gfx",
    reason: "Vanilla writes 15 opening braces and 14 closing ones; the last object is never closed.",
  },
  {
    path: "gfx/models/ui/nomads_frontend.gfx",
    reason: "Vanilla writes 9 opening braces and 8 closing ones; the last object is never closed.",
  },
];
