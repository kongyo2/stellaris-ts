/**
 * Where an `else` may stand.
 *
 * The reader of an effect block (`0x3a97f0` in the 4.5.2 executable,
 * `effect.cpp`) takes each `else` and `else_if` and looks at the effect read
 * just before it in the same block. Only an `if` or an `else_if` will do: the
 * new branch is hung on that one's chain, and when there is none, or the chain
 * already ended in an `else`, the game logs `Else/else if not following an if
 * or else if` (`effect.cpp:550`) and the branch is not part of anything. A
 * trigger block is read the same way (`0x345b30`, `trigger.cpp:788`: `if/else_if
 * not following a if or else_if`).
 *
 * So `if`, `set_flag`, `else` is an `else` that never runs, and so is the
 * second `else` of `if`, `else`, `else`.
 *
 * One older form is left alone: an `else` written inside the `if` it belongs
 * to, after that block's own effects. The base game still writes nine of them
 * (`common/starbase_modules/00_waystation_modules.txt` among them) and loads
 * without the line, so inside an `if` or an `else_if` nothing is said; every
 * other one of its 4,858 follows an `if` or an `else_if` directly.
 */
export interface BranchChain {
  /** Reads the next key of the block; `false` for an `else` or `else_if` with nothing to follow. */
  readonly next: (key: string) => boolean;
  /** Something this cannot read stood here: what follows may or may not have an `if` before it. */
  readonly unknown: () => void;
}

/**
 * Whether a block is the body of an `if` or an `else_if`, by the key it is
 * written under: the last segment of a dotted path.
 */
export function isBranchBody(path: string): boolean {
  const key: string = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return key === "if" || key === "else_if";
}

/** A fresh chain, for one block. */
export function branchChain(): BranchChain {
  // Whether an `else` or an `else_if` may come next: `undefined` when unknown.
  let open: boolean | undefined = false;

  return {
    next: (key: string): boolean => {
      const lowered: string = key.toLowerCase();

      if (lowered === "if") {
        open = true;
        return true;
      }

      if (lowered === "else_if" || lowered === "else") {
        const follows: boolean = open !== false;
        // An `else` ends the chain; an `else_if` leaves it open.
        open = lowered === "else_if" && follows;
        return follows;
      }

      // `@name = …` declares a script variable. It is no effect, and what it
      // stands between is as it was.
      if (lowered.startsWith("@") && !lowered.includes("$")) {
        return true;
      }

      // `inline_script` and a `$PARAM$` key stand for script this cannot see.
      open = lowered === "inline_script" || lowered.includes("$") ? undefined : false;
      return true;
    },
    unknown: (): void => {
      open = undefined;
    },
  };
}
