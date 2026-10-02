"""복사·붙여넣기 공급자: API 키 없이 아무 AI 채팅이나 사용. 요청 문장을 파일로 저장하고 답변 파일을 기다린다."""
from __future__ import annotations

from pathlib import Path

from .base import Provider, ProviderError


class ManualProvider(Provider):
    name = "manual"
    model = "manual"

    def __init__(self, work_dir):
        self.work_dir = Path(work_dir) if work_dir else Path.cwd()

    def complete(self, system: str, user: str, step: str) -> str:
        self.work_dir.mkdir(parents=True, exist_ok=True)
        q = self.work_dir / f"{step}.prompt.md"
        a = self.work_dir / f"{step}.response.txt"
        q.write_text(system + "\n\n---\n\n" + user, encoding="utf-8")
        if not a.exists():
            a.write_text("", encoding="utf-8")
        print(f"\n[수동 모드] 1) {q} 내용을 AI 채팅에 붙여넣으세요.")
        print(f"            2) AI 답변 전체를 {a} 에 붙여넣고 저장하세요.")
        input("            3) 저장했으면 Enter를 누르세요... ")
        text = a.read_text(encoding="utf-8").strip()
        if not text:
            raise ProviderError(f"{a.name}이 비어 있습니다.")
        return text
