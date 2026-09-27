/**
 * Dark theme color palette (per PROMPT.md UI/UX spec).
 * Single source of truth — sabhi screens/components yahi use karenge.
 */
export const colors = {
  background: '#0a0a0f',
  surface: '#12121a',
  card: '#1f1f2e',
  primary: '#ffb347',
  text: '#ffffff',
  subtext: '#888888',
  border: '#2a2a40',
} as const;

export type AppColors = typeof colors;
