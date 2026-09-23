import { fireEvent, screen } from '@testing-library/react-native';
import { flatStyle, renderUI } from '../test-utils';
import { ChoiceGroup } from './ChoiceGroup';

const options = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
] as const;

describe.each([
  { name: 'standard', gymMode: false, min: 48 },
  { name: 'gym mode', gymMode: true, min: 56 },
])('ChoiceGroup — $name', ({ gymMode, min }) => {
  it('is a labelled radio group whose options name the question and have large enough targets', () => {
    const onChange = jest.fn();
    renderUI(<ChoiceGroup label="Do you train?" options={options} value={null} onChange={onChange} hint="Choose yes or no" horizontal />, { gymMode });
    expect(screen.getByLabelText('Do you train?').props.accessibilityRole).toBe('radiogroup');
    const yes = screen.getByRole('radio', { name: 'Do you train?, Yes' });
    expect(yes.props.accessibilityState).toEqual({ checked: false, selected: false });
    expect(yes.props.accessibilityHint).toBe('Choose yes or no');
    expect(flatStyle(yes).minHeight).toBeGreaterThanOrEqual(min);
    expect(flatStyle(yes).minWidth).toBeGreaterThanOrEqual(min);
    fireEvent.press(screen.getByRole('radio', { name: 'Do you train?, No' }));
    expect(onChange).toHaveBeenCalledWith('no');
  });
});

it('shows the selected option by state and border weight, not colour alone', () => {
  renderUI(<ChoiceGroup label="Goal" options={options} value="yes" onChange={() => undefined} testID="goal" />);
  const yes = screen.getByTestId('goal-yes');
  expect(yes.props.accessibilityState).toEqual({ checked: true, selected: true });
  expect(flatStyle(yes).borderWidth).toBe(2);
  expect(flatStyle(screen.getByTestId('goal-no')).borderWidth).toBe(1);
});
