"""The GTA V target skeleton profile.

A profile is the *rest pose* of a real GTA V ped skeleton: for every bone, its
name, tag, parent and rest transform. The converter cannot produce correct
animation data without it, because a `.ycd` stores each bone's full local
transform relative to its parent rather than a delta from rest - see
``docs/ANIMATION_PIPELINE.md`` section 3.1.

Rest data is Rockstar-owned game data, so **none is shipped with this project**.
The user supplies it once, from their own GTA V installation, in either form:

* a CodeWalker XML export (``.yft.xml`` / ``.ydr.xml`` / ``.ydd.xml``) - parsed
  here, in pure Python, with no external tool;
* a binary ``.yft`` / ``.ydd`` - handed to the ``codewalker-bridge`` sidecar.

The XML element names below were read from CodeWalker's own ``Bone.WriteXml``
(``CodeWalker.Core/GameFiles/Resources/Drawable.cs``), not guessed.
"""

from __future__ import annotations

import json
import xml.etree.ElementTree as ET
from dataclasses import dataclass, asdict
from pathlib import Path

from ..utils.errors import SkeletonProfileError


@dataclass
class RestBone:
    """One bone of the target skeleton, in its rest pose."""

    name: str
    tag: int
    index: int
    parent_index: int          # -1 for the root
    translation: tuple[float, float, float]
    rotation: tuple[float, float, float, float]   # quaternion, XYZW
    scale: tuple[float, float, float]

    def to_dict(self) -> dict:
        return asdict(self)

    @staticmethod
    def from_dict(d: dict) -> "RestBone":
        return RestBone(
            name=d["name"],
            tag=int(d["tag"]),
            index=int(d["index"]),
            parent_index=int(d["parent_index"]),
            translation=tuple(d["translation"]),      # type: ignore[arg-type]
            rotation=tuple(d["rotation"]),            # type: ignore[arg-type]
            scale=tuple(d.get("scale", (1.0, 1.0, 1.0))),  # type: ignore[arg-type]
        )


@dataclass
class SkeletonProfile:
    """A complete, usable target skeleton."""

    label: str
    source: str                 # where it came from, for the debug report
    bones: list[RestBone]

    # -------------------------------------------------------------- accessors

    @property
    def names(self) -> list[str]:
        return [b.name for b in self.bones]

    def by_name(self, name: str) -> RestBone | None:
        return next((b for b in self.bones if b.name == name), None)

    def parent_of(self, bone: RestBone) -> RestBone | None:
        if bone.parent_index < 0:
            return None
        return next((b for b in self.bones if b.index == bone.parent_index), None)

    # ------------------------------------------------------------ persistence

    def to_dict(self) -> dict:
        return {
            "label": self.label,
            "source": self.source,
            "bones": [b.to_dict() for b in self.bones],
        }

    def save(self, path: Path) -> None:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.to_dict(), indent=2), encoding="utf-8")

    @staticmethod
    def load(path: Path) -> "SkeletonProfile":
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        return SkeletonProfile(
            label=data.get("label", "GTA V Ped"),
            source=data.get("source", str(path)),
            bones=[RestBone.from_dict(b) for b in data["bones"]],
        )


# --------------------------------------------------------------------- parsing


def _vec(node: ET.Element | None, keys: str, default: tuple) -> tuple:
    if node is None:
        return default
    out = []
    for k in keys:
        raw = node.get(k)
        out.append(float(raw) if raw is not None else 0.0)
    return tuple(out)


def _int_attr(parent: ET.Element, tag: str, default: int = 0) -> int:
    node = parent.find(tag)
    if node is None:
        return default
    raw = node.get("value")
    if raw is None:
        return default
    # CodeWalker writes plain decimals here, but be forgiving about hex.
    try:
        return int(raw)
    except ValueError:
        return int(raw, 0)


