"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createWorker, OEM } from "tesseract.js";
import { analyzeNotes } from "@/lib/notes-analysis";
import { analyzeNotesWithModel } from "@/lib/nlp-analysis";

type Tier = "Expert" | "Public" | "Newbie";
type Language = "en" | "hi" | "mixed";
type UiLanguage = "en" | "hi";
type AudioLanguageChoice = "auto" | "english" | "hindi";
type Customer = { id: string; name: string; initials: string; company: string; tier: Tier; date: string; sentiment: number; transcript: string; language: Language; topics: { UX: number; Pricing: number; Features: number }; keyPoints: string[]; audioName?: string; sourceType?: "audio" | "images" | "text"; imageNames?: string[]; analysisEngine?: "multilingual-transformer" | "lexical-fallback"; transcriptionStatus?: "processing" | "complete" | "interrupted" };
type UploadDraft = { name: string; company: string; tier: Tier };

const customers: Customer[] = [
  { id: "CD-1042", name: "Aarav Mehta", initials: "AM", company: "Northstar Labs", tier: "Expert", date: "Oct 22, 2026", sentiment: 0.86, transcript: "The reporting workflow is thoughtful. I would love a faster way to compare cohorts.", language: "en", topics: { UX: 0.72, Pricing: 0.52, Features: 0.91 }, keyPoints: ["Reporting workflow feels thoughtful and clear.", "Wants a faster way to compare customer cohorts."] },
  { id: "CD-1041", name: "Priya Sharma", initials: "PS", company: "Mitti Studio", tier: "Public", date: "Oct 21, 2026", sentiment: 0.64, transcript: "मुझे डैशबोर्ड समझने में आसान लगा, लेकिन शुरुआत में कुछ मार्गदर्शन मददगार होगा।", language: "hi", topics: { UX: 0.79, Pricing: 0.24, Features: 0.49 }, keyPoints: ["डैशबोर्ड समझने में आसान लगा।", "शुरुआत में मार्गदर्शन और उदाहरण मददगार होंगे।"] },
  { id: "CD-1040", name: "Kabir Rao", initials: "KR", company: "Monsoon Works", tier: "Expert", date: "Oct 20, 2026", sentiment: 0.77, transcript: "Clear value for our team. The setup is simple and the insights feel actionable.", language: "en", topics: { UX: 0.82, Pricing: 0.68, Features: 0.78 }, keyPoints: ["Sees clear value for the team.", "Setup is simple; insights feel actionable."] },
  { id: "CD-1039", name: "Ananya Iyer", initials: "AI", company: "Goodkind Health", tier: "Public", date: "Oct 18, 2026", sentiment: 0.41, transcript: "The idea is promising, though I am not sure how the pricing scales for a small team.", language: "en", topics: { UX: 0.56, Pricing: -0.31, Features: 0.48 }, keyPoints: ["Finds the product idea promising.", "Unclear how pricing scales for small teams."] },
  { id: "CD-1038", name: "Rohan Verma", initials: "RV", company: "Independent", tier: "Newbie", date: "Oct 17, 2026", sentiment: 0.28, transcript: "पहली बार इस्तेमाल किया। कुछ बटन और उदाहरणों के साथ समझना आसान होगा।", language: "hi", topics: { UX: 0.12, Pricing: 0.3, Features: 0.38 }, keyPoints: ["पहली बार उपयोग करने पर कुछ बटन समझ नहीं आए।", "उदाहरणों से शुरुआत आसान हो सकती है।"] },
];

