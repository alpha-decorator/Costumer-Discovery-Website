# nlp engine: sentiment testing and tuning (Nov 2, 2026)

This folder holds the tests, results and model comparison for the website's sentiment rules (`src/lib/call-sentiment.ts`,
`src/lib/rules/lexicon.ts`, `src/lib/rules/extract.ts`). The rules stay as regular expressions and word lists because they
fit on Vercel. A small multilingual model was tested and did worse (see below).

The rule changes themselves are in `src/lib/` (the website has to load them from there). A copy of the diff is in
`changes/rules-v2.patch`.

## How to run

From the project root (Node 22+):

```
node "nlp engine/harness/build.mjs"                      # compile the current rules into nlp engine/.build
node "nlp engine/harness/build.mjs" --git HEAD           # compile the rules as committed (the "old" rules) into .build-HEAD
node "nlp engine/harness/run.mjs" --set all --verbose    # score every test call; --set tuning|holdout|holdout2|all, --old
node "nlp engine/harness/regress.mjs"                    # old vs new on the real calls (interviews.csv, engine/data/transcripts)
node "nlp engine/model-test/model-vs-rules.mjs"          # small model vs rules (downloads ~139 MB on first run)
```

Rebuild with `build.mjs` after every change to the rules. `run.mjs` prints each call's score, label, would-use, would-pay
and the opinion phrases it found, so a failure shows which word was missed.

## The test calls

Each test is a full call: a greeting, the Trata pitch, then three questions (opinion, use, pay) with the customer's answers.
The analyser only scores customer remarks about Trata that come after the pitch, so bare sentences would not be scored.
Each call has an expected band: `sp` strong positive (≥ 0.55), `p` positive (≥ 0.2), `n0` neutral/mixed (−0.25..0.25),
`n` negative (≤ −0.2), `sn` strong negative (≤ −0.55).

| Set | Calls | What it is |
|---|---|---|
| `harness/cases.mjs` (tuning) | 44 | English, Hindi (Devanagari), Hinglish (Roman) and mixed; strong/mild positive, neutral, mild/strong negative; negation tricks |
| `harness/holdout.mjs` | 22 | New wording, written after tuning, scored before any further change |
| `harness/holdout2.mjs` | 16 | Harder: English in Devanagari ("वेरी गुड", "यूज़लेस"), "but" contrasts, long answers with accident stories, sarcasm, polite deferral |

## Results

| | Old rules | New rules |
|---|---|---|
| Tuning set | 32 / 44 | 44 / 44 |
| Held-out 1, at first sight | 14 / 22 | 17 / 22 → 22 / 22 after fixes |
| Held-out 2, at first sight | 11 / 16 | 13 / 16 → 16 / 16 after fixes |
| All 82 calls | 57 / 82 | 82 / 82 |
| Strong negatives | 9 / 23 | 23 / 23 |
| 7 real calls in the repo | (baseline) | 4 unchanged, 3 move 0.391 → 0.406; same labels and verdicts |

The "first sight" numbers (77–81%) are the fair estimate for wording the rules have never seen. 82/82 is on sets that were
then used for tuning. The old rules never scored a call in the wrong direction; their main fault was scoring strong rejections
only as "negative" (about −0.5).

All result files are in `results/` (numbered in the order they were made).

## What changed in the rules

`src/lib/call-sentiment.ts`
- New phrase groups: love ("love it", "बहुत पसंद आया"), life saver ("game changer", "जान बचाएगा", "jaan bach sakti"),
  eager ("can't wait", "कब मिलेगा"), wow ("wah", "kya cheez banayi", "हर गाड़ी में होनी चाहिए"), fan / first class ("उम्दा",
  "क्या बात है", "without a doubt"), decent ("ठीक ठाक"), not bad ("bura nahi", "खराब नहीं"), "the idea is good" / "accha hai".
- New rejection groups: strong reject (worst, terrible, garbage, waste of money, पैसे की बर्बादी, घटिया, ghatiya, bakwaas,
  bekaar, faltu), dislike ("पसंद नहीं", "pasand nahi", "अच्छा नहीं लगा", disappointing), not for me ("किसी काम का नहीं",
  "kisi kaam ka nahi"), don't want ("नहीं चाहिए", "nahi chahiye"), junk ("time pass", "joke", "दिखावा"), unnecessary
  ("not a fan", "no chance", "कोई मतलब नहीं"), meh ("कुछ खास नहीं", "nothing special", mild), not now ("abhi nahi", mild),
  sarcasm ("yeah right", "as if anyone", "doesn't make sense"), and price refusals ("एक पैसा नहीं", "free mein bhi nahi",
  "rip-off", "लूट").
