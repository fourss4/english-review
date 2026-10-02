"""AI 응답 검증·정리. 알 수 없는 필드는 버리고, 길이·개수를 제한하고, 문제 형식을 점검한다.

반환: (정리된 데이터, 경고 목록). 치명적 문제(필수 항목 없음 등)는 ValidationError.
"""
from __future__ import annotations

from .textutil import norm

MAX_TEXT = 1500
MAX_ITEMS = 40
TYPES = {"cloze", "choice", "meaning", "situation"}


class ValidationError(ValueError):
    pass


def _s(v, limit=MAX_TEXT):
    return norm(v)[:limit] if isinstance(v, str) and norm(v) else None


def _num(v):
    return round(float(v), 2) if isinstance(v, (int, float)) and not isinstance(v, bool) and v >= 0 else None


def _examples(v, max_n=3):
    out = []
    for x in (v if isinstance(v, list) else [])[:max_n]:
        if isinstance(x, str) and _s(x):
            out.append({"en": _s(x)})
        elif isinstance(x, dict) and _s(x.get("en")):
            e = {"en": _s(x["en"])}
            if _s(x.get("ko")):
                e["ko"] = _s(x["ko"])
            out.append(e)
    return out


def _src(v, default):
    return v if v in ("chat", "comment", "transcript") else default


def validate_extract(obj) -> tuple[dict, list[str]]:
    if not isinstance(obj, dict):
        raise ValidationError("최상위가 JSON 객체가 아닙니다.")
    warn: list[str] = []
    cors, exps, ups = [], [], []
    for c in (obj.get("corrections") or [])[:MAX_ITEMS]:
        if not isinstance(c, dict) or not _s(c.get("original")) or not _s(c.get("corrected")):
            warn.append("교정 1개 제외(틀린 문장 또는 교정 없음)")
            continue
        o = {"original": _s(c["original"]), "corrected": _s(c["corrected"])}
        for k in ("natural", "explanationKo", "meaningKo"):
            if _s(c.get(k)):
                o[k] = _s(c[k])
        o["source"] = _src(c.get("source"), "chat")
        if _num(c.get("offsetSec")) is not None and o["source"] == "transcript":
            o["offsetSec"] = _num(c["offsetSec"])
        ai = {k: True for k, f in (("corrected", "aiCorrected"), ("natural", "aiNatural")) if c.get(f) is True}
        if ai:
            o["ai"] = ai
        cors.append(o)
    seen = set()
    for e in (obj.get("expressions") or [])[:MAX_ITEMS]:
        if not isinstance(e, dict) or not _s(e.get("text")):
            continue
        key = _s(e["text"]).lower()
        if key in seen:
            continue
        seen.add(key)
        o = {"text": _s(e["text"], 200)}
        if e.get("isKey") is True:
            o["isKey"] = True
        for k in ("pattern", "definition", "meaningKo"):
            if _s(e.get(k)):
                o[k] = _s(e[k])
        ex = _examples(e.get("examples"))
        if ex:
            o["examples"] = ex
        o["source"] = _src(e.get("source"), "chat")
        exps.append(o)
    for u in (obj.get("upgrades") or [])[:10]:
        need = ("original", "suggestion", "meaningKo", "explanationKo")
        if not isinstance(u, dict) or not all(_s(u.get(k)) for k in need):
            warn.append("표현 업그레이드 1개 제외(필수 칸 없음)")
            continue
        o = {k: _s(u[k]) for k in need}
        o["category"] = u.get("category") if u.get("category") in ("slang", "idiom", "better_expression") else "better_expression"
        if u.get("register") in ("casual", "neutral", "formal"):
            o["register"] = u["register"]
        if _num(u.get("offsetSec")) is not None:
            o["offsetSec"] = _num(u["offsetSec"])
        o["examples"] = _examples(u.get("examples"))
        for k in ("situationKo", "opicQuestion"):
            if _s(u.get(k)):
                o[k] = _s(u[k])
        ups.append(o)
    if len(ups) != 3:
        warn.append(f"표현 업그레이드가 {len(ups)}개입니다(요청 3개).")
    if not cors and not exps and not ups:
        raise ValidationError("교정·표현·업그레이드가 모두 비어 있습니다.")
    return {"corrections": cors, "expressions": exps, "upgrades": ups[:3]}, warn


