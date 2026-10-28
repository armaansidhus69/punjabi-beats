import { Redirect, Stack } from 'expo-router';
import { useAuthStore } from '../../stores/authStore';

export default function AuthLayout() {
  const initialized = useAuthStore(state => state.initialized);
  const status = useAuthStore(state => state.status);
  if (initialized && status === 'disabled') return <Redirect href="/" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        presentation: 'card',
      }}
    />
  );
}
