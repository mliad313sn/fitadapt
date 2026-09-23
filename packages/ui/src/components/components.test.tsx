import { createTranslator } from '@fitadapt/i18n';
import { fireEvent, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { flatStyle, renderUI } from '../test-utils';
import { Button } from './Button';
import { Card } from './Card';
import { Input } from './Input';
import { NumberDisplay } from './NumberDisplay';
import { Sheet } from './Sheet';
import { Stepper } from './Stepper';
import { splitDuration, Timer } from './Timer';
import { Toast } from './Toast';

const en = createTranslator('en');
const fr = createTranslator('fr');
const noop = () => undefined;

const modes = [
  { name: 'standard', gymMode: false, min: 48 },
  { name: 'gym mode', gymMode: true, min: 56 },
] as const;

function expectTouchTarget(element: { props: { style?: unknown } }, min: number) {
  const style = flatStyle(element);
  expect(style.minHeight).toBeGreaterThanOrEqual(min);
  expect(style.minWidth).toBeGreaterThanOrEqual(min);
}

describe.each(modes)('touch targets and labels — $name', ({ gymMode, min }) => {
  it('Button', () => {
    const onPress = jest.fn();
    renderUI(<Button label={en.t('home.gymMode.enable')} hint={en.t('home.gymMode.hint')} onPress={onPress} />, { gymMode });
    const button = screen.getByRole('button', { name: 'Turn on gym mode' });
    expect(button.props.accessibilityHint).toBe(en.t('home.gymMode.hint'));
    expectTouchTarget(button, min);
    fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('Card (pressable)', () => {
    renderUI(<Card title={en.t('home.offlineCard.title')} onPress={noop} />, { gymMode });
    expectTouchTarget(screen.getByRole('button', { name: 'Works offline' }), min);
  });

  it('Stepper', () => {
    const onChange = jest.fn();
    renderUI(<Stepper label="Reps" value={5} onChange={onChange} min={0} max={10} />, { gymMode });
    const plus = screen.getByRole('button', { name: 'Increase Reps' });
    const minus = screen.getByRole('button', { name: 'Decrease Reps' });
    expectTouchTarget(plus, min);
    expectTouchTarget(minus, min);
    fireEvent.press(plus);
    fireEvent.press(minus);
    expect(onChange.mock.calls).toEqual([[6], [4]]);
  });

  it('Timer', () => {
    renderUI(<Timer remainingMs={90_000} running={false} onToggle={noop} onReset={noop} />, { gymMode });
    expectTouchTarget(screen.getByRole('button', { name: 'Start timer' }), min);
    expectTouchTarget(screen.getByRole('button', { name: 'Reset timer' }), min);
  });

  it('Input', () => {
    renderUI(<Input label="Email" value="" onChangeText={noop} />, { gymMode });
    const input = screen.getByLabelText('Email');
    expect(flatStyle(input).minHeight).toBeGreaterThanOrEqual(min);
  });

  it('Sheet close control', () => {
    renderUI(
      <Sheet visible title={en.t('home.offlineCard.title')} onClose={noop}>
        <Text>{en.t('home.offlineCard.body')}</Text>
      </Sheet>,
      { gymMode },
    );
    expectTouchTarget(screen.getByRole('button', { name: 'Close' }), min);
  });

  it('Toast dismiss control', () => {
    renderUI(<Toast visible message={en.t('errors.generic')} onDismiss={noop} />, { gymMode });
    expectTouchTarget(screen.getByRole('button', { name: 'Dismiss notification' }), min);
  });
});

describe('Button', () => {
  it('exposes disabled state and does not fire', () => {
    const onPress = jest.fn();
    renderUI(<Button label="Go" onPress={onPress} disabled variant="danger" />);
    const button = screen.getByRole('button', { name: 'Go' });
    expect(button.props.accessibilityState).toEqual({ disabled: true });
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('keeps the label as accessible name when showing a symbol', () => {
    renderUI(<Button label="Add" display="+" variant="secondary" />, { scheme: 'dark' });
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy();
    expect(screen.getByText('+')).toBeTruthy();
  });
});

describe('Card', () => {
  it('renders a heading and a labelled container', () => {
    renderUI(
      <Card title={fr.t('home.offlineCard.title')} accessibilityLabel={fr.t('home.offlineCard.body')}>
        <Text>{fr.t('home.offlineCard.body')}</Text>
      </Card>,
      { locale: 'fr' },
    );
    expect(screen.getByRole('header', { name: 'Fonctionne hors ligne' })).toBeTruthy();
    expect(screen.getByLabelText(fr.t('home.offlineCard.body'))).toBeTruthy();
  });

  it('renders without a title', () => {
    renderUI(<Card testID="card" />);
    expect(screen.getByTestId('card')).toBeTruthy();
  });
});

describe('NumberDisplay', () => {
  it('announces label, value and unit in the current locale', () => {
    renderUI(<NumberDisplay label="Charge" value={62.5} unit="kg" />, { locale: 'fr' });
    expect(screen.getByLabelText('Charge : 62,5 kg')).toBeTruthy();
    expect(screen.getByText('Charge')).toBeTruthy();
  });

  it('works without a unit and is larger in gym mode', () => {
    renderUI(<NumberDisplay label="Reps" value={8} testID="n" />);
    expect(screen.getByLabelText('Reps: 8')).toBeTruthy();
    const standard = flatStyle(screen.getByText('8')).fontSize as number;
    screen.unmount();
    renderUI(<NumberDisplay label="Reps" value={8} />, { gymMode: true });
    expect(flatStyle(screen.getByText('8')).fontSize).toBeGreaterThan(standard);
  });
});

describe('Timer', () => {
  it('shows mm:ss and announces remaining time with plurals', () => {
    renderUI(<Timer remainingMs={61_000} running onToggle={noop} />);
    expect(screen.getByText('01:01')).toBeTruthy();
    expect(screen.getByLabelText('1 minute 1 second remaining')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pause timer' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reset timer' })).toBeNull();
  });

  it('is translated in French', () => {
    renderUI(<Timer remainingMs={125_000} running={false} onToggle={noop} />, { locale: 'fr' });
    expect(screen.getByLabelText('2 minutes 5 secondes restantes')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Démarrer le minuteur' })).toBeTruthy();
  });

  it('splits durations and clamps negatives', () => {
    expect(splitDuration(0)).toEqual({ minutes: 0, seconds: 0 });
    expect(splitDuration(-5)).toEqual({ minutes: 0, seconds: 0 });
    expect(splitDuration(59_001)).toEqual({ minutes: 1, seconds: 0 });
  });
});

describe('Stepper', () => {
  it('is adjustable for screen readers and clamps to bounds', () => {
    const onChange = jest.fn();
    renderUI(<Stepper label="Reps" value={10} onChange={onChange} min={0} max={10} step={2} />);
    const adjustable = screen.getByRole('adjustable', { name: 'Reps' });
    expect(adjustable.props.accessibilityValue).toEqual({ min: 0, max: 10, now: 10, text: 'Reps: 10' });
    expect(screen.getByRole('button', { name: 'Increase Reps' }).props.accessibilityState).toEqual({ disabled: true });
    fireEvent(adjustable, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    fireEvent(adjustable, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    fireEvent(adjustable, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    expect(onChange.mock.calls).toEqual([[10], [8]]);
  });

  it('omits unbounded limits', () => {
    renderUI(<Stepper label="Sets" value={1} onChange={noop} />);
    expect(screen.getByRole('adjustable').props.accessibilityValue).toEqual({ now: 1, text: 'Sets: 1' });
  });
});

describe('Input', () => {
  it('labels the field and announces errors', () => {
    const onChangeText = jest.fn();
    renderUI(<Input label="Code" value="" onChangeText={onChangeText} hint="6 digits" error={en.t('errors.auth.invalid_code')} />);
    const input = screen.getByLabelText('Code');
    expect(input.props.accessibilityHint).toBe(en.t('errors.auth.invalid_code'));
    fireEvent.changeText(input, '123456');
    expect(onChangeText).toHaveBeenCalledWith('123456');
    expect(screen.getByText(en.t('errors.auth.invalid_code'))).toBeTruthy();
  });

  it('uses the hint when there is no error', () => {
    renderUI(<Input label="Code" value="" onChangeText={noop} hint="6 digits" />);
    expect(screen.getByLabelText('Code').props.accessibilityHint).toBe('6 digits');
  });
});

describe('Sheet', () => {
  it('closes from its labelled close button', () => {
    const onClose = jest.fn();
    renderUI(<Sheet visible title="Title" onClose={onClose} />);
    expect(screen.getByRole('header', { name: 'Title' })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders nothing visible when hidden', () => {
    renderUI(<Sheet visible={false} title="Title" onClose={noop} />);
    expect(screen.queryByRole('header', { name: 'Title' })).toBeNull();
  });
});

describe('Toast', () => {
  it.each(['info', 'success', 'danger'] as const)('announces the message as an alert (%s)', (tone) => {
    const onDismiss = jest.fn();
    renderUI(<Toast visible tone={tone} message={fr.t('errors.generic')} onDismiss={onDismiss} />, { locale: 'fr' });
    const alert = screen.getByRole('alert', { name: fr.t('errors.generic') });
    expect(alert.props.accessibilityLiveRegion).toBe('polite');
    fireEvent.press(screen.getByRole('button', { name: 'Fermer la notification' }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('renders nothing when hidden', () => {
    renderUI(<Toast visible={false} message="x" onDismiss={noop} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
