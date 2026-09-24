import { foodPortionEstimate, intakeEstimate, type IntakeEstimate } from '@fitadapt/engine';
import { FoodItemSchema, type FoodCategory, type FoodItem, type IntakeEntry } from '@fitadapt/shared';
import { FOOD_SEED } from './seed/foods.js';

export { FOOD_SEED, FOOD_SEED_SOURCE_NOTE, FOOD_SEED_VERSION } from './seed/foods.js';

/**
 * M10 food library: the original seed of generic foods and regional dishes
 * (DATA-004), search that works offline (bundled with the app, no network),
 * and the engine's portion estimates bound to the seed. Every item is an
 * estimate (`validated: false`, seat A4).
 */
const BY_ID: ReadonlyMap<string, FoodItem> = new Map(FOOD_SEED.map((f) => [f.id, f]));

export function foodById(id: string): FoodItem | undefined {
  return BY_ID.get(id);
}

/** Lower-case, accents removed, punctuation folded to spaces: "Thiéboudienne" → "thieboudienne". */
export function normaliseFoodText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ñ/g, 'n')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface FoodSearch {
  readonly text?: string;
  readonly category?: FoodCategory;
  readonly region?: FoodItem['regions'][number];
  readonly limit?: number;
}

export interface FoodNames {
  /** The name in the reader's language. */
  readonly name: (food: FoodItem) => string;
  /** The local name, if the food has one. */
  readonly local: (food: FoodItem) => string | null;
}

/**
 * In-memory search over the seed (offline). Every word must appear in the
 * reader's name, the local name, or the name in the other language; names
 * that start with the words come first, then alphabetical order.
 */
export function searchFoods(filter: FoodSearch, names: FoodNames, other?: FoodNames, foods: readonly FoodItem[] = FOOD_SEED): FoodItem[] {
  const words = filter.text ? normaliseFoodText(filter.text).split(' ').filter(Boolean) : [];
  const scored = foods
    .filter((f) => !filter.category || f.category === filter.category)
    .filter((f) => !filter.region || f.regions.includes(filter.region))
    .map((f) => {
      const name = names.name(f);
      const haystack = normaliseFoodText([name, names.local(f) ?? '', other?.name(f) ?? ''].join(' '));
      const starts = words.length > 0 && normaliseFoodText(name).startsWith(words[0]!);
      return { f, name, match: words.every((w) => haystack.includes(w)), starts };
    })
    .filter((x) => x.match)
    .sort((a, b) => Number(b.starts) - Number(a.starts) || a.name.localeCompare(b.name) || (a.f.id < b.f.id ? -1 : 1))
    .map((x) => x.f);
  return filter.limit === undefined ? scored : scored.slice(0, filter.limit);
}

/** The engine's estimate of an intake entry, with seed foods. */
export function estimateIntake(entry: IntakeEntry): IntakeEstimate {
  return intakeEstimate(entry, foodById);
}

/** The engine's estimate of a portion of a seed food. */
export function estimateFood(foodId: string, portionId: string, count: number): IntakeEstimate {
  const food = foodById(foodId);
  if (!food) throw new RangeError(`unknown food ${foodId}`);
  return foodPortionEstimate(food, portionId, count);
}

/** Schema problems of the seed (empty = valid): used by the tests and the release checks. */
export function seedProblems(foods: readonly FoodItem[] = FOOD_SEED): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const f of foods) {
    const parsed = FoodItemSchema.safeParse(f);
    if (!parsed.success) problems.push(`${f.id}: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    if (seen.has(f.id)) problems.push(`${f.id}: duplicate id`);
    seen.add(f.id);
  }
  return problems;
}
