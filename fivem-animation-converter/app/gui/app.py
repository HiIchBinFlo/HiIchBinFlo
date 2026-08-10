"""The FiveM Animation Converter window.

Drop an FBX on the drop zone, give the animation a name, press Convert. The
mapping review step in between is what keeps this honest: the user sees exactly
which bones were recognised before anything is written.

The conversion itself runs on a worker thread so the window stays responsive and
the progress bar means something.
"""

from __future__ import annotations

import os
import platform
import subprocess
import sys
from pathlib import Path

from PySide6.QtCore import QObject, Qt, QThread, Signal
from PySide6.QtGui import QDragEnterEvent, QDropEvent, QFont
from PySide6.QtWidgets import (
    QApplication,
    QCheckBox,
    QComboBox,
    QFileDialog,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QSpinBox,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

from ..blender.locator import find_blender, is_valid_blender
from ..converter.pipeline import (
    LOGS_DIR,
    OUTPUT_DIR,
    ConversionOptions,
    analyze_source,
    build_mapping,
    convert,
)
from ..converter.skeleton import load_any
from ..exporter import bridge as bridge_mod
from ..utils.config import Settings
from ..utils.errors import ConverterError
from ..utils.logging_setup import new_log_file, setup_logger
from .mapping_dialog import MappingDialog

SUPPORTED = (".fbx", ".dae", ".bvh")


class DropZone(QLabel):
    """The 'drag an FBX here' target."""

    fileDropped = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAcceptDrops(True)
        self.setAlignment(Qt.AlignCenter)
        self.setMinimumHeight(110)
        self.setText("Drag an FBX here\n(or click to browse)")
        self._set_style(False)

    def _set_style(self, active: bool) -> None:
        colour = "#4a90d9" if active else "#888"
        background = "#eef5fc" if active else "transparent"
        self.setStyleSheet(
            f"border: 2px dashed {colour}; border-radius: 8px;"
            f"background: {background}; color: #555; font-size: 14px;"
        )

    def dragEnterEvent(self, event: QDragEnterEvent) -> None:
        if self._first_supported(event) is not None:
            event.acceptProposedAction()
            self._set_style(True)

    def dragLeaveEvent(self, event) -> None:
        self._set_style(False)

    def dropEvent(self, event: QDropEvent) -> None:
        self._set_style(False)
        path = self._first_supported(event)
        if path:
            self.fileDropped.emit(path)
            event.acceptProposedAction()

    def mousePressEvent(self, event) -> None:
        path, _ = QFileDialog.getOpenFileName(
            self, "Choose an animation file", "",
            "Animations (*.fbx *.dae *.bvh);;All files (*)",
        )
        if path:
            self.fileDropped.emit(path)

    @staticmethod
    def _first_supported(event) -> str | None:
        if not event.mimeData().hasUrls():
            return None
        for url in event.mimeData().urls():
            path = url.toLocalFile()
            if path.lower().endswith(SUPPORTED):
                return path
        return None


class ConversionWorker(QObject):
    """Runs the pipeline off the UI thread."""

    progress = Signal(int, str)
    finished = Signal(object)
    failed = Signal(object)

    def __init__(self, options: ConversionOptions):
        super().__init__()
        self.options = options

    def run(self) -> None:
        try:
            result = convert(self.options, lambda p, m: self.progress.emit(p, m))
        except ConverterError as exc:
            self.failed.emit(exc)
        except Exception as exc:                      # noqa: BLE001
            self.failed.emit(ConverterError(str(exc)))
        else:
            self.finished.emit(result)


class MainWindow(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("FiveM Animation Converter")
        self.setMinimumWidth(620)

        self.settings = Settings.load()
        self.source_path: Path | None = None
        self.thread: QThread | None = None
        self.worker: ConversionWorker | None = None
        self.last_result = None

        layout = QVBoxLayout(self)

        title = QLabel("FiveM Animation Converter")
        font = QFont()
        font.setPointSize(15)
        font.setBold(True)
        title.setFont(font)
        title.setAlignment(Qt.AlignCenter)
        layout.addWidget(title)

        self.drop_zone = DropZone()
        self.drop_zone.fileDropped.connect(self.set_source)
        layout.addWidget(self.drop_zone)

        self.file_label = QLabel("File: —")
        layout.addWidget(self.file_label)

        form = QFormLayout()
        self.name_edit = QLineEdit()
        self.name_edit.setPlaceholderText("my_dance")
        form.addRow("Animation name:", self.name_edit)

        self.target_combo = QComboBox()
        self.target_combo.addItem("GTA V Ped", "gta5_ped")
        form.addRow("Target:", self.target_combo)

        self.fps_spin = QSpinBox()
        self.fps_spin.setRange(1, 240)
        self.fps_spin.setValue(self.settings.fps)
        self.fps_spin.setToolTip("Stock GTA V ped animations are authored at 30 fps.")
        form.addRow("FPS:", self.fps_spin)

        self.root_motion_combo = QComboBox()
        self.root_motion_combo.addItem("Keep root motion", "keep")
        self.root_motion_combo.addItem("In place (no horizontal travel)", "inplace")
        form.addRow("Root motion:", self.root_motion_combo)
        layout.addLayout(form)

        options_box = QGroupBox("Options")
        options_layout = QVBoxLayout(options_box)
        self.chk_auto_mapping = QCheckBox("Automatic Bone Mapping")
        self.chk_retarget = QCheckBox("Retarget Animation")
        self.chk_retarget.setToolTip(
            "On: transfer the motion through the rest-pose correspondence and\n"
            "rescale hip travel to the target's proportions.\n"
            "Off: the source rig is already built on the GTA V skeleton."
        )
        self.chk_optimize = QCheckBox("Optimize Keyframes")
        self.chk_resource = QCheckBox("Generate FiveM Resource")
        self.chk_test_resource = QCheckBox("Generate test resource (/testanim)")
        self.chk_align = QCheckBox("Align A-pose / T-pose difference")
        self.chk_debug = QCheckBox("Debug Mode")
        for box, value in (
            (self.chk_auto_mapping, self.settings.auto_mapping),
            (self.chk_retarget, self.settings.retarget),
            (self.chk_optimize, self.settings.optimize),
            (self.chk_resource, self.settings.generate_resource),
            (self.chk_test_resource, self.settings.generate_test_resource),
            (self.chk_align, self.settings.align_rest_pose),
            (self.chk_debug, self.settings.debug),
        ):
            box.setChecked(value)
            options_layout.addWidget(box)
        layout.addWidget(options_box)

        env_box = QGroupBox("Environment")
        env_layout = QVBoxLayout(env_box)

        blender_row = QHBoxLayout()
        self.blender_label = QLabel()
        blender_row.addWidget(self.blender_label, 1)
        select_blender = QPushButton("Select Blender")
        select_blender.clicked.connect(self.choose_blender)
        blender_row.addWidget(select_blender)
        env_layout.addLayout(blender_row)

        skeleton_row = QHBoxLayout()
        self.skeleton_label = QLabel()
        skeleton_row.addWidget(self.skeleton_label, 1)
        select_skeleton = QPushButton("Select GTA V skeleton")
        select_skeleton.clicked.connect(self.choose_skeleton)
        skeleton_row.addWidget(select_skeleton)
        env_layout.addLayout(skeleton_row)

        self.bridge_label = QLabel()
        env_layout.addWidget(self.bridge_label)
        layout.addWidget(env_box)

        self.convert_button = QPushButton("CONVERT")
        self.convert_button.setMinimumHeight(40)
        self.convert_button.clicked.connect(self.start_conversion)
        layout.addWidget(self.convert_button)

        self.progress_bar = QProgressBar()
        self.progress_bar.setValue(0)
        layout.addWidget(self.progress_bar)

        self.status_label = QLabel("")
        self.status_label.setWordWrap(True)
        layout.addWidget(self.status_label)

        self.debug_view = QTextEdit()
        self.debug_view.setReadOnly(True)
        self.debug_view.setVisible(False)
        self.debug_view.setMinimumHeight(180)
        self.debug_view.setFont(QFont("monospace"))
        layout.addWidget(self.debug_view)

        buttons = QHBoxLayout()
        self.open_output_button = QPushButton("Open Output Folder")
        self.open_output_button.clicked.connect(
            lambda: self.open_folder(self.output_dir())
        )
        self.open_output_button.setEnabled(False)
        buttons.addWidget(self.open_output_button)

        open_logs = QPushButton("Open Logs")
        open_logs.clicked.connect(lambda: self.open_folder(LOGS_DIR))
        buttons.addWidget(open_logs)
        layout.addLayout(buttons)

        self.refresh_environment()

    # -------------------------------------------------------------- environment

    def output_dir(self) -> Path:
        return Path(self.settings.output_dir or OUTPUT_DIR)

    def refresh_environment(self) -> None:
        blender = find_blender(self.settings.blender_path)
        if blender:
            self.blender_label.setText(f"Blender: {blender.label}")
            self.blender_label.setStyleSheet("color: #2e7d32;")
        else:
            self.blender_label.setText("Blender: not found")
            self.blender_label.setStyleSheet("color: #963;")

        profile_path = self.settings.skeleton_profile
        if profile_path and Path(profile_path).is_file():
            try:
                profile = load_any(Path(profile_path))
                self.skeleton_label.setText(
                    f"Skeleton: {profile.label} ({len(profile.bones)} bones)"
                )
                self.skeleton_label.setStyleSheet("color: #2e7d32;")
            except ConverterError:
                self.skeleton_label.setText("Skeleton: file could not be read")
                self.skeleton_label.setStyleSheet("color: #963;")
        else:
            self.skeleton_label.setText("Skeleton: not configured (required)")
            self.skeleton_label.setStyleSheet("color: #963;")

        bridge = bridge_mod.find_bridge()
        if bridge:
            self.bridge_label.setText(f"CodeWalker bridge: {bridge.name}")
            self.bridge_label.setStyleSheet("color: #2e7d32;")
        else:
            self.bridge_label.setText(
                "CodeWalker bridge: not built - the converter will write .ycd.xml "
                "only (build with `npm run build:sidecar`)"
            )
            self.bridge_label.setStyleSheet("color: #963;")
            self.bridge_label.setWordWrap(True)

    def choose_blender(self) -> None:
        filter_text = (
            "blender.exe (blender.exe);;All files (*)"
            if platform.system() == "Windows"
            else "All files (*)"
        )
        path, _ = QFileDialog.getOpenFileName(self, "Select blender.exe", "", filter_text)
        if not path:
            return
        if not is_valid_blender(path):
            QMessageBox.warning(
                self, "Not Blender",
                f"{path}\n\ndoes not look like a runnable Blender executable.",
            )
            return
        self.settings.blender_path = path
        self.settings.save()
        self.refresh_environment()

    def choose_skeleton(self) -> None:
        path, _ = QFileDialog.getOpenFileName(
            self, "Select a GTA V ped skeleton", "",
            "Skeleton sources (*.xml *.yft *.ydd *.ydr *.json);;All files (*)",
        )
        if not path:
            return

        source = Path(path)
        try:
            if source.suffix.lower() in (".yft", ".ydd", ".ydr"):
                bridge = bridge_mod.find_bridge()
                if bridge is None:
                    QMessageBox.warning(
                        self, "Bridge required",
                        "Reading a binary .yft/.ydd needs the codewalker-bridge "
                        "sidecar, which has not been built.\n\n"
                        "Either build it, or export the file to XML in CodeWalker "
                        "and select the .xml here.",
                    )
                    return
                target = OUTPUT_DIR.parent / "skeleton_profile.json"
                result = bridge_mod.dump_skeleton(bridge, source, target)
                if not result.ok:
                    QMessageBox.critical(self, "Could not read skeleton", result.error)
                    return
                source = target

            profile = load_any(source)
            stored = OUTPUT_DIR.parent / "skeleton_profile.json"
            profile.save(stored)
        except ConverterError as exc:
            QMessageBox.critical(self, exc.title, exc.detail or str(exc))
            return

        self.settings.skeleton_profile = str(stored)
        self.settings.skeleton_source = path
        self.settings.save()
        self.refresh_environment()

    # ------------------------------------------------------------------- input

    def set_source(self, path: str) -> None:
        self.source_path = Path(path)
        self.file_label.setText(f"File: {self.source_path.name}")
        if not self.name_edit.text().strip():
            self.name_edit.setText(self.source_path.stem.lower().replace(" ", "_"))
        self.status_label.setText("")
        self.progress_bar.setValue(0)

    def collect_options(self) -> ConversionOptions:
        return ConversionOptions(
            source=self.source_path,
            name=self.name_edit.text().strip() or self.source_path.stem,
            skeleton_profile=Path(self.settings.skeleton_profile)
            if self.settings.skeleton_profile else None,
            output_dir=self.output_dir(),
            fps=self.fps_spin.value(),
            blender_path=self.settings.blender_path,
            auto_mapping=self.chk_auto_mapping.isChecked(),
            retarget=self.chk_retarget.isChecked(),
            optimize=self.chk_optimize.isChecked(),
            generate_resource=self.chk_resource.isChecked(),
            generate_test_resource=self.chk_test_resource.isChecked(),
            align_rest_pose=self.chk_align.isChecked(),
            root_motion=self.root_motion_combo.currentData(),
            debug=self.chk_debug.isChecked(),
        )

    def persist_settings(self, options: ConversionOptions) -> None:
        self.settings.fps = options.fps
        self.settings.auto_mapping = options.auto_mapping
        self.settings.retarget = options.retarget
        self.settings.optimize = options.optimize
        self.settings.generate_resource = options.generate_resource
        self.settings.generate_test_resource = options.generate_test_resource
        self.settings.align_rest_pose = options.align_rest_pose
        self.settings.root_motion = options.root_motion
        self.settings.debug = options.debug
        if self.source_path:
            self.settings.remember_file(str(self.source_path))
        self.settings.save()

    # -------------------------------------------------------------- conversion

    def start_conversion(self) -> None:
        if self.source_path is None:
            QMessageBox.information(self, "No file", "Drag an FBX in first.")
            return
        if not self.settings.skeleton_profile:
            QMessageBox.warning(
                self, "No GTA V skeleton",
                "A real GTA V ped skeleton is required to produce correct "
                "animation data, and none is configured.\n\n"
                "Use 'Select GTA V skeleton' - see docs/SKELETON_SETUP.md.",
            )
            return

        options = self.collect_options()
        self.persist_settings(options)

        # Show the mapping before anything is written, so uncertain matches are
        # a decision rather than a surprise.
        if options.auto_mapping:
            overrides = self.review_mapping(options)
            if overrides is None:
                return
            options.mapping_overrides = overrides

        self.convert_button.setEnabled(False)
        self.progress_bar.setValue(0)
        self.status_label.setText("Converting...")
        self.debug_view.setVisible(False)

        self.thread = QThread(self)
        self.worker = ConversionWorker(options)
        self.worker.moveToThread(self.thread)
        self.thread.started.connect(self.worker.run)
        self.worker.progress.connect(self.on_progress)
        self.worker.finished.connect(self.on_finished)
        self.worker.failed.connect(self.on_failed)
        self.worker.finished.connect(self.thread.quit)
        self.worker.failed.connect(self.thread.quit)
        self.thread.finished.connect(lambda: self.convert_button.setEnabled(True))
        self.thread.start()

    def review_mapping(self, options: ConversionOptions) -> dict | None:
        """Run analysis + mapping up front and let the user correct it.

        Returns the overrides, or ``None`` if the user cancelled.
        """
        log_path = new_log_file(LOGS_DIR)
        logger = setup_logger(log_path, debug=options.debug, name="mapping")
        import tempfile

        blender = find_blender(options.blender_path)
        if blender is None:
            QMessageBox.critical(
                self, "Blender was not found.",
                "Please install Blender, or select your blender.exe manually.",
            )
            return None

        workdir = Path(tempfile.mkdtemp(prefix="fivem-anim-map-"))
        try:
            self.status_label.setText("Analysing...")
            QApplication.processEvents()
            analysis = analyze_source(options.source, blender, logger, workdir)
            profile = load_any(Path(options.skeleton_profile))
            report, _ = build_mapping(analysis, profile, {}, logger)
        except ConverterError as exc:
            QMessageBox.critical(self, exc.title, (exc.detail or "") + "\n\n" + exc.hint)
            self.status_label.setText("")
            return None
        finally:
            import shutil
            shutil.rmtree(workdir, ignore_errors=True)

        dialog = MappingDialog(report, [b["name"] for b in analysis["bones"]], self)
        if dialog.exec() != MappingDialog.Accepted:
            self.status_label.setText("Cancelled.")
            return None

        overrides = dialog.overrides()

        # Re-check the essentials against what the user actually chose.
        effective = {m.target: m.source for m in report.mappings}
        effective.update(overrides)
        still_missing = [
            m.target for m in report.mappings
            if m.is_core and not effective.get(m.target)
        ]
        if still_missing:
            QMessageBox.warning(
                self, "Essential bones are unmapped",
                "These bones must be mapped before converting:\n\n"
                + "\n".join(f"- {name}" for name in still_missing),
            )
            return None
        return overrides

    def on_progress(self, percent: int, message: str) -> None:
        self.progress_bar.setValue(percent)
        self.status_label.setText(message)

    def on_finished(self, result) -> None:
        self.last_result = result
        self.progress_bar.setValue(100)
        self.open_output_button.setEnabled(True)

        lines = [f"Animation converted successfully — {result.name}"]
        if result.ycd:
            lines.append(f"{result.ycd.name} written")
        else:
            lines.append("XML only — no binary .ycd (see warning below)")
        if result.resource_dir:
            lines.append(f"Resource: {result.resource_dir}")
        for warning in result.warnings:
            lines.append(f"\nWarning: {warning}")
        self.status_label.setText("\n".join(lines))

        if self.chk_debug.isChecked():
            self.debug_view.setPlainText(result.debug_report)
            self.debug_view.setVisible(True)

    def on_failed(self, error: ConverterError) -> None:
        self.progress_bar.setValue(0)
        self.status_label.setText(f"Failed: {error.title}")
        box = QMessageBox(self)
        box.setIcon(QMessageBox.Critical)
        box.setWindowTitle("Conversion failed")
        box.setText(error.title)
        if error.detail:
            box.setInformativeText(error.detail)
        if error.hint:
            box.setDetailedText(error.hint)
        box.exec()

    # ------------------------------------------------------------------ helper

    @staticmethod
    def open_folder(path: Path) -> None:
        path = Path(path)
        path.mkdir(parents=True, exist_ok=True)
        system = platform.system()
        try:
            if system == "Windows":
                os.startfile(path)          # noqa: S606
            elif system == "Darwin":
                subprocess.run(["open", str(path)], check=False)
            else:
                subprocess.run(["xdg-open", str(path)], check=False)
        except OSError:
            pass


def run_gui() -> int:
    app = QApplication(sys.argv)
    app.setApplicationName("FiveM Animation Converter")
    window = MainWindow()
    window.show()
    return app.exec()
