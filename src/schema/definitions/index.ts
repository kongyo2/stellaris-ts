import { building } from "./building.js";
import { event } from "./event.js";
import { technology } from "./technology.js";
import { trait } from "./trait.js";
import type { DefinitionType } from "../ir.js";

export { building } from "./building.js";
export { event } from "./event.js";
export { technology } from "./technology.js";
export { trait } from "./trait.js";

export const mvpDefinitionTypes: readonly DefinitionType[] = [building, technology, trait, event];
