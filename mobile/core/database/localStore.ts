import AsyncStorage from '@react-native-async-storage/async-storage';

export async function readLocalJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (error) {
    console.warn(`[core/database] read failed for ${key}:`, error);
    return null;
  }
}

export async function writeLocalJson<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`[core/database] write failed for ${key}:`, error);
  }
}

export async function removeLocalValue(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch (error) {
    console.warn(`[core/database] remove failed for ${key}:`, error);
  }
}
