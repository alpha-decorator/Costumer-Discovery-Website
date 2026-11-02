// Long extreme calls, written after the evidence pull was added, to check it on wording it has not seen.
// Plus two long controls (one mixed, one only mildly positive) that must NOT be pushed to the extremes.
//   node "nlp engine/harness/run.mjs" --set long --verbose
// Bands here are stricter: xp = at least +0.85, xn = at most -0.85.
const call = (lines) => lines.join("\n");

export const LONG_BANDS = { xp: [0.85, 1], xn: [-1, -0.85] };

export const CASES = [
  {
    id: "L-en-xp", lang: "en", expect: "xp", text: call([
      "Interviewer: Hi, thanks for taking the call. We are building Trata, a small sensor for your car that detects a crash on its own.",
      "Interviewer: The moment it detects one, it calls an ambulance, alerts nearby cab drivers and sends your live location to your family.",
      "Interviewer: What is your first reaction to this idea?",
      "Customer: Honestly, I love it. This is one of the best ideas I have heard in years. It is brilliant, it is practical, and it is exactly what Indian roads need. I am genuinely impressed, it is a fantastic concept and a real life saver.",
      "Interviewer: How would you feel about having the device installed in your car?",
      "Customer: I would install it tomorrow. It is a wonderful product, very useful, and the peace of mind alone is priceless. My wife drives on the highway every week, so for my family this is a game changer. Superb work, really.",
      "Interviewer: Would you pay around 2000 rupees a year for it?",
      "Customer: Yes, absolutely, I would happily pay. Honestly it is worth every rupee, totally worth the money. I will recommend it to all my friends and my whole office. Where can I buy it? I can't wait for the launch, this is outstanding.",
    ]),
  },
  {
    id: "L-en-xn", lang: "en", expect: "xn", text: call([
      "Interviewer: Hi, thanks for taking the call. We are building Trata, a small sensor for your car that detects a crash on its own.",
      "Interviewer: The moment it detects one, it calls an ambulance, alerts nearby cab drivers and sends your live location to your family.",
      "Interviewer: What is your first reaction to this idea?",
      "Customer: Frankly, I hate it. It is a terrible idea and completely useless. It sounds like a gimmick, a total waste of money, and honestly a bit of a scam. I am not impressed at all, it is pointless and stupid.",
      "Interviewer: How would you feel about having the device installed in your car?",
      "Customer: I would never install it. It is invasive and creepy, and the device is going to be unreliable and buggy. It is rubbish, I don't trust it, and I don't want it anywhere near my car. Not for me.",
      "Interviewer: Would you pay around 2000 rupees a year for it?",
      "Customer: No way, not a single rupee. It is overpriced garbage. I won't pay, I won't buy it, and I will tell everyone to stay away from it. Worst product pitch I have heard, awful and pathetic.",
    ]),
  },
  {
    id: "L-hi-xp", lang: "hi", expect: "xp", text: call([
      "इंटरव्यूअर: नमस्ते! हम Trata बना रहे हैं। यह गाड़ी में लगने वाला सेंसर है जो एक्सीडेंट को अपने आप पहचानता है।",
      "इंटरव्यूअर: फिर यह तुरंत एम्बुलेंस बुलाता है, पास के कैब ड्राइवर को अलर्ट करता है और परिवार को लाइव लोकेशन भेजता है।",
      "इंटरव्यूअर: आपको यह आइडिया कैसा लगा?",
      "ग्राहक: वाह, यह तो कमाल का आइडिया है! बहुत ही शानदार और बेहतरीन सोच है। मुझे यह बहुत पसंद आया। यह सच में जान बचाने वाली चीज़ है, बहुत काम की चीज़ है।",
      "इंटरव्यूअर: क्या आप इसे अपनी गाड़ी में लगवाना चाहेंगे?",
      "ग्राहक: हां बिल्कुल, मैं तो कल ही लगवा लूंगा। यह मेरे परिवार के लिए वरदान है। इसका सिस्टम बहुत ही एडवांस और भरोसेमंद लगता है। यह एकदम लाजवाब और अद्भुत प्रोडक्ट है।",
      "इंटरव्यूअर: क्या आप इसके लिए साल के 2000 रुपये देंगे?",
      "ग्राहक: हां, खुशी-खुशी दूंगा, पैसा वसूल है। मैं अपने सभी दोस्तों और रिश्तेदारों को भी इसे लगवाने के लिए प्रेरित करूंगा। आप लोग जल्दी लॉन्च कीजिए, मैं बेताब हूं। सच में बहुत बढ़िया काम है!",
    ]),
  },
  {
    id: "L-hi-xn", lang: "hi", expect: "xn", text: call([
      "इंटरव्यूअर: नमस्ते! हम Trata बना रहे हैं। यह गाड़ी में लगने वाला सेंसर है जो एक्सीडेंट को अपने आप पहचानता है।",
      "इंटरव्यूअर: फिर यह तुरंत एम्बुलेंस बुलाता है, पास के कैब ड्राइवर को अलर्ट करता है और परिवार को लाइव लोकेशन भेजता है।",
      "इंटरव्यूअर: आपको यह आइडिया कैसा लगा?",
      "ग्राहक: सच कहूं तो यह बिल्कुल बेकार आइडिया है। एकदम फालतू और बकवास चीज़ है। मुझे यह बिल्कुल पसंद नहीं आया, यह किसी काम का नहीं है।",
      "इंटरव्यूअर: क्या आप इसे अपनी गाड़ी में लगवाना चाहेंगे?",
      "ग्राहक: नहीं, मैं कभी नहीं लगवाऊंगा। यह डिवाइस घटिया होगा और सिर्फ सिरदर्द देगा। मुझे इस पर रत्ती भर भी भरोसा नहीं है। यह पैसे लूटने का धोखा और स्कैम लगता है।",
      "इंटरव्यूअर: क्या आप इसके लिए साल के 2000 रुपये देंगे?",
      "ग्राहक: एक पैसा नहीं दूंगा, मुफ्त में भी नहीं लूंगा। यह पैसे की बर्बादी है, कचरा प्रोडक्ट है। मैं किसी को भी इसकी सलाह नहीं दूंगा। इसे बंद कर दीजिए, यह मार्केट में पिट जाएगा।",
    ]),
  },
  {
    id: "L-hn-xp", lang: "hn", expect: "xp", text: call([
      "Interviewer: Namaste! Hum Trata bana rahe hain, ek sensor jo gaadi mein lagta hai aur accident ko automatically detect karta hai.",
      "Interviewer: Phir yeh ambulance ko call karta hai, nearby cab drivers ko alert karta hai aur family ko live location bhejta hai.",
      "Interviewer: Aapko yeh idea kaisa laga?",
      "Customer: Arre wah, kamaal ka idea hai yaar! Ekdum mast, zabardast cheez hai. Mujhe bahut pasand aaya, sach mein bahut kaam ki cheez hai, isse jaan bach sakti hai.",
      "Interviewer: Kya aap ise apni gaadi mein lagwayenge?",
      "Customer: Haan bilkul, main toh pakka lagwa lunga. Lajawab product hai, shandar soch hai. Har gaadi mein honi chahiye yeh cheez. Bahut badhiya kaam kar rahe ho aap log.",
      "Interviewer: Kya aap iske liye saal ke 2000 rupaye denge?",
      "Customer: Haan, khushi khushi de dunga, paisa vasool hai. Main apne saare doston ko bhi bolunga. Jaldi launch karo, kab milega? Super idea hai, all the best!",
    ]),
  },
  {
    id: "L-hn-xn", lang: "hn", expect: "xn", text: call([
      "Interviewer: Namaste! Hum Trata bana rahe hain, ek sensor jo gaadi mein lagta hai aur accident ko automatically detect karta hai.",
      "Interviewer: Phir yeh ambulance ko call karta hai, nearby cab drivers ko alert karta hai aur family ko live location bhejta hai.",
      "Interviewer: Aapko yeh idea kaisa laga?",
      "Customer: Bakwaas idea hai yaar, ekdum bekaar. Bilkul faltu cheez hai, ghatiya. Mujhe bilkul pasand nahi aaya, kisi kaam ka nahi hai.",
      "Interviewer: Kya aap ise apni gaadi mein lagwayenge?",
      "Customer: Nahi, kabhi nahi lagwaunga. Mujhe iski koi zaroorat nahi, nahi chahiye. Bharosa nahi hai mujhe aise devices pe, yeh sab time pass aur dikhawa hai.",
      "Interviewer: Kya aap iske liye saal ke 2000 rupaye denge?",
      "Customer: Ek paisa nahi dunga, free mein bhi nahi lunga. Paise ki barbadi hai, loot hai yeh toh. Kachra product hai, band kar do isko, pit jayega market mein.",
    ]),
  },
  {
    id: "L-mx-xp", lang: "hi", expect: "xp", text: call([
      "Interviewer: Hello sir, हम Trata बना रहे हैं, एक sensor जो car में लगता है और accident को automatically detect करता है।",
      "Interviewer: फिर यह ambulance को call करता है और family को live location भेजता है।",
      "Interviewer: आपको यह idea कैसा लगा?",
      "Customer: Sir यह really amazing है, बहुत ही brilliant idea है। Honestly मुझे बहुत पसंद आया, यह life saver है।",
      "Interviewer: क्या आप इसे अपनी car में लगवाएंगे?",
      "Customer: Yes definitely, मैं ज़रूर लगवाऊंगा। यह game changer है, बहुत useful और superb product है। मेरी family के लिए यह peace of mind है।",
      "Interviewer: क्या आप साल के 2000 रुपये देंगे?",
      "Customer: हां, happily pay करूंगा, totally worth it है। मैं सबको recommend करूंगा। Can't wait, जल्दी launch कीजिए, outstanding काम है!",
    ]),
  },
  {
    id: "L-mx-xn", lang: "hi", expect: "xn", text: call([
      "Interviewer: Hello sir, हम Trata बना रहे हैं, एक sensor जो car में लगता है और accident को automatically detect करता है।",
      "Interviewer: फिर यह ambulance को call करता है और family को live location भेजता है।",
      "Interviewer: आपको यह idea कैसा लगा?",
      "Customer: Sir यह totally useless है, बिल्कुल बेकार idea है। Honestly यह waste of money और एक scam लगता है।",
      "Interviewer: क्या आप इसे अपनी car में लगवाएंगे?",
      "Customer: No, मैं कभी नहीं लगवाऊंगा। यह device unreliable और creepy है, मुझे भरोसा नहीं है। यह rubbish है, मुझे नहीं चाहिए।",
      "Interviewer: क्या आप साल के 2000 रुपये देंगे?",
      "Customer: No way, एक पैसा नहीं दूंगा। यह overpriced garbage है, पैसे की बर्बादी है। Worst idea, मैं किसी को recommend नहीं करूंगा।",
    ]),
  },
  // ---- controls: long, but NOT extreme. They must stay where they belong.
  {
    id: "L-en-mixed", lang: "en", expect: "n0", text: call([
      "Interviewer: Hi, thanks for taking the call. We are building Trata, a small sensor for your car that detects a crash on its own.",
      "Interviewer: The moment it detects one, it calls an ambulance, alerts nearby cab drivers and sends your live location to your family.",
      "Interviewer: What is your first reaction to this idea?",
      "Customer: The idea is good, I like the family alert, that part is really useful. But I am not sure about the sensor, it might be unreliable on our roads.",
      "Interviewer: How would you feel about having the device installed in your car?",
      "Customer: Maybe. It is interesting, but I don't really need it right now. I would think about it.",
      "Interviewer: Would you pay around 2000 rupees a year for it?",
      "Customer: That is too expensive for me. If it was cheaper, maybe. The concept is nice but the price is too much.",
    ]),
  },
  {
    id: "L-hi-mild", lang: "hi", expect: "p", text: call([
      "इंटरव्यूअर: नमस्ते! हम Trata बना रहे हैं। यह गाड़ी में लगने वाला सेंसर है जो एक्सीडेंट को अपने आप पहचानता है।",
      "इंटरव्यूअर: फिर यह तुरंत एम्बुलेंस बुलाता है और परिवार को लाइव लोकेशन भेजता है।",
      "इंटरव्यूअर: आपको यह आइडिया कैसा लगा?",
      "ग्राहक: अच्छा है, ठीक लगा मुझे। काम का हो सकता है।",
      "इंटरव्यूअर: क्या आप इसे अपनी गाड़ी में लगवाना चाहेंगे?",
      "ग्राहक: शायद लगवा लूं, देखेंगे।",
      "इंटरव्यूअर: क्या आप इसके लिए साल के 2000 रुपये देंगे?",
      "ग्राहक: कीमत पर डिपेंड करता है, सोचूंगा।",
    ]),
  },
];
