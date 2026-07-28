# stellaris-ts

Write Stellaris mods in TypeScript, and find out what is wrong with them before
the game does.

Stellaris says nothing when a mod is wrong. A misspelled trigger is a condition
that never fires, a misspelled modifier is a line dropped on load, a trigger read
on the wrong kind of object answers `false` for ever, and a missing string shows
in-game as its own key. Nothing appears in a log. This library carries what the
game accepts — every key, at every depth — and checks a mod against it.

```bash
npm install @kongyo2/stellaris-ts
```

## Writing a mod

A definition body is the PDX script with different punctuation.

```ts
import { defineMod, emit, writePlan } from "@kongyo2/stellaris-ts";
import { define } from "@kongyo2/stellaris-ts/builders";

const mod = defineMod({
  name: "Example",
  version: "1.0.0",
  supportedVersion: "v4.4.*",
  tags: ["Gameplay"],
})
  .add(
    define("building", "sts_example_lab", {
      category: "research",
      base_buildtime: 360,
      potential: { exists: "owner" },
      allow: { has_upgraded_capital: true },
      resources: {
        category: "planet_buildings",
        cost: { minerals: 300 },
        upkeep: { energy: 3 },
      },
      planet_modifier: { job_researcher_add: 2 },
    }),
  )
  .localise("l_english", "sts_example_lab", "Example Laboratory")
  .localise("l_english", "sts_example_lab_desc", "A research building.");

await writePlan(mod, emit(mod), modsDirectory);
```

`define` knows where each type lives, so the directory is never a decision. It
also knows the 43 types whose block key is a tag rather than their identity — an
event is `country_event = { id = utopia.1 }`, never `utopia.1 = { ... }` — and
asks for the tag:

```ts
define("event", "utopia.1", { is_triggered_only: true }, { as: "country_event" });
```

The file gets its `namespace = utopia` line, and the id goes inside the block.

Types the library has no shape for can still go in, verbatim:

```ts
mod.file({ path: "common/inline_scripts/my_script.txt", contents: "..." });
```

## Checking it

```bash
npx stellaris-ts check ./mod.ts     # report, write nothing
npx stellaris-ts build ./mod.ts     # report, then write the mod folder
```

One diagnostic per line, `where: severity: code: message`, no colour. The same
check is available as a function:

```ts
import { validate } from "@kongyo2/stellaris-ts/validate";
```

What it reports:

- a key no rule accepts, anywhere in the body — `allow = { has_country_flagg = yes }`
  is caught inside `allow`, and inside anything inside that;
- a modifier name the game does not generate, including the ones the mod's own
  definitions bring into existence;
- a value outside what the rules take — the wrong member of an enum, a word where
  a number belongs;
- a trigger or effect read on the wrong kind of object, following the scope down
  through links, iterators and scope changes;
- a reference to something neither the base game nor the mod defines;
- a required field the definition has not got;
- a parameter a scripted trigger or effect does not take;
- a string a definition needs and the mod has not localised;
- an id the base game already uses, which this would replace;
- a file name the base game already ships, which this would replace wholesale;
- a `replace_path` naming a directory the game does not load from;
- a `supported_version` the launcher cannot read, or that does not cover the
  installed game.

Everything reported is measured against the installed game rather than inferred:
1,854,633 keys of base-game script pass this checker with three exceptions, and
those three are lines vanilla itself writes and the game drops.

## The mod around the definitions

```ts
defineMod({
  name: "Example",
  version: "1.0.0",
  supportedVersion: "v4.4.*",
  dependencies: ["Some Framework"],
  replacePaths: ["common/buildings"],
});
```

`dependencies` is the only way to say what must load first; load order is
otherwise alphabetical by folder. `replacePaths` is the only way to *remove* a
base-game definition — a mod's files are added to a directory, never merged into
it — and it hides everything else that directory held, which is reported when you
use it.

To override a string the base game defines, `localiseReplace` writes it where the
game reads it last:

```ts
mod.localiseReplace("l_english", "building_capital", "Palace");
```

## Types

The generated types follow the script one to one, and complete with what the game
has: `VanillaBuildingId` for every building the base game ships, the members of
each enum, and — where the schema knows which object a body reads — the triggers
and effects that object accepts.

```ts
import type { BuildingDefinition, TriggersFor } from "@kongyo2/stellaris-ts/types";
```

A mod's own identifiers stay assignable everywhere a base-game one is, so
`prerequisites: ["tech_basic_science_lab_1", "my_own_tech"]` is fine.

## Working on the library

The schema is maintained here. It was ported once from
[cwtools-stellaris-config](https://github.com/cwtools/cwtools-stellaris-config)
and nothing reads `.cwt` at build or run time.

```bash
npm run verify            # 15 gates
```

Five of them read an installed copy of Stellaris, found through
`STELLARIS_GAME_PATH` or the usual Steam locations. They check the schema in both
directions against the game, that every definition the game ships could have been
written through `define`, and that the parser and printer round-trip all 2,214
files.

The committed data under `src/generated/` is regenerated in this order, because
each proposer must see the corpus without its own output:

```bash
npm run index:game
npm run import:modifiers
npm run propose:commands
npm run propose:scopes
npm run propose:corrections
npm run codegen
```

## Licence and content

MIT. See `THIRD_PARTY.md` for the ported schema's attribution.

Only identifier *names* are taken from the game: no localisation text, no numeric
balance, no script bodies, no assets. Stellaris is © Paradox Interactive AB, and
this project is unaffiliated with them.
