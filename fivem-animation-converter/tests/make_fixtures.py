"""Generate the test fixtures, using real Blender.

Produces two things in ``tests/fixtures``:

``synthetic_ped.yft.xml``
    A CodeWalker-format skeleton XML using the **real GTA V ped bone names and
    tags** but **synthetic rest transforms**. It is a stand-in for the skeleton a
    user extracts from their own game install, so that the pipeline can be tested
    end to end without redistributing any Rockstar data. It is *not* the real GTA
    V rest pose and must never be used to produce animations for actual use.

``mixamo_wave.fbx``
    A genuine FBX, exported by Blender, carrying a Mixamo-named rig with
    deliberately different proportions and a short animation.

Run with either a Blender install or the ``bpy`` PyPI module::

    python3 tests/make_fixtures.py
    blender --background --python tests/make_fixtures.py
"""

from __future__ import annotations

import math
import os
import sys

import bpy
from mathutils import Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES = os.path.join(HERE, "fixtures")

# (name, tag, parent, head position in metres) for a plausible 1.8 m humanoid.
# Tags are the real published ped tags; the positions are invented.
PED = [
    ("SKEL_ROOT",       0,     None,              (0.00, 0.00, 0.000)),
    ("SKEL_Pelvis",     11816, "SKEL_ROOT",       (0.00, 0.00, 1.000)),
    ("SKEL_Spine_Root", 57597, "SKEL_Pelvis",     (0.00, 0.00, 1.060)),
    ("SKEL_Spine0",     23553, "SKEL_Spine_Root", (0.00, 0.00, 1.120)),
    ("SKEL_Spine1",     24816, "SKEL_Spine0",     (0.00, 0.00, 1.220)),
    ("SKEL_Spine2",     24817, "SKEL_Spine1",     (0.00, 0.00, 1.320)),
    ("SKEL_Spine3",     24818, "SKEL_Spine2",     (0.00, 0.00, 1.420)),
    ("SKEL_Neck_1",     39317, "SKEL_Spine3",     (0.00, 0.00, 1.520)),
    ("SKEL_Head",       31086, "SKEL_Neck_1",     (0.00, 0.00, 1.620)),

    ("SKEL_L_Clavicle", 64729, "SKEL_Spine3",     (0.06, 0.00, 1.480)),
    ("SKEL_L_UpperArm", 45509, "SKEL_L_Clavicle", (0.18, 0.00, 1.470)),
    ("SKEL_L_Forearm",  61163, "SKEL_L_UpperArm", (0.46, 0.00, 1.470)),
    ("SKEL_L_Hand",     18905, "SKEL_L_Forearm",  (0.71, 0.00, 1.470)),

    ("SKEL_R_Clavicle", 10706, "SKEL_Spine3",     (-0.06, 0.00, 1.480)),
    ("SKEL_R_UpperArm", 40269, "SKEL_R_Clavicle", (-0.18, 0.00, 1.470)),
    ("SKEL_R_Forearm",  28252, "SKEL_R_UpperArm", (-0.46, 0.00, 1.470)),
    ("SKEL_R_Hand",     57005, "SKEL_R_Forearm",  (-0.71, 0.00, 1.470)),

    ("SKEL_L_Thigh",    58271, "SKEL_Pelvis",     (0.09, 0.00, 0.960)),
    ("SKEL_L_Calf",     63931, "SKEL_L_Thigh",    (0.09, 0.00, 0.530)),
    ("SKEL_L_Foot",     14201, "SKEL_L_Calf",     (0.09, 0.00, 0.100)),
    ("SKEL_L_Toe0",     2108,  "SKEL_L_Foot",     (0.09, 0.12, 0.030)),

    ("SKEL_R_Thigh",    51826, "SKEL_Pelvis",     (-0.09, 0.00, 0.960)),
    ("SKEL_R_Calf",     36864, "SKEL_R_Thigh",    (-0.09, 0.00, 0.530)),
    ("SKEL_R_Foot",     52301, "SKEL_R_Calf",     (-0.09, 0.00, 0.100)),
    ("SKEL_R_Toe0",     20781, "SKEL_R_Foot",     (-0.09, 0.12, 0.030)),
]

