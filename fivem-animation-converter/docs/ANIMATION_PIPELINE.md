# The GTA V / FiveM animation pipeline — what is actually true

This document is **Phase 1**: the technical research that the rest of this project
is built on. It was written *before* the implementation, by reading the source of
the tools that actually produce and consume these files — not by guessing.

Every claim is marked:

- **CONFIRMED** — verified against primary source (CodeWalker's own C# source, the
  Sollumz add-on source, or official FiveM/Rockstar-native documentation). The exact
  file and line range is cited so you can re-check it.
- **NEEDS VERIFICATION** — plausible and used by the implementation, but not proven
  by a primary source, or not testable inside this repository's sandbox.

---

## 1. What exactly is a `.ycd`?

**CONFIRMED.** A `.ycd` is a **Clip Dictionary**: a RAGE resource file (the same
RSC7 container family as `.ydd`/`.ytd`/`.yft`) whose root object is a
`ClipDictionary`. It is a *container of two parallel maps*:

| Map | Contents |
| --- | --- |
| `Clips` | `ClipMapEntry` → `ClipAnimation` (or `ClipAnimationList`) — the things you *play* |
| `Animations` | `AnimationMapEntry` → `Animation` — the raw keyframe data |

A **Clip** is the playable unit: it has a name, a start time, an end time, a
playback rate, optional tags and properties, and a reference to an **Animation**.
An **Animation** holds the actual per-bone curves. This split is why a single
`.ycd` can expose several clips (e.g. `idle_a`, `idle_b`) over shared animation data.

Source: `CodeWalker.Core/GameFiles/Resources/Clip.cs` — `ClipDictionary` (line 42),
`Animation` (line 630), `ClipBase` (line 2965), `ClipAnimation` (line 3182).

The resource version number for a clip dictionary is **46**.
Source: `YcdFile.Save()` → `ResourceBuilder.Build(ClipDictionary, 46)` —
`CodeWalker.Core/GameFiles/FileTypes/YcdFile.cs:108`.

### 1.1 Inside an `Animation`

**CONFIRMED.** An `Animation` contains:

- `FrameCount` — number of frames
- `Duration` — length in **seconds**
- `SequenceFrameLimit` — max frames carried by one `Sequence` (see §1.3)
- `BoneIds[]` — an array of `(BoneId, Track, Unk0)` triples
- `Sequences[]` — the keyframe payload

`BoneIds` is the index table. Entry *i* of `BoneIds` describes what entry *i* of a
sequence's `SequenceData` animates. So a bone that has both position and rotation
animated occupies **two** `BoneIds` entries.

Source: `Clip.cs:630-700` (fields), `Clip.cs:860-905` (`WriteXml`/`ReadXml`),
`AnimationBoneId` struct at `Clip.cs:940-965`.

### 1.2 Tracks

**CONFIRMED.** The `Track` byte selects which transform channel is animated:

| Track | Meaning | Value format |
| --- | --- | --- |
| `0` | `BonePosition` | Vector3 |
| `1` | `BoneRotation` | Quaternion |
| `2` | `BoneScale` | Vector3 |

Source: Sollumz `tools/animationhelper.py:25-29` (`class Track(IntEnum)`) and
`:81-84` (`TrackFormatMap`). Higher track numbers exist for cameras, UVs and
generic float properties; this project emits only 0 and 1 (and optionally 2).

### 1.3 Sequences and channels

**CONFIRMED.** A `Sequence` is a chunk of frames. Each `Sequence` holds a
`SequenceData` array, parallel to `Animation.BoneIds`, and each element is an
`AnimSequence` holding a list of **channels** — one channel per scalar component.

The channel types are:

```
StaticQuaternion = 0   StaticVector3 = 1   StaticFloat = 2   RawFloat = 3
QuantizeFloat = 4      IndirectQuantizeFloat = 5             LinearFloat = 6
CachedQuaternion1 = 7  CachedQuaternion2 = 8
```

Source: `Clip.cs:969-980` (`enum AnimChannelType`).

This project uses only three of them, deliberately:

- **`StaticVector3`** / **`StaticQuaternion`** — a single constant value for the
  whole sequence. Used when a bone's channel does not change over time (the
  overwhelmingly common case: most bones never translate).
- **`RawFloat`** — one uncompressed IEEE-754 32-bit float per frame, for animated
  components.

`RawFloat` is the important one: it is a **lossless, unquantized** channel, so the
converter never has to solve for quantization scales/offsets and can never
introduce quantization drift. Its cost is size (4 bytes/frame/component).

