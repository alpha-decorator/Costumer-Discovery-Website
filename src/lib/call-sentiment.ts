/**
 * Sentiment for a customer-discovery PHONE CALL about Trata, written for the in-browser fallback (used when the
 * Trata engine is not running). It measures what the customer thinks of the PRODUCT, not how grim the subject is.
 *
 * Why not just average a generic sentiment model over the sentences?
 *  - The text of a call usually has no punctuation, so "sentences" are huge blobs a model truncates (it only sees the
 *    first few hundred words).
 *  - A call about road safety is full of accident, injury and death vocabulary. A generic model reads that as negative
 *    even when the customer says "this is very useful".
 *  - Hindi/English calls are transcribed with mis-spellings ("यूसफुल" for useful), fillers ("अच्छा" is "oh, okay", not
 *    praise) and the interviewer's questions ("कितना यूसफुल लगता है?") mixed in.
 * So this module looks only for opinion phrases about the idea, its price and its use, checks negation and questions
 * around each one, treats doubts and "how will it work?" as a mild, capped negative (never a rejection), and ignores
 * problem talk completely. The optional transformer in nlp-analysis.ts only ever sees the windows around these phrases.
 */

export type Cue = { text: string; value: number; weight: number; kind: "praise" | "reject" | "price" | "doubt"; topic?: "UX" | "Pricing" | "Features"; start: number; end: number };
export type CallSentiment = { score: number; cues: Cue[]; confidence: "none" | "low" | "ok"; opinionScore: number };

import { normalizeMapped } from "@/lib/rules/text";

/** One spelling for the things speech recognisers and keyboards write several ways (nukta, chandrabindu, case, quotes). */
export function normalizeText(value: string) {
  return normalizeMapped(value).norm;
}

export const WORD = "(?<![\\p{L}\\p{M}\\p{N}])";
export const WORD_END = "(?![\\p{L}\\p{M}\\p{N}])";
const escapeRe = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const phrase = (list: string) => new RegExp(`${WORD}(?:${list.split("|").map((item) => escapeRe(normalizeText(item.trim())).replace(/\s+/g, "\\s+")).join("|")})${WORD_END}`, "gu");

type Rule = { re: RegExp; value: number; weight?: number; kind: Cue["kind"]; topic?: Cue["topic"]; label: string; needsProduct?: boolean };
const rule = (label: string, list: string, value: number, kind: Cue["kind"], extra: { weight?: number; topic?: Cue["topic"]; needsProduct?: boolean } = {}): Rule => ({ re: phrase(list), value, kind, label, ...extra });

