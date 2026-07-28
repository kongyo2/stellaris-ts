/**
 * Keys vanilla writes that are not keys of anything.
 *
 * Lines the game reads and drops. There are three, and finding them took
 * checking every candidate: the six `static_modifier` ids that used to be listed
 * here turned out to be a construct rather than a mistake — a static modifier's
 * id inside a modifier block merges its contents in, and vanilla does it 66
 * times across the galactic community, cosmic storms and relay networks.
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
  // common/resolutions/05_resolutions_nomads.txt drops the `galcom_` prefix.
  // The modifiers the game carries are `galcom_senate_recess_...` and
  // `galcom_senate_vote_...`, which is what its own localisation names; these
  // two spellings exist nowhere else and grant nothing.
  "resolution.modifier": ["senate_recess_council_member_speed_mult", "senate_vote_council_member_speed_mult"],
};

/**
 * Whether a key is a known mistake in the base game rather than a hole here.
 *
 * Keyed by type, or by `type.path` for one nested inside a definition.
 */
export function isVanillaDefect(type: string, field: string, path = ""): boolean {
  const site: string = path.length === 0 ? type : `${type}.${path}`;
  return (vanillaFieldDefects[site] ?? []).includes(field);
}
