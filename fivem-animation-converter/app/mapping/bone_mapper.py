"""Automatic source-bone -> GTA V bone mapping.

The mapper works in two hops:

    source bone name  ->  canonical role  ->  GTA V bone name

The canonical role (``"upperarm.L"``, ``"spine_1"``, ...) is the pivot that makes
the system independent of any single naming convention. Adding support for a new
rig means adding aliases to a JSON file in ``mappings/``, never touching code.

Six strategies are tried, in descending order of trust:

1. exact match against the detected profile's alias table
2. exact match after normalisation (case, namespace, separators, known prefixes)
3. generic alias table
4. side-aware base-role match (``"upperarm"`` + side ``L``)
5. regex ignore patterns (bone is deliberately not mapped)
6. fuzzy match, which is always reported as *uncertain* so a human confirms it

Stdlib only: this module is imported both by the GUI and by the scripts that run
inside Blender, and Blender's bundled Python has no third-party packages.
"""

from __future__ import annotations

import difflib
import json
import re
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Iterable

# Confidence levels, mirroring the markers the task asked the GUI to show.
AUTO = "auto"           # shown as the check mark
UNCERTAIN = "uncertain" # shown as the warning sign
MISSING = "missing"     # shown as the cross
IGNORED = "ignored"     # deliberately not part of the GTA skeleton

# Fuzzy ratio at or above which we still call it a match (but never "auto").
FUZZY_CUTOFF = 0.82

_SEPARATORS = re.compile(r"[\s_.\-|]+")
_INDEX_SUFFIX = re.compile(r"^(.*?)(\d+)$")


def normalize(name: str) -> str:
    """Collapse a bone name to a comparable key.

    ``"mixamorig:LeftForeArm"`` -> ``"leftforearm"``;
    ``"upper_arm.L"`` -> ``"upperarml"``.
    """
    if ":" in name:
        name = name.rsplit(":", 1)[-1]
    name = _SEPARATORS.sub("", name)
    return name.lower()


def strip_prefixes(name: str, prefixes: Iterable[str]) -> str:
    """Remove a known rig prefix, unless doing so would consume the whole name.

    The guard matters for names that *are* a prefix: 3ds Max's biped root is
    literally ``"Bip01"``, and stripping ``"bip01"`` from it would leave nothing
    to match on.
    """
    low = name.lower()
    for prefix in sorted(prefixes, key=len, reverse=True):
        p = prefix.lower()
        if p and low.startswith(p) and len(name) > len(prefix):
            return name[len(prefix):]
    return name


@dataclass
class BoneMapping:
    """One row of the mapping table shown to the user before converting."""

    source: str | None          # bone name in the incoming FBX
    target: str                 # GTA V bone name
    role: str                   # canonical role
    tag: int                    # GTA V bone tag written into the .ycd
    confidence: str             # AUTO / UNCERTAIN / MISSING
    method: str = ""            # which strategy produced this, for the debug log
    score: float = 1.0
    is_core: bool = False       # a bone the animation is unusable without

    @property
    def marker(self) -> str:
        return {AUTO: "OK", UNCERTAIN: "??", MISSING: "--", IGNORED: "  "}.get(
            self.confidence, "?"
        )

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class MappingReport:
    """Everything the GUI and the debug log need to describe a mapping run."""

    profile_id: str
    profile_label: str
    mappings: list[BoneMapping] = field(default_factory=list)
    unmapped_sources: list[str] = field(default_factory=list)
    ignored_sources: list[str] = field(default_factory=list)

    @property
    def matched(self) -> list[BoneMapping]:
        return [m for m in self.mappings if m.source is not None]

    @property
    def uncertain(self) -> list[BoneMapping]:
        return [m for m in self.mappings if m.confidence == UNCERTAIN]

    @property
    def missing_core(self) -> list[BoneMapping]:
        return [m for m in self.mappings if m.confidence == MISSING and m.is_core]

    def to_dict(self) -> dict:
        return {
            "profile_id": self.profile_id,
            "profile_label": self.profile_label,
            "mappings": [m.to_dict() for m in self.mappings],
            "unmapped_sources": self.unmapped_sources,
            "ignored_sources": self.ignored_sources,
        }