- "useless" and "bad idea" groups: −0.75 → −0.8 (strong praise is +0.85; rejection was weaker than praise).
- Intensifiers: very / really / totally / बहुत / बिल्कुल / एकदम / ekdum / bilkul right before a phrase × 1.2 (max 0.95).
- Overlaps: the longest phrase now wins. Before, "nobody will use" was read as "will use" (a praise rule with a bigger value
  claimed it first).

`src/lib/rules/lexicon.ts`
- Bug fix: "Absolutely not", "बिल्कुल नहीं", "Yeah right" were read as YES (the answer starts with an agreeing word), so a
  flat refusal to pay was recorded as `wouldPay: yes`. They now count as no (or as nothing, for "yeah right").
- Hinglish questions: "kya aap 1500 rupaye denge?", "use karenge?", "lagwaoge?" are now recognised as pay/use questions,
  so the answers to them are scored.
- Hinglish pay answers: "de dunga", "paisa vasool", "price toh chalega" (yes); "nahi dunga", "ek paisa nahi",
  "free mein bhi nahi" (no).

`src/lib/rules/extract.ts`
- Opinion questions in Roman Hindi ("kaisa laga", "pasand", "raay") are recognised.

Project files: `.gitignore` ignores `nlp engine/.build*/` and the model cache; `.vercelignore` keeps this folder out of
Vercel uploads. `tsc --noEmit` and `pnpm build` both pass.

## Can a light model run on Vercel instead?

Tested: `Xenova/distilbert-base-multilingual-cased-sentiments-student` (q8), through `@huggingface/transformers`, which the
project already depends on. To give it its best chance it read only the customer's answers.

| | Rules | Model |
|---|---|---|
| In the expected band | 82 / 82 | 38 / 82 |
| Wrong direction on clear calls | 0 | several ("उपयोगी नहीं है" → +0.63, "यूज़लेस है, वेस्ट ऑफ मनी" → +0.44) |
| Size | 0 MB | 139 MB model + 208 MB `onnxruntime-node` |
| Speed | < 1 ms | ~12 ms per call (CPU) |

Verdict: not worth it. It is weak on Hindi and Hinglish, misses Hindi negation, and its scores bunch near 0. On a Vercel
function, the 208 MB runtime plus the model is over the 250 MB unzipped limit. In the browser it would mean a 139 MB
download per user, and the server would no longer give the same score as the browser.

If the rules are ever not enough, the options that would work on Vercel are:
1. A hosted model over an API (for example a small LLM asked for a score from −1 to 1 with the quote). There is no size
   limit, but each call costs money and the website would depend on a network service.
2. A model fine-tuned on Hindi/Hinglish call answers (for example from the MuRIL or IndicBERT family), run in the browser
   only as a second opinion on the opinion windows that `opinionWindows()` already cuts out. This needs labelled data first.

## Known limits

- Sarcasm only works for set phrases ("yeah right", "as if anyone"); anything subtler is missed.
- Answers with no opinion words lean on the would-use / would-pay votes.
- Saved interviews keep their old scores until their conversation is edited and saved again (which re-scores it).

## Sample: extreme negative call, English, "Responder:" labels (`samples/01-extreme-negative-en.txt`)

Check one file with `node "nlp engine/harness/check.mjs" <file> [--old]`.

| | Score | Label | Verdict |
|---|---|---|---|
| Old rules | −0.587 | negative | strong_no |
| After the first pass | −0.597 | negative | strong_no |
| After this fix | **−0.803** | **strong_negative** | strong_no |

What was wrong:
- "Responder:" was not a known speaker label (`text.ts`, `classify.ts`), so after the first answer every Responder turn was
  read as the interviewer's pitch and never scored. Added as customer labels: responder, response, user, client, caller,
  prospect. Added as interviewer labels: moderator, researcher, founder, agent.
- English strong-negative words were missing (appalled, atrocious, disastrous, idiotic, dreadful, awful, abysmal, hideous,
  incompetent, insulting, creepy, hater, "I reject it" …). Words that can also describe the road or an accident (broken,
  failure, reckless, dangerous, nightmare, defective …) count only next to a product word (it / this / system / device / app).
- More intensifiers: utterly, incredibly, profoundly, absolute, total, complete, most.

## Sample: extreme positive call, English (`samples/02-extreme-positive-en.txt`)

| | Score | Label | Would use / pay | Opinion phrases found |
|---|---|---|---|---|
| Old rules | +0.653 | strong_positive | yes / unclear | 4 |
| Before this fix | +0.718 | strong_positive | yes / unclear | 6 |
| After this fix | **+0.776** | strong_positive | **yes / yes** | 61 positive, 1 doubt |

The negative sample after the same fix: −0.819, 57 negative phrases and 0 positive.

