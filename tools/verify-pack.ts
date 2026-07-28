import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

interface CommandSpec {
  readonly command: string;
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
}

interface CommandOutput {
  readonly stdout: string;
  readonly stderr: string;
}

interface JsonRecord {
  readonly [key: string]: unknown;
}

interface PackResult {
  readonly filename: string;
  readonly files: readonly string[];
}

const REPOSITORY_ROOT: string = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_ROOT: string = join(REPOSITORY_ROOT, "src");
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024 * 1024;

/** Read from the manifest so renaming or rescoping the package needs no edit here. */
const PACKAGE_NAME: string = readPackageName();

function readPackageName(): string {
  const parsed: unknown = JSON.parse(readFileSync(join(REPOSITORY_ROOT, "package.json"), "utf8"));

  if (typeof parsed !== "object" || parsed === null || !("name" in parsed) || typeof parsed.name !== "string") {
    throw new Error("package.json has no name.");
  }

  return parsed.name;
}

function quoteCommandPart(part: string): string {
  return /^[A-Za-z0-9_./:=\\-]+$/u.test(part) ? part : (JSON.stringify(part) ?? '""');
}

function commandDescription(spec: CommandSpec): string {
  return [spec.command, ...spec.arguments].map(quoteCommandPart).join(" ");
}

function commandFailureMessage(spec: CommandSpec, result: SpawnSyncReturns<string>): string {
  const exitDescription: string =
    result.status === null ? `signal=${result.signal ?? "none"}` : `exit=${String(result.status)}`;
  const errorDescription: string = result.error === undefined ? "" : `\nspawn error: ${result.error.message}`;
  const stdout: string = result.stdout.length === 0 ? "<empty>" : result.stdout;
  const stderr: string = result.stderr.length === 0 ? "<empty>" : result.stderr;

  return [
    "Command failed.",
    `command: ${commandDescription(spec)}`,
    `cwd: ${spec.cwd}`,
    `result: ${exitDescription}${errorDescription}`,
    `stdout:\n${stdout}`,
    `stderr:\n${stderr}`,
  ].join("\n");
}

function runCommand(spec: CommandSpec): CommandOutput {
  const result: SpawnSyncReturns<string> = spawnSync(spec.command, [...spec.arguments], {
    cwd: spec.cwd,
    encoding: "utf8",
    env: spec.environment,
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    windowsHide: true,
  });

  if (result.error !== undefined || result.status !== 0) {
    throw new Error(commandFailureMessage(spec, result));
  }

  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function packResultFromJson(stdout: string): PackResult {
  let value: unknown;

  try {
    value = JSON.parse(stdout) as unknown;
  } catch (error: unknown) {
    throw new Error(
      `npm pack did not return valid JSON: ${error instanceof Error ? error.message : String(error)}\nstdout:\n${stdout}`,
      { cause: error },
    );
  }

  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error(`npm pack JSON must contain exactly one result, received: ${JSON.stringify(value)}.`);
  }

  const result: unknown = value[0];
  if (!isJsonRecord(result) || typeof result["filename"] !== "string") {
    throw new Error(`npm pack JSON is missing a string filename: ${JSON.stringify(result)}.`);
  }

  const filename: string = result["filename"];
  if (filename.length === 0 || basename(filename) !== filename || !filename.endsWith(".tgz")) {
    throw new Error(`npm pack returned an invalid tarball filename: ${JSON.stringify(filename)}.`);
  }

  const fileEntries: unknown = result["files"];
  if (!Array.isArray(fileEntries) || fileEntries.length === 0) {
    throw new Error(`npm pack JSON is missing its nonempty files array: ${JSON.stringify(fileEntries)}.`);
  }

  const files: string[] = fileEntries.map((entry: unknown, index: number): string => {
    if (!isJsonRecord(entry) || typeof entry["path"] !== "string" || entry["path"].length === 0) {
      throw new Error(`npm pack JSON has an invalid files[${String(index)}] entry: ${JSON.stringify(entry)}.`);
    }

    return entry["path"].replaceAll("\\", "/");
  });

  return { filename, files };
}

