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

A string has to exist in every language a player may be playing in: a language
with no entry for a key shows the key itself, whatever the other languages say.
`localiseAll` writes one key in the languages it is given and, for each of the
other languages the game reads, the English text:

```ts
mod.localiseAll("sts_example_lab", { english: "Example Laboratory", japanese: "研究所" });
```

A body is an object, so each key is written once. An array is that key holding
a list — `prerequisites: ["tech_a", "tech_b"]` is `prerequisites = { tech_a tech_b }`
— and `repeated()` writes the key once per value, which is how an event gets
two options:

```ts
import { repeated } from "@kongyo2/stellaris-ts";

option: repeated({ name: "utopia.1.a" }, { name: "utopia.1.b" }),
```

The same key written twice in one object literal keeps only the last value, and
the checker never sees the first. `tsc --noEmit` reports it as TS1117. It does
not report a key that arrives twice through spread syntax, and nothing that
reads the object afterwards can: `{ ...posture, has_country_flag: "sts_prey" }`
is an object with one `has_country_flag` by the time `define` is handed it. Conditions assembled from
parts are better never merged, and `all()` keeps each in a block of its own:

```ts
import { all } from "@kongyo2/stellaris-ts";

potential: all(posture, { has_country_flag: "sts_prey" }),
// potential = { AND = { … } AND = { has_country_flag = sts_prey } }
```

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

The constants of `common/defines` are types like any other, one for each block,
and a block is written with only the keys it changes:

```ts
define("NAI", "NAI", { AI_INCOME_TARGET_BUFFER_FACTOR: 0.25 });
```

