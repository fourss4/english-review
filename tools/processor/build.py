"""수업 1건 처리 파이프라인 (ADR 0006).

inbox/<수업폴더>  →  녹음 텍스트 변환 → 이름 가림 → AI 추출 → AI 연습 문제 → 검증 → out/lesson-<id>.zip
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

from . import SCHEMA_VERSION, VERSION
from .package import write_package
from .textutil import extract_json, fmt_ts, mask_personal, norm, parse_lesson_name, to_vtt
from .validate import ValidationError, validate_extract, validate_practice

PROMPTS = Path(__file__).resolve().parents[1] / "prompts"
SCHEMA = Path(__file__).resolve().parents[2] / "schema" / "lesson.schema.json"
AUDIO_EXT = (".mp4", ".m4a", ".mp3", ".wav")
MIME = {".mp4": "audio/mp4", ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav"}
MAX_TEXT_CHARS = 60_000


def log(msg: str) -> None:
    print(msg, flush=True)


# ---------- 입력 ----------
def find_lesson_dirs(inbox: Path) -> list[Path]:
    if not inbox.is_dir():
        return []
    return sorted(d for d in inbox.iterdir() if d.is_dir() and not d.name.startswith((".", "_")))


def read_inputs(d: Path) -> dict:
    files = [f for f in d.iterdir() if f.is_file()]
    audio = next((f for ext in AUDIO_EXT for f in sorted(files) if f.name.lower().endswith(ext)), None)
    txts = [f for f in files if f.suffix.lower() == ".txt"]

    def pick(keys):
        # 이름이 정확히 일치하는 파일(chat.txt 등) 우선, 그다음 이름이 짧은 순
        c = sorted((f for f in txts if any(k in f.stem.lower() for k in keys)),
                   key=lambda f: (keys.index(f.stem.lower()) if f.stem.lower() in keys else 99, len(f.name), f.name))
        return c[0] if c else None

    chat, comment = pick(("chat", "채팅")), pick(("comment", "코멘트", "feedback", "피드백"))
    read = lambda f: f.read_text(encoding="utf-8-sig")[:MAX_TEXT_CHARS] if f else ""  # noqa: E731
    return {"audio": audio, "chat": read(chat), "comment": read(comment)}


def load_prompt(name: str) -> tuple[str, str]:
    text = (PROMPTS / f"{name}.md").read_text(encoding="utf-8")
    text = re.sub(r"^<!--[\s\S]*?-->\s*", "", text)
    m = re.search(r"## SYSTEM\s*\n([\s\S]*?)\n## USER\s*\n([\s\S]*)$", text)
    if not m:
        raise RuntimeError(f"프롬프트 형식 오류: {name}.md (## SYSTEM / ## USER 필요)")
    return m.group(1).strip(), m.group(2).strip()


def render(tpl: str, **v) -> str:
    for k, val in v.items():
        tpl = tpl.replace("{{" + k + "}}", val if val else "(none)")
    return tpl


def ask_json(provider, system, user, step, validator, warnings, cache: Path | None = None):
    """AI 호출 → JSON 추출 → 검증. 실패하면 이유를 알려 1회 재요청.
    cache: 성공한 응답을 저장해 두는 파일. 다음 단계에서 실패해 다시 실행할 때 같은 요청을 다시 보내지 않는다(요금 절약)."""
    if cache and cache.is_file():
        try:
            data, w = validator(json.loads(cache.read_text(encoding="utf-8")))
            data.pop("_badRatio", None)
            log(f"    (저장된 {step} 결과 재사용)")
            return data
        except (ValueError, ValidationError):
            pass
    last_err = None
    for attempt in range(2):
        prompt = user if attempt == 0 else (
            user + f"\n\nIMPORTANT: Your previous answer could not be used ({last_err}). Follow the rules and output ONLY the JSON object."
        )
        raw = provider.complete(system, prompt, step if attempt == 0 else f"{step}-retry")
        try:
            data, w = validator(extract_json(raw))
            if data.get("_badRatio", 0) > 0.3 and attempt == 0:
                last_err = "more than 30% of exercises broke the format rules"
                continue
            data.pop("_badRatio", None)
            warnings.extend(w)
            if cache:
                cache.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            return data
        except (ValueError, ValidationError) as e:
            last_err = str(e)[:200]
    raise ValidationError(f"{step}: AI 응답을 두 번 모두 사용할 수 없었습니다 ({last_err}).")


# ---------- ID ----------
def new_lesson_id(date: str, taken: set[str]) -> str:
    base = "les_" + date.replace("-", "")
    n = 1
    while f"{base}_{n:02d}" in taken:
        n += 1
    return f"{base}_{n:02d}"


def taken_ids(cfg) -> set[str]:
    ids = {p.stem for p in cfg.archive.glob("les_*.json")} if cfg.archive.is_dir() else set()
    return ids


def safe_name(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9가-힣._-]+", "_", s)[:80] or "lesson"


# ---------- 조립 ----------
def assign_ids(data: dict) -> dict:
    for i, c in enumerate(data["corrections"], 1):
        c["id"] = f"cor_{i:02d}"
    for i, e in enumerate(data["expressions"], 1):
        e["id"] = f"exp_{i:02d}"
    for i, u in enumerate(data["upgrades"], 1):
        u["id"] = f"up_{i:02d}"
    return data


def items_for_practice(data: dict) -> list[dict]:
    items = []
    for c in data["corrections"]:
        items.append({"id": c["id"], "kind": "correction", "original": c["original"], "corrected": c["corrected"],
                      "natural": c.get("natural"), "meaningKo": c.get("meaningKo")})
    for e in data["expressions"]:
        items.append({"id": e["id"], "kind": "expression", "text": e["text"], "meaningKo": e.get("meaningKo"),
                      "examples": [x["en"] for x in e.get("examples", [])]})
    for u in data["upgrades"]:
        items.append({"id": u["id"], "kind": "upgrade", "original": u["original"], "suggestion": u["suggestion"],
                      "meaningKo": u["meaningKo"], "examples": [x["en"] for x in u.get("examples", [])]})
    return items


def schema_check(lesson: dict) -> None:
    try:
        import jsonschema
    except ImportError:  # 검증 라이브러리가 없으면 건너뜀(앱에서도 검증)
        return
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    errors = sorted(jsonschema.Draft202012Validator(schema).iter_errors(lesson), key=lambda e: list(e.path))
    if errors:
        e = errors[0]
        raise ValidationError(f"수업 데이터 형식 오류: {'/'.join(map(str, e.path))} {e.message[:120]}")


def process_lesson(d: Path, cfg, provider, stt_fn=None, force: bool = False) -> dict:
    """반환: {"lessonId", "zip", "warnings", "skipped"}"""
    work = cfg.work / safe_name(d.name)
    done = work / "done.json"
    if done.is_file() and not force:
        info = json.loads(done.read_text(encoding="utf-8"))
        return {**info, "skipped": True, "warnings": []}
    work.mkdir(parents=True, exist_ok=True)
    warnings: list[str] = []
    inp = read_inputs(d)
    if not inp["audio"] and not inp["chat"] and not inp["comment"]:
        raise ValidationError(f"{d.name}: 녹음(mp4/m4a)이나 chat.txt / comment.txt가 없습니다.")

    meta = parse_lesson_name(inp["audio"].name if inp["audio"] else d.name)
    if "date" not in meta:
        meta.update({k: v for k, v in parse_lesson_name(d.name).items() if k == "date"})
    if "date" not in meta:
        src = inp["audio"] or d
        meta["date"] = datetime.fromtimestamp(src.stat().st_mtime).strftime("%Y-%m-%d")

    # 1) 녹음 → 텍스트
    tr = None
    if inp["audio"]:
        if stt_fn is None:
            from .stt import transcribe as stt_fn  # noqa: PLW0127
        log(f"  · 녹음 텍스트 변환 중 (처음엔 모델 다운로드로 시간이 더 걸립니다)…")
        tr = stt_fn(inp["audio"], cfg.stt, cache=work / "transcript.json")
        log(f"    완료: {len(tr['segments'])}줄")

    # 2) 이름 가림
    t_lines = "\n".join(f"[{fmt_ts(s['start'])}] {s['text']}" for s in (tr or {}).get("segments", []))
    t_masked, n1 = mask_personal(t_lines[:MAX_TEXT_CHARS], cfg.mask_words)
    c_masked, n2 = mask_personal(inp["chat"], cfg.mask_words)
    m_masked, n3 = mask_personal(inp["comment"], cfg.mask_words)
    log(f"  · 개인정보 가림 {n1 + n2 + n3}곳")
    title = " - ".join(str(x) for x in (meta.get("course"), meta.get("title")) if x) or d.name

    # 3) AI 추출
    log(f"  · AI 정리 1/2 (교정·표현·업그레이드) — {provider.name}")
    sys1, usr1 = load_prompt("extract")
    data = ask_json(provider, sys1, render(usr1, title=title, transcript=t_masked, chat=c_masked, comment=m_masked),
                    "extract", validate_extract, warnings, cache=None if force else work / "ai-extract.json")
    assign_ids(data)
    refs = {x["id"] for k in ("corrections", "expressions", "upgrades") for x in data[k]}

    # 4) AI 연습 문제
    log("  · AI 정리 2/2 (복습 문제·다음 수업 준비·OPIc)")
    sys2, usr2 = load_prompt("practice")
    items = json.dumps(items_for_practice(data), ensure_ascii=False, indent=1)
    prac = ask_json(provider, sys2, render(usr2, title=title, items=items), "practice",
                    lambda o: validate_practice(o, refs), warnings, cache=None if force else work / "ai-practice.json")
    counter: dict[str, int] = {}
    for ex in prac["exercises"]:
        counter[ex["ref"]] = counter.get(ex["ref"], 0) + 1
        ex["id"] = f"ex_{ex['ref']}_{counter[ex['ref']]}"
    for i, q in enumerate(prac["opic"], 1):
        q["id"] = f"opic_{i:02d}"

    # 5) 조립·검증
    lesson_id = new_lesson_id(meta["date"], taken_ids(cfg))
    now = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    lesson = {
        "schemaVersion": SCHEMA_VERSION,
        "id": lesson_id,
        "date": f"{meta['date']}T00:00:00+09:00",
        **{k: meta[k] for k in ("course", "lessonNo", "title") if k in meta},
        "corrections": data["corrections"], "expressions": data["expressions"], "upgrades": data["upgrades"],
        "exercises": prac["exercises"], "prep": prac["prep"], "opic": prac["opic"],
        "source": {
            "app": "langdy", "importedAt": now,
            "generator": {"tool": "langdy-processor", "version": VERSION, **({"stt": tr["generator"]} if tr else {}),
                          "llm": {"provider": provider.name, "model": getattr(provider, "model", "")}},
            "raw": {"chat": norm(inp["chat"]), "comment": norm(inp["comment"])},
        },
    }
    files = {}
    if inp["audio"]:
        ext = inp["audio"].suffix.lower()
        lesson["audio"] = {"file": f"audio{ext}", "mimeType": MIME.get(ext, "audio/mp4"), "originalFileName": inp["audio"].name}
        if tr and tr.get("duration"):
            lesson["durationSec"] = lesson["audio"]["durationSec"] = tr["duration"]
        lesson["transcript"] = {"generator": tr["generator"], "language": cfg.stt.language, "segments": tr["segments"]}
        files[f"audio{ext}"] = inp["audio"]
        files["transcript.vtt"] = to_vtt(tr["segments"]).encode("utf-8")
    schema_check(lesson)
    files = {"lesson.json": json.dumps(lesson, ensure_ascii=False, indent=1).encode("utf-8"), **files}

    out = cfg.out / f"lesson-{lesson_id}.zip"
    write_package("lesson", files, out)
    cfg.archive.mkdir(parents=True, exist_ok=True)
    (cfg.archive / f"{lesson_id}.json").write_text(json.dumps(lesson, ensure_ascii=False), encoding="utf-8")
    info = {"lessonId": lesson_id, "zip": str(out)}
    done.write_text(json.dumps(info, ensure_ascii=False), encoding="utf-8")
    return {**info, "skipped": False, "warnings": warnings}
