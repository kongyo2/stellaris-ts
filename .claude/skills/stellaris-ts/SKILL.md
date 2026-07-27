---
name: stellaris-ts
description: Write Stellaris mods in TypeScript with stellaris-ts. Use when building, editing or checking a Stellaris mod in this repository — defining buildings, technologies, traits, events or any other definition type, writing localisation, or emitting a mod folder the game can load.
license: MIT
metadata:
  author: kongyo2
---

# stellaris-ts

Write the mod in TypeScript; get a mod folder Stellaris loads.

## The shape is the script

A definition body is PDX script with different punctuation. If you know what the
game expects, you already know what to write.

```ts
import { define } from "stellaris-ts/builders";
import { defineMod, emit, writePlan } from "stellaris-ts";

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

Then `stellaris-ts check mod.ts` to validate, `stellaris-ts build mod.ts` to write.

## What the types do and do not catch

The generated definition types follow the schema, and the schema follows the
game. Where the game accepts arbitrary keys, so does the type — a type that
rejected valid script would be worse than a loose one. So:

- **Types** catch a wrong value shape, and complete field names and vanilla ids.
- **`stellaris-ts check`** catches an unknown field, a duplicate id, a missing
  required string, and a reference to something nothing defines.

Both are needed. A clean compile is not a validated mod.

## Rules

Read the one that matches what you are doing.

- `rules/definitions.md` — defining things, and which type to reach for
- `rules/localisation.md` — strings, and why a missing one is invisible until it ships
- `rules/scopes.md` — triggers, effects, and where each is legal
- `rules/files.md` — where output lands, and the one mistake that silently breaks a mod
- `rules/pitfalls.md` — everything the game accepts quietly and then ignores
