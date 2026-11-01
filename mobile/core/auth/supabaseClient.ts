import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

function readPublicConfig(): { url: string; key: string } | null {
  const url =
    process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ||
    'https://xlprzushieqhlqrwafeq.supabase.co';
  const key =
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhscHJ6dXNoaWVxaGxxcndhZmVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMwMDQ3NTYsImV4cCI6MjEwODU4MDc1Nn0.RP-CpDNKaN6SSRmeH7VJeSkXDVPqjOYR8QmwfNnAqXs';

  if (!url || !key) return null;
  return { url, key };
}

const config = readPublicConfig();

export const supabase: SupabaseClient | null = config
  ? createClient(config.url, config.key, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: Platform.OS === 'web',
      },
    })
  : null;

export function isSupabaseConfigured(): boolean {
  return supabase !== null;
}
