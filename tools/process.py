"""영어 복습 앱 — PC 수업 처리기 실행 파일.

사용법 (Langdy 폴더에서):
  python tools/process.py            inbox의 새 수업을 모두 처리
  python tools/process.py --force    이미 처리한 수업도 다시 처리
  python tools/process.py weekly     최근 7일 주간 요약 만들기
  python tools/process.py check      설치·설정 점검
"""
from __future__ import annotations

import argparse
import shutil
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from processor.build import find_lesson_dirs, process_lesson  # noqa: E402
from processor.config import TOOLS, load_config  # noqa: E402
from processor.llm import ProviderError, get_provider  # noqa: E402
from processor.validate import ValidationError  # noqa: E402
from processor.weekly import build_weekly  # noqa: E402

try:  # Windows 콘솔 한글 출력
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass


def cmd_check(cfg) -> int:
    ok = True
    print(f"설정 파일: {'있음' if (TOOLS / 'config.toml').is_file() else '없음 → tools/config.example.toml을 복사해 config.toml로 만드세요'}")
    print(f"AI 공급자: {cfg.llm.provider} / 모델: {cfg.llm.model or '(비어 있음)'}")
    if cfg.llm.provider in ("anthropic", "openai_compat"):
        import os
        has = bool(os.environ.get(cfg.llm.api_key_env, "").strip())
        print(f"API 키({cfg.llm.api_key_env}): {'설정됨' if has else '없음 → tools/.env 에 넣으세요'}")
        ok &= has and bool(cfg.llm.model)
    try:
        import faster_whisper  # noqa: F401
        print("faster-whisper: 설치됨")
    except ImportError:
        print("faster-whisper: 없음 → tools\\setup.bat 실행")
        ok = False
    print(f"ffmpeg: {'있음' if shutil.which('ffmpeg') else '없음(필수는 아님, 일부 형식 변환에 사용)'}")
    print(f"수업 넣는 곳: {cfg.inbox}  (수업 {len(find_lesson_dirs(cfg.inbox))}개)")
    print(f"결과 나오는 곳: {cfg.out}")
    print("점검 결과:", "준비 완료" if ok else "위 항목을 확인하세요")
    return 0 if ok else 1


def cmd_process(cfg, force: bool, only: str | None) -> int:
    dirs = [d for d in find_lesson_dirs(cfg.inbox) if not only or d.name == only]
    if not dirs:
        print(f"처리할 수업이 없습니다. {cfg.inbox} 안에 수업마다 폴더를 만들고 녹음·chat.txt·comment.txt를 넣으세요.")
        return 1
    provider = get_provider(cfg, work_dir=cfg.work)
    made, failed = [], []
    for d in dirs:
        print(f"\n[{d.name}]")
        try:
            r = process_lesson(d, cfg, provider, force=force)
        except (ProviderError, ValidationError, RuntimeError, OSError) as e:
            print(f"  ✗ 실패: {e}")
            failed.append(d.name)
            continue
        if r["skipped"]:
            print(f"  - 이미 처리됨 ({r['lessonId']}). 다시 하려면 --force")
            continue
        for w in r["warnings"]:
            print(f"  ! {w}")
        print(f"  ✓ 완료: {r['zip']}")
        made.append(r["zip"])
    print(f"\n결과: 새 패키지 {len(made)}개, 실패 {len(failed)}개")
    if made:
        print("휴대폰으로 옮긴 뒤 앱의 '가져오기 → 수업 패키지'에서 선택하세요.")
    return 1 if failed else 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="영어 복습 앱 PC 수업 처리기")
    ap.add_argument("command", nargs="?", default="process", choices=["process", "weekly", "check"])
    ap.add_argument("--force", action="store_true", help="이미 처리한 수업도 다시 처리")
    ap.add_argument("--only", help="이 폴더 이름의 수업만 처리")
    ap.add_argument("--end", help="주간 요약 마지막 날짜 YYYY-MM-DD (기본: 오늘)")
    a = ap.parse_args(argv)
    cfg = load_config()
    try:
        if a.command == "check":
            return cmd_check(cfg)
        if a.command == "weekly":
            r = build_weekly(cfg, get_provider(cfg, work_dir=cfg.work), date.fromisoformat(a.end) if a.end else None)
            print(f"✓ 주간 요약 완료 (수업 {r['lessons']}개): {r['zip']}")
            return 0
        return cmd_process(cfg, a.force, a.only)
    except (ProviderError, ValidationError) as e:
        print(f"✗ {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
