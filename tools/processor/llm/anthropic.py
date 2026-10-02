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
        body = {
            "model": self.model,
            "max_tokens": int(self.cfg.max_tokens),
            "system": system,
            "messages": [{"role": "user", "content": user}],
        }
        # 일부 최신 모델은 temperature를 받지 않는다 → 한 번 거부되면 이후 요청부터 빼고 보낸다
        if self.cfg.temperature is not None and not getattr(self, "_no_temperature", False):
            body["temperature"] = float(self.cfg.temperature)
        try:
            res = post_json(API_URL, {"x-api-key": self.key, "anthropic-version": API_VERSION}, body,
                            timeout=int(self.cfg.timeout_sec))
        except ProviderError as e:
            if getattr(e, "status", None) == 400 and "temperature" in body and "temperature" in (getattr(e, "detail", "") or "").lower():
                self._no_temperature = True
                body.pop("temperature")
                res = post_json(API_URL, {"x-api-key": self.key, "anthropic-version": API_VERSION}, body,
                                timeout=int(self.cfg.timeout_sec))
            else:
                raise
        if res.get("stop_reason") == "max_tokens":
            raise ProviderError("AI 응답이 길이 제한에서 잘렸습니다. config.toml의 max_tokens를 늘리세요.")
        parts = [b.get("text", "") for b in res.get("content", []) if b.get("type") == "text"]
        if not parts:
            raise ProviderError("AI 응답에 텍스트가 없습니다.")
        return "".join(parts)
