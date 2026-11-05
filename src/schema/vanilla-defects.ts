/**
 * Keys vanilla writes that are not keys of anything.
 *
 * Lines the game reads and drops. There is one, and finding it took checking
 * every candidate: the six `static_modifier` ids that used to be listed here
 * turned out to be a construct rather than a mistake — a static modifier's id
 * inside a modifier block merges its contents in, and vanilla does it 66 times
 * across the galactic community, cosmic storms and relay networks. The two
 * `senate_*_council_member_speed_mult` modifiers in
 * common/resolutions/05_resolutions_nomads.txt were listed as well, until the
 * modifier dump moved past 4.3.7: the game has carried both since 4.4.
 *
 * They are listed here rather than turned into rules because a rule would teach
 * the checker that the key is fine, and a modder copying the pattern would get
 * no warning. Listing them by name also means the next one still fails.
 */
export const vanillaFieldDefects: Readonly<Record<string, readonly string[]>> = {
  // common/name_lists/MACHINE3.txt names an army type that does not exist: the
  // army is `perfected_clone_army`, and the prefix is doubled. The sequential
  // name it carries is never used.
  "name_list.army_names": ["perfected_perfected_clone_army"],
};

/**
 * Values vanilla writes that are not values of anything.
 *
 * Three typos in asset files, each in a numeric field: a stray semicolon, a
 * doubled decimal point, and two letters of a note left on the end of a volume.
 * The game reads what it can of each and carries on, which is why they have
 * survived.
 */
export const vanillaValueDefects: Readonly<Record<string, readonly string[]>> = {
  // gfx/models/ships/colossus/aquatic_01/aquatic_01_colossus.asset: `scale = 1;`
  "model_entity.scale": ["1;"],
  // gfx/models/effects/cosmic_storms: `uv_animation_speed = .0.2`
  "model_entity.game_data.uv_animation_speed": [".0.2"],
  // sound/guardians/guardians.asset: `volume = 0.8dw`
  "sound_effect.volume": ["0.8dw"],
};

/** Whether a value is a known mistake in the base game rather than a narrow rule. */
export function isVanillaValueDefect(type: string, path: string, field: string, value: string): boolean {
  const site: string = path.length === 0 ? `${type}.${field}` : `${type}.${path}.${field}`;
  return (vanillaValueDefects[site] ?? []).includes(value);
}

/**
 * Whether a key is a known mistake in the base game rather than a hole here.
 *
 * Keyed by type, or by `type.path` for one nested inside a definition.
 */
export function isVanillaDefect(type: string, field: string, path = ""): boolean {
  const site: string = path.length === 0 ? type : `${type}.${path}`;
  return (vanillaFieldDefects[site] ?? []).includes(field);
}