Source: `AnimChannelRawFloat` at `Clip.cs:1669-1722` — `WriteFrame` writes
`BitConverter.GetBytes(v)` as 32 raw bits, `GetFrameBits()` returns 32.

> **Note on `StaticQuaternion`:** it serialises only X, Y, Z and reconstructs
> `W = sqrt(max(1 - |xyz|², 0))` on read (`Clip.cs:1125-1158`). W is therefore
> **always non-negative** after a round trip, so a quaternion with `w < 0` must be
> negated before writing. `q` and `-q` are the same rotation, so this is lossless.
> The converter does this — see `app/exporter/ycd_xml.py`.

### 1.3a Duration and SequenceFrameLimit are derivable, not guesswork

**CONFIRMED**, by solving against the real values Rockstar files produce, which
`Clip.cs` records inline as read comments (`Clip.cs:645-650`, `:2410-2420`):

| `Frames` | `Duration` | `SequenceFrameLimit` |
| --- | --- | --- |
| 221 | 7.34 | 223 |
| 17 | 0.53 | 31 |
| 151 | 5.0 | 159 |
| 201 | 6.66 | 207 |

**`Duration = (FrameCount - 1) / fps`.** `Animation.GetFramePosition`
(`Clip.cs:895-905`) computes `curPos = (t / Duration) * (Frames - 1)`, so `t =
Duration` lands exactly on the last frame — the duration spans the *gaps* between
frames. Every row above satisfies this at **30 fps**: `220/30 = 7.33`,
`16/30 = 0.53`, `150/30 = 5.0`, `200/30 = 6.67`. That also confirms in passing
that stock ped animations are authored at 30 fps.

**`SequenceFrameLimit = ceil((FrameCount + 1) / 16) * 16 - 1`.** Each row is the
frame count rounded up to a multiple of 16, minus one: 221→224−1, 17→32−1,
151→160−1, 201→208−1. All four match.

The `+ 1` is not cosmetic. Rounding `FrameCount` itself breaks on exact
multiples of 16: 16 frames would give a limit of 15, and since
`Animation.EvaluateVector4` (`Clip.cs:905-920`) picks a sequence with
`Frame0 / SequenceFrameLimit`, frame 15 would index sequence **1** when only
sequence 0 exists. Rounding `FrameCount + 1` reproduces all four observed
samples identically *and* keeps the limit `>= FrameCount` for every input. This
was caught by a property test
(`tests/test_ycd_xml.py::test_sequence_frame_limit_is_never_below_the_frame_count`),
not by inspection.

Both are implemented in `app/exporter/ycd_xml.py` (`duration_for`,
`sequence_frame_limit`).

### 1.4 The bit-packing is not our problem

**CONFIRMED**, and this is the single most useful discovery in this research.

`Sequence` stores its channels as a packed byte blob (`Sequence.Data`) with
per-channel data offsets, frame strides and bit offsets. Building that blob by hand
would be the hardest and most error-prone part of writing a `.ycd`.

We never do it. `Sequence.BuildData()` (`Clip.cs:2565`) performs the entire packing,
and it is invoked automatically during resource serialisation via
`Animation.GetParts()` (`Clip.cs:796`: `BuildSequencesData(); //TODO: move this somewhere better?`),
which the `ResourceBuilder` calls while writing.

So: **if we can produce correct Clip Dictionary XML, CodeWalker.Core produces a
correct binary `.ycd`.** That single fact determines this project's architecture.

---

## 2. How are GTA V animation clips normally created?

**CONFIRMED.** The established community pipeline is:

1. Animate in Blender (or import an FBX from Mixamo/Rokoko/mocap) on a rig whose
   bones match the GTA V ped skeleton.
2. Export with the **Sollumz** Blender add-on to **CodeWalker XML** (`.ycd.xml`).
3. Convert that XML to a binary `.ycd` with **CodeWalker**.
4. Drop the `.ycd` into a FiveM resource's `stream/` folder.

Sources: Sollumz wiki *"YCD | Import & Edit & Export"*, which instructs
`File > Export > Codewalker XML`; Sollumz docs FAQ: *"Sollumz cannot import binary
formats directly. You must convert them to XML first using CodeWalker."*

### 2.1 Role of each tool

| Tool | Role | Can it write binary `.ycd`? |
| --- | --- | --- |
| **Blender** | Animation authoring, FBX import, retargeting | No |
| **Sollumz** (Blender add-on) | Reads/writes CodeWalker **XML** for GTA formats | **No — XML only** |
| **CodeWalker** (`dexyfex`) | RPF browser + the XML ⇄ binary compiler | **Yes** |
| **CodeWalker.Core** (NuGet) | The reusable library half of CodeWalker | **Yes** |
| **OpenIV** | RPF/archive editor for singleplayer installs | Not for XML→YCD |

