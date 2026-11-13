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
  supportedVersion: "v4.5.*",
  tags: ["Gameplay"],
})
  .add(
    define("building", "sts_example_lab", {
      category: "research",
      building_sets: ["research"],
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

`define` knows where each type lives, so where a definition goes is never a
decision: the directory, the extension the game reads there, and the block the
type is read from inside. A sprite is written into `spriteTypes = { }` in a
`.gfx` file and a sound effect into a `.asset` file, because the game reads them
nowhere else. It also knows the 43 types whose block key is a tag rather than
their identity — an event is `country_event = { id = utopia.1 }`, never
`utopia.1 = { ... }` — and asks for the tag:

```ts
define("event", "utopia.1", { is_triggered_only: true }, { as: "country_event" });
```

The file gets its `namespace = utopia` line, and the id goes inside the block.

A body is an object, so each key is written once. An array is that key holding
a list — `prerequisites: ["tech_a", "tech_b"]` is `prerequisites = { tech_a tech_b }`
— and `repeated()` writes the key once per value, which is how an event gets
two options:

```ts
import { repeated } from "@kongyo2/stellaris-ts";

option: repeated({ name: "utopia.1.a" }, { name: "utopia.1.b" }),
```

The same key written twice in one object literal keeps only the last value, and
the checker never sees the first. `tsc --noEmit` reports it as TS1117.

An object also keeps a key's repetitions together, which is all a building
needs and wrong for anything that runs in order. A scripted effect, an
`immediate` and an option run top to bottom, so where a key comes back after
another one — `set_variable`, then `if`, then `set_variable` again — the block
is an ordered list, and the body of a definition takes one as well as any block
inside it:

```ts
import { entries } from "@kongyo2/stellaris-ts";

define(
  "scripted_effect",
  "sts_pay_loan",
  entries([
    ["set_variable", { which: "sts_debt", value: 1 }],
    ["if", { limit: { always: true }, set_variable: { which: "sts_debt", value: 2 } }],
    ["set_variable", { which: "sts_paid", value: "sts_debt" }],
  ]),
);
```

`repeated()` there would write both `set_variable` before the `if`.

Types the library has no shape for can still go in, verbatim, and so can the
icons and sounds the definitions point at:

```ts
mod.file({ path: "common/inline_scripts/my_script.txt", contents: "..." });
mod.asset("gfx/interface/icons/buildings/sts_example_lab.dds", bytes);
```

A mod of any size is split across files. Node reads the entry directly — 22.18
and later run TypeScript with no build step — so it resolves the specifier as
written: import the sibling as `./content.ts`, with
`"allowImportingTsExtensions": true` in `tsconfig.json`. `./content.js` fails on
a filename you never wrote.

## Checking it

```bash
npx stellaris-ts check ./mod.ts     # report, write nothing
npx stellaris-ts build ./mod.ts     # report, then write the mod folder
npx stellaris-ts --version          # and the game build it checks against
```

`--language japanese` checks the strings a definition needs in Japanese rather
than English; repeat it, or write `--language english,japanese`, to check more
than one. Options may stand before or after the entry.

`build` writes into the launcher's mod folder — on Windows, the one under
OneDrive when that is where the game keeps it — unless `--out` or
`STELLARIS_MODS_DIR` names another. It lists what it wrote in
`.stellaris-ts-files.json` beside the files, and the next build deletes any of
those it no longer writes, so a definition you removed stops loading too.
Nothing it did not write is touched. A file it cannot delete — the game holds
its files open while it runs — is printed as `STUCK`, stays listed for the next
build, and makes this one exit 1: the folder still holds a file the game reads.

One diagnostic per line, `where: severity: code: message`, no colour. The same
check is available as a function:

```ts
import { validate } from "@kongyo2/stellaris-ts/validate";
```

What it reports:

- a key no rule accepts, anywhere in the body — `allow = { has_country_flagg = yes }`
  is caught inside `allow`, and inside anything inside that;
- a modifier name the game does not generate, including the ones the mod's own
  definitions bring into existence — and a static modifier's name is a key of a
  modifier block too, the mod's own as much as the base game's
  `artisan_jobs_bonus_workforce_mult`;
- a value outside what the rules take — the wrong member of an enum, a word where
  a number belongs;
- a block where the game reads a single value — an event's `title = { ... }`,
  which the game titles `{` before reading the rest of the block as part of the
  event;
- a comparison outside a trigger — `add_resource = { energy > 500 }` adds 500,
  because nothing there reads the operator;
- an array of blocks under a key that takes none — `option: [{ ... }, { ... }]`
  is one option holding two blocks with no key, and the event has no options;
- a trigger or effect read on the wrong kind of object, following the scope down
  through links, iterators and scope changes;
- a trigger, an effect or a `who = root` read where there is no scope at all: an
  event that only `on_yearly_pulse`, the other pulses or `on_game_start` fire
  runs with none, and so does every scripted effect it calls;
- a reference to something neither the base game nor the mod defines,
  counting what the mod's own raw files define — a sprite in its `.gfx`, a
  scripted trigger written by hand;
- a name the game builds and cannot find: the entity a ship size is drawn
  with, `<key>_entity` when it names none, and the sprite
  `GFX_<key>_outliner_icon` the outliner shows a megastructure by;
- a required field the definition has not got;
- a parameter a scripted trigger or effect does not take;
- a string a definition needs or names that neither the mod nor the base game
  defines — its own name, an event's `title`, `desc` and options, a
  `custom_tooltip` or `fail_text`, a situation's stages and approaches, a
  policy option's `_desc` and each policy flag's `_name`, each item of a list
  of strings such as a timeline event's `text` — which the game shows as the
  key itself;
- what the game logs at load as something that "will not display well": a
  situation approach with nothing to show, an `on_fail` holding a single
  effect, and a condition with no `desc` in the weights the game shows reason
  by reason, a resolution's `ai_weight` among them;
- what it logs about an event: one with neither `is_triggered_only` nor a mean
  time, which it tries to fire every day, or written under a key it fires
  nothing by mean time for; a `mean_time_to_happen` in a triggered event, a
  `weight_multiplier` in one that is not, and `is_triggered_only` written
  after either, since it reads an event's fields in order; a window with no
  title, desc, picture or option, and a hidden event with options; an option
  holding both `trigger` and `exclusive_trigger`;
- a building in no `building_sets`, which no zone's slots admit; a district
  with no `zone_slots`, which the game says will crash it; a game concept
  whose key does not start with `concept_`;
- an `else` or an `else_if` that does not follow an `if`: the game matches it
  to the effect read just before it in the same block, and drops the branch
  when that is anything else;
- a scripted effect or trigger named as one the game itself provides, and a
  static modifier named as a modifier, each of which the game logs as
  "overwriting an existing" one;
- an id the base game already uses, and what becomes of it. The game reads a
  directory's files in the order of their names, the base game's and a mod's
  alike. For most types it keeps the last definition of an id it reads, so
  the default file, which sorts after the base game's, replaces the base
  game's; for events it keeps the first, and the same file is read too late:
  the definition is dropped, which is an error rather than an override. Not
  in the directories the game merges, where adding to `on_game_start` is the
  point;
- an id the mod defines twice, with which of the two the game keeps;
- a file name the base game already ships, which this would replace wholesale;
- a definition in a file the game never opens for its type — a sprite named
  into a `.txt` file, an alert anywhere but `common/alerts.txt`;
- an `inline_script` block that names no `script` to inject;
- a `@name` the game would refuse to register, after which every use of it is
  read as the literal text;
- a `replace_path` naming a directory the game does not load from;
- a `supported_version` the launcher cannot read, or that does not cover the
  installed game.

Everything reported is measured against the installed game rather than inferred:
the base game's own script passes this checker except where vanilla itself is
wrong, and each of those is listed by name — a line it writes and the game
drops, an event whose trigger reads a country flag where there is no country,
28 strings it names and never wrote, and 40 definitions that lack a string the
rest of their type has. What the game logs is held to the same measure: its
10,023 events, 3,371 scripted effects and triggers and 4,392 `else` branches
pass the checks above without one finding, as they load without one line.

The parser underneath is measured the same way. Its token boundaries are the
game's own, read out of the executable rather than inferred from what script
happens to look like — the twelve characters that end a bare token, `;` as a
line comment beside `#`, `greater_than` as another spelling of `>`, and the
absence of any `==` operator. A value holding one of those characters is quoted
on the way out, because an unquoted `;` would take the rest of its line with it
and nothing would say so.

## The mod around the definitions

```ts
defineMod({
  name: "Example",
  version: "1.0.0",
  supportedVersion: "v4.5.*",
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
npm run verify            # 17 gates
```

Seven of them read an installed copy of Stellaris, found through
`STELLARIS_GAME_PATH` or the usual Steam locations. They check the schema in both
directions against the game, that every definition the game ships could have been
written through `define`, that the generated types accept the game's own
definitions, and that the parser and printer round-trip every file of it —
`gfx` and `interface` included, because those are where `,` and `;` are actually
written. The seventh reads the game's executable and holds the lexer to the
character tables and keyword ids it finds there, so an update that changes how
the game splits script shows up as a failure rather than as every other gate
agreeing with the lexer it shares.

The committed data under `src/generated/` is regenerated in this order, because
each proposer must see the corpus without its own output. The importers read the
game's `-debug` dumps from `refs/`, which `npm run refs:sync` clones, and the
generators do not format what they write:

```bash
npm run refs:sync
npm run index:game
npm run import:modifiers
npm run import:scopes
npm run import:localisations
npm run propose:commands
npm run propose:scopes
npm run propose:corrections
npm run codegen
npm run format
```

## Licence and content

MIT. See `THIRD_PARTY.md` for the ported schema's attribution.

Only identifier *names* are taken from the game: no localisation text, no numeric
balance, no script bodies, no assets. Stellaris is © Paradox Interactive AB, and
this project is unaffiliated with them.
