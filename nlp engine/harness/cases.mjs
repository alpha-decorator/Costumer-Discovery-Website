// Test calls for the sentiment rules. Each case is a real-looking call: greeting, the Trata pitch, then the interviewer's
// questions with the customer's answers. `expect` is the band the headline score must land in.
//   sp = strong positive (>= 0.55)   p = positive (>= 0.2)   n0 = neutral / mixed (-0.25..0.25)
//   n = negative (<= -0.2)            sn = strong negative (<= -0.55)
export const BANDS = {
  sp: [0.55, 1], p: [0.2, 1], n0: [-0.25, 0.25], n: [-1, -0.2], sn: [-1, -0.55],
};

const FRAME = {
  en: {
    hello: ["Interviewer: Hello sir, how are you?", "Customer: I am good, thank you."],
    pitch: [
      "Interviewer: We are building Trata. It is a small sensor for your car or bike that detects a crash automatically.",
      "Interviewer: It then calls an ambulance, alerts nearby cab drivers and shares your live location with your family.",
    ],
    q: ["Interviewer: What do you think about this idea?", "Interviewer: Would you use it?", "Interviewer: Would you pay around 1500 rupees a year for it?"],
  },
  hi: {
    hello: ["Interviewer: नमस्ते सर, कैसे हैं आप?", "Customer: मैं ठीक हूं, धन्यवाद।"],
    pitch: [
      "Interviewer: हम Trata बना रहे हैं। यह आपकी गाड़ी या बाइक में लगने वाला एक छोटा सेंसर है जो एक्सीडेंट को अपने आप डिटेक्ट करता है।",
      "Interviewer: फिर यह एम्बुलेंस को कॉल करता है, पास के कैब ड्राइवर को अलर्ट करता है और आपकी फैमिली को लाइव लोकेशन भेजता है।",
    ],
    q: ["Interviewer: आपको यह आइडिया कैसा लगा?", "Interviewer: क्या आप इसे इस्तेमाल करेंगे?", "Interviewer: क्या आप इसके लिए साल के 1500 रुपये देंगे?"],
  },
  hn: {
    hello: ["Interviewer: Hello sir, kaise hain aap?", "Customer: Main theek hoon."],
    pitch: [
      "Interviewer: Hum Trata bana rahe hain. Yeh ek chhota sensor hai jo aapki gaadi ya bike mein lagta hai aur accident ko automatically detect karta hai.",
      "Interviewer: Phir yeh ambulance ko call karta hai, nearby cab drivers ko alert karta hai aur family ko live location bhejta hai.",
    ],
    q: ["Interviewer: Aapko yeh idea kaisa laga?", "Interviewer: Kya aap ise use karenge?", "Interviewer: Kya aap iske liye saal ke 1500 rupaye denge?"],
  },
};

/** A call in frame `lang` whose customer answers the three questions with `answers` (1 to 3 of them). */
export function call(lang, answers) {
  const f = FRAME[lang];
  const lines = [...f.hello, ...f.pitch];
  answers.forEach((answer, i) => { lines.push(f.q[i]); lines.push(`Customer: ${answer}`); });
  return lines.join("\n");
}

const c = (id, lang, expect, answers, note = "") => ({ id, lang, expect, text: call(lang, answers), answers, note });

