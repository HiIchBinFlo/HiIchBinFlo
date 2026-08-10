"""Skeleton profile parsing and FiveM resource generation."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.converter.skeleton import (  # noqa: E402
    check_profile,
    load_any,
    parse_skeleton_xml,
)
from app.exporter.resource import generate_resource  # noqa: E402
from app.utils.errors import SkeletonProfileError  # noqa: E402

FIXTURE = ROOT / "tests" / "fixtures" / "synthetic_ped.yft.xml"

pytestmark = pytest.mark.skipif(
    not FIXTURE.is_file(),
    reason="run `python tests/make_fixtures.py` first (needs Blender or the bpy module)",
)


# -------------------------------------------------------------------- skeleton


def test_parses_codewalker_skeleton_xml():
    profile = parse_skeleton_xml(FIXTURE)
    assert len(profile.bones) == 25

    pelvis = profile.by_name("SKEL_Pelvis")
    assert pelvis is not None
    assert pelvis.tag == 11816
    assert len(pelvis.rotation) == 4
    assert len(pelvis.translation) == 3

    root = profile.by_name("SKEL_ROOT")
    assert root.parent_index == -1
    assert profile.parent_of(root) is None
    assert profile.parent_of(pelvis).name == "SKEL_ROOT"


def test_tags_match_the_reference_table():
    """The shipped table and a real skeleton must agree on bone tags."""
    profile = parse_skeleton_xml(FIXTURE)
    reference = json.loads((ROOT / "mappings" / "gta5_ped.json").read_text())
    check = check_profile(
        profile, reference["bones"], set(reference["core_roles"])
    )
    assert check.tag_mismatches == []
    assert check.absent == []
    assert check.usable


def test_round_trips_through_json(tmp_path):
    profile = parse_skeleton_xml(FIXTURE)
    path = tmp_path / "profile.json"
    profile.save(path)

    reloaded = load_any(path)
    assert len(reloaded.bones) == len(profile.bones)
    original = profile.by_name("SKEL_L_UpperArm")
    copy = reloaded.by_name("SKEL_L_UpperArm")
    assert copy.tag == original.tag
    assert copy.translation == pytest.approx(original.translation)
    assert copy.rotation == pytest.approx(original.rotation)


def test_missing_file_is_reported_clearly(tmp_path):
    with pytest.raises(SkeletonProfileError):
        load_any(tmp_path / "nope.xml")


def test_xml_without_a_skeleton_is_refused(tmp_path):
    path = tmp_path / "empty.xml"
    path.write_text("<Fragment><Drawable /></Fragment>", encoding="utf-8")
    with pytest.raises(SkeletonProfileError, match="No skeleton"):
        parse_skeleton_xml(path)


def test_unsupported_extension_is_refused(tmp_path):
    path = tmp_path / "skeleton.txt"
    path.write_text("nope", encoding="utf-8")
    with pytest.raises(SkeletonProfileError, match="Unsupported"):
        load_any(path)


def test_check_profile_reports_a_tag_mismatch_instead_of_hiding_it():
    profile = parse_skeleton_xml(FIXTURE)
    profile.by_name("SKEL_Head").tag = 12345
    reference = json.loads((ROOT / "mappings" / "gta5_ped.json").read_text())
    check = check_profile(profile, reference["bones"], set(reference["core_roles"]))
    assert ("SKEL_Head", 31086, 12345) in check.tag_mismatches


# -------------------------------------------------------------------- resource


def _generate(tmp_path, **kwargs):
    defaults = dict(
        output_dir=tmp_path, name="my_dance", clip="my_dance",
        ycd_path=None, ycd_xml_path=None,
        frame_count=31, fps=30.0, duration=1.0, bone_count=25,
        skeleton="GTA V Ped (test)", source_file="dance.fbx",
    )
    defaults.update(kwargs)
    return generate_resource(**defaults)


def test_resource_layout(tmp_path):
    result = _generate(tmp_path)
    assert (tmp_path / "my_dance" / "fxmanifest.lua").is_file()
    assert (tmp_path / "my_dance" / "README.md").is_file()
    assert (tmp_path / "my_dance" / "stream").is_dir()

    manifest = result.manifest.read_text()
    assert "fx_version 'cerulean'" in manifest
    assert "game 'gta5'" in manifest
    assert "'stream/my_dance.ycd'" in manifest


def test_ycd_is_installed_into_stream(tmp_path):
    fake = tmp_path / "built.ycd"
    fake.write_bytes(b"RSC7fake")
    result = _generate(tmp_path, ycd_path=fake)
    assert result.ycd == tmp_path / "my_dance" / "stream" / "my_dance.ycd"
    assert result.ycd.read_bytes() == b"RSC7fake"


def test_test_resource_provides_testanim(tmp_path):
    fake = tmp_path / "built.ycd"
    fake.write_bytes(b"RSC7fake")
    result = _generate(tmp_path, ycd_path=fake, with_test_resource=True)

    assert result.test_root == tmp_path / "my_dance_test"
    client = (result.test_root / "client.lua").read_text()
    assert "RegisterCommand('testanim'" in client
    assert "RequestAnimDict(dict)" in client
    assert "HasAnimDictLoaded(dict)" in client
    assert "TaskPlayAnim(" in client
    # The dictionary is the .ycd file name; the clip is the clip name.
    assert "local DEFAULT_DICT = 'my_dance'" in client
    assert "local DEFAULT_CLIP = 'my_dance'" in client
    assert (result.test_root / "stream" / "my_dance.ycd").is_file()


def test_readme_documents_the_dict_and_clip(tmp_path):
    result = _generate(tmp_path)
    readme = result.readme.read_text()
    assert "RequestAnimDict" in readme
    assert "my_dance" in readme
    assert "30 fps" in readme or "30" in readme
