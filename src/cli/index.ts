import { homedir, platform } from "node:os";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";

import { emit, type EmitDiagnostic, type EmitPlan } from "../runtime/emit.js";
import { Mod } from "../runtime/mod.js";
import { writePlan } from "../runtime/write.js";
import { validate, type ValidationDiagnostic } from "../validate/index.js";

/**
 * The command line.
 *
 * Diagnostics are one per line, no colour, `path: severity: code: message`.
 * The reader is as likely to be an agent as a person, and a wrapped, coloured,
 * multi-line report is not something either can grep.
 */

interface Diagnostic {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly message: string;
  readonly where: string;
}

function fromEmit(diagnostic: EmitDiagnostic): Diagnostic {
  return { severity: diagnostic.severity, code: diagnostic.code, message: diagnostic.message, where: diagnostic.path };
}

function fromValidation(diagnostic: ValidationDiagnostic): Diagnostic {
  return {
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    // The path is most of the value of the report: a mod has hundreds of keys
    // under one definition, and "somewhere in this building" is not a location.
    where: diagnostic.path.length === 0 ? diagnostic.definition : `${diagnostic.definition}.${diagnostic.path}`,
  };
}

function report(diagnostics: readonly Diagnostic[]): number {
  for (const diagnostic of diagnostics) {
    const line = `${diagnostic.where}: ${diagnostic.severity}: ${diagnostic.code}: ${diagnostic.message}`;
    if (diagnostic.severity === "error") {
      console.error(line);
    } else {
      console.warn(line);
    }
  }

  return diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
}

async function loadMod(entry: string): Promise<Mod> {
  const loaded: unknown = await import(pathToFileURL(resolve(entry)).href);

  if (typeof loaded !== "object" || loaded === null || !("default" in loaded)) {
    throw new Error(`${entry} has no default export. Export the mod you built with defineMod.`);
  }

  const value: unknown = loaded.default;

  if (!(value instanceof Mod)) {
    throw new Error(`${entry} default-exports something that is not a Mod.`);
  }

  return value;
}

/**
 * Where the launcher keeps local mods.
 *
 * Read at call time rather than fixed: it sits under the user's home
 * directory, so one machine's copy of it is no use to anyone else.
 */
function defaultModsDirectory(): string {
  const home: string = homedir();
  return platform() === "linux"
    ? join(home, ".local", "share", "Paradox Interactive", "Stellaris", "mod")
    : join(home, "Documents", "Paradox Interactive", "Stellaris", "mod");
}

function usage(): string {
  return [
    "Usage: stellaris-ts <command> <entry>",
    "",
    "  check <entry>          Validate without writing anything.",
    "  build <entry> [--out]  Validate, then write into the mod folder.",
    "",
    "The entry is a module whose default export is a Mod.",
    "--out defaults to the Stellaris mod folder; STELLARIS_MODS_DIR overrides it.",
  ].join("\n");
}

export async function run(argv: readonly string[]): Promise<number> {
  const [command, entry, ...rest] = argv;

  if (command === undefined || entry === undefined || command === "--help" || command === "-h") {
    console.log(usage());
    return command === undefined ? 2 : 0;
  }

  if (command !== "check" && command !== "build") {
    console.error(`Unknown command: ${command}`);
    console.error(usage());
    return 2;
  }

  const mod: Mod = await loadMod(entry);
  const plan: EmitPlan = emit(mod);
  const diagnostics: readonly Diagnostic[] = [...validate(mod).map(fromValidation), ...plan.diagnostics.map(fromEmit)];
  const errors: number = report(diagnostics);

  console.log(
    [
      `SUMMARY mode=${command}`,
      `definitions=${String(mod.definitions.length)}`,
      `files=${String(plan.files.length)}`,
      `errors=${String(errors)}`,
      `warnings=${String(diagnostics.length - errors)}`,
    ].join(" "),
  );

  if (errors > 0) {
    return 1;
  }

  if (command === "check") {
    return 0;
  }

  const outIndex: number = rest.indexOf("--out");
  const explicit: string | undefined = outIndex < 0 ? undefined : rest[outIndex + 1];
  const modsDirectory: string = explicit ?? process.env["STELLARIS_MODS_DIR"] ?? defaultModsDirectory();
  const result = await writePlan(mod, plan, modsDirectory);

  console.log(`WROTE files=${String(result.written.length)} directory=${result.modDirectory}`);
  console.log(`WROTE launcher=${result.modFilePath}`);

  return 0;
}
