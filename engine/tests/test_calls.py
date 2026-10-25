import json
import tempfile
import unittest

import helpers  # noqa: F401  (adds the engine to sys.path)
from trata_engine import analyze, llm, prompts, speakers
from trata_engine.profile import Profile

CALL = (
    "नमस्ते, मैं Trata से बोल रहा हूँ। Trata एक रोड सेफ्टी ऐप है जो खतरनाक मोड़ों का अलर्ट देता है।\n"
    "क्या आप रोज़ गाड़ी चलाते हैं?\n"
    "हाँ, मैं रोज़ अपनी कार से हाईवे जाता हूँ। पिछले साल मेरा एक्सीडेंट होते-होते बचा था।\n"
    "तो क्या आप इस ऐप का इस्तेमाल करेंगे?\n"
    "हाँ बिल्कुल, मैं तो इसे आज ही लगा लूँगा, यह बहुत काम की चीज़ है।\n"
    "यह नौ सौ निन्यानवे रुपये साल का होगा, क्या यह ठीक रहेगा?\n"
    "इतना ज़्यादा नहीं, मैं तो ज़्यादा से ज़्यादा सौ रुपये दूँगा। बाकी ऐप अच्छा है।\n"
    "धन्यवाद, आपका समय देने के लिए बहुत शुक्रिया और आपका दिन शुभ हो।"
)


class SplitTests(unittest.TestCase):
    def test_units_follow_sentences_and_cut_long_runs(self):
        units = speakers.split_units(CALL)
        pieces = [CALL[s:e] for s, e in units]
        self.assertTrue(all(piece.strip() == piece and piece for piece in pieces))
        self.assertIn("क्या आप रोज़ गाड़ी चलाते हैं?", pieces)
        long_run = " ".join(f"शब्द{n}" for n in range(100))
        runs = [long_run[s:e] for s, e in speakers.split_units(long_run)]
        self.assertEqual(len(runs), 5)
        self.assertTrue(all(len(run.split()) <= speakers.MAX_WORDS for run in runs))
        self.assertEqual(" ".join(runs), long_run)
        self.assertEqual(speakers.split_units("  \n \n"), [])

    def test_turns_speaker_lookup_and_dialogue(self):
        turns = speakers.build_turns([(0, 10), (11, 20), (21, 30), (31, 40)], ["I", "C", "C", "I"])
        self.assertEqual(turns, [{"who": "I", "s": 0, "e": 10}, {"who": "C", "s": 11, "e": 30}, {"who": "I", "s": 31, "e": 40}])
        self.assertEqual(speakers.speaker_at(turns, 12, 28), "C")
        self.assertEqual(speakers.speaker_at(turns, 5, 25), "C")      # mostly in the customer's turn
        self.assertIsNone(speakers.speaker_at(turns, 100, 110))
        lines = speakers.turn_lines("x" * 40, turns)
        self.assertTrue(lines[0].startswith("Interviewer: ") and lines[1].startswith("Customer: "))
        parts = speakers.split_dialogue(["Interviewer: " + "क " * 30, "Customer: " + "ख " * 300, "Interviewer: ठीक है"], 200)
        self.assertGreater(len(parts), 2)
        self.assertTrue(all(len(part) <= 200 for part in parts))
        self.assertTrue(all(line.startswith(("Interviewer: ", "Customer: ")) for part in parts for line in part.split("\n")))