### 2.2 Can Blender export YCD directly?

**CONFIRMED: no.** Neither vanilla Blender nor Sollumz writes a binary `.ycd`.
Sollumz's entire GTA I/O surface is CodeWalker XML. Any tool claiming a direct
"Blender → .ycd" button is either bundling CodeWalker, reimplementing its resource
writer, or not really producing a `.ycd`.

This is exactly the "if a direct conversion is not reliably possible" branch in the
task description, so this project implements the intermediate-format pipeline.

---

## 3. The pipeline this project implements

```
  .fbx  (Mixamo / Rokoko / custom)
    │
    ▼  Blender, headless  (--background --python)
  import, detect armature, read action / fps / frame range
    │
    ▼  bone mapping (aliases + regex + fuzzy, in Python)
  source bone  ->  GTA V ped bone
    │
    ▼  retarget onto a rig built from the REAL GTA V ped rest skeleton
  constraint-driven, then baked per frame
    │
    ▼  dump per-bone, per-frame PARENT-RELATIVE LOCAL transforms  (JSON)
    │
    ▼  build CodeWalker Clip Dictionary XML   (pure Python, no Blender)
  <ClipDictionary><Clips/><Animations/></ClipDictionary>
    │
    ▼  CodeWalker.Core:  XmlYcd.GetYcd(xml)  ->  YcdFile.Save()
  my_dance.ycd                       (binary, resource version 46)
    │
    ▼  FiveM resource generator
  output/my_dance/{fxmanifest.lua, stream/my_dance.ycd, README.md}
```

The XML→binary step runs inside the **`codewalker-bridge` sidecar that already
exists in this repository** (`sidecar/CodeWalkerBridge`), which wraps the
`CodeWalker.Core` NuGet package. This project adds two commands to it rather than
creating a second wrapper. See §7.

### 3.1 The one number that matters: what goes in a channel

**CONFIRMED**, and this is the part most naive converters get wrong.

A `.ycd` does **not** store Blender-style pose deltas from the rest pose. It stores
each bone's **full local transform relative to its parent bone**.

Sollumz proves this on export. In `ycd/ycdexport.py:120-135` it takes the raw
F-curve values (`pose_bone.location`, `pose_bone.rotation_quaternion` — which are
deltas from rest) and pre-multiplies them by the bone's rest matrix:

```python
transform_mat = calculate_bone_space_transform_matrix(bone_map.get(bone_id), None)
# position:
vecs[i] = transform_mat @ vecs[i]
# rotation:
quats[i].rotate(transform_mat)
```

and `calculate_bone_space_transform_matrix(old, None)` (`tools/animationhelper.py:249-266`)
with `new_pose_bone = None` reduces to the bone's **rest matrix relative to its
parent**:

```python
old_mat = old_bone.matrix_local
if old_bone.parent is not None:
    old_mat = old_bone.parent.matrix_local.inverted() @ old_mat
return Matrix.Identity(4).inverted() @ old_mat     # == old_mat
```

So the stored value is `rest_local ∘ pose_delta` — i.e. the bone's complete local
transform in its parent's frame.

**This project computes the same quantity a more robust way.** Instead of
`rest_local @ basis`, it evaluates

```python
local = parent_pose_bone.matrix.inverted() @ pose_bone.matrix   # bone with parent
local = pose_bone.matrix                                        # root bone
```

These are algebraically identical (Blender defines
`pose_bone.matrix = parent.matrix @ rest_local @ basis`), but the matrix form also
stays correct when the pose comes from **constraints** rather than from keyed
basis channels — which is precisely the situation during retargeting. See
`blender_scripts/lib_gta.py`.

### 3.2 Coordinate system

**CONFIRMED.** Both Blender and RAGE use a right-handed, Z-up coordinate system,
and Sollumz applies **no** global axis conversion when importing or exporting ped
clip dictionaries (only cameras get special handling — `ycdexport.py:135-145`).
Therefore Blender armature space is GTA space, *provided the target armature is
built from real GTA rest data.* The FBX importer is configured to convert incoming
Y-up FBX data into this space.

### 3.3 Why the real rest skeleton is non-negotiable

**CONFIRMED** by the maths in §3.1. Because the format stores *absolute local*
transforms rather than deltas, the numbers are only meaningful relative to the
actual GTA V bone rest orientations and offsets. Retargeting onto an invented or
approximated skeleton yields a file that is structurally valid and plays back as
garbage.

