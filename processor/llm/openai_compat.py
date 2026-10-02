"""OpenAI 호환 Chat Completions API (OpenAI, 그 밖의 호환 서비스·로컬 서버). 공급자 교체용."""
from __future__ import annotations

from .base import Provider, ProviderError, post_json, require_key


class OpenAICompatProvider(Provider):
    name = "openai_compat"

    def __init__(self, llm_cfg):
        if not llm_cfg.model or not llm_cfg.base_url:
            raise ProviderError("openai_compat는 config.toml의 [llm] model 과 base_url 이 필요합니다.")
        self.model = llm_cfg.model
        self.cfg = llm_cfg
        self.url = llm_cfg.base_url.rstrip("/") + "/chat/completions"
        self.key = require_key(llm_cfg.api_key_env or "OPENAI_API_KEY")

    def complete(self, system: str, user: str, step: str) -> str:
        res = post_json(
            self.url,
            {"authorization": f"Bearer {self.key}"},
            {
                "model": self.model,
                "max_tokens": int(self.cfg.max_tokens),
                "temperature": float(self.cfg.temperature),
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            },
            timeout=int(self.cfg.timeout_sec),
        )
        try:
            choice = res["choices"][0]
        except (KeyError, IndexError):
            raise ProviderError("AI 응답 형식이 예상과 다릅니다.") from None
        if choice.get("finish_reason") == "length":
            raise ProviderError("AI 응답이 길이 제한에서 잘렸습니다. max_tokens를 늘리세요.")
        return choice.get("message", {}).get("content") or ""
