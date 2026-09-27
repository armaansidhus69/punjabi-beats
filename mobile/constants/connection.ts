/**
 * Connection status presentation (FR-5.8) — Room tab + Room screen dono isi se
 * padhte hain taaki label/color kabhi drift na ho (5-state ConnectionState).
 */
import { ConnectionState } from '../types';
import { colors } from './colors';

export const CONNECTION_LABEL: Record<ConnectionState, string> = {
  initialized: 'Not connected',
  connecting: 'Connecting…',
  connected: 'Connected',
  disconnected: 'Reconnecting…',
  failed: 'Offline',
};

export const CONNECTION_DOT: Record<ConnectionState, string> = {
  initialized: colors.subtext,
  connecting: '#f1c40f',
  connected: '#2ecc71',
  disconnected: '#f1c40f',
  failed: '#ff6b6b',
};
