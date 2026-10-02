"""AI 공급자 선택. 새 공급자는 이 폴더에 파일을 추가하고 PROVIDERS에 등록하면 된다(ADR 0006).

모든 공급자는 complete(system, user, step) -> str 하나만 구현한다.
"""
from __future__ import annotations

from .base import Provider, ProviderError


def get_provider(cfg, work_dir=None, fixtures=None) -> Provider:
    name = (cfg.llm.provider or "").lower()
    if name == "anthropic":
        from .anthropic import AnthropicProvider
        return AnthropicProvider(cfg.llm)
    if name == "openai_compat":
        from .openai_compat import OpenAICompatProvider
        return OpenAICompatProvider(cfg.llm)
    if name == "manual":
        from .manual import ManualProvider
        return ManualProvider(work_dir)
    if name == "mock":
        from .mock import MockProvider
        return MockProvider(fixtures or {})
    raise ProviderError(f"알 수 없는 공급자: {cfg.llm.provider!r} (anthropic | openai_compat | manual | mock)")


__all__ = ["get_provider", "Provider", "ProviderError"]
