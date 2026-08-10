"""Find a usable Blender.

Order of preference:

1. an explicit path the user picked in the GUI (persisted in the config)
2. the ``BLENDER_PATH`` environment variable
3. the ``bpy`` module, if this Python can already import it (pip-installed
   Blender-as-a-module) - then no external process is needed at all
4. the usual install locations for the platform
5. ``blender`` on ``PATH``

Returning a :class:`BlenderTarget` rather than a bare path lets the runner treat
"external executable" and "bpy module" uniformly.
"""

from __future__ import annotations

import os
import platform
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

WINDOWS_ROOTS = [
    r"C:\Program Files\Blender Foundation",
    r"C:\Program Files (x86)\Blender Foundation",
    r"C:\Program Files\Blender",
]

MAC_CANDIDATES = ["/Applications/Blender.app/Contents/MacOS/Blender"]

LINUX_CANDIDATES = [
    "/usr/bin/blender",
    "/usr/local/bin/blender",
    "/snap/bin/blender",
    "/var/lib/flatpak/exports/bin/org.blender.Blender",
]


@dataclass
class BlenderTarget:
    """How we are going to run Blender."""

    kind: str            # "executable" | "module"
    path: str | None     # blender.exe, or None for the module
    version: str = ""

    @property
    def label(self) -> str:
        if self.kind == "module":
            return f"bpy module {self.version}".strip()
        return f"{self.path} ({self.version})" if self.version else str(self.path)


def _probe_version(executable: str) -> str:
    try:
        out = subprocess.run(
            [executable, "--version"],
            capture_output=True, text=True, timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    match = re.search(r"Blender\s+([0-9]+\.[0-9]+(?:\.[0-9]+)?)", out.stdout or "")
    return match.group(1) if match else ""


def is_valid_blender(path: str | os.PathLike | None) -> bool:
    if not path:
        return False
    candidate = Path(path)
    if not candidate.is_file() or not os.access(candidate, os.X_OK):
        return False
    return bool(_probe_version(str(candidate)))


def _windows_candidates() -> list[Path]:
    found: list[Path] = []
    for root in WINDOWS_ROOTS:
        base = Path(root)
        if not base.is_dir():
            continue
        # "Blender 4.2", "Blender 5.0", ... - newest first.
        for entry in sorted(base.iterdir(), reverse=True):
            exe = entry / "blender.exe"
            if exe.is_file():
                found.append(exe)
        exe = base / "blender.exe"
        if exe.is_file():
            found.append(exe)
    return found


def _platform_candidates() -> list[Path]:
    system = platform.system()
    if system == "Windows":
        return _windows_candidates()
    if system == "Darwin":
        return [Path(p) for p in MAC_CANDIDATES if Path(p).is_file()]
    return [Path(p) for p in LINUX_CANDIDATES if Path(p).is_file()]


def bpy_module_available() -> tuple[bool, str]:
    """Is Blender importable as a Python module in *this* interpreter?"""
    try:
        import bpy
    except Exception:
        return False, ""
    try:
        return True, ".".join(str(v) for v in bpy.app.version)
    except Exception:
        # Importable but the version is unreadable: still usable.
        return True, ""


def find_blender(configured: str | None = None,
                 allow_module: bool = True) -> BlenderTarget | None:
    """Locate Blender, or return ``None`` if there is none to be found."""
    if configured and is_valid_blender(configured):
        return BlenderTarget("executable", str(configured), _probe_version(str(configured)))

    env = os.environ.get("BLENDER_PATH")
    if env and is_valid_blender(env):
        return BlenderTarget("executable", env, _probe_version(env))

    if allow_module:
        available, version = bpy_module_available()
        if available:
            return BlenderTarget("module", None, version)

    for candidate in _platform_candidates():
        if is_valid_blender(candidate):
            return BlenderTarget("executable", str(candidate), _probe_version(str(candidate)))

    on_path = shutil.which("blender")
    if on_path and is_valid_blender(on_path):
        return BlenderTarget("executable", on_path, _probe_version(on_path))

    return None
