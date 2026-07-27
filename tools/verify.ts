import { spawnSync } from "node:child_process";

interface VerifyStep {
  readonly script: string;
}

const steps: readonly VerifyStep[] = [
  { script: "format:check" },
  { script: "lint:strict" },
  { script: "lint:types" },
  { script: "typecheck:ci" },
  { script: "typecheck:tools:ci" },
  { script: "typecheck:test:ci" },
  { script: "test" },
  { script: "verify:schema" },
  { script: "verify:norefs" },
  { script: "verify:roundtrip" },
  { script: "verify:pack" },
  { script: "verify:publish" },
];

const npmCliPath = process.env["npm_execpath"];

if (npmCliPath === undefined) {
  console.error("Unable to locate npm CLI: run verification through `npm run verify`.");
  process.exit(1);
}

for (const [index, step] of steps.entries()) {
  console.log(`[verify ${String(index + 1)}/${String(steps.length)}] npm run ${step.script}`);

  const result = spawnSync(process.execPath, [npmCliPath, "run", step.script], {
    stdio: "inherit",
  });

  if (result.error !== undefined) {
    console.error(`Unable to run npm script "${step.script}": ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
