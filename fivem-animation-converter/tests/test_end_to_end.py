"""The whole pipeline, on a real FBX, through real Blender.

These are the tests that would catch a converter that only *looks* like it
works: they assert on the numbers that come out the far end, not merely that
files appeared.

Requires Blender - either an installed one or the ``bpy`` PyPI module - and the
fixtures from ``tests/make_fixtures.py``.
"""

from __future__ import annotations

import json
import math
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.blender.locator import find_blender  # noqa: E402
from app.converter.pipeline import ConversionOptions, convert  # noqa: E402
from app.converter.skeleton import load_any  # noqa: E402

FIXTURES = ROOT / "tests" / "fixtures"
FBX = FIXTURES / "mixamo_wave.fbx"
SKELETON = FIXTURES / "synthetic_ped.yft.xml"

pytestmark = pytest.mark.skipif(
    not (FBX.is_file() and SKELETON.is_file()) or find_blender() is None,
    reason="needs Blender and the generated fixtures (python tests/make_fixtures.py)",
)

SOURCE_FPS = 24
SOURCE_FRAMES = 25          # 1..25 inclusive
TARGET_FPS = 30


def run_stage(script: str, **kwargs) -> subprocess.CompletedProcess:
    args: list[str] = []
    for key, value in kwargs.items():
        args += [f"--{key.replace('_', '-')}", str(value)]
    return subprocess.run(
        [sys.executable, str(ROOT / "blender_scripts" / script), "--", *args],
        capture_output=True, text=True, timeout=900,
    )


@pytest.fixture(scope="module")
def analysis(tmp_path_factory):
    out = tmp_path_factory.mktemp("analyze") / "analysis.json"
    run_stage("analyze.py", input=FBX, output=out)
    assert out.is_file(), "analyze.py produced no output"
    return json.loads(out.read_text())


@pytest.fixture(scope="module")
def profile():
    return load_any(SKELETON)


@pytest.fixture(scope="module")
def retargeted(tmp_path_factory, analysis, profile):
    """Run the retarget once and reuse it: Blender startup is not cheap."""
    work = tmp_path_factory.mktemp("retarget")
    skeleton_json = work / "skeleton.json"
    profile.save(skeleton_json)

    from app.mapping.bone_mapper import load_mapper

    report = load_mapper(ROOT / "mappings").build([b["name"] for b in analysis["bones"]])
    rows = [
        {"source": m.source, "target": m.target, "tag": profile.by_name(m.target).tag}
        for m in report.mappings
        if m.source and profile.by_name(m.target)
    ]
    mapping_json = work / "mapping.json"
    mapping_json.write_text(json.dumps({"mappings": rows}))

    results = {}
    for label, align in (("aligned", 1), ("plain", 0)):
        out = work / f"animation_{label}.json"
        proc = run_stage(
            "convert.py",
            input=FBX, skeleton=skeleton_json, mapping=mapping_json,
            output=out, fps=TARGET_FPS, align_rest=align,
        )
        assert out.is_file(), f"convert.py ({label}) failed:\n{proc.stdout}\n{proc.stderr}"
        results[label] = json.loads(out.read_text())
    return results


# -------------------------------------------------------------------- analysis


def test_analysis_reads_the_real_rig(analysis):
    assert analysis["ok"] is True
    assert analysis["bone_count"] == 22
    assert analysis["fps"] == pytest.approx(SOURCE_FPS)
    assert analysis["frame_end"] - analysis["frame_start"] + 1 == SOURCE_FRAMES
    names = [b["name"] for b in analysis["bones"]]
    assert "mixamorig:Hips" in names
    assert "mixamorig:RightArm" in names


def test_analysis_reports_which_bones_are_keyed(analysis):
    assert "mixamorig:RightArm" in analysis["animated_bones"]


# ------------------------------------------------------------------- retarget


