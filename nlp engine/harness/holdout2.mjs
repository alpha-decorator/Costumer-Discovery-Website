// Second held-out set, written after holdout.mjs had been used for tuning. Harder on purpose: English written in Devanagari
// (as speech-to-text spells it), "but" contrasts, long rambling answers, and accident talk mixed with the opinion.
//   node "nlp engine/harness/run.mjs" --set holdout2
import { call } from "./cases.mjs";

const c = (id, lang, expect, answers, note = "") => ({ id, lang, expect, text: call(lang, answers), answers, note });

export const CASES = [
  c("h2-dv-sp-1", "hi", "sp", ["वेरी गुड आइडिया सर, एक्सीलेंट है। बहुत यूज़फुल रहेगा।", "हां हां, मैं जरूर यूज करूंगा।", "हां, पे कर दूंगा।"], "English in Devanagari"),
  c("h2-dv-sn-1", "hi", "sn", ["सर यह यूज़लेस है, वेस्ट ऑफ मनी।", "नो सर, मैं यूज नहीं करूंगा।", "नहीं, बिल्कुल नहीं।"], "English in Devanagari"),
  c("h2-en-but-p", "en", "p", ["It's a bit expensive but honestly worth it, very useful.", "Yes, I would use it.", "Yes, okay."], "price objection then praise"),
  c("h2-en-but-n", "en", "n", ["The idea sounds nice, but I personally won't use it, I don't need it.", "No, I won't.", "No."], "praise then rejection"),
  c("h2-hi-but-n", "hi", "n", ["सुनने में अच्छा लगता है लेकिन मेरे लिए नहीं है, मुझे ज़रूरत नहीं।", "नहीं, नहीं लूंगा।", "नहीं।"], "Hindi praise then rejection"),
  c("h2-en-long-sp", "en", "sp", ["See, last year my cousin met with an accident on the highway and nobody came for almost an hour, he was badly injured. If something like this had been there, it would have saved so much time. So for me this is a very very important product, I really appreciate it.", "Yes, definitely, I'll install it the day it launches.", "Yes, I am ready to pay."], "accident story then praise"),
  c("h2-hi-long-sp", "hi", "sp", ["देखिए, हमारे गांव के पास हाईवे पर बहुत एक्सीडेंट होते हैं, लोग घंटों पड़े रहते हैं। अगर ऐसा सिस्टम हो तो बहुत अच्छा होगा, सच में यह बहुत काम की चीज़ है।", "हां, मैं अपनी बाइक में ज़रूर लगवाऊंगा।", "हां, इतना तो दे सकता हूं।"], "accident story then praise"),
  c("h2-hn-long-sn", "hn", "sn", ["Dekho bhai, mere paas pehle se Google Maps hai aur family ko location bhej deta hoon. Ye sab bekaar ka kharcha hai, mujhe koi zaroorat nahi.", "Nahi, bilkul nahi lagwaunga.", "Paise toh bilkul nahi dunga."], "has alternative, rejects"),
  c("h2-en-sarc", "en", "n", ["Yeah right, as if anyone would trust an app with this. Doesn't make sense to me.", "No.", "No, I don't think so."], "sarcasm"),
  c("h2-en-p-2", "en", "p", ["It's a thoughtful idea, could help a lot of people.", "I might try it.", "If the price is reasonable."]),
  c("h2-hi-p-2", "hi", "p", ["आइडिया सही है, लोगों की मदद होगी।", "हो सकता है ले लूं।", "कीमत पर निर्भर करता है।"]),
  c("h2-hn-n0", "hn", "n0", ["Haan theek hai, par mujhe abhi zaroorat nahi lagti. Baad mein dekhenge.", "Abhi nahi, baad mein shayad.", "Pata nahi."], "polite deferral"),
  c("h2-hn-sp-3", "hn", "sp", ["Arre wah, kya cheez banayi hai! Har gaadi mein honi chahiye.", "Haan pakka lunga.", "Haan bhai, de dunga paise."]),
  c("h2-en-n-3", "en", "n", ["I'm skeptical. Sensors fail, and there will be false alarms. I don't see it working.", "Probably not.", "I wouldn't pay for it."]),
  c("h2-hi-sn-3", "hi", "sn", ["ये सब बेकार की बातें हैं, कोई फायदा नहीं।", "नहीं जी, हमें नहीं चाहिए।", "नहीं, एक पैसा नहीं।"]),
  c("h2-en-sp-4", "en", "sp", ["This is genuinely needed. Great job, guys.", "Yes, 100%.", "Yes, happy to pay."]),
];