def _clean_ex(x, refs: set) -> tuple[dict | None, str | None]:
    if not isinstance(x, dict):
        return None, "형식 오류"
    ref, typ = x.get("ref"), x.get("type")
    if ref not in refs:
        return None, f"없는 항목 참조({ref})"
    if typ not in TYPES:
        return None, f"알 수 없는 유형({typ})"
    prompt, answer = _s(x.get("prompt"), 600), _s(x.get("answer"), 600)
    if typ == "situation" and not prompt:
        prompt = "Which expression fits?"
    if not prompt or not answer:
        return None, "문제 또는 정답 없음"
    o = {"ref": ref, "type": typ, "prompt": prompt, "answer": answer}
    if typ == "cloze":
        if prompt.count("_____") != 1:
            return None, "빈칸(_____)이 정확히 1개가 아님"
        if len(answer.split()) > 6:
            return None, "빈칸 정답이 너무 김"
        acc = [a for a in (_s(v, 100) for v in (x.get("accept") or [])) if a and a.lower() != answer.lower()]
        if acc:
            o["accept"] = acc[:5]
    if typ in ("choice", "situation"):
        opts = []
        for v in x.get("options") or []:
            v = _s(v, 300)
            if v and v.lower() not in [p.lower() for p in opts]:
                opts.append(v)
        match = [p for p in opts if p.lower() == answer.lower()]
        if not 2 <= len(opts) <= 5 or not match:
            return None, "선택지 수가 맞지 않거나 정답이 선택지에 없음"
        o["options"], o["answer"] = opts, match[0]
    for k in ("promptKo", "explanationKo"):
        if _s(x.get(k)):
            o[k] = _s(x[k], 600)
    return o, None


def validate_practice(obj, refs: set) -> tuple[dict, list[str]]:
    if not isinstance(obj, dict):
        raise ValidationError("최상위가 JSON 객체가 아닙니다.")
    warn: list[str] = []
    exercises = []
    for x in (obj.get("exercises") or [])[:400]:
        o, err = _clean_ex(x, refs)
        if err:
            warn.append(f"문제 1개 제외: {err}")
        else:
            exercises.append(o)
    covered = {e["ref"] for e in exercises}
    missing = sorted(refs - covered)
    if missing:
        warn.append(f"문제가 없는 항목: {', '.join(missing)} (앱이 기본 문제로 대체)")
    prep = {"expressions": [], "questions": []}
    p = obj.get("prep") if isinstance(obj.get("prep"), dict) else {}
    for e in (p.get("expressions") or [])[:5]:
        if isinstance(e, dict) and _s(e.get("text")):
            o = {"text": _s(e["text"], 200)}
            if _s(e.get("howToUseKo")):
                o["howToUseKo"] = _s(e["howToUseKo"])
            if e.get("ref") in refs:
                o["ref"] = e["ref"]
            prep["expressions"].append(o)
    prep["questions"] = [q for q in (_s(v, 300) for v in (p.get("questions") or [])[:5]) if q]
    opic = []
    for q in (obj.get("opic") or [])[:3]:
        if isinstance(q, dict) and _s(q.get("question")):
            o = {"question": _s(q["question"], 500)}
            if _s(q.get("questionKo")):
                o["questionKo"] = _s(q["questionKo"], 500)
            o["structureKo"] = [s for s in (_s(v, 200) for v in (q.get("structureKo") or [])[:5]) if s]
            o["targetRefs"] = [r for r in (q.get("targetRefs") or []) if r in refs][:4]
            sec = q.get("seconds")
            o["seconds"] = int(sec) if isinstance(sec, int) and 30 <= sec <= 180 else 90
            opic.append(o)
    bad_ratio = (len([w for w in warn if w.startswith("문제 1개 제외")]) / max(1, len(obj.get("exercises") or [])))
    return {"exercises": exercises, "prep": prep, "opic": opic, "_badRatio": bad_ratio}, warn


def validate_weekly(obj) -> tuple[dict, list[str]]:
    if not isinstance(obj, dict):
        raise ValidationError("최상위가 JSON 객체가 아닙니다.")
    hl = [h for h in (_s(v, 400) for v in (obj.get("highlightsKo") or [])[:6]) if h]
    if not hl:
        raise ValidationError("highlightsKo가 비어 있습니다.")
    top = []
    for t in (obj.get("topExpressions") or [])[:8]:
        if isinstance(t, dict) and _s(t.get("text")):
            o = {"text": _s(t["text"], 200)}
            for k in ("meaningKo", "lessonId"):
                if _s(t.get(k)):
                    o[k] = _s(t[k], 300)
            top.append(o)
    mist = []
    for m in (obj.get("repeatedMistakes") or [])[:5]:
        if isinstance(m, dict) and _s(m.get("patternKo")):
            o = {"patternKo": _s(m["patternKo"], 200)}
            if _s(m.get("tipKo")):
                o["tipKo"] = _s(m["tipKo"], 400)
            o["examples"] = [{"original": _s(e.get("original")) or "", "corrected": _s(e.get("corrected")) or ""}
                             for e in (m.get("examples") or [])[:3] if isinstance(e, dict)]
            mist.append(o)
    focus = [f for f in (_s(v, 400) for v in (obj.get("focusNextWeekKo") or [])[:4]) if f]
    return {"highlightsKo": hl, "topExpressions": top, "repeatedMistakes": mist, "focusNextWeekKo": focus}, []
