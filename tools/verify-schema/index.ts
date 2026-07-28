import { schema } from "../../src/schema/index.js";
import { validateSchema, type SchemaStructuralMinimums, type SchemaValidationDiagnostic } from "./validate.js";

/**
 * Self-consistency of the schema IR.
 *
 * Every minimum below is measured, and carries the definition that produced it.
 * Five are independently derivable from the cwt corpus structure; the rest are
 * the importer's own output acting as regression guards. None is an estimate: a
 * guessed minimum frozen into a gate has already passed a broken build here.
 */
const MINIMUMS: SchemaStructuralMinimums = {
  // `type[x] = {` declarations
  definitionTypes: 234,
  // `subtype[x] = {` declarations, excluding the 112 localisation/selector references
  variants: 257,
  // static (179) plus complex (27) enum declarations
  enums: 206,
  staticEnums: 179,
  extractedEnums: 27,
  // blocks directly inside `scopes = { }`
  scopes: 41,
  // blocks directly inside `links = { }`; last_created_pop_faction is declared twice
  links: 86,
  // `alias[trigger:*]` and `alias[effect:*]` declarations
  triggerCommands: 1124,
  effectCommands: 1204,
  // every non-script alias family
  ruleSets: 187,
  // the global inline_script macro
  macros: 1,
};

/**
 * Debt inherited from the cwt corpus.
 *
 * These are holes in cwtools-stellaris-config itself — an enum, type or variant
 * a rule points at that the corpus never declares. They are recorded rather
 * than hidden: the gate fails if the count rises, and each one is a candidate
 * to fix by hand in `src/schema/` once vanilla says what is right.
 */
const KNOWN_DEBT = 20;

const diagnostics: readonly SchemaValidationDiagnostic[] = validateSchema(schema, { minimums: MINIMUMS });
const overBudget: boolean = diagnostics.length > KNOWN_DEBT;

for (const diagnostic of diagnostics) {
  console.error(`SCHEMA ${diagnostic.path} ${diagnostic.code}: ${diagnostic.message}`);
}

if (overBudget) {
  console.error(
    `SCHEMA debt rose from ${String(KNOWN_DEBT)} to ${String(diagnostics.length)}; fix the regression or record why the budget moved.`,
  );
}

console.log(
  [
    "SUMMARY mode=schema",
    `definitionTypes=${String(schema.definitionTypes.length)}`,
    `enums=${String(schema.enums.length)}`,
    `scopes=${String(schema.scopes.length)}`,
    `links=${String(schema.links.length)}`,
    `commands=${String(schema.commands.length)}`,
    `ruleSets=${String(schema.ruleSets.length)}`,
    `inheritedDebt=${String(diagnostics.length)}`,
    `debtBudget=${String(KNOWN_DEBT)}`,
  ].join(" "),
);

if (overBudget) {
  process.exitCode = 1;
}
