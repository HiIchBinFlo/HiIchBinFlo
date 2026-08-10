"""Stage 1: import the source file and report what is in it.

Run by the converter as::

    blender --background --python analyze.py -- --input dance.fbx --output analysis.json

Produces the JSON the GUI needs in order to show the FBX analysis and to compute
the bone mapping *before* anything is converted. Deliberately does no
retargeting: this stage must stay fast and must never fail for reasons the user
could have fixed by looking at the report.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import lib_gta  # noqa: E402


def main() -> int:
    args = lib_gta.parse_argv()
    source = args.get("input")
    output = args.get("output")
    if not source or not output:
        print("ERROR: --input and --output are required", file=sys.stderr)
        return 2

    lib_gta.reset_scene()
    lib_gta.import_source(source)

    armature = lib_gta.find_armature()
    if armature is None:
        lib_gta.write_json(output, {
            "ok": False,
            "error": "no_armature",
            "message": "No armature was found in the imported file.",
            "objects": [{"name": o.name, "type": o.type} for o in bpy.data.objects],
        })
        return 0

    action = lib_gta.find_action(armature)
    scene = bpy.context.scene

    bones = []
    for bone in armature.data.bones:
        bones.append({
            "name": bone.name,
            "parent": bone.parent.name if bone.parent else None,
            "head": list(bone.head_local),
            "tail": list(bone.tail_local),
            "length": bone.length,
        })

    payload = {
        "ok": True,
        "file": os.path.basename(source),
        "armature": armature.name,
        "bone_count": len(bones),
        "bones": bones,
        "fps": scene.render.fps / max(1, scene.render.fps_base),
        "scene_frame_start": scene.frame_start,
        "scene_frame_end": scene.frame_end,
        "armature_scale": list(armature.scale),
    }

    if action is None:
        payload["ok"] = False
        payload["error"] = "no_animation"
        payload["message"] = "The file contains an armature but no animation data."
    else:
        start, end = lib_gta.action_frame_range(action)
        curves = lib_gta.iter_fcurves(action)
        payload.update({
            "action": action.name,
            "frame_start": start,
            "frame_end": end,
            "frame_count": end - start + 1,
            "fcurve_count": len(curves),
        })
        # Which bones actually carry keyframes - useful in the debug report to
        # explain why a mapped bone still ends up static.
        animated = set()
        for curve in curves:
            path = curve.data_path
            if path.startswith('pose.bones["'):
                animated.add(path.split('"')[1])
        payload["animated_bones"] = sorted(animated)

    lib_gta.write_json(output, payload)
    print(f"[analyze] wrote {output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
