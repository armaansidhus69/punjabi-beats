/**
 * Podcast episode adapters (Phase 12a) — source rows → PodcastEpisode →
 * existing player pipeline (Song). Pure — test-podcast.mjs headless use
 * karta hai (RN/Supabase import nahi).
 */

import type { PodcastEpisode, PodcastShow, Song } from '../../types';
import { fnv1a64Hex } from '../blend/snapshot.ts';
import { parseItunesDuration, type RssEpisode } from './rss.ts';

/** audioUrl ka stable id — resume/played keys isse drive hote (spec) */
export function stableEpisodeId(audioUrl: string): string {
  const normalized = audioUrl.trim().toLowerCase();
  return fnv1a64Hex([normalized]);
}

/** RSS <item> → PodcastEpisode (audioUrl ke bina → null, spec mapper filter) */
export function rssEpisodeToPodcastEpisode(
  item: RssEpisode,
  show: Pick<PodcastShow, 'id' | 'title' | 'artworkUrl'>,
): PodcastEpisode | null {
  if (item.audioUrl === '' || item.audioUrl === null) return null;
  return {
    id: stableEpisodeId(item.audioUrl),
    showId: show.id,
    showTitle: show.title,
    title: item.title || show.title,
    description: item.description,
    artworkUrl: item.artworkUrl ?? show.artworkUrl,
    durationMs: Math.max(0, Math.round((parseItunesDuration(item.rawDurationSec) ?? 0) * 1000)),
    audioUrl: item.audioUrl,
    publishedAt: item.publishedAt,
  };
}

/** iTunes lookup/search raw row (snake_case REST shape) → PodcastEpisode */
export interface ItunesEpisodeRow {
  trackName?: string | null;
  episodeUrl?: string | null;
  trackTimeMillis?: number | null;
  description?: string | null;
  releaseDate?: string | null;
  artworkUrl160?: string | null;
  artworkUrl600?: string | null;
  collectionId?: number | null;
  collectionName?: string | null;
  artistName?: string | null;
}

export function itunesEpisodeRowToPodcastEpisode(
  row: ItunesEpisodeRow,
  show: Pick<PodcastShow, 'id' | 'title' | 'artworkUrl'>,
): PodcastEpisode | null {
  const url = row.episodeUrl ?? '';
  if (url === '') return null;
  const title = row.trackName ?? '';
  const ms = Math.max(0, Math.round(row.trackTimeMillis ?? 0));
  const iso = row.releaseDate ?? '';
  return {
    id: stableEpisodeId(url),
    showId: row.collectionId != null ? String(row.collectionId) : show.id,
    showTitle: row.collectionName ?? show.title,
    title: title || show.title,
    description: row.description ? row.description : null,
    artworkUrl: row.artworkUrl160 ?? row.artworkUrl600 ?? show.artworkUrl,
    durationMs: ms,
    audioUrl: url,
    publishedAt: Number.isNaN(Date.parse(iso)) ? '' : new Date(Date.parse(iso)).toISOString(),
  };
}

/** Episode → existing player pipeline — full stream, previewOnly false */
export function episodeToSong(ep: PodcastEpisode): Song {
  return {
    id: ep.id,
    title: ep.title,
    artist: ep.showTitle,
    cover: ep.artworkUrl,
    preview: ep.audioUrl,
    duration: ep.durationMs,
    source: 'itunes',
    previewOnly: false,
  };
}
