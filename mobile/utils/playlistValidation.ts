/**
 * Playlist name validation — Library screen ka "New Playlist" modal aur
 * add-to-playlist sheet ka inline create dono yahi use karte hain (FR-4.1).
 * Ek hi jagah rakha hai taaki dono surfaces ka behavior identical rahe.
 */
export const PLAYLIST_NAME_MAX = 40;

/**
 * @param rawName user ka typed naam
 * @param existingNames baaki playlists ke naam (duplicate check ke liye)
 * @returns error message, ya `null` agar naam valid hai
 */
export function validatePlaylistName(
  rawName: string,
  existingNames: readonly string[],
): string | null {
  const name = rawName.trim();
  if (!name) return 'Naam khaali nahi ho sakta';
  if (name.length > PLAYLIST_NAME_MAX) {
    return `Naam ${PLAYLIST_NAME_MAX} characters se chhota rakho`;
  }
  // Duplicate check case-insensitive (FR-4.1)
  const clash = existingNames.some(
    existing => existing.trim().toLowerCase() === name.toLowerCase(),
  );
  if (clash) return 'Is naam ki playlist pehle se hai';
  return null;
}
