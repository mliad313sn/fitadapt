import { fireEvent, screen } from '@testing-library/react-native';
import { flatStyle, renderUI } from '../test-utils';
import { BarChart, LineChart } from './Chart';

// Strings are passed in translated; plain test strings stand in for catalogue text here.
const table = { show: 'Show as a table', hide: 'Hide the table' };

describe.each([
  { name: 'standard', gymMode: false, min: 48 },
  { name: 'gym mode', gymMode: true, min: 56 },
])('charts are accessible without colour — $name', ({ gymMode, min }) => {
  it('BarChart: a text summary, values and ranges written out, a table toggle ≥ the touch target', () => {
    renderUI(
      <BarChart
        title="Hard sets this week"
        summary="Chest 8 sets, range 10 to 20, below. Back 12 sets, within."
        bars={[
          { label: 'Chest', value: 8, displayValue: '8 sets', rangeMin: 10, rangeMax: 20, rangeText: 'range 10–20', statusText: 'below the range' },
          { label: 'Back', value: 12, displayValue: '12 sets', rangeMin: 10, rangeMax: 20, rangeText: 'range 10–20', statusText: 'within the range' },
          { label: 'Core', value: 0, displayValue: '0 sets' },
        ]}
        table={table}
        testID="bars"
      />,
      { gymMode },
    );
    const plot = screen.getByTestId('bars-plot');
    expect(plot.props.accessibilityLabel).toBe('Chest 8 sets, range 10 to 20, below. Back 12 sets, within.');
    expect(plot.props.accessibilityRole).toBe('image');
    expect(screen.getByText('Chest: 8 sets · below the range')).toBeTruthy();
    expect(screen.getAllByText('range 10–20')).toHaveLength(2);
    const toggle = screen.getByRole('button', { name: 'Show as a table' });
    expect(flatStyle(toggle).minHeight).toBeGreaterThanOrEqual(min);
    expect(flatStyle(toggle).minWidth).toBeGreaterThanOrEqual(min);
    fireEvent.press(toggle);
    expect(screen.getByText('Chest — 8 sets — range 10–20 — below the range')).toBeTruthy();
    expect(screen.getByText('Core — 0 sets')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Hide the table' }));
    expect(screen.queryByTestId('bars-table')).toBeNull();
  });

  it('LineChart: values as dots, the trend as squares, a legend in words, every point in the table', () => {
    renderUI(
      <LineChart
        title="Body weight"
        summary="From 81 kg to 79.5 kg over 3 weigh-ins; trend 80.2 kg."
        points={[
          { label: '1 Sep', value: 81, displayValue: '81 kg', secondary: 81, secondaryDisplay: 'trend 81 kg' },
          { label: '8 Sep', value: 80, displayValue: '80 kg', secondary: 80.9, secondaryDisplay: 'trend 80.9 kg' },
          { label: '15 Sep', value: 79.5, displayValue: '79.5 kg', secondary: 80.2, secondaryDisplay: 'trend 80.2 kg' },
        ]}
        legend={['● logged', '■ trend']}
        table={table}
        testID="line"
      />,
      { gymMode },
    );
    expect(screen.getByTestId('line-plot').props.accessibilityLabel).toBe('From 81 kg to 79.5 kg over 3 weigh-ins; trend 80.2 kg.');
    expect(screen.getByText('● logged   ■ trend')).toBeTruthy();
    expect(screen.getByText('1 Sep — 15 Sep')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Show as a table' }));
    expect(screen.getByText('8 Sep — 80 kg — trend 80.9 kg')).toBeTruthy();
  });

  it('LineChart with one point or none, and a flat series, still renders', () => {
    renderUI(<LineChart title="t" summary="s" points={[{ label: 'a', value: 5, displayValue: '5' }]} legend={[]} table={table} testID="one" />, { gymMode });
    expect(screen.getByTestId('one-plot')).toBeTruthy();
    renderUI(<LineChart title="t" summary="s" points={[]} legend={[]} table={table} testID="none" />, { gymMode });
    expect(screen.getByTestId('none-plot')).toBeTruthy();
    renderUI(<BarChart title="t" summary="s" bars={[{ label: 'x', value: 3, displayValue: '3' }]} max={10} table={table} />, { gymMode });
    expect(screen.getAllByText('x: 3').length).toBeGreaterThan(0);
  });
});
