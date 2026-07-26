// app/app/(tabs)/_layout.tsx
import { Tabs } from 'expo-router';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, shadows } from '../../src/theme';
import { useT } from '../../src/store/langStore';

const TABS = [
  { name: 'index',    emoji: '⬡',  emojiActive: '⬡',  label: 'Accueil' },
  { name: 'groups',   emoji: '◎',  emojiActive: '◎',  label: 'Groupes' },
  { name: 'stats',    emoji: '⌇',  emojiActive: '⌇',  label: 'Stats'   },
  { name: 'settings', emoji: '⊙',  emojiActive: '⊙',  label: 'Réglages'},
];

// Real emoji version for clarity
const TAB_ICONS: Record<string, string> = {
  index: '🏠',
  groups: '👥',
  stats: '📊',
  settings: '⚙️',
};

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const t = useT();
  return (
    <View style={styles.tabItem}>
      {focused && <View style={styles.tabActiveGlow} />}
      <View style={[styles.tabIconWrap, focused && styles.tabIconWrapActive]}>
        <Text style={styles.tabEmoji}>{TAB_ICONS[name]}</Text>
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
          backgroundColor: colors.glass,
          borderTopColor: colors.glassBorder,
          borderTopWidth: 1,
          height: tabBarHeight,
          paddingBottom: Math.max(insets.bottom, 8),
          paddingTop: 8,
          ...shadows.tabBar,
        },
        tabBarActiveTintColor: colors.accent2,
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
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIconWrapActive: {
    backgroundColor: colors.accentBg,
    borderWidth: 1,
    borderColor: 'rgba(124,110,250,0.2)',
  },
  tabActiveGlow: {
    position: 'absolute',
    top: 0,
    width: 24,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.accent,
  },
  tabEmoji: { fontSize: 20 },
  tabLabel: { fontSize: 10, fontWeight: '600', color: colors.text3, letterSpacing: 0.3 },
  tabLabelOn: { color: colors.accent2 },
});