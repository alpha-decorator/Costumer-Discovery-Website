import { env, pipeline } from "@huggingface/transformers";

env.allowLocalModels = true;
env.allowRemoteModels = false;
env.useBrowserCache = true;
env.localModelPath = "/models/";

type LanguageChoice = "auto" | "english" | "hindi";
type WorkerRequest = { type: "transcribe"; audio: Float32Array; language: LanguageChoice };

let transcriber: any;
let transcriberModel = "";

function detectLanguage(text: string, requested: LanguageChoice): "en" | "hi" | "mixed" {
  if (requested === "english") return "en";
  if (requested === "hindi") return "hi";
  const hindi = (text.match(/[\u0900-\u097f]/g) ?? []).length;
  const latin = (text.match(/[a-z]/gi) ?? []).length;
  return hindi > 0 && latin > 0 ? "mixed" : hindi > 0 ? "hi" : "en";
}

const sentimentLexicon: Array<[string, number]> = [
  ["excellent", 0.95], ["amazing", 0.9], ["love", 0.85], ["great", 0.8], ["helpful", 0.7], ["easy", 0.65], ["clear", 0.55], ["useful", 0.65], ["good", 0.5], ["promising", 0.45], ["thoughtful", 0.55], ["actionable", 0.6],
  ["poor", -0.75], ["terrible", -0.95], ["hate", -0.9], ["confusing", -0.65], ["difficult", -0.6], ["hard", -0.45], ["slow", -0.5], ["expensive", -0.65], ["costly", -0.6], ["unclear", -0.5], ["frustrating", -0.8], ["problem", -0.4], ["issue", -0.35], ["bug", -0.6], ["missing", -0.4], ["limited", -0.35], ["not sure", -0.3], ["would love", 0.5],
  ["बहुत अच्छा", 0.85], ["बेहतरीन", 0.9], ["पसंद", 0.7], ["आसान", 0.65], ["मददगार", 0.7], ["स्पष्ट", 0.55], ["अच्छा", 0.55], ["उपयोगी", 0.65], ["शानदार", 0.9], ["उम्मीद", 0.35],
  ["खराब", -0.75], ["मुश्किल", -0.6], ["कठिन", -0.6], ["भ्रमित", -0.65], ["महंगा", -0.65], ["महँगा", -0.65], ["समस्या", -0.5], ["निराश", -0.8], ["धीमा", -0.45], ["परेशान", -0.7], ["समझ नहीं", -0.55], ["स्पष्ट नहीं", -0.5],
];

const negations = /\b(not|no|never|hardly|isn't|aren't|wasn't|weren't|don't|doesn't|didn't|cannot|can't|won't|wouldn't)\b|नहीं|मत|बिना/i;