class CallTests(unittest.TestCase):
    def setUp(self):
        self.fake = helpers.FakeOllama()
        self.settings = helpers.settings(tempfile.mkdtemp(), ollama_url=self.fake.url)
        self.client = llm.OllamaClient(self.fake.url, 20, self.settings.num_ctx)
        self.analyzer = analyze.Analyzer(self.settings, self.client, Profile())

    def tearDown(self):
        self.fake.close()

    def test_call_is_split_into_turns_and_the_model_reads_labelled_dialogue(self):
        turns = speakers.label_turns(self.client, Profile(), CALL)
        self.assertEqual([t["who"] for t in turns][:7], ["I", "C", "I", "C", "I", "C", "I"])
        self.assertTrue(any(t["who"] == "C" for t in turns))
        result = self.analyzer.analyze(CALL * 2, "hi", {"asrEngine": "indic-conformer", "warnings": []})
        self.assertEqual(result["meta"]["speakers"], "model")
        self.assertTrue(result["turns"])
        self.assertTrue(all(t["who"] in {"I", "C"} and 0 <= t["s"] < t["e"] <= len(CALL * 2) for t in result["turns"]))
        json.dumps(result)
        main = helpers.analysis_requests(self.fake)[0]
        self.assertIn("PHONE CALL", main["messages"][0]["content"])
        self.assertIn('turns marked "Interviewer:" and "Customer:"', main["messages"][0]["content"])
        self.assertIn("Interviewer: नमस्ते", main["messages"][1]["content"])
        self.assertIn("Customer: हाँ, मैं रोज़", main["messages"][1]["content"])

    def test_unlabelled_fallback_when_the_model_cannot_label(self):
        self.fake.speaker_replies = ["not json", "still not json"]
        result = self.analyzer.analyze(CALL * 2, "hi", {"asrEngine": "indic-conformer", "warnings": []})
        self.assertEqual(result["meta"]["speakers"], "none")
        self.assertNotIn("turns", result)
        self.assertIn("no_speaker_split", result["flags"]["reasons"])
        self.assertIn("NO speaker marks", helpers.analysis_requests(self.fake)[0]["messages"][0]["content"])
        self.fake.speaker_replies = [json.dumps({"turns": [{"from": 1, "to": 40, "who": "interviewer"}]})]      # nobody answered
        self.assertIsNone(speakers.label_turns(self.client, Profile(), CALL))
        notes = self.analyzer.analyze(CALL * 2, "en", {"asrEngine": "text", "warnings": []})
        self.assertNotIn("no_speaker_split", notes["flags"]["reasons"])      # typed notes are not expected to be splittable

    def test_gaps_and_nonsense_ranges_are_repaired(self):
        self.fake.speaker_replies = [json.dumps({"turns": [{"from": 2, "to": 3, "who": "customer"}, {"from": "x", "to": 9, "who": "customer"},
                                                           {"from": 4, "to": 400, "who": "interviewer"}, {"from": 1, "to": 1, "who": "robot"}]})]
        turns = speakers.label_turns(self.client, Profile(), CALL)
        self.assertEqual(turns[0], {"who": "C", "s": 0, "e": turns[0]["e"]})      # line 1 was skipped: it takes the first known label
        self.assertEqual(turns[-1]["who"], "I")

    def test_invented_competitors_are_dropped(self):
        raw = helpers.good_reply("great idea")
        raw["mentions"] = [
            {"type": "competitor", "text": "Trabajo de Diseño de Aplicaciones móviles", "evidence": "The article discusses the integration of Trataboo into Beninfinity"},
            {"type": "competitor", "text": "Instagram Ads Manager", "evidence": ""},
            {"type": "competitor", "text": "Google Maps", "evidence": "मैं तो इसे आज ही लगा लूँगा"},
            {"type": "pricing", "text": "Will pay only 100", "evidence": "मैं तो ज़्यादा से ज़्यादा सौ रुपये दूँगा"},
        ]
        result = analyze.normalize_analysis(raw, CALL, {"asrEngine": "x"})
        self.assertEqual([m["text"] for m in result["mentions"]], ["Google Maps", "Will pay only 100"])
        self.assertIn("mentions_dropped", result["flags"]["reasons"])
        self.assertTrue(result["flags"]["needsReview"])

    def test_interviewer_quotes_are_not_evidence(self):
        units = speakers.split_units(CALL)
        labels = ["I" if any(mark in CALL[s:e] for mark in ("?", "Trata", "नमस्ते", "धन्यवाद")) else "C" for s, e in units]
        turns = speakers.build_turns(units, labels)
        raw = helpers.good_reply("great idea")
        raw["attitude_to_product"]["evidence"] = ["Trata एक रोड सेफ्टी ऐप है जो खतरनाक मोड़ों का अलर्ट देता है", "मैं तो इसे आज ही लगा लूँगा"]
        raw["mentions"] = [{"type": "pricing", "text": "Price is 999", "evidence": "यह नौ सौ निन्यानवे रुपये साल का होगा"},
                           {"type": "pricing", "text": "Will pay only 100", "evidence": "मैं तो ज़्यादा से ज़्यादा सौ रुपये दूँगा"}]
        result = analyze.normalize_analysis(raw, CALL, {"asrEngine": "x"}, turns)
        self.assertEqual([e["text"] for e in result["ideaSentiment"]["evidence"]], ["मैं तो इसे आज ही लगा लूँगा"])
        self.assertEqual([m["text"] for m in result["mentions"]], ["Will pay only 100"])
        without = analyze.normalize_analysis(raw, CALL, {"asrEngine": "x"})
        self.assertEqual(len(without["ideaSentiment"]["evidence"]), 2)       # no labels, nothing to judge by

    def test_customer_profile_and_qa(self):
        raw = helpers.good_reply("great idea truck")
        raw["customer"] = {"role": "nonsense", "transport": ["car", "car", "spaceship", "two_wheeler"], "accident_experience": "near_miss", "understood_idea": "clear"}
        raw["qa"] = [{"question": "Q" * 500, "answer": "A", "tone": "weird", "evidence": "invented words"}, {"question": "", "answer": ""}, "junk"]
        result = analyze.normalize_analysis(raw, CALL, {})
        self.assertEqual(result["profile"], {"role": "unclear", "transport": ["car", "two_wheeler"], "accident": "near_miss", "understanding": "clear"})
        self.assertEqual(len(result["qa"]), 1)
        self.assertEqual((len(result["qa"][0]["question"]), result["qa"][0]["tone"], result["qa"][0]["evidence"]["verified"]), (200, "none", False))
        empty = analyze.normalize_analysis({}, CALL, {})
        self.assertEqual(empty["profile"], {"role": "unclear", "transport": [], "accident": "unclear", "understanding": "unclear"})

    def test_long_calls_are_merged_by_whole_turns(self):
        a, b = helpers.good_reply("truck great idea"), helpers.good_reply("nothing")
        b["customer"] = {"role": "private_driver", "transport": ["car", "truck"], "accident_experience": "serious", "understood_idea": "partial"}
        merged = analyze.merge_raw([(100, a), (100, b)])
        self.assertEqual(merged["customer"]["role"], "professional_driver")
        self.assertEqual(merged["customer"]["transport"], ["commercial_vehicle", "car"])
        self.assertEqual((merged["customer"]["accident_experience"], merged["customer"]["understood_idea"]), ("serious", "clear"))
        self.assertEqual(len(merged["qa"]), 1)
        analyzer = analyze.Analyzer(helpers.settings(tempfile.mkdtemp(), ollama_url=self.fake.url, part_chars=900), self.client, Profile())
        long_call = "\n".join([CALL] * 6)
        result = analyzer.analyze(long_call, "hi", {"asrEngine": "indic-conformer"})
        self.assertGreater(result["meta"]["parts"], 1)
        for request in helpers.analysis_requests(self.fake):
            body = request["messages"][1]["content"].split('"""')[1].strip()
            self.assertTrue(all(line.startswith(("Interviewer: ", "Customer: ")) for line in body.split("\n")))


if __name__ == "__main__":
    unittest.main()