What was wrong:
- English questions like "What is your reaction to our mission and technology?", "What are your thoughts…", "…trust in the
  brand?" were not seen as asking for an opinion of the product, so answers that did not name the product were dropped.
  Opinion questions now include reaction, thoughts, views, impression, perspective, feedback, trust, excitement. The product
  words (`PRODUCT_CTX`) now include technology, concept, system, software, hardware, startup, brand, innovation, dispatch.
- Strong English praise was missing (thrilled, ecstatic, spectacular, groundbreaking, genius, masterpiece, flawless,
  magnificent, world-class, state-of-the-art, bravo, guardian angel, peace of mind …). Product qualities (reliable, robust,
  efficient, smart …) count only next to a product word.
- "I would gladly pay any premium / any price" is now a yes to pay. "I would gladly pay a premium just to keep this garbage
  far away from me" is still not one (the pay rule ignores a "pay" followed by keep / away / get rid of).
- "phenomenally", "wonderfully", "exceptionally", "tremendously" are intensifiers, not praise. Before this, "phenomenally
  idiotic" had counted as praise.

Known small leftover: "without a single shadow of a doubt" still adds one tiny doubt cue (−0.04) in both samples.

## Sample: extreme negative call, Hindi (`samples/03-extreme-negative-hi.txt`)

| | Score | Label | Would use / pay | Negative phrases found |
|---|---|---|---|---|
| Old rules | −0.627 | strong_negative | unclear / no | — |
| Before this fix | −0.668 | strong_negative | unclear / no | 15 |
| After this fix | **−0.753** | strong_negative | **no / no** | 33 |

What was wrong:
- Hindi rejection words were missing: फ्रॉड, घिनौना, कचरा, रद्दी, स्कैम, नामुमकिन, सिरदर्द, पैसे लूटने, पैसा डुबाने,
  बेवकूफ बनाने, बंद कर दो, पिट जाएगा, शून्य प्रतिशत, रत्ती भर भी भरोसा नहीं, सबसे खराब (+ Roman forms). भयानक, भयंकर,
  खतरनाक, खतरा, फेल, झूठा count only next to a product word, because they are also said about roads and accidents.
- "मैं इसे मुफ्त में भी कभी न लगाऊँ" (the subjunctive "न लगाऊँ") was not a refusal; now it is, and it sets would-use to no.
  "इनस्टॉल / इंस्टॉल" in Devanagari now makes a question a use question.
