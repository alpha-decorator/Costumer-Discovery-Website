"""The instructions and the JSON shape the model must answer in.

The central design decision: the model is asked for the customer's attitude toward the product, and the sad subject matter
(accidents, deaths, bad roads) gets its own separate field, `problem_concern`. Giving that feeling somewhere to go is what
stops it leaking into the sentiment score.
"""
from __future__ import annotations

import json

from .profile import Profile

STANCES = ["positive", "negative", "neutral", "mixed", "request", "confused"]
IMPORTANCE = ["must_have", "nice_to_have", "unclear"]
MENTION_TYPES = ["feature_request", "objection", "pricing", "competitor", "use_case", "pain_point",
                 "privacy_concern", "suggestion", "promise", "other"]
LABELS = ["strong_positive", "positive", "mixed", "neutral", "negative", "strong_negative", "not_discussed"]
LEVELS = ["none", "low", "medium", "high"]
INTENT = ["yes", "maybe", "no", "unclear"]
LANGUAGES = ["hi", "en", "mixed"]
# Who the customer is - the numbers behind charts such as "how many of these customers drive a car".
TRANSPORT = ["car", "two_wheeler", "commercial_vehicle", "bus", "auto_rickshaw", "cab_taxi", "bicycle", "walks", "public_transport", "other"]
ROLES = ["private_driver", "professional_driver", "fleet_owner", "passenger", "safety_professional", "other", "unclear"]
ACCIDENT = ["none", "near_miss", "minor", "serious", "unclear"]
UNDERSTANDING = ["clear", "partial", "confused", "unclear"]
TONES = ["positive", "negative", "mixed", "neutral", "none"]
SPEAKER_NAMES = {"I": "Interviewer", "C": "Customer"}

_score = {"type": "number"}
_evidence = {"type": "string"}


def response_schema() -> dict:
    topic = {"type": "object", "properties": {"discussed": {"type": "boolean"}, "score": _score}, "required": ["discussed", "score"]}
    return {
        "type": "object",
        "properties": {
            "summary": {"type": "string"},
            "language": {"type": "string", "enum": LANGUAGES},
            "customer": {"type": "object", "properties": {
                "role": {"type": "string", "enum": ROLES},
                "transport": {"type": "array", "items": {"type": "string", "enum": TRANSPORT}, "maxItems": 4},
                "accident_experience": {"type": "string", "enum": ACCIDENT},
                "understood_idea": {"type": "string", "enum": UNDERSTANDING}},
                "required": ["role", "transport", "accident_experience", "understood_idea"]},
            "qa": {"type": "array", "items": {"type": "object", "properties": {
                "question": {"type": "string"}, "answer": {"type": "string"}, "tone": {"type": "string", "enum": TONES},
                "evidence": _evidence}, "required": ["question", "answer", "tone", "evidence"]}, "maxItems": 8},
            "problem_concern": {"type": "object", "properties": {"level": {"type": "string", "enum": LEVELS}, "note": {"type": "string"}},
                                "required": ["level", "note"]},
            "attitude_to_product": {"type": "object", "properties": {
                "reasoning": {"type": "string"},
                "evidence": {"type": "array", "items": _evidence, "maxItems": 3},
                "label": {"type": "string", "enum": LABELS},
                "score": _score}, "required": ["reasoning", "evidence", "label", "score"]},
            "would_use": {"type": "string", "enum": INTENT},
            "would_pay": {"type": "string", "enum": INTENT},
            "topics": {"type": "object", "properties": {"ux": topic, "pricing": topic, "features": topic}, "required": ["ux", "pricing", "features"]},
            "features": {"type": "array", "items": {"type": "object", "properties": {
                "name": {"type": "string"}, "stance": {"type": "string", "enum": STANCES}, "score": _score,
                "importance": {"type": "string", "enum": IMPORTANCE}, "evidence": _evidence},
                "required": ["name", "stance", "score", "importance", "evidence"]}, "maxItems": 10},
            "mentions": {"type": "array", "items": {"type": "object", "properties": {
                "type": {"type": "string", "enum": MENTION_TYPES}, "text": {"type": "string"}, "evidence": _evidence},
                "required": ["type", "text", "evidence"]}, "maxItems": 12},
            "key_points": {"type": "array", "items": {"type": "string"}, "maxItems": 6},
            "alternatives": {"type": "array", "items": {"type": "string"}, "maxItems": 6},
        },
        "required": ["summary", "language", "customer", "qa", "problem_concern", "attitude_to_product", "would_use", "would_pay",
                     "topics", "features", "mentions", "key_points", "alternatives"],
    }


