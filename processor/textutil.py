"""텍스트 유틸: 개인정보 가림, AI 응답에서 JSON 추출, 정규화, 파일명 해석."""
from __future__ import annotations

import json
import re
import unicodedata

_QUOTES = str.maketrans({"“": '"', "”": '"', "‘": "'", "’": "'", " ": " "})


def norm(s: str) -> str:
    s = unicodedata.normalize("NFC", str(s or "")).translate(_QUOTES).replace("\r\n", "\n")
    return re.sub(r"[ \t]+", " ", s).strip()


def mask_personal(text: str, extra_words: list[str] | None = None) -> tuple[str, int]:
    """이메일·URL·@아이디·전화번호·긴 숫자·지정 단어를 가린다. (가린 텍스트, 가린 개수)"""
    count = 0

    def rep(label):
        def f(_m):
            nonlocal count
            count += 1
            return f"[{label}]"
        return f

    t = str(text or "")
    t = re.sub(r"[\w.+-]+@[\w-]+\.[\w.-]+", rep("EMAIL"), t)
    t = re.sub(r"https?://\S+", rep("URL"), t, flags=re.I)
    t = re.sub(r"(?<![\w])@[A-Za-z0-9_](?:[A-Za-z0-9_.]*[A-Za-z0-9_])?", rep("ID"), t)
    t = re.sub(r"(\+?\d{1,3}[\s.-]?)?\(?0?\d{2,3}\)?[\s.-]?\d{3,4}[\s.-]?\d{4}\b", rep("PHONE"), t)
    t = re.sub(r"\b\d{6,}\b", rep("NUMBER"), t)
    for w in extra_words or []:
        w = str(w).strip()
        if len(w) >= 2:
            t = re.sub(re.escape(w), rep("NAME"), t, flags=re.I)
    return t, count


def extract_json(text: str):
    """코드블록·앞뒤 설명이 섞인 AI 응답에서 첫 JSON 객체를 꺼낸다."""
    s = str(text or "").strip()
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", s, re.I)
    body = m.group(1) if m else s
    a, b = body.find("{"), body.rfind("}")
    if a < 0 or b <= a:
        raise ValueError("응답에서 JSON을 찾지 못했습니다.")
    return json.loads(body[a:b + 1])


def parse_lesson_name(name: str) -> dict:
    """랭디 녹음 파일명/폴더명 해석.
    '<임의>_<YYMMDD>_<과정명> - <회차> <제목>(.m4a).mp4' 또는 'YYYY-MM-DD <제목>'.
    """
    res: dict = {}
    base = re.sub(r"(\.m4a)?\.(mp4|m4a|mp3|wav)$", "", str(name), flags=re.I).strip()
    m = re.match(r"^[^_]*_(\d{6})_(.*)$", base)
    if m:
        d, base = m.group(1), m.group(2)
        res["date"] = f"20{d[:2]}-{d[2:4]}-{d[4:6]}"
    else:
        m = re.match(r"^(\d{4})[-.](\d{2})[-.](\d{2})[ _-]*(.*)$", base)
        if m:
            res["date"] = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
            base = m.group(4)
    m = re.match(r"^(.+?)\s+-\s+(\d+)\s+(.+)$", base)
    if m:
        res["course"], res["lessonNo"], res["title"] = m.group(1).strip(), int(m.group(2)), m.group(3).strip()
    elif base.strip():
        res["title"] = base.strip()
    return res


def fmt_ts(sec: float) -> str:
    s = int(sec)
    return f"{s // 60:02d}:{s % 60:02d}"


def to_vtt(segments: list[dict]) -> str:
    def t(x):
        ms = int(round(x * 1000))
        return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d}.{ms % 1000:03d}"
    out = ["WEBVTT", ""]
    for s in segments:
        txt = s["text"].replace("-->", "→").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        out += [f"{t(s['start'])} --> {t(s['end'])}", txt, ""]
    return "\n".join(out)
