"""Typed errors for the converter.

Each error carries a short ``title`` and a ``detail`` block so the GUI can render
the exact messages the specification asked for without string-matching on
exception text, and so the CLI can print the same thing.
"""

from __future__ import annotations


class ConverterError(Exception):
    """Base class for every failure the user is expected to be able to act on."""

    title = "Conversion failed"

    def __init__(self, detail: str = "", hint: str = ""):
        self.detail = detail
        self.hint = hint
        super().__init__(detail or self.title)

    def render(self) -> str:
        parts = ["ERROR", "", self.title]
        if self.detail:
            parts += ["", self.detail]
        if self.hint:
            parts += ["", self.hint]
        return "\n".join(parts)


class BlenderNotFoundError(ConverterError):
    title = "Blender was not found."

    def __init__(self, detail: str = "", hint: str = ""):
        super().__init__(
            detail or "No Blender installation could be located automatically.",
            hint or "Please install Blender, or select your blender.exe manually.",
        )


class NoArmatureError(ConverterError):
    title = "No animatable skeleton was found in the FBX."

    def __init__(self, detail: str = "", hint: str = ""):
        super().__init__(
            detail or "The imported file contains no armature object.",
            hint or "Export the FBX with 'Armature' included, and make sure it "
                    "contains a rig rather than only static meshes.",
        )


class NoAnimationError(ConverterError):
    title = "The FBX contains a skeleton but no animation."

    def __init__(self, detail: str = "", hint: str = ""):
        super().__init__(
            detail or "No action / keyframe data is attached to the armature.",
            hint or "Re-export from your source tool with animation baked in.",
        )


class BoneMappingError(ConverterError):
    title = "The skeleton could not be recognised automatically."

    def __init__(self, unmapped: list[str], detail: str = ""):
        self.unmapped = unmapped
        listing = "\n".join(f"- {name}" for name in unmapped[:40])
        if len(unmapped) > 40:
            listing += f"\n- ... and {len(unmapped) - 40} more"
        super().__init__(
            detail or f"Bones that could not be mapped:\n{listing}",
            "Please check the skeleton mapping, or correct it manually in the "
            "mapping table before converting.",
        )


class SkeletonProfileError(ConverterError):
    title = "No GTA V skeleton profile is configured."

    def __init__(self, detail: str = "", hint: str = ""):
        super().__init__(
            detail
            or "A real GTA V ped skeleton is required to produce correct "
               "animation data, and none has been set up yet.",
            hint
            or "Export a ped .yft to XML with CodeWalker and load it once via "
               "'Select GTA V skeleton'. See docs/SKELETON_SETUP.md.",
        )


class BlenderRunError(ConverterError):
    title = "The Blender step failed."

    def __init__(self, detail: str = "", log_path: str | None = None):
        self.log_path = log_path
        hint = f"The full Blender console output was saved to:\n{log_path}" if log_path else ""
        super().__init__(detail, hint)


class ExportError(ConverterError):
    title = "Export failed."


class SidecarNotFoundError(ConverterError):
    title = "The CodeWalker bridge (codewalker-bridge) was not found."

    def __init__(self, detail: str = "", hint: str = ""):
        super().__init__(
            detail
            or "The binary .ycd step needs the codewalker-bridge sidecar, which "
               "has not been built.",
            hint
            or "Build it with `npm run build:sidecar` from the repository root, "
               "or point at it with FIVEM_ANIM_BRIDGE. The .ycd.xml has still "
               "been written and can be converted with CodeWalker's Import XML.",
        )
