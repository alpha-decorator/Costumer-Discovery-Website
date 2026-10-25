import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

import helpers
from trata_engine import analyze, asr, audio, llm, prompts
from trata_engine.asr import AsrEngine, AsrError, Cancelled, collapse_repeats
from trata_engine.profile import Profile, Feature, load_profile


class AudioTests(unittest.TestCase):
    def test_chunks_cut_in_silence_and_stay_short(self):
        wave = helpers.speech_like(75, gaps=[(20.5, 21.0), (40.2, 40.8), (60.0, 60.6)])
        chunks = audio.plan_chunks(wave)
        self.assertGreaterEqual(len(chunks), 3)
        self.assertTrue(all(end - start <= 28.01 for start, end in chunks))
        self.assertAlmostEqual(chunks[0][1], 20.75, delta=0.6)           # first cut sits inside the first gap
        self.assertEqual(chunks[0][0], 0.0)
        self.assertAlmostEqual(chunks[-1][1], 75.0, delta=0.05)
        self.assertTrue(all(a[1] == b[0] for a, b in zip(chunks, chunks[1:])))

    def test_short_audio_is_one_chunk_and_silence_is_skipped(self):
        wave = np.concatenate([helpers.speech_like(10), np.zeros(16000 * 30, dtype=np.float32)])
        chunks = audio.plan_chunks(wave)
        speech = audio.chunk_has_speech(wave, chunks)
        self.assertTrue(speech[0])
        self.assertFalse(speech[-1])
        self.assertEqual(audio.plan_chunks(helpers.speech_like(5)), [(0.0, 5.0)])

    def test_decode_wav_and_flac_with_ffmpeg(self):
        import shutil, subprocess
        if not shutil.which("ffmpeg"):
            self.skipTest("ffmpeg not installed")
        with tempfile.TemporaryDirectory() as tmp:
            wav = Path(tmp, "a.wav")
            helpers.write_wav(wav, helpers.speech_like(3, sr=16000))
            decoded = audio.decode_audio(wav)
            self.assertAlmostEqual(len(decoded) / 16000, 3.0, delta=0.05)
            flac = Path(tmp, "a.flac")
            subprocess.run(["ffmpeg", "-v", "error", "-i", str(wav), "-ar", "44100", "-ac", "2", str(flac)], check=True)
            self.assertAlmostEqual(len(audio.decode_audio(flac)) / 16000, 3.0, delta=0.05)    # resampled and mixed down
            Path(tmp, "bad.mp3").write_bytes(b"this is not audio at all")
            with self.assertRaises(audio.AudioError):
                audio.decode_audio(Path(tmp, "bad.mp3"))
            with self.assertRaises(audio.AudioError):
                audio.decode_audio(wav, max_minutes=0)


