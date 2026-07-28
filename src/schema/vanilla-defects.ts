/**
 * Fields vanilla writes that are not fields of anything.
 *
 * Each of these is a `static_modifier` id written where a modifier name belongs,
 * inside another static modifier's body. None of the 3,081 static modifier ids
 * is a modifier — the game's own documentation lists zero of them — so the game
 * reads these lines and drops them.
 *
 * They are vanilla's mistakes, not the schema's, which is why they are listed
 * here rather than turned into rules: a rule would teach the checker that the
 * field is fine, and a modder copying the pattern would get no warning. Listing
 * them by name also means a seventh one still fails.
 */
export const vanillaFieldDefects: Readonly<Record<string, readonly string[]>> = {
  static_modifier: [
    // 16_static_modifiers_paragon.txt:359, inside its own definition
    "paragon_death_the_hive_endures",
    // 23_static_modifiers_unplugged.txt:62
    "planet_new_colony_militarist_attraction",
    // 11_static_modifiers_federations.txt:853 and :858
    "proclaim_religious_finding",
    "proclaim_superiority",
    // 25_static_modifiers_nomads.txt:396
    "sacred_path_jobs_bonus_workforce_mult",
    // 21_static_modifiers_cosmic_storms.txt
    "storm_attraction_field_modifier",
  ],
};

/** Whether a field is a known mistake in the base game rather than a hole here. */
export function isVanillaDefect(type: string, field: string): boolean {
  return (vanillaFieldDefects[type] ?? []).includes(field);
}
