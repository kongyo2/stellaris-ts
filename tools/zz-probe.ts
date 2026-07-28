import { schema } from "../src/schema/index.js";
const withScope = schema.definitionTypes.filter((t) => typeof t.entryScope === "string");
console.log(`types with an entry scope: ${String(withScope.length)} of ${String(schema.definitionTypes.length)}`);
const variantsOnly = schema.definitionTypes.filter(
  (t) => typeof t.entryScope !== "string" && t.variants.some((v) => typeof v.entryScope === "string"),
);
console.log(`types whose variants carry one instead: ${String(variantsOnly.length)}`);
const distinct = variantsOnly.filter((t) => {
  const scopes = new Set(t.variants.map((v) => v.entryScope).filter((s) => typeof s === "string"));
  return scopes.size === 1;
});
console.log(`...of which every variant agrees: ${String(distinct.length)}`, distinct.map((t) => t.id).slice(0, 10));
