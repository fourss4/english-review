"""Anthropic Claude (Messages API). 표준 라이브러리만 사용(SDK 의존 없음).

API 형식: https://docs.anthropic.com/ (Messages API). 모델 ID는 config.toml에서 지정한다.
"""
from __future__ import annotations

from .base import Provider, ProviderError, post_json, require_key

API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"


class AnthropicProvider(Provider):
    name = "anthropic"

    def __init__(self, llm_cfg):
        if not llm_cfg.model:
            raise ProviderError("tools/config.toml의 [llm] model 이 비어 있습니다. Anthropic 콘솔의 모델 목록에서 모델 ID를 확인해 입력하세요.")
        self.model = llm_cfg.model
        self.cfg = llm_cfg
        self.key = require_key(llm_cfg.api_key_env or "ANTHROPIC_API_KEY")

    def complete(self, system: str, user: str, step: str) -> str:
        res = post_json(
            API_URL,
            {"x-api-key": self.key, "anthropic-version": API_VERSION},
            {
                "model": self.model,
                "max_tokens": int(self.cfg.max_tokens),
                "temperature": float(self.cfg.temperature),
                "system": system,
                "messages": [{"role": "user", "content": user}],
            },
            timeout=int(self.cfg.timeout_sec),
        )
        if res.get("stop_reason") == "max_tokens":
            raise ProviderError("AI 응답이 길이 제한에서 잘렸습니다. config.toml의 max_tokens를 늘리세요.")
        parts = [b.get("text", "") for b in res.get("content", []) if b.get("type") == "text"]
        if not parts:
            raise ProviderError("AI 응답에 텍스트가 없습니다.")
        return "".join(parts)
