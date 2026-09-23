import { fireEvent, screen } from '@testing-library/react-native';
import { flatStyle, renderUI } from '../test-utils';
import { Toggle } from './Toggle';

describe.each([
  { name: 'standard', gymMode: false, min: 48 },
  { name: 'gym mode', gymMode: true, min: 56 },
])('Toggle — $name', ({ gymMode, min }) => {
  it('is a labelled switch with a large enough touch target', () => {
    const onValueChange = jest.fn();
    renderUI(<Toggle label="Usage statistics" description="Counts only" hint="Turns it on or off" value={false} onValueChange={onValueChange} />, { gymMode });
    const toggle = screen.getByRole('switch', { name: 'Usage statistics' });
    expect(toggle.props.accessibilityState).toEqual({ checked: false, disabled: false });
    expect(toggle.props.accessibilityHint).toBe('Turns it on or off');
    expect(flatStyle(toggle).minHeight).toBeGreaterThanOrEqual(min);
    expect(flatStyle(toggle).minWidth).toBeGreaterThanOrEqual(min);
    expect(screen.getByText('Off')).toBeTruthy();
    expect(screen.getByText('Counts only')).toBeTruthy();
    fireEvent.press(toggle);
    expect(onValueChange).toHaveBeenCalledWith(true);
  });
});

describe('Toggle states', () => {
  it('writes the state out in the current language (not colour alone)', () => {
    const onValueChange = jest.fn();
    renderUI(<Toggle label="Données de santé" value onValueChange={onValueChange} />, { locale: 'fr' });
    const toggle = screen.getByRole('switch', { name: 'Données de santé' });
    expect(toggle.props.accessibilityState).toEqual({ checked: true, disabled: false });
    expect(screen.getByText('Activé')).toBeTruthy();
    fireEvent.press(toggle);
    expect(onValueChange).toHaveBeenCalledWith(false);
  });

  it('does not fire when disabled', () => {
    const onValueChange = jest.fn();
    renderUI(<Toggle label="AI coach" value={false} disabled onValueChange={onValueChange} />);
    const toggle = screen.getByRole('switch', { name: 'AI coach' });
    expect(toggle.props.accessibilityState).toEqual({ checked: false, disabled: true });
    fireEvent.press(toggle);
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
