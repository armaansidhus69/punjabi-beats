import { readLocalJson, writeLocalJson } from './localStore';

const SCHEMA_VERSION_KEY = '@pb_core_schema_version';
export const CURRENT_LOCAL_SCHEMA_VERSION = 1;

type Migration = () => Promise<void>;

const migrations: Record<number, Migration> = {
  1: async () => {
    // Version 1 reserves the core namespace without rewriting existing app data.
  },
};

export async function runLocalMigrations(): Promise<void> {
  const stored = await readLocalJson<unknown>(SCHEMA_VERSION_KEY);
  const current = typeof stored === 'number' && Number.isInteger(stored) ? stored : 0;

  if (current > CURRENT_LOCAL_SCHEMA_VERSION) {
    console.warn(
      `[core/database] local schema ${current} is newer than this app's ${CURRENT_LOCAL_SCHEMA_VERSION}`,
    );
    return;
  }

  for (let version = current + 1; version <= CURRENT_LOCAL_SCHEMA_VERSION; version += 1) {
    const migration = migrations[version];
    if (migration) await migration();
    await writeLocalJson(SCHEMA_VERSION_KEY, version);
  }
}
