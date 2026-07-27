import { describe, expect, it } from "vitest";

import { parse } from "../src/syntax/parser.js";
import {
  CwtPrepareDiagnosticCategory,
  CwtPrepareDiagnosticCode,
  CwtRewriteKind,
  prepareCwtSource,
} from "../tools/import-cwt/prepare.js";

function lineBreaks(source: string): string[] {
  return [...source.matchAll(/\r\n|\r|\n|\u2028|\u2029/gu)].map(
    (match): string => `${String(match.index)}:${match[0]}`,
  );
}

describe("prepareCwtSource", () => {
  it("masks balanced constructors and strict angle references without changing UTF-16 positions", () => {
    const source = [
      "### 😀 documentation",
      "alias[modifier_rule:enum[complex_maths_enum]] = value_field",
      "which = scope[any].enum[exe_set_variable]",
      "alias[trigger:any_system_removed_from_storm ] = {",
      "\ttarget = <building.corporate>",
      "}",
      "",
    ].join("\r\n");
    const result = prepareCwtSource("inline.cwt", source);

    expect(result.path).toBe("inline.cwt");
    expect(result.original).toBe(source);
    expect(result.parseSource).toHaveLength(source.length);
    expect(lineBreaks(result.parseSource)).toEqual(lineBreaks(source));
    expect(result.diagnostics).toEqual([]);
    expect(result.rewrites.map((rewrite) => [rewrite.kind, rewrite.originalText])).toEqual([
      [CwtRewriteKind.BracketAtom, "alias[modifier_rule:enum[complex_maths_enum]]"],
      [CwtRewriteKind.BracketAtom, "scope[any]"],
      [CwtRewriteKind.BracketAtom, ".enum[exe_set_variable]"],
      [CwtRewriteKind.BracketAtom, "alias[trigger:any_system_removed_from_storm ]"],
      [CwtRewriteKind.AngleReference, "<building.corporate>"],
    ]);
    expect(result.rewrites[0]?.span.start).toEqual({
      offset: source.indexOf("alias["),
      line: 2,
      column: 1,
    });
    expect(result.rewrites[4]?.span.start.offset).toBe(source.indexOf("<building.corporate>"));
    expect(parse(result.parseSource).diagnostics).toEqual([]);
  });

  it("leaves strings, comments, optional blocks, and both inline-math forms unchanged", () => {
    const source = [
      "# type[comment] = <comment_ref>",
      'text = "type[string] <string_ref>"',
      "[[!PARAM] direct = @[ base + 1 ] escaped = @\\[( 72 * $PROGRESS$ )] ]",
    ].join("\n");
    const result = prepareCwtSource("native-forms.cwt", source);

    expect(result.parseSource).toBe(source);
    expect(result.rewrites).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(parse(result.parseSource).diagnostics).toEqual([]);
  });

  it("recognizes the specified single-alias constructor even though Stellaris does not use it", () => {
    const source = ["single_alias[effect] = scalar", "use = single_alias_right[effect]"].join("\n");
    const result = prepareCwtSource("single-alias.cwt", source);

    expect(result.rewrites.map((rewrite) => [rewrite.kind, rewrite.originalText])).toEqual([
      [CwtRewriteKind.BracketAtom, "single_alias[effect]"],
      [CwtRewriteKind.BracketAtom, "single_alias_right[effect]"],
    ]);
    expect(result.diagnostics).toEqual([]);
    expect(parse(result.parseSource).diagnostics).toEqual([]);
  });

  it("reports constructors outside the audited allowlist and invalid angle references", () => {
    const source = ["mystery[value] = bool", "target = <bad reference>"].join("\n");
    const result = prepareCwtSource("unknown.cwt", source);

    expect(result.parseSource).toBe(source);
    expect(result.rewrites).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => [diagnostic.category, diagnostic.code])).toEqual([
      [CwtPrepareDiagnosticCategory.UnknownSyntax, CwtPrepareDiagnosticCode.UnknownConstructor],
      [CwtPrepareDiagnosticCategory.UnknownSyntax, CwtPrepareDiagnosticCode.InvalidAngleReference],
    ]);
  });

  it("recovers only the known missing-close alias shape", () => {
    const known = prepareCwtSource("known.cwt", ["alias[trigger:is_market_leader =bool", "next = bool"].join("\r\n"));
    const unknown = prepareCwtSource("unknown.cwt", "alias[trigger:is_not_market_leader =bool");

    expect(known.rewrites.map((rewrite) => [rewrite.kind, rewrite.originalText])).toEqual([
      [CwtRewriteKind.RecoveredBracketAtom, "alias[trigger:is_market_leader"],
    ]);
    expect(known.diagnostics.map((diagnostic) => [diagnostic.category, diagnostic.code])).toEqual([
      [CwtPrepareDiagnosticCategory.Recovery, CwtPrepareDiagnosticCode.RecoveredMissingCloseBracket],
    ]);
    expect(parse(known.parseSource).diagnostics).toEqual([]);

    expect(unknown.rewrites).toEqual([]);
    expect(unknown.diagnostics.map((diagnostic) => [diagnostic.category, diagnostic.code])).toEqual([
      [CwtPrepareDiagnosticCategory.UnknownSyntax, CwtPrepareDiagnosticCode.UnterminatedConstructor],
    ]);
  });

  it("reports unmatched L0-native brackets instead of rewriting them", () => {
    const source = "[[PARAM] value = bool";
    const result = prepareCwtSource("unterminated.cwt", source);

    expect(result.parseSource).toBe(source);
    expect(result.rewrites).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => [diagnostic.category, diagnostic.code])).toEqual([
      [CwtPrepareDiagnosticCategory.UnknownSyntax, CwtPrepareDiagnosticCode.UnterminatedNativeBracket],
    ]);
  });
});
