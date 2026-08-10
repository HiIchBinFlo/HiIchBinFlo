"""Review and correct the bone mapping before converting.

Shows every target bone with how it was matched:

    OK  automatically recognised
    ??  uncertain (fuzzy match) - please confirm
    --  not found

Uncertain and missing rows are the ones that matter, so they sort to the top and
are colour-coded. Any row can be repointed at a different source bone, or cleared
entirely, from the combo box in the last column.
"""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QAbstractItemView,
    QCheckBox,
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QHeaderView,
    QLabel,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
)

from ..mapping.bone_mapper import AUTO, MISSING, UNCERTAIN

MARKERS = {AUTO: "OK", UNCERTAIN: "??", MISSING: "--"}
COLOURS = {
    AUTO: QColor(46, 125, 50),
    UNCERTAIN: QColor(200, 130, 0),
    MISSING: QColor(150, 40, 40),
}
NONE_LABEL = "— not mapped —"


class MappingDialog(QDialog):
    def __init__(self, report, source_bones: list[str], parent=None):
        super().__init__(parent)
        self.setWindowTitle("Bone mapping")
        self.resize(760, 620)

        self.report = report
        self.source_bones = sorted(source_bones)
        self._combos: dict[str, QComboBox] = {}

        layout = QVBoxLayout(self)

        counts = {level: 0 for level in (AUTO, UNCERTAIN, MISSING)}
        for row in report.mappings:
            if row.confidence in counts:
                counts[row.confidence] += 1

        layout.addWidget(QLabel(
            f"<b>Detected skeleton:</b> {report.profile_label}<br>"
            f"OK automatically recognised: {counts[AUTO]} &nbsp;&nbsp; "
            f"?? uncertain: {counts[UNCERTAIN]} &nbsp;&nbsp; "
            f"-- not found: {counts[MISSING]}"
        ))

        self.only_problems = QCheckBox("Show only uncertain and missing bones")
        self.only_problems.setChecked(counts[UNCERTAIN] > 0)
        self.only_problems.toggled.connect(self._apply_filter)
        layout.addWidget(self.only_problems)

        self.table = QTableWidget(len(report.mappings), 5, self)
        self.table.setHorizontalHeaderLabels(
            ["", "GTA V bone", "Tag", "Matched by", "Source bone"]
        )
        self.table.verticalHeader().setVisible(False)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        header = self.table.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(1, QHeaderView.Stretch)
        header.setSectionResizeMode(2, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(3, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(4, QHeaderView.Stretch)

        # Problems first, then the skeleton's own order.
        priority = {UNCERTAIN: 0, MISSING: 1, AUTO: 2}
        self._rows = sorted(
            enumerate(report.mappings),
            key=lambda pair: (priority.get(pair[1].confidence, 3), pair[0]),
        )

        for row_index, (_, mapping) in enumerate(self._rows):
            marker = QTableWidgetItem(MARKERS.get(mapping.confidence, "?"))
            marker.setForeground(COLOURS.get(mapping.confidence, QColor("black")))
            marker.setTextAlignment(Qt.AlignCenter)
            self.table.setItem(row_index, 0, marker)

            name_item = QTableWidgetItem(mapping.target)
            if mapping.is_core:
                font = name_item.font()
                font.setBold(True)
                name_item.setFont(font)
                name_item.setToolTip("Essential bone - the animation needs this one.")
            self.table.setItem(row_index, 1, name_item)

            self.table.setItem(row_index, 2, QTableWidgetItem(str(mapping.tag)))
            method = mapping.method
            if mapping.confidence == UNCERTAIN:
                method = f"{method} ({mapping.score:.0%})"
            self.table.setItem(row_index, 3, QTableWidgetItem(method))

            combo = QComboBox()
            combo.addItem(NONE_LABEL)
            combo.addItems(self.source_bones)
            combo.setCurrentText(mapping.source or NONE_LABEL)
            self._combos[mapping.target] = combo
            self.table.setCellWidget(row_index, 4, combo)

        layout.addWidget(self.table)

        missing_core = [m.target for m in report.mappings
                        if m.confidence == MISSING and m.is_core]
        if missing_core:
            warning = QLabel(
                "<b style='color:#963'>Essential bones are unmapped:</b> "
                + ", ".join(missing_core)
                + "<br>Conversion cannot start until these are assigned."
            )
            warning.setWordWrap(True)
            layout.addWidget(warning)

        buttons = QDialogButtonBox(
            QDialogButtonBox.Ok | QDialogButtonBox.Cancel, parent=self
        )
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

        self._apply_filter(self.only_problems.isChecked())

    def _apply_filter(self, only_problems: bool) -> None:
        for row_index, (_, mapping) in enumerate(self._rows):
            hide = only_problems and mapping.confidence == AUTO
            self.table.setRowHidden(row_index, hide)

    def overrides(self) -> dict[str, str | None]:
        """Only the rows the user actually changed."""
        changed: dict[str, str | None] = {}
        for mapping in self.report.mappings:
            combo = self._combos.get(mapping.target)
            if combo is None:
                continue
            chosen = combo.currentText()
            value = None if chosen == NONE_LABEL else chosen
            if value != mapping.source:
                changed[mapping.target] = value
        return changed
