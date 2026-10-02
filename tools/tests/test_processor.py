"""수업 처리기 테스트 (표준 unittest, AI·녹음 변환은 가짜로 대체).

실행: python -m unittest discover -s tools/tests -v   (Langdy 폴더에서)
"""
from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))

from processor import llm  # noqa: E402
from processor.build import process_lesson, read_inputs  # noqa: E402
from processor.config import Config, LLMConfig  # noqa: E402
from processor.llm.base import ProviderError  # noqa: E402
from processor.llm.mock import MockProvider  # noqa: E402
from processor.textutil import extract_json, mask_personal, parse_lesson_name, to_vtt  # noqa: E402
from processor.validate import ValidationError, validate_extract, validate_practice  # noqa: E402
from processor.weekly import build_weekly  # noqa: E402

FX = TOOLS / "tests" / "fixtures"
EXTRACT = (FX / "extract.txt").read_text(encoding="utf-8")
PRACTICE = (FX / "practice.json").read_text(encoding="utf-8")
WEEKLY = (FX / "weekly.json").read_text(encoding="utf-8")

SEGMENTS = {"segments": [
    {"start": 1.0, "end": 3.5, "text": "Hi Jenny, nice to see you."},
    {"start": 312.4, "end": 315.0, "text": "I am boring on weekends."},
    {"start": 605.0, "end": 609.0, "text": "I was very tired so I stopped working."},
], "duration": 1300.46, "generator": "faster-whisper fake"}


def fake_stt(audio, stt_cfg, cache=None):
    return SEGMENTS


def make_cfg(tmp: Path) -> Config:
    c = Config()
    c.llm = LLMConfig(provider="mock", model="mock-1")
    c.inbox, c.out, c.work, c.archive = tmp / "inbox", tmp / "out", tmp / "work", tmp / "archive"
    c.mask_words = ["Jenny"]
    return c


def make_lesson_dir(tmp: Path, name="lesson1_260928_한국적 사고 버리기 - 1 저 신경 쓰지 마세요") -> Path:
    d = tmp / "inbox" / "2026-09-28 수업"
    d.mkdir(parents=True)
    (d / f"{name}.m4a.mp4").write_bytes(b"\x00\x00\x00\x18ftypM4A " + bytes(range(256)) * 4)
    (d / "chat.txt").write_text("❌: It's so natural in our culture to ask age to other people.\n✅: ...\nmail jenny@x.com", encoding="utf-8")
    (d / "comment.txt").write_text("Your sentences show a strong abilitv.", encoding="utf-8")
    return d


class TextUtilTest(unittest.TestCase):
    def test_mask(self):
        t, n = mask_personal("Hi Jenny! a@b.com 010-1234-5678 https://x.io @tutor_kim. I slept 8 hours in 1999", ["Jenny"])
        self.assertEqual(t, "Hi [NAME]! [EMAIL] [PHONE] [URL] [ID]. I slept 8 hours in 1999")
        self.assertEqual(n, 5)

    def test_parse_name(self):
        self.assertEqual(parse_lesson_name("lesson1_260928_한국적 사고 버리기 - 1 저 신경 쓰지 마세요.m4a.mp4"),
                         {"date": "2026-09-28", "course": "한국적 사고 버리기", "lessonNo": 1, "title": "저 신경 쓰지 마세요"})
        self.assertEqual(parse_lesson_name("2026-10-02 free talk")["date"], "2026-10-02")
        self.assertEqual(parse_lesson_name("그냥 녹음.mp4"), {"title": "그냥 녹음"})

    def test_extract_json(self):
        self.assertIn("corrections", extract_json(EXTRACT))
        with self.assertRaises(ValueError):
            extract_json("죄송합니다")

    def test_vtt_escape(self):
        v = to_vtt([{"start": 0, "end": 1.5, "text": "a <b> & --> c"}])
        self.assertIn("00:00:00.000 --> 00:00:01.500\na &lt;b&gt; &amp; → c", v)


