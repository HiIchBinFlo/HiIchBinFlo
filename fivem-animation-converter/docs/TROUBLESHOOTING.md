# Troubleshooting

Start here:

```
python -m app.main doctor
```

It reports Blender, the CodeWalker bridge and the skeleton profile in one go,
and finishes with a plain `Ready to convert: yes/no`.

---

## Setup

### "Blender was not found."

The converter looks in, in order: your saved path, `BLENDER_PATH`, the `bpy`
module, the standard install locations, then `blender` on `PATH`.

* **GUI**: press **Select Blender** and pick `blender.exe`. The path is saved.
* **CLI**: `set BLENDER_PATH=C:\Program Files\Blender Foundation\Blender 4.2\blender.exe`

A path is only accepted if `blender --version` actually runs, so a wrong pick is
rejected immediately rather than failing mid-conversion.

### "No GTA V skeleton profile is configured."

Expected on first run. See [SKELETON_SETUP.md](SKELETON_SETUP.md) — about two
minutes. The converter will not substitute a guessed skeleton, because a guessed
rest pose produces a file that looks valid and animates wrongly.

### "The CodeWalker bridge was not found" / no `.ycd`, only `.ycd.xml`

The sidecar has not been built. From the repository root:

```bat
npm run build:sidecar        # needs the .NET 8 SDK
```

Or point at an existing build:

```bat
set FIVEM_ANIM_BRIDGE=C:\path\to\codewalker-bridge.exe
```

**This is not fatal.** The `.ycd.xml` is complete and valid. Open CodeWalker,
right-click in RPF Explorer → *Import XML*, select it, and you get the same
`.ycd`.

---

## Conversion

### "In der FBX wurde kein animierbares Skeleton gefunden." / no armature

The file has meshes but no rig. Re-export from your source tool with the
armature included. In Mixamo, download **FBX** (not "FBX for Unity") with
*Skin: With Skin* or *Without Skin* — both carry the rig.

### "The FBX contains a skeleton but no animation."

There is a rig but no keyframes. Common causes:

* the animation lives in a take/NLA strip that was not baked on export — enable
  *Bake Animation* in your exporter;
* you exported the T-pose/rest model rather than the animation clip.

`python -m app.main convert file.fbx --debug` prints the frame range and which
bones carry keys.

### "The skeleton could not be recognised automatically."

Shown with the list of unmapped bones. The mapping table in the GUI lets you fix
any row by hand; essential bones must be assigned before Convert proceeds.

If you convert many files from the same unusual rig, add an alias table to
`mappings/` instead of remapping every time — copy `mappings/mixamo.json`,
change `id`, `label` and the alias lists. No code changes, and it is picked up on
next launch.

### Some bones show `??` (uncertain)

They matched only by fuzzy string similarity, so they are never trusted
silently. Check them in the mapping dialog and either confirm or repoint them.

### "Essential bones are unmapped"

The animation cannot work without pelvis, spine, neck, head, arms and legs. Map
them manually in the dialog. Note that `SKEL_Spine3` is *not* required — Mixamo
rigs only have three spine bones and convert fine.

---

## The animation plays, but looks wrong

This is the interesting category, because the file is structurally fine.

### Arms are offset by a constant angle for the whole clip

An A-pose/T-pose rest mismatch. Rest alignment is on by default; if it made
things worse for a particular rig, try `--no-align` (GUI: uncheck *Align A-pose
/ T-pose difference*) and compare.

### The ped slides, drifts, or floats

Root motion. Dances and emotes almost always want:

```bat
python -m app.main convert dance.fbx --name my_dance --root-motion inplace
```

which removes horizontal hip travel and keeps the vertical bob.

### The ped is squashed, stretched, or the hips bob too far

Hip translation is rescaled by the ratio of hip heights between the two rigs.
`--debug` prints `hip_scale_factor`; a wildly wrong value (e.g. 100 or 0.01)
means the source FBX is in centimetres. Re-export with the scale applied, or
apply the scale to the armature in Blender first.

### Limbs twist or bend the wrong way

Usually a mis-mapped bone — check the mapping table for a left/right swap, which
`??` rows make easy to spot. Failing that, the source rig's bone hierarchy may
differ structurally (an extra twist bone treated as the forearm, say); exclude it
by clearing that row.

### Playback is too fast or too slow

The clip is resampled to the target FPS, and `Duration` is derived as
`(frames - 1) / fps`. Stock GTA ped animations are 30 fps — verified against real
files in [ANIMATION_PIPELINE.md](ANIMATION_PIPELINE.md) §1.3a — so leave FPS at
30 unless you have a reason.

---

## In game

### `/testanim` does nothing

1. Is the resource started? `ensure my_dance` in `server.cfg`, then `refresh`
   and `restart my_dance`.
2. Are the names right? The dictionary is the `.ycd` file name without its
   extension; the clip is the clip inside. Both are printed at the end of a
   conversion.
3. Did you request the dictionary? `RequestAnimDict` plus the
   `HasAnimDictLoaded` wait is mandatory — skipping it is the single most common
   cause of a silent no-op. The generated `client.lua` does it correctly and
   prints a message if the dictionary does not exist.

### The animation plays once and stops

That is flag `0`. Pass `1` to loop:

```lua
TaskPlayAnim(PlayerPedId(), dict, clip, 8.0, -8.0, -1, 1, 0.0, false, false, false)
--                                                      ^ flag
```

### Only the upper body moves

Flag `16`-family values apply the animation additively to the upper body. Use
`1` (loop) or `0` (once) for a full-body clip.

---

## Getting a useful bug report together

```bat
python -m app.main convert dance.fbx --name test --debug --keep-intermediates
```

Then attach:

* `logs/conversion_<date>_<time>.log` — includes Blender's full console output
* the `=== BONE MAPPING ===` section printed by `--debug`
* the temporary directory path printed by `--keep-intermediates`, which holds
  `analysis.json`, `mapping.json` and `animation.json`

`output/<name>.ycd.xml` is plain text and diffable — it is often the fastest way
to see whether a bone ended up static when it should have moved.
