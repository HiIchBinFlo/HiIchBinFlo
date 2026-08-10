"""Stage 2: retarget the source animation onto the GTA V ped skeleton.

Run by the converter as::

    blender --background --python convert.py -- \
        --input dance.fbx --skeleton profile.json --mapping mapping.json \
        --output animation.json --fps 30

The retarget is computed **numerically** rather than with Blender constraints and
a bake pass. Two reasons:

* the output we need is each bone's parent-relative local transform, which is
  exactly what this computation produces directly - a constraint/bake round trip
  would only convert it into pose-space deltas that we would then have to
  convert back (see docs/ANIMATION_PIPELINE.md section 3.1);
* it is deterministic and inspectable. There is no dependency on constraint
  evaluation order, dependency-graph timing, or bake settings.

Blender is still doing the part only Blender can do: importing the FBX and
evaluating the source rig's pose at any point in time.
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Matrix, Quaternion, Vector  # noqa: E402

import lib_gta  # noqa: E402

TRACK_POSITION = 0
TRACK_ROTATION = 1


def topological_order(bones: list[dict]) -> list[dict]:
    """Parents before children, whatever order the profile happens to be in."""
    by_index = {b["index"]: b for b in bones}
    ordered: list[dict] = []
    seen: set[int] = set()

    def visit(bone: dict) -> None:
        if bone["index"] in seen:
            return
        parent = by_index.get(bone["parent_index"])
        if parent is not None:
            visit(parent)
        seen.add(bone["index"])
        ordered.append(bone)

    for bone in bones:
        visit(bone)
    return ordered


def mapped_descendants(name: str, children: dict[str, list[str]],
                       mapping: dict[str, str]) -> list[str]:
    """Nearest mapped bones below ``name``, descending through unmapped ones.

    A rig that has no equivalent of ``SKEL_Spine3`` still has something below it,
    and that something is what defines the segment's direction.
    """
    found: list[str] = []
    for child in children.get(name, []):
        if child in mapping:
            found.append(child)
        else:
            found.extend(mapped_descendants(child, children, mapping))
    return found


def main() -> int:
    args = lib_gta.parse_argv()
    source_path = args.get("input")
    skeleton_path = args.get("skeleton")
    mapping_path = args.get("mapping")
    output_path = args.get("output")
    if not all([source_path, skeleton_path, mapping_path, output_path]):
        print("ERROR: --input, --skeleton, --mapping and --output are required",
              file=sys.stderr)
        return 2

    target_fps = float(args.get("fps", 30))
    root_motion = args.get("root-motion", "keep")     # keep | inplace
    align_rest = args.get("align-rest", "1") != "0"
    include_position = args.get("static-position", "1") != "0"
    # Off when the source rig is already built on the GTA V skeleton (e.g. it
    # came back out of Sollumz), where rescaling hip travel would be wrong.
    hip_scale = args.get("hip-scale", "1") != "0"

    with open(skeleton_path, encoding="utf-8") as handle:
        profile = json.load(handle)
    with open(mapping_path, encoding="utf-8") as handle:
        mapping_doc = json.load(handle)

    # target bone name -> source bone name
    mapping: dict[str, str] = {
        row["target"]: row["source"]
        for row in mapping_doc["mappings"]
        if row.get("source")
    }
    if not mapping:
        print("ERROR: the mapping contains no usable bone pairs", file=sys.stderr)
        return 3

    # ---------------------------------------------------------------- import

    lib_gta.reset_scene()
    lib_gta.import_source(source_path)
    armature = lib_gta.find_armature()
    if armature is None:
        print("ERROR: no armature in the source file", file=sys.stderr)
        return 4
    action = lib_gta.find_action(armature)
    if action is None:
        print("ERROR: no animation in the source file", file=sys.stderr)
        return 5
    if armature.animation_data is None:
        armature.animation_data_create()
    armature.animation_data.action = action

    scene = bpy.context.scene
    source_fps = scene.render.fps / max(1, scene.render.fps_base)
    frame_start, frame_end = lib_gta.action_frame_range(action)

    # ------------------------------------------------------------ target rest

    bones = profile["bones"]
    rest_world = lib_gta.build_rest_world(bones)
    children = lib_gta.child_map(bones)
    by_name = {b["name"]: b for b in bones}
    by_index = {b["index"]: b for b in bones}
    ordered = topological_order(bones)

    def parent_of(bone: dict) -> dict | None:
        return by_index.get(bone["parent_index"])

    # Only emit bones that are mapped, or that sit between mapped bones - an
    # unmapped bone with mapped descendants still has to be written, because
    # everything below it is expressed relative to it.
    emit: list[dict] = []
    for bone in ordered:
        name = bone["name"]
        if name in mapping or mapped_descendants(name, children, mapping):
            emit.append(bone)
    emit_names = {b["name"] for b in emit}

    # ------------------------------------------------- source rest + alignment

    src_bones = armature.data.bones
    missing = [t for t, s in mapping.items() if s not in src_bones]
    if missing:
        print(f"ERROR: mapped source bones not present in the rig: {missing}",
              file=sys.stderr)
        return 6

    def source_rest_matrix(bone_name: str) -> Matrix:
        return src_bones[bone_name].matrix_local

    # Per-bone world-space alignment that makes the target's rest pose adopt the
    # source's rest pose *direction*. With both rigs in the same rest pose this
    # is the identity; it is what lets an A-pose source drive a T-pose target
    # without the limbs being offset by the difference for the whole clip.
    align: dict[str, Quaternion] = {}
    identity = Quaternion((1.0, 0.0, 0.0, 0.0))
    for bone in ordered:
        name = bone["name"]
        parent_bone = parent_of(bone)
        # Bones with no children of their own (hands, feet, the head) have no
        # direction to align, so they adopt their parent's correction.
        inherited = align.get(parent_bone["name"], identity) if parent_bone else identity

        if not align_rest or name not in mapping:
            align[name] = inherited
            continue

        targets = mapped_descendants(name, children, mapping)
        if not targets:
            align[name] = inherited
            continue

        target_dir = lib_gta.anatomical_direction(
            rest_world[name].translation,
            [rest_world[c].translation for c in targets],
        )
        source_dir = lib_gta.anatomical_direction(
            source_rest_matrix(mapping[name]).translation,
            [source_rest_matrix(mapping[c]).translation for c in targets],
        )
        if target_dir is None or source_dir is None:
            align[name] = inherited
            continue
        align[name] = lib_gta.minimal_rotation(target_dir, source_dir)

    # offset_T maps the source bone's world orientation into the target's frame.
    # Derivation: we want desired_world(T) == align(T) * rest_world(T) when the
    # source sits in its own rest pose, and the source's motion applied on top
    # of that otherwise.
    offsets: dict[str, Quaternion] = {}
    for target_name, source_name in mapping.items():
        if target_name not in emit_names:
            continue
        src_rest_rot = source_rest_matrix(source_name).to_quaternion()
        tgt_rest_rot = rest_world[target_name].to_quaternion()
        offsets[target_name] = (
            src_rest_rot.inverted() @ align.get(target_name, identity) @ tgt_rest_rot
        )

    # ------------------------------------------------------------ hip scaling

    hip_name = profile.get("hip_bone", "SKEL_Pelvis")
    if hip_name not in by_name:
        hip_name = next((b["name"] for b in bones if b["name"] in mapping), None)

    scale_factor = 1.0
    hip_source = mapping.get(hip_name) if hip_name else None
    if hip_source and hip_scale:
        target_height = rest_world[hip_name].translation.z
        source_height = source_rest_matrix(hip_source).translation.z
        if abs(source_height) > 1e-6 and abs(target_height) > 1e-6:
            scale_factor = target_height / source_height

    # ------------------------------------------------------------- resampling

    duration = (frame_end - frame_start) / source_fps if source_fps > 0 else 0.0
    frame_count = max(1, int(round(duration * target_fps)) + 1)

    tracks: dict[tuple[int, int], dict] = {}

    def track_for(bone: dict, track_id: int) -> dict:
        key = (bone["tag"], track_id)
        entry = tracks.get(key)
        if entry is None:
            entry = {
                "bone_name": bone["name"],
                "bone_tag": bone["tag"],
                "track": track_id,
                "frames": [],
            }
            tracks[key] = entry
        return entry

    depsgraph = bpy.context.evaluated_depsgraph_get()

    for index in range(frame_count):
        seconds = index / target_fps if target_fps > 0 else 0.0
        exact = frame_start + seconds * source_fps
        whole = int(exact)
        subframe = exact - whole
        # frame_set with a subframe is how Blender evaluates between keyframes,
        # which is what makes genuine frame-rate conversion possible rather than
        # nearest-frame duplication.
        scene.frame_set(whole, subframe=subframe)
        depsgraph.update()

        world_rot: dict[str, Quaternion] = {}

        for bone in emit:
            name = bone["name"]
            parent_bone = parent_of(bone)
            parent_rot = (
                world_rot.get(parent_bone["name"], identity)
                if parent_bone is not None
                else identity
            )

            rest_local = Matrix.LocRotScale(
                Vector(bone["translation"]),
                lib_gta.quat_from_xyzw(*bone["rotation"]),
                Vector(bone.get("scale", (1.0, 1.0, 1.0))),
            )

            if name in mapping:
                pose_bone = armature.pose.bones[mapping[name]]
                src_world_rot = pose_bone.matrix.to_quaternion()
                desired = src_world_rot @ offsets[name]
            else:
                desired = parent_rot @ rest_local.to_quaternion()

            world_rot[name] = desired
            local_rot = parent_rot.inverted() @ desired
            local_rot.normalize()
            track_for(bone, TRACK_ROTATION)["frames"].append(
                lib_gta.quat_to_xyzw(local_rot)
            )

            if name == hip_name and hip_source:
                pose_bone = armature.pose.bones[hip_source]
                delta = (
                    pose_bone.matrix.translation
                    - source_rest_matrix(hip_source).translation
                ) * scale_factor
                if root_motion == "inplace":
                    delta = Vector((0.0, 0.0, delta.z))
                translation = rest_local.translation + (parent_rot.inverted() @ delta)
                track_for(bone, TRACK_POSITION)["frames"].append(tuple(translation))
            elif include_position:
                # A constant translation channel costs one static value and
                # removes any doubt about a bone falling back to the origin.
                track_for(bone, TRACK_POSITION)["frames"].append(
                    tuple(rest_local.translation)
                )

    payload = {
        "ok": True,
        "frame_count": frame_count,
        "fps": target_fps,
        "duration": (frame_count - 1) / target_fps if target_fps > 0 else 0.0,
        "source": {
            "file": os.path.basename(source_path),
            "armature": armature.name,
            "action": action.name,
            "fps": source_fps,
            "frame_start": frame_start,
            "frame_end": frame_end,
        },
        "retarget": {
            "align_rest_pose": align_rest,
            "root_motion": root_motion,
            "hip_bone": hip_name,
            "hip_scale_factor": scale_factor,
            "mapped_bones": len(mapping),
            "emitted_bones": len(emit),
        },
        "tracks": [tracks[key] for key in sorted(tracks)],
    }

    lib_gta.write_json(output_path, payload)
    print(f"[convert] {frame_count} frames, {len(payload['tracks'])} tracks -> {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
