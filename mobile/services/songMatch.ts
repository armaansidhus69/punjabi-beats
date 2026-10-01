/**
 * songMatch.ts — Smart YouTube matching ka SCORING CORE (pure logic, koi dep nahi).
 *
 * Ye file RN app me bundle hoti hai AUR root ke Node tests (`test-youtube-match.mjs`)
 * me seedha import hoti hai — isliye yahan koi Node-only API (child_process/fs)
 * nahi hona chahiye. SDK (musicstream-sdk) ka `search()` bhi yahan NAHI aata:
 * client sirf ek `MatchCandidate[]` list deta hai, scoring yahan hoti hai.
 *
 * PROBLEM: Spotify/iTunes metadata aur YouTube hasil ek hamesha same gaana nahi
 * hota — "Diljit - Mela" dhoondo to YouTube "Mel Gel" / "G.O.A.T." bhi de deta
 * hai. Galat audio bajana user ke liye sabse bura outcome hai, isliye match ko
 * REJECT karne wale rules `play` karna se zyada zaruri hain.
 *
 * DESIGN (spec ke 70/40 thresholds rakhe hain, lekin 3 real bugs fix kiye):
 *   1. TITLE GATE — spec me title match sirf +50 tha, gate nahi. Iska matlab:
 *      sahi artist (30) + galat song jiska duration mil gaya (20) = 50 >= 40 →
 *      galat audio "partial" bol kar baja diya jaata. Ab title overlap ka
 *      minimum (`TITLE_GATE_RATIO`) ke bina candidate REJECT hai — chahe score
 *      kitna bhi ho. (probe: "Mela" vs "G.O.A.T." exactly yahi trap hai.)
 *   2. VERIFIED CHANNEL SIGN — spec me `-100 if verified artist channel` likha
 *      tha. Wo ulta hai: artist ka apna verified channel sabse bharosemand
 *      source hota hai (spec ka apna "Artist channel priority" bhi wahi kehta
 *      hai). Ab `+10` hai — warna official upload hi reject ho jaata.
 *   3. REJECT LIST chhoti thi — "karaoke", "instrumental", "sped up",
 *      "nightcore", "tribute" jaise words missing the, jo galat version ko
 *      "exact" bana dete the.
 *
 * NOTE: `durationSec <= 0` (YouTube premiere/live pe hota hai) par duration ka
 * bonus/penalty SKIP hota hai — warna unknown duration ko "mismatch" maan kar
 * sahi gaana reject ho jaata.
 */

/* ---------- Types ---------- */

/** YouTube search result ka woh minimum shape jo scoring ko chahiye. */
export interface MatchCandidate {
  videoId: string;
  title: string;
  /** channel/uploader naam (SDK `Song.artist` ho sakta hai — video hit me uploader) */
  channel: string;
  /** seconds — 0/unknown allowed */
  durationSec: number;
  /**
   * YouTube "verified artist channel" flag — optional kyunki musicstream-sdk
   * search results ye expose NAHI karte (probe-verified). Raw YouTube Data API
   * (youtubeApiKey path) milta hai to use karo.
   */
  verified?: boolean;
}

/** Source metadata — Spotify/Apple/iTunes se (app ke andar `Song` + extras). */
export interface MatchSource {
  title: string;
  artist: string;
  album?: string;
  /** milliseconds — app ka `Song.duration` ms me hai, YouTube seconds me */
  durationMs: number;
  releaseYear?: number;
}

export interface ScoredCandidate extends MatchCandidate {
  score: number;
  /** Human-readable score breakdown — debug/UI ("why" tooltip) ke liye */
  reasons: string[];
}

export type MatchStatus = 'exact' | 'partial' | 'unavailable';

export interface MatchDecision {
  status: MatchStatus;
  /** best candidate (null = kuch bhi gate pass nahi kiya) */
  best: ScoredCandidate | null;
  /** score desc me sorted saare candidates (cutoff ke baad wale bhi) */
  ranked: ScoredCandidate[];
}


/* ---------- Tunables (spec ke numbers, documented) ---------- */

/** score >= EXACT → ✅ play */
export const SCORE_EXACT = 70;
/** score >= PARTIAL → ⚠️ "may not be exact" warning ke saath play */
export const SCORE_PARTIAL = 40;
/** duration itne second ke andar = "match" (+20) */
export const DURATION_MATCH_SEC = 10;
/** isse zyada dur = suspicious (−30); beech me neutral */
export const DURATION_MAX_DIFF_SEC = 30;
/**
 * Title overlap gate — is se kam overlap pe candidate REJECT.
 * 0.6 = source title ke kam se kam 60% words YouTube title me hone chahiye.
 */
