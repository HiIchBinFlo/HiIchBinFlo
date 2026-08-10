# FBX → FiveM Animation Converter

Drag in an FBX. Get a FiveM-ready animation resource out.

```
output/
└── my_dance/
    ├── fxmanifest.lua
    ├── stream/
    │   └── my_dance.ycd
    └── README.md
```

No manual Blender work: Blender runs headless in the background. No manual
CodeWalker work either — the XML → binary `.ycd` step runs through a bundled
sidecar.

> **Read this first:** [`docs/ANIMATION_PIPELINE.md`](docs/ANIMATION_PIPELINE.md)
> is the research this tool is built on — what a `.ycd` actually is, why Blender
> cannot write one directly, and exactly which claims are verified against
> primary sources versus still unverified. Every non-obvious number in the code
> is justified there with a file-and-line citation.

---

## What this is not

It does not rename an FBX to `.ycd` and hope. The pipeline is:

```
 .fbx ──▶ Blender (headless) ──▶ retarget onto the real GTA V skeleton
      ──▶ CodeWalker Clip Dictionary XML
      ──▶ CodeWalker.Core ──▶ my_dance.ycd ──▶ FiveM resource
```

The intermediate XML step is not a shortcut, it is *the* supported route:
**neither Blender nor Sollumz can write a binary `.ycd`** — Sollumz's whole GTA
I/O surface is CodeWalker XML. This tool automates the path the community
already uses by hand.

---

## Requirements

| | | |
| --- | --- | --- |
| **Python 3.10+** | required | runs the converter |
| **Blender 4.x or 5.x** | required | FBX import and retargeting |
| **A GTA V ped skeleton** | required, one-time | see [`docs/SKELETON_SETUP.md`](docs/SKELETON_SETUP.md) |
| **.NET 8 SDK** | optional | builds the sidecar that writes the binary `.ycd` |

Without the sidecar the converter still produces a complete, valid `.ycd.xml`
that you can convert in CodeWalker with *Import XML*. It degrades to a longer
path; it never fakes output.

---

## Install (Windows)

```bat
git clone <this repository>
cd fivem-animation-converter

python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Install Blender from [blender.org](https://www.blender.org/download/) if you do
not have it. The converter finds
`C:\Program Files\Blender Foundation\Blender 4.x\blender.exe` automatically; if
yours lives elsewhere, use **Select Blender** in the GUI and the path is
remembered.

Build the sidecar (optional but recommended), from the repository root:

```bat
npm run build:sidecar
```

Then check everything is in place:

```bat
python -m app.main doctor
```

```
  Blender ........... C:\Program Files\...\blender.exe (4.2.1)
  CodeWalker bridge . codewalker-bridge-x86_64-pc-windows-msvc.exe (CodeWalker.Core 1.0.3)
  GTA V skeleton .... GTA V Ped (mp_m_freemode_01.yft) (xxx bones)

  Ready to convert:  yes
