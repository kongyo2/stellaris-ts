import { spawnSync } from "node:child_process";

interface VerifyStep {
  readonly label: string;
  readonly script: string;
}

const steps: readonly VerifyStep[] = [
  { label: "1/8", script: "format:check" },
  { label: "2/8", script: "lint:strict" },
  { label: "3/8", script: "lint:types" },
  { label: "4/8", script: "typecheck:ci" },
  { label: "4/8 tools", script: "typecheck:tools:ci" },
  { label: "5/8", script: "typecheck:test:ci" },
  { label: "6/8", script: "test" },
  { label: "7/8", script: "verify:roundtrip" },
  { label: "8/8", script: "verify:pack" },
];

const npmCliPath = process.env["npm_execpath"];

if (npmCliPath === undefined) {
  console.error("Unable to locate npm CLI: run verification through `npm run verify`.");
  process.exit(1);
}

for (const step of steps) {
  console.log(`[verify ${step.label}] npm run ${step.script}`);

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
