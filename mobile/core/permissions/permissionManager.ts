export type PermissionName = 'notifications' | 'media_library' | 'microphone' | 'bluetooth';
export type PermissionStatus = 'granted' | 'denied' | 'undetermined' | 'unavailable';

export async function getPermissionStatus(_permission: PermissionName): Promise<PermissionStatus> {
  return 'unavailable';
}

export async function requestPermission(_permission: PermissionName): Promise<PermissionStatus> {
  return 'unavailable';
}