const copy = {
  en: { workspace: "WORKSPACE", discover: "Discover", customers: "Customers", reports: "Reports", settings: "Settings", team: "STUDIO TEAM", newProject: "New project", search: "Search interviews, people...", goodMorning: "Thursday, October 22, 2026", title: "Good morning, Maya", intro: "A little closer to understanding what your customers really need.", project: "CURRENT PROJECT", projectName: "Customer discovery", updated: "Updated 2 hours ago", upload: "＋ Upload interview", total: "Total interviews", experts: "Domain experts", languages: "Languages captured", avg: "Avg. sentiment", vsLast: "vs. last month", interviews: "Recent interviews", seeAll: "See all interviews →", sample: "SAMPLE DATA", sampleText: "These example interviews are here to help you explore the workspace.", all: "All tiers", filter: "Filter", person: "CUSTOMER", tier: "TIER", date: "DATE", score: "SENTIMENT", action: "", view: "View", positive: "Positive", mixed: "Mixed", transcript: "Interview note", close: "Close", newBadge: "NEW", greeting: "Your customer voice, in one place.", tierExpert: "Expert", tierPublic: "Public", tierNewbie: "Newbie", hCaptured: "English & Hindi", status: "All systems ready", tasks: "Next up", taskTitle: "Bring your first conversation in", taskBody: "Upload an interview to start building your customer picture.", taskAction: "Add an interview", trend: "Interview activity", thisMonth: "This month", onTrack: "On a good rhythm", helpful: "Customer voice", helpfulText: "The clearest signal comes from listening closely.", of: "of", selectedView: "INSIGHT VIEW", allCustomers: "All customers", selectedCustomers: "selected customers", simple: "Simple average", weighted: "Expertise-weighted", delta: "Expert delta", consensus: "General consensus", alignment: "Expert alignment", rejection: "Expert rejection", expertSignal: "Expert sentiment differs from the overall average.", consensusDetail: "Customer sentiment is broadly consistent across tiers.", alignmentDetail: "Experts are more positive than the group overall.", rejectionDetail: "Experts are less positive than the group overall.", topicHeading: "Topic sentiment", topicSub: "Sentiment in transcript passages matched to each topic", customerPoints: "Customer-specific points", pointsSub: "Feedback highlights in this current view", checked: "selected", clearSelection: "Clear selection", noSelection: "Select one or more interviews to compare specific customer feedback.", sentimentRange: "Sentiment scale: −1 negative · 0 neutral · +1 positive", showDetails: "View individual feedback", quotedBy: "From interview", totalSample: "Showing all sample interviews", uploadTitle: "Add an interview", uploadHint: "Choose an audio recording to transcribe and analyze on this device.", chooseFile: "Choose audio file", noFile: "No file selected", fullName: "Customer name", companyLabel: "Company or organization", customerTier: "Customer tier", audioLanguage: "Spoken language", autoDetect: "Auto-detect English or Hindi", english: "English", hindi: "Hindi", transcribe: "Transcribe and analyze", processing: "Transcribing and analyzing in your browser…", transcriptionModel: "Preparing speech model", sentimentModel: "Scoring feedback", localPrivacy: "Your recording is processed in this browser and the audio is not uploaded. The transcript is saved in the local SQLite database and mirrored to CSV.", firstModelDownload: "The free multilingual speech model is served by this website and cached in your browser for later sessions.", uploadSuccess: "Interview added to your customer insights.", uploadError: "We couldn’t process this file. Try a WAV or MP3 recording.", fileLimit: "Audio must be smaller than 100 MB.", analyzing: "Analyzing transcript…", tryAgain: "Choose another file", cancel: "Cancel", uploadDone: "Done", mixedLanguage: "English + Hindi", fileName: "Audio file", processingModel: "Downloading model", savedLocally: "Saved in this browser" },
  hi: { workspace: "कार्यस्थान", discover: "खोजें", customers: "ग्राहक", reports: "रिपोर्ट", settings: "सेटिंग्स", team: "स्टूडियो टीम", newProject: "नया प्रोजेक्ट", search: "इंटरव्यू, लोगों को खोजें...", goodMorning: "गुरुवार, 22 अक्टूबर 2026", title: "सुप्रभात, माया", intro: "यह समझने की एक और कोशिश कि आपके ग्राहक वास्तव में क्या चाहते हैं।", project: "वर्तमान प्रोजेक्ट", projectName: "ग्राहक खोज", updated: "2 घंटे पहले अपडेट", upload: "＋ इंटरव्यू अपलोड करें", total: "कुल इंटरव्यू", experts: "क्षेत्र विशेषज्ञ", languages: "रिकॉर्ड की भाषाएँ", avg: "औसत भावना", vsLast: "पिछले महीने से", interviews: "हाल के इंटरव्यू", seeAll: "सभी इंटरव्यू देखें →", sample: "नमूना डेटा", sampleText: "वर्कस्पेस देखने के लिए ये उदाहरण इंटरव्यू जोड़े गए हैं।", all: "सभी स्तर", filter: "फ़िल्टर", person: "ग्राहक", tier: "स्तर", date: "तारीख", score: "भावना", action: "", view: "देखें", positive: "सकारात्मक", mixed: "मिश्रित", transcript: "इंटरव्यू नोट", close: "बंद करें", newBadge: "नया", greeting: "ग्राहकों की आवाज़, एक ही जगह।", tierExpert: "विशेषज्ञ", tierPublic: "सामान्य", tierNewbie: "नए उपयोगकर्ता", hCaptured: "अंग्रेज़ी और हिंदी", status: "सभी सिस्टम तैयार", tasks: "आगे का कदम", taskTitle: "पहली बातचीत जोड़ें", taskBody: "अपने ग्राहकों को समझना शुरू करने के लिए एक इंटरव्यू अपलोड करें।", taskAction: "इंटरव्यू जोड़ें", trend: "इंटरव्यू गतिविधि", thisMonth: "इस महीने", onTrack: "अच्छी रफ़्तार", helpful: "ग्राहकों की आवाज़", helpfulText: "सबसे साफ़ संकेत ध्यान से सुनने पर मिलते हैं।", of: "में से", selectedView: "अंतर्दृष्टि दृश्य", allCustomers: "सभी ग्राहक", selectedCustomers: "चयनित ग्राहक", simple: "साधारण औसत", weighted: "अनुभव-भारित", delta: "विशेषज्ञ अंतर", consensus: "सामान्य सहमति", alignment: "विशेषज्ञ सहमति", rejection: "विशेषज्ञ असहमति", expertSignal: "विशेषज्ञों की भावना कुल औसत से अलग है।", consensusDetail: "ग्राहक स्तरों में भावना लगभग समान है।", alignmentDetail: "विशेषज्ञ समूह की तुलना में अधिक सकारात्मक हैं।", rejectionDetail: "विशेषज्ञ समूह की तुलना में कम सकारात्मक हैं।", topicHeading: "विषय के अनुसार भावना", topicSub: "विषय से जुड़े ट्रांसक्रिप्ट अंशों की भावना", customerPoints: "ग्राहक-विशिष्ट बातें", pointsSub: "इस दृश्य में प्रतिक्रिया के मुख्य बिंदु", checked: "चयनित", clearSelection: "चयन हटाएँ", noSelection: "विशिष्ट ग्राहक प्रतिक्रिया की तुलना के लिए एक या अधिक इंटरव्यू चुनें।", sentimentRange: "भावना पैमाना: −1 नकारात्मक · 0 तटस्थ · +1 सकारात्मक", showDetails: "ग्राहक प्रतिक्रिया देखें", quotedBy: "इंटरव्यू से", totalSample: "सभी नमूना इंटरव्यू दिखाए जा रहे हैं", uploadTitle: "इंटरव्यू जोड़ें", uploadHint: "इस डिवाइस पर ट्रांसक्राइब और विश्लेषण करने के लिए ऑडियो चुनें।", chooseFile: "ऑडियो फ़ाइल चुनें", noFile: "कोई फ़ाइल नहीं चुनी", fullName: "ग्राहक का नाम", companyLabel: "कंपनी या संस्था", customerTier: "ग्राहक स्तर", audioLanguage: "बोली गई भाषा", autoDetect: "अंग्रेज़ी या हिंदी पहचानें", english: "अंग्रेज़ी", hindi: "हिंदी", transcribe: "ट्रांसक्राइब और विश्लेषण करें", processing: "ब्राउज़र में ट्रांसक्रिप्शन और विश्लेषण…", transcriptionModel: "स्पीच मॉडल तैयार हो रहा है", sentimentModel: "प्रतिक्रिया का विश्लेषण", localPrivacy: "रिकॉर्डिंग इसी ब्राउज़र में प्रोसेस होती है और ऑडियो अपलोड नहीं होता। ट्रांसक्रिप्ट स्थानीय SQLite डेटाबेस और CSV में सेव होता है।", firstModelDownload: "मुफ़्त बहुभाषी स्पीच मॉडल इसी वेबसाइट से मिलेगा और बाद के लिए ब्राउज़र में कैश रहेगा।", uploadSuccess: "इंटरव्यू ग्राहक अंतर्दृष्टि में जोड़ दिया गया।", uploadError: "फ़ाइल प्रोसेस नहीं हुई। WAV या MP3 आज़माएँ।", fileLimit: "ऑडियो फ़ाइल 100 MB से छोटी होनी चाहिए।", analyzing: "ट्रांसक्रिप्ट का विश्लेषण हो रहा है…", tryAgain: "दूसरी फ़ाइल चुनें", cancel: "रद्द करें", uploadDone: "हो गया", mixedLanguage: "अंग्रेज़ी + हिंदी", fileName: "ऑडियो फ़ाइल", processingModel: "मॉडल डाउनलोड हो रहा है", savedLocally: "इस ब्राउज़र में सेव" },
};

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    home: <><path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9M9 20v-6h6v6"/></>, users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>, chart: <><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-5 5"/></>, gear: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.8 1.1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.8-1.1l-1.7.6-1.4-2.4 1.4-1.1a8 8 0 0 1 0-2.1l-1.4-1.1 1.4-2.4 1.7.6a8 8 0 0 1 1.8-1.1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.8 1.1l1.7-.6 1.4 2.4-1.4 1.1a8 8 0 0 1-.1 2Z" transform="translate(-2 -2)"/></>, search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>, chevron: <path d="m9 18 6-6-6-6"/>, down: <path d="m7 10 5 5 5-5"/>, arrow: <><path d="M7 17 17 7M7 7h10v10"/></>, mic: <><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></>, more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>, spark: <><path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z"/><path d="m19 14 1.1 2.9L23 18l-2.9 1.1L19 22l-1.1-2.9L15 18l2.9-1.1L19 14Z"/></>, globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></>
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function initialsColor(name: string) { return name.charCodeAt(0) % 4; }
function tierWeight(tier: Tier) { return tier === "Expert" ? 1 : tier === "Public" ? 0.8 : 0.5; }
function mean(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function weightedMean(items: Customer[], getValue: (customer: Customer) => number) {
  const totalWeight = items.reduce((sum, customer) => sum + tierWeight(customer.tier), 0);
  return totalWeight ? items.reduce((sum, customer) => sum + tierWeight(customer.tier) * getValue(customer), 0) / totalWeight : 0;
}
function sentimentLabel(score: number) { return score > 0.15 ? "Positive" : score < -0.15 ? "Negative" : "Neutral"; }

export default function Home() {
  const [language, setLanguage] = useState<UiLanguage>("en");
  const [selectedNav, setSelectedNav] = useState("discover");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [reportGenerated, setReportGenerated] = useState(false);
  const [filter, setFilter] = useState<"All" | Tier>("All");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [active, setActive] = useState<Customer | null>(null);
  const [uploadedRecords, setUploadedRecords] = useState<Customer[]>([]);
  const [recordsError, setRecordsError] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [targetRecordId, setTargetRecordId] = useState<string | null>(null);
  const [noteMode, setNoteMode] = useState<"audio" | "images" | "text">("text");
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [textNotes, setTextNotes] = useState("");
  const [noteProgress, setNoteProgress] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioBytes, setAudioBytes] = useState<ArrayBuffer | null>(null);
  const [readingAudio, setReadingAudio] = useState(false);
  const [audioPreview, setAudioPreview] = useState("");
  const [audioLanguage, setAudioLanguage] = useState<AudioLanguageChoice>("auto");
  const [uploadDraft, setUploadDraft] = useState<UploadDraft>({ name: "", company: "", tier: "Public" });
  const [audioStatus, setAudioStatus] = useState<"idle" | "processing" | "complete" | "error">("idle");
  const [audioError, setAudioError] = useState("");
  const [modelProgress, setModelProgress] = useState<{ file: string; progress: number; stage: string } | null>(null);
  const [editDraft, setEditDraft] = useState<Customer | null>(null);
  const [editError, setEditError] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [slowModelLoad, setSlowModelLoad] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const ocrWorkerRef = useRef<Awaited<ReturnType<typeof createWorker>> | null>(null);
  const ocrCancelledRef = useRef(false);
  const pendingUploadRef = useRef<{ id: string; draft: UploadDraft; audioName: string; persisted: boolean; lastRecord?: Customer } | null>(null);
  const cancelTranscriptionRef = useRef<() => void>(() => {});
  const t = copy[language];
  useEffect(() => {
    const savedTheme = window.localStorage.getItem("fieldnotes-theme");
    if (savedTheme === "dark" || savedTheme === "light") setTheme(savedTheme);
  }, []);
  useEffect(() => { window.localStorage.setItem("fieldnotes-theme", theme); }, [theme]);
  const allCustomers = useMemo(() => [...uploadedRecords, ...customers], [uploadedRecords]);
  const visible = useMemo(() => allCustomers.filter((customer) => (filter === "All" || customer.tier === filter) && `${customer.name} ${customer.company}`.toLowerCase().includes(query.toLowerCase())), [allCustomers, filter, query]);
  const insightCustomers = useMemo(() => selectedIds.length ? allCustomers.filter((customer) => selectedIds.includes(customer.id)) : allCustomers.filter((customer) => filter === "All" || customer.tier === filter), [allCustomers, filter, selectedIds]);
  const simpleSentiment = mean(insightCustomers.map((customer) => customer.sentiment));
  const weightedSentiment = weightedMean(insightCustomers, (customer) => customer.sentiment);
  const delta = weightedSentiment - simpleSentiment;
  const verdict = delta > 0.15 ? "alignment" : delta < -0.15 ? "rejection" : "consensus";
  const expertCount = allCustomers.filter((customer) => customer.tier === "Expert").length;
  const languageCount = { en: allCustomers.filter((customer) => customer.language === "en").length, hi: allCustomers.filter((customer) => customer.language === "hi").length, mixed: allCustomers.filter((customer) => customer.language === "mixed").length };
  const topicScores = (["UX", "Pricing", "Features"] as const).map((topic) => ({ name: topic, simple: mean(insightCustomers.map((customer) => customer.topics[topic])), weighted: weightedMean(insightCustomers, (customer) => customer.topics[topic]) }));
  const customerPoints = [...insightCustomers].sort((a, b) => a.sentiment - b.sentiment);
  const toggleCustomer = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((selected) => selected !== id) : [...current, id]);
  const allVisibleSelected = visible.length > 0 && visible.every((customer) => selectedIds.includes(customer.id));
  const toggleVisible = () => setSelectedIds((current) => allVisibleSelected ? current.filter((id) => !visible.some((customer) => customer.id === id)) : [...new Set([...current, ...visible.map((customer) => customer.id)])]);

  useEffect(() => {
    fetch("/api/interviews").then(async (response) => {
      if (!response.ok) throw new Error("Saved interviews could not be loaded from the database.");
      setUploadedRecords(await response.json() as Customer[]);
    }).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : "";
      setRecordsError(/failed to fetch|network/i.test(detail) ? "The website server could not be reached. Keep the local server running, then refresh." : detail || "Saved interviews could not be loaded.");
    });
  }, []);

  useEffect(() => {
    if (!audioFile) { setAudioPreview(""); return; }
    const url = URL.createObjectURL(audioFile);
    setAudioPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [audioFile]);

  useEffect(() => {
    const previews = imageFiles.map((file) => URL.createObjectURL(file));
    setImagePreviews(previews);
    return () => previews.forEach((url) => URL.revokeObjectURL(url));
  }, [imageFiles]);

  useEffect(() => {
    const attachWorker = () => {
      const worker = new Worker(new URL("./transcription.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.addEventListener("message", async (event: MessageEvent<Record<string, unknown>>) => {
      const message = event.data;
      if (message.type === "progress") {
        setModelProgress({ file: String(message.file ?? ""), progress: Number(message.progress ?? 0), stage: String(message.stage ?? "transcription-model") });
      } else if (message.type === "transcription-started") {
        setSlowModelLoad(false);
        setModelProgress({ file: "Starting first audio section…", progress: 0, stage: "transcription" });
      } else if (message.type === "transcription-progress") {
        setModelProgress({ file: `${message.processedSeconds ?? 0}s / ${message.totalSeconds ?? 0}s`, progress: Number(message.progress ?? 0), stage: "transcription" });
      } else if (message.type === "analysis-progress") {
        setModelProgress({ file: "", progress: Number(message.progress ?? 0), stage: "analysis" });
      } else if (message.type === "error") {
        setAudioStatus("error");
        setAudioError(String(message.message ?? t.uploadError));
        setModelProgress(null);
      } else if (message.type === "partial-complete" || message.type === "complete") {
        const pending = pendingUploadRef.current;
        if (!pending) return;
        const { draft } = pending;
        const transcript = String(message.transcript ?? "");
        const isFinal = message.type === "complete";
        let sentiment = Number(message.sentiment ?? 0);
        let topics = message.topics as Customer["topics"];
        let keyPoints = Array.isArray(message.keyPoints) && message.keyPoints.length ? message.keyPoints.map(String) : [transcript];
        let analysisEngine: Customer["analysisEngine"] = "lexical-fallback";
        if (isFinal && transcript.trim()) {
          setModelProgress({ file: "Preparing the multilingual sentiment model…", progress: 0, stage: "analysis" });
          try {
            const analysis = await analyzeNotesWithModel(transcript, (file) => setModelProgress({ file, progress: 100, stage: "analysis" }));
            sentiment = analysis.sentiment;
            topics = analysis.topics;
            keyPoints = analysis.keyPoints;
            analysisEngine = "multilingual-transformer";
          } catch (error) {
            console.warn("Transformer sentiment model unavailable; keeping transcript fallback analysis.", error);
          }
        }
        const newRecord: Customer = {
          id: pending.id,
          name: draft.name.trim() || pending.audioName.replace(/\.[^.]+$/, "") || "New customer",
          initials: (draft.name.trim() || pending.audioName || "NC").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(),
          company: draft.company.trim() || "Independent",
          tier: draft.tier,
          date: new Intl.DateTimeFormat(language === "hi" ? "hi-IN" : "en-US", { month: "short", day: "2-digit", year: "numeric" }).format(new Date()),
          sentiment,
          transcript,
          language: message.language === "hi" || message.language === "mixed" ? message.language : "en",
          topics,
          keyPoints,
          audioName: pending.audioName,
          sourceType: "audio",
          analysisEngine,
          transcriptionStatus: isFinal ? "complete" : "processing",
        };
        setModelProgress({ file: "", progress: 100, stage: "saving" });
        const saveUrl = pending.persisted ? `/api/interviews/${encodeURIComponent(newRecord.id)}` : "/api/interviews";
        void fetch(saveUrl, { method: pending.persisted ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newRecord) })
          .then(async (response) => {
            const saved = await response.json();
            if (!response.ok) throw new Error(saved.error || "Could not save this interview.");
            pending.persisted = true;
            pending.lastRecord = saved as Customer;
            setUploadedRecords((current) => current.some((record) => record.id === newRecord.id)
              ? current.map((record) => record.id === newRecord.id ? saved as Customer : record)
              : [saved as Customer, ...current]);
            setSelectedIds([newRecord.id]);
            if (isFinal) { setAudioStatus("complete"); setModelProgress(null); }
            else setModelProgress({ file: "First-pass result saved; finishing the full transcript…", progress: Number(message.progress ?? 0), stage: "transcription" });
          })
          .catch((error: unknown) => {
            setAudioStatus("error");
            const detail = error instanceof Error ? error.message : "";
            setAudioError(/failed to fetch|network/i.test(detail) ? "Could not reach the website database. Keep the local server running, then retry; your transcript has not been saved yet." : detail || "Could not save this interview.");
            setModelProgress(null);
          });
      }
      });
      worker.addEventListener("error", (event) => {
        setAudioStatus("error");
        setAudioError(event.message || copy.en.uploadError);
      });
      return worker;
    };
    attachWorker();
    cancelTranscriptionRef.current = () => {
      ocrCancelledRef.current = true;
      const pending = pendingUploadRef.current;
      if (pending?.persisted && pending.lastRecord) {
        const interrupted = { ...pending.lastRecord, transcriptionStatus: "interrupted" as const };
        void fetch(`/api/interviews/${encodeURIComponent(interrupted.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(interrupted) })
          .then((response) => response.ok && setUploadedRecords((records) => records.map((record) => record.id === interrupted.id ? interrupted : record)))
          .catch(() => {});
      }
      workerRef.current?.terminate();
      void ocrWorkerRef.current?.terminate();
      ocrWorkerRef.current = null;
      attachWorker();
      pendingUploadRef.current = null;
      setAudioStatus("idle");
      setAudioError("");
      setModelProgress(null);
    };
    return () => { workerRef.current?.terminate(); workerRef.current = null; void ocrWorkerRef.current?.terminate(); ocrWorkerRef.current = null; cancelTranscriptionRef.current = () => {}; };
  }, []);

  useEffect(() => {
    setSlowModelLoad(false);
    if (audioStatus !== "processing" || modelProgress?.stage !== "transcription-model" || modelProgress.progress > 0) return;
    const timer = window.setTimeout(() => setSlowModelLoad(true), 15000);
    return () => window.clearTimeout(timer);
  }, [audioStatus, modelProgress]);

  const selectAudioFile = (file?: File) => {
    if (!file) return;
    setAudioError("");
    setAudioBytes(null);
    if (file.size > 100 * 1024 * 1024) { setAudioFile(null); setAudioStatus("error"); setAudioError(t.fileLimit); return; }
    setAudioFile(file);
    setAudioStatus("idle");
    setModelProgress(null);
    setReadingAudio(true);
    const reader = new FileReader();
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        setAudioStatus("error"); setAudioError("The selected audio could not be read. Please choose the file again.");
      } else setAudioBytes(reader.result.slice(0));
      setReadingAudio(false);
    };
    reader.onerror = () => {
      setAudioStatus("error");
      setAudioError(reader.error?.message || "The selected audio could not be read. Please choose the file again.");
      setReadingAudio(false);
    };
    reader.onabort = () => { setAudioStatus("error"); setAudioError("Reading the selected audio was interrupted. Please choose it again."); setReadingAudio(false); };
    reader.readAsArrayBuffer(file);
  };

  const processAudio = async () => {
    if (!audioFile || !audioBytes || !workerRef.current) return;
    setAudioStatus("processing");
    setAudioError("");
    setModelProgress(null);
    const existing = targetRecordId ? uploadedRecords.find((record) => record.id === targetRecordId) : undefined;
    pendingUploadRef.current = { id: targetRecordId || `CD-${Date.now()}`, draft: existing ? { name: existing.name, company: existing.company, tier: existing.tier } : uploadDraft, audioName: audioFile.name, persisted: Boolean(existing), lastRecord: existing };
    try {
      const audioContext = new AudioContext();
      const decoded = await audioContext.decodeAudioData(audioBytes.slice(0));
      const targetRate = 16000;
      const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * targetRate), targetRate);
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start();
      const resampled = await offline.startRendering();
      await audioContext.close();
      const audio = resampled.getChannelData(0).slice();
      workerRef.current.postMessage({ type: "transcribe", audio, language: audioLanguage }, [audio.buffer]);
    } catch (error) {
      setAudioStatus("error");
      setAudioError(error instanceof Error ? `Audio decoding failed: ${error.message}. Try WAV or MP3.` : t.uploadError);
    }
  };

  const addImages = (files: FileList | File[]) => {
    const picked = Array.from(files);
    if (picked.some((file) => !file.type.startsWith("image/"))) { setAudioError("Choose image files only."); return; }
    if (picked.some((file) => file.size > 12 * 1024 * 1024)) { setAudioError("Each image must be smaller than 12 MB."); return; }
    setImageFiles((current) => {
      const combined = [...current, ...picked].slice(0, 8);
      if (current.length + picked.length > 8) setAudioError("You can add up to 8 images per interview.");
      else setAudioError("");
      return combined;
    });
  };

  const saveNotes = async (transcript: string, sourceType: "images" | "text", imageNames: string[] = []) => {
    const cleaned = transcript.trim();
    if (!cleaned) throw new Error("There is no readable text to analyze yet.");
    setNoteProgress("Preparing the multilingual report analysis…");
    let analysis: Awaited<ReturnType<typeof analyzeNotesWithModel>> | (ReturnType<typeof analyzeNotes> & { analysisEngine: "lexical-fallback" });
    try {
      analysis = await analyzeNotesWithModel(cleaned, setNoteProgress);
    } catch (error) {
      console.warn("Transformer sentiment model unavailable; using local fallback analysis.", error);
      analysis = { ...analyzeNotes(cleaned), analysisEngine: "lexical-fallback" as const };
      setNoteProgress("Transformer unavailable; saved with the local fallback analyzer.");
    }
    const existing = targetRecordId ? uploadedRecords.find((record) => record.id === targetRecordId) : undefined;
    const id = existing?.id ?? `CD-${Date.now()}`;
    const fallbackName = sourceType === "images" ? imageNames[0]?.replace(/\.[^.]+$/, "") : "Interview notes";
    const displayName = uploadDraft.name.trim() || fallbackName || "Interview notes";
    const record: Customer = {
      id, name: displayName, initials: displayName.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase(),
      company: uploadDraft.company.trim() || "Independent", tier: uploadDraft.tier,
      date: new Intl.DateTimeFormat(language === "hi" ? "hi-IN" : "en-US", { month: "short", day: "2-digit", year: "numeric" }).format(new Date()),
      sentiment: analysis.sentiment, transcript: cleaned, language: analysis.language as Language, topics: analysis.topics,
      keyPoints: analysis.keyPoints, analysisEngine: analysis.analysisEngine, sourceType, imageNames, audioName: sourceType === "images" ? imageNames.join(", ") : undefined, transcriptionStatus: "complete",
    };
    const response = await fetch(existing ? `/api/interviews/${encodeURIComponent(id)}` : "/api/interviews", {
      method: existing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(record),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not save the interview notes.");
    const saved = body as Customer;
    setUploadedRecords((current) => current.some((item) => item.id === saved.id)
      ? current.map((item) => item.id === saved.id ? saved : item)
      : [saved, ...current]);
    setSelectedIds([saved.id]);
    setAudioStatus("complete");
    setNoteProgress("");
  };

  const processNotes = async () => {
    if (noteMode === "audio") { await processAudio(); return; }
    ocrCancelledRef.current = false;
    setAudioStatus("processing"); setAudioError("");
    try {
      if (noteMode === "text") {
        await saveNotes(textNotes, "text");
        return;
      }
      if (!imageFiles.length) throw new Error("Add at least one image of the customer notes.");
      const extracted: string[] = [];
      const ocrWorker = await createWorker("eng+hin", OEM.LSTM_ONLY, {
        workerPath: "/ocr/worker.min.js", corePath: "/ocr/tesseract-core-simd-lstm.wasm.js", langPath: "/ocr/lang/", gzip: true,
        cachePath: "fieldnotes-ocr", cacheMethod: "write", workerBlobURL: false,
        logger: (message) => setNoteProgress(`${noteMode === "images" ? "Reading image text" : "Processing notes"} · ${message.status} ${Math.round(message.progress * 100)}%`),
      });
      ocrWorkerRef.current = ocrWorker;
      for (let index = 0; index < imageFiles.length; index++) {
        setNoteProgress(`Reading image ${index + 1} of ${imageFiles.length}…`);
        const result = await ocrWorker.recognize(imageFiles[index]);
        if (ocrCancelledRef.current) return;
        if (result.data.text.trim()) extracted.push(result.data.text.trim());
      }
      await ocrWorker.terminate(); ocrWorkerRef.current = null;
      if (!extracted.length) throw new Error("No readable text was found. Try a sharper, brighter image or type the notes instead.");
      await saveNotes(extracted.join("\n\n"), "images", imageFiles.map((file) => file.name));
    } catch (error) {
      await ocrWorkerRef.current?.terminate().catch(() => {}); ocrWorkerRef.current = null;
      if (ocrCancelledRef.current) { setAudioStatus("idle"); return; }
      setAudioStatus("error"); setNoteProgress("");
      setAudioError(error instanceof Error ? error.message : "Could not read these notes.");
    }
  };

  const saveEdit = async () => {
    if (!editDraft) return;
    setSavingEdit(true); setEditError("");
    try {
      const response = await fetch(`/api/interviews/${encodeURIComponent(editDraft.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editDraft) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save the changes.");
      const saved = body as Customer;
      setUploadedRecords((records) => records.map((record) => record.id === saved.id ? saved : record));
      setActive(saved); setEditDraft(null);
    } catch (error) { setEditError(error instanceof Error ? error.message : "Could not save the changes."); }
    finally { setSavingEdit(false); }
  };

  const downloadReport = () => {
    const rows = insightCustomers.map((customer) => `- ${customer.name} (${customer.company}; ${customer.tier}; ${customer.language === "hi" ? "Hindi" : customer.language === "mixed" ? "English + Hindi" : "English"}; sentiment ${customer.sentiment.toFixed(2)}; analyzer ${customer.analysisEngine === "multilingual-transformer" ? "multilingual transformer" : "fallback"})\n  ${customer.keyPoints.map((point) => `• ${point}`).join("\n  ")}`).join("\n");
    const topics = topicScores.map((topic) => `- ${topic.name}: ${topic.weighted.toFixed(2)} weighted sentiment`).join("\n");
    const positive = insightCustomers.filter((customer) => customer.sentiment > 0.15).map((customer) => `- ${customer.name}: ${customer.keyPoints.join("; ")}`).join("\n");
    const concerns = insightCustomers.filter((customer) => customer.sentiment < -0.15).map((customer) => `- ${customer.name}: ${customer.keyPoints.join("; ")}`).join("\n");
    const followUps = insightCustomers.filter((customer) => customer.sentiment <= 0.15).map((customer) => `- ${customer.name}: ${customer.keyPoints.join("; ")}`).join("\n");
    const overallSignal = simpleSentiment > 0.15 ? "mostly positive" : simpleSentiment < -0.15 ? "mostly negative" : "mixed or neutral";
    const report = `Customer discovery report\nGenerated ${new Date().toLocaleString()}\n\nExecutive summary\nAcross ${insightCustomers.length} selected interviews, the overall signal is ${overallSignal} (mean sentiment ${simpleSentiment.toFixed(2)}). This is an evidence-led summary of the customer statements below; follow-up items are kept attached to the customer who raised them.\n\nSentiment overview\nPositive: ${insightCustomers.filter((customer) => customer.sentiment > 0.15).length}\nNeutral or mixed: ${insightCustomers.filter((customer) => customer.sentiment >= -0.15 && customer.sentiment <= 0.15).length}\nNegative: ${insightCustomers.filter((customer) => customer.sentiment < -0.15).length}\nSimple average: ${simpleSentiment.toFixed(2)}\nExpertise-weighted average: ${weightedSentiment.toFixed(2)}\n\nTopic signals\n${topics || "No topic results available."}\n\nWhat customers value\n${positive || "No clearly positive interview in this selection."}\n\nIssues and friction\n${concerns || "No clearly negative interview in this selection."}\n\nRecommended follow-ups\n${followUps || "No low or mixed sentiment interviews in this selection."}\n\nCustomer-specific findings\n${rows || "No interviews in this selection."}\n\nMethod\nNew text and image notes use Horizon-Labs multilingual-sentiment-small (English and Hindi supported) for sentence-level polarity. Statements and key points are extracted from the submitted transcript/OCR; no new customer claims are generated. Older records or records where the model could not load use the local fallback analyzer.\n\nAccuracy note: sentiment is an estimate, and audio results also depend on transcription quality. Review the transcript against the original recording before making decisions.`;
    const url = URL.createObjectURL(new Blob([report], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `customer-discovery-report-${new Date().toISOString().slice(0, 10)}.md`; link.click(); URL.revokeObjectURL(url);
  };

  return <main className="app-shell" lang={language} data-theme={theme} data-view={selectedNav}>
    <aside className="sidebar">
      <a className="brand" href="#home" aria-label="Fieldnotes home"><span className="brand-mark">f<span>.</span></span><span className="brand-name">fieldnotes<span className="brand-dot">.</span></span></a>
      <div className="workspace-label">{t.workspace}</div>
      <nav className="nav-list" aria-label="Main navigation">
        {[{ id: "discover", icon: "home", label: t.discover }, { id: "customers", icon: "users", label: t.customers }, { id: "reports", icon: "chart", label: t.reports }].map((item) => <button key={item.id} className={`nav-item ${selectedNav === item.id ? "active" : ""}`} onClick={() => setSelectedNav(item.id)}><Icon name={item.icon}/><span>{item.label}</span>{item.id === "customers" && <span className="nav-count">{allCustomers.length}</span>}</button>)}
      </nav>
      <div className="sidebar-bottom"><div className="workspace-label team-label">{t.team}</div><button className="project-switch" onClick={() => setSelectedNav("discover")}><span className="project-icon">S</span><span className="project-label">Studio workspace</span><Icon name="down" size={15}/></button><button className={`nav-item ${selectedNav === "settings" ? "active" : ""}`} onClick={() => setSelectedNav("settings")}><Icon name="gear"/><span>{t.settings}</span></button><div className="profile"><div className="avatar avatar-maya">MC</div><div className="profile-copy"><strong>Maya Chen</strong><span>maya@studio.co</span></div><button className="icon-button profile-more" aria-label="Open profile settings" onClick={() => setSelectedNav("settings")}><Icon name="more"/></button></div></div>
    </aside>
    <section className="main-column" id="home">
      <header className="topbar"><div className="breadcrumb"><span>Studio workspace</span><Icon name="chevron" size={14}/><strong>{selectedNav === "discover" ? t.discover : selectedNav === "customers" ? t.customers : selectedNav === "reports" ? t.reports : t.settings}</strong></div><div className="top-actions"><label className="search-box"><Icon name="search" size={17}/><input aria-label={t.search} placeholder={t.search} value={query} onChange={(event) => setQuery(event.target.value)}/><kbd>⌘ K</kbd></label><button className="language-toggle" onClick={() => setLanguage(language === "en" ? "hi" : "en")} aria-label="Switch language"><Icon name="globe" size={16}/><span>{language === "en" ? "EN" : "हि"}</span><Icon name="down" size={13}/></button><button className="top-avatar" aria-label="Open profile settings" onClick={() => setSelectedNav("settings")}>MC</button></div></header>
      <div className="content">
        <div className="welcome-row"><div><p className="eyebrow date-label">{t.goodMorning}</p><h1>{selectedNav === "reports" ? t.reports : selectedNav === "customers" ? t.customers : selectedNav === "settings" ? t.settings : t.title}<span className="title-spark">✳</span></h1><p className="intro">{selectedNav === "reports" ? "A live summary of the interviews and customer-specific feedback in your current selection." : t.intro}</p></div><div className="welcome-actions"><button className="theme-toggle button-secondary" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}>{theme === "light" ? "◐ Dark mode" : "☼ Light mode"}</button><button className="button-primary" onClick={() => { setTargetRecordId(null); setNoteMode("text"); setShowUpload(true); setAudioStatus("idle"); setAudioError(""); }}><Icon name="spark" size={17}/>Add customer notes</button></div></div>
        {selectedNav === "reports" && <section className="report-view"><div className="report-toolbar"><div><span className="eyebrow">LIVE REPORT · {selectedIds.length ? "SELECTED INTERVIEWS" : "CURRENT FILTER"}</span><h2>Customer feedback summary</h2><p>{insightCustomers.length} interviews · updates with the current customer selection and tier filter.</p></div><div className="report-actions"><button className="button-secondary" onClick={() => setReportGenerated(true)}>Generate detailed report</button><button className="button-primary" onClick={downloadReport}>Export report</button></div></div>{reportGenerated && <><p className="report-ready" role="status">Detailed report generated from the latest saved interviews.</p><div className="generated-analysis"><article><strong>Sentiment breakdown</strong><p>{insightCustomers.filter((customer) => customer.sentiment > 0.15).length} positive · {insightCustomers.filter((customer) => customer.sentiment >= -0.15 && customer.sentiment <= 0.15).length} neutral · {insightCustomers.filter((customer) => customer.sentiment < -0.15).length} negative interviews.</p></article><article><strong>Strongest topic signal</strong><p>{[...topicScores].sort((a, b) => b.weighted - a.weighted)[0]?.name ?? "No topic data"} currently has the highest tier-weighted sentiment in this selection.</p></article><article><strong>Follow-up candidates</strong><p>{insightCustomers.filter((customer) => customer.sentiment < 0.2).map((customer) => customer.name).join(", ") || "No low-sentiment interviews in this selection."}</p></article></div></>}<div className="report-metrics"><article><span>Overall sentiment</span><strong>{simpleSentiment >= 0 ? "+" : ""}{simpleSentiment.toFixed(2)}</strong></article><article><span>Expert weighted</span><strong>{weightedSentiment >= 0 ? "+" : ""}{weightedSentiment.toFixed(2)}</strong></article><article><span>Customers covered</span><strong>{insightCustomers.length}</strong></article><article><span>Needs attention</span><strong>{insightCustomers.filter((customer) => customer.sentiment < 0).length}</strong></article></div><h3>Customer-specific findings</h3><div className="report-findings">{customerPoints.map((customer) => <article key={customer.id}><header><strong>{customer.name}</strong><span>{customer.tier} · {customer.sentiment >= 0 ? "+" : ""}{customer.sentiment.toFixed(2)}</span></header>{customer.keyPoints.map((point, index) => <p key={`${customer.id}-${index}`}>• {point}</p>)}<button className="row-action" onClick={() => setActive(customer)}>Open transcript <Icon name="chevron" size={14}/></button></article>)}{!customerPoints.length && <p className="no-points">No interviews match the current selection.</p>}</div><p className="report-note">Automated transcription and sentiment are estimates. Review the original audio and transcript before making decisions.</p></section>}
        {selectedNav === "settings" && <section className="settings-view"><h2>Workspace preferences</h2><p>Choose how this dashboard appears. Your theme preference is saved in this browser.</p><div className="settings-row"><div><strong>Appearance</strong><span>{theme === "light" ? "Light mode" : "Dark mode"}</span></div><button className="button-secondary" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>Switch to {theme === "light" ? "dark" : "light"} mode</button></div><div className="settings-row"><div><strong>Interface language</strong><span>{language === "en" ? "English" : "हिन्दी"}</span></div><button className="button-secondary" onClick={() => setLanguage(language === "en" ? "hi" : "en")}>Switch language</button></div><div className="settings-row"><div><strong>Transcription and storage</strong><span>Free in-browser speech recognition · local SQLite and CSV mirror</span></div><a className="button-secondary" href="/api/interviews/csv">Download interview CSV</a></div></section>}
        <div className="project-strip"><div className="project-tile-icon"><Icon name="spark" size={19}/></div><div className="project-meta"><span className="eyebrow">{t.project}</span><strong>{t.projectName}</strong></div><span className="project-updated">{t.updated}</span><div className="project-members"><span className="mini-member member-a">M</span><span className="mini-member member-b">A</span><span className="mini-member member-c">R</span><span className="member-count">+2</span></div><button className="icon-button" aria-label="Open project reports" onClick={() => setSelectedNav("reports")}><Icon name="more"/></button></div>
        <section className="metric-grid" aria-label="Project overview">
          <article className="metric-card"><div className="metric-top"><span>{t.total}</span><span className="metric-icon icon-peach"><Icon name="mic" size={17}/></span></div><div className="metric-number">{allCustomers.length}</div><div className="metric-foot"><span className="trend-up"><Icon name="arrow" size={13}/> 3</span><span>{t.vsLast}</span></div><div className="sparkline spark-green"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></div></article>
          <article className="metric-card"><div className="metric-top"><span>{t.experts}</span><span className="metric-icon icon-lilac"><Icon name="spark" size={17}/></span></div><div className="metric-number">{expertCount}</div><div className="metric-foot"><span className="muted-chip">{Math.round(expertCount / allCustomers.length * 100)}%</span><span>{t.of} {language === "en" ? "all interviews" : "सभी इंटरव्यू"}</span></div><div className="metric-bars"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></div></article>
          <article className="metric-card"><div className="metric-top"><span>{t.languages}</span><span className="metric-icon icon-blue"><Icon name="globe" size={17}/></span></div><div className="language-pills"><span>EN <b>{languageCount.en}</b></span><span>हि <b>{languageCount.hi}</b></span></div><div className="metric-foot"><span className="muted-chip">2</span><span>{language === "en" ? "languages" : "भाषाएँ"}</span></div><div className="language-line"><i/><i/></div></article>
          <article className="metric-card sentiment-card"><div className="metric-top"><span>{t.avg}</span><span className="metric-icon icon-yellow"><Icon name="spark" size={17}/></span></div><div className="metric-number">{weightedSentiment >= 0 ? "+" : ""}{weightedSentiment.toFixed(2)}</div><div className="metric-foot"><span className="sentiment-label">{language === "en" ? sentimentLabel(weightedSentiment) : (weightedSentiment > 0.15 ? "सकारात्मक" : weightedSentiment < -0.15 ? "नकारात्मक" : "तटस्थ")}</span><span>{selectedIds.length ? `${selectedIds.length} ${t.checked}` : filter === "All" ? t.allCustomers : filter}</span></div><div className="sentiment-track"><i style={{ width: `${Math.max(4, Math.min(100, (weightedSentiment + 1) * 50))}%` }}/></div></article>
        </section>
        <section className="insights-panel" aria-label={t.selectedView}>
          <div className="insights-heading"><div><span className="eyebrow">{t.selectedView}</span><h2>{selectedIds.length ? `${selectedIds.length} ${t.selectedCustomers}` : filter === "All" ? t.allCustomers : `${filter} ${t.allCustomers.toLowerCase()}`}</h2><p>{t.sentimentRange}</p></div>{selectedIds.length > 0 && <button className="clear-selection" onClick={() => setSelectedIds([])}>{t.clearSelection}</button>}</div>
          <div className="insights-body">
            <div className="sentiment-analysis"><div className="sentiment-comparison"><article className="analysis-stat"><span>{t.simple}</span><strong>{simpleSentiment >= 0 ? "+" : ""}{simpleSentiment.toFixed(2)}</strong><div className="stat-track"><i style={{ width: `${Math.max(4, Math.min(100, (simpleSentiment + 1) * 50))}%` }}/></div></article><article className="analysis-stat weighted-stat"><span>{t.weighted}</span><strong>{weightedSentiment >= 0 ? "+" : ""}{weightedSentiment.toFixed(2)}</strong><div className="stat-track"><i style={{ width: `${Math.max(4, Math.min(100, (weightedSentiment + 1) * 50))}%` }}/></div></article><article className="analysis-stat delta-stat"><span>{t.delta}</span><strong className={delta >= 0 ? "positive-delta" : "negative-delta"}>{delta >= 0 ? "+" : ""}{delta.toFixed(2)}</strong><small>{t[verdict]}</small></article></div><div className={`verdict-note verdict-${verdict}`}><span className="verdict-icon">{verdict === "alignment" ? "↗" : verdict === "rejection" ? "↘" : "↔"}</span><div><strong>{t[verdict]}</strong><p>{t[`${verdict}Detail`]}</p></div></div></div>
            <div className="topic-analysis"><div className="topic-heading"><strong>{t.topicHeading}</strong><span>{t.topicSub}</span></div><div className="topic-legend"><span><i className="legend-simple"/>{t.simple}</span><span><i className="legend-weighted"/>{t.weighted}</span></div>{topicScores.map((topic) => <div className="topic-row" key={topic.name}><span className="topic-name">{topic.name}</span><div className="topic-bars"><div className="topic-bar-track"><i className="topic-simple-bar" style={{ width: `${Math.max(3, (topic.simple + 1) * 50)}%` }}/></div><div className="topic-bar-track"><i className="topic-weighted-bar" style={{ width: `${Math.max(3, (topic.weighted + 1) * 50)}%` }}/></div></div><span className="topic-score">{topic.weighted >= 0 ? "+" : ""}{topic.weighted.toFixed(2)}</span></div>)}</div>
          </div>
          <div className="customer-points"><div className="points-heading"><div><strong>{t.customerPoints}</strong><span>{t.pointsSub}</span></div><span className="points-count">{customerPoints.length}</span></div>{customerPoints.length ? <div className="points-list">{customerPoints.map((customer) => <button className="customer-point" key={customer.id} onClick={() => setActive(customer)}><span className={`avatar avatar-${initialsColor(customer.name)}`}>{customer.initials}</span><span className="point-copy"><strong>{customer.name}<small> · {customer.tier}</small></strong><span lang={customer.language}>{customer.keyPoints[0]}</span></span><span className={`point-sentiment ${customer.sentiment >= 0.6 ? "point-high" : customer.sentiment < 0.4 ? "point-low" : "point-mid"}`}>{customer.sentiment >= 0 ? "+" : ""}{customer.sentiment.toFixed(2)}</span><Icon name="chevron" size={15}/></button>)}</div> : <p className="no-points">{t.noSelection}</p>}</div>
        </section>
        <section className="content-grid">
          <div className="interviews-card"><div className="card-heading"><div><div className="heading-title"><h2>{t.interviews}</h2><span className="count-badge">{visible.length}</span></div><p>{t.sampleText}</p>{recordsError && <p className="upload-error" role="alert">{recordsError}</p>}</div><div className="toolbar-right"><a className="text-link" href="/api/interviews/csv">Download CSV</a><button className="text-link" onClick={() => setSelectedNav("customers")}>{t.seeAll}</button></div></div><div className="table-toolbar"><span className="sample-label"><span className="sample-dot"/>{uploadedRecords.length ? `${uploadedRecords.length} saved · ${t.sample}` : t.sample}</span><div className="toolbar-right">{selectedIds.length > 0 && <span className="selected-count">{selectedIds.length} {t.checked}</span>}<div className="filter-wrap"><span>{t.filter}</span><select aria-label={t.filter} value={filter} onChange={(event) => setFilter(event.target.value as "All" | Tier)}><option value="All">{t.all}</option><option value="Expert">{t.tierExpert}</option><option value="Public">{t.tierPublic}</option><option value="Newbie">{t.tierNewbie}</option></select><Icon name="down" size={13}/></div></div></div>
          <div className="table-scroll"><table><thead><tr><th className="select-column"><input className="row-checkbox" type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} aria-label="Select all visible interviews"/></th><th>{t.person}</th><th>{t.tier}</th><th>{t.date}</th><th>{t.score}</th><th>{t.action}</th></tr></thead><tbody>{visible.map((customer) => <tr key={customer.id} className={selectedIds.includes(customer.id) ? "selected-row" : ""}><td className="select-column"><input className="row-checkbox" type="checkbox" checked={selectedIds.includes(customer.id)} onChange={() => toggleCustomer(customer.id)} aria-label={`Select ${customer.name}`}/></td><td><button className="person-cell" onClick={() => setActive(customer)}><span className={`avatar avatar-${initialsColor(customer.name)}`}>{customer.initials}</span><span className="person-info"><strong>{customer.name}</strong><small>{customer.company}</small></span></button></td><td><span className={`tier-pill tier-${customer.tier.toLowerCase()}`}><i/>{customer.tier === "Expert" ? t.tierExpert : customer.tier === "Public" ? t.tierPublic : t.tierNewbie}</span></td><td className="date-cell">{customer.date}{customer.transcriptionStatus && customer.transcriptionStatus !== "complete" && <small className="transcription-state">{customer.transcriptionStatus === "processing" ? (language === "en" ? "Updating…" : "अपडेट हो रहा है…") : (language === "en" ? "Interrupted" : "रुका हुआ")}</small>}</td><td><span className={`score ${customer.sentiment >= 0.6 ? "score-positive" : "score-mixed"}`}><i/>{customer.sentiment.toFixed(2)}</span></td><td><button className="row-action" onClick={() => setActive(customer)}>{t.view}<Icon name="chevron" size={14}/></button></td></tr>)}</tbody></table>{visible.length === 0 && <div className="empty-results">No interviews match this search.</div>}</div><div className="table-footer"><span>{language === "en" ? <>Showing <strong>{visible.length}</strong> of <strong>{allCustomers.length}</strong> interviews</> : <><strong>{visible.length}</strong> में से <strong>{allCustomers.length}</strong> इंटरव्यू</>}</span><span>{language === "en" ? "All matching interviews shown" : "सभी परिणाम दिखाए गए"}</span></div></div>
          <aside className="right-rail"><article className="next-card" id="upload-placeholder"><div className="next-icon"><Icon name="mic" size={19}/></div><div className="eyebrow">{t.tasks}</div><h3>{t.taskTitle}</h3><p>{t.taskBody}</p><button className="button-secondary" onClick={() => { setTargetRecordId(null); setNoteMode("text"); setShowUpload(true); setAudioStatus("idle"); setAudioError(""); }}>Write customer notes<Icon name="arrow" size={15}/></button><div className="next-decoration decoration-one"/><div className="next-decoration decoration-two"/></article><article className="activity-card"><div className="activity-heading"><div><span className="eyebrow">{t.trend}</span><h3>{t.thisMonth}</h3></div><button className="icon-button" aria-label="Open activity report" onClick={() => setSelectedNav("reports")}><Icon name="more"/></button></div><div className="activity-chart"><div className="chart-y"><span>6</span><span>4</span><span>2</span><span>0</span></div><div className="chart-plot"><div className="chart-grid-lines"><i/><i/><i/><i/></div><svg viewBox="0 0 230 92" preserveAspectRatio="none" role="img" aria-label="Interview activity trend"><defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#78a486" stopOpacity=".22"/><stop offset="1" stopColor="#78a486" stopOpacity="0"/></linearGradient></defs><path d="M0 78 C14 73 17 65 31 68 S51 53 64 59 S81 39 97 49 S114 46 130 42 S149 47 163 32 S182 36 196 20 S215 25 230 8 V92 H0 Z" fill="url(#chartFill)"/><path d="M0 78 C14 73 17 65 31 68 S51 53 64 59 S81 39 97 49 S114 46 130 42 S149 47 163 32 S182 36 196 20 S215 25 230 8" fill="none" stroke="#58836a" strokeWidth="2.4" strokeLinecap="round"/></svg><div className="chart-x"><span>Oct 1</span><span>Oct 8</span><span>Oct 15</span><span>Oct 22</span></div></div></div><div className="activity-caption"><span className="activity-legend"/><span>{t.interviews}</span><span className="activity-status"><i/>{t.onTrack}</span></div></article><article className="quote-card"><div className="quote-mark">“</div><div><span className="eyebrow">{t.helpful}</span><p>{t.helpfulText}</p></div><span className="quote-spark">✳</span></article></aside>
        </section>
        <footer className="page-footer"><span>© 2026 Fieldnotes</span><span className="footer-center"><i/> {t.status}</span><span>{t.greeting}</span></footer>
      </div>
    </section>
        {showUpload && <div className="modal-backdrop" role="presentation" onClick={() => { if (audioStatus === "processing") cancelTranscriptionRef.current(); setShowUpload(false); }}>
          <section className="upload-modal notes-modal" data-complete={audioStatus === "complete"} role="dialog" aria-modal="true" aria-labelledby="upload-title" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close icon-button" onClick={() => { if (audioStatus === "processing") cancelTranscriptionRef.current(); setShowUpload(false); }} aria-label={t.close}>×</button>
            <div className="upload-modal-icon"><Icon name="mic" size={20}/></div><span className="eyebrow">CUSTOMER NOTES</span>
            <h2 id="upload-title">{targetRecordId ? "Replace interview notes" : "Add customer notes"}</h2>
            <p className="upload-intro">Choose how you want to share feedback. We’ll analyze it and add the result to the customer report.</p>{audioStatus === "complete" && <div className="upload-complete"><span className="complete-check">✓</span><strong>Notes analyzed and saved.</strong><p>Added to this customer report and saved in SQLite and CSV.</p></div>}
            <div className="note-mode-picker" role="tablist" aria-label="Choose note input type">
              <button type="button" role="tab" aria-selected={noteMode === "audio"} className={noteMode === "audio" ? "selected" : ""} onClick={() => setNoteMode("audio")}>🎙 Audio<small>Record or upload</small></button>
              <button type="button" role="tab" aria-selected={noteMode === "images"} className={noteMode === "images" ? "selected" : ""} onClick={() => setNoteMode("images")}>▧ Images<small>Up to 8 photos</small></button>
              <button type="button" role="tab" aria-selected={noteMode === "text"} className={noteMode === "text" ? "selected" : ""} onClick={() => setNoteMode("text")}>✎ Write notes<small>Type or paste</small></button>
            </div>
            {noteMode === "audio" && <>
              <label className="audio-dropzone" htmlFor="audio-input" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); selectAudioFile(event.dataTransfer.files[0]); }}><span className="dropzone-icon"><Icon name="arrow" size={17}/></span><strong>{audioFile ? audioFile.name : t.chooseFile}</strong><span>{audioFile ? `${(audioFile.size / (1024 * 1024)).toFixed(1)} MB` : "MP3, WAV, M4A, WEBM · max 100 MB"}</span><input id="audio-input" type="file" accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg" onChange={(event) => selectAudioFile(event.target.files?.[0])} disabled={audioStatus === "processing"}/></label>
              {readingAudio && <p role="status">Reading audio file into memory…</p>}{audioFile && audioPreview && <audio className="audio-preview" controls src={audioPreview}/>}
              <div className="notes-audio-hint">Audio is transcribed in this browser. Hindi and English are supported; review the transcript for accuracy.</div>
            </>}
            {noteMode === "images" && <>
              <label className="audio-dropzone image-dropzone" htmlFor="image-input" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addImages(event.dataTransfer.files); }}><span className="dropzone-icon">▧</span><strong>Choose or take note photos</strong><span>JPG, PNG, WEBP · up to 8 images · 12 MB each</span><input id="image-input" type="file" accept="image/*" capture="environment" multiple onChange={(event) => { if (event.target.files) addImages(event.target.files); event.target.value = ""; }} disabled={audioStatus === "processing"}/></label>
              {imageFiles.length > 0 && <div className="image-preview-grid">{imageFiles.map((file, index) => <div className="image-preview-item" key={`${file.name}-${index}`}><img src={imagePreviews[index]} alt={`Note image ${index + 1}`}/><span title={file.name}>{file.name}</span><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setImageFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}>×</button></div>)}</div>}
              <div className="notes-audio-hint">Free English and Hindi OCR runs on this device. The images stay here; extracted text and file names are saved with the interview.</div>
            </>}
            {noteMode === "text" && <label className="written-notes-label"><span>Customer conversation notes (English)</span><textarea rows={8} maxLength={20000} value={textNotes} onChange={(event) => setTextNotes(event.target.value)} placeholder="Type or paste what the customer said in English. Include what they liked, disliked, asked for, and why…" disabled={audioStatus === "processing"}/><small>{textNotes.length.toLocaleString()} / 20,000 characters · English-first multilingual transformer · first use downloads the free model (~268 MB), then it is cached</small></label>}
            <div className="upload-form-grid"><label><span>{t.fullName}</span><input value={uploadDraft.name} onChange={(event) => setUploadDraft((draft) => ({ ...draft, name: event.target.value }))} placeholder="e.g. Aditi Gupta" disabled={audioStatus === "processing"}/></label><label><span>{t.companyLabel}</span><input value={uploadDraft.company} onChange={(event) => setUploadDraft((draft) => ({ ...draft, company: event.target.value }))} placeholder="e.g. Acme Studio" disabled={audioStatus === "processing"}/></label><label><span>{t.customerTier}</span><select value={uploadDraft.tier} onChange={(event) => setUploadDraft((draft) => ({ ...draft, tier: event.target.value as Tier }))} disabled={audioStatus === "processing"}><option value="Newbie">{t.tierNewbie}</option><option value="Public">{t.tierPublic}</option><option value="Expert">{t.tierExpert}</option></select></label>{noteMode === "audio" && <label><span>{t.audioLanguage}</span><select value={audioLanguage} onChange={(event) => setAudioLanguage(event.target.value as AudioLanguageChoice)} disabled={audioStatus === "processing"}><option value="auto">{t.autoDetect}</option><option value="english">{t.english}</option><option value="hindi">{t.hindi}</option></select></label>}</div>
            {audioStatus === "processing" && <div className="processing-panel" role="status"><span className="spinner"/><span>{noteMode === "audio" ? (modelProgress?.stage === "transcription" ? `Transcribing audio: ${modelProgress.file} (${Math.round(modelProgress.progress)}%)` : modelProgress?.stage === "saving" ? "Saving interview to database and CSV…" : modelProgress?.stage === "analysis" ? modelProgress.file : t.processing) : noteProgress || (noteMode === "images" ? "Preparing local OCR…" : "Analyzing notes…")}</span>{noteMode === "audio" && modelProgress?.stage === "transcription" && <progress max="100" value={modelProgress.progress}/>}</div>}
            {slowModelLoad && noteMode === "audio" && audioStatus === "processing" && <p className="upload-error" role="status">The speech model is taking longer than expected. Keep this tab open, or cancel and retry.</p>}
            {audioStatus === "error" && <p className="upload-error" role="alert">{audioError || t.uploadError}</p>}
            {audioStatus === "complete" ? <div className="upload-actions"><button className="button-primary" onClick={() => { setShowUpload(false); setAudioFile(null); setAudioBytes(null); setImageFiles([]); setTextNotes(""); setNoteMode("audio"); setAudioStatus("idle"); setTargetRecordId(null); setUploadDraft({ name: "", company: "", tier: "Public" }); }}>Done</button></div> : <div className="upload-actions"><button className="button-secondary" onClick={() => { if (audioStatus === "processing") cancelTranscriptionRef.current(); else setShowUpload(false); }}>{audioStatus === "processing" ? "Cancel processing" : t.cancel}</button><button className="button-primary" onClick={processNotes} disabled={audioStatus === "processing" || (noteMode === "audio" ? !audioFile || !audioBytes || readingAudio : noteMode === "images" ? !imageFiles.length : !textNotes.trim())}><Icon name="spark" size={15}/>{audioStatus === "processing" ? "Working…" : noteMode === "audio" ? t.transcribe : "Analyze and save notes"}</button></div>}
          </section>
        </div>}    {active && <div className="modal-backdrop" role="presentation" onClick={() => { setActive(null); setEditDraft(null); }}><section className="detail-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={(event) => event.stopPropagation()}><button className="modal-close icon-button" onClick={() => { setActive(null); setEditDraft(null); }} aria-label={t.close}>×</button><div className="modal-person"><span className={`avatar avatar-${initialsColor(active.name)}`}>{active.initials}</span><div><span className="eyebrow">{active.id} · {active.language === "hi" ? "हिंदी" : active.language === "mixed" ? t.mixedLanguage : "English"}</span><h2 id="modal-title">{active.name}</h2><p>{active.company}</p></div></div>{editDraft ? <div className="edit-interview-form"><label>Name<input value={editDraft.name} onChange={(event) => setEditDraft({ ...editDraft, name: event.target.value, initials: event.target.value.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase() })}/></label><label>Company<input value={editDraft.company} onChange={(event) => setEditDraft({ ...editDraft, company: event.target.value })}/></label><label>Tier<select value={editDraft.tier} onChange={(event) => setEditDraft({ ...editDraft, tier: event.target.value as Tier })}><option>Newbie</option><option>Public</option><option>Expert</option></select></label><label>Spoken language<select value={editDraft.language} onChange={(event) => setEditDraft({ ...editDraft, language: event.target.value as Language })}><option value="en">English</option><option value="hi">Hindi</option><option value="mixed">English + Hindi</option></select></label><label>Sentiment score (−1 to +1)<input type="number" min="-1" max="1" step="0.01" value={editDraft.sentiment} onChange={(event) => setEditDraft({ ...editDraft, sentiment: Number(event.target.value) })}/></label><label>Topic scores (−1 to +1)<div className="edit-topic-grid">{(["UX", "Pricing", "Features"] as const).map((topic) => <label key={topic}>{topic}<input type="number" min="-1" max="1" step="0.01" value={editDraft.topics[topic]} onChange={(event) => setEditDraft({ ...editDraft, topics: { ...editDraft.topics, [topic]: Number(event.target.value) } })}/></label>)}</div></label><label>Customer-specific points (one per line)<textarea rows={4} value={editDraft.keyPoints.join("\n")} onChange={(event) => setEditDraft({ ...editDraft, keyPoints: event.target.value.split("\n").filter(Boolean) })}/></label><label>Transcript<textarea rows={8} value={editDraft.transcript} onChange={(event) => setEditDraft({ ...editDraft, transcript: event.target.value })}/></label>{editError && <p className="upload-error" role="alert">{editError}</p>}<div className="upload-actions"><button className="button-secondary" onClick={() => { setEditDraft(null); setEditError(""); }}>Cancel</button><button className="button-primary" onClick={saveEdit} disabled={savingEdit || !editDraft.name.trim() || !editDraft.transcript.trim()}>{savingEdit ? "Saving…" : "Save changes"}</button></div></div> : <><div className="modal-metrics"><div><span>{t.tier}</span><strong>{active.tier === "Expert" ? t.tierExpert : active.tier === "Public" ? t.tierPublic : t.tierNewbie}</strong></div><div><span>{t.score}</span><strong>{active.sentiment >= 0 ? "+" : ""}{active.sentiment.toFixed(2)}</strong></div><div><span>{t.date}</span><strong>{active.date}</strong></div></div><div className="customer-detail-points"><span className="eyebrow">{t.customerPoints}</span>{active.keyPoints.map((point, index) => <p key={`${index}-${point}`} lang={active.language === "hi" ? "hi" : "en"}><i/>{point}</p>)}</div><div className="transcript-box"><span className="eyebrow">{active.sourceType === "images" ? "Image notes" : active.sourceType === "text" ? "Written notes" : t.transcript}{active.audioName ? ` · ${active.audioName}` : ""}</span><p lang={active.language === "hi" ? "hi" : "en"}>{active.transcript}</p></div><div className="upload-actions">{uploadedRecords.some((record) => record.id === active.id) && <><button className="button-secondary modal-done" onClick={() => { setTargetRecordId(active.id); setNoteMode("audio"); setUploadDraft({ name: active.name, company: active.company, tier: active.tier }); setAudioLanguage(active.language === "hi" ? "hindi" : active.language === "en" ? "english" : "auto"); setAudioFile(null); setAudioBytes(null); setAudioStatus("idle"); setActive(null); setShowUpload(true); }}>Re-transcribe from audio</button><button className="button-secondary modal-done" onClick={() => { setEditDraft({ ...active, topics: { ...active.topics }, keyPoints: [...active.keyPoints] }); setEditError(""); }}>Edit saved interview</button></>}<button className="button-secondary modal-done" onClick={() => setActive(null)}>{t.close}</button></div></>}</section></div>}
  </main>;
}