# Mixamo rig: same topology, different names, different proportions (a shorter,
# wider character) so the retarget has real work to do.
MIXAMO = [
    ("mixamorig:Hips",          None,                     (0.00, 0.00, 0.900)),
    ("mixamorig:Spine",         "mixamorig:Hips",         (0.00, 0.00, 1.000)),
    ("mixamorig:Spine1",        "mixamorig:Spine",        (0.00, 0.00, 1.100)),
    ("mixamorig:Spine2",        "mixamorig:Spine1",       (0.00, 0.00, 1.200)),
    ("mixamorig:Neck",          "mixamorig:Spine2",       (0.00, 0.00, 1.320)),
    ("mixamorig:Head",          "mixamorig:Neck",         (0.00, 0.00, 1.420)),

    ("mixamorig:LeftShoulder",  "mixamorig:Spine2",       (0.07, 0.00, 1.280)),
    ("mixamorig:LeftArm",       "mixamorig:LeftShoulder", (0.22, 0.00, 1.270)),
    ("mixamorig:LeftForeArm",   "mixamorig:LeftArm",      (0.55, 0.00, 1.270)),
    ("mixamorig:LeftHand",      "mixamorig:LeftForeArm",  (0.84, 0.00, 1.270)),

    ("mixamorig:RightShoulder", "mixamorig:Spine2",       (-0.07, 0.00, 1.280)),
    ("mixamorig:RightArm",      "mixamorig:RightShoulder", (-0.22, 0.00, 1.270)),
    ("mixamorig:RightForeArm",  "mixamorig:RightArm",     (-0.55, 0.00, 1.270)),
    ("mixamorig:RightHand",     "mixamorig:RightForeArm", (-0.84, 0.00, 1.270)),

    ("mixamorig:LeftUpLeg",     "mixamorig:Hips",         (0.11, 0.00, 0.870)),
    ("mixamorig:LeftLeg",       "mixamorig:LeftUpLeg",    (0.11, 0.00, 0.480)),
    ("mixamorig:LeftFoot",      "mixamorig:LeftLeg",      (0.11, 0.00, 0.090)),
    ("mixamorig:LeftToeBase",   "mixamorig:LeftFoot",     (0.11, 0.11, 0.025)),

    ("mixamorig:RightUpLeg",    "mixamorig:Hips",         (-0.11, 0.00, 0.870)),
    ("mixamorig:RightLeg",      "mixamorig:RightUpLeg",   (-0.11, 0.00, 0.480)),
    ("mixamorig:RightFoot",     "mixamorig:RightLeg",     (-0.11, 0.00, 0.090)),
    ("mixamorig:RightToeBase",  "mixamorig:RightFoot",    (-0.11, 0.11, 0.025)),
]


def build_armature(name: str, spec, tail_offset=(0.0, 0.0, 0.08)):
    """Create an armature from ``(bone, parent, head)`` triples."""
    heads = {row[0]: Vector(row[-1]) for row in spec}
    children: dict[str, list[str]] = {row[0]: [] for row in spec}
    for row in spec:
        parent = row[-2]
        if parent:
            children[parent].append(row[0])

    data = bpy.data.armatures.new(name)
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")

    for row in spec:
        bone_name, parent = row[0], row[-2]
        head = heads[bone_name]
        kids = children[bone_name]
        if kids:
            tail = sum((heads[k] for k in kids), Vector()) / len(kids)
            if (tail - head).length < 1e-4:
                tail = head + Vector(tail_offset)
        else:
            tail = head + Vector(tail_offset)
        edit = data.edit_bones.new(bone_name)
        edit.head = head
        edit.tail = tail
        if parent:
            edit.parent = data.edit_bones[parent]

    bpy.ops.object.mode_set(mode="OBJECT")
    return obj


