"""테스트용 공급자: 단계 이름별로 미리 정한 응답(문자열 또는 문자열 목록)을 순서대로 돌려준다."""
from __future__ import annotations

from .base import Provider, ProviderError


class MockProvider(Provider):
    name = "mock"
    model = "mock-1"

    def __init__(self, fixtures: dict):
        self.fixtures = {k: (list(v) if isinstance(v, list) else [v]) for k, v in fixtures.items()}
        self.calls: list[dict] = []

    def complete(self, system: str, user: str, step: str) -> str:
        self.calls.append({"step": step, "system": system, "user": user})
        q = self.fixtures.get(step)
        if not q:
            raise ProviderError(f"mock 응답 없음: {step}")
        return q.pop(0) if len(q) > 1 else q[0]