const RULES: Rule[] = [
  // ---- praise and intent to use ------------------------------------------------------------------------------
  rule("useful", "useful|usefull|यूसफुल|यूजफुल|यूज़फुल|यूसफूल|यूसपुल|यूजपुल|यूज़पुल|यूसफ़ुल|यूजफूल|उपयोगी|helpful|मददगार|काम का|काम की चीज़|काम की चीज|काम आएगा|काम आजाएगा|काम आ जाएगा|काम आयेगा|काम आ सकता है", 0.6, "praise", { topic: "Features" }),
  rule("strong praise", "excellent|awesome|amazing|brilliant|fantastic|बेहतरीन|शानदार|ज़बरदस्त|जबरदस्त|कमाल|लाजवाब|मस्त|वाह", 0.85, "praise"),
  rule("praise", "great|good idea|nice idea|nice|बढ़िया|बढिया|नाइस|अच्छा आइडिया|अच्छा आईडिया|अच्छा लगा|अच्छी लगी|अच्छा लग रहा|बहुत अच्छा|बहुत अच्छी|सही है|सही रहेगा|सही लगता|पसंद आया|पसंद आई|पसंद है|i like it|like it|liked it|i like this|i like the idea|love", 0.55, "praise"),
  rule("good", "works well|working well|सही चीज़|सही चीज|अच्छा है|अच्छी है|idea is good|idea is nice|it's good|it is good|looks good|sounds good|seems good|looks helpful|looks useful|sounds useful|accha hai|acha hai|achha hai|achchha hai|अच्छा तो है|आइडिया अच्छा|idea accha|idea acha|idea achha", 0.4, "praise"),
  // ---- added in the nlp-engine pass: love, life-saving, eager, not bad ------------------------------------------
  rule("love", "love it|loved it|love this|i love|absolutely love|really like it|really liked it|really like this|बहुत पसंद आया|बहुत पसंद आई|बहुत पसंद है|दिल से पसंद|bahut pasand aaya|bahut pasand aayi|bahut pasand hai|dil se pasand|perfect|परफेक्ट|perfect hai", 0.8, "praise"),
  rule("life saver", "life saver|lifesaver|life-saver|game changer|game-changer|gamechanger|save lives|saves lives|save a life|save many lives|can save lives|जान बचा सकता|जान बचा सकती|जान बचाएगा|जान बचाएगी|जान बचाने|जान बच सकती|जान बच सकता|जान बच जाएगी|जिंदगी बचा|ज़िंदगी बचा|jaan bacha|jaan bach sakti|jaan bach sakta|jaan bachayega|jaan bachane|zindagi bacha|much needed|बहुत काम की|बहुत काम का|bahut kaam ki|bahut kaam ka|kaam ki cheez hai", 0.8, "praise", { topic: "Features" }),
  rule("eager", "can't wait|cannot wait|cant wait|बेसब्री|इंतज़ार रहेगा|इंतजार रहेगा|intezaar rahega|when can i get|कब मिलेगा|kab milega|kab launch|कब लॉन्च", 0.7, "praise"),
  rule("not bad", "not bad|not too bad|not that bad|बुरा नहीं|बुरा नही|bura nahi|bura nahin|खराब नहीं|kharab nahi", 0.35, "praise"),
  rule("fan", "big fan|huge fan|i'm a fan|i am a fan|fan of this|fan ho gaya|फैन हो गया|first class|फर्स्ट क्लास|उम्दा|umda|क्या बात है|kya baat hai|kya baat|top class|world class|वर्ल्ड क्लास|hats off|हैट्स ऑफ|well done|वेल डन|बहुत खूब|bahut khoob|without a doubt|no doubt about it|बेशक|beshak", 0.75, "praise"),
  rule("wow", "wow|wah|waah|arre wah|kya cheez|क्या चीज़ बनाई|क्या चीज बनाई|kya cheez banayi|हर गाड़ी में होनी चाहिए|हर गाड़ी में होना चाहिए|har gaadi mein honi chahiye|har gadi me honi chahiye|every car should have|every vehicle should have|should be in every car|everyone should have", 0.75, "praise"),
  rule("not now", "abhi nahi|abhi zaroorat nahi|abhi jarurat nahi|abhi need nahi|अभी नहीं|अभी जरूरत नहीं|अभी ज़रूरत नहीं|not right now|not now|maybe later|baad mein dekhenge|बाद में देखेंगे|later on maybe", -0.2, "reject"),
  rule("sarcasm", "yeah right|as if anyone|as if someone|as if people|haan haan zaroor|हां हां ज़रूर|हाँ हाँ ज़रूर|doesn't make sense|does not make sense|makes no sense|no sense|koi sense nahi|कोई सेंस नहीं|समझ से बाहर", -0.55, "reject"),
  // Strong English praise (mirror of "strong reject (en)").
  rule("strong praise (en)", "thrilled|ecstatic|overjoyed|delighted|spectacular|groundbreaking|ground-breaking|genius|revolutionary|masterpiece|phenomenal|magnificent|glorious|marvelous|marvellous|fabulous|incredible|breathtaking|flawless|flawlessly|stellar|top-tier|top tier|world-class|state-of-the-art|cutting-edge|visionary|inspiring|inspired|triumph|triumphant|dazzling|immaculate|pristine|bravo|guardian angel|peace of mind|priceless|blown away|i'm sold|i am sold|supportive|biggest champion|biggest supporter|loyal supporter|biggest fan|ecstatic customer|unwavering faith|full faith|complete faith|total faith|full confidence|confidence in your|so impressed|highly impressed|kudos|remarkable|beautifully", 0.85, "praise"),
  // Product qualities: only next to a word for the product, like "product faults (en)".
  rule("product qualities (en)", "reliable|robust|efficient|effective|smart|intelligent|advanced|seamless|seamlessly|innovative|clever|vigilant|responsive|accurate", 0.6, "praise", { needsProduct: true }),
  rule("buy now", "let me buy|want to buy|i want one|where can i buy|take my money|buy it immediately|install it immediately|get it right now|right this very second", 0.8, "praise"),
  // "I'd gladly pay a premium just to keep this away from me" is a rejection, whatever "pay" says.
  rule("keep away", "keep it away|keep this away|far away from me|stay away from|get rid of", -0.6, "reject"),
  rule("decent","decent|decent idea|fair idea|okay idea|ok idea|ठीक ठाक|theek thaak|thik thak|चल जाएगा|chal jayega", 0.3, "praise"),
  rule("needed", "जरूरी|ज़रूरी|necessary|needed|need this|इसकी जरूरत|इसकी ज़रूरत|जरूरत है इसकी", 0.5, "praise", { topic: "Features" }),
  rule("would use", "इस्तेमाल करूंगा|इस्तेमाल करूँगा|इस्तेमाल करूंगी|यूज करूंगा|यूज़ करूँगा|use करूंगा|use करूँगा|will use|would use|i would install|i will install|लगवाऊंगा|लगवा लूंगा|ले लूंगा|खरीदूंगा|खरीद लूंगा|would buy|will buy|i will take", 0.7, "praise"),
  rule("would pay", "पैसे दूंगा|पैसे दे दूंगा|पे करूंगा|pay करूंगा|will pay|would pay|ready to pay|देने को तैयार", 0.6, "praise", { topic: "Pricing" }),
  rule("would recommend", "recommend|रिकमेंड|दोस्तों को बताऊंगा|सबको बताऊंगा|tell others|tell the other", 0.6, "praise"),
  rule("sure", "बिल्कुल सही", 0.4, "praise"),
  rule("interesting", "interesting|इंटरेस्टिंग|दिलचस्प", 0.35, "praise"),
  rule("easy", "easy to use|user friendly|simple to use|आसान|इजी|सिंपल", 0.6, "praise", { topic: "UX" }),
  // ---- rejection ---------------------------------------------------------------------------------------------
  rule("useless", "useless|बेकार|फालतू|bekar|time waste|waste of time|वेस्ट ऑफ", -0.8, "reject"),
  // ---- added in the nlp-engine pass: the strongest rejections, dislike, "not for me", "don't want" ---------------
  rule("strong reject", "worst|terrible|horrible|pathetic|garbage|worthless|waste of money|total waste|complete waste|ridiculous|absurd|stupid|dumb|disgusting|पैसे की बर्बादी|पैसों की बर्बादी|पैसा बर्बाद|समय की बर्बादी|टाइम की बर्बादी|वक्त की बर्बादी|बर्बादी है|घटिया|बेहूदा|बेवकूफी|बेकार की चीज|फालतू की चीज|ghatiya|bakwaas|bakwass|bekaar|bekaar hai|faltu|faaltu|paise ki barbadi|paison ki barbadi|time ki barbadi|barbadi hai|paisa barbaad|bewakoofi", -0.85, "reject"),
  rule("dislike", "dislike|don't like it|do not like it|dont like it|didn't like|did not like|don't like this|not impressed|disappointing|disappointed|पसंद नहीं|पसंद नही|pasand nahi|pasand nahin|अच्छा नहीं लगा|अच्छा नही लगा|अच्छी नहीं लगी|accha nahi laga|acha nahi laga|achha nahi laga|निराशाजनक|मज़ा नहीं आया|मजा नहीं आया", -0.65, "reject"),
  rule("not for me", "not for me|of no use|no use to me|no use for me|किसी काम का नहीं|किसी काम की नहीं|किसी काम का नही|मेरे काम का नहीं|मेरे काम की नहीं|मेरे किसी काम|kisi kaam ka nahi|kisi kaam ki nahi|mere kaam ka nahi|mere kaam ki nahi|koi kaam ka nahi|कोई काम का नहीं", -0.7, "reject"),
  rule("don't want", "don't want|do not want|dont want|नहीं चाहिए|नही चाहिए|nahi chahiye|nahin chahiye|no thanks|no thank you|नहीं लेना|nahi lena", -0.6, "reject"),
  // Strong English words that are always an opinion (nobody calls a road "idiotic" or "fraudulent").
  rule("strong reject (en)", "appalled|appalling|atrocious|disastrous|catastrophic|idiotic|moronic|dreadful|awful|abysmal|abysmally|hideous|repulsive|repulsed|disgusted|horrified|horrendous|outraged|outrageous|delusional|fraudulent|fatally flawed|incompetent|amateurish|pitiful|shameful|embarrassment|insulting|offensive|creepy|madness|epic failure|hater|i reject it|reject it|i reject|vehemently opposed|strongly opposed|totally against|lack of faith|no faith|zero faith|untrustworthy|unacceptable|lousy|crap|crappy|it sucks|this sucks|trash|filthy|wretched|terribly|horribly|miserable|laughable", -0.85, "reject"),
  // Words that can be about the road or an accident too ("brake failure", "reckless drivers", "it was a nightmare"):
  // only counted with a word for the product right next to them.
  rule("product faults (en)", "broken|flawed|defective|faulty|unreliable|buggy|bug-ridden|fragile|obsolete|inefficient|reckless|dangerous|hazardous|disaster|catastrophe|nightmare|failure|fail|invasive|intrusive|spy|terrifying|scary|annoying|irritating|inferior", -0.7, "reject", { needsProduct: true }),
  // Strong Hindi rejections (always an opinion) and words that can also be about roads or accidents (only next to the product).
  rule("strong reject (hi)", "फ्रॉड|फ्रॉड है|घिनौना|घिनौनी|झूठा दावा|झूठे दावे|कचरा|रद्दी|स्कैम|बेवकूफ बनाने|बेवकूफ बना रहे|उल्लू बनाने|पैसे लूटने|पैसा लूटने|पैसे लूट|पैसा डुबाने|पैसे डुबाने|नामुमकिन|सिरदर्द|सिर दर्द|बंद कर दो|बंद कर दीजिए|पिट जाएगा|पिट जाएगी|डूब जाएगा|डूब जाएगी|शून्य प्रतिशत|ज़ीरो प्रतिशत|जीरो प्रतिशत|zero percent|शून्य विश्वास|रत्ती भर भी भरोसा नहीं|बेहद खराब|सबसे खराब|सबसे बेकार|सबसे रद्दी|kachra|raddi|ghinona|jhootha|jhutha|namumkin|sirdard|band kar do|pit jayega|doob jayega|ullu bana|bewakoof bana|paise loot|scam hai|fraud hai", -0.85, "reject"),
  rule("product faults (hi)", "भयानक|भयंकर|खतरनाक|खतरा|फेल|फ़ेल|झूठा|झूठी|बेकार सा|घटिया सा|bhayanak|khatarnak|khatra|fail hai", -0.7, "reject", { needsProduct: true }),
  rule("won't recommend", "सलाह नहीं दूंगा|सलाह नहीं दूंगी|सलाह नहीं दूँगा|सलाह नहीं देंगे|रिकमेंड नहीं|recommend नहीं|won't recommend|wouldn't recommend|would not recommend|will not recommend|never recommend|किसी को नहीं बताऊंगा|kisi ko recommend nahi|recommend nahi karunga|salah nahi dunga", -0.75, "reject"),
  rule("would not install (hi)", "कभी न लगाऊं|कभी ना लगाऊं|न लगाऊं|ना लगाऊं|कभी नहीं लगाऊं|कभी न लगवाऊं|न लगवाऊं|कभी न लूं|न खरीदूं|kabhi na lagaun|kabhi na lagwaun|na lagaun", -0.75, "reject"),
  // Strong Hindi praise (mirror of "strong reject (hi)").
  rule("strong praise (hi)", "अद्भुत|क्रांतिकारी|वरदान|पूरा समर्थन|समर्थन करता हूं|समर्थन करती हूं|100% समर्थन|अतुलनीय|मानसिक शांति|मास्टरपीस|सर्वश्रेष्ठ|सर्वश्रेठ|गेम-चेंजर|गेम चेंजर|गेमचेंजर|जादू कर|अटूट विश्वास|अटूट भरोसा|पूरा भरोसा है|सही रास्ते पर|अभूतपूर्व|बेजोड़|इतिहास रच|जानें बचाने|जानें बचाएगा|लाखों जानें|निशब्द|रोंगटे खड़े|वफादार कस्टमर|वफादार ग्राहक|बेताब हूं|प्रेरित करूंगा|प्रेरित करूंगी|सबको सलाह दूंगा|recommend करूंगा|अनिवार्य होना चाहिए|अनिवार्य कर देना चाहिए|लगवाने के लिए तैयार|लगवाने को तैयार|लगवाने के लिए पूरी तरह तैयार|खरीदने के लिए तैयार|खुशी-खुशी|खुशी खुशी|उत्साहित हूं|बहुत खुशी|adbhut|krantikari|vardaan|sarvashreshth|lajawab|jadoo|atoot vishwas|khushi khushi|lagwane ke liye taiyaar", 0.85, "praise"),
  rule("product qualities (hi)", "एडवांस|सटीक|तेज़|भरोसेमंद|विश्वसनीय|कारगर|असरदार|स्मार्ट|बढ़िया काम|advance|bharosemand", 0.6, "praise", { needsProduct: true }),
  rule("no problem", "दिक्कत नहीं|कोई दिक्कत नहीं|रत्ती भर भी दिक्कत नहीं|परेशानी नहीं|कोई परेशानी नहीं|बड़ी बात नहीं|कोई बड़ी बात नहीं|छोटी सी बात|no problem|not a problem|no issue|no issues|koi dikkat nahi|dikkat nahi|koi problem nahi|problem nahi", 0.4, "praise"),
  rule("junk","junk|a joke|complete joke|total joke|joke hai|मज़ाक है|मजाक है|time pass|timepass|टाइम पास|टाइमपास|gimmick|गिमिक|dikhawa|दिखावा", -0.8, "reject"),
  rule("unnecessary", "unnecessary|not a fan|not really a fan|nobody needs|no one needs|no chance|कोई मतलब नहीं|कोई मतलब नही|koi matlab nahi|कोई जरूरत नहीं|kya zaroorat|क्या ज़रूरत|क्या जरूरत|not worth it|not worth|वर्थ नहीं|worth nahi", -0.6, "reject"),
  rule("meh", "nothing special|nothing great|nothing new|so so|so-so|कुछ खास नहीं|कुछ ख़ास नहीं|kuch khaas nahi|kuch khas nahi|कुछ नया नहीं|kuch naya nahi", -0.25, "reject"),
  rule("rip-off", "rip-off|ripoff|rip off|लूट|loot hai|loot|not a penny|not one penny|डाका|लूट है", -0.75, "price", { topic: "Pricing" }),
  rule("no way", "no way|not a single rupee|not one rupee|एक पैसा नहीं|एक रुपया नहीं|एक भी पैसा नहीं|ek paisa nahi|ek rupaya nahi|ek bhi paisa nahi|मुफ्त में भी नहीं|फ्री में भी नहीं|free mein bhi nahi|free me bhi nahi|even for free|not even for free", -0.75, "price", { topic: "Pricing" }),
  rule("will not work", "flop|फ्लॉप|नहीं चलेगा|नहीं चल पाएगा|काम नहीं करेगा|काम नहीं आएगा|काम नहीं करेगी|will not work|won't work|wont work|doesn't work|does not work|not going to work", -0.6, "reject", { topic: "Features" }),
  rule("would not use", "इस्तेमाल नहीं करूंगा|यूज नहीं करूंगा|नहीं लूंगा|नहीं खरीदूंगा|नहीं लगवाऊंगा|will not use|won't use|wouldn't use|would not use|not going to use|never use", -0.7, "reject"),
  rule("price too high", "too expensive|बहुत महंगा|महंगा|महंगी|expensive|costly|कौन देगा|कोई नहीं देगा|कुछ नहीं देगा|नहीं दूंगा|पैसे नहीं दूंगा|won't pay|will not pay|would not pay|not pay|too much", -0.5, "price", { weight: 0.5, topic: "Pricing" }),
  rule("doubts it works", "i doubt it will work|doubt it will work|doubt that it will work|not sure it will work|not sure it would work|शक है कि|मुझे शक है|काम करेगा या नहीं", -0.5, "reject", { topic: "Features" }),
  rule("nobody will use", "nobody will install|no one will install|nobody will use|no one will use|nobody will buy|no one will buy|कोई नहीं लगवाएगा|कोई नहीं खरीदेगा|कोई इस्तेमाल नहीं करेगा", -0.6, "reject"),
  rule("no trust", "भरोसा नहीं|विश्वास नहीं|ट्रस्ट नहीं|don't trust|do not trust|not trust|trust issue|ट्रस्ट इश्यू", -0.5, "reject"),
  rule("does not think so", "नहीं लगता|i don't think|i do not think|doesn't seem", -0.4, "reject"),
  rule("confusing", "confusing|complicated|भ्रमित|कन्फ्यूज|कॉम्प्लिकेटेड|कठिन", -0.55, "reject", { topic: "UX" }),
  // "the roads are bad", "लोग परेशान हैं" are about the problem, not about the product, so these only count right next to a word for the product.
  rule("bad", "bad|poor|slow|खराब|धीमा|निराश|frustrating|frustrated|annoying|परेशान|hate|नफरत", -0.6, "reject", { needsProduct: true }),
  // ---- more ways of saying it: Hindi, Hinglish typed in English letters, English --------------------------------
  rule("very good", "super|super idea|super hai|kamaal|kamal ka|kamaal ka|kamaal hai|lajawab|lajawaab|shandar|shaandar|mast hai|बहुत बढ़िया है|excellent idea|great concept|great product|bahut badhiya|bahut badhia|bahut accha|bahut acha|bahut achha|बहुत बढ़िया|बहुत ही अच्छा|बहुत ही बढ़िया|ekdum mast|एकदम मस्त|zabardast|jabardast|ज़बरदस्त|best idea|great idea|superb|outstanding|wonderful|really good|very good|really nice|very nice|really useful|very useful|बहुत उपयोगी|बहुत यूसफुल|बहुत यूज़फुल|बहुत जरूरी|बहुत ज़रूरी|bahut zaroori|bahut jaruri", 0.8, "praise"),
  rule("nice", "accha idea|acha idea|achha idea|badhiya|badiya|badhia|bढ़िया|sahi hai|bilkul sahi|makes sense|मेक्स सेंस|मेकस सेंस|सही बात है|सही कह रहे|समझ में आता है|समझ आता है|impressive|impressed|इम्प्रेस|इंप्रेस|प्रभावित|pasand aaya|pasand aayi|pasand hai|पसंद आई", 0.5, "praise"),
  rule("useful (typed)", "kaam ka hai|kaam ki cheez|kaam aayega|kaam aaega|kaam aa sakta|useful hai|faydemand|फायदेमंद|फ़ायदेमंद|लाभदायक|beneficial|बेनिफिशियल|बेनिफीचल|valuable|worth it|worth the money|worth paying|paisa vasool|पैसा वसूल|helps a lot|bahut help|काफी मदद|बहुत मदद|बड़ी मदद", 0.6, "praise", { topic: "Features" }),
  rule("needed (typed)", "zaroorat hai|jarurat hai|ज़रूरत है|जरूरत है|जरुरत है|need of the hour|समय की मांग|वक्त की जरूरत|must have|must-have|should be there|होना चाहिए ही|aaj ki zaroorat|इसकी सख्त जरूरत", 0.5, "praise", { topic: "Features" }),
  rule("would use (typed)", "use karunga|use karungi|yuj karunga|lagwaunga|lagwa lunga|lagwa lungi|le lunga|le lungi|khareedunga|kharidunga|i'd use|i'd definitely use|i would definitely use|i will definitely use|i'd install|i'd buy|i'll buy|i'll use|i'll install|i'll take it|sign me up|count me in|मैं लूंगा|मैं ले लूंगा|मैं लगवाऊंगा|मैं खरीदूंगा|मैं यूज करूंगा|मैं तो लूंगा|मैं तो लगवाऊंगा", 0.75, "praise"),
  rule("would pay (typed)", "paise dunga|paisa dunga|pay karunga|pay karungi|paise de dunga|dunga paise|ready to pay|happy to pay|willing to pay|i'd pay|i would pay|i will pay|i can pay|पैसे दे सकता|पैसे दे सकती|पैसे देने को तैयार|पैसे देने में दिक्कत नहीं|पैसे देने में कोई दिक्कत नहीं", 0.65, "praise", { topic: "Pricing" }),
  rule("affordable", "affordable|अफॉर्डेबल|अफोर्डेबल|अफोर्डेबल|वाजिब|reasonable price|reasonably priced|सस्ता है|सस्ती है|कम दाम|कम कीमत|ठीक दाम|सही दाम|सही कीमत|ठीक कीमत|कीमत ठीक है|दाम ठीक है|price ठीक है|price theek hai|price sahi hai|sasta hai", 0.5, "praise", { topic: "Pricing" }),
  rule("safety plus point", "प्लस पॉइंट|प्लस प्वाइंट|plus point|plus points|ज़्यादा सेफ्टी|ज्यादा सेफ्टी|सेफ्टी ज़्यादा|सेफ्टी ज्यादा|ज़्यादा सुरक्षा|ज्यादा सुरक्षा|सुरक्षा ज़्यादा|सुरक्षा ज्यादा|safety ज्यादा|more safety|safer", 0.5, "praise", { topic: "Features" }),
  rule("positive market", "पॉजिटिव रिव्यू|पॉज़िटिव रिव्यू|positive review|positive reviews|अच्छे रिव्यू|अच्छा रिव्यू|positive feedback", 0.3, "praise"),
  rule("promising","promising|उम्मीद है|होप है|hope it works|hope this works|all the best|best of luck|ऑल द बेस्ट|शुभकामना|शुभकामनाएं|good luck", 0.3, "praise"),
  rule("exciting", "excited|एक्साइटेड|उत्साहित|exciting|इंट्रेस्टेड|interested|दिलचस्पी है|रुचि है|interest hai", 0.5, "praise"),
  rule("not interested", "not interested|interested nahi|इंटरेस्टेड नहीं|इंटरेस्टेड नही|दिलचस्पी नहीं|दिलचस्पी नही|रुचि नहीं|रुचि नही|interest nahi|no interest", -0.65, "reject"),
  rule("no need", "don't need|do not need|no need|dont need|not needed|जरूरत नहीं|ज़रूरत नहीं|जरूरत नही|ज़रूरत नही|जरुरत नहीं|zaroorat nahi|jarurat nahi|ज़रूरी नहीं|जरूरी नहीं|जरूरी नही", -0.6, "reject"),
  rule("no point", "kya fayda|क्या फायदा|क्या फ़ायदा|kya faida|no point|pointless|कोई फायदा नहीं|कोई फ़ायदा नहीं|कोई फायदा नही|no benefit|बिना मतलब|बेमतलब|बे-मतलब|faida nahi|fayda nahi", -0.6, "reject"),
  rule("bad idea", "bad idea|बुरा आइडिया|खराब आइडिया|गलत आइडिया|silly idea|stupid idea|rubbish|nonsense|bakwas|बकवास|scam|fraud|धोखा|cheating|धंधा है|दुकानदारी", -0.8, "reject"),
  rule("will not work (typed)", "nahi chalega|nahi chalegi|nahi chalenge|kaam nahi karega|kaam nahi karegi|flop hoga|fail ho jayega|fail hoga|नहीं चलेगी|नहीं चलेंगे|काम नहीं कर पाएगा|काम नहीं कर पाएगी|काम नहीं करेंगे|कारगर नहीं|कारगर नही|असरदार नहीं|practical nahi|practical नहीं|प्रैक्टिकल नहीं|not practical|impractical|unrealistic|अनरियलिस्टिक|मुमकिन नहीं|संभव नहीं|possible nahi|not possible", -0.6, "reject", { topic: "Features" }),
  rule("would not use (typed)", "use nahi karunga|use nahi karungi|nahi lunga|nahi lungi|nahi lagwaunga|nahi khareedunga|नहीं लगवाऊंगी|नहीं खरीदूंगी|नहीं लूंगी|यूज नहीं करूंगी|नहीं करवाऊंगा|i'd not use|i would never|i will never use|i won't buy|i won't install|i will not buy|i will not install", -0.7, "reject"),
  rule("no trust (typed)", "bharosa nahi|vishwas nahi|trust nahi|भरोसा नही|विश्वास नही|ट्रस्ट नही|trust issues|trust issue hai|कौन भरोसा करेगा|who will trust|can't trust|cannot trust|cant trust", -0.5, "reject"),
  rule("too expensive (typed)", "mehnga|mehenga|mahanga|mehngi|महंगा है|महँगा है|बहुत महंगा|costly hai|too costly|overpriced|ओवरप्राइस्ड|दाम ज्यादा|कीमत ज्यादा|रेट ज्यादा|price ज्यादा|ज्यादा है दाम|pocket पे भारी|जेब पर भारी|जेब पे भारी|दे नहीं पाएंगे|नहीं दे पाएगा|नहीं दे पाएंगे|नहीं दे पाऊंगा", -0.5, "price", { weight: 0.5, topic: "Pricing" }),
  rule("distrust", "ट्रस्ट ना करें|ट्रस्ट न करें|ट्रस्ट नहीं करेंगे|ट्रस्ट नहीं करेगा|भरोसा ना करें|भरोसा न करें|भरोसा नहीं करेंगे|भरोसा नहीं करेगा|विश्वास ना करें|विश्वास नहीं करेंगे", -0.5, "reject"),
  rule("cannot afford","afford नहीं|afford nahi|अफोर्ड नहीं|अफॉर्ड नहीं|अफोर्ड नही|अफॉर्ड नही|can't afford|cannot afford|cant afford|सपोर्ट नहीं कर पा|बजट में नहीं|बजट से बाहर|beyond my budget|out of budget|budget nahi|बजट नहीं", -0.5, "price", { weight: 0.5, topic: "Pricing" }),
  rule("who will", "कौन लगवाएगा|कौन खरीदेगा|कौन इस्तेमाल करेगा|कौन यूज करेगा|who will install|who will buy|who will use|who would buy|who would pay|who would install", -0.5, "reject"),
  rule("hard to sell", "बेचना मुश्किल|बेचना मुश्किल होगा|difficult to sell|hard to sell|बेचना आसान नहीं|market नहीं मिलेगा|मार्केट नहीं मिलेगा", -0.4, "reject"),
  // ---- doubts and open questions: a mild, capped negative, never a rejection -----------------------------------
  rule("doubt", "दिक्कत|दिकत|problem|issue|डाउट|doubt|कैसे होगा|कैसे होगी|कैसे काम|how will|how would|how does it work|not sure|sure nahi|श्योर नहीं|श्योर नही|पक्का नहीं|पक्का नही|skeptical|sceptical|संदेह|समझ नहीं आया|समझ नही आया|samajh nahi aaya|pata nahi kaise|पता नहीं कैसे|practically|प्रैक्टिकली|dikkat|mushkil|kaise hoga|kaise karenge|कैसे करेंगे", -0.04, "doubt"),
];

