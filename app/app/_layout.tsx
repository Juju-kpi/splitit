// app/app/_layout.tsx
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { useFonts } from 'expo-font';
import {
  Geist_400Regular, Geist_500Medium, Geist_600SemiBold,
} from '@expo-google-fonts/geist';
import {
  GeistMono_400Regular, GeistMono_500Medium,
} from '@expo-google-fonts/geist-mono';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuthStore } from '../src/store/authStore';
import { useRouter, useSegments } from 'expo-router';
import * as Linking from 'expo-linking';
import { colors } from '../src/theme';
import UpdateGate from '../src/components/UpdateGate';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

function AuthGuard() {
  const { isAuthenticated, isLoading, initialize } = useAuthStore();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => { initialize(); }, []);

  useEffect(() => {
    if (isLoading) return;
    const inAuth = segments[0] === '(auth)';
    if (!isAuthenticated && !inAuth) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuth) {
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, isLoading, segments]);

  // ── Deep link — splitit://forgot-password?token=xxx ───────────────────
  useEffect(() => {
    function handleUrl(url: string | null) {
      if (!url) return;
      const tokenMatch = url.match(/forgot-password[^?]*\?.*token=([^&]+)/);
      if (tokenMatch) {
        const token = decodeURIComponent(tokenMatch[1]);
        setTimeout(() => {
          router.push(`/forgot-password?token=${token}`);
        }, 300);
      }
    }

    const sub = Linking.addEventListener('url', (event) => handleUrl(event.url));
    Linking.getInitialURL().then(handleUrl);

    return () => sub.remove();
  }, []);

  return null;
}

export default function RootLayout() {
  // Geist pour le texte, Geist Mono pour les montants. On attend qu'elles
  // soient pretes : afficher un ecran en police systeme puis le voir sauter
  // est plus desagreable qu'un instant de fond noir. `error` est ignore
  // volontairement — si une police manque, on affiche quand meme.
  const [fontsLoaded, fontError] = useFonts({
    Geist_400Regular, Geist_500Medium, Geist_600SemiBold,
    GeistMono_400Regular, GeistMono_500Medium,
  });

  if (!fontsLoaded && !fontError) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  }

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthGuard />
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="group/[id]" options={{ presentation: 'card' }} />
          <Stack.Screen name="group/new" options={{ presentation: 'modal' }} />
          <Stack.Screen name="group/join" options={{ presentation: 'modal' }} />
          <Stack.Screen name="group/members" options={{ presentation: 'modal' }} />
          <Stack.Screen name="forgot-password" options={{ presentation: 'modal' }} />
          <Stack.Screen name="expense/add" options={{ presentation: 'modal' }} />
          <Stack.Screen name="expense/[id]" options={{ presentation: 'card' }} />
        </Stack>
        <Toast />
        {/* Au-dessus de tout : le message de mise a jour doit rester visible
            quel que soit l'ecran ouvert. */}
        <UpdateGate />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}