def write_skeleton_xml(path: str) -> None:
    """Emit the synthetic skeleton in CodeWalker's .yft.xml layout."""
    obj = build_armature("SyntheticPed", PED)
    data = obj.data
    index_of = {row[0]: i for i, row in enumerate(PED)}

    lines = ['<?xml version="1.0" encoding="UTF-8"?>', "<Fragment>", "  <Drawable>",
             "    <Skeleton>", "      <Bones>"]
    for row in PED:
        name, tag, parent = row[0], row[1], row[2]
        bone = data.bones[name]
        local = bone.matrix_local
        if bone.parent is not None:
            local = bone.parent.matrix_local.inverted() @ local
        translation = local.to_translation()
        rotation = local.to_quaternion()
        scale = local.to_scale()
        lines += [
            "        <Item>",
            f"          <Name>{name}</Name>",
            f'          <Tag value="{tag}" />',
            f'          <Index value="{index_of[name]}" />',
            f'          <ParentIndex value="{index_of[parent] if parent else -1}" />',
            '          <SiblingIndex value="-1" />',
            "          <Flags />",
            f'          <Translation x="{translation.x:.6f}" y="{translation.y:.6f}" z="{translation.z:.6f}" />',
            f'          <Rotation x="{rotation.x:.6f}" y="{rotation.y:.6f}" z="{rotation.z:.6f}" w="{rotation.w:.6f}" />',
            f'          <Scale x="{scale.x:.6f}" y="{scale.y:.6f}" z="{scale.z:.6f}" />',
            '          <TransformUnk x="0" y="0" z="0" w="0" />',
            "        </Item>",
        ]
    lines += ["      </Bones>", "    </Skeleton>", "  </Drawable>", "</Fragment>", ""]

    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines))
    print(f"[fixtures] wrote {path} ({len(PED)} bones)")


def write_source_fbx(path: str) -> None:
    """Build the Mixamo-named rig, animate it, and export a real FBX."""
    obj = build_armature("MixamoRig", MIXAMO)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="POSE")

    scene = bpy.context.scene
    scene.render.fps = 24            # deliberately not 30, to exercise resampling
    scene.frame_start = 1
    scene.frame_end = 25

    for pose_bone in obj.pose.bones:
        pose_bone.rotation_mode = "QUATERNION"

    right_arm = obj.pose.bones["mixamorig:RightArm"]
    right_forearm = obj.pose.bones["mixamorig:RightForeArm"]
    hips = obj.pose.bones["mixamorig:Hips"]

    keys = [
        (1,  0.0,   0.0,  0.00),
        (9,  -70.0, 35.0, 0.06),
        (17, -70.0, -35.0, 0.06),
        (25, 0.0,   0.0,  0.00),
    ]
    for frame, arm_deg, fore_deg, hip_z in keys:
        scene.frame_set(frame)
        right_arm.rotation_quaternion = Quaternion(
            Vector((0.0, 1.0, 0.0)), math.radians(arm_deg)
        )
        right_forearm.rotation_quaternion = Quaternion(
            Vector((1.0, 0.0, 0.0)), math.radians(fore_deg)
        )
        hips.location = Vector((0.0, 0.0, hip_z))
        right_arm.keyframe_insert("rotation_quaternion", frame=frame)
        right_forearm.keyframe_insert("rotation_quaternion", frame=frame)
        hips.keyframe_insert("location", frame=frame)

    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.export_scene.fbx(
        filepath=path,
        use_selection=False,
        add_leaf_bones=False,
        bake_anim=True,
        bake_anim_use_all_bones=True,
        bake_anim_use_nla_strips=False,
        bake_anim_use_all_actions=False,
    )
    print(f"[fixtures] wrote {path}")


def main() -> int:
    os.makedirs(FIXTURES, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    write_skeleton_xml(os.path.join(FIXTURES, "synthetic_ped.yft.xml"))

    bpy.ops.wm.read_factory_settings(use_empty=True)
    write_source_fbx(os.path.join(FIXTURES, "mixamo_wave.fbx"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
