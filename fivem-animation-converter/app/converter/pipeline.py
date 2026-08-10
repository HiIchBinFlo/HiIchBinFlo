"""The conversion pipeline, start to finish.

Used by both the GUI and the CLI, so the two can never drift apart. The whole
run is expressed as a sequence of stages that report progress through a callback:

    analyse -> map -> retarget -> build XML -> compile .ycd -> build resource
"""

from __future__ import annotations

import json
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from ..blender.locator import BlenderTarget, find_blender
from ..blender.runner import BlenderRunner
from ..exporter import bridge as bridge_mod
from ..exporter.resource import generate_resource
from ..exporter.ycd_xml import BoneTrack, ClipDictionaryBuilder, sanitize_name
from ..mapping.bone_mapper import MISSING, UNCERTAIN, BoneMapper, MappingTables
from ..utils.errors import (
    BlenderNotFoundError,
    BlenderRunError,
    BoneMappingError,
    ConverterError,
    ExportError,
    NoAnimationError,
    NoArmatureError,
    SkeletonProfileError,
)
from ..utils.logging_setup import new_log_file, render_debug_report, setup_logger
from .skeleton import SkeletonProfile, load_any

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MAPPINGS_DIR = PROJECT_ROOT / "mappings"
LOGS_DIR = PROJECT_ROOT / "logs"
OUTPUT_DIR = PROJECT_ROOT / "output"

ProgressFn = Callable[[int, str], None]


@dataclass
class ConversionOptions:
    source: Path
    name: str
    skeleton_profile: Path | None = None
    output_dir: Path = OUTPUT_DIR
    fps: int = 30
    blender_path: str | None = None
    auto_mapping: bool = True
    retarget: bool = True
    optimize: bool = True
    generate_resource: bool = True
    generate_test_resource: bool = False
    align_rest_pose: bool = True
    root_motion: str = "keep"
    debug: bool = False
    mapping_overrides: dict[str, str | None] = field(default_factory=dict)
    keep_intermediates: bool = False


@dataclass
class ConversionResult:
    ok: bool
    name: str
    clip: str
    log_path: Path
    ycd_xml: Path | None = None
    ycd: Path | None = None
    resource_dir: Path | None = None
    test_resource_dir: Path | None = None
    debug_report: str = ""
    warnings: list[str] = field(default_factory=list)
    analysis: dict = field(default_factory=dict)
    retarget_info: dict = field(default_factory=dict)


def analyze_source(
    source: Path,
    blender: BlenderTarget,
    logger,
    workdir: Path,
) -> dict:
    """Stage 1: what is in this file?"""
    runner = BlenderRunner(blender, logger=logger)
    analysis_path = workdir / "analysis.json"
    result = runner.run("analyze.py", input=str(source), output=str(analysis_path))

    if not analysis_path.is_file():
        raise BlenderRunError(
            "Blender did not produce an analysis. Its output was:\n\n"
            + (result.combined[-4000:] or "(no output)")
        )

    analysis = json.loads(analysis_path.read_text(encoding="utf-8"))
    if not analysis.get("ok", False):
        code = analysis.get("error")
        if code == "no_armature":
            raise NoArmatureError()
        if code == "no_animation":
            raise NoAnimationError()
        raise BlenderRunError(analysis.get("message", "Analysis failed."))
    return analysis


def build_mapping(analysis: dict, profile: SkeletonProfile, overrides: dict,
                  logger):
    """Stage 2: source bones -> GTA bones, restricted to the real skeleton."""
    tables = MappingTables(MAPPINGS_DIR)
    mapper = BoneMapper(tables)
    report = mapper.build([b["name"] for b in analysis["bones"]])
    if overrides:
        mapper.apply_overrides(report, overrides)

    # The reference table lists the standard ped skeleton; the user's actual
    # skeleton is the authority on which bones exist and what their tags are.
    available = {b.name for b in profile.bones}
    dropped = []
    for row in report.mappings:
        if row.target not in available:
            if row.source:
                dropped.append(row.target)
            row.source = None
            row.confidence = MISSING
            row.method = "not-in-skeleton"
    if dropped:
        logger.warning(
            "%d mapped bones are not present in the loaded skeleton and were "
            "skipped: %s", len(dropped), ", ".join(sorted(dropped))
        )
    return report, tables


