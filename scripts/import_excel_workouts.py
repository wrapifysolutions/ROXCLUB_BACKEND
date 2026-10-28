#!/usr/bin/env python3
"""Import player-compatible Excel workouts into data/excel-workouts.json.

Phase 0/1: preserve existing wk_* catalogs. Only emit workouts that the
current session engine can start/progress/complete without new activity kinds.
"""

from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

try:
    import openpyxl
except ImportError:
    print("openpyxl is required: python -m pip install openpyxl", file=sys.stderr)
    raise SystemExit(1)

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_XLSX = Path.home() / "Downloads" / "Roxclub_Backend_Workout_Database_v3_DeveloperReady.xlsx"
OUT_WORKOUTS = ROOT / "data" / "excel-workouts.json"
OUT_REPORT = ROOT / "data" / "excel-import-report.json"

MAX_EXPANDED_ACTIVITIES = 20
UNSUPPORTED_FORMATS = {"EMOM", "AMRAP", "Partner"}
EXCLUDED_CATEGORIES = {"Warm-Ups"}

# Workouts whose Excel step rows cannot accurately represent the prescription.
FORCE_UNSUPPORTED = {
    "HYR-19": "incomplete_excel_steps_cannot_represent_prescription",
    "TRK-13": "run_interval_stored_as_instruction_player_would_omit_800m_runs",
}

CATEGORY_MAP = {
    "HYROX": "cat_hybrid_race",
    "Track": "cat_track",
    "Strength": "cat_strength",
    "Ergs": "cat_ergs",
    "Power": "cat_power",
    "Aerobic": "cat_aerobic",
    "Conditioning": "cat_conditioning",
}

IMAGE_BY_CATEGORY = {
    "cat_hybrid_race": "/workouts/placeholder-hybrid-race.jpg",
    "cat_track": "/workouts/placeholder-track.jpg",
    "cat_strength": "/workouts/placeholder-strength.jpg",
    "cat_ergs": "/workouts/placeholder-ergs.jpg",
    "cat_power": "/workouts/placeholder-power.jpg",
    "cat_aerobic": "/workouts/placeholder-aerobic.jpg",
    "cat_conditioning": "/workouts/placeholder-conditioning.jpg",
    "cat_recovery": "/workouts/placeholder-recovery.jpg",
}

MOVEMENT_KIND = {
    "cardio": "run",
    "erg": "station",
    "station": "station",
    "carry": "station",
    "strength": "strength_exercise",
    "core": "strength_exercise",
    "isometric": "strength_exercise",
    "grip": "strength_exercise",
    "power": "strength_exercise",
    "bodyweight": "strength_exercise",
    "mobility": "recovery_block",
}

ICON_BY_MOVEMENT = {
    "RUN": "icons/run.png",
    "WALK": "icons/run.png",
    "BIKE": "icons/run.png",
    "SKI": "icons/skierg.png",
    "ROW": "icons/row.png",
    "SLED_PUSH": "icons/sled.png",
    "SLED_PULL": "icons/sled.png",
    "BBJ": "icons/burpee.png",
    "BURPEE": "icons/burpee.png",
    "FARMERS": "icons/farmers.png",
    "SUITCASE": "icons/farmers.png",
    "FRONT_RACK_CARRY": "icons/farmers.png",
    "SANDBAG_LUNGE": "icons/sandbag.png",
    "WALL_BALL": "icons/wall-ball.png",
    "MOBILITY": "icons/mobility.png",
}

ICON_BY_KIND = {
    "run": "icons/run.png",
    "station": "icons/station.png",
    "strength_exercise": "icons/strength.png",
    "recovery_block": "icons/mobility.png",
}


def sheet_rows(wb, name: str):
    ws = wb[name]
    rows = list(ws.iter_rows(values_only=True))
    header = [str(c).strip() if c is not None else "" for c in rows[0]]
    out = []
    for row in rows[1:]:
        if not row or all(c is None or str(c).strip() == "" for c in row):
            continue
        out.append({header[i]: row[i] if i < len(row) else None for i in range(len(header)) if header[i]})
    return out


def parse_duration_min(raw) -> int:
    text = str(raw or "").strip()
    nums = [int(n) for n in re.findall(r"\d+", text)]
    if not nums:
        return 30
    return min(nums)


def map_difficulty(intensity: str) -> str:
    value = str(intensity or "").strip().lower()
    if value in {"easy", "easy-moderate"}:
        return "Beginner"
    if value in {"moderate", "moderate-hard"}:
        return "Intermediate"
    return "Advanced"