const NEGATOR = new RegExp(`${WORD}(?:नहीं|नही|मत|not|no|nobody|no one|never|dont|don't|doesnt|doesn't|isnt|isn't|cant|can't|cannot|wont|won't|nahi|nahin)${WORD_END}`, "u");
const QUESTION_WORD = new RegExp(`${WORD}(?:क्या|कितना|कितनी|कितने|kya|kitna|kitni|how|what|do you|would you|is it|are you)${WORD_END}`, "u");
const INTENSIFIER = new RegExp(`${WORD}(?:very|really|totally|completely|absolutely|extremely|highly|truly|so|super|utterly|incredibly|phenomenally|wonderfully|exceptionally|tremendously|deeply|profoundly|thoroughly|horribly|terribly|absolute|total|complete|utter|pure|most|बहुत|बहुत ही|बिल्कुल|बिलकुल|एकदम|सच में|सचमुच|बेहद|पूरी तरह|सबसे|bahut|bohot|bilkul|ekdum|sach mein|sach me|ekdam|sabse)${WORD_END}`, "u");
const BOUNDARY = /[.!?।\n,;]/;
/** Words that start a new clause: a "not" before them does not belong to what comes after them. */
const CLAUSE_WORD = /(?:^|\s)(?:लेकिन|मगर|पर|but|however|though|क्योंकि|because|और|and)(?=\s|$)/gu;
const PRODUCT_WORD = new RegExp(`${WORD}(?:trata|सिस्टम|तकनीक|कॉन्सेप्ट|प्रोजेक्ट|प्रोडक्ट|डिवाइस|दावा|concept|system|software|technology|tech|startup|company|hardware|engineering|unit|तराता|ट्राटा|ट्रेटा|तरता|त्राता|app|एप|ऐप|अप्लिकेशन|application|device|डिवाइस|सेंसर|sensor|product|प्रोडक्ट|idea|आइडिया|आईडिया|solution|सोल्यूशन|सॉल्यूशन|dashboard|report|feature|फीचर|इसका|इसकी|इसमें|इसे|यह|ये|this|it)${WORD_END}`, "u");

