import { EQUIPMENT, MUSCLES } from '@fitadapt/exercise-library';
import type { MessageKey } from '@fitadapt/i18n';
import { useI18n } from '@fitadapt/i18n/react';
import { MOVEMENT_PATTERNS, type EquipmentId, type MovementPattern, type MuscleId } from '@fitadapt/shared';
import { Button, Chip, Input, useTheme } from '@fitadapt/ui';
import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { LibraryStore } from '../library/library-store';

export interface LibraryScreenProps {
  store: LibraryStore;
  onBack?: () => void;
}

/**
 * M06 exercise library: search and filter by movement pattern, muscle and
 * equipment, all from the on-device SQLite copy (works offline). Seed content
 * is shown with a draft notice: it is not yet reviewed by the council.
 */
export function LibraryScreen({ store, onBack }: LibraryScreenProps) {
  const theme = useTheme();
  const { t, locale } = useI18n();
  const [text, setText] = useState('');
  const [pattern, setPattern] = useState<MovementPattern | undefined>();
  const [muscle, setMuscle] = useState<MuscleId | undefined>();
  const [equipment, setEquipment] = useState<ReadonlySet<EquipmentId> | undefined>();
  const [revision, setRevision] = useState(0);

  const rows = useMemo(
    () => store.search({ locale, text, pattern, muscle, equipment: equipment ? [...equipment] : undefined }),
    // `revision` refreshes favourites after a toggle.
    [store, locale, text, pattern, muscle, equipment, revision],
  );

  const hint = (selected: boolean) => (selected ? t('library.filter.selectedHint') : t('library.filter.unselectedHint'));
  const toggleEquipment = (id: EquipmentId) => {
    const next = new Set(equipment ?? []);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setEquipment(next.size > 0 ? next : undefined);
  };
  const clear = () => {
    setText('');
    setPattern(undefined);
    setMuscle(undefined);
    setEquipment(undefined);
  };

  const sectionTitle = { color: theme.colors.text, fontSize: theme.fontSize.body, fontWeight: theme.fontWeight.bold } as const;
  const chipRow = { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.lg }} testID="library-screen" keyboardShouldPersistTaps="handled">
        {onBack ? <Button label={t('library.back')} variant="secondary" onPress={onBack} testID="library-back" /> : null}
        <Text accessibilityRole="header" style={{ color: theme.colors.text, fontSize: theme.fontSize.headline, fontWeight: theme.fontWeight.bold }}>
          {t('library.title')}
        </Text>
        <Text style={{ color: theme.colors.textMuted, fontSize: theme.fontSize.label }}>{t('library.offline')}</Text>
        <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.label }} testID="library-draft-notice">
          {t('library.draftNotice')}
        </Text>

        <Input label={t('library.search.label')} hint={t('library.search.hint')} value={text} onChangeText={setText} testID="library-search" autoComplete="off" />

        <Text style={sectionTitle}>{t('library.filter.pattern')}</Text>
        <View style={chipRow}>
          {MOVEMENT_PATTERNS.map((p) => (
            <Chip key={p} label={t(`library.pattern.${p}` as MessageKey)} selected={pattern === p} hint={hint(pattern === p)} onPress={() => setPattern(pattern === p ? undefined : p)} testID={`filter-pattern-${p}`} />
          ))}
        </View>

        <Text style={sectionTitle}>{t('library.filter.muscle')}</Text>
        <View style={chipRow}>
          {MUSCLES.map((m) => (
            <Chip key={m.id} label={t(m.nameKey as MessageKey)} selected={muscle === m.id} hint={hint(muscle === m.id)} onPress={() => setMuscle(muscle === m.id ? undefined : m.id)} testID={`filter-muscle-${m.id}`} />
          ))}
        </View>

        <Text style={sectionTitle}>{t('library.filter.equipment')}</Text>
        <Text style={{ color: theme.colors.textMuted, fontSize: theme.fontSize.label }}>{t('library.filter.equipmentHint')}</Text>
        <View style={chipRow}>
          {EQUIPMENT.map((e) => {
            const selected = equipment?.has(e.id) ?? false;
            return <Chip key={e.id} label={t(e.nameKey as MessageKey)} selected={selected} hint={hint(selected)} onPress={() => toggleEquipment(e.id)} testID={`filter-equipment-${e.id}`} />;
          })}
        </View>

        <Button label={t('library.filter.clear')} variant="secondary" onPress={clear} testID="library-clear" />

        <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.textMuted, fontSize: theme.fontSize.label }} testID="library-count">
          {t('library.results', { count: rows.length })}
        </Text>
        {rows.length === 0 ? <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.body }}>{t('library.empty')}</Text> : null}

        {rows.map((row) => (
          <View
            key={row.id}
            testID={`exercise-${row.id}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, padding: theme.spacing.md }}
          >
            <View style={{ flex: 1, gap: theme.spacing.xs }}>
              <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.body, fontWeight: theme.fontWeight.bold }}>{row.name}</Text>
              <Text style={{ color: theme.colors.textMuted, fontSize: theme.fontSize.label }}>{t(`library.pattern.${row.pattern}` as MessageKey)}</Text>
            </View>
            <Button
              label={row.favourite ? t('library.favourite.remove', { name: row.name }) : t('library.favourite.add', { name: row.name })}
              display={row.favourite ? t('library.favourite.on') : t('library.favourite.off')}
              variant="secondary"
              onPress={() => {
                store.setFavourite(row.id, !row.favourite);
                setRevision((r) => r + 1);
              }}
              testID={`favourite-${row.id}`}
            />
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