class AsrTests(unittest.TestCase):
    def engine(self, indic=None, whisper=None, backend="auto"):
        s = helpers.settings(tempfile.mkdtemp(), asr_backend=backend)
        return AsrEngine(s, indic or helpers.FakeBackend("indic-conformer", text="हिंदी पाठ"), whisper or helpers.FakeBackend("faster-whisper", text="english text"))

    def test_collapse_repeats(self):
        self.assertEqual(collapse_repeats("thank you " * 8 + "bye"), "thank you thank you bye")
        self.assertEqual(collapse_repeats("a b c a b c d"), "a b c a b c d")

    def test_hindi_goes_to_indic_english_to_whisper(self):
        wave = helpers.speech_like(40, gaps=[(19.5, 20.2)])
        hindi = self.engine(whisper=helpers.FakeBackend("faster-whisper", language="hi")).transcribe(wave, "auto")
        self.assertEqual((hindi.engine, hindi.language), ("indic-conformer", "hi"))
        self.assertIn("हिंदी पाठ", hindi.text)
        english = self.engine(whisper=helpers.FakeBackend("faster-whisper", language="en", text="hello there")).transcribe(wave, "auto")
        self.assertEqual((english.engine, english.language), ("faster-whisper", "en"))

    def test_explicit_language_skips_detection(self):
        whisper = helpers.FakeBackend("faster-whisper", language="en")
        result = self.engine(whisper=whisper).transcribe(helpers.speech_like(5), "hi")
        self.assertEqual(result.engine, "indic-conformer")

    def test_falls_back_to_whisper_when_indic_missing_or_failing(self):
        wave = helpers.speech_like(5)
        missing = self.engine(indic=helpers.FakeBackend("indic-conformer", available=False, reason="no torch")).transcribe(wave, "hi")
        self.assertEqual(missing.engine, "faster-whisper")
        self.assertTrue(any("no torch" in w for w in missing.warnings))
        failing = self.engine(indic=helpers.FakeBackend("indic-conformer", fail=True)).transcribe(wave, "hi")
        self.assertEqual(failing.engine, "faster-whisper")
        self.assertTrue(any("exploded" in w for w in failing.warnings))
        with self.assertRaises(AsrError):
            self.engine(indic=helpers.FakeBackend("indic-conformer", fail=True), backend="indic").transcribe(wave, "hi")

    def test_language_is_only_hindi_or_english(self):
        self.assertEqual(asr.hindi_or_english({"cy": 0.40, "en": 0.30, "hi": 0.10}, "cy"), "hi")   # Welsh/French guesses on a noisy line
        self.assertEqual(asr.hindi_or_english({"fr": 0.50}, "fr"), "hi")
        self.assertEqual(asr.hindi_or_english({"en": 0.92, "hi": 0.03}), "en")
        self.assertEqual(asr.hindi_or_english({"en": 0.55, "hi": 0.40}), "hi")                      # Hinglish stays Hindi
        self.assertEqual(asr.hindi_or_english({"en": 0.45, "hi": 0.20, "ur": 0.20}), "hi")          # Urdu is the same spoken language
        self.assertEqual(asr.hindi_or_english({}, "en"), "en")

    def test_language_uses_start_middle_and_end(self):
        class Scores(helpers.FakeBackend):
            def __init__(self):
                super().__init__("faster-whisper")
                self.seen = 0

            def language_scores(self, audio):
                self.seen += 1
                return {"en": 0.9, "hi": 0.05} if self.seen == 1 else {"hi": 0.9, "en": 0.05}   # opens with "Hello", then Hindi

        whisper = Scores()
        wave = helpers.speech_like(100, gaps=[(20, 21), (40, 41), (60, 61), (80, 81)])
        result = self.engine(whisper=whisper).transcribe(wave, "auto")
        self.assertEqual(result.language, "hi")
        self.assertEqual(whisper.seen, 3)

    def test_whisper_junk_is_dropped(self):
        self.assertTrue(asr.whisper_segment_is_junk("Subtitles by the Amara.org community"))
        self.assertTrue(asr.whisper_segment_is_junk("visit www.example.com for more"))
        self.assertTrue(asr.whisper_segment_is_junk("हाँ हाँ", compression_ratio=3.1))
        self.assertTrue(asr.whisper_segment_is_junk("uh", no_speech_prob=0.9, avg_logprob=-1.4))
        self.assertFalse(asr.whisper_segment_is_junk("हाँ सर, यह काम का है लेकिन कीमत क्या होगी", no_speech_prob=0.1, avg_logprob=-0.3))

    def test_locked_hindi_model_gives_clear_steps(self):
        self.assertTrue(asr._is_locked(RuntimeError("401 Client Error. Cannot access gated repo for url https://huggingface.co/x/resolve/main/config.json")))
        self.assertFalse(asr._is_locked(RuntimeError("Connection timed out")))
        s = helpers.settings(tempfile.mkdtemp())
        backend = asr.IndicConformerBackend(s)
        backend.check_access = lambda: False
        original = asr._missing
        asr._missing = lambda *names: []
        try:
            ok, reason = backend.availability()
            self.assertFalse(ok)
            for needle in ("huggingface.co/ai4bharat/indic-conformer-600m-multilingual", "hf_token.txt", "Agree and access"):
                self.assertIn(needle, reason)
            backend.check_access = lambda: True
            backend._locked_until = 0
            self.assertEqual(backend.availability(), (True, ""))
            backend.check_access = lambda: False
            self.assertEqual(backend.availability(), (True, ""))   # a yes is remembered, no network call per health check
        finally:
            asr._missing = original
        locked = self.engine(indic=helpers.FakeBackend("indic-conformer", available=False, reason=backend.locked_message())).transcribe(helpers.speech_like(5), "hi")
        self.assertEqual(locked.engine, "faster-whisper")
        self.assertTrue(any("hf_token.txt" in w for w in locked.warnings))

    def test_silence_and_cancel(self):
        with self.assertRaises(AsrError):
            self.engine().transcribe(np.zeros(16000 * 5, dtype=np.float32), "hi")
        with self.assertRaises(Cancelled):
            self.engine().transcribe(helpers.speech_like(5), "hi", cancelled=lambda: True)

    def test_progress_reaches_one(self):
        seen = []
        self.engine().transcribe(helpers.speech_like(70, gaps=[(20, 21), (40, 41)]), "hi", lambda stage, fraction, message="": seen.append(fraction))
        self.assertEqual(seen[-1], 1.0)
        self.assertEqual(seen, sorted(seen))