class MappingTables:
    """The JSON alias tables in ``mappings/``, loaded once."""

    def __init__(self, mappings_dir: Path):
        self.dir = Path(mappings_dir)
        self.profiles: list[dict] = []
        self.generic: dict = {}
        self.target: dict = {}
        self._load()

    def _load(self) -> None:
        target_path = self.dir / "gta5_ped.json"
        if not target_path.is_file():
            raise FileNotFoundError(f"Target skeleton table not found: {target_path}")
        self.target = json.loads(target_path.read_text(encoding="utf-8"))

        for path in sorted(self.dir.glob("*.json")):
            if path.name == "gta5_ped.json":
                continue
            data = json.loads(path.read_text(encoding="utf-8"))
            if data.get("id") == "generic":
                self.generic = data
            else:
                self.profiles.append(data)
        self.profiles.sort(key=lambda d: d.get("priority", 0), reverse=True)

    # ---------------------------------------------------------------- detection

    def detect_profile(self, bone_names: list[str]) -> dict:
        """Pick the alias table that best describes this skeleton."""
        joined = " ".join(bone_names).lower()
        normalized = {normalize(b) for b in bone_names}

        best: tuple[int, dict] | None = None
        for profile in self.profiles:
            detect = profile.get("detect", {})
            score = 0
            for needle in detect.get("name_contains", []):
                if needle.lower() in joined:
                    score += 10
            required = detect.get("all_of", [])
            if required and all(r.lower() in normalized for r in required):
                score += 5
            # Direct alias hits are the strongest signal of all.
            score += sum(
                1
                for aliases in profile.get("roles", {}).values()
                for alias in aliases
                if normalize(alias) in normalized
            )
            # A profile has to earn the override. One incidental alias hit (every
            # humanoid rig has a bone called "Spine") is not evidence; a
            # signature substring, a required bone set, or a broad sweep of
            # alias hits is.
            threshold = detect.get("min_score", 6)
            if score >= threshold and (best is None or score > best[0]):
                best = (score, profile)

        return best[1] if best else (self.generic or {"id": "generic", "label": "Generic"})


