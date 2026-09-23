import { fireEvent, screen } from '@testing-library/react-native';
import { flatStyle, renderUI } from '../test-utils';
import { Chip } from './Chip';

describe.each([
  { name: 'standard', gymMode: false, min: 48 },
  { name: 'gym mode', gymMode: true, min: 56 },
])('Chip — $name', ({ gymMode, min }) => {
  it('is a labelled toggle button with its state and a large enough touch target', () => {
    const onPress = jest.fn();
    renderUI(<Chip label="Squat" hint="Applies the filter" selected={false} onPress={onPress} />, { gymMode });
    const chip = screen.getByRole('togglebutton', { name: 'Squat' });
    expect(chip.props.accessibilityState).toEqual({ checked: false, selected: false });
    expect(chip.props.accessibilityHint).toBe('Applies the filter');
    expect(flatStyle(chip).minHeight).toBeGreaterThanOrEqual(min);
    expect(flatStyle(chip).minWidth).toBeGreaterThanOrEqual(min);
    fireEvent.press(chip);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

it('shows selection by border weight as well as colour', () => {
  renderUI(<Chip label="Hinge" selected onPress={() => undefined} />);
  const chip = screen.getByRole('togglebutton', { name: 'Hinge' });
  expect(chip.props.accessibilityState).toEqual({ checked: true, selected: true });
  expect(flatStyle(chip).borderWidth).toBe(2);
});
