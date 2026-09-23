import { contrastRatio, relativeLuminance } from './contrast';
import { createTheme } from './ThemeProvider';
import { colors, contrastRequirement, touchTarget, type ColorScheme } from './tokens';

const schemes: ColorScheme[] = ['light', 'dark'];

describe('design tokens', () => {
  it('computes WCAG contrast correctly', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
    expect(() => relativeLuminance('red')).toThrow(/#RRGGBB/);
  });

  describe.each(schemes)('%s theme meets WCAG 2.2 AA', (scheme) => {
    const c = colors[scheme];
    const textPairs: [string, string, string][] = [
      ['text/background', c.text, c.background],
      ['text/surface', c.text, c.surface],
      ['textMuted/background', c.textMuted, c.background],
      ['textMuted/surface', c.textMuted, c.surface],
      ['onPrimary/primary', c.onPrimary, c.primary],
      ['onSecondary/secondary', c.onSecondary, c.secondary],
      ['onDanger/danger', c.onDanger, c.danger],
      ['onSuccess/success', c.onSuccess, c.success],
      ['danger/background', c.danger, c.background],
      ['background/text (info toast)', c.background, c.text],
    ];
    it.each(textPairs)('%s ≥ 4.5:1', (_name, fg, bg) => {
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(contrastRequirement.text);
    });
    it.each([
      ['border/background', c.border, c.background],
      ['focus/background', c.focus, c.background],
      ['primary/background', c.primary, c.background],
    ])('%s ≥ 3:1 (non-text)', (_name, fg, bg) => {
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(contrastRequirement.nonText);
    });
  });

  it('touch targets are 48 dp standard and 56 dp in gym mode', () => {
    expect(touchTarget).toEqual({ standard: 48, gym: 56 });
    expect(createTheme('light', false).minTouchTarget).toBe(48);
    expect(createTheme('dark', true).minTouchTarget).toBe(56);
    expect(createTheme('light', true).fontSize.display).toBeGreaterThan(createTheme('light', false).fontSize.display);
  });
});
