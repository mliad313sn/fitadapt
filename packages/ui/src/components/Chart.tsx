import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Accessible charts drawn with plain views (no chart library, no bundled
 * assets, works offline). Accessibility rules:
 * - every chart has a text summary read by screen readers (`summary`);
 * - values are written next to the marks: nothing is conveyed by colour
 *   alone (a range is shown as a bracket with its bounds in text, the trend
 *   and the raw values have different shapes);
 * - a "show as table" button (≥ 48 dp, 56 dp in gym mode) lists every value.
 * All strings are passed in already translated (packages/i18n).
 */

export interface BarDatum {
  /** Row label (already translated). */
  readonly label: string;
  readonly value: number;
  /** The value as shown (already formatted and translated, e.g. "12 sets"). */
  readonly displayValue: string;
  /** Optional goal range, drawn as a bracket and written out in `rangeText`. */
  readonly rangeMin?: number;
  readonly rangeMax?: number;
  readonly rangeText?: string;
  /** Written status (e.g. "within the range"): never colour alone. */
  readonly statusText?: string;
}

export interface ChartTableLabels {
  readonly show: string;
  readonly hide: string;
}

export interface BarChartProps {
  readonly title: string;
  readonly summary: string;
  readonly bars: readonly BarDatum[];
  /** Upper end of the scale (defaults to the largest value or range bound). */
  readonly max?: number;
  readonly table: ChartTableLabels;
  readonly testID?: string;
}

function TableToggle({ labels, open, onToggle, testID }: { labels: ChartTableLabels; open: boolean; onToggle: () => void; testID?: string }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={open ? labels.hide : labels.show}
      accessibilityState={{ expanded: open }}
      onPress={onToggle}
      testID={testID}
      style={{ minHeight: theme.minTouchTarget, minWidth: theme.minTouchTarget, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: theme.spacing.md, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border }}
    >
      <Text style={{ color: theme.colors.text, fontSize: theme.fontSize.label, fontWeight: theme.fontWeight.medium }}>{open ? labels.hide : labels.show}</Text>
    </Pressable>
  );
}

export function BarChart({ title, summary, bars, max, table, testID }: BarChartProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const scale = Math.max(1e-9, max ?? Math.max(1, ...bars.map((b) => Math.max(b.value, b.rangeMax ?? 0))));
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / scale) * 100))}%` as const;
  const text = { color: theme.colors.text, fontSize: theme.fontSize.label } as const;
  const muted = { color: theme.colors.textMuted, fontSize: theme.fontSize.caption } as const;
  return (
    <View style={{ gap: theme.spacing.sm }} testID={testID}>
      <Text accessibilityRole="header" style={{ ...text, fontWeight: theme.fontWeight.bold }}>
        {title}
      </Text>
      <View accessible accessibilityRole="image" accessibilityLabel={summary} style={{ gap: theme.spacing.sm }} testID={testID ? `${testID}-plot` : undefined}>
        {bars.map((b) => (
          <View key={b.label} style={{ gap: theme.spacing.xs }}>
            <Text style={text}>
              {b.label}: {b.displayValue}
              {b.statusText ? ` · ${b.statusText}` : ''}
            </Text>
            <View style={{ height: 16, backgroundColor: theme.colors.secondary, borderRadius: theme.radius.sm, overflow: 'hidden' }}>
              {b.rangeMin !== undefined && b.rangeMax !== undefined ? (
                <View style={{ position: 'absolute', left: pct(b.rangeMin), width: pct(b.rangeMax - b.rangeMin), top: 0, bottom: 0, borderWidth: 2, borderColor: theme.colors.text, borderStyle: 'dashed' }} />
              ) : null}
              <View style={{ width: pct(b.value), height: 8, marginTop: 4, backgroundColor: theme.colors.primary }} />
            </View>
            {b.rangeText ? <Text style={muted}>{b.rangeText}</Text> : null}
          </View>
        ))}
      </View>
      <TableToggle labels={table} open={open} onToggle={() => setOpen((o) => !o)} testID={testID ? `${testID}-table-toggle` : undefined} />
      {open ? (
        <View testID={testID ? `${testID}-table` : undefined}>
          {bars.map((b) => (
            <Text key={b.label} style={text}>
              {[b.label, b.displayValue, b.rangeText, b.statusText].filter(Boolean).join(' — ')}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export interface LinePoint {
  /** Label of the point in the table (already translated, e.g. a formatted date). */
  readonly label: string;
  readonly value: number;
  /** The value as shown (already formatted). */
  readonly displayValue: string;
  /** Optional second series at the same point (e.g. the smoothed trend), drawn with another shape. */
  readonly secondary?: number;
  readonly secondaryDisplay?: string;
}

export interface LineChartProps {
  readonly title: string;
  readonly summary: string;
  readonly points: readonly LinePoint[];
  /** Legend text for each shape (already translated), e.g. "● logged", "■ trend". */
  readonly legend: readonly string[];
  readonly table: ChartTableLabels;
  readonly height?: number;
  readonly testID?: string;
}

/**
 * Points over time: the values as round dots, the optional second series
 * (trend) as squares; the axis bounds are written at the side.
 */
export function LineChart({ title, summary, points, legend, table, height = 120, testID }: LineChartProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const values = points.flatMap((p) => (p.secondary === undefined ? [p.value] : [p.value, p.secondary]));
  const lo = values.length > 0 ? Math.min(...values) : 0;
  const hi = values.length > 0 ? Math.max(...values) : 1;
  const span = hi - lo || 1;
  const y = (v: number) => ((v - lo) / span) * (height - 12);
  const x = (i: number) => (points.length <= 1 ? 50 : (i / (points.length - 1)) * 100);
  const text = { color: theme.colors.text, fontSize: theme.fontSize.label } as const;
  const muted = { color: theme.colors.textMuted, fontSize: theme.fontSize.caption } as const;
  const first = points[0];
  const last = points.at(-1);
  return (
    <View style={{ gap: theme.spacing.sm }} testID={testID}>
      <Text accessibilityRole="header" style={{ ...text, fontWeight: theme.fontWeight.bold }}>
        {title}
      </Text>
      <View accessible accessibilityRole="image" accessibilityLabel={summary} testID={testID ? `${testID}-plot` : undefined}>
        <View style={{ height, borderLeftWidth: 1, borderBottomWidth: 1, borderColor: theme.colors.border }}>
          {points.map((p, i) => (
            <View key={`v${i}`} style={{ position: 'absolute', left: `${x(i)}%`, bottom: y(p.value), width: 8, height: 8, marginLeft: -4, borderRadius: 4, backgroundColor: theme.colors.primary }} />
          ))}
          {points.map((p, i) =>
            p.secondary === undefined ? null : (
              <View key={`s${i}`} style={{ position: 'absolute', left: `${x(i)}%`, bottom: y(p.secondary), width: 6, height: 6, marginLeft: -3, borderWidth: 1, borderColor: theme.colors.text, backgroundColor: theme.colors.background }} />
            ),
          )}
        </View>
        {first && last ? (
          <Text style={muted}>
            {first.label} — {last.label}
          </Text>
        ) : null}
        <Text style={muted}>{legend.join('   ')}</Text>
      </View>
      <TableToggle labels={table} open={open} onToggle={() => setOpen((o) => !o)} testID={testID ? `${testID}-table-toggle` : undefined} />
      {open ? (
        <View testID={testID ? `${testID}-table` : undefined}>
          {points.map((p, i) => (
            <Text key={`${p.label}-${i}`} style={text}>
              {[p.label, p.displayValue, p.secondaryDisplay].filter(Boolean).join(' — ')}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