```

### One-time skeleton setup

The converter needs the rest pose of a real GTA V ped skeleton, extracted from
your own game files, and will not invent one.
**[`docs/SKELETON_SETUP.md`](docs/SKELETON_SETUP.md)** walks through it — about
two minutes in CodeWalker.

```bat
python -m app.main skeleton mp_m_freemode_01.yft.xml
```

---

## Use it

### GUI

```bat
python -m app.main
```

```
┌─────────────────────────────────────────┐
│       FiveM Animation Converter         │
│  [ Drag an FBX here ]                   │
│  File: dance.fbx                        │
│  Animation Name: [ my_dance          ]  │
│  Target: [ GTA V Ped ▼ ]   FPS: [ 30 ]  │
│  ☑ Automatic Bone Mapping               │
│  ☑ Retarget Animation                   │
│  ☑ Optimize Keyframes                   │
│  ☑ Generate FiveM Resource              │
│           [ CONVERT ]                   │
│  Progress: ███████████░░ 82%            │
│  ✓ Animation converted successfully     │
│  [ Open Output Folder ]                 │
└─────────────────────────────────────────┘
```

Before converting, the mapping table appears so you can see exactly what was
recognised:

```
OK  mixamorig:Hips        ->  SKEL_Pelvis
OK  mixamorig:Spine       ->  SKEL_Spine0
??  Bone_07               ->  SKEL_L_Forearm      (fuzzy, 84%)
--  (none)                ->  SKEL_R_Finger21
```

`??` and `--` rows sort to the top and can be repointed at any source bone.
Essential bones must be mapped before the Convert button will proceed.

### Command line

```bat
python -m app.main convert dance.fbx --name my_dance --test-resource
```

| Option | Meaning |
| --- | --- |
| `--name` | animation/clip name (default: the file name) |
| `--fps` | target frame rate; stock GTA ped animations are **30** |
| `--root-motion inplace` | strip horizontal hip travel (dances, emotes) |
| `--no-align` | disable A-pose/T-pose rest alignment |
| `--no-retarget` | the source rig is already built on the GTA V skeleton — skip rest correction and hip rescaling |
| `--no-optimize` | write every channel per-frame instead of collapsing constants |
| `--test-resource` | also generate the `/testanim` resource |
| `--debug` | print the full analysis/mapping/retarget/export report |
| `--keep-intermediates` | keep the temporary Blender JSON for inspection |

---

## Install the result on your server

```
resources/[animations]/my_dance/
```

```cfg
ensure my_dance
```

Play it — requesting the dictionary first is **mandatory**:

```lua
local dict, clip = 'my_dance', 'my_dance'

RequestAnimDict(dict)
while not HasAnimDictLoaded(dict) do Wait(0) end

