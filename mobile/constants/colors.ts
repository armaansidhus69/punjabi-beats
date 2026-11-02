/**
 * Punjabi Beats theme — "Dhol Sunset" redesign (2026-11).
 *
 * Identity: deep midnight base + sunset gradient (orange → hot pink) jo
 * Punjabi pop energy deta hai. Sabhi screens/components yahi use karte hain
 * (single source of truth). Purane key names (background/surface/card/primary/
 * text/subtext/border) same hain — existing screens bina badle naye look me
 * aa jaate hain; naye keys (gradient, source colors, semantic colors) naye
 * design ke liye hain.
 */
export const colors = {
  /* Base surfaces — midnight, thoda blue-toned taaki warm accent pop kare */
  background: '#08080F',
  surface: '#10101B',
  card: '#191927',
  border: '#262638',

  /* Primary — sunset pink (buttons, active states, progress) */
  primary: '#FF416C',
  primaryDark: '#DD2476',
  primarySoft: 'rgba(255, 65, 108, 0.16)',

  /* Gradient identity — hero cards, player background, CTA buttons */
  gradientFrom: '#FF512F',
  gradientTo: '#DD2476',

  /* Text */
  text: '#FFFFFF',
  subtext: '#9A9AB5',

  /* Semantic */
  success: '#2BD46D',
  warning: '#FFC24B',
  danger: '#FF5A5A',

  /* Music source badges — har source ka apna pehchaan */
  sourceJioSaavn: '#2BD46D',
  sourceYouTube: '#FF4E45',
  sourceAudius: '#B96BFF',
  sourceITunes: '#FA6EC8',
  sourceGaana: '#FF7A45',
  sourceJamendo: '#4EA8FF',
  sourceSpotify: '#1DB954',
} as const;

export type AppColors = typeof colors;

/** Song.source → badge color (unknown source neutral grey) */
export const sourceColor: Record<string, string> = {
  jiosaavn: colors.sourceJioSaavn,
  youtube_music: colors.sourceYouTube,
  audius: colors.sourceAudius,
  itunes: colors.sourceITunes,
  gaana: colors.sourceGaana,
  jamendo: colors.sourceJamendo,
  spotify: colors.sourceSpotify,
};

/** Song.source → badge label (UI me dikhane ke liye) */
export const sourceLabel: Record<string, string> = {
  jiosaavn: 'JioSaavn',
  youtube_music: 'YT Music',
  audius: 'Audius',
  itunes: 'iTunes',
  gaana: 'Gaana',
  jamendo: 'Jamendo',
  spotify: 'Spotify',
};