function quickSentiment(text: string) {
  const sentences = text.toLowerCase().split(/(?<=[.!?।])\s+/).filter(Boolean);
  const sentenceScores = sentences.map((sentence) => {
    const matches = sentimentLexicon.flatMap(([term, value]) => {
      if (!sentence.includes(term)) return [];
      if (/^[a-z]/i.test(term) && !new RegExp(`\\b${term.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i").test(sentence)) return [];
      const negated = negations.test(sentence.slice(Math.max(0, sentence.indexOf(term) - 32), sentence.indexOf(term)));
      return [negated ? -value * 0.75 : value];
    });
    return matches.length ? matches.reduce((sum, value) => sum + value, 0) / Math.sqrt(matches.length) : 0;
  });
  return sentenceScores.length ? Math.max(-1, Math.min(1, sentenceScores.reduce((sum, score) => sum + score, 0) / sentenceScores.length)) : 0;
}

const topicWords = {
  UX: ["easy", "confusing", "button", "dashboard", "onboard", "setup", "navigation", "डैशबोर्ड", "आसान", "समझ", "बटन", "उपयोग", "शुरुआत"],
  Pricing: ["price", "pricing", "cost", "expensive", "cheap", "plan", "subscription", "मूल्य", "कीमत", "महंगा", "सस्ता", "पैसा", "खर्च"],
  Features: ["feature", "report", "cohort", "export", "insight", "compare", "workflow", "रिपोर्ट", "सुविधा", "तुलना", "विशेषता", "जानकारी"],
};

function scoreTopics(chunks: Array<{ text: string; sentiment: number }>, overall: number) {
  return Object.fromEntries(Object.entries(topicWords).map(([topic, words]) => {
    const related = chunks.filter(({ text }) => words.some((word) => text.toLowerCase().includes(word)));
    return [topic, related.length ? related.reduce((sum, chunk) => sum + chunk.sentiment, 0) / related.length : overall];
  })) as { UX: number; Pricing: number; Features: number };
}

function extractPoints(text: string) {
  const sentences = text.split(/(?<=[.!?।])\s+/).map((part) => part.trim()).filter((part) => part.length > 22);
  const deduplicated = sentences.filter((sentence, index) => {
    const normalized = sentence.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    return normalized.length > 12 && sentences.findIndex((candidate) => candidate.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() === normalized) === index;
  });
  const relevance = /want|wish|need|should|could|would|because|but|however|problem|issue|price|cost|feature|easy|difficult|slow|नहीं|चाहिए|समस्या|कीमत|महंगा|आसान|मुश्किल|क्योंकि|लेकिन|सुधार|ज़रूरत/i;
  return [...deduplicated].sort((a, b) => Number(relevance.test(b)) - Number(relevance.test(a))).slice(0, 4);
}

function analyzeTranscript(transcript: string) {
  const textChunks = splitForSentiment(transcript);
  const scoredChunks = textChunks.map((text) => ({ text, sentiment: quickSentiment(text) }));
  const totalChars = scoredChunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
  const sentiment = totalChars ? scoredChunks.reduce((sum, chunk) => sum + chunk.sentiment * chunk.text.length, 0) / totalChars : 0;
  return { sentiment, topics: scoreTopics(scoredChunks, sentiment), keyPoints: extractPoints(transcript) };
}

function removeRepeatedWords(previous: string, next: string) {
  const previousWords = previous.trim().split(/\s+/);
  const nextWords = next.trim().split(/\s+/);
  const limit = Math.min(12, previousWords.length, nextWords.length);
  let overlap = 0;
  for (let count = limit; count > 0; count--) {
    const a = previousWords.slice(-count).join(" ").toLocaleLowerCase();
    const b = nextWords.slice(0, count).join(" ").toLocaleLowerCase();
    if (a === b) { overlap = count; break; }
  }
  return nextWords.slice(overlap).join(" ");
}

function cleanDecoderLoops(text: string) {
  const sentences = text.split(/(?<=[.!?।])\s+/).filter(Boolean);
  const seen = new Set<string>();
  const unique = sentences.filter((sentence) => {
    const normalized = sentence.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
  const words = unique.join(" ").split(/\s+/);
  const output: string[] = [];
  for (let index = 0; index < words.length;) {
    let loopLength = 0;
    for (let size = Math.min(12, Math.floor((words.length - index) / 3)); size >= 2; size--) {
      const phrase = words.slice(index, index + size).join(" ").toLocaleLowerCase();
      if (words.slice(index + size, index + size * 2).join(" ").toLocaleLowerCase() === phrase && words.slice(index + size * 2, index + size * 3).join(" ").toLocaleLowerCase() === phrase) {
        loopLength = size;
        break;
      }
    }
    if (loopLength) {
      output.push(...words.slice(index, index + loopLength));
      index += loopLength * 3;
    } else output.push(words[index++]);
  }
  return output.join(" ").trim();
}

function splitForSentiment(text: string, maxLength = 420) {
  const sentences = text.split(/(?<=[.!?।])\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    for (let offset = 0; offset < sentence.length; offset += maxLength) {
      const part = sentence.slice(offset, offset + maxLength);
      if (current && current.length + part.length > maxLength) { chunks.push(current); current = ""; }
      current += `${current ? " " : ""}${part}`;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [text.slice(0, maxLength)];
}

self.addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type !== "transcribe") return;
  try {
    const { audio, language } = event.data;
    const requestedModel = "Xenova/whisper-tiny";
    if (!transcriber || transcriberModel !== requestedModel) {
      transcriber = undefined;
      transcriberModel = "";
      let lastError: unknown;
      let networkError = false;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          transcriber = await pipeline("automatic-speech-recognition", requestedModel, {
            dtype: "q8",
            progress_callback: (progress: { status?: string; file?: string; progress?: number }) => {
              self.postMessage({ type: "progress", stage: "transcription-model", attempt, ...progress });
            },
          });
          transcriberModel = requestedModel;
          break;
        } catch (error) {
          lastError = error;
          networkError = /failed to fetch|networkerror|network error|fetch failed|load failed|err_internet|timed out/i.test(error instanceof Error ? error.message : String(error));
          if (attempt === 1) await new Promise((resolve) => setTimeout(resolve, 700));
        }
      }
      if (!transcriber) throw lastError;
    }
    self.postMessage({ type: "transcription-started" });
    const clipSamples = 30 * 16000;
    const overlapSamples = 1 * 16000;
    const transcripts: string[] = [];
    let start = 0;
    while (start < audio.length) {
      const end = Math.min(audio.length, start + clipSamples);
      const clipStart = Math.max(0, start - (start ? overlapSamples : 0));
      const recognized = await transcriber(audio.subarray(clipStart, end), {
        language: language === "auto" ? undefined : language,
        task: "transcribe",
        // A tiny Whisper model can loop when the recording contains pauses or
        // background noise. Keep decoding deterministic and suppress repeated
        // token sequences without forcing a language when auto-detect is used.
        no_repeat_ngram_size: 3,
        repetition_penalty: 1.12,
      }) as { text: string };
      const cleanText = recognized.text.trim();
      if (cleanText) {
        const withoutOverlap = transcripts.length ? removeRepeatedWords(transcripts.join(" "), cleanText) : cleanText;
        // Drop obvious decoder loops (same sentence repeated in one section).
        const sentences = withoutOverlap.split(/(?<=[.!?।])\s+/).filter(Boolean);
        const uniqueSentences: string[] = [];
        for (const sentence of sentences) {
          const normalized = sentence.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
          if (!normalized || uniqueSentences.some((previous) => previous.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() === normalized)) continue;
          uniqueSentences.push(sentence);
        }
        transcripts.push(uniqueSentences.join(" "));
      }
      const transcriptSoFar = cleanDecoderLoops(transcripts.join(" ").trim());
      const progress = Math.min(100, Math.round(end / audio.length * 100));
      self.postMessage({ type: "transcription-progress", progress, processedSeconds: Math.round(end / 16000), totalSeconds: Math.round(audio.length / 16000) });
      if (end < audio.length && start === 0 && transcriptSoFar) {
        self.postMessage({ type: "partial-complete", transcript: transcriptSoFar, language: detectLanguage(transcriptSoFar, language), ...analyzeTranscript(transcriptSoFar), progress });
      }
      if (end >= audio.length) break;
      start = end;
    }
    const transcript = cleanDecoderLoops(transcripts.join(" ").trim());
    if (!transcript) throw new Error("No speech could be recognized in this recording.");
    const analysis = analyzeTranscript(transcript);
    self.postMessage({
      type: "complete",
      transcript,
      ...analysis,
      language: detectLanguage(transcript, language),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const networkFailure = /failed to fetch|networkerror|network error|fetch failed|load failed|err_internet|timed out/i.test(detail);
    self.postMessage({ type: "error", message: networkFailure
      ? "Could not load the speech model files served by this website. Refresh the page and retry; if it continues, the model files may not be available from the local server."
      : detail || "Audio processing failed." });
  }
});