class AnalysisTests(unittest.TestCase):
    T = ("Interviewer: Trata warns drivers about black spots. Customer: Honestly accidents are horrible, I lost a cousin. "
         "That is exactly why I think this is a great idea, the alert is brilliant. I would install it on my truck tomorrow and tell the other drivers. "
         "But one thousand rupees is too much for a small owner like me, maybe five hundred would work.")

    def test_quotes_are_verified_against_the_transcript(self):
        found = analyze.locate(self.T, "that is EXACTLY why I think this is a great idea")
        self.assertEqual(found[0], "That is exactly why I think this is a great idea".replace("That", "That"))
        self.assertGreater(found[1], 0.2)
        self.assertIsNotNone(analyze.locate(self.T, "I would install it on my truck tomorrow and tell all other drivers"))     # near miss snaps to the real text
        self.assertIsNone(analyze.locate(self.T, "I will never buy this product in my entire life"))
        self.assertIsNone(analyze.locate(self.T, "ok"))

    def test_normalize_repairs_and_flags(self):
        raw = helpers.good_reply("great idea")
        raw["attitude_to_product"].update(label="negative", score=0.9)                # label and score disagree -> label wins
        raw["features"].append({"name": "black SPOT alert!", "stance": "negative", "score": -0.9, "importance": "bogus", "evidence": "made up words nobody said"})
        raw["mentions"].append({"type": "not-a-type", "text": "", "evidence": ""})   # empty -> dropped
        raw["topics"]["ux"] = {"discussed": False, "score": 0.9}                      # not discussed -> forced to 0
        raw["would_use"] = "perhaps"
        result = analyze.normalize_analysis(raw, self.T, {"asrEngine": "text"})
        self.assertEqual(result["ideaSentiment"]["label"], "negative")
        self.assertEqual(result["ideaSentiment"]["score"], -0.2)
        self.assertEqual(result["topics"]["UX"], {"discussed": False, "score": 0.0})
        self.assertEqual(result["wouldUse"], "unclear")
        self.assertEqual(len(result["features"]), 1)                                  # merged by name
        self.assertEqual(result["features"][0]["stance"], "mixed")
        self.assertEqual(result["features"][0]["count"], 2)
        self.assertEqual(result["features"][0]["importance"], "must_have")
        self.assertTrue(result["features"][0]["evidence"]["verified"])
        self.assertTrue(all(m["text"] for m in result["mentions"]))
        self.assertEqual(result["language"], "en")
        json.dumps(result)

    def _detailed(self, label, score, tones, stances, would_use, would_pay="unclear"):
        raw = helpers.good_reply("great idea")
        raw["attitude_to_product"].update(label=label, score=score)
        raw["qa"] = [{"question": f"q{i}", "answer": f"a{i}", "tone": tone, "evidence": ""} for i, tone in enumerate(tones)]
        raw["features"] = [{"name": f"feature {i}", "stance": stance, "score": 0.0, "importance": "unclear", "evidence": ""} for i, stance in enumerate(stances)]
        raw["would_use"], raw["would_pay"] = would_use, would_pay
        return analyze.normalize_analysis(raw, self.T, {"asrEngine": "text"})

    def test_headline_score_that_contradicts_the_models_own_answers_is_pulled_back(self):
        # The model says "negative" (clamped to -0.2) although every tone, feature and intent it wrote is positive.
        result = self._detailed("negative", -0.2, ["positive"] * 3, ["positive", "request"], "yes")
        self.assertGreater(result["ideaSentiment"]["score"], 0.1)
        self.assertIn(result["ideaSentiment"]["label"], {"positive", "mixed"})
        self.assertIn("sentiment_adjusted", result["flags"]["reasons"])
        self.assertTrue(result["flags"]["needsReview"])
        self.assertIn(result["verdict"], {"lean_yes", "undecided"})

    def test_consistent_or_thin_answers_are_left_alone(self):
        agreeing = self._detailed("positive", 0.55, ["positive"] * 3, ["positive"], "yes")
        self.assertEqual(agreeing["ideaSentiment"]["score"], 0.55)
        self.assertNotIn("sentiment_adjusted", agreeing["flags"]["reasons"])
        thin = self._detailed("negative", -0.5, ["positive"], [], "unclear")          # too little detail to overrule the model
        self.assertEqual(thin["ideaSentiment"]["score"], -0.5)
        self.assertNotIn("sentiment_adjusted", thin["flags"]["reasons"])

    def test_a_real_rejection_stays_negative(self):
        result = self._detailed("strong_negative", -0.8, ["negative"] * 3, ["negative", "negative"], "no", "no")
        self.assertEqual(result["ideaSentiment"]["score"], -0.8)
        self.assertNotIn("sentiment_adjusted", result["flags"]["reasons"])
        positive_in_doubt = self._detailed("mixed", 0.1, ["positive", "mixed", "negative", "positive"], ["positive", "mixed"], "maybe")
        self.assertNotIn("sentiment_adjusted", positive_in_doubt["flags"]["reasons"])

    def test_prompt_treats_doubts_as_conditions_not_rejection(self):
        from trata_engine import profile, prompts
        text = prompts.system_prompt(profile.Profile(), "en", True)
        self.assertIn("PHONE CALL", text)
        self.assertIn("Questions and practical worries are NOT rejection", text)
        self.assertNotIn("are NEGATIVE about Trata, even when", text)
        self.assertIn("CHECK BEFORE ANSWERING", text)

    def test_not_discussed_forces_zero_and_flags_unverified(self):
        raw = helpers.good_reply("nothing")
        raw["attitude_to_product"]["score"] = 0.7
        self.assertEqual(analyze.normalize_analysis(raw, self.T)["ideaSentiment"]["score"], 0.0)
        raw = helpers.good_reply("great idea")
        raw["attitude_to_product"]["evidence"] = ["a completely invented quotation here"]
        raw["features"] = []
        result = analyze.normalize_analysis(raw, self.T)
        self.assertIn("no_verified_evidence", result["flags"]["reasons"])
        self.assertTrue(result["flags"]["needsReview"])
        self.assertFalse(result["ideaSentiment"]["evidence"][0]["verified"])

    def test_verdicts_and_language(self):
        self.assertEqual(analyze.verdict_for(0.8, "strong_positive", "yes"), "strong_yes")
        self.assertEqual(analyze.verdict_for(0.8, "strong_positive", "no"), "undecided")
        self.assertEqual(analyze.verdict_for(-0.7, "strong_negative", "no"), "strong_no")
        self.assertEqual(analyze.verdict_for(0, "not_discussed", "unclear"), "no_signal")
        self.assertEqual(analyze.script_language("यह पूरा वाक्य हिंदी में है", "en"), "hi")
        self.assertEqual(analyze.script_language("यह ऐप बहुत अच्छा है, I really like the alert feature and the price", "en"), "mixed")

    def test_split_and_merge(self):
        text = " ".join(f"वाक्य संख्या {i}।" for i in range(400))
        parts = analyze.split_transcript(text, 1000)
        self.assertGreater(len(parts), 3)
        self.assertTrue(all(len(p) <= 1000 for p in parts))
        self.assertEqual(" ".join(parts).replace(" ", ""), text.replace(" ", ""))
        a, b = helpers.good_reply("great idea"), helpers.good_reply("पैसे")
        merged = analyze.merge_raw([(1000, a), (1000, b)])
        self.assertAlmostEqual(merged["attitude_to_product"]["score"], 0.1, places=2)
        self.assertEqual(merged["would_use"], "maybe")
        self.assertEqual(merged["problem_concern"]["level"], "high")
        self.assertEqual(len(merged["mentions"]), 2)
        only_one = analyze.merge_raw([(500, helpers.good_reply("nothing")), (500, helpers.good_reply("nothing"))])
        self.assertEqual(only_one["attitude_to_product"]["label"], "not_discussed")


