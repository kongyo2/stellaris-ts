import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, resolve } from "node:path";

import { vanillaGameVersion } from "../generated/vanilla/game-version.js";
import { emit, type EmitDiagnostic, type EmitPlan } from "../runtime/emit.js";
import { LOCALISATION_LANGUAGES } from "../runtime/localisation.js";
import { isMod, type Mod } from "../runtime/mod.js";
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

/**
 * Node resolves the specifier that was written, and nothing rewrites it.
 *
 * The entry is imported as it stands, so a mod split across files runs under
 * Node's own type stripping. `import "./kit.js"` finds no `kit.js` there and
 * fails with a module-not-found that names a file the author never wrote; the
 * spelling that works is `./kit.ts`, with `allowImportingTsExtensions` on.
 */
function explainMissingModule(error: unknown, entry: string): Error {
  const message: string = error instanceof Error ? error.message : String(error);
  const specifier: string | undefined = /Cannot find module '([^']+\.js)'/u.exec(message)?.[1];

  // A Node that cannot strip types refuses the entry by its extension, and says
  // only that `.ts` is unknown — which reads as a fault in the file. Node 22.18
  // was the first 22 release to strip types without being asked.
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ERR_UNKNOWN_FILE_EXTENSION" &&
    /\.[cm]?ts$/u.test(entry)
  ) {
    return new Error(
      `${message}\n\nNode ${process.versions.node} does not run TypeScript by itself. Node 22.18 and later do; upgrade it, or from 22.6 set NODE_OPTIONS=--experimental-strip-types.`,
    );
  }

  if (specifier === undefined || !existsSync(specifier.replace(/\.js$/u, ".ts"))) {
    return error instanceof Error ? error : new Error(message);
  }

  return new Error(
    `${message}\n\n${entry} imports ${specifier}, and only the .ts file exists. Node reads the entry directly, so it resolves the specifier as written — import it as .ts and set "allowImportingTsExtensions": true in tsconfig.json.`,
  );
}

async function loadMod(entry: string): Promise<Mod> {
  const loaded: unknown = await import(pathToFileURL(resolve(entry)).href).catch((error: unknown) => {
    throw explainMissingModule(error, entry);
  });

  if (typeof loaded !== "object" || loaded === null || !("default" in loaded)) {
    throw new Error(`${entry} has no default export. Export the mod you built with defineMod.`);
  }

  const value: unknown = loaded.default;

  // Not `instanceof`: the mod may have been built by another copy of this
  // package than the one running, and is no less a mod for it.
  if (!isMod(value)) {
    throw new Error(`${entry} default-exports something that is not a Mod.`);
  }

  return value;
}

/** This package's own version, read from the manifest it was installed with. */
function packageVersion(): string {
  try {
    const manifest: unknown = JSON.parse(
      readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
    );

    if (typeof manifest === "object" && manifest !== null && "version" in manifest) {
      return String(manifest.version);
    }
  } catch {
    // Reported below as unknown rather than failing a request for a version.
  }

  return "unknown";
}

