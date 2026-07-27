import { schema } from "../../src/schema/index.js";
import { checkSchemaIntegrity, type IntegrityReport } from "./integrity.js";

const report: IntegrityReport = checkSchemaIntegrity(schema);

for (const issue of report.issues.slice(0, 60)) {
  console.error(`INTEGRITY ${issue.definition} ${issue.code}: ${issue.detail}`);
}

for (const metric of report.coverage) {
  const status: string = metric.actual < metric.minimum ? "SHORT" : "ok";
  console.log(
    `COVERAGE ${metric.name} actual=${String(metric.actual)} minimum=${String(metric.minimum)} ${status} — ${metric.definition}`,
  );
}

console.log(
  [
    "SUMMARY mode=schema",
    `definitionTypes=${String(schema.definitionTypes.length)}`,
    `enums=${String(schema.enums.length)}`,
    `scopes=${String(schema.scopes.length)}`,
    `links=${String(schema.links.length)}`,
    `issues=${String(report.issues.length)}`,
    `shortfalls=${String(report.shortfalls.length)}`,
  ].join(" "),
);

if (report.issues.length > 0 || report.shortfalls.length > 0) {
  process.exitCode = 1;
}
