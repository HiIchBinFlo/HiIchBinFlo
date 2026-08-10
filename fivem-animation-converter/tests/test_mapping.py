"""Bone mapping across the rig conventions people actually bring."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.mapping.bone_mapper import (  # noqa: E402
    AUTO,
    MISSING,
    load_mapper,
    normalize,
    strip_prefixes,
)

MIXAMO = [
    "mixamorig:Hips", "mixamorig:Spine", "mixamorig:Spine1", "mixamorig:Spine2",
    "mixamorig:Neck", "mixamorig:Head", "mixamorig:HeadTop_End",
    "mixamorig:LeftShoulder", "mixamorig:LeftArm", "mixamorig:LeftForeArm",
    "mixamorig:LeftHand", "mixamorig:RightShoulder", "mixamorig:RightArm",
    "mixamorig:RightForeArm", "mixamorig:RightHand",
    "mixamorig:LeftUpLeg", "mixamorig:LeftLeg", "mixamorig:LeftFoot",
    "mixamorig:LeftToeBase", "mixamorig:RightUpLeg", "mixamorig:RightLeg",
    "mixamorig:RightFoot", "mixamorig:RightToeBase",
]

UNREAL = [
    "root", "pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "head",
    "clavicle_l", "upperarm_l", "lowerarm_l", "hand_l",
    "clavicle_r", "upperarm_r", "lowerarm_r", "hand_r",
    "thigh_l", "calf_l", "foot_l", "ball_l",
    "thigh_r", "calf_r", "foot_r", "ball_r", "ik_hand_gun",
]

RIGIFY = [
    "spine", "spine.001", "spine.002", "spine.003", "spine.004", "spine.005",
    "shoulder.L", "upper_arm.L", "forearm.L", "hand.L",
    "shoulder.R", "upper_arm.R", "forearm.R", "hand.R",
    "thigh.L", "shin.L", "foot.L", "toe.L",
    "thigh.R", "shin.R", "foot.R", "toe.R",
]

ROKOKO = [
    "Hips", "Spine", "Chest", "Neck", "Head",
    "LeftShoulder", "LeftUpperArm", "LeftLowerArm", "LeftHand",
    "RightShoulder", "RightUpperArm", "RightLowerArm", "RightHand",
    "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToe",
    "RightUpLeg", "RightLeg", "RightFoot", "RightToe",
]

GTA_NATIVE = [
    "SKEL_Pelvis", "SKEL_Spine0", "SKEL_Spine1", "SKEL_Spine2", "SKEL_Spine3",
    "SKEL_Neck_1", "SKEL_Head",
    "SKEL_L_Clavicle", "SKEL_L_UpperArm", "SKEL_L_Forearm", "SKEL_L_Hand",
    "SKEL_R_Clavicle", "SKEL_R_UpperArm", "SKEL_R_Forearm", "SKEL_R_Hand",
    "SKEL_L_Thigh", "SKEL_L_Calf", "SKEL_L_Foot",
    "SKEL_R_Thigh", "SKEL_R_Calf", "SKEL_R_Foot",
]

BIPED = [
    "Bip01", "Bip01 Pelvis", "Bip01 Spine", "Bip01 Spine1", "Bip01 Neck",
    "Bip01 Head",
    "Bip01 L Clavicle", "Bip01 L UpperArm", "Bip01 L Forearm", "Bip01 L Hand",
    "Bip01 R Clavicle", "Bip01 R UpperArm", "Bip01 R Forearm", "Bip01 R Hand",
    "Bip01 L Thigh", "Bip01 L Calf", "Bip01 L Foot",
    "Bip01 R Thigh", "Bip01 R Calf", "Bip01 R Foot",
]

UNITY = [
    "Hips", "Spine", "Chest", "UpperChest", "Neck", "Head",
    "LeftShoulder", "LeftUpperArm", "LeftLowerArm", "LeftHand",
    "RightShoulder", "RightUpperArm", "RightLowerArm", "RightHand",
    "LeftUpperLeg", "LeftLowerLeg", "LeftFoot", "LeftToes",
    "RightUpperLeg", "RightLowerLeg", "RightFoot", "RightToes",
]


@pytest.fixture(scope="module")
def mapper():
    return load_mapper(ROOT / "mappings")


@pytest.mark.parametrize(
    "label,bones",
    [
        ("mixamo", MIXAMO), ("unreal", UNREAL), ("rigify", RIGIFY),
        ("rokoko", ROKOKO), ("gta", GTA_NATIVE), ("biped", BIPED),
        ("unity", UNITY),
    ],
)
def test_every_convention_maps_all_core_bones(mapper, label, bones):
    """No rig convention may leave an essential bone unmapped."""
    report = mapper.build(bones)
    missing = [m.target for m in report.mappings
               if m.confidence == MISSING and m.is_core]
    assert missing == [], f"{label}: unmapped essential bones {missing}"


@pytest.mark.parametrize(
    "label,bones",
    [
        ("mixamo", MIXAMO), ("unreal", UNREAL), ("rigify", RIGIFY),
        ("rokoko", ROKOKO), ("gta", GTA_NATIVE), ("unity", UNITY),
    ],
)
def test_no_fuzzy_guessing_for_known_conventions(mapper, label, bones):
    """A convention we claim to support must match exactly, not approximately."""
    report = mapper.build(bones)
    uncertain = [(m.source, m.target) for m in report.mappings
                 if m.confidence == "uncertain"]
    assert uncertain == [], f"{label}: fell back to fuzzy matching for {uncertain}"


def test_mixamo_reference_pairs(mapper):
    """The exact pairs quoted in the specification."""
    report = mapper.build(MIXAMO)
    got = {m.source: m.target for m in report.mappings if m.source}
    expected = {
        "mixamorig:Hips": "SKEL_Pelvis",
        "mixamorig:Spine": "SKEL_Spine0",
        "mixamorig:Spine1": "SKEL_Spine1",
        "mixamorig:Spine2": "SKEL_Spine2",
        "mixamorig:Neck": "SKEL_Neck_1",
        "mixamorig:Head": "SKEL_Head",
        "mixamorig:LeftArm": "SKEL_L_UpperArm",
        "mixamorig:LeftForeArm": "SKEL_L_Forearm",
    }
    for source, target in expected.items():
        assert got.get(source) == target, f"{source} -> {got.get(source)} != {target}"


def test_profile_detection(mapper):
    assert mapper.tables.detect_profile(MIXAMO)["id"] == "mixamo"
    assert mapper.tables.detect_profile(UNREAL)["id"] == "unreal"
    assert mapper.tables.detect_profile(RIGIFY)["id"] == "rigify"


def test_side_detection_is_not_fooled_by_leading_letters(mapper):
    """Regression: 'lowerarm_r' must not read as left because it starts with 'l'."""
    report = mapper.build(UNREAL)
    got = {m.source: m.target for m in report.mappings if m.source}
    assert got["lowerarm_l"] == "SKEL_L_Forearm"
    assert got["lowerarm_r"] == "SKEL_R_Forearm"


def test_embedded_side_token(mapper):
    """'SKEL_L_UpperArm' has its side in the middle, not at an edge."""
    report = mapper.build(GTA_NATIVE)
    got = {m.source: m.target for m in report.mappings if m.source}
    assert got["SKEL_L_UpperArm"] == "SKEL_L_UpperArm"
    assert got["SKEL_R_UpperArm"] == "SKEL_R_UpperArm"


def test_ik_and_helper_bones_are_ignored_not_guessed(mapper):
    report = mapper.build(UNREAL)
    assert "ik_hand_gun" not in report.unmapped_sources
    assert "ik_hand_gun" in report.ignored_sources


def test_prefix_stripping_never_consumes_the_whole_name():
    """'Bip01' is itself a known prefix; stripping it would leave nothing."""
    assert strip_prefixes("Bip01", ["bip01"]) == "Bip01"
    assert strip_prefixes("Bip01 Pelvis", ["bip01"]) == " Pelvis"


def test_normalize():
    assert normalize("mixamorig:LeftForeArm") == "leftforearm"
    assert normalize("upper_arm.L") == "upperarml"
    assert normalize("Bip01 L Thigh") == "bip01lthigh"


def test_manual_override_marks_as_user_supplied(mapper):
    report = mapper.build(MIXAMO)
    mapper.apply_overrides(report, {"SKEL_Spine3": "mixamorig:Spine2"})
    row = next(m for m in report.mappings if m.target == "SKEL_Spine3")
    assert row.source == "mixamorig:Spine2"
    assert row.confidence == AUTO
    assert row.method == "user"


def test_override_can_clear_a_mapping(mapper):
    report = mapper.build(MIXAMO)
    mapper.apply_overrides(report, {"SKEL_Head": None})
    row = next(m for m in report.mappings if m.target == "SKEL_Head")
    assert row.source is None
    assert row.confidence == MISSING


def test_duplicate_claims_do_not_silently_overwrite(mapper):
    """Two source bones wanting the same role: one wins, the other is reported."""
    report = mapper.build(["Hips", "Pelvis", "Spine", "Spine1", "Neck", "Head"])
    pelvis = next(m for m in report.mappings if m.target == "SKEL_Pelvis")
    assert pelvis.source in ("Hips", "Pelvis")
    loser = "Pelvis" if pelvis.source == "Hips" else "Hips"
    assert loser in report.unmapped_sources
