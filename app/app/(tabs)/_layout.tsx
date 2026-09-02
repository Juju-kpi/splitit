// app/app/(tabs)/_layout.tsx
import { Tabs } from 'expo-router';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import { colors, radius, fonts } from '../../src/theme';
import { useT } from '../../src/store/langStore';

// Feather est la famille dont Lucide, utilise cote web, est issu : meme
// dessin, meme trait, d'une plateforme a l'autre.
const TAB_ICONS = {
  index: 'home',
  groups: 'users',
  stats: 'bar-chart-2',
  settings: 'settings',
} as const;

function TabIcon({ name, focused }: { name: keyof typeof TAB_ICONS; focused: boolean }) {
  const t = useT();
  return (
    <View style={styles.tabItem}>
      <View style={styles.tabIconWrap}>
        <Feather
          name={TAB_ICONS[name]}
          size={21}
          color={focused ? colors.text : colors.text3}
        />
      </View>
      <Text style={[styles.tabLabel, focused && styles.tabLabelOn]}>{t(`tabs.${name === 'index' ? 'home' : name}`)}</Text>
    </View>
  );
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  // Ensure enough bottom padding for accessibility
  const tabBarHeight = 64 + Math.max(insets.bottom, 8);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: tabBarHeight,
          paddingBottom: Math.max(insets.bottom, 8),
          paddingTop: 8,
        },
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.text3,
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon name="index" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="groups"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon name="groups" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon name="stats" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon name="settings" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingTop: 2,
    minWidth: 60,
    minHeight: 44, // accessibility minimum
  },
  tabIconWrap: {
    width: 40,
    height: 30,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabel: { fontFamily: fonts.medium, fontSize: 11, color: colors.text3 },
  tabLabelOn: { color: colors.text },
});