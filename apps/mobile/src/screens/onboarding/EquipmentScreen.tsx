import { EQUIPMENT } from '@fitadapt/exercise-library';
import { useI18n } from '@fitadapt/i18n/react';
import type { MessageKey } from '@fitadapt/i18n';
import { EQUIPMENT_LOCATIONS, type EquipmentId, type EquipmentLocation } from '@fitadapt/shared';
import { Button, Card, Chip, useTheme } from '@fitadapt/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OnboardingScaffold, Paragraph } from '../../onboarding/OnboardingScaffold';
import { nextPath } from '../../onboarding/steps';
import { useProfile } from '../../profile/ProfileProvider';

/**
 * Places and their equipment (M01: one equipment profile per location, built
 * from the M06 taxonomy). Each place shows the items typically found there.
 */
export function EquipmentEditor() {
  const { t } = useI18n();
  const theme = useTheme();
  const profiles = useProfile((s) => s.equipment);
  const save = useProfile((s) => s.saveEquipment);
  const remove = useProfile((s) => s.removeEquipment);
  return (
    <View style={{ gap: theme.spacing.lg }}>
      {EQUIPMENT_LOCATIONS.map((location) => {
        const name = t(`location.${location}`);
        const stored = profiles.find((p) => p.data.location === location);
        if (!stored) {
          return <Button key={location} label={t('onboarding.equipment.add', { location: name })} hint={t('onboarding.equipment.addHint')} variant="secondary" onPress={() => save(location, [])} testID={`equipment-add-${location}`} />;
        }
        const have = stored.data.equipment;
        const toggle = (id: EquipmentId) => save(location, have.includes(id) ? have.filter((x) => x !== id) : [...have, id]);
        return (
          <Card key={location} title={name} testID={`equipment-profile-${location}`}>
            <Text style={{ color: theme.colors.textMuted, fontSize: theme.fontSize.label }}>{t('onboarding.equipment.count', { count: have.length })}</Text>
            <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.label }}>{t('onboarding.equipment.itemsFor', { location: name })}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
              {EQUIPMENT.filter((e) => e.locations.includes(location as EquipmentLocation)).map((e) => (
                <Chip
                  key={e.id}
                  label={t(e.nameKey as MessageKey)}
                  hint={t('onboarding.equipment.itemHint', { location: name })}
                  selected={have.includes(e.id)}
                  onPress={() => toggle(e.id)}
                  testID={`equipment-${location}-${e.id}`}
                />
              ))}
            </View>
            <Button label={t('onboarding.equipment.remove', { location: name })} hint={t('onboarding.equipment.removeHint')} variant="secondary" onPress={() => remove(stored.id)} testID={`equipment-remove-${location}`} />
          </Card>
        );
      })}
    </View>
  );
}

/** Step 4: places and equipment. */
export function EquipmentScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const count = useProfile((s) => s.equipment.length);
  const [error, setError] = useState<string | null>(null);
  return (
    <OnboardingScaffold
      step="equipment"
      title={t('onboarding.equipment.title')}
      error={count === 0 ? error : null}
      onNext={() => (count > 0 ? router.push(nextPath('equipment')) : setError(t('onboarding.equipment.required')))}
    >
      <Paragraph muted>{t('onboarding.equipment.intro')}</Paragraph>
      <Paragraph muted>{t('onboarding.equipment.bodyweight')}</Paragraph>
      <EquipmentEditor />
    </OnboardingScaffold>
  );
}

/** Places and equipment after onboarding (Home → "Places and equipment"). */
export function EquipmentManagerScreen() {
  const { t } = useI18n();
  const theme = useTheme();
  const router = useRouter();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.lg }} testID="equipment-screen">
        <Text accessibilityRole="header" style={{ color: theme.colors.text, fontSize: theme.fontSize.headline, fontWeight: theme.fontWeight.bold }}>
          {t('equipment.title')}
        </Text>
        <EquipmentEditor />
        <Button label={t('equipment.done')} onPress={() => router.back()} testID="equipment-done" />
      </ScrollView>
    </SafeAreaView>
  );
}