function resolveNpmCliPath(): string {
  const npmExecPath: string | undefined = process.env["npm_execpath"];

  if (npmExecPath === undefined || npmExecPath.length === 0) {
    throw new Error("Unable to locate npm CLI: run package verification through an npm script.");
  }

  return isAbsolute(npmExecPath) ? npmExecPath : resolve(process.cwd(), npmExecPath);
}

function collectSourcePaths(directory: string): string[] {
  const paths: string[] = [];
  const entries = readdirSync(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));

  for (const entry of entries) {
    const entryPath: string = join(directory, entry.name);

    if (entry.isDirectory()) {
      paths.push(...collectSourcePaths(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      paths.push(relative(SOURCE_ROOT, entryPath).replaceAll("\\", "/"));
    }
  }

  return paths;
}

function expectedPackageFiles(): string[] {
  const files: string[] = ["LICENSE", "README.md", "package.json"];

  for (const sourcePath of collectSourcePaths(SOURCE_ROOT)) {
    const stem: string = sourcePath.slice(0, -".ts".length);
    files.push(`dist/${stem}.d.ts`, `dist/${stem}.d.ts.map`, `dist/${stem}.js`, `dist/${stem}.js.map`);
  }

  return files.sort();
}

function assertPackedFiles(actualFiles: readonly string[]): void {
  const actual: string[] = [...actualFiles].sort();
  const expected: string[] = expectedPackageFiles();
  const uniqueActual: ReadonlySet<string> = new Set(actual);

  if (uniqueActual.size !== actual.length) {
    throw new Error(`npm pack reported duplicate archive paths: ${JSON.stringify(actual)}.`);
  }

  const missing: readonly string[] = expected.filter((path) => !uniqueActual.has(path));
  const expectedSet: ReadonlySet<string> = new Set(expected);
  const unexpected: readonly string[] = actual.filter((path) => !expectedSet.has(path));

  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      [
        "Packed file set does not match source-derived publish artifacts.",
        `missing: ${JSON.stringify(missing)}`,
        `unexpected: ${JSON.stringify(unexpected)}`,
      ].join("\n"),
    );
  }
}