A key the game does not declare is reported — it would be stored and never
read — and `vanillaFieldNames.NAI` from `@kongyo2/stellaris-ts/ids` lists the
603 it does.

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
npx stellaris-ts check ./mod.ts       # report, write nothing
npx stellaris-ts build ./mod.ts       # report, then write the mod folder
npx stellaris-ts explain wrong-scope  # what a code means, and what to change
npx stellaris-ts --version            # and the game build it checks against
```

`--language japanese` checks the strings a definition needs in Japanese rather
than English; repeat it, or write `--language english,japanese`, to check more
than one. Options may stand before or after the entry. `validate` takes the
same names in its `languages`, `japanese` or `l_japanese`, and reports one the
game reads no language under.

`build` writes into the launcher's mod folder — on Windows, the one under
OneDrive when that is where the game keeps it — unless `--out` or
`STELLARIS_MODS_DIR` names another. It lists what it wrote in
`.stellaris-ts-files.json` beside the files, and the next build deletes any of
those it no longer writes, so a definition you removed stops loading too.
Nothing it did not write is touched. A file it cannot delete — the game holds
its files open while it runs — is printed as `STUCK`, stays listed for the next
build, and makes this one exit 1: the folder still holds a file the game reads.

One diagnostic per line, `where: severity: code: message`, no colour;
`--format json` prints the same report as one JSON document. A code is one of a
closed set: `stellaris-ts explain` lists them, each with what the game does
about it and what to change, and the package exports the same table as
`diagnosticCodes`, typed by `DiagnosticCode`. The same check is available as a
function:

```ts
import { validate } from "@kongyo2/stellaris-ts/validate";
```

What it reports:

- a key no rule accepts, anywhere in the body — `allow = { has_country_flagg = yes }`
  is caught inside `allow`, and inside anything inside that, and inside a
  block written under a name of your own choosing, such as each entry of
  `common/species_names` and each stage of a situation;
- a key the game's own reader of the definition does not take, which it logs
  as an `Unexpected token` and skips: a species class that still lists its
  `portraits`, which since 4.0 belong in a `portrait_set`, or a leader trait
  marked `destiny_trait` where the game now reads `leader_trait_type`;
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
  through links, iterators and scope changes, and into every scripted effect
  and trigger of the mod's own in the scope it is called in: a fleet's effect
  in a scripted effect called from `every_owned_ship` is as wrong as one
  written there;
- a target of the wrong kind, where one step says what it names:
  `set_home_base = capital_scope` hands a fleet a planet for a home base;
- an event of some kind of object that nothing hands one — a `country_event`
  listed under `on_yearly_pulse`, which the game refuses each year with
  `attempting to fire country scope event … on no_scope`, where
  `on_yearly_pulse_country` would have fired it for every country;
- a trigger, an effect or a `who = root` read where there is no scope at all: an
  event that only `on_yearly_pulse`, the other pulses or `on_game_start` fire
  runs with none, and so does every scripted effect it calls;
- a trigger named for its value that does not exist, `order_by =
  trigger:fleet_powr` or the `trigger` of `export_trigger_value_to_variable`;
  an option given to `set_policy` with a policy it is not an option of; a
  weapon preference that is no component tag;
- a `[` or a `$` in a scripted effect, a scripted trigger or a script value.
  The game keeps those three as text and reads both characters as its own:
  every `[` opens `[[PARAMETER] … ]`, doubled or not, so `log = "x
  [Root.GetName] y"` is an `Invalid macro entry` in the log when no second
  `]` follows and script cut out in silence when one does; write `\\[`, as the
  base game does;
- what the fleet actions of a `queue_actions` lack: an `id` in each `effect`,
  each `while` and each `trigger`, which the game keeps them by, and an id
  registered more than once — which a scripted effect called from two places
  does with every id written inside it, since the game builds it anew for
  each call unless it says `optimize_memory`;
- a `merge_fleet` given a target, which the game's own reader of the action
  cannot take without logging `Malformed token`;
- a budget the AI never draws on, because its economic category does not
  itself say `use_for_ai_budget = yes`;
- two subplans of one `set_name` in an economic plan, of which the game keeps
  the last — no name being a name like any other;
- all of this in the mod's raw files as well, wherever one holds definitions of
  a type that is read from where it sits: a `common/defines` file written by
  hand with a misspelled key is checked as `define("NAI", …)` is. One thing is
  not: which events are fired with no scope is worked out from the on_actions
  written with `define`, and an on_action in a raw file only counts as naming
  the events it lists;
- a reference to something neither the base game nor the mod defines,
  counting what the mod's own raw files define — a sprite in its `.gfx`, a
  scripted trigger written by hand — and what the base game defines through
  an `inline_script`: the name list an entry of `common/species_names` draws
  from, the species class a `portrait_set` belongs to, each portrait it lists
  and each set a `portrait_category` shows;
- a file a definition names that neither the base game nor the mod ships: a
  mesh's `file`, a sprite's `textureFile`, each of a portrait's
  `character_textures`, the icon a building is drawn from —
  `gfx/interface/icons/buildings/<icon>.dds`, or the file of its own key when
  it names none — and an animation's `file`, which the game looks for beside
  the file that declares it rather than from the root of the game folder;
- a state of an entity that plays an animation its mesh does not declare: a
  state names one of the mesh's own `animation = { id = … }`, not an
  animation, and one that names anything else stands frozen;
- a block of species names written under a key that is no species class,
  none of which the game reads; a `portrait_set` whose `uplifted_portraits`
  is shorter than its `portraits`, which are paired by position, or that
  writes a condition twice in one `conditional_portraits`;
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
- a building in no `building_sets`, which no zone's slots admit, or with no
  `category`; a district with no `zone_slots`, which the game says will crash
  it; a game concept whose key does not start with `concept_`;
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
  point; and in six directories — economic plans, species classes, portrait
  sets and categories, authorities, ownership limits — it reads the second
  definition into the first, field by field, so a `basic_economy_plan` that
  holds one new `subplan` adds it to the base game's plan and is told nothing;
- a `@variable` declared for every file in `common/scripted_variables` under
  a name the base game uses, of which the game keeps the first it reads, and
  one of the mod's own that nothing reads;
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
28 strings it names and never wrote, 40 definitions that lack a string the
rest of their type has, 19 names it refers to that nothing defines, 4 files
it names and does not ship, two scripted triggers and one scripted effect
called on the wrong kind of object, and three strings whose bare `[` costs
`country_defaulted_effect` its `else` branch. The rest of the 244,454
references and 32,681 files its definitions name resolve. What the game logs
is held to the same measure: its 10,024 events, 3,383 scripted effects and
triggers, 4,312 `else` branches, 334 fleet-action ids, 200 budgets and the
6,346 animations the states of its 8,429 entities play pass the checks above
without one finding beyond those, as they load without one line.

The keys a definition takes are measured against the game as well. Each
definition is read by a function of the executable that switches on the key,
and following that switch for every keyword the executable registers gives
the keys each reader takes: the ones the ported rules declared and no reader
takes are gone, and the ones a reader takes that the base game never happens
to write are accepted. So are the triggers and effects themselves: the game
prints the ones its executable registers each time it starts, and the commands
declared here are those and no others.

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
game's own documentation of its triggers, effects, scope links, modifiers and
localisation commands from `refs/`, and the generators do not format what they
write:

```bash
npm run refs:sync
npm run dump:docs
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

`npm run dump:docs` is where that documentation comes from. The game prints it
on every start, so the command starts the installed game, waits for the five
files, closes it and keeps them under `refs/script-documentation/<version>/`.
It starts the game on an empty user directory of its own rather than the
player's: no mod is loaded, so the modifiers listed are the base game's and no
mod's, and the player's settings, saves and logs are not touched. What the game
logged while loading is kept beside the dump, which is the measure of every
check ported from one of its messages. `npm run refs:sync` clones the ported
corpus and the dumps collected of older builds, which the importers fall back
on. `verify:conformance` fails when the three tables read from a dump are not
of the installed game's version, or when a command the game documents is not
declared here.

## Licence and content

MIT. See `THIRD_PARTY.md` for the ported schema's attribution.

Only identifier *names* are taken from the game: no localisation text, no numeric
balance, no script bodies, no assets. Stellaris is © Paradox Interactive AB, and
this project is unaffiliated with them.