def validate_mapping(report, tables) -> list[str]:
    """Refuse to convert something that cannot produce a usable animation."""
    core_missing = [m.target for m in report.mappings
                    if m.confidence == MISSING and m.is_core]
    if core_missing:
        raise BoneMappingError(
            report.unmapped_sources or core_missing,
            "The following essential bones could not be mapped:\n"
            + "\n".join(f"- {name}" for name in core_missing),
        )

    warnings = []
    uncertain = [m for m in report.mappings if m.confidence == UNCERTAIN]
    if uncertain:
        warnings.append(
            f"{len(uncertain)} bone(s) were matched only approximately: "
            + ", ".join(f"{m.source} -> {m.target}" for m in uncertain[:8])
        )
    return warnings


def retarget(options: ConversionOptions, profile: SkeletonProfile, report,
             blender: BlenderTarget, logger, workdir: Path) -> dict:
    """Stage 3: run the retarget in Blender and read back the tracks."""
    skeleton_path = workdir / "skeleton.json"
    profile.save(skeleton_path)

    rows = []
    for row in report.mappings:
        if not row.source:
            continue
        rest = profile.by_name(row.target)
        if rest is None:
            continue
        rows.append({"source": row.source, "target": row.target, "tag": rest.tag})
    if not rows:
        raise BoneMappingError([], "No bone could be mapped onto the target skeleton.")

    mapping_path = workdir / "mapping.json"
    mapping_path.write_text(json.dumps({"mappings": rows}, indent=2), encoding="utf-8")

    animation_path = workdir / "animation.json"
    runner = BlenderRunner(blender, logger=logger)
    result = runner.run(
        "convert.py",
        input=str(options.source),
        skeleton=str(skeleton_path),
        mapping=str(mapping_path),
        output=str(animation_path),
        fps=options.fps,
        root_motion=options.root_motion,
        # With retargeting switched off the source is taken to be already built
        # on the GTA V skeleton, so neither the rest-pose correction nor the
        # proportion rescaling should be applied.
        align_rest=1 if (options.align_rest_pose and options.retarget) else 0,
        hip_scale=1 if options.retarget else 0,
    )

    if not animation_path.is_file():
        raise BlenderRunError(
            "The retarget did not produce any animation data. Blender's output "
            "was:\n\n" + (result.combined[-4000:] or "(no output)")
        )
    return json.loads(animation_path.read_text(encoding="utf-8"))


def build_xml(animation: dict, clip_name: str, optimize: bool) -> str:
    """Stage 4: turn the retargeted tracks into Clip Dictionary XML."""
    tracks = [
        BoneTrack(
            bone_tag=t["bone_tag"],
            track=t["track"],
            frames=[tuple(f) for f in t["frames"]],
        )
        for t in animation["tracks"]
        if t["frames"]
    ]
    if not tracks:
        raise ExportError("The retarget produced no animated tracks.")

    builder = ClipDictionaryBuilder(
        clip_name=clip_name,
        frame_count=animation["frame_count"],
        fps=animation["fps"],
        tracks=tracks,
        optimize=optimize,
    )
    return builder.build()


def compile_ycd(xml_path: Path, ycd_path: Path, logger) -> tuple[Path | None, list[str]]:
    """Stage 5: XML -> binary .ycd, via the sidecar. Degrades, never fakes."""
    warnings: list[str] = []
    bridge = bridge_mod.find_bridge()
    if bridge is None:
        warnings.append(
            "The codewalker-bridge sidecar was not found, so no binary .ycd was "
            "produced. The .ycd.xml is complete - build the sidecar with "
            "`npm run build:sidecar`, or convert the XML with CodeWalker's "
            "'Import XML'."
        )
        logger.warning(warnings[-1])
        return None, warnings

    logger.info("Compiling .ycd with %s", bridge)
    result = bridge_mod.xml_to_ycd(bridge, xml_path, ycd_path)
    if not result.ok:
        raise ExportError(
            f"The CodeWalker bridge could not compile the animation:\n{result.error}"
        )

    logger.info(
        "Wrote %s (%s bytes, %s clip(s), %s animation(s))",
        ycd_path, result.data.get("bytes"), result.data.get("clipCount"),
        result.data.get("animationCount"),
    )
    return ycd_path, warnings