class LlmTests(unittest.TestCase):
    def test_choose_model(self):
        installed = [{"name": "nomic-embed-text:latest", "size": 3e8}, {"name": "gemma4:e4b", "size": 5e9}, {"name": "gemma4:26b-it-q4", "size": 18e9},
                     {"name": "llama3.1:8b", "size": 5e9}]
        self.assertEqual(llm.choose_model(installed), "gemma4:e4b")
        self.assertEqual(llm.choose_model(installed, "gemma4:26b"), "gemma4:26b-it-q4")
        self.assertIsNone(llm.choose_model(installed, "qwen3:14b"))
        self.assertEqual(llm.choose_model([{"name": "mystery:7b", "size": 4e9}, {"name": "big:70b", "size": 40e9}]), "mystery:7b")
        self.assertIsNone(llm.choose_model([]))

    def test_tiny_models_are_never_picked_automatically(self):
        tiny = {"name": "tinyllama:latest", "size": 0.64e9}
        self.assertIsNone(llm.choose_model([tiny]))
        self.assertEqual(llm.choose_model([tiny, {"name": "gemma3:4b", "size": 3.3e9}]), "gemma3:4b")
        for name in ("qwen2.5:0.5b", "qwen2.5:1.5b", "llama3.2:1b", "gemma3:1b", "gemma:2b", "qwen3:1.7b", "smollm2:135m"):
            self.assertTrue(llm.is_small_model(name), name)
        for name in ("gemma3:12b", "gemma4:e2b", "gemma4:12b", "qwen2.5:14b", "qwen2.5:7b", "llama3.1:8b", "llama3.2:3b", "gemma3:4b"):
            self.assertFalse(llm.is_small_model(name, 3.0), name)
        self.assertTrue(llm.is_small_model("mystery:latest", 0.5))   # unknown name, tiny on disk
        self.assertEqual(llm.choose_model([tiny], "tinyllama"), "tinyllama:latest")   # chosen on purpose: allowed

    def test_status_explains_what_to_install(self):
        client = llm.OllamaClient("http://127.0.0.1:9", 5)
        client.installed = lambda: [{"name": "tinyllama:latest", "size": 0.64e9}]
        status = client.status()
        self.assertFalse(status["ok"])
        self.assertIn("tinyllama:latest", status["detail"])
        self.assertIn("ollama pull gemma4:e4b", status["detail"])
        with self.assertRaises(llm.LlmError) as caught:
            client.resolve_model()
        self.assertIn("ollama pull", str(caught.exception))
        client.requested_model = "tinyllama"
        status = client.status()
        self.assertTrue(status["ok"] and status["small"])
        self.assertIn("very small", status["detail"])
        client.resolve_model()
        self.assertTrue(client.small)

    def test_chat_json_sends_schema_and_recovers_from_bad_json(self):
        fake = helpers.FakeOllama()
        try:
            client = llm.OllamaClient(fake.url, 20, 8192)
            fake.replies = ["Sure! here is something that is not json", json.dumps({"ok": True})]
            self.assertEqual(client.chat_json("sys", "user", {"type": "object"}), {"ok": True})
            first, second = fake.requests
            self.assertEqual(first["format"], {"type": "object"})
            self.assertEqual(first["model"], "gemma4:e4b")
            self.assertFalse(first["stream"])
            self.assertEqual(first["options"]["num_ctx"], 8192)
            self.assertEqual(second["options"]["temperature"], 0.0)
            fake.replies = ["nope", "still nope"]
            with self.assertRaises(llm.LlmError):
                client.chat_json("s", "u", {})
            self.assertEqual(llm.parse_json_reply('```json\n{"a": 1}\n```'), {"a": 1})
        finally:
            fake.close()

    def test_cut_off_answer_is_repaired(self):
        full = json.dumps({"summary": "नमस्ते \"x\"", "features": [{"name": "a", "score": 0.5}, {"name": "b", "score": 0.4}], "mentions": [{"type": "pricing", "text": "t"}]}, ensure_ascii=False)
        for cut in range(30, len(full) - 1):
            text = full[:cut]
            try:
                json.loads(text)
                continue
            except ValueError:
                pass
            fixed = llm.repair_json(text)
            if fixed is not None:
                self.assertIsInstance(json.loads(fixed), dict)
        parsed = llm.parse_json_reply(full[:-30])
        self.assertTrue(parsed["_cut_off"])
        self.assertEqual(parsed["summary"], "नमस्ते \"x\"")
        self.assertEqual(len(parsed["features"]), 2)
        self.assertIsNone(llm.repair_json("not json at all"))
        with self.assertRaises(llm.LlmError):
            llm.parse_json_reply("{\"a\": tru")

    def test_unreachable_and_missing_model_messages(self):
        with self.assertRaisesRegex(llm.LlmError, "Start the Ollama app"):
            llm.OllamaClient("http://127.0.0.1:1", 3).resolve_model()
        fake = helpers.FakeOllama(models=[])
        try:
            with self.assertRaisesRegex(llm.LlmError, "ollama pull"):
                llm.OllamaClient(fake.url, 5).resolve_model()
            self.assertFalse(llm.OllamaClient(fake.url, 5).status()["ok"])
        finally:
            fake.close()


