"""녹음 → 텍스트 (PC 로컬, faster-whisper). 녹음 파일은 외부로 전송하지 않는다.

모델은 처음 실행 시 한 번 내려받아 PC에 저장된다(이후 오프라인 가능).
"""
from __future__ import annotations

import json
import os
from pathlib import Path

# Windows에서 의미 없는 경고(심볼릭 링크) 숨김. 동작에는 영향 없음
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")


def _patch_av_open() -> None:
    """faster-whisper가 PyAV에 넘기는 metadata_errors 인자를 받지 않는 PyAV 버전 대비(호환 보정)."""
    try:
        import av
    except ImportError:  # pragma: no cover
        return
    orig = av.open
    if getattr(orig, "_langdy_patched", False):
        return

    def safe_open(*args, **kwargs):
        try:
            return orig(*args, **kwargs)
        except TypeError as e:
            if "metadata_errors" not in str(e):
                raise
            kwargs.pop("metadata_errors", None)
            return orig(*args, **kwargs)

    safe_open._langdy_patched = True
    av.open = safe_open


def transcribe(audio: Path, stt_cfg, cache: Path | None = None) -> dict:
    """{"segments":[{start,end,text}], "duration": 초, "generator": "..."} — cache 파일이 있으면 재사용."""
    if cache and cache.is_file():
        return json.loads(cache.read_text(encoding="utf-8"))
    try:
        from faster_whisper import WhisperModel
    except ImportError as e:  # pragma: no cover - 설치 안내
        raise RuntimeError("faster-whisper가 설치되어 있지 않습니다. tools\\setup.bat 를 먼저 실행하세요.") from e
    _patch_av_open()
    model = WhisperModel(stt_cfg.model, device=stt_cfg.device, compute_type=stt_cfg.compute_type)
    segs, info = model.transcribe(str(audio), language=stt_cfg.language or None, vad_filter=True, beam_size=5)
    total = float(info.duration or 0)
    out, next_report = [], 120.0
    for s in segs:  # 실제 변환은 여기서 진행됨(진행 상황을 2분 단위로 표시)
        t = s.text.strip()
        if t:
            out.append({"start": round(s.start, 2), "end": round(s.end, 2), "text": t})
        if total and s.end >= next_report:
            print(f"    … {int(s.end // 60)}분 / {int(total // 60)}분", flush=True)
            next_report += 120.0
    res = {"segments": out, "duration": round(total, 2), "generator": f"faster-whisper {stt_cfg.model}"}
    if cache:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(res, ensure_ascii=False), encoding="utf-8")
    return res