function clauseBefore(text: string, start: number) {
  const slice = text.slice(Math.max(0, start - 80), start);
  const cut = Math.max(...Array.from(slice.matchAll(new RegExp(BOUNDARY.source, "g")), (match) => match.index! + 1), 0);
  let clause = slice.slice(cut);
  const words = Array.from(clause.matchAll(CLAUSE_WORD));
  if (words.length) { const last = words[words.length - 1]; clause = clause.slice(last.index! + last[0].length); }
  return clause.trim().split(/\s+/).filter(Boolean);
}

function clauseAfter(text: string, end: number) {
  const slice = text.slice(end, end + 80);
  const stop = slice.search(BOUNDARY);
  let clause = stop < 0 ? slice : slice.slice(0, stop);
  const first = clause.search(CLAUSE_WORD.source ? new RegExp(CLAUSE_WORD.source, "u") : CLAUSE_WORD);
  if (first >= 0) clause = clause.slice(0, first);
  return clause.trim().split(/\s+/).filter(Boolean);
}

/** Every opinion phrase in the call, with its direction after checking negation and questions. */
export function findCues(raw: string): Cue[] {
  return findCuesNormalized(normalizeText(raw));
}

/** Same as findCues for text that is already normalised; the positions in the result are positions in that text. */
export function findCuesNormalized(text: string): Cue[] {
  const found: Cue[] = [];
  const taken: Array<[number, number]> = [];
  // Longer, more specific phrases claim their words first ("nobody will use" is one cue, "will use" inside it is not
  // another one); between phrases of the same length the stronger rule wins.
  const candidates: Array<{ item: Rule; match: RegExpMatchArray }> = [];
  for (const item of RULES) for (const match of text.matchAll(item.re)) candidates.push({ item, match });
  candidates.sort((a, b) => b.match[0].length - a.match[0].length || Math.abs(b.item.value) - Math.abs(a.item.value));
  for (const { item, match } of candidates) {
    {
      const start = match.index!;
      const end = start + match[0].length;
      if (taken.some(([from, to]) => start < to && end > from)) continue;
      const beforeWords = clauseBefore(text, start);
      const afterWords = clauseAfter(text, end);
      // A negation sits right next to the phrase: three words before ("is not very useful"), five for praise ("I don't think it is useful"), two after ("उपयोगी नहीं है").
      const before = beforeWords.slice(item.kind === "praise" ? -5 : -3).join(" ");
      const after = afterWords.slice(0, 2).join(" ");
      if (QUESTION_WORD.test(beforeWords.slice(-3).join(" "))) continue;
      // "यह खराब है" / "it is bad" (the product comes first) or "bad idea" (the very next word). A product word further on belongs to the next remark.
      if (item.needsProduct && !PRODUCT_WORD.test(`${beforeWords.slice(-4).join(" ")} ${afterWords.slice(0, 1).join(" ")}`)) continue;                                // the interviewer asking, not the customer answering
      let value = item.value;
      const negated = NEGATOR.test(before) || NEGATOR.test(after);
      if (negated && item.kind === "doubt") continue;                         // "no problem", "दिक्कत नहीं"
      if (negated && item.kind === "praise") value = -Math.abs(value) * 0.75; // "not useful", "उपयोगी नहीं"
      else if (negated && (item.kind === "reject" || item.kind === "price")) {
        // "नहीं चलेगा" etc. already contain the negation. Only a negation OUTSIDE the phrase flips it ("not bad").
        if (!NEGATOR.test(match[0])) value = Math.abs(value) * 0.4;
      }
      // "really useful", "बिल्कुल बेकार", "ekdum faltu": an intensifier right before an un-negated phrase makes it count more.
      if (!negated && item.kind !== "doubt" && INTENSIFIER.test(beforeWords.slice(-2).join(" "))) value = Math.sign(value) * Math.min(0.95, Math.abs(value) * 1.2);
      taken.push([start, end]);
      found.push({ text: match[0], value, weight: item.weight ?? 1, kind: value < 0 && item.kind === "praise" ? "reject" : item.kind, topic: item.topic, start, end });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

/**
 * Score a whole call from -1 to +1.
 * Opinion phrases are averaged with a prior of one neutral vote (so one remark is not a verdict), then doubts shave
 * off at most 0.15 (and at most 0.08 when nothing positive or negative was said at all).
 */
export function scoreCall(text: string): CallSentiment {
  const cues = findCues(text);
  const opinions = cues.filter((cue) => cue.kind !== "doubt");
  const doubts = cues.filter((cue) => cue.kind === "doubt");
  const weight = opinions.reduce((sum, cue) => sum + cue.weight, 0);
  const opinionScore = weight ? opinions.reduce((sum, cue) => sum + cue.value * cue.weight, 0) / (weight + 0.5) : 0;
  const doubtShare = Math.min(doubts.length * 0.03, opinions.length ? 0.15 : 0.08);
  const score = Math.max(-1, Math.min(1, opinionScore - doubtShare));
  const strength = opinions.length;
  return {
    score: Math.round(score * 1000) / 1000,
    opinionScore: Math.round(opinionScore * 1000) / 1000,
    cues,
    confidence: strength === 0 ? "none" : strength < 3 ? "low" : "ok",
  };
}

/** The text around each opinion phrase (about two sentences' worth), merged when they touch. This is all a model should read. */
export function opinionWindows(text: string, cues: Cue[], radius = 110) {
  const lowered = normalizeText(text);
  const spans: Array<[number, number]> = [];
  for (const cue of cues.filter((item) => item.kind !== "doubt")) {
    const from = Math.max(0, cue.start - radius);
    const to = Math.min(lowered.length, cue.end + radius);
    const last = spans[spans.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else spans.push([from, to]);
  }
  // `normalizeText` only drops a few zero-width characters and the nukta, so offsets can drift slightly on Devanagari.
  // Windows are cut from the normalised text for that reason, which is also what the model should read.
  return spans.map(([from, to]) => lowered.slice(from, to).trim()).filter(Boolean);
}

/** Short readable pieces of the call for the "key points" list: punctuation first, then every ~24 words. */
export function callUnits(text: string, maxWords = 24) {
  const units: string[] = [];
  for (const part of text.split(/(?<=[.!?।\n])\s*/)) {
    const words = part.trim().split(/\s+/).filter(Boolean);
    for (let index = 0; index < words.length; index += maxWords) units.push(words.slice(index, index + maxWords).join(" "));
  }
  return units;
}

/** Key points: the pieces that contain an opinion phrase, strongest first, plus nothing else. */
export function opinionKeyPoints(text: string, limit = 6) {
  const units = callUnits(text);
  const scored = units.map((unit) => {
    const cues = findCues(unit).filter((cue) => cue.kind !== "doubt");
    return { unit, weight: cues.reduce((sum, cue) => sum + Math.abs(cue.value), 0) };
  }).filter((item) => item.weight > 0 && item.unit.length > 18);
  const seen = new Set<string>();
  return scored.sort((a, b) => b.weight - a.weight).filter(({ unit }) => {
    const key = normalizeText(unit).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit).map(({ unit }) => unit);
}