class AnalyzerTests(unittest.TestCase):
    def test_small_model_result_carries_a_warning(self):
        fake = helpers.FakeOllama(models=[{"name": "tinyllama:latest", "size": 640_000_000}])
        try:
            s = helpers.settings(tempfile.mkdtemp(), ollama_url=fake.url, ollama_model="tinyllama")
            analyzer = analyze.Analyzer(s, llm.OllamaClient(fake.url, 20, s.num_ctx, "tinyllama"), Profile(features=[]))
            result = analyzer.analyze(AnalysisTests.T, "en", {"asrEngine": "text", "warnings": []})
            self.assertEqual(result["meta"]["llmModel"], "tinyllama:latest")
            self.assertIn("small_model", result["flags"]["reasons"])
            self.assertTrue(result["flags"]["needsReview"])
        finally:
            fake.close()

    def test_hf_token_file(self):
        from trata_engine import config
        import os
        saved = {k: os.environ.pop(k, None) for k in ("HF_TOKEN", "HUGGING_FACE_HUB_TOKEN")}
        try:
            with tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp, "hf_token.txt")
                self.assertFalse(config._apply_hf_token_file(path))                 # no file
                path.write_text("\ufeffhf_abc123  \r\nignored line\n", encoding="utf-8")
                self.assertTrue(config._apply_hf_token_file(path))
                self.assertEqual(os.environ["HF_TOKEN"], "hf_abc123")
                path.write_text("hf_other", encoding="utf-8")
                self.assertFalse(config._apply_hf_token_file(path))                 # an HF_TOKEN already set wins
                self.assertEqual(os.environ["HF_TOKEN"], "hf_abc123")
        finally:
            os.environ.pop("HF_TOKEN", None)
            for key, value in saved.items():
                if value is not None:
                    os.environ[key] = value

    def test_whole_analysis_with_fake_model(self):
        fake = helpers.FakeOllama()
        try:
            s = helpers.settings(tempfile.mkdtemp(), ollama_url=fake.url)
            profile = Profile(features=[Feature("Black spot alert", "Warns about accident-prone spots", ["ब्लैक स्पॉट"])])
            analyzer = analyze.Analyzer(s, llm.OllamaClient(fake.url, 20, s.num_ctx), profile)
            text = AnalysisTests.T
            result = analyzer.analyze(text, "en", {"asrEngine": "text", "warnings": []})
            self.assertEqual(result["ideaSentiment"]["label"], "strong_positive")
            self.assertEqual(result["verdict"], "strong_yes")
            self.assertEqual(result["meta"]["llmModel"], "gemma4:e4b")
            self.assertFalse(result["flags"]["needsReview"])
            system = helpers.analysis_requests(fake)[0]["messages"][0]["content"]
            self.assertIn("NEVER lower the score because the conversation is about accidents", system)
            self.assertIn("Black spot alert - Warns about accident-prone spots (also called: ब्लैक स्पॉट)", system)
            short = analyzer.analyze("हाँ ठीक है", "hi")
            self.assertEqual(short["flags"]["reasons"], ["very_short"])
            self.assertEqual(len(helpers.analysis_requests(fake)), 1)                 # too short -> no model call
            long = analyzer.analyze(" ".join([text] * 250), "en")                     # ~85k chars -> several parts
            self.assertGreater(long["meta"]["parts"], 3)
        finally:
            fake.close()

    def test_cut_off_model_answer_still_gives_a_flagged_analysis(self):
        fake = helpers.FakeOllama()
        try:
            s = helpers.settings(tempfile.mkdtemp(), ollama_url=fake.url)
            analyzer = analyze.Analyzer(s, llm.OllamaClient(fake.url, 20, s.num_ctx), Profile())
            text = AnalysisTests.T
            reply = json.dumps(helpers.good_reply(text), ensure_ascii=False)
            fake.replies = [reply[:reply.index('"key_points"') + 22]]       # ends in the middle of key_points
            result = analyzer.analyze(text, "en", {"asrEngine": "text", "warnings": []})
            self.assertEqual(result["ideaSentiment"]["label"], "strong_positive")
            self.assertTrue(result["flags"]["needsReview"])
            self.assertIn("model_cut_off", result["flags"]["reasons"])
            self.assertEqual(len(helpers.analysis_requests(fake)), 1)        # repaired, not retried
            request = helpers.analysis_requests(fake)[0]
            self.assertEqual(request["options"]["num_predict"], 6000)
            for array in ("features", "mentions", "key_points", "alternatives", "qa"):
                self.assertIn("maxItems", request["format"]["properties"][array])
        finally:
            fake.close()

    def test_malformed_model_replies_never_crash_and_stay_within_website_limits(self):
        transcript = "ग्राहक: मुझे यह आइडिया बहुत अच्छा लगा, मैं अपने ट्रक में इसे लगाऊँगा। " * 6
        long_summary = "सारांश " * 400
        replies = [
            {"summary": long_summary},                                                       # cut off before key_points: summary must not become a 1200-char key point
            {"attitude_to_product": "oops", "topics": [], "features": "x", "mentions": [1, None, "a"], "key_points": {"a": 1}},
            {"attitude_to_product": {"label": "positive", "score": "0.4", "evidence": "not a list"}, "topics": {"ux": 5, "pricing": None}},
            [], "just text", None,
        ]
        for raw in replies:
            result = analyze.normalize_analysis(raw, transcript, {"asrEngine": "x", "warnings": []})
            self.assertTrue(all(len(point) <= 240 for point in result["keyPoints"]))
            self.assertLessEqual(len(result["summary"]), 1200)
        merged = analyze.merge_raw([(100, {"summary": "a", "features": "x"}), (50, "junk"), (80, {"attitude_to_product": 7})])
        self.assertIsInstance(analyze.normalize_analysis(merged, transcript, {})["keyPoints"], list)
        self.assertEqual(analyze.normalize_analysis({"summary": long_summary}, transcript, {})["keyPoints"][0], long_summary.strip()[:240].rstrip())

    def test_transcript_is_kept_when_the_analysis_fails(self):
        from trata_engine.asr import AsrEngine
        from trata_engine.pipeline import Pipeline
        fake = helpers.FakeOllama()
        try:
            tmp = tempfile.mkdtemp()
            s = helpers.settings(tmp, ollama_url=fake.url)
            indic = helpers.FakeBackend("indic-conformer", text="सड़क हादसे बहुत होते हैं पर इसके पैसे कौन देगा मैं तो नहीं दूँगा " * 3)
            pipeline = Pipeline(s, AsrEngine(s, indic, helpers.FakeBackend("faster-whisper", language="hi")), llm.OllamaClient(fake.url, 20, s.num_ctx))
            wav = Path(tmp, "a.wav")
            helpers.write_wav(wav, helpers.speech_like(6))
            fake.replies = ["not json", "still not json"]
            with self.assertRaises(llm.LlmError):
                pipeline.run_audio(wav, "hi")
            self.assertEqual(indic.calls, 1)
            result = pipeline.run_audio(wav, "hi")                      # same file again: the model answers normally now
            self.assertEqual(indic.calls, 1)                           # transcript came from the saved copy
            self.assertEqual(result["analysis"]["ideaSentiment"]["label"], "negative")
            self.assertEqual(result["analysis"]["meta"]["asrEngine"], "indic-conformer")
            pipeline.run_audio(wav, "en")                              # a different language choice is a different transcript
            self.assertGreater(indic.calls + 0, 0)
        finally:
            fake.close()

    def test_profile_loading(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp, "p.json")
            path.write_text(json.dumps({"name": "Trata", "features": ["SOS", {"name": "Alerts", "aka": ["अलर्ट"]}, {"name": ""}]}), encoding="utf-8")
            profile = load_profile(path)
            self.assertEqual([f.name for f in profile.features], ["SOS", "Alerts"])
            self.assertEqual(load_profile(Path(tmp, "missing.json")).name, "Trata")
        shipped = load_profile(Path(__file__).resolve().parent.parent / "trata-profile.json")
        self.assertEqual(shipped.name, "Trata")


if __name__ == "__main__":
    unittest.main()
