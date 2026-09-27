/**
 * Search store (Zustand) — recent searches (Phase 5, FR-1.6).
 *
 * Persistence playlistStore jaisa hi manual pattern hai (services/storage.ts),
 * kyunki poore app me AsyncStorage I/O ek hi service se hota hai — aur wahi
 * key (@pb_recent_searches) dono taraf se share hoti hai.
 */
import { create } from 'zustand';
import {
  clearRecentSearches as clearStoredRecentSearches,
  getRecentSearches,
  saveRecentSearches,
} from '../services/storage';

/** Design spec: max 5 recent rows (FR-1.6 me "last 10" likha hai — ye number badal ke 10 kar sakte ho) */
export const MAX_RECENT_SEARCHES = 5;

interface SearchStore {
  recentSearches: string[];
  /** cold start pe ek hi baar AsyncStorage se load hota hai */
  loaded: boolean;
  load: () => Promise<void>;
  /** trim + case-insensitive dedupe + prepend + max cap */
  addRecentSearch: (query: string) => void;
  removeRecentSearch: (query: string) => void;
  clearRecentSearches: () => void;
}

/** Dono taraf lower-case compare — "Diljit" aur "diljit" ek hi maane jaate hain */
function persistence(next: string[]): void {
  void saveRecentSearches(next);
}

export const useSearch = create<SearchStore>()((set, get) => ({
  recentSearches: [],
  loaded: false,

  load: async () => {
    const list = await getRecentSearches();
    set({ recentSearches: list, loaded: true });
  },

  addRecentSearch: query => {
    const trimmed = query.trim();
    if (!trimmed) return;

    const current = get().recentSearches;
    const lower = trimmed.toLowerCase();
    const newest = current[0];
    // Focused typing se list gandi na ho: agar sabse naya entry naye query ka
    // prefix hai (ya ulta), to usse REPLACE karo — "Dilj" → "Diljit" banne pe
    // ek hi row rahegi, dabbe hue junk entries nahi.
    const isContinuation =
      newest !== undefined &&
      (lower.startsWith(newest.toLowerCase()) || newest.toLowerCase().startsWith(lower));

    const deduped = current.filter(q => q.toLowerCase() !== lower);
    const withoutPrefix = isContinuation ? deduped.filter(q => q !== newest) : deduped;
    const next = [trimmed, ...withoutPrefix].slice(0, MAX_RECENT_SEARCHES);

    set({ recentSearches: next });
    persistence(next);
  },

  removeRecentSearch: query => {
    const lower = query.trim().toLowerCase();
    const next = get().recentSearches.filter(q => q.toLowerCase() !== lower);
    set({ recentSearches: next });
    persistence(next);
  },

  clearRecentSearches: () => {
    set({ recentSearches: [] });
    void clearStoredRecentSearches();
  },
}));
