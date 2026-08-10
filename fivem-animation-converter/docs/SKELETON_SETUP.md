# One-time setup: the GTA V ped skeleton

The converter needs the **rest pose of a real GTA V ped skeleton** before it can
produce a usable animation. You supply it once; it is remembered afterwards.

## Why this is required, and why it is not shipped

A `.ycd` does not store "how far each bone moved from its rest pose". It stores
each bone's **complete local transform relative to its parent** (this is proven
from Sollumz's exporter and CodeWalker's source in
[ANIMATION_PIPELINE.md](ANIMATION_PIPELINE.md) §3.1).

The consequence is direct: those numbers are only meaningful against the actual
GTA V bone offsets and orientations. Retarget onto an invented skeleton and you
get a file that is structurally perfect and animates like a broken deckchair.

Rest pose data is Rockstar-owned game data. It is not redistributable, so this
project ships **none** of it — only the public bone *names*, *tags* and
*hierarchy* (`mappings/gta5_ped.json`). Rather than guess the transforms, the
converter refuses to run without a real skeleton.

You already own this data if you own GTA V. It takes about two minutes to
extract.

---

## Option A — CodeWalker XML (recommended)

The most reliable route, and the one the converter parses in pure Python with no
other tool involved.

1. Open **CodeWalker** → *RPF Explorer*.
2. Search for a ped fragment. Good choices:

   | File | What it is |
   | --- | --- |
   | `mp_m_freemode_01.yft` | MP male — the usual target for FiveM |
   | `mp_f_freemode_01.yft` | MP female |
   | `player_zero.yft` | Michael (a standard SP ped) |

   They live under `x64e.rpf\models\cdimages\ped_*.rpf`. Typing the name into
   CodeWalker's search box is quicker than browsing.
3. Right-click the `.yft` → **Export XML**. You get `mp_m_freemode_01.yft.xml`.
4. Load it into the converter:

   * **GUI**: *Select GTA V skeleton* → pick the `.xml`
   * **CLI**: `python -m app.main skeleton mp_m_freemode_01.yft.xml`

Confirm it worked:

```
$ python -m app.main doctor
  GTA V skeleton .... GTA V Ped (mp_m_freemode_01.yft) (xxx bones)
```

## Option B — the binary `.yft` directly

If the `codewalker-bridge` sidecar has been built (`npm run build:sidecar` from
the repository root), you can hand it the binary file and skip the XML export:

```
python -m app.main skeleton "C:\path\to\mp_m_freemode_01.yft"
```

The bridge reads the skeleton with CodeWalker.Core and writes the same profile.

## Option C — an existing Sollumz project

If you already have a ped `.yft.xml` from a Sollumz workflow, use it. Any
CodeWalker XML that contains a `<Skeleton>` with `<Bones>` works — `.yft.xml`,
`.ydr.xml` and `.ydd.xml` are all accepted.

---

## What gets stored

The parsed profile is written to `skeleton_profile.json` next to the project and
recorded in your config file
(`%APPDATA%\FiveMAnimationConverter\config.json` on Windows). It contains, per
bone: name, tag, index, parent index, rest translation, rest rotation and rest
scale.

**This file contains game data extracted from your own installation. Do not
redistribute it**, and do not commit it to a public repository.

## Validation

When a profile is loaded the converter compares it against the reference bone
table and reports:

* bones the reference expects that your skeleton does not have,
* bones whose tag differs from the published value,
* bones your skeleton has that the reference does not list.

Differences are **reported, never silently corrected**. The bone tag written
into the `.ycd` always comes from your actual skeleton, because that is the one
the game will match against.

## Which skeleton should I pick?

Use the one your server's peds actually use. For most FiveM servers that is
`mp_m_freemode_01` / `mp_f_freemode_01`.

The standard ped skeleton is shared across the vast majority of peds, so an
animation retargeted onto the MP male skeleton plays correctly on nearly all of
them. Peds with genuinely different rigs (animals, and some cutscene-specific
models) need their own skeleton — load that one and convert again.