export const TITLE_GATE_RATIO = 0.6;

/**
 * HARD REJECT list — spec ka SAFETY CHECK #5 ("Reject list") literally ye kehta
 * hai, aur spec ka apna note bhi hai: "warna user ko galat audio milega".
 * Isliye ye `-50` nahi, seedha REJECT hai (chahe score kitna bhi ho). Word-boundary
 * pe match hota hai (isse "Olive" me "live" nahi aata, aur "sped up"/"bass
 * boosted" jaise 2-word phrases bhi match hote hain).
 */
export const REJECT_WORDS: readonly string[] = [
  'remix',
  'slowed',
  'reverb',
  '8d',
  'bass boosted',
  'lyrics',
  'live',
  'concert',
  'karaoke',
  'instrumental',
  'nightcore',
  'mashup',
  'tribute',
  'cover',
  'sped up',
  'speed up',
  'ringtone',
];

/**
 * SOFT PENALTY list — ye "version" galat ho sakte hain lekin original bhi ho
 * sakte hain, isliye −50 (reject nahi). Ye spec ke −50 bucket me the.
 */
export const PENALTY_WORDS: readonly string[] = [
  'reaction',
  'lyrics video',
  'teaser',
  'trailer',
  'behind the scenes',
  'loop',
];

/**
 * Positive keywords — spec me "official" + "audio" the. "topic" bhi add kiya
 * kyunki YouTube Music ke auto-generated "… - Topic" channels hi original
 * label audio dete hain (musicstream-sdk use normalize kar deta hai, lekin raw
 * YouTube Data API path me dikhta hai).
 */
export const GOOD_WORDS: readonly string[] = ['official', 'audio', 'topic'];

/** Title me ye words na aayein to title-coverage me count nahi hote */
const STOP_WORDS = new Set(['the', 'a', 'an', 'and', 'of', 'to', 'in', 'feat', 'ft', 'with']);

/* ---------- Normalization helpers ---------- */

/**
 * Case/punctuation-insensitive key.
 * Latin + Devanagari (u0900-u097F) + Gurmukhi (u0A00-u0A7F) preserve karte hain
 * — `musicApi.ts` ke `normalizeTitle` jaisa hi pattern, warna Punjabi/Hindi
 * titles khaali string ban jaate.
 */
export function normalizeForMatch(text: string): string {
  return (text || '')
    .toLowerCase()
    // Dotted initialisms collapse karo: "g.o.a.t." → "goat", "a.r. rahman" →
    // "ar rahman". Warna normalize ke baad "goat" vs "g o a t" ho jaata aur
    // Diljit ka "G.O.A.T." jaise popular title galat se reject ho jaata tha.
    .replace(/([a-z0-9])\.(?=[a-z0-9])/g, '$1')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\u0900-\u097F\u0A00-\u0A7F]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Normalize + tokenize (stop-words hata ke) */
export function matchTokens(text: string): string[] {
  return normalizeForMatch(text)
    .split(' ')
    .filter(t => t.length > 0 && !STOP_WORDS.has(t));
}

