// retrieval/embed.ts
// Lightweight semantic similarity — a deterministic, dependency-free
// embedding (hashed words + token n-grams → normalized vector). Not a giant
// model; it's the "gist" layer so memory fires by *meaning*, not exact words.

/** Grammatical words that must not participate in stem/prefix matching. */
const COMMON_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "than", "as", "at",
  "by", "of", "on", "to", "in", "is", "are", "was", "were", "be", "been",
  "it", "its", "this", "that", "these", "those", "i", "we", "you", "he",
  "she", "they", "my", "our", "your", "their", "me", "us", "them", "do",
  "does", "did", "have", "has", "had", "will", "would", "can", "could",
  "should", "may", "might", "must", "with", "from", "into", "over", "under",
  "about", "there", "here", "when", "where", "which", "who", "whom", "what",
  "how", "why", "no", "not", "nor", "for", "so", "very", "just", "also",
]);

export function isCommonWord(word: string): boolean {
  return COMMON_WORDS.has(word);
}

/** Light stem so "neurons" matches "neuron" and "firing" matches "fire". */
export function stem(token: string): string {
  if (token.length > 4 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

/** Prefix-tolerant stem comparison (min 3 chars) for morphological variants. */
export function stemsOverlap(a: string, b: string): boolean {
  if (a === b) return true;
  const sa = stem(a);
  const sb = stem(b);
  if (sa === sb) return true;
  const min = Math.min(sa.length, sb.length);
  return min >= 3 && (sa.startsWith(sb) || sb.startsWith(sa));
}

/** Tiny BM25-ish scorer for keyword rank — deterministic, fast, testable. */
export function bm25Score(queryTerms: string[], doc: string, avgLen = 60, docLen = 40): number {
  const terms = doc.toLowerCase().split(/\W+/).filter((t) => t && !isCommonWord(t));
  const tf = new Map<string, number>();
  for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
  let score = 0;
  const k1 = 1.5, b = 0.75;
  for (const q of queryTerms) {
    let f = tf.get(q) ?? 0;
    // Morphological fallback: "steering" should match "steer", "bugs" → "bug".
    if (f === 0) {
      for (const [term, count] of tf) {
        if (stemsOverlap(q, term)) { f += count; }
      }
    }
    if (f === 0) continue;
    const idf = 1 + Math.log(1 + (avgLen / Math.max(1, docLen)));
    score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * (docLen / avgLen)));
  }
  return score;
}

/** Hashed embedding: char n-grams (so "automobile" ≈ "automobiles") vote
 *  into D buckets, so morphological relatives share buckets like real
 *  semantic neurons do. */
export function embedText(text: string, dim = 256): number[] {
  const vec = new Array(dim).fill(0);
  const words = text.toLowerCase().split(/\W+/).filter((w) => w.length >= 2);
  const hash = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Math.abs(h) % dim;
  };
  for (const w of words) {
    vec[hash(w)] += 1;
    // char 3-grams: shares buckets with morphological relatives
    const grams = new Set<string>();
    for (let i = 0; i + 3 <= w.length; i++) grams.add(w.slice(i, i + 3));
    for (const g of grams) vec[hash(g)] += 0.5;
    if (w.length > 3) vec[hash(w.slice(0, -1))] += 0.3; // stem-ish
  }
  for (let i = 0; i + 1 < words.length; i++) vec[hash(words[i] + "|" + words[i + 1])] += 0.3;
  const len = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / len);
}

/** Cosine similarity. */
export function cosSim(a: number[], b: number[]): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
}