- "दुश्मन को भी लगाने की सलाह नहीं दूंगा" was read as "नहीं दूंगा" (won't pay); it is now "won't recommend".
- "क्या आपको इसमें कोई फायदा नहीं दिखता?" is now an opinion question (फायदा, भरोसा, विश्वास). Product words in Devanagari
  were added: सिस्टम, तकनीक, कॉन्सेप्ट, प्रोजेक्ट, स्टार्टअप, ब्रांड.

## Sample: extreme positive call, Hindi (`samples/04-extreme-positive-hi.txt`)

| | Score | Label | Would use / pay | Phrases found |
|---|---|---|---|---|
| Old rules | +0.666 | strong_positive | yes / unclear | — |
| Before this fix | +0.690 | strong_positive | yes / unclear | 7 positive |
| After this fix | **+0.727** | strong_positive | **yes / yes** | 28 positive, 0 negative |

What was wrong:
- Hindi praise was missing: अद्भुत, क्रांतिकारी, वरदान, समर्थन, अतुलनीय, मानसिक शांति, मास्टरपीस, सर्वश्रेष्ठ, गेम-चेंजर, जादू,
  अटूट विश्वास, अभूतपूर्व, बेताब, वफादार कस्टमर, प्रेरित करूंगा, लगवाने के लिए तैयार, खुशी-खुशी …; एडवांस, सटीक, भरोसेमंद
  count only next to a product word.
- "कोई भी कीमत चुकाने को तैयार हूँ" is now a yes to pay.
- Questions about a problem ("…लगाने में कोई परेशानी होगी?", "any problem / concern?") flip the meaning of a yes/no reply:
  "बिल्कुल भी नहीं!" / "Not at all!" is now positive and a yes to use; "हाँ, बहुत परेशानी होगी" is negative. Checked on 6 short
  calls (Hindi and English, both directions).
- "बिल्कुल भी नहीं" was also matching the "yes" start (it begins with बिल्कुल); fixed.
- "दिक्कत नहीं", "कोई बड़ी बात नहीं", "छोटी सी बात" are mild praise. The bare phrase "रत्ती भर" was removed from the
  rejections (it is in "रत्ती भर भी दिक्कत नहीं" too); "रत्ती भर भी भरोसा नहीं" stays a rejection.

All four samples: EN negative −0.819, EN positive +0.776, HI negative −0.753, HI positive +0.727.

## Evidence pull: why extreme calls stopped at ~0.77, and the fix (`src/lib/rules/analyze.ts`)

The headline score averaged the phrase values (strong phrases are worth ~0.85, so the average cannot pass ~0.85) and then
blended that 60/40 with the intent votes (which top out at 0.6–0.7): 0.6 × 0.85 + 0.4 × 0.65 ≈ 0.77. A call with 60 agreeing
strong phrases scored like one with 4.

Fix: after the usual score, move it part of the way toward ±1:

    pull = EVIDENCE_PULL (0.7) × agreement² × (1 − e^(−max(0, n − 8) / 6))

`n` is the number of opinion phrases, and `agreement` = |sum of values| / sum of |values| (1 = all one way, 0 = evenly
split). Calls with 8 phrases or fewer are not moved at all. Real calls have 1–6 phrases, and so does every short test call,
so none of them changed. Mixed calls barely move because of the squared agreement.

| | Before | After |
|---|---|---|
| EN extreme negative sample | −0.819 | **−0.946** |
| EN extreme positive sample | +0.776 | **+0.933** |
| HI extreme negative sample | −0.753 | **−0.923** |
| HI extreme positive sample | +0.727 | **+0.911** |
| 7 real calls | unchanged | unchanged |

## Long extreme calls (`harness/long.mjs`, `--set long`)

Ten long calls written after the pull was added: extreme positive and negative in English, Hindi, Hinglish and mixed
(band: at least ±0.85), plus two long controls that must not be pushed (one mixed, one mildly positive).

| Call | First sight (ramp /10) | Final (ramp /6) | Old rules |
|---|---|---|---|
| EN extreme + / − | +0.834 / −0.863 | **+0.870 / −0.893** | |
| HI extreme + / − | +0.860 / −0.865 | **+0.891 / −0.896** | |
| Hinglish extreme + / − | +0.826 / −0.840 | **+0.864 / −0.876** | |
| Mixed-language extreme + / − | +0.817 / −0.828 | **+0.851 / −0.866** | |
| EN mixed control | +0.065 neutral | **+0.065 neutral** | |
| HI mild control | +0.340 positive | **+0.340 positive** | |
| Passed | 5 / 10 | **10 / 10** | 2 / 10 |

At first sight all eight extreme calls already had the right label, verdict, would-use and would-pay; five were just under
the strict 0.85 bar. The only change after that was the ramp (divisor 10 → 6). All 92 test calls pass.

## Step 10: extraction beyond the score, shown on the website and in the PDF

**Extraction fixes** (`src/lib/rules/extract.ts`, `lexicon.ts`), checked on `samples/05-extraction-check.txt`:

| Row | Before | After |
|---|---|---|
| Role ("my friends who run a taxi fleet") | Fleet owner | Drives their own vehicle (`aboutOthers` skips roles said about other people) |
| Transport | car, two-wheeler, **cab/taxi** | car, two-wheeler |
| "There should be an SOS button" | Competitor: car-maker built-in SOS | Feature request (`REQUEST_THING`; `OWNS_ALREADY` keeps "my car already has SOS" as a competitor) |
| "I can connect you with my friends…" | missed | Promise (connect/introduce/refer/मिलवा/बात करवा) |

Prices are numbers (`src/lib/rules/prices.ts`): ₹1500 one-time accepted, ₹99/month accepted, above ₹3000/year too expensive.

**Display.** `src/lib/insights.ts` (shared helpers) and `src/components/CustomerInsights.tsx` show, for each customer:
would use / would pay / verdict, the price cards, suggestions and feature requests, concerns, offers of help, what
they use today, who they are and feature opinions.
- Customer panel (`CustomerDetail.tsx`): a new "What we learned from this call" section.
- Full analysis (`TrataReport.tsx`): a "Prices they talked about" card.
- PDF (`DetailedReport.tsx`): numbered sections. One customer gets "What we learned from this call" (decision tiles,
  a price table with reaction tags, tables for asks, concerns, offers, profile, features, Q&A) and the transcript
  moves to an appendix on its own page. A group gets "What customers want": use/pay counts and %, the price range
  accepted per period and where "too expensive" starts, every suggestion/concern/offer with the customer's name, and
  the products used today. Each customer card also lists intent and prices.
- Print fix: the report's fade-in animation is off when printing (a headless print captured it at opacity 0).

**Check:** `node "nlp engine/harness/preview.mjs"` renders `results/preview-panel.html`, `preview-pdf-customer.html`
and `preview-pdf-group.html` from the samples without signing in; the PNG/PDF next to them come from headless Edge.
Sentiment 92/92, prices 13/13, real calls unchanged, `tsc` and `pnpm build` pass.
