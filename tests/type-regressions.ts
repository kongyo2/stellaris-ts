const values: string[] = [];

// This must remain an error so disabling noUncheckedIndexedAccess also fails on an unused expectation.
// @ts-expect-error Array indexing is intentionally `string | undefined`.
const first: string = values[0];

void first;

export {};