function directoryNames(directory: string): readonly string[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Where the launcher keeps local mods.
 *
 * Read at call time rather than fixed: it sits under the user's home
 * directory, so one machine's copy of it is no use to anyone else.
 *
 * On Windows the documents folder is often not `Documents`: OneDrive moves it
 * under itself, and names it in the system's language — `OneDrive\ドキュメント`
 * on a Japanese install — so the game's own folder is looked for there before
 * settling on the default. The game creates it on first launch.
 */
export function defaultModsDirectory(home: string = homedir(), system: NodeJS.Platform = platform()): string {
  if (system === "linux") {
    return join(home, ".local", "share", "Paradox Interactive", "Stellaris", "mod");
  }

  const documents: string = join(home, "Documents", "Paradox Interactive", "Stellaris");

  if (system === "win32" && !existsSync(documents)) {
    for (const cloud of directoryNames(home).filter((name) => name.startsWith("OneDrive"))) {
      for (const folder of directoryNames(join(home, cloud))) {
        const candidate: string = join(home, cloud, folder, "Paradox Interactive", "Stellaris");

        if (existsSync(candidate)) {
          return join(candidate, "mod");
        }
      }
    }
  }

  return join(documents, "mod");
}

function usage(): string {
  return [
    "Usage: stellaris-ts <command> <entry>",
    "",
    "  check <entry> [--language]          Validate without writing anything.",
    "  build <entry> [--out] [--language]  Validate, then write into the mod folder.",
    "  --version                           Print the version and the game it checks against.",
    "",
    "The entry is a module whose default export is a Mod.",
    "--out defaults to the Stellaris mod folder; STELLARIS_MODS_DIR overrides it.",
    "--language may be repeated, and takes `japanese` or `l_japanese`. Defaults to English.",
  ].join("\n");
}

interface Options {
  readonly languages: readonly string[];
  readonly out: string | undefined;
  /** What was written without a `--`: the entry, and anything after it. */
  readonly positionals: readonly string[];
  readonly help: boolean;
}

/**
 * The options, read once.
 *
 * Once, because reading them twice is what lets one option swallow another:
 * `--out --language japanese` gave the language to the check and `--language`
 * to the mod folder, and reported having written the mod successfully into a
 * directory of that name. An option's value is never another option, and a
 * missing one is said so rather than guessed at.
 *
 * A language is taken with or without its `l_` prefix, because the folder is
 * `japanese` and the file says `l_japanese`, and having to know which one this
 * asks for is a needless thing to get wrong.
 *
 * The entry may stand before the options or after them: `check --language
 * japanese ./mod.ts` used to import a module called `--language`.
 */
function parseOptions(rest: readonly string[]): { readonly options: Options } | { readonly error: string } {
  const languages: string[] = [];
  const positionals: string[] = [];
  let out: string | undefined;
  let help = false;
  let index = 0;

  while (index < rest.length) {
    const argument: string = rest[index] ?? "";
    const inline: RegExpExecArray | null = /^(--[A-Za-z][A-Za-z-]*)=(.*)$/u.exec(argument);
    const name: string = inline?.[1] ?? argument;
    const attached: string | undefined = inline?.[2];
    let value: string | undefined = attached;

    index += 1;

    if (name === "--help" || name === "-h") {
      help = true;
      continue;
    }

    if (!name.startsWith("--")) {
      positionals.push(argument);
      continue;
    }

    if (value === undefined) {
      const next: string | undefined = rest[index];
      if (next !== undefined && !next.startsWith("--")) {
        value = next;
        index += 1;
      }
    }

    if (name === "--language" || name === "--languages") {
      const parts: readonly string[] = (value ?? "").split(",").map((part) => part.trim());
      const named: readonly string[] = parts.filter((part) => part.length > 0);

      if (named.length === 0) {
        return { error: `${name} needs a language after it, such as \`--language japanese\`.` };
      }

      languages.push(...named);
      continue;
    }

    if (name === "--out") {
      if (value === undefined || value.length === 0) {
        return { error: "--out needs a directory after it." };
      }
      out = value;
      continue;
    }

    return { error: `Unknown option: ${name}.` };
  }

  const normalised: readonly string[] = languages.map((name) => (name.startsWith("l_") ? name : `l_${name}`));
  const unknown: readonly string[] = normalised.filter((name) => !LOCALISATION_LANGUAGES.includes(name));

  if (unknown.length > 0) {
    return {
      error: `Not a language the game reads: ${unknown.join(", ")}. It reads ${LOCALISATION_LANGUAGES.join(", ")}.`,
    };
  }

  return { options: { languages: normalised, out, positionals, help } };
}

export async function run(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command === "--help" || command === "-h") {
    console.log(usage());
    return 0;
  }

  // The version of the checker is half of it; the other half is which build of
  // the game its identifiers were read from.
  if (command === "--version" || command === "-v") {
    console.log(`stellaris-ts ${packageVersion()} (Stellaris ${vanillaGameVersion})`);
    return 0;
  }

  if (command === undefined) {
    console.error(usage());
    return 2;
  }

  if (command !== "check" && command !== "build") {
    console.error(`Unknown command: ${command}`);
    console.error(usage());
    return 2;
  }

  const parsed = parseOptions(rest);

  if ("error" in parsed) {
    console.error(parsed.error);
    console.error(usage());
    return 2;
  }

  const options: Options = parsed.options;

  if (options.help) {
    console.log(usage());
    return 0;
  }

  // Without an entry there is nothing to check, and saying so with a zero exit
  // let a script that lost its argument report a clean mod.
  const [entry, ...extra] = options.positionals;

  if (entry === undefined) {
    console.error(`${command} needs the module whose default export is the mod, such as \`${command} ./mod.ts\`.`);
    console.error(usage());
    return 2;
  }

  if (extra.length > 0) {
    console.error(
      `${command} takes one entry, and was given ${String(options.positionals.length)}: ${options.positionals.join(", ")}.`,
    );
    console.error(usage());
    return 2;
  }

  const mod: Mod = await loadMod(entry);
  const plan: EmitPlan = emit(mod);
  const diagnostics: readonly Diagnostic[] = [
    ...validate(mod, options.languages.length === 0 ? {} : { languages: options.languages }).map(fromValidation),
    ...plan.diagnostics.map(fromEmit),
  ];
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

  const modsDirectory: string = options.out ?? process.env["STELLARIS_MODS_DIR"] ?? defaultModsDirectory();
  const result = await writePlan(mod, plan, modsDirectory);

  console.log(`WROTE files=${String(result.written.length)} directory=${result.modDirectory}`);
  console.log(`WROTE launcher=${result.modFilePath}`);

  // Named one by one: a deleted file is the one outcome of a build worth
  // reading line by line.
  for (const path of result.removed) {
    console.log(`REMOVED ${path}`);
  }

  return 0;
}
