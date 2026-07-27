import { EnumId, ScopeId, enumRef, scopeRef } from "../src/schema/index.js";

const values: string[] = [];

// This must remain an error so disabling noUncheckedIndexedAccess also fails on an unused expectation.
// @ts-expect-error Array indexing is intentionally `string | undefined`.
const first: string = values[0];

void first;

enumRef(EnumId.BuildingCategories);
scopeRef(ScopeId.Planet);

// @ts-expect-error Unknown enum ids must not enter committed schema IR.
enumRef("missing_enum");

// @ts-expect-error Unknown scope ids must not enter committed schema IR.
scopeRef("missing_scope");

export {};
