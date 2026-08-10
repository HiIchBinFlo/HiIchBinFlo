"""Client for the ``codewalker-bridge`` sidecar.

The sidecar performs the one step of the pipeline that genuinely needs
CodeWalker.Core: compiling Clip Dictionary XML into a binary ``.ycd``.

If it has not been built, this is **not** treated as a fatal error. The
converter still produces a complete, valid ``.ycd.xml``, and the user can finish
the job with CodeWalker's *Import XML* - the documented community workflow. The
tool degrades to a longer path rather than failing or pretending.
"""

from __future__ import annotations

import json
import os
import platform
import subprocess
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]

# Where `npm run build:sidecar` puts the binary (Tauri's naming convention),
# plus the plain `dotnet build` output locations.
SEARCH_GLOBS = [
    "src-tauri/binaries/codewalker-bridge-*",
    "sidecar/CodeWalkerBridge/bin/sidecar-publish/*/codewalker-bridge*",
    "sidecar/CodeWalkerBridge/bin/Release/net8.0/codewalker-bridge*",
    "sidecar/CodeWalkerBridge/bin/Debug/net8.0/codewalker-bridge*",
]


@dataclass
class BridgeResult:
    ok: bool
    data: dict
    error: str = ""


def find_bridge(configured: str | None = None) -> Path | None:
    """Locate the sidecar binary, or return ``None``."""
    if configured and Path(configured).is_file():
        return Path(configured)

    env = os.environ.get("FIVEM_ANIM_BRIDGE")
    if env and Path(env).is_file():
        return Path(env)

    is_windows = platform.system() == "Windows"
    for pattern in SEARCH_GLOBS:
        for candidate in sorted(REPO_ROOT.glob(pattern)):
            if not candidate.is_file():
                continue
            # Skip the .pdb/.json siblings a dotnet build leaves next to the exe.
            if candidate.suffix.lower() in (".pdb", ".json", ".dll", ".config"):
                continue
            if is_windows and candidate.suffix.lower() != ".exe":
                continue
            if not is_windows and candidate.suffix:
                continue
            if os.access(candidate, os.X_OK) or is_windows:
                return candidate
    return None


def run_bridge(bridge: Path, *args: str, timeout: int = 600) -> BridgeResult:
    """Invoke the sidecar and parse its single line of JSON."""
    try:
        completed = subprocess.run(
            [str(bridge), *args],
            capture_output=True, text=True, timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return BridgeResult(False, {}, f"The bridge timed out after {timeout}s.")
    except OSError as exc:
        return BridgeResult(False, {}, f"Could not start the bridge: {exc}")

    stdout = (completed.stdout or "").strip()
    if not stdout:
        return BridgeResult(
            False, {},
            (completed.stderr or "").strip() or "The bridge produced no output.",
        )

    # The bridge prints exactly one JSON object; take the last line so any
    # stray runtime chatter before it is ignored.
    line = stdout.splitlines()[-1]
    try:
        data = json.loads(line)
    except json.JSONDecodeError:
        return BridgeResult(False, {}, f"Unparseable bridge output: {line[:400]}")

    if not data.get("ok", False):
        return BridgeResult(False, data, data.get("error", "The bridge reported a failure."))
    return BridgeResult(True, data)


def xml_to_ycd(bridge: Path, xml_path: Path, output_path: Path) -> BridgeResult:
    return run_bridge(bridge, "xml-to-ycd", str(xml_path), str(output_path))


def ycd_to_xml(bridge: Path, ycd_path: Path, output_path: Path) -> BridgeResult:
    return run_bridge(bridge, "ycd-to-xml", str(ycd_path), str(output_path))


def dump_skeleton(bridge: Path, source: Path, output_path: Path) -> BridgeResult:
    return run_bridge(bridge, "dump-skeleton", str(source), str(output_path))


def probe(bridge: Path) -> BridgeResult:
    return run_bridge(bridge, "probe", timeout=60)
