"""Per-conversion log files and the debug report.

Every run writes ``logs/conversion_<date>_<time>.log`` containing the converter's
own trace *and* the complete Blender console output, so a failed export can be
diagnosed after the fact rather than only while it is on screen.
"""

from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path

LOG_FORMAT = "%(asctime)s  %(levelname)-7s  %(message)s"
DATE_FORMAT = "%H:%M:%S"


def new_log_file(logs_dir: Path) -> Path:
    logs_dir = Path(logs_dir)
    logs_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    return logs_dir / f"conversion_{stamp}.log"


def setup_logger(log_path: Path, debug: bool = False,
                 name: str = "converter") -> logging.Logger:
    logger = logging.getLogger(f"{name}.{log_path.stem}")
    logger.setLevel(logging.DEBUG)
    logger.handlers.clear()
    logger.propagate = False

    file_handler = logging.FileHandler(log_path, encoding="utf-8")
    file_handler.setLevel(logging.DEBUG)   # the file always gets everything
    file_handler.setFormatter(logging.Formatter(LOG_FORMAT, DATE_FORMAT))
    logger.addHandler(file_handler)

    console = logging.StreamHandler()
    console.setLevel(logging.DEBUG if debug else logging.INFO)
    console.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(console)

    return logger


def section(title: str) -> str:
    return f"\n=== {title.upper()} ==="


def render_debug_report(analysis: dict, mapping_report, skeleton_label: str,
                        retarget: dict | None, export: dict | None) -> str:
    """The debug dump the specification asked for, as plain text."""
    lines: list[str] = []

    lines.append(section("FBX ANALYSIS"))
    lines.append("")
    lines.append(f"File: {analysis.get('file', '?')}")
    lines.append(f"FPS: {analysis.get('fps', '?')}")
    lines.append(
        f"Frames: {analysis.get('frame_start', '?')}-{analysis.get('frame_end', '?')}"
    )
    lines.append(f"Bones: {analysis.get('bone_count', '?')}")
    lines.append(f"Armature: {analysis.get('armature', '?')}")
    lines.append(f"Action: {analysis.get('action', '-')}")

    lines.append(section("DETECTED SKELETON"))
    lines.append("")
    lines.append(f"Type: {mapping_report.profile_label}")
    lines.append(f"Target: {skeleton_label}")

    lines.append(section("BONE MAPPING"))
    lines.append("")
    marks = {"auto": "OK", "uncertain": "??", "missing": "--"}
    for row in mapping_report.mappings:
        mark = marks.get(row.confidence, "?")
        if row.source:
            lines.append(f"{row.source} -> {row.target} [{mark}] ({row.method})")
        else:
            lines.append(f"(none) -> {row.target} [{mark}]")
    if mapping_report.unmapped_sources:
        lines.append("")
        lines.append("Unmapped source bones:")
        for name in mapping_report.unmapped_sources:
            lines.append(f"  - {name}")
    if mapping_report.ignored_sources:
        lines.append("")
        lines.append(f"Ignored source bones: {len(mapping_report.ignored_sources)}")

    lines.append(section("RETARGET"))
    lines.append("")
    if retarget:
        for key, value in retarget.items():
            lines.append(f"{key}: {value}")
        lines.append("Status: SUCCESS")
    else:
        lines.append("Status: NOT RUN")

    lines.append(section("EXPORT"))
    lines.append("")
    if export:
        for key, value in export.items():
            lines.append(f"{key}: {value}")
    else:
        lines.append("Status: NOT RUN")

    return "\n".join(lines)