export const CASES = [
  // ======================================== strongly positive ========================================
  c("en-sp-1", "en", "sp", ["This is an amazing idea, really useful.", "Yes, I would definitely use it.", "Yes, I will happily pay, it is worth it."]),
  c("en-sp-2", "en", "sp", ["I absolutely love it. It is a game changer and a life saver.", "Of course, I need this.", "Sure, 1500 is very reasonable."]),
  c("en-sp-3", "en", "sp", ["Superb, outstanding concept. Very helpful for people like me.", "100 percent, sign me up.", "Yes, I can easily pay that."]),
  c("en-sp-4", "en", "sp", ["Wow, I really like it, it can save lives.", "Definitely, I can't wait to try it.", "Yes, totally worth the money."]),
  c("en-sp-5", "en", "sp", ["Honestly it's brilliant, much needed in India.", "Absolutely, I'd install it in both my cars.", "Price is fine, I'd pay even more."]),
  c("hi-sp-1", "hi", "sp", ["यह तो बहुत बढ़िया आइडिया है, बहुत काम की चीज़ है।", "हां, मैं ज़रूर लगवाऊंगा।", "हां, पैसे दे दूंगा, इतना तो ठीक है।"]),
  c("hi-sp-2", "hi", "sp", ["मुझे यह आइडिया बहुत पसंद आया। यह जान बचाने वाली चीज़ है।", "बिल्कुल, मैं इसे इस्तेमाल करूंगा।", "जी हां, इतने पैसे तो कोई भी दे देगा।"]),
  c("hi-sp-3", "hi", "sp", ["शानदार! बहुत ही उपयोगी है।", "जी बिल्कुल, मुझे यह चाहिए।", "हाँ, ये कीमत बिल्कुल वाजिब है।"]),
  c("hi-sp-4", "hi", "sp", ["कमाल का आइडिया है, लाजवाब। इसकी बहुत ज़रूरत है।", "हाँ ज़रूर, मैं तो आज ही लगवा लूंगा।", "हाँ, पैसे देने को तैयार हूँ।"]),
  c("hn-sp-1", "hn", "sp", ["Bahut badhiya idea hai yaar, ekdum mast.", "Haan zaroor, main use karunga.", "Haan bilkul, paise de dunga."]),
  c("hn-sp-2", "hn", "sp", ["Mujhe bahut pasand aaya, kamaal ka idea hai.", "Haan bhai, main lagwa lunga.", "Haan, 1500 toh theek hai, de dunga."]),
  c("hn-sp-3", "hn", "sp", ["Zabardast hai, bahut kaam ki cheez hai. Isse jaan bach sakti hai.", "Bilkul, 100% use karunga.", "Haan, paisa vasool hai."]),
  c("hn-sp-4", "hn", "sp", ["Ye toh super idea hai, really useful hai.", "Yes definitely, main install karwa lunga.", "Haan, itna price toh chalega."]),
  c("mx-sp-1", "hi", "sp", ["Sir यह really amazing है, बहुत useful है।", "Yes, मैं definitely use करूंगा।", "हां, worth it है, pay कर दूंगा।"]),

  // ======================================== mildly positive ==========================================
  c("en-p-1", "en", "p", ["It's a good idea, I like it.", "Yes, probably I would use it.", "Maybe, depends on the features."]),
  c("en-p-2", "en", "p", ["Not bad, it looks helpful.", "I think I will try it.", "I'll think about the price."]),
  c("hi-p-1", "hi", "p", ["अच्छा है, ठीक लगा मुझे।", "शायद इस्तेमाल करूं।", "कीमत पर डिपेंड करता है।"]),
  c("hn-p-1", "hn", "p", ["Accha idea hai, theek hai.", "Shayad use karunga.", "Price pe depend karta hai."]),

  // ======================================== neutral / mixed ==========================================
  c("en-n0-1", "en", "n0", ["The idea is good but it is too expensive for me.", "Maybe, I am not sure.", "No, 1500 is too much."], "praise + price objection"),
  c("en-n0-2", "en", "n0", ["Hmm, okay. I don't know.", "Let me think.", "I'll see."]),
  c("hi-n0-1", "hi", "n0", ["आइडिया तो अच्छा है लेकिन बहुत महंगा है।", "पता नहीं, सोचूंगा।", "इतने पैसे नहीं दूंगा।"]),
  c("hn-n0-1", "hn", "n0", ["Idea accha hai par mehnga hai.", "Pata nahi, sochunga.", "Itna paisa nahi dunga."]),

  // ======================================== mildly negative ==========================================
  c("en-n-1", "en", "n", ["I am not convinced. I don't think it will work on Indian roads.", "Probably not.", "No, I would not pay for this."]),
  c("en-n-2", "en", "n", ["It's not that great, honestly.", "I don't really need it.", "No, too costly."]),
  c("hi-n-1", "hi", "n", ["मुझे नहीं लगता यह चलेगा।", "नहीं, मुझे इसकी ज़रूरत नहीं है।", "नहीं, इतने पैसे नहीं दूंगा।"]),
  c("hn-n-1", "hn", "n", ["Mujhe nahi lagta ye chalega.", "Nahi, mujhe zaroorat nahi hai.", "Nahi, itna paisa nahi dunga."]),

  // ======================================== strongly negative ========================================
  c("en-sn-1", "en", "sn", ["This is a useless idea, total waste of money.", "No, I will never use it.", "No way, I will not pay anything."]),
  c("en-sn-2", "en", "sn", ["Honestly it is terrible. I hate it, it sounds like a scam.", "Never, not for me.", "Not a single rupee."]),
  c("en-sn-3", "en", "sn", ["Worst idea ever, completely pointless and stupid.", "No, nobody will use this.", "It should be free, I won't pay."]),
  c("en-sn-4", "en", "sn", ["Rubbish. It's garbage, worthless.", "I don't want it at all.", "Absolutely not, it's overpriced."]),
  c("en-sn-5", "en", "sn", ["I really dislike this, it is disappointing and a horrible idea.", "No, I don't trust such apps.", "No, waste of money."]),
  c("hi-sn-1", "hi", "sn", ["यह बिल्कुल बेकार आइडिया है, पैसे की बर्बादी है।", "नहीं, मैं कभी इस्तेमाल नहीं करूंगा।", "एक पैसा नहीं दूंगा।"]),
  c("hi-sn-2", "hi", "sn", ["बकवास है, यह फालतू चीज़ है।", "नहीं, मुझे इसकी कोई ज़रूरत नहीं।", "नहीं, बहुत महंगा है।"]),
  c("hi-sn-3", "hi", "sn", ["मुझे यह बिल्कुल पसंद नहीं आया, घटिया आइडिया है।", "नहीं, कोई नहीं लगवाएगा।", "नहीं, पैसे तो बिल्कुल नहीं दूंगा।"]),
  c("hi-sn-4", "hi", "sn", ["यह किसी काम का नहीं है, समय की बर्बादी है।", "बिल्कुल नहीं, मुझे भरोसा नहीं है।", "मुफ्त में भी नहीं लूंगा।"]),
  c("hn-sn-1", "hn", "sn", ["Bekaar idea hai, bilkul faltu.", "Nahi, main use nahi karunga.", "Ek paisa nahi dunga."]),
  c("hn-sn-2", "hn", "sn", ["Bakwaas hai yaar, ghatiya idea.", "Nahi chahiye mujhe.", "Nahi, bahut mehnga hai."]),
  c("hn-sn-3", "hn", "sn", ["Mujhe bilkul pasand nahi aaya, kisi kaam ka nahi hai.", "Kabhi nahi lagwaunga.", "Free mein bhi nahi lunga."]),
  c("mx-sn-1", "hi", "sn", ["Sir यह totally useless है, waste of money है।", "No, मैं कभी use नहीं करूंगा।", "बिल्कुल नहीं, pay नहीं करूंगा।"]),

  // ======================================== tricky: negation, problem talk ===========================
  c("en-trick-1", "en", "p", ["It's not useless at all, actually it's quite nice.", "Yes, I would use it.", "Maybe."], "negated negative"),
  c("en-trick-2", "en", "n", ["It's not useful for me and not good enough.", "No.", "No."], "negated positive"),
  c("hi-trick-1", "hi", "n", ["यह उपयोगी नहीं है, अच्छा नहीं लगा।", "नहीं।", "नहीं।"], "Hindi negated praise"),
  c("hi-trick-2", "hi", "sp", ["सड़कें बहुत खराब हैं और एक्सीडेंट बहुत होते हैं, इसलिए यह बहुत अच्छा आइडिया है। बहुत काम का है।", "हाँ, ज़रूर लगवाऊंगा।", "हाँ, दे दूंगा।"], "problem talk + praise"),
  c("hn-trick-1", "hn", "p", ["Bura nahi hai, theek thaak hai.", "Haan, try karunga.", "Dekhenge."], "negated negative Hinglish"),
];
