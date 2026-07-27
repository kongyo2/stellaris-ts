import { NodeKind } from "./ast.js";
import type {
  Assignment,
  Block,
  Document,
  EntryNode,
  ErrorNode,
  InlineMath,
  OptionalBlock,
  PrefixedBlock,
  Scalar,
  Trivia,
  ValueNode,
} from "./ast.js";
import { TokenKind } from "./token.js";
import type { Token } from "./token.js";

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?|\u2028|\u2029/gu, "\n");
}

function indentation(depth: number): string {
  return "\t".repeat(depth);
}

function renderTokens(tokens: readonly Token[]): string {
  return normalizeLineEndings(tokens.map((token): string => token.text).join(""));
}

function renderScalar(scalar: Scalar): string {
  return normalizeLineEndings(scalar.raw);
}

function renderCommentTokens(tokens: readonly Token[], depth: number): string {
  const lines: string[] = [];

  for (const token of tokens) {
    if (token.kind !== TokenKind.Comment) {
      continue;
    }

    for (const rawLine of normalizeLineEndings(token.text).split("\n")) {
      const trimmedLine: string = rawLine.trimStart();
      const comment: string = trimmedLine.startsWith("#")
        ? trimmedLine
        : trimmedLine.length === 0
          ? "#"
          : `# ${trimmedLine}`;
      lines.push(`${indentation(depth)}${comment}`);
    }
  }

  return lines.join("\n");
}

function joinNonempty(parts: readonly string[]): string {
  return parts.filter((part): boolean => part.length > 0).join("\n");
}

function renderEntries(entries: readonly EntryNode[], depth: number): string {
  return joinNonempty(entries.map((entry): string => renderEntry(entry, depth)));
}

function renderBlock(block: Block, depth: number): string {
  const entries: string = renderEntries(block.entries, depth + 1);

  if (entries.length === 0) {
    return block.closed ? `{\n${indentation(depth)}}` : "{";
  }

  return block.closed ? `{\n${entries}\n${indentation(depth)}}` : `{\n${entries}`;
}

function renderPrefixedBlock(prefixedBlock: PrefixedBlock, depth: number): string {
  return `${renderScalar(prefixedBlock.prefix)} ${renderBlock(prefixedBlock.block, depth)}`;
}

function renderInlineMath(inlineMath: InlineMath): string {
  return renderTokens(inlineMath.tokens);
}

function renderOptionalBlock(optionalBlock: OptionalBlock, depth: number): string {
  const opening: string = `[[${renderTokens(optionalBlock.header)}]`;
  const entries: string = renderEntries(optionalBlock.entries, depth + 1);

  if (entries.length === 0) {
    return optionalBlock.closed ? `${opening}\n${indentation(depth)}]` : opening;
  }

  return optionalBlock.closed ? `${opening}\n${entries}\n${indentation(depth)}]` : `${opening}\n${entries}`;
}

function renderError(errorNode: ErrorNode): string {
  return renderTokens(errorNode.tokens);
}

function assertNever(node: never): never {
  throw new Error(`Unexpected AST node: ${JSON.stringify(node)}.`);
}

function renderValue(value: ValueNode, depth: number): string {
  switch (value.kind) {
    case NodeKind.Block:
      return renderBlock(value, depth);
    case NodeKind.Scalar:
      return renderScalar(value);
    case NodeKind.PrefixedBlock:
      return renderPrefixedBlock(value, depth);
    case NodeKind.InlineMath:
      return renderInlineMath(value);
    case NodeKind.OptionalBlock:
      return renderOptionalBlock(value, depth);
    case NodeKind.Error:
      return renderError(value);
    default:
      return assertNever(value);
  }
}

function renderAssignment(assignment: Assignment, depth: number): string {
  const liftedComments: string = joinNonempty([
    renderCommentTokens(assignment.beforeOperatorTrivia, depth),
    renderCommentTokens(assignment.beforeValueTrivia, depth),
    assignment.value.kind === NodeKind.PrefixedBlock
      ? renderCommentTokens(assignment.value.beforeBlockTrivia, depth)
      : "",
  ]);
  const value: string = renderValue(assignment.value, depth);
  const assignmentHead: string =
    `${indentation(depth)}${renderScalar(assignment.key)} ${assignment.operator}` +
    (value.length === 0 ? "" : ` ${value}`);

  return joinNonempty([liftedComments, assignmentHead]);
}

function renderTrivia(trivia: Trivia, depth: number): string {
  return renderCommentTokens(trivia.tokens, depth);
}

function renderEntry(entry: EntryNode, depth: number): string {
  switch (entry.kind) {
    case NodeKind.Assignment:
      return renderAssignment(entry, depth);
    case NodeKind.Block:
      return `${indentation(depth)}${renderBlock(entry, depth)}`;
    case NodeKind.Scalar:
      return `${indentation(depth)}${renderScalar(entry)}`;
    case NodeKind.PrefixedBlock:
      return joinNonempty([
        renderCommentTokens(entry.beforeBlockTrivia, depth),
        `${indentation(depth)}${renderPrefixedBlock(entry, depth)}`,
      ]);
    case NodeKind.InlineMath:
      return `${indentation(depth)}${renderInlineMath(entry)}`;
    case NodeKind.OptionalBlock:
      return `${indentation(depth)}${renderOptionalBlock(entry, depth)}`;
    case NodeKind.Trivia:
      return renderTrivia(entry, depth);
    case NodeKind.Error:
      return `${indentation(depth)}${renderError(entry)}`;
    default:
      return assertNever(entry);
  }
}

export function print(document: Document): string {
  const rendered: string = normalizeLineEndings(renderEntries(document.entries, 0)).replace(/^\uFEFF+/u, "");
  const withoutTrailingLineFeeds: string = rendered.replace(/\n+$/u, "");

  return withoutTrailingLineFeeds.length === 0 ? "" : `${withoutTrailingLineFeeds}\n`;
}