def parse_skeleton_xml(path: Path) -> SkeletonProfile:
    """Read the ``<Skeleton>`` out of any CodeWalker XML export.

    Works for ``.yft.xml``, ``.ydr.xml`` and ``.ydd.xml`` alike: rather than
    assuming a fixed document shape, this finds the first ``<Skeleton>`` element
    that actually carries bones, wherever it sits in the tree.
    """
    path = Path(path)
    try:
        tree = ET.parse(path)
    except ET.ParseError as exc:
        raise SkeletonProfileError(
            f"{path.name} is not valid XML: {exc}",
            "Re-export it from CodeWalker with 'Export XML'.",
        ) from exc

    root = tree.getroot()

    bones_node = None
    for skeleton in root.iter("Skeleton"):
        candidate = skeleton.find("Bones")
        if candidate is not None and candidate.find("Item") is not None:
            bones_node = candidate
            break
    if bones_node is None:
        # Some exports nest bones without a <Skeleton> wrapper.
        for candidate in root.iter("Bones"):
            if candidate.find("Item") is not None:
                bones_node = candidate
                break

    if bones_node is None:
        raise SkeletonProfileError(
            f"No skeleton with bones was found in {path.name}.",
            "Make sure you exported a ped file that actually has a rig - a ped "
            "fragment (.yft) such as mp_m_freemode_01 is the reliable choice.",
        )

    bones: list[RestBone] = []
    for index, item in enumerate(bones_node.findall("Item")):
        name_node = item.find("Name")
        name = (name_node.text or "").strip() if name_node is not None else ""
        if not name:
            continue
        bones.append(
            RestBone(
                name=name,
                tag=_int_attr(item, "Tag"),
                index=_int_attr(item, "Index", index),
                parent_index=_int_attr(item, "ParentIndex", -1),
                translation=_vec(item.find("Translation"), "xyz", (0.0, 0.0, 0.0)),
                rotation=_vec(item.find("Rotation"), "xyzw", (0.0, 0.0, 0.0, 1.0)),
                scale=_vec(item.find("Scale"), "xyz", (1.0, 1.0, 1.0)),
            )
        )

    if not bones:
        raise SkeletonProfileError(
            f"The skeleton in {path.name} is empty.",
            "Export a ped file that contains a rig.",
        )

    return SkeletonProfile(
        label=f"GTA V Ped ({path.stem})",
        source=str(path),
        bones=bones,
    )


def parse_skeleton_json(path: Path) -> SkeletonProfile:
    """Read a skeleton dumped by the ``codewalker-bridge dump-skeleton`` command."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not data.get("ok", True):
        raise SkeletonProfileError(data.get("error", "The bridge reported a failure."))
    raw_bones = data.get("bones") or []
    if not raw_bones:
        raise SkeletonProfileError(f"No bones in {Path(path).name}.")
    bones = [
        RestBone(
            name=b["name"],
            tag=int(b["tag"]),
            index=int(b.get("index", i)),
            parent_index=int(b.get("parentIndex", b.get("parent_index", -1))),
            translation=tuple(b["translation"]),
            rotation=tuple(b["rotation"]),
            scale=tuple(b.get("scale", (1.0, 1.0, 1.0))),
        )
        for i, b in enumerate(raw_bones)
    ]
    return SkeletonProfile(
        label=data.get("label", "GTA V Ped"),
        source=data.get("source", str(path)),
        bones=bones,
    )


def load_any(path: Path) -> SkeletonProfile:
    """Load a skeleton from whatever the user pointed us at."""
    path = Path(path)
    if not path.is_file():
        raise SkeletonProfileError(f"File not found: {path}")
    suffix = path.suffix.lower()
    if suffix == ".xml":
        return parse_skeleton_xml(path)
    if suffix == ".json":
        # Either a cached profile of ours, or a bridge dump.
        data = json.loads(path.read_text(encoding="utf-8"))
        if "bones" in data and data.get("bones") and "parent_index" in data["bones"][0]:
            return SkeletonProfile.load(path)
        return parse_skeleton_json(path)
    raise SkeletonProfileError(
        f"Unsupported skeleton file type: {path.suffix}",
        "Supply a CodeWalker XML export (.yft.xml / .ydd.xml) or a skeleton "
        "JSON produced by `codewalker-bridge dump-skeleton`.",
    )


# ------------------------------------------------------------------ validation


@dataclass
class ProfileCheck:
    """How well a loaded skeleton matches the reference ped bone table."""

    present: list[str]
    absent: list[str]
    tag_mismatches: list[tuple[str, int, int]]   # (name, reference_tag, actual_tag)
    extra: list[str]

    @property
    def usable(self) -> bool:
        return not self.absent


def check_profile(profile: SkeletonProfile, reference_bones: list[dict],
                  core_roles: set[str]) -> ProfileCheck:
    """Compare a loaded skeleton against ``mappings/gta5_ped.json``.

    The reference table never overrides the real file: mismatches are *reported*
    so the user can see them, and the real skeleton's tag is what gets written.
    """
    by_name = {b.name: b for b in profile.bones}
    present, absent, mismatches = [], [], []

    for ref in reference_bones:
        bone = by_name.get(ref["name"])
        if bone is None:
            # Only bones the animation genuinely needs count as absent.
            if ref["role"] in core_roles:
                absent.append(ref["name"])
            continue
        present.append(ref["name"])
        if bone.tag != ref["tag"]:
            mismatches.append((ref["name"], ref["tag"], bone.tag))

    reference_names = {b["name"] for b in reference_bones}
    extra = [b.name for b in profile.bones if b.name not in reference_names]
    return ProfileCheck(present=present, absent=absent,
                        tag_mismatches=mismatches, extra=extra)
