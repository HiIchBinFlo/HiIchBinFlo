# Third-Party Notice: CodeWalker.Core

`codewalker-bridge` depends on the `CodeWalker.Core` NuGet package (published
from [dexyfex/CodeWalker](https://github.com/dexyfex/CodeWalker)), fetched at
build time like any other NuGet dependency — no CodeWalker source code is
copied into this repository.

## What we found

CodeWalker's repository root includes a `Notice.txt` combining several
license notices for code originating from different contributors:

- **dexyfex** (2017-2019) — the majority of the codebase, including the
  `GameFiles`/`Resources` namespaces this bridge actually uses
  (`RpfFile`, `YtdFile`, `YddFile`, `TextureDictionary`, `Drawable`, ...).
- An **MIT-licensed** contribution attributed to "Neodymium" (2015).
- An **MIT-licensed** contribution attributed to Cameron Berry (2017).
- A **GPL-licensed** "FBX library for .NET" attributed to Hamish Milne (2015),
  used for CodeWalker's FBX import/export feature.

`codewalker-bridge` only calls into the resource-reading classes
(`RpfFile.GetResourceFile<T>`, `YtdFile`, `YddFile`, `TextureDictionary`,
`Texture`, `Drawable`, `DDSIO`, ...) — it does not reference or link against
CodeWalker's FBX import/export code path, and ships no CodeWalker source of
any kind (only the compiled NuGet package as an ordinary dependency).

## Why this is documented instead of just assumed fine

This project's own code is MIT-licensed. Depending on a package that mixes an
MIT-majority codebase with at least one GPL-licensed component is exactly the
kind of thing that should be written down and checked, not silently assumed
safe — per this project's own rule of documenting real constraints instead of
hand-waving them.

## What we have NOT independently done

- A line-by-line audit confirming the GPL-licensed FBX code is fully absent
  from the compiled `CodeWalker.Core.dll` (as opposed to merely unused by our
  call paths).
- Formal legal review of whether depending on this NuGet package, as-is,
  is compatible with distributing `codewalker-bridge` under MIT.

**If you plan to redistribute builds of this application** (beyond running it
yourself from source), verify the current state of
[dexyfex/CodeWalker's licensing](https://github.com/dexyfex/CodeWalker) and
the published `CodeWalker.Core` package directly before doing so — this
document reflects a good-faith reading of the repository's own notices at the
time this integration was built (2026), not a legal opinion.
