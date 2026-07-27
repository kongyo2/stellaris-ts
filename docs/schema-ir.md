# Schema IR

The schema IR is the committed, publishable source of truth for Stellaris script
shape. CWTools configuration is migration input only: the importer may propose
TypeScript changes, but published code, builds, normal verification, and runtime
behavior do not read `.cwt` files.

The IR deliberately describes game concepts instead of preserving CWTools
syntax. Its public vocabulary lives in `src/schema/ir.ts`; literal enum and scope
identifiers live in `src/schema/catalog.ts`.

## Model

`SchemaModel` contains:

- definition types, such as building, technology, trait, and event;
- fixed and game-extracted enums;
- scopes and directed scope links;
- trigger, effect, modifier, and modifier-rule commands;
- named values and value sets;
- global syntax policy.

`DefinitionType` records how definitions are found, the variants within that
type, localisation and generated-modifier requirements, the initial scope, and
an ordered array of entry rules. The MVP examples are hand-authored in
`src/schema/definitions/`.

### Source routing

Source routing is data, not an importer convention:

- `keyedBlocks(directory)` finds definitions whose root key is their name.
- `taggedBlocks(directory, nameField, tags)` finds tagged root blocks whose name
  is stored in a field, as event ids are.
- `includeSubdirectories` is explicit. Technology uses
  `common/technology` without subdirectories because adjacent category and tier
  directories are not technology definitions.

Paths are package-relative game paths. They never contain a local installation
path.

### Ordered rules and cardinality

PDX blocks are ordered and duplicate keys are legal, so `entries` is always an
array. It must not be converted to a `Record`. Alternative spellings of one
logical field use `oneOf`; independently repeatable occurrences use
`repeatable` or `oneOrMore`.

Cardinality is an `Occurrence` with numeric `min` and `max`; `null` means no
upper bound. The helpers `required`, `optional`, `repeatable`, `oneOrMore`, and
`forbidden` name common ranges. Nested blocks use the same ordered entry
vocabulary.

### Values and keys

Primitive game values use `primitive`, exact values use `literal`, and lists and
blocks use `list` and `block`. References are explicit:

- `enumRef(EnumId.X)` references a declared enum;
- `typeRef("building")` references another definition namespace;
- `scopeRef(ScopeId.Planet)` references a scope value;
- `valueSet("event_target")` references a named open value set.

Dynamic keys use `enumKey`, `typeKey`, `valueSetKey`, or `patternKey`. `anyKey`
is reserved for genuinely open game syntax, not as a way to hide importer
failures.

`opaque(reason)` is an explicit migration-debt marker. Schema verification must
report it. It is not equivalent to “valid” and must not be used to make vanilla
conformance pass.

### Script families

`triggerBlock`, `effectBlock`, `modifierBlock`, and `modifierRuleBlock` describe
a whole block interpreted by one script family. Mixed blocks, such as an event
option with metadata followed by arbitrary effects, use `triggerEntries`,
`effectEntries`, `modifierEntries`, or `modifierRuleEntries` alongside fixed
entry rules.

`inline_script` is a global macro invocation rather than an unknown field copied
into every definition. `defaultSchemaPolicy` makes that policy explicit for all
blocks. A verifier expands or recognizes the macro before applying local entry
rules.

### Variants

A subtype is a variant inside one base `DefinitionType`; it is not an independent
definition type. Variant predicates inspect root tags, field values, and field
presence, and can be combined with `allOf`, `anyOf`, and `not`. Conditional rules
use `whenVariant` and `unlessVariant`.

This distinction is also the counting contract:

- a type declaration is a block-valued `type[x]` directly under `types`;
- a subtype declaration is a block-valued `subtype[x]` directly under that type;
- localisation references and schema selectors do not create types or subtype
  declarations.

The structural import baseline is 234 base types and 257 subtype declarations
owned by 45 of those types. References add 112 subtype uses, but do not change
the IR type count.

### Enums

`StaticEnumDefinition` stores committed values. `ExtractedEnumDefinition` stores
game-data extraction routes using field, wildcard-field, and key/scalar capture
steps. This is the IR name for the behavior that CWTools calls
`complex_enum`; the CWTools term is not retained.

Enum counting also distinguishes declaration kinds: the current structural
baseline is 179 unique fixed enum names plus 27 unique extracted enum names, for
206 declared names. References do not create declarations. The duplicate
declaration sites remain visible to the import audit.

`EnumId` is a literal union. An unknown enum passed to `enumRef` is therefore a
compile-time error. `ScopeId` provides the same protection for `scopeRef`, scope
frames, links, and command inputs.

### Scopes and commands

Scope changes use either `enterScope` or `replaceScope`; a replacement frame can
name current, root, from, and from-from scopes. `ScopeLinkDefinition` records
typed input scopes and either fixed or dynamic output scopes.

`ScriptCommandDefinition` records its script family, valid input scopes, value
shape, optional scope effect, documentation, and diagnostic severity. Ordered
command arrays preserve same-name alternatives rather than merging them.

### Localisation and modifiers

Localisation requirements derive keys either from the definition id plus a
suffix or from a field value. Requirements can be variant-specific, required,
and primary. Generated modifiers retain category and prefix/suffix templates;
the placeholder is the definition id.

## Translation from migration input

| Migration concept | IR concept |
| --- | --- |
| `type[x]` | `DefinitionType` |
| `subtype[x]` | nested `VariantDefinition` plus conditional rules |
| `type_key_filter` | `rootKeyIs` variant predicate |
| `<building>` | `typeRef("building")` |
| `enum[x]` | `enumRef(EnumId.X)` |
| `scope[x]` | `scopeRef(ScopeId.X)` |
| trigger/effect aliases | script blocks or script-entry families |
| cardinality annotation | `Occurrence` |
| push/replace-scope annotations | `enterScope` / `replaceScope` |
| documentation and severity annotations | `documentation` / `severity` |
| `complex_enum` | `ExtractedEnumDefinition` and extraction routes |

Wrapper names, bracket syntax, source comments used only to explain CWTools
internals, and importer recovery artifacts are intentionally discarded.
Human-facing documentation is retained. Unknown migration syntax is a reader
diagnostic and blocks import instead of being copied into the IR.

## Known data-first corrections

The four hand-authored definitions are deliberately not byte-for-byte
translations. Event routing includes `carrier_event` and `colony_event`, both
present as root definitions in vanilla 4.4.6 but absent from the upstream event
type declaration. Later edits follow the same rule: vanilla structural evidence
wins over stale migration metadata, and the conformance report records the
reason for each correction.
