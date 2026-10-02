from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request


class ProviderError(RuntimeError):
    """공급자 호출 실패. 메시지에 수업 내용·API 키를 넣지 않는다."""


class Provider:
    name = "base"
    model = ""

    def complete(self, system: str, user: str, step: str) -> str:  # pragma: no cover - 인터페이스
        raise NotImplementedError


def require_key(env_name: str) -> str:
    key = os.environ.get(env_name, "").strip()
    if not key:
        raise ProviderError(
            f"환경변수 {env_name}가 비어 있습니다. tools/.env 파일에 {env_name}=... 를 넣거나 시스템 환경변수로 설정하세요."
        )
    return key


def post_json(url: str, headers: dict, body: dict, timeout: int, retries: int = 2) -> dict:
    """JSON POST. 429/5xx는 지수 대기 후 재시도. 오류 메시지에는 상태 코드와 공급자 오류 유형만 남긴다."""
    data = json.dumps(body).encode("utf-8")
    last = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=data, method="POST", headers={"content-type": "application/json", **headers})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            kind = ""
            try:
                kind = json.loads(e.read().decode("utf-8")).get("error", {}).get("type", "")
            except Exception:  # noqa: BLE001 - 오류 본문 해석 실패는 무시
                pass
            last = ProviderError(f"AI 호출 실패 (HTTP {e.code}{', ' + kind if kind else ''})")
            if e.code in (429, 500, 502, 503, 504, 529) and attempt < retries:
                time.sleep(2 ** (attempt + 2))
                continue
            raise last from None
        except (urllib.error.URLError, TimeoutError) as e:
            last = ProviderError(f"AI 서버에 연결하지 못했습니다 ({type(e).__name__}). 인터넷·프록시 설정을 확인하세요.")
            if attempt < retries:
                time.sleep(2 ** (attempt + 2))
                continue
            raise last from None
    raise last  # pragma: no cover
