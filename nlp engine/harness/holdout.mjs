// Held-out calls: phrasings written AFTER the rules were tuned on cases.mjs, to see how the rules do on wording they
// have not seen. Run them with: node "nlp engine/harness/run.mjs" --set holdout
import { call } from "./cases.mjs";

const c = (id, lang, expect, answers, note = "") => ({ id, lang, expect, text: call(lang, answers), answers, note });

export const CASES = [
  // ---- positive
  c("ho-en-sp-1", "en", "sp", ["Wonderful, this is exactly what we need. Fantastic work.", "For sure, I'll get one for my dad too.", "Yes, the price is totally fine."]),
  c("ho-en-sp-2", "en", "sp", ["Very impressive. I'm a big fan of this.", "Yes, without a doubt.", "Yes, I'd happily pay for peace of mind."]),
  c("ho-en-p-1", "en", "p", ["Seems like a decent idea.", "Possibly, yes.", "Depends on the price."]),
  c("ho-hi-sp-1", "hi", "sp", ["वाह, बहुत ही बढ़िया सोच है। ऐसी चीज़ तो हर गाड़ी में होनी चाहिए।", "हां बिल्कुल, ज़रूर लूंगा।", "हां, इतना तो ठीक है, दे देंगे।"]),
  c("ho-hi-sp-2", "hi", "sp", ["बहुत उम्दा आइडिया है, मुझे बहुत अच्छा लगा।", "जी हां, मैं इसे ज़रूर इस्तेमाल करूंगी।", "हां, यह कीमत सही है।"]),
  c("ho-hi-p-1", "hi", "p", ["ठीक ठाक है, अच्छा लग रहा है।", "शायद ले लूं।", "देखेंगे।"]),
  c("ho-hn-sp-1", "hn", "sp", ["Bahut hi badiya soch hai, ekdum first class.", "Haan ji bilkul, zaroor lunga.", "Haan, paise dene mein koi dikkat nahi."]),
  c("ho-hn-sp-2", "hn", "sp", ["Kya baat hai! Mast idea hai yaar, bahut useful.", "Pakka use karunga.", "Haan, itna toh de hi denge."]),
  c("ho-mx-sp-1", "hi", "sp", ["Honestly बहुत helpful है, great concept है।", "Definitely, मैं ज़रूर लगवाऊंगा।", "Yes, affordable है।"]),
  // ---- neutral / mixed
  c("ho-en-n0-1", "en", "n0", ["It's okay I guess. Nothing special.", "Not sure, maybe.", "I need to think about it."]),
  c("ho-hi-n0-1", "hi", "n0", ["आइडिया बढ़िया है पर मेरे बजट से बाहर है।", "पता नहीं।", "नहीं, इतने पैसे नहीं हैं।"]),
  c("ho-hn-n0-1", "hn", "n0", ["Theek hai, kuch khaas nahi.", "Dekhenge.", "Sochenge."]),
  // ---- negative
  c("ho-en-n-1", "en", "n", ["I'm not a fan, it feels unnecessary.", "Probably not.", "No, I wouldn't spend on this."]),
  c("ho-hi-n-1", "hi", "n", ["मुझे इसमें कोई खास फायदा नहीं दिखता।", "नहीं, ज़रूरत नहीं लगती।", "नहीं, पैसे नहीं दूंगा।"]),
  c("ho-hn-n-1", "hn", "n", ["Mujhe isme koi fayda nahi dikhta.", "Nahi, iski zaroorat nahi lagti.", "Nahi, paise nahi dunga."]),
  // ---- strong negative
  c("ho-en-sn-1", "en", "sn", ["That's a really bad idea, a complete joke.", "Not at all, never.", "No, it's a total rip-off."]),
  c("ho-en-sn-2", "en", "sn", ["Seriously, this is junk. Nobody needs this.", "No chance.", "Not a penny."]),
  c("ho-hi-sn-1", "hi", "sn", ["यह बहुत ही बेकार और फालतू चीज़ है, इसका कोई मतलब नहीं।", "बिल्कुल नहीं, कभी नहीं लगवाऊंगा।", "नहीं, एक रुपया भी नहीं दूंगा।"]),
  c("ho-hi-sn-2", "hi", "sn", ["यह तो एकदम बेकार है, बिल्कुल बकवास।", "नहीं, मुझे ऐसी चीज़ नहीं चाहिए।", "नहीं, यह तो लूट है।"]),
  c("ho-hn-sn-1", "hn", "sn", ["Ekdum bakwas idea hai, koi matlab nahi.", "Bilkul nahi, kabhi nahi.", "Nahi, ye toh loot hai."]),
  c("ho-hn-sn-2", "hn", "sn", ["Bekar hai bhai, time pass cheez hai.", "Nahi chahiye.", "Ek rupaya bhi nahi dunga."]),
  c("ho-mx-sn-1", "hi", "sn", ["यह तो completely useless है, बेकार है।", "No, बिल्कुल नहीं।", "Never, यह तो waste है।"]),
];
