"""주간 요약: private/archive의 최근 7일 수업 결과를 모아 AI가 정리 → out/weekly-<연도>W<주>.zip"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone

from . import SCHEMA_VERSION, VERSION
from .build import ask_json, load_prompt, log, render
from .package import write_package
from .validate import ValidationError, validate_weekly


def build_weekly(cfg, provider, end: date | None = None) -> dict:
    end = end or date.today()
    start = end - timedelta(days=6)
    lessons = []
    for p in sorted(cfg.archive.glob("les_*.json")) if cfg.archive.is_dir() else []:
        l = json.loads(p.read_text(encoding="utf-8"))
        d = date.fromisoformat(l["date"][:10])
        if start <= d <= end:
            lessons.append(l)
    if not lessons:
        raise ValidationError(f"{start} ~ {end} 사이에 처리된 수업이 없습니다.")
    compact = [{
        "lessonId": l["id"], "date": l["date"][:10], "title": l.get("title", ""),
        "corrections": [{"original": c["original"], "corrected": c["corrected"]} for c in l["corrections"]],
        "expressions": [{"text": e["text"], "meaningKo": e.get("meaningKo", "")} for e in l["expressions"]],
        "upgrades": [{"original": u["original"], "suggestion": u["suggestion"]} for u in l["upgrades"]],
    } for l in lessons]
    log(f"  · 수업 {len(lessons)}개로 주간 요약 작성 — {provider.name}")
    system, user = load_prompt("weekly")
    warnings: list[str] = []
    data = ask_json(provider, system, render(user, **{"from": str(start), "to": str(end),
                                                      "lessons": json.dumps(compact, ensure_ascii=False, indent=1)}),
                    "weekly", validate_weekly, warnings)
    y, w, _ = end.isocalendar()
    wid = f"wk_{y}W{w:02d}"
    weekly = {
        "schemaVersion": SCHEMA_VERSION, "id": wid, "from": str(start), "to": str(end),
        "lessonIds": [l["id"] for l in lessons], **data,
        "generator": {"tool": "langdy-processor", "version": VERSION, "createdAt":
                      datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
                      "llm": {"provider": provider.name, "model": getattr(provider, "model", "")}},
    }
    out = cfg.out / f"weekly-{y}W{w:02d}.zip"
    write_package("weekly", {"weekly.json": json.dumps(weekly, ensure_ascii=False, indent=1).encode("utf-8")}, out)
    return {"id": wid, "zip": str(out), "lessons": len(lessons), "warnings": warnings}
