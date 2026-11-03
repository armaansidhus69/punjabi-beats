/**
 * Legal & Compliance Terms (Phase 9 / IMP-09).
 * Production Privacy Policy & Terms of Service for Play Store & App Store compliance.
 */

export const PRIVACY_POLICY = {
  title: 'Privacy Policy — Punjabi Beats',
  effectiveDate: 'October 2026',
  version: '2.0',
  sections: [
    {
      title: '1. Guest-First & Zero Forced Registration',
      content:
        'Punjabi Beats requires zero personal sign-up to stream music, create playlists, download offline caches, or join Group Jam rooms. A random pseudonymous device identifier (@pb_device_id) is generated locally to persist your library. If you optionally link an email or 6-word pairing passphrase for multi-device sync, your guest playlists and likes are merged without third-party profiling.',
    },
    {
      title: '2. No Third-Party Ad Networks or Behavioural Trackers',
      content:
        'We embed zero advertising SDKs, cross-app trackers, or telemetry brokers. Taste signals (play_start, play_complete, song_like, play_skip) are processed locally and securely on our serverless backend solely to compute your personal Taste Profile, Taste Blends, and AI Vibe playlists.',
    },
    {
      title: '3. AI Vibe & DJ Assistant Disclosure',
      content:
        'When using AI Vibe Mix or the DJ Assistant, only your prompt text and top coarse artist names (e.g., "Diljit Dosanjh, Karan Aujla") are used to suggest tracks. Private identifiers, device IDs, room chats, and timestamps are never transmitted to external LLM providers.',
    },
    {
      title: '4. Offline Audio Caching & Local Storage',
      content:
        'Audio files cached for offline playback are stored locally within sandboxed app storage / browser CacheStorage. These files are accessible only by Punjabi Beats and are deleted upon clearing cache or uninstalling the application.',
    },
    {
      title: '5. Data Deletion & Privacy Rights',
      content:
        'You retain absolute ownership of your data. You can delete your local library, clear listening history, or wipe server-associated guest sessions at any time via Settings -> Clear Storage.',
    },
  ],
};

export const TERMS_OF_SERVICE = {
  title: 'Terms of Service — Punjabi Beats',
  effectiveDate: 'October 2026',
  version: '2.0',
  sections: [
    {
      title: '1. Service Scope & Fair Usage',
      content:
        'Punjabi Beats provides high-definition Punjabi music streaming, group listening rooms, and AI-powered playlist curation. Users agree not to misuse, reverse-engineer, or attempt denial-of-service against the sync relays or backend infrastructure.',
    },
    {
      title: '2. Real-Time Jam Room Sync & Conduct',
      content:
        'Group Jam rooms use real-time peer synchronization. In Open Jam mode, members take turns adding tracks under fair-turn scheduling. Harassment, abuse in room chats, or disruptive flooding will result in session revocation.',
    },
    {
      title: '3. Streaming Providers & Full-Song Playback',
      content:
        'Music is resolved through legal public discovery APIs (JioSaavn, Audius, iTunes IN metadata, and YouTube Music bridge providers). Punjabi Beats plays full streams only; if a full stream is unavailable, that track is skipped.',
    },
    {
      title: '4. Limitation of Liability',
      content:
        'Punjabi Beats is provided on an "as-is" and "as-available" basis without warranties of any kind regarding third-party catalog uptime or provider stream availability.',
    },
  ],
};
