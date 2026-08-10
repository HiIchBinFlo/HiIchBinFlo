"""The Clip Dictionary XML writer.

The expectations here come from CodeWalker's own ``ReadXml`` methods
(``CodeWalker.Core/GameFiles/Resources/Clip.cs``), cited in
``docs/ANIMATION_PIPELINE.md`` - not from what happened to be produced.
"""

from __future__ import annotations

import math
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.exporter.ycd_xml import (  # noqa: E402
    TRACK_POSITION,
    TRACK_ROTATION,
    BoneTrack,
    ClipDictionaryBuilder,
    duration_for,
    jenkins_hash,
    sanitize_name,
    sequence_frame_limit,
)


def build(tracks, frames=10, fps=30, name="my_dance") -> str:
    return ClipDictionaryBuilder(
        clip_name=name, frame_count=frames, fps=fps, tracks=tracks
    ).build()


def static_rotation_track(tag=11816, frames=10):
    return BoneTrack(tag, TRACK_ROTATION, [(0.0, 0.0, 0.0, 1.0)] * frames)


def moving_rotation_track(tag=11816, frames=10):
    return BoneTrack(
        tag, TRACK_ROTATION,
        [(0.0, math.sin(i * 0.1), 0.0, math.cos(i * 0.1)) for i in range(frames)],
    )


# --------------------------------------------------------------------- values


@pytest.mark.parametrize(
    "frames,expected",
    [(221, 223), (17, 31), (151, 159), (201, 207)],
)
def test_sequence_frame_limit_matches_real_files(frames, expected):
    """Every sample recorded in CodeWalker's own read comments."""
    assert sequence_frame_limit(frames) == expected


def test_sequence_frame_limit_is_never_below_the_frame_count():
    for frames in range(1, 400):
        assert sequence_frame_limit(frames) >= frames


@pytest.mark.parametrize(
    "frames,expected",
    [(221, 7.33), (17, 0.53), (151, 5.0), (201, 6.67)],
)
def test_duration_matches_real_files(frames, expected):
    """Real 30 fps clips: Duration == (FrameCount - 1) / fps."""
    assert duration_for(frames, 30) == pytest.approx(expected, abs=0.01)


def test_duration_of_a_single_frame_is_zero():
    assert duration_for(1, 30) == 0.0


def test_sanitize_name():
    assert sanitize_name("My Dance!") == "my_dance"
    assert sanitize_name("  spaced  out  ") == "spaced_out"
    assert sanitize_name("123go") == "anim_123go"
    assert sanitize_name("!!!") == "animation"
    assert sanitize_name("already_ok") == "already_ok"


def test_jenkins_hash_is_case_insensitive_and_stable():
    assert jenkins_hash("my_dance") == jenkins_hash("MY_DANCE")
    # Jenkins one-at-a-time of the empty string is 0.
    assert jenkins_hash("") == 0
    assert 0 <= jenkins_hash("some_clip") <= 0xFFFFFFFF


# --------------------------------------------------------------------- schema


def test_document_shape():
    xml = build([static_rotation_track()])
    root = ET.fromstring(xml)
    assert root.tag == "ClipDictionary"
    assert root.find("Clips") is not None
    assert root.find("Animations") is not None

    clip = root.find("Clips/Item")
    assert clip.find("Type").get("value") == "Animation"
    assert clip.find("Hash").text == "my_dance"
    assert clip.find("AnimationHash").text == "my_dance"
    assert clip.find("StartTime").get("value") == "0"
    assert clip.find("Rate").get("value") == "1"
    # Tags and Properties must exist even when empty - ClipBase.ReadXml looks
    # for them.
    assert clip.find("Tags") is not None
    assert clip.find("Properties") is not None


def test_boneids_and_sequencedata_are_parallel():
    """SequenceData entry i describes BoneIds entry i. Lengths must match."""
    tracks = [
        BoneTrack(11816, TRACK_POSITION, [(0.0, 0.0, 1.0)] * 10),
        static_rotation_track(11816),
        moving_rotation_track(23553),
    ]
    root = ET.fromstring(build(tracks))
    animation = root.find("Animations/Item")
    bone_ids = animation.findall("BoneIds/Item")
    sequence_data = animation.findall("Sequences/Item/SequenceData/Item")
    assert len(bone_ids) == len(tracks) == len(sequence_data)

    assert [b.find("BoneId").get("value") for b in bone_ids] == ["11816", "11816", "23553"]
    assert [b.find("Track").get("value") for b in bone_ids] == ["0", "1", "1"]
    for entry in bone_ids:
        assert entry.find("Unk0") is not None