def test_frame_rate_conversion_is_a_resample_not_a_relabel(retargeted):
    """24 fps over 1.0 s becomes 30 fps over 1.0 s: 25 frames -> 31."""
    animation = retargeted["aligned"]
    expected_duration = (SOURCE_FRAMES - 1) / SOURCE_FPS          # 1.0 s
    assert animation["fps"] == TARGET_FPS
    assert animation["frame_count"] == round(expected_duration * TARGET_FPS) + 1 == 31
    assert animation["duration"] == pytest.approx(expected_duration, abs=1e-6)


def test_every_track_has_one_value_per_frame(retargeted):
    animation = retargeted["aligned"]
    for track in animation["tracks"]:
        assert len(track["frames"]) == animation["frame_count"], track["bone_name"]
        expected = 4 if track["track"] == 1 else 3
        assert all(len(f) == expected for f in track["frames"]), track["bone_name"]


def test_resampled_values_are_interpolated_not_duplicated(retargeted):
    """Resampling must evaluate between source keyframes, not snap to them.

    Frames 1-9 of the fixture are a continuous ramp, so every output frame in
    that window has to carry a distinct, monotonically advancing value. Sampling
    30 fps output by rounding to the nearest 24 fps source frame would instead
    repeat a value roughly every fifth frame.
    """
    animation = retargeted["aligned"]
    track = next(t for t in animation["tracks"]
                 if t["bone_name"] == "SKEL_R_UpperArm" and t["track"] == 1)
    ramp = [f[1] for f in track["frames"][:10]]

    assert len(set(round(y, 9) for y in ramp)) == len(ramp), \
        f"duplicated values inside the ramp: {ramp}"
    deltas = [b - a for a, b in zip(ramp, ramp[1:])]
    assert all(d > 0 for d in deltas) or all(d < 0 for d in deltas), \
        f"ramp is not monotonic: {ramp}"


def test_source_rest_pose_reproduces_the_target_rest_pose(retargeted, profile):
    """The invariant the whole retarget rests on.

    Frame 0 of the fixture has every keyed bone at its rest transform, so with
    rest alignment disabled the target must land exactly on *its* rest pose.
    Any error here means the pose-to-local conversion is wrong.
    """
    animation = retargeted["plain"]
    for track in animation["tracks"]:
        bone = profile.by_name(track["bone_name"])
        first = track["frames"][0]
        if track["track"] == 1:
            expected = bone.rotation
            # q and -q represent the same rotation.
            error = min(
                max(abs(a - b) for a, b in zip(first, expected)),
                max(abs(a + b) for a, b in zip(first, expected)),
            )
        else:
            expected = bone.translation
            error = max(abs(a - b) for a, b in zip(first, expected))
        assert error < 1e-5, f"{track['bone_name']} track {track['track']}: {error}"


def test_rotation_magnitudes_survive_the_retarget(retargeted, profile):
    """The fixture rotates the right arm 70 deg and the forearm 35 deg."""
    animation = retargeted["plain"]

    def max_angle_from_rest(bone_name: str) -> float:
        track = next(t for t in animation["tracks"]
                     if t["bone_name"] == bone_name and t["track"] == 1)
        rest = profile.by_name(bone_name).rotation
        rx, ry, rz, rw = rest
        angles = []
        for x, y, z, w in track["frames"]:
            # relative = conj(rest) * frame; angle = 2*acos(|w|)
            dw = rw * w + rx * x + ry * y + rz * z
            angles.append(math.degrees(2 * math.acos(min(1.0, abs(dw)))))
        return max(angles)

    assert max_angle_from_rest("SKEL_R_UpperArm") == pytest.approx(70.0, abs=0.5)
    assert max_angle_from_rest("SKEL_R_Forearm") == pytest.approx(35.0, abs=0.5)