/** Word-boundary substring check (normalize ke baad) */
function containsPhrase(haystack: string, needle: string): boolean {
  if (!haystack || !needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

/**
 * Title overlap 0..1.
 *   1.0  = exact ya source-title YouTube title me word-boundary se poora aata hai
 *   0.85 = saare source words maujood (order/extra words alag — "… (Official Video)")
 *   0.6  = sirf zyadatar words (>= TITLE_GATE_RATIO)
 *   0    = kuch bhi significant match nahi (→ REJECT)
 */
export function titleMatchRatio(ytTitle: string, sourceTitle: string): number {
  const a = normalizeForMatch(ytTitle);
  const b = normalizeForMatch(sourceTitle);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (containsPhrase(a, b)) return 1;

  const srcTokens = matchTokens(sourceTitle);
  if (srcTokens.length === 0) return 0;
  const ytTokens = new Set(matchTokens(ytTitle));
  const hit = srcTokens.filter(t => ytTokens.has(t)).length;
  const coverage = hit / srcTokens.length;

  if (coverage >= 1) return 0.85;
  if (coverage >= TITLE_GATE_RATIO) return 0.6;
  return 0;
}

/** Channel/uploader ya title me artist naam hai? (token coverage) */
export function artistMatches(channel: string, ytTitle: string, artist: string): boolean {
  const artistTokens = matchTokens(artist);
  if (artistTokens.length === 0) return false;
  const hay = new Set([...matchTokens(channel), ...matchTokens(ytTitle)]);
  // 1-word artist ("Shubh") → wo word hona hi chahiye.
  // Multi-word ("Karan Aujla") → kam se kam aadhe words (feat./collab tolerate).
  const hit = artistTokens.filter(t => hay.has(t)).length;
  if (artistTokens.length === 1) return hit === 1;
  return hit / artistTokens.length >= 0.5;
}

/** Title me pehla mila HARD reject word (word-boundary) ya null */
export function findRejectWord(ytTitle: string): string | null {
  const hay = ` ${normalizeForMatch(ytTitle)} `;
  for (const w of REJECT_WORDS) {
    if (hay.includes(` ${normalizeForMatch(w)} `)) return w;
  }
  return null;
}

/** Title me pehla mila soft penalty word (word-boundary) ya null */
export function findPenaltyWord(ytTitle: string): string | null {
  const hay = ` ${normalizeForMatch(ytTitle)} `;
  for (const w of PENALTY_WORDS) {
    if (hay.includes(` ${normalizeForMatch(w)} `)) return w;
  }
  return null;
}

/** Title me positive keyword (+15) — "official"/"audio"/"topic" */
export function hasGoodWord(ytTitle: string): boolean {
  const hay = ` ${normalizeForMatch(ytTitle)} `;
  return GOOD_WORDS.some(w => hay.includes(` ${normalizeForMatch(w)} `));
}

/* ---------- Scoring ---------- */

/**
 * Ek candidate ko score karo (spec ka score system + upar wale 3 fixes).
 * Pure function — same input pe same output, isliye test-friendly.
 * Gate fail (title overlap 0) pe `Number.NEGATIVE_INFINITY` — hamesha bottom.
 */
export function scoreCandidate(candidate: MatchCandidate, source: MatchSource): ScoredCandidate {
  const reasons: string[] = [];

  // --- HARD REJECT: rejects pe score calculate karne ka koi matlab nahi ---
  const reject = findRejectWord(candidate.title);
  if (reject) {
    return {
      ...candidate,
      score: Number.NEGATIVE_INFINITY,
      reasons: [`title: reject "${reject}" → not usable`],
    };
  }

  let score = 0;

  // --- Title (gate + weight) ---
  const ratio = titleMatchRatio(candidate.title, source.title);
  if (ratio <= 0) {
    return {
      ...candidate,
      score: Number.NEGATIVE_INFINITY,
      reasons: ['title: no overlap → reject'],
    };
  }
  const titlePoints = Math.round(50 * ratio);
  score += titlePoints;
  reasons.push(`title: ${Math.round(ratio * 100)}% overlap → +${titlePoints}`);

  // --- Artist ---
  if (artistMatches(candidate.channel, candidate.title, source.artist)) {
    score += 30;
    reasons.push('artist: channel/title match → +30');
  } else {
    reasons.push('artist: no match → 0');
  }

  // --- Duration (unknown ko mismatch NA maano) ---
  const srcSec = Math.round((source.durationMs || 0) / 1000);
  if (srcSec > 0 && candidate.durationSec > 0) {
    const diff = Math.abs(candidate.durationSec - srcSec);
    if (diff <= DURATION_MATCH_SEC) {
      score += 20;
      reasons.push(`duration: ±${diff}s → +20`);
    } else if (diff > DURATION_MAX_DIFF_SEC) {
      score -= 30;
      reasons.push(`duration: ${diff}s off (>${DURATION_MAX_DIFF_SEC}s) → -30`);
    } else {
      reasons.push(`duration: ${diff}s off → 0`);
    }
  } else {
    reasons.push('duration: unknown → 0 (skip)');
  }

  // --- Positive keywords (+15, ek baar) ---
  if (hasGoodWord(candidate.title)) {
    score += 15;
    reasons.push('title: official/audio/topic → +15');
  }

  // --- Verified artist channel — FIX: spec me −100 (sign bug), yahan +10 ---
  if (candidate.verified) {
    score += 10;
    reasons.push('channel: verified artist → +10');
  }

  // --- Soft penalties (spec ka −50 bucket) ---
  const penalty = findPenaltyWord(candidate.title);
  if (penalty) {
    score -= 50;
    reasons.push(`title: "${penalty}" → -50`);
  }

  return { ...candidate, score, reasons };
}

/** Candidate list ko score + sort karke best decide karo (70/40 thresholds). */
export function pickBestMatch(candidates: MatchCandidate[], source: MatchSource): MatchDecision {
  const ranked = candidates
    .map(c => scoreCandidate(c, source))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0] ?? null;
  if (!best || !Number.isFinite(best.score) || best.score < SCORE_PARTIAL) {
    return { status: 'unavailable', best: null, ranked };
  }
  if (best.score >= SCORE_EXACT) {
    return { status: 'exact', best, ranked };
  }
  return { status: 'partial', best, ranked };
}

