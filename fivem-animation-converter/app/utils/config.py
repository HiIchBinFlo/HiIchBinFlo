"""Persisted settings (Blender path, skeleton profile, last used options).

Stored per user so the choices survive restarts:

* Windows: ``%APPDATA%\\FiveMAnimationConverter\\config.json``
* macOS:   ``~/Library/Application Support/FiveMAnimationConverter/config.json``
* Linux:   ``~/.config/fivem-animation-converter/config.json``
"""

from __future__ import annotations

import json
import os
import platform
from dataclasses import dataclass, asdict, field
from pathlib import Path

APP_NAME = "FiveMAnimationConverter"


def config_dir() -> Path:
    system = platform.system()
    if system == "Windows":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
        return base / APP_NAME
    if system == "Darwin":
        return Path.home() / "Library" / "Application Support" / APP_NAME
    base = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return base / "fivem-animation-converter"


@dataclass
class Settings:
    blender_path: str | None = None
    skeleton_profile: str | None = None      # cached profile JSON
    skeleton_source: str | None = None       # what it was made from
    output_dir: str | None = None
    fps: int = 30
    target: str = "gta5_ped"
    auto_mapping: bool = True
    retarget: bool = True
    optimize: bool = True
    generate_resource: bool = True
    generate_test_resource: bool = False
    align_rest_pose: bool = True
    root_motion: str = "keep"                # keep | inplace
    debug: bool = False
    recent_files: list[str] = field(default_factory=list)

    # ------------------------------------------------------------------ store

    @staticmethod
    def path() -> Path:
        return config_dir() / "config.json"

    @classmethod
    def load(cls) -> "Settings":
        path = cls.path()
        if not path.is_file():
            return cls()
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            # A corrupt config must never stop the app from starting.
            return cls()
        known = {f for f in cls().__dict__}
        return cls(**{k: v for k, v in data.items() if k in known})

    def save(self) -> Path:
        path = self.path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(asdict(self), indent=2), encoding="utf-8")
        return path

    def remember_file(self, file_path: str, limit: int = 10) -> None:
        entries = [f for f in self.recent_files if f != file_path]
        entries.insert(0, file_path)
        self.recent_files = entries[:limit]