def test_hip_translation_is_scaled_to_the_target_proportions(retargeted):
    """The rigs differ in height, so hip travel must be rescaled, not copied."""
    animation = retargeted["plain"]
    factor = animation["retarget"]["hip_scale_factor"]
    # Target pelvis sits at z=1.00, source hips at z=0.90.
    assert factor == pytest.approx(1.0 / 0.9, rel=1e-3)

    track = next(t for t in animation["tracks"]
                 if t["bone_name"] == "SKEL_Pelvis" and t["track"] == 0)
    # The fixture lifts the hips by 0.06 in source units.
    spread = [max(f[i] for f in track["frames"]) - min(f[i] for f in track["frames"])
              for i in range(3)]
    assert max(spread) == pytest.approx(0.06 * factor, abs=1e-3)


def test_unmapped_in_between_bones_are_still_emitted(retargeted):
    """Mixamo has no Spine3, but bones below it are expressed relative to it."""
    names = {t["bone_name"] for t in retargeted["plain"]["tracks"]}
    assert "SKEL_Spine3" in names
    assert "SKEL_Spine_Root" in names


# ------------------------------------------------------------------- full run


def test_full_conversion_produces_a_resource(tmp_path):
    options = ConversionOptions(
        source=FBX,
        name="My Test Dance",
        skeleton_profile=SKELETON,
        output_dir=tmp_path,
        fps=TARGET_FPS,
        generate_resource=True,
        generate_test_resource=True,
    )
    result = convert(options)

    assert result.ok
    assert result.name == "my_test_dance"
    assert result.clip == "my_test_dance"

    assert result.ycd_xml is not None and result.ycd_xml.is_file()
    root = ET.fromstring(result.ycd_xml.read_text())
    assert root.tag == "ClipDictionary"
    assert root.find("Clips/Item/Hash").text == "my_test_dance"
    assert root.find("Animations/Item/FrameCount").get("value") == "31"

    # BoneIds and SequenceData must stay parallel all the way through.
    animation = root.find("Animations/Item")
    assert len(animation.findall("BoneIds/Item")) == len(
        animation.findall("Sequences/Item/SequenceData/Item")
    )

    assert result.resource_dir is not None
    assert (result.resource_dir / "fxmanifest.lua").is_file()
    assert (result.resource_dir / "README.md").is_file()
    assert result.test_resource_dir is not None
    assert (result.test_resource_dir / "client.lua").is_file()

    assert result.log_path.is_file()
    assert result.log_path.stat().st_size > 0


def test_conversion_without_a_skeleton_is_refused(tmp_path):
    from app.utils.errors import SkeletonProfileError

    options = ConversionOptions(
        source=FBX, name="no_skeleton", skeleton_profile=None, output_dir=tmp_path
    )
    with pytest.raises(SkeletonProfileError):
        convert(options)


def test_missing_input_is_refused(tmp_path):
    from app.utils.errors import ConverterError

    options = ConversionOptions(
        source=tmp_path / "nope.fbx", name="x",
        skeleton_profile=SKELETON, output_dir=tmp_path,
    )
    with pytest.raises(ConverterError):
        convert(options)


def test_retarget_off_skips_hip_rescaling(tmp_path, profile):
    """Unchecking 'Retarget Animation' must actually change the maths."""
    from app.mapping.bone_mapper import load_mapper

    skeleton_json = tmp_path / "skeleton.json"
    profile.save(skeleton_json)

    analysis_out = tmp_path / "analysis.json"
    run_stage("analyze.py", input=FBX, output=analysis_out)
    bones = [b["name"] for b in json.loads(analysis_out.read_text())["bones"]]

    report = load_mapper(ROOT / "mappings").build(bones)
    rows = [
        {"source": m.source, "target": m.target, "tag": profile.by_name(m.target).tag}
        for m in report.mappings
        if m.source and profile.by_name(m.target)
    ]
    mapping_json = tmp_path / "mapping.json"
    mapping_json.write_text(json.dumps({"mappings": rows}))

    out = tmp_path / "no_retarget.json"
    run_stage(
        "convert.py",
        input=FBX, skeleton=skeleton_json, mapping=mapping_json,
        output=out, fps=TARGET_FPS, align_rest=0, hip_scale=0,
    )
    animation = json.loads(out.read_text())
    assert animation["retarget"]["hip_scale_factor"] == 1.0
