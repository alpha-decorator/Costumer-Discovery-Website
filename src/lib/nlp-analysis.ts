import { analyzeNotes } from "@/lib/notes-analysis";

type SentimentResult = { label: string; score: number };
type Classifier = (text: string, options?: { top_k?: number }) => Promise<SentimentResult[]>;

let classifierPromise: Promise<Classifier> | undefined;
const MODEL_ID = "Horizon-Labs/multilingual-sentiment-small";

function getClassifier(onProgress?: (message: string) => void) {
  if (!classifierPromise) {
    onProgress?.("Loading the free multilingual sentiment model (first use downloads about 268 MB)…");
    classifierPromise = import("@huggingface/transformers").then(async ({ env, pipeline }) => {
      env.allowRemoteModels = true;
      env.allowLocalModels = false;
      env.useBrowserCache = true;
      const loadPipeline = pipeline as unknown as (task: string, model: string, options: Record<string, unknown>) => Promise<Classifier>;
      return await loadPipeline("text-classification", MODEL_ID, {
        dtype: "q8",
        progress_callback: (event: { status?: string; file?: string; progress?: number }) => {
          if (event.status === "progress") {
            const file = event.file?.split("/").pop() || "model file";
            onProgress?.(`Downloading ${file} · ${Math.round(event.progress ?? 0)}%`);
          }
        },
      }) as Classifier;
    }).catch((error) => {
      classifierPromise = undefined;
      throw error;
    });
  }
  return classifierPromise;
}

function asPolarity(results: SentimentResult[]) {
  const result = results[0];
  if (!result) return 0;
  const label = result.label.toLowerCase();
  if (label.includes("positive") || label.includes("pos")) return result.score;
  if (label.includes("negative") || label.includes("neg")) return -result.score;
  // Support five-star multilingual checkpoints if the model's label map changes.
  const stars = Number(label.match(/[1-5]/)?.[0]);
  if (Number.isFinite(stars) && stars > 0) return (stars - 3) / 2;
  return 0;
}

/** Run multilingual transformer sentiment on sentence-sized chunks. Notes stay in the browser. */
export async function analyzeNotesWithModel(
  text: string,
  onProgress?: (message: string) => void,
) {
  const baseline = analyzeNotes(text);
  const sentences = text.split(/(?<=[.!?।\n])\s*/).map((sentence) => sentence.trim()).filter(Boolean);
  const classifier = await getClassifier(onProgress);
  const predictions: Array<{ sentence: string; score: number }> = [];
  const batchSize = 12;

  for (let start = 0; start < sentences.length; start += batchSize) {
    const batch = sentences.slice(start, start + batchSize);
    onProgress?.(`Understanding feedback · ${Math.min(start + batch.length, sentences.length)} of ${sentences.length} sentences`);
    const batchPredictions = await Promise.all(batch.map(async (sentence) => ({
      sentence,
      score: asPolarity(await classifier(sentence, { top_k: 1 })),
    })));
    predictions.push(...batchPredictions);
  }

  const average = (items: Array<{ score: number }>) => items.length
    ? items.reduce((sum, item) => sum + item.score, 0) / items.length
    : 0;
  const topicTerms: Record<keyof typeof baseline.topics, string[]> = {
    UX: ["easy", "confusing", "button", "dashboard", "setup", "navigation", "आसान", "मुश्किल", "डैशबोर्ड", "बटन", "शुरुआत", "उपयोग"],
    Pricing: ["price", "pricing", "cost", "expensive", "cheap", "subscription", "कीमत", "मूल्य", "महंगा", "महँगा", "खर्च"],
    Features: ["feature", "report", "export", "insight", "compare", "workflow", "सुविधा", "रिपोर्ट", "तुलना", "जानकारी", "काम"],
  };
  const topics = Object.fromEntries((Object.keys(topicTerms) as Array<keyof typeof baseline.topics>).map((topic) => {
    const matching = predictions.filter(({ sentence }) => topicTerms[topic].some((term) => sentence.toLocaleLowerCase().includes(term)));
    return [topic, matching.length ? average(matching) : average(predictions)];
  })) as typeof baseline.topics;
  const normalized = (sentence: string) => sentence.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const keyPoints = [...predictions]
    .filter(({ sentence }) => sentence.length > 18)
    .sort((a, b) => {
      const action = (sentence: string) => /\b(want|need|wish|would like|should|please|recommend|suggest|prefer|issue|problem|लेकिन|चाहिए|समस्या|सुझाव)\b/i.test(sentence) ? 0.35 : 0;
      const rank = (item: typeof a) => Math.abs(item.score) * 2 + action(item.sentence) + Math.min(item.sentence.length, 160) / 800;
      return rank(b) - rank(a);
    })
    .filter(({ sentence }, index, all) => all.findIndex((item) => normalized(item.sentence) === normalized(sentence)) === index)
    .slice(0, 6)
    .map(({ sentence }) => sentence);

  return {
    ...baseline,
    sentiment: average(predictions),
    topics,
    keyPoints: keyPoints.length ? keyPoints : baseline.keyPoints,
    analysisEngine: "multilingual-transformer" as const,
  };
}
