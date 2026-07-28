# @kongyo2/stellaris-ts

Write Stellaris mods in TypeScript. Get a mod folder the game loads.

```bash
npm install @kongyo2/stellaris-ts
```

```ts
import { define } from "@kongyo2/stellaris-ts/builders";
import { defineMod } from "@kongyo2/stellaris-ts";

export default defineMod({
  name: "My Mod",
  version: "1.0.0",
  supportedVersion: "v4.4.*",
  tags: ["Gameplay"],
})
  .add(
    define("building", "my_lab", {
      category: "research",
      base_buildtime: 360,
      potential: { exists: "owner" },
      planet_modifier: { job_researcher_add: 2 },
    }),
  )
  .localise("l_english", "my_lab", "My Laboratory")
  .localise("l_english", "my_lab_desc", "A research building.");
```

```bash
npx stellaris-ts check mod.ts   # validate
npx stellaris-ts build mod.ts   # validate, then write into the mod folder
```

## The shape is the script

A definition body is PDX script with different punctuation. `category = research`
becomes `category: "research"`, and a block becomes an object. If you know what
the game expects, you already know what to write — there is no second vocabulary.

**Every definition Stellaris ships can be written this way.** All 40,550 of them
are converted back into what `define()` takes, printed, re-parsed and compared
against the original on every run. The rate is pinned at 100%, so anything that
drops it fails the build.

Four constructs need more than a plain object, because the format holds more than
a plain object can:

```ts
import { bare, entries, gt, raw, repeated, rgb } from "@kongyo2/stellaris-ts";

{
  potential: {
    num_owned_planets: gt(1),                  // num_owned_planets > 1
    has_modifier: repeated("a", "b"),          // two lines, not a value list
  },
  convert_to: ["building_a", "building_b"],    // convert_to = { a b }
  colour: rgb(255, 0, 0),                      // rgb { 255 0 0 }
  cost: raw("@[ base * 2 ]"),                  // anything else
  ordered: entries([["a", 1], bare("x"), ["a", 2]]),
}
```

## What it checks

`stellaris-ts check` catches what the game accepts silently and then ignores:

- a field the definition type does not have
- a modifier name nothing generates, inside a modifier block
- the same id defined twice, where only the last one loads
- a required localisation key that would ship as its own name
- a reference to something neither vanilla nor your mod defines
- **a file name vanilla already uses**, which replaces that file outright and
  disables everything else it defined — the most expensive mistake in Stellaris
  modding, and one the game gives no warning about

The types and the checker do different jobs on purpose. A definition type whose
schema has open rules accepts arbitrary keys, so unknown fields belong to the
checker; narrowing the type instead would reject script the game accepts.

## Types

234 definition types, 2,339 triggers and effects, 206 enums, 41 scopes, and the
70,727 identifiers vanilla declares — generated from a schema ported once from
[cwtools-stellaris-config](https://github.com/cwtools/cwtools-stellaris-config)
and since checked against the game itself.

Triggers and effects are typed per scope, so a country-only trigger is not
offered in a planet block. That constraint comes from the game's own `-debug`
documentation; the ported corpus carries none.

## Modifiers

`planet_modifier = { job_reseacher_add = 2 }` is the most expensive typo in
Stellaris after a file-name collision: the block is right, the field is right,
and the game drops the line without a word. `check` catches it.

It can, because modifier names are not a list here. The game generates them —
`job_researcher_add` exists because `researcher` is a job — so the rules are
stored and expanded against whatever is defined, **including your mod**. Add a
job called `my_job` and `job_my_job_add` starts validating, exactly as the game
would treat it.

```ts
planet_modifier: {
  job_researcher_add: 2,       // ok — researcher is a vanilla job
  job_reseacher_add: 2,        // error: not a modifier
}
```

```ts
import type { BuildingDefinition, CountryTriggers } from "@kongyo2/stellaris-ts/types";
```

## Subpaths

| | |
| --- | --- |
| `.` | `defineMod`, `emit`, `writePlan`, the value helpers |
| `./builders` | `define`, `defineIn` |
| `./types` | generated definition, scope and reference types |
| `./validate` | the checker, on its own |
| `./syntax` | `parse`, `print`, the PDX AST |
| `./schema` | the schema itself, for building tooling |
| `./ids` | the vanilla identifier lists |

## Requirements

Node 22 or later. Targets Stellaris 4.4; the generated data is versioned with it.

## Contributing

`npm run verify` is the gate. Parts of it need Stellaris installed — set
`STELLARIS_GAME_PATH` if it is not in a standard Steam location. CI runs
everything that does not.

[AGENTS.md](AGENTS.md) covers how the pieces fit and which invariants matter.

## Licence

MIT. The schema derives from cwtools-stellaris-config, also MIT — see
[THIRD_PARTY.md](THIRD_PARTY.md). Identifiers taken from an installed copy of
Stellaris are names only; no game content is redistributed.