def speaker_schema() -> dict:
    return {"type": "object", "properties": {"turns": {"type": "array", "items": {"type": "object", "properties": {
        "from": {"type": "integer"}, "to": {"type": "integer"}, "who": {"type": "string", "enum": ["interviewer", "customer"]}},
        "required": ["from", "to", "who"]}}}, "required": ["turns"]}


def _feature_block(profile: Profile) -> str:
    if not profile.features:
        return (f"No fixed feature list was provided. When the customer talks about a capability of {profile.name}, "
                "name it yourself in two to four plain English words.")
    lines = [f"Known {profile.name} features. Use exactly these names when the customer is talking about them; "
             "add a new short name only for something that is clearly not on this list:"]
    for feature in profile.features:
        extra = f" (also called: {', '.join(feature.aka)})" if feature.aka else ""
        detail = f" - {feature.description}" if feature.description else ""
        lines.append(f"- {feature.name}{detail}{extra}")
    return "\n".join(lines)




def system_prompt(profile: Profile, report_language: str, labelled: bool = True) -> str:
    product = profile.name
    out_lang = "Hindi (Devanagari)" if report_language == "hi" else "English"
    if labelled:
        reading = ('The call is written as turns marked "Interviewer:" and "Customer:". A program added those marks, so an '
                   "occasional one may be wrong; use common sense.")
    else:
        reading = ("The call has NO speaker marks. Work out who is talking: explanations of what the product is, greetings, "
                   "thanks and questions come from the interviewer; answers, facts about themselves and opinions come from the customer.")
    return f"""You analyse recorded customer-discovery calls for a startup called {product}.

THE SITUATION
Everything you read is a PHONE CALL between exactly two people, recorded as one audio stream. Someone from the {product} team (the INTERVIEWER) is talking to a possible customer (the CUSTOMER) to learn whether {product} is worth building: who the customer is, what they struggle with, what they think of the {product} idea and its features, what it should cost, and whether they would use it, pay for it or recommend it.
ABOUT {product.upper()}: {profile.pitch}
{_feature_block(profile)}
The whole call is about {product}. So when the customer reacts to something the interviewer said or showed ("this", "it", "the app", "ये", "यह", "इसका", "आपका आइडिया"), they are talking about {product}, even if they never say its name.

HOW TO READ IT
{reading} The words come from a speech recogniser listening to a phone line: mostly Hindi (Devanagari) mixed with English words (Hinglish), sometimes pure English. It makes many mistakes: it mis-spells English words in Devanagari ("यूसफुल" is useful, "सेंसर" is sensor, "तराता" and "ट्राटा" are {product}), merges or drops words, and repeats itself. Read past odd words and work out what was meant. Never judge the customer by how garbled the text is. The two people usually know each other and talk casually (तू / तुम / यार / भाई), so a friendly, joking or advising tone is normal and carries no sentiment by itself.
- The interviewer pitches, explains and asks. Nothing the interviewer says is evidence of what the customer thinks or does. Never quote the interviewer.
- Read every customer reply together with the question before it. "हाँ, बिल्कुल" after "क्या आप इसे इस्तेमाल करेंगे?" is a yes to using {product}.
- If the customer changes their mind during the call, the final view counts; say so in the reasoning.
- "ठीक है", "hmm", "okay" with no opinion is neutral, not positive.

THE MOST IMPORTANT RULE: measure the customer's attitude toward {product}, not the mood of the subject.
- attitude_to_product is how the customer feels about {product}'s idea, its features, its price, and whether they would use, pay for or recommend it.
- NEVER lower the score because the conversation is about accidents, deaths, injuries, bad roads, traffic or police. "Accidents are terrible, so this is a very good idea" is POSITIVE.
- NEVER raise the score because the customer is friendly or polite.
- How much the customer cares about the road-safety problem itself goes ONLY in problem_concern.
- Weigh what the customer says about {product} at the END of the call, not any single remark. Count these as POSITIVE: calling it useful, needed or a good idea, asking how to get it, suggesting how to make it work or sell it, offering contacts, saying they would use or pay.
- Questions and practical worries are NOT rejection. "It can be very useful, but how will it work? Where will the sensor go? Will it work in a remote area?" is POSITIVE with conditions (about +0.3 to +0.5). Giving advice on how to build, price or launch {product} (which dealers to approach, how to charge) means the customer is engaging with it, which is mildly positive.
- Only score NEGATIVE when the customer says {product} is not useful, will not work, would not be used, is not trusted, or is not worth the price, or clearly dismisses it. A doubt that stays unanswered and comes with no praise is mildly negative (about -0.1 to -0.3). A flat refusal is -0.5 or lower.
- Price talk is about one thing: "a bike rider will not pay much" is a pricing remark about one kind of customer. It goes in topics.pricing and mentions; it lowers the overall score only a little unless the customer says they themselves would not pay.
- When the customer is both positive and doubtful, weigh them honestly in both directions. Mostly praise with a question about how it will work: about +0.1 to +0.5. Mostly doubts or refusals with a polite compliment: about -0.1 to -0.4. Do not average down to 0 out of caution, and do not round up out of kindness.
- Praise with no reason and no intent ("bro this is amazing") is weak evidence, especially from a friend: keep it at +0.2 to +0.4. A concrete "I would install it on my bike" or "I would pay for it" is strong evidence.
- If the customer never gives an opinion about {product}, use label not_discussed and score 0.
- Write the reasoning first (one sentence, about {product} only), then the evidence, then the label, then the score.
SCORES run from -1 (hates it) through 0 (no opinion) to +1 (loves it). strong_positive is 0.6 to 1, positive 0.2 to 0.8, mixed or neutral about 0, negative -0.2 to -0.8, strong_negative -0.6 to -1.
CHECK BEFORE ANSWERING: the score must agree with the rest of your own answer. If most qa tones and feature stances are positive, would_use is yes or maybe and nothing clearly rejects {product}, the score cannot be negative.

WHAT TO FILL IN (in this order)
- summary: two or three sentences: who the customer is, what they think of {product}, what they want changed.
- customer: only what THE CUSTOMER says about themselves.
  role: private_driver (drives own car or bike), professional_driver (drives for a living: cab, truck, bus, delivery), fleet_owner (owns or manages vehicles or a transport business), passenger (mostly rides or commutes), safety_professional (traffic police, road engineer, insurance, ambulance, NGO, researcher), other, unclear.
  transport: every way of getting around they say THEY use, from car (car, jeep, SUV, कार), two_wheeler (bike, scooter, motorcycle, बाइक, स्कूटी), commercial_vehicle (truck, lorry, tempo, tractor, ट्रक), bus, auto_rickshaw, cab_taxi (Ola, Uber, taxi), bicycle, walks, public_transport (bus, metro or train as a passenger), other. Empty list if not said. Never guess.
  accident_experience: none, near_miss, minor, serious (they or someone close were hurt badly), unclear.
  understood_idea: clear, partial, confused (misunderstood what {product} does), unclear (never explained or no sign).
- qa: the 4 to 8 most useful exchanges, in call order. question = what the interviewer asked, in a few words. answer = what the customer replied, in a few words. tone = the customer's attitude toward {product} in that answer (positive, negative, mixed, neutral), or none when the answer is only a fact about themselves. evidence = the customer's exact words.
- problem_concern, attitude_to_product, would_use, would_pay.
- topics: judge ux (ease of use, app experience), pricing (cost, willingness to pay) and features (what it does) as opinions about {product}. discussed is false and score 0 when the topic did not come up.
- features: one entry for each capability of {product} the customer reacts to. stance is positive, negative, neutral, mixed, request (they ask for something {product} should do) or confused. importance is must_have, nice_to_have or unclear.
- mentions: the specific things the customer says that the team will want to act on: a number or price, a named place, app or competitor, a capability they ask for, a condition for using {product}, a worry, a promise ("I will show this to my fleet manager"). Types: {', '.join(MENTION_TYPES)}. text = a short description; evidence = the exact quote.
- key_points: the 3 to 6 things the team must remember about this customer.
- A competitor or alternative must be an app, company or product the customer actually NAMES in their own words; its evidence must be that sentence. Never make one up from the topic, and never list something from outside the call (articles, websites, links, other languages). If nobody named one, the list stays empty.
- alternatives: other apps, devices or habits they use today for the same job (Google Maps, dashcam, asking other drivers). One to four words each.

EVIDENCE is copied word for word from the customer's turns: same script, no translating, no fixing spelling, the shortest part that proves the point (at most 20 words). If you cannot quote it, leave it empty. Never invent a quote.
Write summary, reasoning, notes, key_points, qa question and answer, and mention text in {out_lang}. Keep quotes in the original language.
LENGTH: at most 8 qa, 10 features, 12 mentions, 6 key_points. Never repeat an item. Every description is one short sentence. Shorter is better.

EXAMPLES
1. Interviewer: "Trata सड़क के खतरनाक मोड़ों का पहले से अलर्ट देता है, क्या आप इसे इस्तेमाल करेंगे?" Customer: "हाँ बिल्कुल, मैं रोज़ कार से हाईवे जाता हूँ, ये बहुत काम की चीज़ है।" -> "ये" means {product}: label strong_positive (about 0.8), would_use yes, role private_driver, transport [car].
2. Customer: "एक्सीडेंट रोज़ हो रहे हैं, बहुत बुरा हाल है।" with no opinion on {product} -> label not_discussed, score 0, problem_concern high.
3. Interviewer: "यह 99 रुपये महीने का होगा।" Customer: "इतना कौन देगा? मैं तो नहीं दूँगा।" -> pricing objection, label negative (about -0.6), would_pay no.
4. Customer: "I drive a truck on the Delhi-Jaipur route, ten years now." -> role professional_driver, transport [commercial_vehicle]; as a qa answer its tone is none.
5. Interviewer explains that Trata detects a crash, calls an ambulance, nearby cab drivers and family, and asks how useful it would be. Customer: "यूसफुल तो बहुत हो सकता है, लेकिन यह होगा कैसे? सेंसर कहाँ लगेंगे?" -> useful but with a how-question: label positive, score about +0.4, would_use maybe, feature stance positive (or request), and the open question about the sensors is a mention of type objection or suggestion. Not negative.
6. Customer, near the end: "बाइक वाला कुछ नहीं देगा, उसे पेट्रोल का खर्चा भी नहीं होता. कार वाले से सब्सक्रिप्शन लेना ठीक है, मॉडल बढ़िया है." -> pricing doubt for bike riders (topics.pricing negative, mentions) but "मॉडल बढ़िया है" about {product}'s business model is positive: overall label positive, about +0.3.
7. Garbled text: "ये तराता क्या करता है ... बहुत बढ़िया ... बट सेंसर लगाना मुश्किल" -> read it as: the customer likes it but finds the sensors hard. label mixed to positive, about +0.2. Do not invent a negative from words you cannot read.
Return only the JSON."""