def test_animation_header_fields():
    root = ET.fromstring(build([static_rotation_track()], frames=31, fps=30))
    animation = root.find("Animations/Item")
    assert animation.find("FrameCount").get("value") == "31"
    assert animation.find("SequenceFrameLimit").get("value") == "31"
    assert animation.find("Unknown10").get("value") == "1"
    assert animation.find("Unknown1C").text == "hash_00000000"
    assert animation.find("Sequences/Item/FrameCount").get("value") == "31"


# ------------------------------------------------------------------- channels


def test_constant_track_collapses_to_a_static_channel():
    root = ET.fromstring(build([static_rotation_track()]))
    channels = root.findall("Animations/Item/Sequences/Item/SequenceData/Item/Channels/Item")
    assert len(channels) == 1
    assert channels[0].find("Type").get("value") == "StaticQuaternion"


def test_constant_position_collapses_to_static_vector3():
    track = BoneTrack(11816, TRACK_POSITION, [(0.1, 0.2, 0.3)] * 10)
    root = ET.fromstring(build([track]))
    channels = root.findall("Animations/Item/Sequences/Item/SequenceData/Item/Channels/Item")
    assert len(channels) == 1
    assert channels[0].find("Type").get("value") == "StaticVector3"
    value = channels[0].find("Value")
    assert float(value.get("x")) == pytest.approx(0.1)
    assert float(value.get("z")) == pytest.approx(0.3)


def test_moving_track_becomes_one_channel_per_component():
    root = ET.fromstring(build([moving_rotation_track()], frames=10))
    channels = root.findall("Animations/Item/Sequences/Item/SequenceData/Item/Channels/Item")
    assert len(channels) == 4                     # x, y, z, w
    types = [c.find("Type").get("value") for c in channels]
    # x and z never change; y and w do.
    assert types == ["StaticFloat", "RawFloat", "StaticFloat", "RawFloat"]


def test_rawfloat_has_one_value_per_frame():
    frames = 17
    root = ET.fromstring(build([moving_rotation_track(frames=frames)], frames=frames))
    for channel in root.iter("Item"):
        type_node = channel.find("Type")
        if type_node is None or type_node.get("value") != "RawFloat":
            continue
        values = channel.find("Values").text.split()
        assert len(values) == frames


def test_static_quaternion_w_is_never_negative():
    """StaticQuaternion rebuilds W as sqrt(1-|xyz|^2), so W < 0 cannot survive.

    Negating the quaternion is lossless - q and -q are the same rotation.
    """
    track = BoneTrack(11816, TRACK_ROTATION, [(0.5, 0.5, 0.5, -0.5)] * 8)
    root = ET.fromstring(build([track], frames=8))
    value = root.find(
        "Animations/Item/Sequences/Item/SequenceData/Item/Channels/Item/Value"
    )
    assert float(value.get("w")) >= 0
    assert float(value.get("x")) == pytest.approx(-0.5)


# ------------------------------------------------------------------ formatting


def test_no_scientific_notation_or_negative_zero():
    """Keeps the document trivially parseable by any float reader."""
    track = BoneTrack(
        11816, TRACK_ROTATION,
        [(1e-9 * i, -1e-12, 0.0, 1.0) for i in range(12)],
    )
    xml = build([track], frames=12)
    assert re.search(r"[0-9][eE][-+]?[0-9]", xml) is None
    assert re.search(r"(?<![0-9.])-0(?![0-9.])", xml) is None


def test_non_finite_values_are_refused():
    track = BoneTrack(11816, TRACK_POSITION, [(float("nan"), 0.0, 0.0)] * 4
                      + [(1.0, 0.0, 0.0)] * 4)
    with pytest.raises(ValueError, match="non-finite"):
        build([track], frames=8)


def test_empty_track_list_is_refused():
    with pytest.raises(ValueError, match="no animated tracks"):
        build([])


def test_clip_name_is_escaped_and_sanitised():
    xml = build([static_rotation_track()], name="Bad <name> & stuff")
    ET.fromstring(xml)                       # must stay well-formed
    assert "<Hash>bad_name_stuff</Hash>" in xml


def test_optimize_off_writes_every_component_as_rawfloat():
    """The 'Optimize Keyframes' switch must actually change the output."""
    tracks = [static_rotation_track(), BoneTrack(23553, TRACK_POSITION,
                                                [(0.1, 0.2, 0.3)] * 10)]
    optimized = ClipDictionaryBuilder(
        clip_name="c", frame_count=10, fps=30, tracks=tracks, optimize=True
    ).build()
    verbatim = ClipDictionaryBuilder(
        clip_name="c", frame_count=10, fps=30, tracks=tracks, optimize=False
    ).build()

    assert "StaticQuaternion" in optimized and "StaticVector3" in optimized
    assert "StaticQuaternion" not in verbatim and "StaticVector3" not in verbatim
    assert verbatim.count("RawFloat") == 7        # 4 quaternion + 3 position
    assert len(verbatim) > len(optimized)
    ET.fromstring(verbatim)
