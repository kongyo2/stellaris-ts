# Third-party material

## cwtools-stellaris-config

The schema under `src/schema/` was ported once from
[cwtools/cwtools-stellaris-config](https://github.com/cwtools/cwtools-stellaris-config)
and is maintained here since. It is not a dependency: nothing in this package
reads `.cwt` at build or run time, and `npm run verify:norefs` proves it by
building with the reference checkout removed.

```
MIT License

Copyright (c) 2018 tboby

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## stellaris-triggers-modifiers-effects-list

The scope constraints in `src/schema/scope-constraints.ts` are derived from the
game's own `-debug` documentation, as collected at
[OldEnt/stellaris-triggers-modifiers-effects-list](https://github.com/OldEnt/stellaris-triggers-modifiers-effects-list).
The content is output produced by Stellaris itself; the repository gathers it.
Only the trigger and effect names and the scopes each accepts are used.

## Stellaris

Identifiers under `src/generated/vanilla/` are extracted from an installed copy
of Stellaris by `npm run index:game`. **Names only** — no localisation text, no
numeric balance, no script bodies, no assets. They are the words a mod has to
write to refer to base-game content, which cannot be reproduced except by using
them.

Stellaris is © Paradox Interactive AB. This project is unaffiliated with, and
not endorsed by, Paradox Interactive.
