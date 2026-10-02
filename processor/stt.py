"""녹음 → 텍스트 (PC 로컬, faster-whisper). 녹음 파일은 외부로 전송하지 않는다.

모델은 처음 실행 시 한 번 내려받아 PC에 저장된다(이후 오프라인 가능).
"""
from __future__ import annotations

import json
from pathlib import Path


def transcribe(audio: Path, stt_cfg, cache: Path | None = None) -> dict:
    """{"segments":[{start,end,text}], "duration": 초, "generator": "..."} — cache 파일이 있으면 재사용."""
    if cache and cache.is_file():
        return json.loads(cache.read_text(encoding="utf-8"))
    try:
        from faster_whisper import WhisperModel
    except ImportError as e:  # pragma: no cover - 설치 안내
        raise RuntimeError("faster-whisper가 설치되어 있지 않습니다. tools\\setup.bat 를 먼저 실행하세요.") from e
    model = WhisperModel(stt_cfg.model, device=stt_cfg.device, compute_type=stt_cfg.compute_type)
    segs, info = model.transcribe(str(audio), language=stt_cfg.language or None, vad_filter=True, beam_size=5)
    out = []
    for s in segs:
        t = s.text.strip()
        if t:
            out.append({"start": round(s.start, 2), "end": round(s.end, 2), "text": t})
    res = {"segments": out, "duration": round(float(info.duration), 2), "generator": f"faster-whisper {stt_cfg.model}"}
    if cache:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(res, ensure_ascii=False), encoding="utf-8")
    return res