def convert(options: ConversionOptions,
            progress: ProgressFn | None = None) -> ConversionResult:
    """Run the whole pipeline."""
    def report_progress(percent: int, message: str) -> None:
        if progress:
            progress(percent, message)

    log_path = new_log_file(LOGS_DIR)
    logger = setup_logger(log_path, debug=options.debug)
    logger.info("FBX -> FiveM animation conversion")
    logger.info("Source: %s", options.source)

    name = sanitize_name(options.name)
    clip = name
    warnings: list[str] = []

    source = Path(options.source)
    if not source.is_file():
        raise ConverterError(f"Input file not found: {source}")

    if not options.skeleton_profile:
        raise SkeletonProfileError()
    profile = load_any(Path(options.skeleton_profile))
    logger.info("Target skeleton: %s (%d bones)", profile.label, len(profile.bones))

    report_progress(5, "Looking for Blender...")
    blender = find_blender(options.blender_path)
    if blender is None:
        raise BlenderNotFoundError()
    logger.info("Blender: %s", blender.label)

    workdir = Path(tempfile.mkdtemp(prefix="fivem-anim-"))
    try:
        report_progress(15, "Analysing the source file...")
        analysis = analyze_source(source, blender, logger, workdir)
        logger.info(
            "Armature '%s': %d bones, %s fps, frames %s-%s",
            analysis.get("armature"), analysis.get("bone_count"),
            analysis.get("fps"), analysis.get("frame_start"),
            analysis.get("frame_end"),
        )

        report_progress(35, "Mapping bones...")
        mapping_report, tables = build_mapping(
            analysis, profile, options.mapping_overrides, logger
        )
        warnings.extend(validate_mapping(mapping_report, tables))
        mapped = len([m for m in mapping_report.mappings if m.source])
        logger.info("Mapped %d bones (profile: %s)", mapped, mapping_report.profile_label)

        report_progress(55, "Retargeting animation...")
        animation = retarget(options, profile, mapping_report, blender, logger, workdir)
        logger.info(
            "Retargeted %d frames at %s fps (%.3f s)",
            animation["frame_count"], animation["fps"], animation["duration"],
        )

        report_progress(75, "Building clip dictionary...")
        xml = build_xml(animation, clip, options.optimize)

        out_root = Path(options.output_dir)
        out_root.mkdir(parents=True, exist_ok=True)
        xml_path = workdir / f"{name}.ycd.xml"
        xml_path.write_text(xml, encoding="utf-8")
        logger.info("Clip dictionary XML: %d bytes", len(xml))

        report_progress(85, "Compiling .ycd...")
        ycd_path, compile_warnings = compile_ycd(xml_path, workdir / f"{name}.ycd", logger)
        warnings.extend(compile_warnings)

        report_progress(93, "Generating FiveM resource...")
        resource_dir = test_dir = None
        final_xml = out_root / f"{name}.ycd.xml"
        shutil.copyfile(xml_path, final_xml)
        final_ycd = None
        if ycd_path is not None:
            final_ycd = out_root / f"{name}.ycd"
            shutil.copyfile(ycd_path, final_ycd)

        if options.generate_resource:
            resource = generate_resource(
                out_root, name, clip, ycd_path, xml_path,
                frame_count=animation["frame_count"],
                fps=animation["fps"],
                duration=animation["duration"],
                bone_count=len({t["bone_tag"] for t in animation["tracks"]}),
                skeleton=profile.label,
                source_file=source.name,
                with_test_resource=options.generate_test_resource,
            )
            resource_dir = resource.root
            test_dir = resource.test_root
            logger.info("Resource: %s", resource_dir)

        debug_report = render_debug_report(
            analysis, mapping_report, profile.label,
            animation.get("retarget"),
            {
                "Target": "GTA V",
                "Format": "YCD",
                "Frames": animation["frame_count"],
                "FPS": animation["fps"],
                "Tracks": len(animation["tracks"]),
                "Binary .ycd": "yes" if ycd_path else "no (XML only)",
                "Status": "SUCCESS",
            },
        )
        if options.debug:
            logger.debug("%s", debug_report)

        report_progress(100, "Done")
        return ConversionResult(
            ok=True,
            name=name,
            clip=clip,
            log_path=log_path,
            ycd_xml=final_xml,
            ycd=final_ycd,
            resource_dir=resource_dir,
            test_resource_dir=test_dir,
            debug_report=debug_report,
            warnings=warnings,
            analysis=analysis,
            retarget_info=animation.get("retarget", {}),
        )
    finally:
        if options.keep_intermediates:
            logger.info("Intermediate files kept in %s", workdir)
        else:
            shutil.rmtree(workdir, ignore_errors=True)