class BoneMapper:
    def __init__(self, tables: MappingTables):
        self.tables = tables
        self.target_bones = tables.target["bones"]
        self.core_roles = set(tables.target.get("core_roles", []))
        self._ignore_res = [
            re.compile(p, re.IGNORECASE)
            for p in tables.generic.get("ignore_patterns", [])
        ]

    # ------------------------------------------------------------------ helpers

    def _split_side(self, raw: str) -> tuple[str | None, str]:
        """Split a side marker off a bone name, returning ``(side, remainder)``.

        This deliberately works on the *raw* name, before :func:`normalize`,
        because normalisation removes the separators that make a side token
        unambiguous. ``"lowerarm_r"`` only reads as "right" while the underscore
        is still there; once it is ``"lowerarmr"`` the leading ``l`` of
        ``"lowerarm"`` is indistinguishable from a left-side marker.
        """
        # 1. A side token delimited by separators or string edges:
        #    "lowerarm_r", "SKEL_L_UpperArm", "hand.L", "Bip01 L Thigh".
        delimited = re.compile(
            r"(?:^|(?<=[_.\-\s]))(l|r|lf|rt|lft|rgt|left|right)(?:(?=[_.\-\s])|$)",
            re.IGNORECASE,
        )
        match = delimited.search(raw)
        if match:
            token = match.group(1).lower()
            side = "L" if token in ("l", "lf", "lft", "left") else "R"
            remainder = raw[: match.start()] + raw[match.end():]
            return side, remainder

        # 2. "Left"/"Right" embedded without separators: "LeftForeArm".
        embedded = re.compile(r"(left|right)", re.IGNORECASE)
        match = embedded.search(raw)
        if match:
            side = "L" if match.group(1).lower() == "left" else "R"
            return side, raw[: match.start()] + raw[match.end():]

        # 3. A capital L/R welded onto the end: "UpperArmL", "Arm_02R".
        match = re.search(r"(?<=[a-z0-9])([LR])$", raw)
        if match:
            return match.group(1).upper(), raw[: match.start()]

        return None, raw

    def _is_ignored(self, name: str) -> bool:
        return any(rx.search(name) for rx in self._ignore_res)

    # -------------------------------------------------------- source bone -> role

    def _role_for_source(self, raw: str, profile: dict) -> tuple[str | None, str, float]:
        """Return ``(role, method, score)`` for one source bone name."""
        name = strip_prefixes(raw, profile.get("strip_prefixes", []))
        name = strip_prefixes(name, self.tables.generic.get("strip_prefixes", []))
        norm = normalize(name)
        if not norm:
            return None, "empty", 0.0

        # 1 + 2: the detected profile's alias table (exact, then normalised).
        for role, aliases in profile.get("roles", {}).items():
            for alias in aliases:
                if normalize(alias) == norm:
                    return role, f"profile:{profile.get('id', '?')}", 1.0

        # 3: the generic table's side-less roles (spine, neck, head, pelvis).
        for role, aliases in self.tables.generic.get("roles", {}).items():
            for alias in aliases:
                if normalize(alias) == norm:
                    return role, "generic", 1.0

        # 4: side-aware base roles ("upperarm" + "L" -> "upperarm.L").
        side, sideless = self._split_side(name)
        stem = normalize(sideless)
        if side and stem:
            for base, aliases in self.tables.generic.get("base_roles", {}).items():
                for alias in aliases:
                    if normalize(alias) == stem:
                        return f"{base}.{side}", "side+base", 1.0

        # 5: explicitly ignored (IK targets, facial rig, props, helper bones...).
        if self._is_ignored(name):
            return None, "ignored", 0.0

        # 6: fuzzy, deliberately last and never fully trusted.
        candidates: dict[str, str] = {}
        for role, aliases in profile.get("roles", {}).items():
            for alias in aliases:
                candidates[normalize(alias)] = role
        for role, aliases in self.tables.generic.get("roles", {}).items():
            for alias in aliases:
                candidates.setdefault(normalize(alias), role)
        if side and stem:
            for base, aliases in self.tables.generic.get("base_roles", {}).items():
                for alias in aliases:
                    candidates.setdefault(normalize(alias), f"{base}.{side}")
            probe = stem
        else:
            probe = norm

        close = difflib.get_close_matches(probe, list(candidates), n=1, cutoff=FUZZY_CUTOFF)
        if close:
            ratio = difflib.SequenceMatcher(None, probe, close[0]).ratio()
            return candidates[close[0]], "fuzzy", ratio

        return None, "nomatch", 0.0

    # --------------------------------------------------------------------- main

    def build(self, source_bones: list[str]) -> MappingReport:
        """Map an FBX's bone list onto the GTA V ped skeleton."""
        profile = self.tables.detect_profile(source_bones)
        report = MappingReport(
            profile_id=profile.get("id", "generic"),
            profile_label=profile.get("label", "Generic"),
        )

        profile_ignore = {normalize(n) for n in profile.get("ignore", [])}

        # First pass: every source bone claims a role.
        role_claims: dict[str, tuple[str, str, float]] = {}
        for raw in source_bones:
            if normalize(raw) in profile_ignore:
                report.ignored_sources.append(raw)
                continue
            role, method, score = self._role_for_source(raw, profile)
            if role is None:
                if method == "ignored":
                    report.ignored_sources.append(raw)
                else:
                    report.unmapped_sources.append(raw)
                continue
            # If two source bones claim the same role, the better score wins and
            # the loser goes back on the unmapped pile rather than silently
            # overwriting - a duplicate claim is exactly the kind of thing the
            # user needs to see.
            previous = role_claims.get(role)
            if previous is None or score > previous[2]:
                if previous is not None:
                    report.unmapped_sources.append(previous[0])
                role_claims[role] = (raw, method, score)
            else:
                report.unmapped_sources.append(raw)

        # Second pass: walk the target skeleton so the table is always in GTA
        # bone order and always lists every target bone, mapped or not.
        for bone in self.target_bones:
            role = bone["role"]
            claim = role_claims.get(role)
            is_core = role in self.core_roles
            if claim is None:
                mapping = BoneMapping(
                    source=None,
                    target=bone["name"],
                    role=role,
                    tag=bone["tag"],
                    confidence=MISSING,
                    method="nomatch",
                    score=0.0,
                    is_core=is_core,
                )
            else:
                raw, method, score = claim
                confidence = AUTO if method != "fuzzy" else UNCERTAIN
                mapping = BoneMapping(
                    source=raw,
                    target=bone["name"],
                    role=role,
                    tag=bone["tag"],
                    confidence=confidence,
                    method=method,
                    score=score,
                    is_core=is_core,
                )
            report.mappings.append(mapping)

        return report

    # ---------------------------------------------------------------- overrides

    def apply_overrides(
        self, report: MappingReport, overrides: dict[str, str | None]
    ) -> MappingReport:
        """Apply the user's manual corrections (``{target_bone: source_bone}``).

        An explicit ``None`` clears a mapping, which is how the user says
        "leave this bone alone" for a bone the fuzzy matcher guessed wrong.
        """
        by_target = {m.target: m for m in report.mappings}
        for target, source in overrides.items():
            mapping = by_target.get(target)
            if mapping is None:
                continue
            if source is None:
                mapping.source = None
                mapping.confidence = MISSING
                mapping.method = "user:cleared"
                mapping.score = 0.0
            else:
                mapping.source = source
                mapping.confidence = AUTO
                mapping.method = "user"
                mapping.score = 1.0
        return report


def load_mapper(mappings_dir: Path) -> BoneMapper:
    return BoneMapper(MappingTables(mappings_dir))
