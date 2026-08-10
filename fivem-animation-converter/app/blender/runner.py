"""Run the ``blender_scripts/`` stages.

Always headless: an external Blender is invoked with ``--background --python``,
so no window ever appears and the user never has to touch Blender. If Blender is
available as a Python module instead, the script is run in a subprocess of this
interpreter, which behaves identically from the caller's point of view.

Every invocation's complete stdout/stderr is captured and appended to the run's
log file, because "the export failed" is useless without Blender's console.
"""

from __future__ import annotations

import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from ..utils.errors import BlenderRunError
from .locator import BlenderTarget

SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "blender_scripts"


@dataclass
class RunResult:
    returncode: int
    stdout: str
    stderr: str

    @property
    def ok(self) -> bool:
        return self.returncode == 0

    @property
    def combined(self) -> str:
        parts = []
        if self.stdout:
            parts.append(self.stdout)
        if self.stderr:
            parts.append("--- stderr ---\n" + self.stderr)
        return "\n".join(parts)


class BlenderRunner:
    def __init__(self, target: BlenderTarget, logger=None, timeout: int = 1800):
        self.target = target
        self.logger = logger
        self.timeout = timeout

    def _command(self, script: Path, script_args: list[str]) -> list[str]:
        if self.target.kind == "module":
            # Running the script through this interpreter, where `import bpy`
            # already works. The scripts parse their arguments after "--"
            # exactly as they do under a real Blender, so they are unchanged.
            return [sys.executable, str(script), "--", *script_args]
        return [
            self.target.path or "blender",
            "--background",
            "--factory-startup",   # ignore user add-ons/preferences: reproducible runs
            "--python-exit-code", "1",
            "--python", str(script),
            "--", *script_args,
        ]

    def run(self, script_name: str, **kwargs) -> RunResult:
        script = SCRIPTS_DIR / script_name
        if not script.is_file():
            raise BlenderRunError(f"Blender script not found: {script}")

        script_args: list[str] = []
        for key, value in kwargs.items():
            if value is None:
                continue
            script_args.append(f"--{key.replace('_', '-')}")
            script_args.append(str(value))

        command = self._command(script, script_args)
        if self.logger:
            self.logger.debug("Running: %s", " ".join(command))

        env = dict(os.environ)
        env.setdefault("PYTHONUNBUFFERED", "1")

        try:
            completed = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=self.timeout,
                env=env,
            )
        except subprocess.TimeoutExpired as exc:
            raise BlenderRunError(
                f"Blender did not finish within {self.timeout} seconds while "
                f"running {script_name}."
            ) from exc
        except OSError as exc:
            raise BlenderRunError(f"Could not start Blender: {exc}") from exc

        result = RunResult(completed.returncode, completed.stdout or "",
                           completed.stderr or "")

        if self.logger:
            self.logger.debug("--- %s output ---\n%s", script_name, result.combined)

        return result