function readJsonRecord(path: string, description: string): JsonRecord {
  let value: unknown;

  try {
    value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error: unknown) {
    throw new Error(
      `Unable to read ${description} as JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  if (!isJsonRecord(value)) {
    throw new Error(`${description} must contain a JSON object.`);
  }

  return value;
}

function assertExportTarget(packageDirectory: string, subpath: string, condition: string, target: unknown): void {
  if (typeof target !== "string" || !target.startsWith("./")) {
    throw new Error(`Export ${subpath}.${condition} must be a relative string target.`);
  }

  const absoluteTarget: string = resolve(packageDirectory, target);
  const relativeTarget: string = relative(packageDirectory, absoluteTarget);

  if (relativeTarget.startsWith("..") || isAbsolute(relativeTarget)) {
    throw new Error(`Export ${subpath}.${condition} escapes the installed package: ${JSON.stringify(target)}.`);
  }

  if (!existsSync(absoluteTarget) || !statSync(absoluteTarget).isFile()) {
    throw new Error(`Export ${subpath}.${condition} target is missing from the installed package: ${target}.`);
  }
}

function assertInstalledManifest(packageDirectory: string): void {
  const manifest: JsonRecord = readJsonRecord(join(packageDirectory, "package.json"), "installed package manifest");

  if (manifest["name"] !== PACKAGE_NAME) {
    throw new Error(`Installed package name is not ${PACKAGE_NAME}: ${JSON.stringify(manifest["name"])}.`);
  }

  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"] as const) {
    const dependencies: unknown = manifest[field];

    if (dependencies !== undefined && (!isJsonRecord(dependencies) || Object.keys(dependencies).length > 0)) {
      throw new Error(`Installed manifest must not declare runtime ${field}: ${JSON.stringify(dependencies)}.`);
    }
  }

  const packageExports: unknown = manifest["exports"];
  if (!isJsonRecord(packageExports)) {
    throw new Error("Installed manifest must contain an exports object.");
  }

  for (const [subpath, target] of Object.entries(packageExports)) {
    if (typeof target === "string") {
      assertExportTarget(packageDirectory, subpath, "default", target);
      continue;
    }

    if (!isJsonRecord(target)) {
      throw new Error(`Export ${subpath} must be a string or condition object.`);
    }

    const conditions: readonly string[] = Object.keys(target);
    if (conditions[0] !== "types") {
      throw new Error(`Export ${subpath} must place the types condition first: ${JSON.stringify(conditions)}.`);
    }

    for (const requiredCondition of ["types", "import", "default"] as const) {
      assertExportTarget(packageDirectory, subpath, requiredCondition, target[requiredCondition]);
    }
  }
}

function writeScratchConsumer(consumerDirectory: string): void {
  const packageJson: string = `${JSON.stringify(
    {
      name: "stellaris-ts-consumer-probe",
      private: true,
      type: "module",
      version: "0.0.0",
    },
    null,
    2,
  )}\n`;
  const runtimeProbe = `import assert from "node:assert/strict";

import "${PACKAGE_NAME}";
import "${PACKAGE_NAME}/builders";
import "${PACKAGE_NAME}/ids";
import "${PACKAGE_NAME}/schema";
import "${PACKAGE_NAME}/scope";
import "${PACKAGE_NAME}/types";
import "${PACKAGE_NAME}/validate";
import metadata from "${PACKAGE_NAME}/package.json" with { type: "json" };
import { NodeKind, parse, print } from "${PACKAGE_NAME}/syntax";

const source = "key = value\\n";
const result = parse(source);
const firstEntry = result.document.entries[0];

assert.equal(metadata.name, "${PACKAGE_NAME}");
assert.equal(result.diagnostics.length, 0);
assert.equal(result.document.kind, NodeKind.Document);
assert.equal(firstEntry?.kind, NodeKind.Assignment);
assert.equal(print(result.document), source);

await assert.rejects(
  import("${PACKAGE_NAME}/dist/syntax/parser.js"),
  (error) => error instanceof Error && "code" in error && error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED",
);
`;
  const typeProbe = `import "${PACKAGE_NAME}";
import "${PACKAGE_NAME}/builders";
import "${PACKAGE_NAME}/ids";
import "${PACKAGE_NAME}/schema";
import "${PACKAGE_NAME}/scope";
import "${PACKAGE_NAME}/types";
import "${PACKAGE_NAME}/validate";
import metadata from "${PACKAGE_NAME}/package.json" with { type: "json" };
import { NodeKind, parse, print, type Document, type ParseResult } from "${PACKAGE_NAME}/syntax";

// @ts-expect-error Package internals must remain outside the public exports map.
import "${PACKAGE_NAME}/dist/syntax/parser.js";

const result: ParseResult = parse("key = value\\n");
const document: Document = result.document;
const output: string = print(document);
const kind: typeof NodeKind.Document = document.kind;
const packageName: string = metadata.name;

void [output, kind, packageName];
`;
  const tsconfig: string = `${JSON.stringify(
    {
      compilerOptions: {
        allowJs: false,
        allowUnreachableCode: false,
        allowUnusedLabels: false,
        erasableSyntaxOnly: true,
        exactOptionalPropertyTypes: true,
        isolatedModules: true,
        lib: ["es2022"],
        module: "nodenext",
        moduleDetection: "force",
        moduleResolution: "nodenext",
        noEmit: true,
        noErrorTruncation: true,
        noFallthroughCasesInSwitch: true,
        noImplicitOverride: true,
        noImplicitReturns: true,
        noPropertyAccessFromIndexSignature: true,
        noUncheckedIndexedAccess: true,
        noUncheckedSideEffectImports: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        resolveJsonModule: true,
        resolvePackageJsonExports: true,
        skipLibCheck: false,
        strict: true,
        target: "es2022",
        types: [],
        useDefineForClassFields: true,
        verbatimModuleSyntax: true,
      },
      files: ["index.ts"],
    },
    null,
    2,
  )}\n`;

  mkdirSync(consumerDirectory, { recursive: true });
  writeFileSync(join(consumerDirectory, "package.json"), packageJson, "utf8");
  writeFileSync(join(consumerDirectory, "index.mjs"), runtimeProbe, "utf8");
  writeFileSync(join(consumerDirectory, "index.ts"), typeProbe, "utf8");
  writeFileSync(join(consumerDirectory, "tsconfig.json"), tsconfig, "utf8");
}

function verifyPackage(): string {
  const nodeMajorText: string | undefined = process.versions.node.split(".")[0];
  const nodeMajor: number = Number(nodeMajorText);

  if (!Number.isInteger(nodeMajor) || nodeMajor < 22) {
    throw new Error(`Package verification requires Node 22 or later, received ${process.versions.node}.`);
  }

  const npmCliPath: string = resolveNpmCliPath();

  runCommand({
    command: process.execPath,
    arguments: [npmCliPath, "run", "build"],
    cwd: REPOSITORY_ROOT,
    environment: process.env,
  });

  let temporaryDirectory: string | undefined;

  try {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "stellaris-ts-pack-"));
    const npmCacheDirectory: string = join(temporaryDirectory, "npm-cache");
    const consumerDirectory: string = join(temporaryDirectory, "consumer");

    mkdirSync(npmCacheDirectory, { recursive: true });
    const packOutput: CommandOutput = runCommand({
      command: process.execPath,
      arguments: [
        npmCliPath,
        "pack",
        "--json",
        "--ignore-scripts",
        "--cache",
        npmCacheDirectory,
        "--pack-destination",
        temporaryDirectory,
      ],
      cwd: REPOSITORY_ROOT,
      environment: process.env,
    });
    const packResult: PackResult = packResultFromJson(packOutput.stdout);
    const tarballPath: string = join(temporaryDirectory, packResult.filename);

    if (!existsSync(tarballPath) || !statSync(tarballPath).isFile()) {
      throw new Error(`npm pack reported ${JSON.stringify(packResult.filename)}, but that tarball does not exist.`);
    }

    assertPackedFiles(packResult.files);
    writeScratchConsumer(consumerDirectory);
    runCommand({
      command: process.execPath,
      arguments: [
        npmCliPath,
        "install",
        tarballPath,
        "--offline",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--no-save",
        "--package-lock=false",
        "--cache",
        npmCacheDirectory,
      ],
      cwd: consumerDirectory,
      environment: process.env,
    });
    assertInstalledManifest(join(consumerDirectory, "node_modules", ...PACKAGE_NAME.split("/")));
    runCommand({
      command: process.execPath,
      arguments: [join(consumerDirectory, "index.mjs")],
      cwd: consumerDirectory,
      environment: process.env,
    });

    const typescriptCliPath: string = join(REPOSITORY_ROOT, "node_modules", "typescript", "bin", "tsc");
    runCommand({
      command: process.execPath,
      arguments: [
        typescriptCliPath,
        "-p",
        "tsconfig.json",
        "--moduleResolution",
        "nodenext",
        "--noEmit",
        "--pretty",
        "false",
      ],
      cwd: consumerDirectory,
      environment: process.env,
    });

    return packResult.filename;
  } finally {
    if (temporaryDirectory !== undefined) {
      rmSync(temporaryDirectory, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    }
  }
}

try {
  const tarballFilename: string = verifyPackage();
  console.log(`SUMMARY package=${tarballFilename} node=ok tsc=ok`);
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