class ValidateTest(unittest.TestCase):
    def test_extract(self):
        data, warn = validate_extract(extract_json(EXTRACT))
        self.assertEqual(len(data["corrections"]), 2)
        self.assertEqual(data["corrections"][1]["ai"], {"corrected": True, "natural": True})
        self.assertEqual(data["corrections"][1]["offsetSec"], 312.4)
        self.assertEqual([e["text"] for e in data["expressions"]], ["Don't mind me", "raise (your) voice"])
        self.assertEqual(data["expressions"][1]["examples"], [{"en": "People raise their voices when they are upset."}])
        self.assertEqual(len(data["upgrades"]), 3)
        self.assertTrue(any("교정 1개 제외" in w for w in warn))

    def test_extract_empty(self):
        with self.assertRaises(ValidationError):
            validate_extract({"corrections": [], "expressions": [], "upgrades": []})

    def test_practice(self):
        refs = {"cor_01", "cor_02", "exp_01", "exp_02", "up_01", "up_02", "up_03"}
        data, warn = validate_practice(json.loads(PRACTICE), refs)
        ch = [e for e in data["exercises"] if e["ref"] == "cor_01" and e["type"] == "choice"][0]
        self.assertEqual(ch["answer"], "It's natural to ask other people's age.")  # 대소문자 달라도 선택지로 정규화
        self.assertFalse(any(e["ref"] == "up_99" for e in data["exercises"]))
        self.assertFalse(any(e["ref"] == "up_02" and e["type"] == "cloze" for e in data["exercises"]))  # 빈칸 2개 → 제외
        self.assertEqual(data["opic"][1]["targetRefs"], ["cor_01"])
        self.assertEqual(data["opic"][1]["seconds"], 90)
        self.assertEqual(len(data["prep"]["expressions"]), 3)
        self.assertTrue(any("없는 항목 참조" in w for w in warn))


class ProviderTest(unittest.TestCase):
    def test_select_and_errors(self):
        c = Config()
        c.llm = LLMConfig(provider="anthropic", model="")
        with self.assertRaises(ProviderError):
            llm.get_provider(c)
        c.llm = LLMConfig(provider="nope")
        with self.assertRaises(ProviderError):
            llm.get_provider(c)
        c.llm = LLMConfig(provider="anthropic", model="m", api_key_env="LANGDY_TEST_NO_KEY")
        with self.assertRaises(ProviderError):
            llm.get_provider(c)

    def test_anthropic_request_shape(self):
        from processor.llm import anthropic as a
        c = LLMConfig(provider="anthropic", model="claude-test", api_key_env="LANGDY_TEST_KEY")
        with mock.patch.dict("os.environ", {"LANGDY_TEST_KEY": "sk-test"}), \
             mock.patch.object(a, "post_json", return_value={"content": [{"type": "text", "text": "{}"}], "stop_reason": "end_turn"}) as pj:
            p = a.AnthropicProvider(c)
            self.assertEqual(p.complete("SYS", "USER", "extract"), "{}")
        url, headers, body = pj.call_args.args[:3]
        self.assertEqual(url, "https://api.anthropic.com/v1/messages")
        self.assertEqual(headers["x-api-key"], "sk-test")
        self.assertEqual(body["model"], "claude-test")
        self.assertEqual(body["system"], "SYS")
        self.assertEqual(body["messages"], [{"role": "user", "content": "USER"}])

    def test_openai_compat_request_shape(self):
        from processor.llm import openai_compat as o
        c = LLMConfig(provider="openai_compat", model="gpt-test", base_url="https://example.com/v1/", api_key_env="LANGDY_TEST_KEY")
        with mock.patch.dict("os.environ", {"LANGDY_TEST_KEY": "k"}), \
             mock.patch.object(o, "post_json", return_value={"choices": [{"message": {"content": "{}"}, "finish_reason": "stop"}]}) as pj:
            self.assertEqual(o.OpenAICompatProvider(c).complete("S", "U", "x"), "{}")
        self.assertEqual(pj.call_args.args[0], "https://example.com/v1/chat/completions")


class PipelineTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.cfg = make_cfg(self.tmp)
        self.dir = make_lesson_dir(self.tmp)

    def run_once(self, provider, force=False):
        return process_lesson(self.dir, self.cfg, provider, stt_fn=fake_stt, force=force)

    def test_end_to_end(self):
        p = MockProvider({"extract": ["not json at all", EXTRACT], "extract-retry": EXTRACT, "practice": PRACTICE})
        r = self.run_once(p)
        self.assertFalse(r["skipped"])
        self.assertEqual(r["lessonId"], "les_20260928_01")
        # 1차 응답이 JSON이 아니면 재요청
        self.assertEqual([c["step"] for c in p.calls], ["extract", "extract-retry", "practice"])
        # 이름·이메일은 AI에 보내지 않음
        sent = p.calls[0]["user"]
        self.assertNotIn("Jenny", sent)
        self.assertNotIn("jenny@x.com", sent)
        self.assertIn("[NAME]", sent)
        self.assertIn("[05:12] I am boring on weekends.", sent)

        z = zipfile.ZipFile(r["zip"])
        names = z.namelist()
        self.assertEqual(names[0], "manifest.json")
        self.assertEqual(set(names), {"manifest.json", "lesson.json", "audio.mp4", "transcript.vtt"})
        man = json.loads(z.read("manifest.json"))
        self.assertEqual((man["format"], man["kind"], man["schemaVersion"]), ("english-review-package", "lesson", 2))
        for f in man["files"]:
            self.assertEqual(hashlib.sha256(z.read(f["path"])).hexdigest(), f["sha256"])
        self.assertEqual(z.getinfo("audio.mp4").compress_type, zipfile.ZIP_STORED)

        lesson = json.loads(z.read("lesson.json"))
        self.assertEqual((lesson["course"], lesson["lessonNo"], lesson["title"]), ("한국적 사고 버리기", 1, "저 신경 쓰지 마세요"))
        self.assertEqual([c["id"] for c in lesson["corrections"]], ["cor_01", "cor_02"])
        self.assertEqual([u["id"] for u in lesson["upgrades"]], ["up_01", "up_02", "up_03"])
        self.assertTrue(all(e["id"].startswith(f"ex_{e['ref']}_") for e in lesson["exercises"]))
        self.assertEqual(lesson["opic"][0]["id"], "opic_01")
        self.assertEqual(lesson["durationSec"], 1300.46)
        self.assertEqual(len(lesson["transcript"]["segments"]), 3)
        self.assertEqual(lesson["source"]["generator"]["llm"], {"provider": "mock", "model": "mock-1"})
        self.assertTrue((self.cfg.archive / "les_20260928_01.json").is_file())

        # 같은 폴더 재실행은 건너뜀, --force면 새 ID
        p2 = MockProvider({"extract": EXTRACT, "practice": PRACTICE})
        self.assertTrue(self.run_once(p2)["skipped"])
        self.assertEqual(p2.calls, [])
        self.assertEqual(self.run_once(p2, force=True)["lessonId"], "les_20260928_02")

    def test_both_attempts_fail(self):
        p = MockProvider({"extract": "nope", "extract-retry": "still nope"})
        with self.assertRaises(ValidationError):
            self.run_once(p)
        self.assertFalse((self.cfg.work / "2026-09-28_수업" / "done.json").exists())

    def test_ai_result_reused_after_later_failure(self):
        with self.assertRaises(ValidationError):
            self.run_once(MockProvider({"extract": EXTRACT, "practice": "bad", "practice-retry": "bad"}))
        p = MockProvider({"practice": PRACTICE})
        self.assertEqual(self.run_once(p)["lessonId"], "les_20260928_01")
        self.assertEqual([c["step"] for c in p.calls], ["practice"])  # 추출 단계는 다시 요청하지 않음

    def test_inputs_detection(self):
        (self.dir / "채팅.txt").write_text("x", encoding="utf-8")
        inp = read_inputs(self.dir)
        self.assertTrue(inp["audio"].name.endswith(".m4a.mp4"))
        self.assertIn("ask age", inp["chat"])

    def test_weekly(self):
        self.run_once(MockProvider({"extract": EXTRACT, "practice": PRACTICE}))
        from datetime import date
        r = build_weekly(self.cfg, MockProvider({"weekly": WEEKLY}), date(2026, 10, 2))
        self.assertEqual(r["id"], "wk_2026W40")
        z = zipfile.ZipFile(r["zip"])
        w = json.loads(z.read("weekly.json"))
        self.assertEqual((w["from"], w["to"], w["lessonIds"]), ("2026-09-26", "2026-10-02", ["les_20260928_01"]))
        self.assertEqual(json.loads(z.read("manifest.json"))["kind"], "weekly")
        with self.assertRaises(ValidationError):
            build_weekly(self.cfg, MockProvider({"weekly": WEEKLY}), date(2026, 12, 31))


if __name__ == "__main__":
    unittest.main()