def as_int(value):
    if value is None or value == "":
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def as_float(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def distance_to_meters(distance, unit):
    value = as_float(distance)
    if value is None:
        return None
    u = str(unit or "m").strip().lower()
    if u in {"m", "meter", "meters"}:
        return int(round(value))
    if u in {"km", "kilometer", "kilometers"}:
        return int(round(value * 1000))
    if u in {"mi", "mile", "miles"}:
        return int(round(value * 1609.34))
    return int(round(value))


def build_label(name: str, target: dict, pace: str | None, load_rule: str | None) -> str:
    parts = []
    if target.get("distanceM"):
        parts.append(f"{target['distanceM']} m")
    if target.get("reps"):
        parts.append(f"{target['reps']} reps")
    if target.get("sets"):
        parts.append(f"{target['sets']} sets")
    if target.get("durationSec"):
        parts.append(f"{target['durationSec']} sec")
    if target.get("loadKg"):
        parts.append(f"{target['loadKg']} kg")
    if pace:
        parts.append(str(pace))
    if load_rule:
        parts.append(str(load_rule))
    return " · ".join(parts) if parts else name


def build_target(step: dict) -> dict:
    target = {}
    distance_m = distance_to_meters(step.get("Distance"), step.get("Distance Unit"))
    if distance_m is not None:
        target["distanceM"] = distance_m
    reps = as_int(step.get("Reps"))
    if reps is not None:
        target["reps"] = reps
    sets = as_int(step.get("Sets"))
    if sets is not None:
        target["sets"] = sets
    duration = as_int(step.get("Duration Sec"))
    if duration is not None:
        target["durationSec"] = duration
    rest = as_int(step.get("Rest Sec"))
    if rest is not None:
        target["restSec"] = rest
    return target


def enrich_target_from_notes(target: dict, notes: str | None) -> tuple[dict, list[str]]:
    """Fill missing target fields only from explicit numbers in Excel notes. Never invent loads."""
    if not notes:
        return target, []
    text = str(notes).lower()
    added: list[str] = []

    # Skip patterns like "6 x 50 m" (distance prescriptions already handled by Distance).
    distance_repeat = re.search(r"\b(\d+)\s*[x×]\s*(\d+)\s*m\b", text)

    if "sets" not in target and "reps" not in target and not distance_repeat:
        match = re.search(r"\b(\d+)\s*[x×]\s*(\d+)\b", text)
        if match:
            target["sets"] = int(match.group(1))
            target["reps"] = int(match.group(2))
            added.append("sets_reps_from_notes")

    if "sets" not in target:
        match = re.search(r"\b(\d+)\s*[x×]\s*(?:max|quality)(?:\s+reps?)?\b", text)
        if match:
            target["sets"] = int(match.group(1))
            added.append("sets_from_notes")

    if "reps" not in target:
        match = re.search(
            r"\b(\d+)\s+(?:heavy\s+|fast\s+|light\s+|crisp\s+)*"
            r"(?:front\s+squats?|deadlifts?|box\s+jumps?|broad\s+jumps?|"
            r"kettlebell\s+swings?|med(?:icine)?[-\s]?ball\s+throws?|"
            r"wall\s+balls?|walking\s+lunges?|lunges?|pull[-\s]?ups?|"
            r"farmers?\s+carr(?:y|ies)|sled\s+push(?:es)?|sled\s+pulls?)\b",
            text,
        )
        if match:
            target["reps"] = int(match.group(1))
            added.append("reps_from_notes")

    return target, added


def target_has_work_metric(target: dict) -> bool:
    return any(key in target for key in ("distanceM", "reps", "sets", "durationSec"))


def notes_malformed(notes: str | None) -> bool:
    if not notes:
        return False
    text = str(notes).strip()
    if text.lower().startswith("station)"):
        return True
    if text.endswith("("):
        return True
    if re.match(r"^\d+\s*x\s*\(", text, flags=re.IGNORECASE):
        return True
    return False


def is_instruction_step(step: dict) -> bool:
    step_type = str(step.get("Step Type") or "").strip().lower()
    movement_type = str(step.get("Movement Type") or "").strip().lower()
    return step_type == "instruction" or movement_type == "other"


def is_movement_step(step: dict) -> bool:
    step_type = str(step.get("Step Type") or "").strip().lower()
    movement_type = str(step.get("Movement Type") or "").strip().lower()
    return step_type == "movement" and movement_type not in {"", "other"}


def expand_blocks(steps: list[dict]) -> tuple[list[dict], list[str], list[str]]:
    """Expand Block ID repeats into a linear movement list. Instructions collected separately."""
    instructions: list[str] = []
    ordered = sorted(steps, key=lambda s: int(s.get("Sequence") or 0))

    blocks: dict[str, list[dict]] = defaultdict(list)
    block_order: list[str] = []
    block_repeat: dict[str, int] = {}
    for step in ordered:
        bid = str(step.get("Block ID") or f"SEQ-{step.get('Sequence')}")
        if bid not in blocks:
            block_order.append(bid)
        blocks[bid].append(step)
        block_repeat[bid] = max(block_repeat.get(bid, 1), as_int(step.get("Repeat Count")) or 1)

    expanded: list[dict] = []
    warnings: list[str] = []
    for bid in block_order:
        block_steps = blocks[bid]
        movement_steps = [step for step in block_steps if is_movement_step(step)]
        # If every movement already encodes volume via Sets, do not multiply by Repeat Count
        # (e.g. "Finish 3 x 10 Wall Balls" wrongly marked Repeat Count=5).
        if movement_steps and all(as_int(step.get("Sets")) is not None for step in movement_steps):
            reps = 1
            if block_repeat[bid] > 1:
                warnings.append(
                    f"skipped_block_expand_{bid}_sets_define_volume_repeat_was_{block_repeat[bid]}"
                )
        else:
            reps = block_repeat[bid]

        for round_no in range(reps):
            for step in block_steps:
                notes = str(step.get("Raw Step / Notes") or "").strip()
                if is_instruction_step(step):
                    if round_no == 0 and notes:
                        instructions.append(notes)
                    continue
                step_type = str(step.get("Step Type") or "").strip().lower()
                if step_type == "rest":
                    if round_no == 0:
                        if notes:
                            instructions.append(f"Rest: {notes}")
                        elif as_int(step.get("Rest Sec")):
                            instructions.append(f"Rest {as_int(step.get('Rest Sec'))} sec")
                        else:
                            instructions.append("Rest")
                    continue
                if not is_movement_step(step):
                    continue
                clone = dict(step)
                if reps > 1:
                    clone["_expandRound"] = round_no + 1
                    clone["_expandRounds"] = reps
                expanded.append(clone)
        if reps > 1:
            warnings.append(f"expanded block {bid} x{reps}")

    return expanded, instructions, warnings


def classify_type(kinds: list[str]) -> tuple[str | None, str | None]:
    work = [k for k in kinds if k]
    uniq = set(work)
    if not work:
        return None, "no_playable_movements"
    if uniq <= {"run"}:
        return "run", None
    if uniq <= {"strength_exercise"}:
        return "strength", None
    if uniq <= {"recovery_block"}:
        return "recovery", None
    if "recovery_block" in uniq and uniq - {"recovery_block"}:
        return None, "recovery_mixed_with_other_kinds"
    if "run" in uniq and (uniq & {"station", "strength_exercise"}):
        return "hybrid", None
    if uniq <= {"station"}:
        return "hybrid", None
    if uniq <= {"station", "strength_exercise"}:
        return "strength", None
    if uniq <= {"run", "strength_exercise"}:
        return "hybrid", None
    return None, f"unsupported_kind_mix:{'+'.join(sorted(uniq))}"


def has_run_station_switch(kinds: list[str]) -> bool:
    prev = None
    for kind in kinds:
        if prev in {"run", "station"} and kind in {"run", "station"} and kind != prev:
            if {prev, kind} == {"run", "station"}:
                return True
        if kind in {"run", "station"}:
            prev = kind
    return False


def convert_step(step: dict) -> tuple[dict | None, list[str]]:
    movement_type = str(step.get("Movement Type") or "").strip().lower()
    kind = MOVEMENT_KIND.get(movement_type)
    if not kind:
        return None, []
    name = str(step.get("Movement Name") or step.get("Raw Step / Notes") or "Movement").strip()
    movement_id = str(step.get("Movement ID") or "").strip() or None
    notes = str(step.get("Raw Step / Notes") or "").strip() or None
    target = build_target(step)
    target, note_fills = enrich_target_from_notes(target, notes)
    pace = str(step.get("Pace / Intensity") or "").strip() or None
    load_rule = str(step.get("Load Rule") or "").strip() or None
    label = build_label(name, target, pace, load_rule)
    if step.get("_expandRound") and step.get("_expandRounds"):
        label = f"{label} (round {step['_expandRound']}/{step['_expandRounds']})"
        if notes:
            notes = f"{notes} (round {step['_expandRound']}/{step['_expandRounds']})"
    icon = ICON_BY_MOVEMENT.get(movement_id or "", ICON_BY_KIND[kind])
    activity = {
        "kind": kind,
        "name": name,
        "iconUrl": icon,
        "label": label,
        "target": target,
    }
    if notes:
        activity["notes"] = notes
    if load_rule:
        activity["loadRule"] = load_rule
    if pace:
        activity["paceIntensity"] = pace
    if movement_id:
        activity["movementId"] = movement_id
    return activity, note_fills


def convert_workout(row: dict, steps: list[dict], sort_order: int) -> tuple[dict | None, dict]:
    wid = str(row.get("Workout ID") or "").strip()
    title = str(row.get("Workout Name") or "").strip()
    category = str(row.get("Category") or "").strip()
    fmt = str(row.get("Format") or "").strip()
    report = {
        "id": wid,
        "title": title,
        "category": category,
        "format": fmt,
        "status": "excluded",
        "reasons": [],
        "warnings": [],
    }

    if not wid or not title:
        report["reasons"].append("missing_id_or_title")
        return None, report

    if wid in FORCE_UNSUPPORTED:
        report["reasons"].append(FORCE_UNSUPPORTED[wid])
        report["status"] = "unsupported"
        report["preservedInstructions"] = [
            str(row.get("Workout Prescription") or "").strip(),
            *[
                str(s.get("Raw Step / Notes") or "").strip()
                for s in steps
                if str(s.get("Raw Step / Notes") or "").strip()
            ],
        ]
        return None, report

    if category in EXCLUDED_CATEGORIES:
        report["reasons"].append("warm_ups_not_mapped")
        report["status"] = "unsupported"
        return None, report

    if fmt in UNSUPPORTED_FORMATS:
        report["reasons"].append(f"unsupported_format:{fmt}")
        report["status"] = "unsupported"
        return None, report

    category_id = CATEGORY_MAP.get(category)
    if not category_id:
        report["reasons"].append(f"unknown_category:{category}")
        report["status"] = "unsupported"
        return None, report

    if not steps:
        report["reasons"].append("no_steps")
        report["status"] = "unsupported"
        return None, report

    for step in steps:
        notes = str(step.get("Raw Step / Notes") or "").strip()
        if notes_malformed(notes):
            report["reasons"].append("malformed_excel_notes")
            report["status"] = "unsupported"
            report["preservedInstructions"] = [notes, str(row.get("Workout Prescription") or "").strip()]
            return None, report

    movement_steps = [s for s in steps if is_movement_step(s)]
    if not movement_steps:
        raw_notes = [
            str(s.get("Raw Step / Notes") or "").strip()
            for s in steps
            if str(s.get("Raw Step / Notes") or "").strip()
        ]
        report["reasons"].append("instruction_only")
        report["status"] = "unsupported"
        report["preservedInstructions"] = raw_notes
        return None, report

    expanded, instructions, expand_warnings = expand_blocks(steps)
    report["warnings"].extend(expand_warnings)

    activities = []
    kinds = []
    for step in expanded:
        activity, note_fills = convert_step(step)
        if activity is None:
            report["reasons"].append(
                f"unmapped_movement_type:{step.get('Movement Type')}:{step.get('Movement ID')}"
            )
            report["status"] = "unsupported"
            return None, report
        if note_fills:
            report["warnings"].append(
                f"enriched_{activity.get('movementId') or activity['name']}:{','.join(note_fills)}"
            )
        if not target_has_work_metric(activity.get("target") or {}):
            report["reasons"].append(
                f"missing_work_target:{activity.get('movementId') or activity['name']}"
            )
            report["status"] = "unsupported"
            report["preservedInstructions"] = instructions
            return None, report
        kinds.append(activity["kind"])
        activities.append(activity)

    if not activities:
        report["reasons"].append("no_playable_movements_after_expand")
        report["status"] = "unsupported"
        return None, report

    # Instruction rows that carry distance (e.g. 800 m run) cannot become player runs without
    # inventing a kind mapping; exclude when no run activity exists.
    has_run = any(kind == "run" for kind in kinds)
    for step in steps:
        if not is_instruction_step(step):
            continue
        if distance_to_meters(step.get("Distance"), step.get("Distance Unit")) is None:
            continue
        if not has_run:
            report["reasons"].append("instruction_distance_without_run_activity")
            report["status"] = "unsupported"
            report["preservedInstructions"] = instructions or [
                str(step.get("Raw Step / Notes") or "").strip()
            ]
            return None, report

    if len(activities) > MAX_EXPANDED_ACTIVITIES:
        report["reasons"].append(
            f"expanded_too_long:{len(activities)}> {MAX_EXPANDED_ACTIVITIES}"
        )
        report["status"] = "unsupported"
        report["preservedInstructions"] = instructions
        return None, report

    workout_type, type_reason = classify_type(kinds)
    if not workout_type:
        report["reasons"].append(type_reason or "unclassified_type")
        report["status"] = "unsupported"
        report["preservedInstructions"] = instructions
        return None, report

    # Roxzone only for HYROX hybrids that actually alternate run/station.
    auto_roxzone = (
        workout_type == "hybrid"
        and category == "HYROX"
        and "run" in kinds
        and "station" in kinds
        and has_run_station_switch(kinds)
    )

    purpose = str(row.get("Primary Goal") or "").strip() or title
    prescription = str(row.get("Workout Prescription") or "").strip()
    if prescription and prescription not in purpose:
        purpose = f"{purpose} {prescription}".strip()

    tags = []
    raw_tags = str(row.get("Tags") or "")
    for part in re.split(r"[,;/|]", raw_tags):
        part = part.strip()
        if part:
            tags.append(part)
    if fmt:
        tags.append(f"format:{fmt}")
    tags.append("source:excel")
    if auto_roxzone:
        tags.append("autoRoxzone")

    if instructions:
        report["warnings"].append(f"preserved_{len(instructions)}_instruction_steps")

    for index, activity in enumerate(activities, start=1):
        activity["order"] = index

    equipment = str(row.get("Equipment") or "As prescribed").strip() or "As prescribed"

    workout = {
        "id": wid,
        "categoryId": category_id,
        "type": workout_type,
        "title": title,
        "imageUrl": IMAGE_BY_CATEGORY.get(category_id, "/workouts/placeholder-hybrid-race.jpg"),
        "durationMin": parse_duration_min(row.get("Duration")),
        "difficulty": map_difficulty(row.get("Intensity")),
        "author": "ROX CLUB",
        "equipment": equipment,
        "purpose": purpose,
        "tags": tags,
        "sortOrder": sort_order,
        "showInLibrary": True,
        "autoRoxzone": auto_roxzone,
        "format": fmt or None,
        "source": "excel",
        "activities": activities,
    }
    if instructions:
        workout["instructions"] = instructions

    if workout["format"] is None:
        del workout["format"]

    report["status"] = "imported"
    report["reasons"] = []
    report["type"] = workout_type
    report["activityCount"] = len(activities)
    report["autoRoxzone"] = auto_roxzone
    report["instructionCount"] = len(instructions)
    return workout, report


def main():
    xlsx = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_XLSX
    if not xlsx.exists():
        print(f"Excel file not found: {xlsx}", file=sys.stderr)
        raise SystemExit(1)

    wb = openpyxl.load_workbook(xlsx, data_only=True, read_only=True)
    workouts_rows = sheet_rows(wb, "All Workouts")
    steps_rows = sheet_rows(wb, "Workout Steps")

    steps_by_workout = defaultdict(list)
    for step in steps_rows:
        steps_by_workout[str(step.get("Workout ID") or "").strip()].append(step)

    imported = []
    reports = []
    sort_base = 1000
    for index, row in enumerate(workouts_rows):
        wid = str(row.get("Workout ID") or "").strip()
        workout, report = convert_workout(row, steps_by_workout.get(wid, []), sort_base + index)
        reports.append(report)
        if workout:
            imported.append(workout)

    summary = {
        "sourceFile": str(xlsx),
        "excelWorkoutCount": len(workouts_rows),
        "excelStepCount": len(steps_rows),
        "importedCount": len(imported),
        "unsupportedCount": sum(1 for r in reports if r["status"] == "unsupported"),
        "excludedCount": sum(1 for r in reports if r["status"] == "excluded"),
        "maxExpandedActivities": MAX_EXPANDED_ACTIVITIES,
        "unsupportedFormats": sorted(UNSUPPORTED_FORMATS),
        "excludedCategories": sorted(EXCLUDED_CATEGORIES),
        "forceUnsupportedIds": sorted(FORCE_UNSUPPORTED.keys()),
        "legacyCatalogPreserved": True,
    }

    OUT_WORKOUTS.write_text(json.dumps(imported, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    OUT_REPORT.write_text(
        json.dumps({"summary": summary, "workouts": reports}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    print(json.dumps(summary, indent=2))
    print(f"wrote {OUT_WORKOUTS}")
    print(f"wrote {OUT_REPORT}")


if __name__ == "__main__":
    main()
