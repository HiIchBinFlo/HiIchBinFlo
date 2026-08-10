"""Build a CodeWalker Clip Dictionary XML document.

This is the intermediate format of the pipeline. CodeWalker.Core turns the XML
produced here into a binary ``.ycd``; crucially it also performs all of the
channel bit-packing itself (``Sequence.BuildData``, reached via
``Animation.GetParts``), so this module only has to describe the animation, not
serialise it.

Every element name and every attribute here was taken from the corresponding
``ReadXml`` method in ``CodeWalker.Core/GameFiles/Resources/Clip.cs``. Nothing in
this file is invented. See ``docs/ANIMATION_PIPELINE.md`` for the citations.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from xml.sax.saxutils import escape

# Track ids, from Sollumz `tools/animationhelper.py` (`class Track`).
TRACK_POSITION = 0
TRACK_ROTATION = 1
TRACK_SCALE = 2

# Below this, two floats count as the same value and the channel becomes static.
STATIC_EPSILON = 1e-6


def jenkins_hash(text: str) -> int:
    """Rockstar's Jenkins one-at-a-time hash, over the lowercased name.

    CodeWalker computes this itself when it reads a plain string out of a
    ``<Hash>`` element, so the XML we emit does not need it. It is used for the
    debug report and for tests that want to predict a clip's hash.
    """
    h = 0
    for char in text.lower():
        h = (h + ord(char)) & 0xFFFFFFFF
        h = (h + (h << 10)) & 0xFFFFFFFF
        h ^= h >> 6
    h = (h + (h << 3)) & 0xFFFFFFFF
    h ^= h >> 11
    h = (h + (h << 15)) & 0xFFFFFFFF
    return h


def sanitize_name(name: str) -> str:
    """Turn free user input into a safe clip / dictionary / file name."""
    cleaned = re.sub(r"[^0-9a-zA-Z_]+", "_", name.strip().lower()).strip("_")
    cleaned = re.sub(r"_+", "_", cleaned)
    if not cleaned:
        cleaned = "animation"
    if cleaned[0].isdigit():
        cleaned = f"anim_{cleaned}"
    return cleaned


def sequence_frame_limit(frame_count: int) -> int:
    """Frames a single sequence may hold.

    Real files round the frame count up to a multiple of 16 and subtract one.
    Checked against every sample recorded in CodeWalker's own read comments
    (``Clip.cs`` ~line 2410): 221 -> 223, 17 -> 31, 151 -> 159, 201 -> 207.

    The rounding is applied to ``frame_count + 1`` rather than ``frame_count``.
    That reproduces all four samples identically, and it keeps the result at or
    above the frame count for exact multiples of 16, which the naive form does
    not: 16 frames would otherwise yield a limit of 15, and
    ``Animation.EvaluateVector4`` selects a sequence with
    ``Frame0 / SequenceFrameLimit`` - so frame 15 would index sequence 1 when
    only sequence 0 exists.
    """
    if frame_count <= 0:
        return 15
    return int(math.ceil((frame_count + 1) / 16.0) * 16) - 1


def duration_for(frame_count: int, fps: float) -> float:
    """Clip length in seconds.

    ``Animation.GetFramePosition`` maps ``t = Duration`` onto the *last* frame by
    dividing by ``Frames - 1``, so the duration spans the gaps between frames,
    not the frames themselves. Confirmed against the real values in CodeWalker's
    read comments, all of which are 30 fps animations:
    221 frames -> 7.34 s, 17 -> 0.53 s, 151 -> 5.0 s, 201 -> 6.66 s.
    """
    if frame_count <= 1 or fps <= 0:
        return 0.0
    return (frame_count - 1) / float(fps)


def _f(value: float) -> str:
    """Format a float as a plain decimal, never in exponent form.

    Python's ``repr`` switches to scientific notation for small magnitudes
    (``1e-07``) and can emit ``-0``. Both are things the consuming XML parser
    would have to cope with, and neither buys us anything, so values are written
    with fixed precision and trailing zeros trimmed instead. Seven decimals is
    below single-precision resolution for the ranges involved here (quaternion
    components in [-1, 1], positions in metres), so nothing is lost.
    """
    v = float(value)
    if not math.isfinite(v):
        raise ValueError(f"Refusing to write a non-finite value: {value!r}")
    if abs(v) < 5e-8:
        return "0"
    text = f"{v:.7f}".rstrip("0").rstrip(".")
    return text or "0"


@dataclass
class BoneTrack:
    """One animated (bone, track) pair, already in GTA space."""

    bone_tag: int
    track: int
    # One tuple per frame. 3 components for position/scale, 4 for rotation.
    frames: list[tuple[float, ...]]

    @property
    def components(self) -> int:
        return len(self.frames[0]) if self.frames else 0

    def component_series(self, index: int) -> list[float]:
        return [frame[index] for frame in self.frames]

    def is_component_static(self, index: int) -> bool:
        series = self.component_series(index)
        if not series:
            return True
        first = series[0]
        return all(abs(v - first) <= STATIC_EPSILON for v in series)

    @property
    def is_static(self) -> bool:
        return all(self.is_component_static(i) for i in range(self.components))


@dataclass
class ClipDictionaryBuilder:
    """Assemble one clip + one animation into Clip Dictionary XML."""

    clip_name: str
    frame_count: int
    fps: float
    tracks: list[BoneTrack] = field(default_factory=list)
    rate: float = 1.0
    optimize: bool = True

    # -------------------------------------------------------------- internals

    def _channels_xml(self, track: BoneTrack, indent: str) -> list[str]:
        """Emit the channel list for one (bone, track) pair.

        A fully constant track collapses to a single ``StaticVector3`` /
        ``StaticQuaternion``. Otherwise each component becomes its own channel:
        ``StaticFloat`` when that component never moves, ``RawFloat`` when it
        does. ``RawFloat`` stores an uncompressed 32-bit float per frame, so the
        conversion is lossless and needs no quantisation solving.

        With ``optimize`` disabled nothing is collapsed - every component is
        written as a full per-frame ``RawFloat`` channel. The result plays back
        identically and is simply larger, which makes it a useful comparison
        when a bone is suspected of being wrongly detected as constant.
        """
        out: list[str] = []
        pad = indent + "  "

        if self.optimize and track.is_static and track.frames:
            value = track.frames[0]
            if track.track == TRACK_ROTATION:
                # StaticQuaternion serialises XYZ only and rebuilds
                # W = sqrt(1 - |xyz|^2) on read, so W must not be negative.
                # q and -q are the same rotation, so flipping is lossless.
                x, y, z, w = value
                if w < 0:
                    x, y, z, w = -x, -y, -z, -w
                out.append(f"{indent}<Item>")
                out.append(f'{pad}<Type value="StaticQuaternion" />')
                out.append(
                    f'{pad}<Value x="{_f(x)}" y="{_f(y)}" z="{_f(z)}" w="{_f(w)}" />'
                )
                out.append(f"{indent}</Item>")
            else:
                x, y, z = value[0], value[1], value[2]
                out.append(f"{indent}<Item>")
                out.append(f'{pad}<Type value="StaticVector3" />')
                out.append(f'{pad}<Value x="{_f(x)}" y="{_f(y)}" z="{_f(z)}" />')
                out.append(f"{indent}</Item>")
            return out

        for component in range(track.components):
            series = track.component_series(component)
            out.append(f"{indent}<Item>")
            if self.optimize and track.is_component_static(component):
                out.append(f'{pad}<Type value="StaticFloat" />')
                out.append(f'{pad}<Value value="{_f(series[0])}" />')
            else:
                out.append(f'{pad}<Type value="RawFloat" />')
                out.append(f"{pad}<Values>")
                # Ten values per line, matching CodeWalker's own formatting.
                for start in range(0, len(series), 10):
                    chunk = " ".join(_f(v) for v in series[start:start + 10])
                    out.append(f"{pad}  {chunk}")
                out.append(f"{pad}</Values>")
            out.append(f"{indent}</Item>")
        return out

    # ------------------------------------------------------------------ public

    def build(self) -> str:
        if not self.tracks:
            raise ValueError("Cannot build a clip dictionary with no animated tracks.")

        name = sanitize_name(self.clip_name)
        duration = duration_for(self.frame_count, self.fps)
        limit = sequence_frame_limit(self.frame_count)

        lines: list[str] = []
        lines.append('<?xml version="1.0" encoding="UTF-8"?>')
        lines.append("<ClipDictionary>")

        # ---- Clips: the playable entry FiveM's TaskPlayAnim addresses by name.
        lines.append("  <Clips>")
        lines.append("    <Item>")
        lines.append(f"      <Hash>{escape(name)}</Hash>")
        lines.append(f"      <Name>{escape(name)}</Name>")
        lines.append('      <Type value="Animation" />')
        lines.append('      <Unknown30 value="0" />')
        lines.append(f"      <AnimationHash>{escape(name)}</AnimationHash>")
        lines.append('      <StartTime value="0" />')
        lines.append(f'      <EndTime value="{_f(duration)}" />')
        lines.append(f'      <Rate value="{_f(self.rate)}" />')
        lines.append("      <Tags />")
        lines.append("      <Properties />")
        lines.append("    </Item>")
        lines.append("  </Clips>")

        # ---- Animations: the keyframe payload.
        lines.append("  <Animations>")
        lines.append("    <Item>")
        lines.append(f"      <Hash>{escape(name)}</Hash>")
        lines.append('      <Unknown10 value="1" />')
        lines.append(f'      <FrameCount value="{self.frame_count}" />')
        lines.append(f'      <SequenceFrameLimit value="{limit}" />')
        lines.append(f'      <Duration value="{_f(duration)}" />')
        lines.append("      <Unknown1C>hash_00000000</Unknown1C>")

        # BoneIds is the index table: entry i describes SequenceData entry i.
        lines.append("      <BoneIds>")
        for track in self.tracks:
            lines.append("        <Item>")
            lines.append(f'          <BoneId value="{track.bone_tag}" />')
            lines.append(f'          <Track value="{track.track}" />')
            lines.append('          <Unk0 value="0" />')
            lines.append("        </Item>")
        lines.append("      </BoneIds>")

        # A single sequence holds every frame, which is why SequenceFrameLimit
        # only has to be >= FrameCount.
        lines.append("      <Sequences>")
        lines.append("        <Item>")
        lines.append("          <Hash>hash_00000000</Hash>")
        lines.append(f'          <FrameCount value="{self.frame_count}" />')
        lines.append("          <SequenceData>")
        for track in self.tracks:
            lines.append("            <Item>")
            lines.append("              <Channels>")
            lines.extend(self._channels_xml(track, "                "))
            lines.append("              </Channels>")
            lines.append("            </Item>")
        lines.append("          </SequenceData>")
        lines.append("        </Item>")
        lines.append("      </Sequences>")

        lines.append("    </Item>")
        lines.append("  </Animations>")
        lines.append("</ClipDictionary>")
        return "\n".join(lines) + "\n"