This project therefore **refuses to fabricate rest data**. It ships the bone
*names, tags and hierarchy* (public reference metadata — see §4) but requires the
user to supply the rest pose **once**, extracted from their own legally-owned copy
of GTA V. See §5 and `docs/SKELETON_SETUP.md`.

---

## 4. GTA V ped skeleton: names, tags, hierarchy

**CONFIRMED (names ↔ tags).** The `BoneId` written into a `.ycd` is the bone's
**tag** (a `ushort`), not its index. The standard ped tags are long-published
reference data. A representative slice:

| Bone | Tag | Bone | Tag |
| --- | --- | --- | --- |
| `SKEL_ROOT` | 0 | `SKEL_Neck_1` | 39317 |
| `SKEL_Pelvis` | 11816 | `SKEL_Head` | 31086 |
| `SKEL_Spine_Root` | 57597 | `SKEL_L_Clavicle` | 64729 |
| `SKEL_Spine0` | 23553 | `SKEL_L_UpperArm` | 45509 |
| `SKEL_Spine1` | 24816 | `SKEL_L_Forearm` | 61163 |
| `SKEL_Spine2` | 24817 | `SKEL_L_Hand` | 18905 |
| `SKEL_Spine3` | 24818 | `SKEL_L_Thigh` | 58271 |
| `SKEL_R_Clavicle` | 10706 | `SKEL_L_Calf` | 63931 |
| `SKEL_R_UpperArm` | 40269 | `SKEL_L_Foot` | 14201 |
| `SKEL_R_Forearm` | 28252 | `SKEL_L_Toe0` | 2108 |
| `SKEL_R_Hand` | 57005 | `SKEL_R_Thigh` | 51826 |
| `SKEL_R_Calf` | 36864 | `SKEL_R_Foot` | 52301 |

The complete table this project uses, including fingers, `IK_`/`PH_`/`MH_` helper
bones and the parent hierarchy, lives in `mappings/gta5_ped.json`.

Sources: GTAMods Wiki *Ped Bones*; alt:V and RAGE:MP bone references; the
widely-mirrored "GTAV Ped Bone Name, Bone ID, Bone Index" table.

**NEEDS VERIFICATION (per-install):** tags are stable across the standard ped
skeleton, but any given `.yft` may omit bones or add model-specific ones. The
converter always intersects its mapping against the bones actually present in the
skeleton the user supplied, and reports the difference, rather than trusting the
table blindly.

**Rest transforms are NOT in this table** and are not shipped — see §5.

---

## 5. Where the rest skeleton comes from

**CONFIRMED.** Ped skeletons live in the ped's fragment file — e.g.
`mp_m_freemode_01.yft` / `player_zero.yft` — inside the game's RPF archives. That
is Rockstar-owned game data. It is **not** redistributable, so this repository
contains none of it.

The converter accepts the skeleton in either of two forms, and caches the parsed
result:

1. **`.yft.xml` / `.ydd.xml`** — a CodeWalker XML export of a ped file the user
   made from their own install. Parsed by **pure Python**
   (`app/converter/skeleton.py`), no sidecar or Blender needed. This is the
   recommended path because it is the most testable.
2. **Binary `.yft` / `.ydd`** — handed to the `codewalker-bridge` sidecar's
   `dump-skeleton` command, which uses CodeWalker.Core.

Both yield the same normalised profile: for every bone, its `name`, `tag`,
`parent`, rest `translation`, rest `rotation` (quaternion) and rest `scale`.

If no skeleton profile is configured, the converter **stops with an explicit
error**. It does not substitute a guess.

---

## 6. How FiveM loads and plays the result

**CONFIRMED.** A clip dictionary streamed by a resource is addressed by the
**`.ycd` filename without its extension**. `my_dance.ycd` in `stream/` becomes the
animation dictionary `"my_dance"`; the clip names are whatever the `Clips` entries
inside it are called.

`fxmanifest.lua` needs only to declare the stream folder:

```lua
fx_version 'cerulean'
game 'gta5'

files { 'stream/my_dance.ycd' }   -- optional; `stream/` is auto-streamed
```

In practice a `stream/` directory is picked up automatically by the resource
streamer; the generated manifest is written accordingly.

Playback is the standard two-step native sequence — requesting the dictionary
first is mandatory, and skipping it is the most common cause of "the animation
does nothing":