TaskPlayAnim(PlayerPedId(), dict, clip, 8.0, -8.0, -1, 1, 0.0, false, false, false)
```

The animation **dictionary** name is the `.ycd` file name without its extension;
the **clip** name is the clip inside it. This tool sets both from the animation
name you typed, so they match.

### Test resource

`--test-resource` (or the GUI checkbox) also writes `my_dance_test/`:

```
/testanim              plays the converted clip
/testanim <clip>       plays another clip from the same dictionary
/testanim <dict> <clip>
/stopanim
```

---

## Supported inputs

`.fbx` (primary), plus `.dae` and `.bvh`.

Bone naming is handled by an alias + fuzzy matching system, verified by tests
against seven conventions:

| Convention | Detected as |
| --- | --- |
| Mixamo (`mixamorig:Hips`) | `mixamo` |
| Rokoko / Newton | `rokoko` |
| Unreal Engine (`upperarm_l`) | `unreal` |
| Blender Rigify (`upper_arm.L`) | `rigify` |
| Unity / VRM humanoid | `rokoko` |
| 3ds Max Biped (`Bip01 L Hand`) | `generic` |
| GTA V native (`SKEL_L_UpperArm`) | `generic` |

Adding another convention means adding a JSON file to `mappings/` — no code
changes. Differing frame rates, proportions and A-pose/T-pose rest poses are all
handled (see *Retargeting* below).

---

## How it works

| Stage | Where | What |
| --- | --- | --- |
| Analyse | `blender_scripts/analyze.py` | import, find armature/action/fps/frames |
| Map | `app/mapping/bone_mapper.py` | source bone → canonical role → GTA bone |
| Retarget | `blender_scripts/convert.py` | compute parent-relative local transforms |
| Build XML | `app/exporter/ycd_xml.py` | Clip Dictionary XML |
| Compile | `sidecar/CodeWalkerBridge` | XML → binary `.ycd` |
| Package | `app/exporter/resource.py` | `fxmanifest.lua`, `stream/`, README |

### Retargeting

The retarget is computed numerically rather than with Blender constraints and a
bake pass, because the value a `.ycd` needs — each bone's local transform
relative to its parent — is exactly what the computation produces directly.

* **Rotation** transfers through the rest correspondence, so differing bone-axis
  conventions between rigs cancel out.
* **A-pose vs T-pose** is corrected by aligning each bone's rest *direction*
  (measured joint-to-joint, so it is convention-independent) before transfer.
  Identical rest poses make this a no-op. Disable with `--no-align`.
* **Proportions** are handled by scaling hip translation by the ratio of hip
  heights, so a short source rig does not make a tall ped bob.
* **Frame rate** conversion is a true resample — Blender is evaluated *between*
  source keyframes, not snapped to the nearest one.

There is a test for each of these claims (`tests/test_end_to_end.py`), including
the one that matters most: with a source rig in its rest pose, the retarget must
reproduce the target's rest pose to within 1e-5.

### Keyframe optimisation

Channels that never change collapse to a single static value
(`StaticVector3` / `StaticQuaternion` / `StaticFloat`); only components that
genuinely move become per-frame `RawFloat` channels. In the bundled test fixture
that is 7 animated channels out of 50 tracks. `RawFloat` is uncompressed 32-bit
float, so the conversion is lossless — no quantisation drift.

---

## Development

```bash
python tests/make_fixtures.py     # generate a real FBX + skeleton fixture
python -m pytest tests/ -q        # 70 tests
```

The fixtures are generated by Blender itself: a genuine FBX with a Mixamo-named
rig and a skeleton XML in CodeWalker's format using the real ped bone names and
tags but **synthetic rest transforms** (so no game data is committed).

```
fivem-animation-converter/
├── app/
│   ├── main.py            GUI + CLI entry point
│   ├── gui/               PySide6 window, mapping review dialog
│   ├── converter/         pipeline orchestration, skeleton profiles
│   ├── blender/           Blender discovery + headless runner
│   ├── mapping/           bone mapping engine
│   ├── exporter/          Clip Dictionary XML, sidecar client, resource writer
│   └── utils/             config, logging, typed errors
├── blender_scripts/       run *inside* Blender: analyze.py, convert.py, lib_gta.py
├── mappings/              gta5_ped.json + one alias table per rig convention
├── docs/                  ANIMATION_PIPELINE.md, SKELETON_SETUP.md, TROUBLESHOOTING.md
├── tests/                 unit + end-to-end, with generated fixtures
├── logs/                  conversion_<date>_<time>.log
└── output/                generated resources
```

The retargeting code lives in `blender_scripts/` rather than an `app/retarget/`
package because it must execute inside Blender's interpreter, where `bpy` and
`mathutils` exist.

---

## Logging and debugging

Every run writes `logs/conversion_<date>_<time>.log` containing the converter's
trace *and* Blender's complete console output.

**Debug Mode** additionally reports:

```
=== FBX ANALYSIS ===
File: dance.fbx
FPS: 24.0
Frames: 2-26
Bones: 22

=== DETECTED SKELETON ===
Type: Mixamo
Target: GTA V Ped (mp_m_freemode_01.yft)

=== BONE MAPPING ===
mixamorig:Hips -> SKEL_Pelvis [OK] (profile:mixamo)
...

=== RETARGET ===
align_rest_pose: True
hip_scale_factor: 1.111
Status: SUCCESS

=== EXPORT ===
Target: GTA V
Format: YCD
Status: SUCCESS
```

---

## Licensing and third-party components

The only external component is **`CodeWalker.Core`** (MIT), consumed as a NuGet
package by the sidecar that this repository already uses for `.ydd`/`.ytd`
work. No Rockstar file, and no proprietary or non-redistributable data, is
included in this repository. See [`../sidecar/NOTICE.md`](../sidecar/NOTICE.md).

The GTA V skeleton you supply comes from your own installation and stays on your
machine.

---

## Troubleshooting

See [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md).
