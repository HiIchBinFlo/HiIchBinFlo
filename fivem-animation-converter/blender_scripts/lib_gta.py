"""Shared helpers for the scripts that run inside Blender.

Imported by ``analyze.py`` and ``convert.py``. Keep this module free of anything
outside Blender's bundled Python (``bpy``, ``mathutils``, stdlib).

Note on quaternion order: ``mathutils.Quaternion`` is **(w, x, y, z)**, while
CodeWalker XML writes **x, y, z, w**. Every conversion goes through
:func:`quat_to_xyzw` / :func:`quat_from_xyzw` so the ordering is never done by
hand at the call site.
"""

from __future__ import annotations

import json
import math
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector


# --------------------------------------------------------------------- basics


def quat_to_xyzw(q: Quaternion) -> tuple[float, float, float, float]:
    return (q.x, q.y, q.z, q.w)


def quat_from_xyzw(x: float, y: float, z: float, w: float) -> Quaternion:
    return Quaternion((w, x, y, z))


def parse_argv() -> dict:
    """Read the ``--key value`` arguments that follow Blender's ``--`` marker."""
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    out: dict[str, str] = {}
    i = 0
    while i < len(argv):
        token = argv[i]
        if token.startswith("--"):
            key = token[2:]
            if i + 1 < len(argv) and not argv[i + 1].startswith("--"):
                out[key] = argv[i + 1]
                i += 2
            else:
                out[key] = "1"
                i += 1
        else:
            i += 1
    return out


def write_json(path: str, payload: dict) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


# ------------------------------------------------------------------ FBX import


def import_source(path: str) -> None:
    """Import an FBX / DAE / BVH into the current empty scene.

    ``automatic_bone_orientation`` is deliberately on: it makes Blender derive
    bone axes from the hierarchy instead of trusting the FBX's own (frequently
    arbitrary) axis convention, which keeps the anatomical bone directions this
    module relies on meaningful.
    """
    lower = path.lower()
    if lower.endswith(".fbx"):
        bpy.ops.import_scene.fbx(
            filepath=path,
            use_anim=True,
            automatic_bone_orientation=True,
            ignore_leaf_bones=False,
        )
    elif lower.endswith(".dae"):
        bpy.ops.wm.collada_import(filepath=path)
    elif lower.endswith(".bvh"):
        bpy.ops.import_anim.bvh(filepath=path, update_scene_fps=False)
    else:
        raise RuntimeError(f"Unsupported input format: {path}")


def find_armature():
    """Return the armature carrying the most bones, or ``None``."""
    armatures = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if not armatures:
        return None
    return max(armatures, key=lambda o: len(o.data.bones))


def find_action(armature):
    if armature.animation_data and armature.animation_data.action:
        return armature.animation_data.action
    # Some importers leave the action unassigned; fall back to the only one.
    actions = list(bpy.data.actions)
    if len(actions) == 1:
        return actions[0]
    return None


def action_frame_range(action) -> tuple[int, int]:
    start, end = action.frame_range
    return int(math.floor(start)), int(math.ceil(end))


def iter_fcurves(action) -> list:
    """Every F-curve of an action, across Blender versions.

    Blender 4.4 introduced slotted actions and 5.0 removed the flat
    ``Action.fcurves`` collection, moving the curves into
    ``layers -> strips -> channelbags``. Supporting both keeps the converter
    working on the 4.x installs most GTA modders still run as well as on 5.x.
    """
    flat = getattr(action, "fcurves", None)
    if flat is not None:
        return list(flat)

    curves: list = []
    for layer in getattr(action, "layers", []):
        for strip in getattr(layer, "strips", []):
            for bag in getattr(strip, "channelbags", []):
                curves.extend(bag.fcurves)
    return curves


# ---------------------------------------------------------- target rest layout


def build_rest_world(bones: list[dict]) -> dict[str, Matrix]:
    """Compose each GTA bone's rest matrix in armature space.

    The profile stores every bone's rest transform *relative to its parent*
    (that is how the game skeleton is defined), so the armature-space rest pose
    is the running product down the hierarchy.
    """
    by_index = {b["index"]: b for b in bones}
    world: dict[str, Matrix] = {}

    def resolve(bone: dict) -> Matrix:
        name = bone["name"]
        cached = world.get(name)
        if cached is not None:
            return cached
        tx, ty, tz = bone["translation"]
        rx, ry, rz, rw = bone["rotation"]
        sx, sy, sz = bone.get("scale", (1.0, 1.0, 1.0))
        local = Matrix.LocRotScale(
            Vector((tx, ty, tz)),
            quat_from_xyzw(rx, ry, rz, rw),
            Vector((sx, sy, sz)),
        )
        parent_index = bone["parent_index"]
        if parent_index is not None and parent_index >= 0 and parent_index in by_index:
            matrix = resolve(by_index[parent_index]) @ local
        else:
            matrix = local
        world[name] = matrix
        return matrix

    for bone in bones:
        resolve(bone)
    return world


def child_map(bones: list[dict]) -> dict[str, list[str]]:
    by_index = {b["index"]: b for b in bones}
    children: dict[str, list[str]] = {b["name"]: [] for b in bones}
    for bone in bones:
        parent_index = bone["parent_index"]
        parent = by_index.get(parent_index) if parent_index is not None else None
        if parent is not None:
            children[parent["name"]].append(bone["name"])
    return children


# ------------------------------------------------------------------ retargeting


def anatomical_direction(head: Vector, child_heads: list[Vector]) -> Vector | None:
    """Direction from a joint toward its children, in armature space.

    Using the vector to the child rather than a bone's own local axis keeps this
    independent of each rig's axis convention, which is the whole point: Mixamo,
    Unreal and the GTA skeleton all orient their bone axes differently, but they
    all agree on where the elbow is relative to the shoulder.
    """
    if not child_heads:
        return None
    average = Vector((0.0, 0.0, 0.0))
    for position in child_heads:
        average += position - head
    if average.length < 1e-6:
        return None
    return average.normalized()


def minimal_rotation(source: Vector, target: Vector) -> Quaternion:
    """Shortest rotation taking ``source`` onto ``target``."""
    a, b = source.normalized(), target.normalized()
    dot = max(-1.0, min(1.0, a.dot(b)))
    if dot > 1.0 - 1e-9:
        return Quaternion((1.0, 0.0, 0.0, 0.0))
    if dot < -1.0 + 1e-9:
        axis = a.orthogonal().normalized()
        return Quaternion(axis, math.pi)
    axis = a.cross(b).normalized()
    return Quaternion(axis, math.acos(dot))