```lua
RequestAnimDict(dict)
while not HasAnimDictLoaded(dict) do Wait(0) end
TaskPlayAnim(PlayerPedId(), dict, clip,
             8.0,      -- blend in
            -8.0,      -- blend out
            -1,        -- duration (-1 = full clip)
             1,        -- flag (1 = loop)
             0.0,      -- start phase
             false, false, false)
```

Sources: FiveM/Rockstar native reference for `REQUEST_ANIM_DICT`,
`HAS_ANIM_DICT_LOADED` and `TASK_PLAY_ANIM`; corroborated by Cfx.re community
documentation on streaming `.ycd` files from a resource's `stream/` folder.

The generated test resource in §8 of the README implements exactly this.

---

## 7. External tool dependency, and its licensing

**The only external component required for the final binary step is
`CodeWalker.Core`**, consumed as the **MIT-licensed NuGet package
`CodeWalker.Core` 1.0.3** — the same dependency this repository already uses for
`.ydd`/`.ytd` decoding (`sidecar/CodeWalkerBridge/CodeWalkerBridge.csproj`).

Why this and not something else:

- It is the *reference* implementation of the RAGE resource writer. Reimplementing
  the `Sequence` bit-packer and the RSC7 builder in Python would be guesswork
  against an undocumented format, which is precisely what the task asked us not
  to do.
- It is a normal package dependency, restored by `dotnet publish` at build time.
  **No Rockstar or proprietary file is vendored into this repository.**
- The end user never installs or opens the CodeWalker GUI; the sidecar is a
  self-contained binary.

See `sidecar/NOTICE.md` for the licensing summary that already governs this
dependency in this repo.

**Fallback, and it is a real one, not a stub:** if the sidecar has not been built,
the converter still writes a complete, valid `my_dance.ycd.xml` and tells the user
to run CodeWalker's *Import XML* on it. The pipeline degrades to the documented
community workflow rather than failing or faking output.

---

## 8. Honest limits of what was verified here

This section exists because the task explicitly asked for it.

**Verified by execution inside this repository's sandbox** (70 tests,
`python -m pytest tests/ -q`):

- The identity in §3.1, checked against real Blender: `rest_local @ basis` and
  `parent.matrix⁻¹ @ pose.matrix` agree to 6e-8 on a rig with non-trivial bone
  rolls and offsets.
- The Blender pipeline end to end on a **real FBX** (generated by Blender, with
  Mixamo bone naming and deliberately different proportions and frame rate):
  import, armature/action detection, mapping, retargeting and the
  parent-relative local-transform extraction.
- **The retarget invariant**: with a source rig in its rest pose, the target
  reproduces *its own* rest pose to within 1e-5, and the fixture's 70°/35°
  rotations arrive as 70.00°/35.00°.
- Frame-rate conversion as a genuine resample (24 → 30 fps produces
  interpolated intermediate values, not repeated frames).
- The Clip Dictionary XML writer, field-by-field against the `ReadXml` methods
  in `Clip.cs` cited throughout this document, including `BoneIds` ⇄
  `SequenceData` parallelism, static-channel collapse, the `StaticQuaternion`
  W-sign constraint, and the two derived values in §1.3a.
- Bone mapping across seven naming conventions, with zero fuzzy fallbacks and
  zero unmapped essential bones for each.
- The skeleton profile parser, against a `.yft.xml` fixture in CodeWalker's
  format.
- The GUI, constructed and driven headlessly (`QT_QPA_PLATFORM=offscreen`).

**NOT verified here, and why:**

- **Compiling and running the `xml-to-ycd` sidecar command.** This sandbox's
  network policy blocks the .NET SDK download
  (`builds.dotnet.microsoft.com` → HTTP 403), so no .NET toolchain could be
  installed. The C# added in §7 is ~40 lines calling two APIs whose signatures were
  read directly from CodeWalker source (`XmlYcd.GetYcd`, `YcdFile.Save`), but it
  has **not been compiled**. Build it with `npm run build:sidecar` and verify with
  `codewalker-bridge probe`.
- **In-game playback.** Confirming that a produced clip animates a ped correctly
  requires GTA V, a FiveM server and the user's own ped skeleton. That is the one
  test that cannot be automated here.

**NEEDS VERIFICATION** items carried by the implementation, each flagged in code at
the point of use:

- `Animation.Unknown_10h` (XML `Unknown10`) — real files consistently read `1`
  (`Clip.cs:670`). We emit `1`.
- `Animation.Unknown_1Ch` (XML `Unknown1C`) and `Sequence.Unknown_00h` — emitted as
  zero hashes; their meaning is undocumented.
- `ClipBase.Unknown_30h` (XML `Unknown30`) — observed `0` or `1`; we emit `0`.
