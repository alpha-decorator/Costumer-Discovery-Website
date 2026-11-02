// Price extraction tests. Each case: one or more customer answers after a pitch; `want` is the exact list of prices
// expected (amount, period, stance, optional limit, who). Order does not matter.
//   node "nlp engine/harness/prices-run.mjs"
const PITCH = [
  "Interviewer: Hello, how are you?",
  "Customer: I am fine.",
  "Interviewer: We are building Trata, a sensor for your car that detects a crash and calls an ambulance and your family.",
  "Interviewer: The Trata app also shares your live location automatically.",
];
const call = (...lines) => [...PITCH, ...lines].join("\n");
const P = (amount, period, stance, extra = {}) => ({ amount, period, stance, who: "customer", ...extra });

export const PRICE_CASES = [
  { id: "en-basic", text: call("Interviewer: How much would you pay?", "Customer: I can pay around 1500 rupees for the device, and maybe 99 rupees a month for the service. More than 3000 a year is too expensive for me."),
    want: [P(1500, "one_time", "accepts"), P(99, "month", "accepts"), P(3000, "year", "too_high", { limit: "max" })] },
  { id: "en-upto", text: call("Interviewer: What price would work for you?", "Customer: Up to ₹2,000 a year is fine."),
    want: [P(2000, "year", "accepts", { limit: "max" })] },
  { id: "en-k", text: call("Interviewer: What would you pay?", "Customer: 2k is too much, maybe 500 per month max."),
    want: [P(2000, "month", "too_high"), P(500, "month", "accepts", { limit: "max" })] }, // "2k" takes the month from the same sentence
  { id: "en-suggest", text: call("Interviewer: What should the price be?", "Customer: It should be around 999 rupees one time, not more."),
    want: [P(999, "one_time", "suggests")] },
  { id: "en-asked-yes", text: call("Interviewer: Would you pay 1500 rupees a year for it?", "Customer: Yes, sure."),
    want: [{ amount: 1500, period: "year", stance: "accepts", who: "interviewer" }] },
  { id: "en-asked-no", text: call("Interviewer: Would you pay 1500 rupees a year for it?", "Customer: No, that is too costly."),
    want: [{ amount: 1500, period: "year", stance: "too_high", who: "interviewer" }] },
  { id: "hi-hazaar", text: call("Interviewer: आप इसके लिए कितना देंगे?", "Customer: दो हज़ार रुपये तक दे दूंगा, उससे ज़्यादा नहीं।"),
    want: [P(2000, "unspecified", "accepts", { limit: "max" })] },
  { id: "hi-month", text: call("Interviewer: आप इसके लिए कितना देंगे?", "Customer: महीने के 100 रुपये चलेगा, पर साल के 5000 बहुत महंगा है।"),
    want: [P(100, "month", "accepts"), P(5000, "year", "too_high")] },
  { id: "hi-dedh", text: call("Interviewer: इसकी कीमत क्या होनी चाहिए?", "Customer: डेढ़ हज़ार रुपये होनी चाहिए।"),
    want: [P(1500, "unspecified", "suggests")] },
  { id: "hn-basic", text: call("Interviewer: Aap iske liye kitna denge?", "Customer: Saal ka 1000 rupaye de dunga, par 3000 bahut zyada hai."),
    want: [P(1000, "year", "accepts"), P(3000, "year", "too_high")] }, // the second amount takes the year from the same sentence
  { id: "hn-hazaar", text: call("Interviewer: Kitna pay karoge?", "Customer: Do hazaar tak chalega, ek baar ka."),
    want: [P(2000, "one_time", "accepts", { limit: "max" })] },
  // ---- numbers that are not prices
  { id: "not-money", text: call("Interviewer: Have you been in an accident?", "Customer: Yes, 2 years ago, the ambulance took 40 minutes and I was 15 km from the hospital. My car cost 8 lakh.", "Interviewer: What do you think of the idea?", "Customer: It is a good idea. I have been driving since 2015."),
    want: [] },
  { id: "not-money-hi", text: call("Interviewer: आपके साथ कोई एक्सीडेंट हुआ है?", "Customer: हाँ, 3 साल पहले, एम्बुलेंस 30 मिनट में आई। मेरी गाड़ी 6 लाख की है।"),
    want: [] },
];