def user_prompt(transcript: str, language_hint: str, part: tuple[int, int] | None = None, labelled: bool = True) -> str:
    note = f"\n(This is part {part[0]} of {part[1]} of a longer call.)" if part and part[1] > 1 else ""
    return f'Language hint: {language_hint}.{note}\nCall transcript:\n"""\n{transcript}\n"""'


def speaker_system_prompt(profile: Profile) -> str:
    product = profile.name
    return f"""You label who is speaking in a recorded business call. It is a customer-discovery call for {product} (a startup). {profile.pitch}
There are two speakers. The INTERVIEWER is from the {product} team: greets, introduces themselves, explains what {product} is and does, asks questions, thanks, wraps up. The CUSTOMER answers: facts about themselves, opinions, objections, yes or no, and questions about price, privacy or how it works.
The recording was made as one stream with no speaker marks, then typed out by a speech recogniser, in Hindi (Devanagari), English or mixed Hinglish, with mistakes. It is cut into numbered lines. Say who speaks each line.
- The first line is usually the interviewer. A long explanation of {product} is the interviewer. A line that asks "क्या / कैसे / क्यों / would you / what do you" is usually the interviewer, unless the customer is asking about {product} itself.
- A short "हाँ", "नहीं", "ठीक है" straight after a question is the customer; straight after a long customer answer it is often the interviewer acknowledging.
- Speakers take turns. A turn can last one line or many lines.
Answer with ranges that cover every line once, in order, for example {{"turns":[{{"from":1,"to":3,"who":"interviewer"}},{{"from":4,"to":6,"who":"customer"}}]}}."""


def speaker_user_prompt(lines: list[str], context: list[str]) -> str:
    before = ""
    if context:
        before = "Already labelled, for context only (do not label these again):\n" + "\n".join(context) + "\n\n"
    return before + "Label these lines:\n" + "\n".join(lines)


def schema_text() -> str:
    return json.dumps(response_schema(), ensure_ascii=False)
