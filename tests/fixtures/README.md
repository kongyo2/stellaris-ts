# Fixture provenance

These files are byte-preserved extracts from the installed Stellaris 4.4.6 corpus. Do not format, re-encode, or
normalize their line endings. `tests/fixture-roundtrip.test.ts` locks every `.txt` fixture by SHA-256.

Complete files retain their game-relative path:

- `common/component_tags/00_tags.txt`
- `common/gamesetup_settings/gamesetup_settings.txt`
- `common/name_lists/IA.txt`
- `common/named_colors/01_trait_colors.txt`
- `events/federations_vote_events.txt`
- `map/setup_scenarios/tiny.txt`
- `prescripted_countries/default.txt`

The three reduced, brace-balanced extracts retain their source bytes exactly, including their final LF:

- `common/script_values/optional-bonus.txt`: source `common/script_values/00_script_values.txt`, lines 1615–1620,
  byte range `[31194, 31268)`.
- `common/static_modifiers/direct-inline-math.txt`: source
  `common/static_modifiers/25_static_modifiers_nomads.txt`, lines 565–568, byte range `[15844, 16024)`.
- `common/scripted_effects/escaped-inline-math.txt`: source
  `common/scripted_effects/first_contact_effects.txt`, lines 983–996, byte range `[27627, 27893)`.
