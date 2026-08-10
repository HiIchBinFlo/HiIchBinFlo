"""Entry point: GUI by default, CLI when arguments are given.

    python -m app.main                          # launch the GUI
    python -m app.main convert dance.fbx --name my_dance
    python -m app.main skeleton mp_m_freemode_01.yft.xml
    python -m app.main doctor
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Allow `python app/main.py` as well as `python -m app.main`.
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    __package__ = "app"

from .blender.locator import find_blender  # noqa: E402
from .converter.pipeline import (  # noqa: E402
    LOGS_DIR,
    OUTPUT_DIR,
    ConversionOptions,
    convert,
)
from .converter.skeleton import load_any  # noqa: E402
from .exporter import bridge as bridge_mod  # noqa: E402
from .utils.config import Settings  # noqa: E402
from .utils.errors import ConverterError  # noqa: E402


def cmd_doctor(_args) -> int:
    """Report whether the environment can actually do a conversion."""
    settings = Settings.load()
    print("FBX -> FiveM Animation Converter - environment check")
    print()

    blender = find_blender(settings.blender_path)
    print(f"  Blender ........... {blender.label if blender else 'NOT FOUND'}")

    bridge = bridge_mod.find_bridge()
    if bridge:
        result = bridge_mod.probe(bridge)
        detail = (
            f"{bridge} (CodeWalker.Core {result.data.get('codeWalkerCoreVersion', '?')})"
            if result.ok else f"{bridge} - probe failed: {result.error}"
        )
    else:
        detail = "NOT BUILT (XML output only - run `npm run build:sidecar`)"
    print(f"  CodeWalker bridge . {detail}")

    profile_path = settings.skeleton_profile
    if profile_path and Path(profile_path).is_file():
        try:
            profile = load_any(Path(profile_path))
            print(f"  GTA V skeleton .... {profile.label} ({len(profile.bones)} bones)")
        except ConverterError as exc:
            print(f"  GTA V skeleton .... INVALID: {exc.detail}")
    else:
        print("  GTA V skeleton .... NOT CONFIGURED (see docs/SKELETON_SETUP.md)")

    print()
    print(f"  Config ............ {Settings.path()}")
    print(f"  Logs .............. {LOGS_DIR}")
    print(f"  Output ............ {OUTPUT_DIR}")

    ready = bool(blender) and bool(profile_path)
    print()
    print("  Ready to convert:  " + ("yes" if ready else "no"))
    return 0 if ready else 1


def cmd_skeleton(args) -> int:
    """Load a skeleton once and remember it."""
    source = Path(args.source)
    settings = Settings.load()

    if source.suffix.lower() in (".yft", ".ydd", ".ydr"):
        bridge = bridge_mod.find_bridge()
        if bridge is None:
            print(
                "ERROR\n\n"
                "Reading a binary .yft/.ydd needs the codewalker-bridge sidecar, "
                "which has not been built.\n\n"
                "Either build it (`npm run build:sidecar` in the repository root), "
                "or export the file to XML in CodeWalker and pass the .xml here.",
                file=sys.stderr,
            )
            return 2
        target = Path(args.output or (LOGS_DIR.parent / "skeleton_profile.json"))
        result = bridge_mod.dump_skeleton(bridge, source, target)
        if not result.ok:
            print(f"ERROR\n\n{result.error}", file=sys.stderr)
            return 3
        source = target

    profile = load_any(source)
    target = Path(args.output or (LOGS_DIR.parent / "skeleton_profile.json"))
    profile.save(target)

    settings.skeleton_profile = str(target)
    settings.skeleton_source = str(args.source)
    settings.save()

    print(f"Loaded {profile.label}: {len(profile.bones)} bones")
    print(f"Saved to {target}")
    print("This skeleton will now be used for conversions.")
    return 0


def cmd_convert(args) -> int:
    settings = Settings.load()
    skeleton = args.skeleton or settings.skeleton_profile

    options = ConversionOptions(
        source=Path(args.source),
        name=args.name or Path(args.source).stem,
        skeleton_profile=Path(skeleton) if skeleton else None,
        output_dir=Path(args.output or settings.output_dir or OUTPUT_DIR),
        fps=args.fps,
        blender_path=settings.blender_path,
        retarget=not args.no_retarget,
        generate_resource=not args.no_resource,
        generate_test_resource=args.test_resource,
        align_rest_pose=not args.no_align,
        root_motion=args.root_motion,
        optimize=not args.no_optimize,
        debug=args.debug,
        keep_intermediates=args.keep_intermediates,
    )

    def progress(percent: int, message: str) -> None:
        print(f"[{percent:3d}%] {message}")

    try:
        result = convert(options, progress)
    except ConverterError as exc:
        print("\n" + exc.render(), file=sys.stderr)
        return 1

    print()
    print(f"Animation name: {result.name}")
    print(f"Clip name:      {result.clip}")
    if result.ycd:
        print(f".ycd:           {result.ycd}")
    print(f".ycd.xml:       {result.ycd_xml}")
    if result.resource_dir:
        print(f"Resource:       {result.resource_dir}")
    if result.test_resource_dir:
        print(f"Test resource:  {result.test_resource_dir}")
    print(f"Log:            {result.log_path}")

    for warning in result.warnings:
        print(f"\nWARNING: {warning}")

    if args.debug:
        print()
        print(result.debug_report)
    return 0


def cmd_gui(_args) -> int:
    try:
        from .gui.app import run_gui
    except ImportError as exc:
        print(
            "ERROR\n\nThe GUI needs PySide6, which is not installed.\n\n"
            "Install it with:  pip install -r requirements.txt\n"
            f"\n(import error: {exc})",
            file=sys.stderr,
        )
        return 2
    return run_gui()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="fivem-animation-converter",
        description="Convert an FBX animation into a FiveM-ready .ycd resource.",
    )
    sub = parser.add_subparsers(dest="command")

    convert_parser = sub.add_parser("convert", help="convert a file")
    convert_parser.add_argument("source", help="the .fbx / .dae / .bvh to convert")
    convert_parser.add_argument("--name", help="animation name (default: file stem)")
    convert_parser.add_argument("--skeleton", help="skeleton profile / .yft.xml to target")
    convert_parser.add_argument("--output", help="output directory")
    convert_parser.add_argument("--fps", type=int, default=30,
                                help="target frame rate (GTA V ped animations are 30)")
    convert_parser.add_argument("--root-motion", choices=["keep", "inplace"],
                                default="keep",
                                help="'inplace' removes horizontal hip travel")
    convert_parser.add_argument("--no-align", action="store_true",
                                help="disable A-pose/T-pose rest alignment")
    convert_parser.add_argument("--no-retarget", action="store_true",
                                help="the source rig is already built on the "
                                     "GTA V skeleton: skip rest correction and "
                                     "hip rescaling")
    convert_parser.add_argument("--no-optimize", action="store_true")
    convert_parser.add_argument("--no-resource", action="store_true",
                                help="only produce the .ycd/.ycd.xml")
    convert_parser.add_argument("--test-resource", action="store_true",
                                help="also generate the /testanim resource")
    convert_parser.add_argument("--keep-intermediates", action="store_true")
    convert_parser.add_argument("--debug", action="store_true")
    convert_parser.set_defaults(func=cmd_convert)

    skeleton_parser = sub.add_parser(
        "skeleton", help="load the GTA V ped skeleton (once)"
    )
    skeleton_parser.add_argument("source", help=".yft.xml / .ydd.xml, or binary .yft/.ydd")
    skeleton_parser.add_argument("--output", help="where to store the parsed profile")
    skeleton_parser.set_defaults(func=cmd_skeleton)

    doctor_parser = sub.add_parser("doctor", help="check the environment")
    doctor_parser.set_defaults(func=cmd_doctor)

    gui_parser = sub.add_parser("gui", help="launch the GUI (default)")
    gui_parser.set_defaults(func=cmd_gui)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, "command", None):
        return cmd_gui(args)
    try:
        return args.func(args)
    except ConverterError as exc:
        print("\n" + exc.render(), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
