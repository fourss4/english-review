"""설정 읽기. tools/config.toml(사용자 작성, Git 제외) → 없으면 기본값.

API 키는 설정 파일에 쓰지 않는다. 환경변수 또는 tools/.env(Git 제외)에서만 읽는다.
"""
from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # Langdy 폴더
TOOLS = ROOT / "tools"


@dataclass
class LLMConfig:
    provider: str = "anthropic"          # anthropic | openai_compat | manual | mock
    model: str = ""                      # 예: Anthropic 콘솔의 모델 ID (반드시 직접 입력)
    max_tokens: int = 32000
    temperature: float = 0.3
    api_key_env: str = "ANTHROPIC_API_KEY"
    base_url: str = ""                   # openai_compat 전용 (예: https://api.openai.com/v1)
    timeout_sec: int = 600


@dataclass
class STTConfig:
    model: str = "small.en"              # tiny.en / base.en / small.en / medium.en
    language: str = "en"
    device: str = "cpu"
    compute_type: str = "int8"


@dataclass
class Config:
    llm: LLMConfig = field(default_factory=LLMConfig)
    stt: STTConfig = field(default_factory=STTConfig)
    mask_words: list[str] = field(default_factory=list)
    inbox: Path = ROOT / "private" / "inbox"
    out: Path = ROOT / "private" / "out"
    work: Path = ROOT / "private" / "work"
    archive: Path = ROOT / "private" / "archive"


def _load_dotenv(path: Path) -> None:
    """KEY=VALUE 형식만 지원. 이미 설정된 환경변수는 덮어쓰지 않는다."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def load_config(path: Path | None = None) -> Config:
    _load_dotenv(TOOLS / ".env")
    cfg = Config()
    path = path or (TOOLS / "config.toml")
    if not path.is_file():
        return cfg
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    for k, v in (data.get("llm") or {}).items():
        if hasattr(cfg.llm, k):
            setattr(cfg.llm, k, v)
    for k, v in (data.get("stt") or {}).items():
        if hasattr(cfg.stt, k):
            setattr(cfg.stt, k, v)
    cfg.mask_words = [str(w) for w in (data.get("privacy") or {}).get("mask_words", [])]
    for k, v in (data.get("paths") or {}).items():
        if k in ("inbox", "out", "work", "archive"):
            p = Path(v)
            setattr(cfg, k, p if p.is_absolute() else ROOT / p)
    return cfg
