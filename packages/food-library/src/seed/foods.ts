import { FOOD_TEXT } from '@fitadapt/i18n';
import type { FoodCategory, FoodItem, PortionId } from '@fitadapt/shared';

/**
 * M10 food seed (DATA-004 in docs/legal/asset-licence-register.md).
 *
 * ORIGINAL, UNVALIDATED DATA. Every energy and protein value and every
 * typical portion below is the engineer's ESTIMATE, written in-repo for the
 * company during the M10 run from general knowledge of typical composition.
 * Nothing was scraped or copied from a food composition database (licence
 * risk RSK-08; share-alike datasets such as ODbL are refused by
 * `pnpm legal:licences`). Values are rounded, per 100 g as eaten (per
 * 100 ml for drinks), for the usual home recipe; real recipes vary widely.
 * Every item is `validated: false` until seat A4 (registered dietitian)
 * checks it against a licensed composition table and a council sign-off
 * record exists (docs/governance/03 §5). Names: packages/i18n
 * (catalogues/foods.ts).
 */
export const FOOD_SEED_SOURCE_NOTE = 'Estimated by the engineer from general knowledge of typical composition (rounded, per 100 g as eaten); not copied from any database; to be verified against a licensed composition table by seat A4';
export const FOOD_SEED_VERSION = '0.1.0';

type Region = FoodItem['regions'][number];
type Row = readonly [category: FoodCategory, regions: readonly Region[], kcalPer100g: number, proteinPer100g: number, portions: string];

const G = ['generic'] as const;
const WA = ['west_africa'] as const;
const SN = ['senegal', 'west_africa'] as const;
const FR = ['france'] as const;
const NA = ['north_africa'] as const;
const CA = ['central_africa'] as const;

/** Portions: "id:grams" separated by commas; the first one is the typical (default) portion. */
const ROWS: Record<string, Row> = {
  // ---- Grains and starchy foods
  rice_white_cooked: ['grains', G, 130, 2.7, 'cup:160,plate:250,g100:100'],
  rice_brown_cooked: ['grains', G, 112, 2.6, 'cup:160,plate:250,g100:100'],
  broken_rice_cooked: ['grains', SN, 130, 2.5, 'plate:250,cup:160,g100:100'],
  pasta_cooked: ['grains', G, 158, 5.8, 'plate:250,cup:140,g100:100'],
  noodles_cooked: ['grains', G, 138, 4.5, 'bowl:250,g100:100'],
  couscous_cooked: ['grains', ['generic', 'north_africa', 'france'], 112, 3.8, 'plate:200,cup:160,g100:100'],
  millet_couscous_cooked: ['grains', SN, 120, 3.5, 'plate:250,g100:100'],
  bulgur_cooked: ['grains', G, 83, 3.1, 'cup:180,g100:100'],
  quinoa_cooked: ['grains', G, 120, 4.4, 'cup:185,g100:100'],
  oats_dry: ['grains', G, 380, 13, 'small_bowl:40,tablespoon:10,g100:100'],
  porridge_oats_milk: ['grains', G, 100, 4, 'bowl:250,g100:100'],
  millet_cooked: ['grains', WA, 119, 3.5, 'cup:170,g100:100'],
  millet_porridge: ['grains', SN, 70, 1.8, 'bowl:300,g100:100'],
  maize_porridge_stiff: ['grains', ['west_africa', 'central_africa'], 110, 2.5, 'plate:300,g100:100'],
  fonio_cooked: ['grains', WA, 115, 2, 'plate:200,cup:160,g100:100'],
  sorghum_cooked: ['grains', WA, 120, 3.5, 'cup:170,g100:100'],
  cornflakes: ['grains', G, 375, 7, 'small_bowl:30,g100:100'],
  muesli: ['grains', G, 360, 9, 'small_bowl:50,g100:100'],
  semolina_cooked: ['grains', ['generic', 'north_africa'], 90, 3, 'bowl:250,g100:100'],
  gari: ['grains', WA, 360, 1.2, 'small_bowl:60,tablespoon:12,g100:100'],

  // ---- Bread and bakery
  bread_white: ['bread_bakery', G, 265, 9, 'slice:30,g100:100'],
  bread_wholemeal: ['bread_bakery', G, 245, 10, 'slice:35,g100:100'],
  baguette: ['bread_bakery', ['france', 'senegal', 'west_africa'], 270, 9, 'piece:60,slice:20,g100:100'],
  croissant: ['bread_bakery', FR, 406, 8, 'piece:60,g100:100'],
  pain_au_chocolat: ['bread_bakery', FR, 420, 7, 'piece:70,g100:100'],
  brioche: ['bread_bakery', FR, 350, 8, 'slice:40,g100:100'],
  pita_bread: ['bread_bakery', ['generic', 'north_africa'], 275, 9, 'piece:60,g100:100'],
  tortilla_wheat: ['bread_bakery', G, 310, 8, 'piece:45,g100:100'],
  crackers: ['bread_bakery', G, 430, 9, 'piece:10,handful:30,g100:100'],
  pancake: ['bread_bakery', G, 227, 6, 'piece:60,g100:100'],
  crepe: ['bread_bakery', FR, 190, 6, 'piece:60,g100:100'],
  sponge_cake: ['sweets', G, 350, 6, 'slice:60,g100:100'],
  cookie: ['sweets', G, 470, 6, 'piece:12,g100:100'],
  msemen: ['bread_bakery', NA, 300, 7, 'piece:70,g100:100'],
  rusk: ['bread_bakery', FR, 400, 11, 'piece:10,g100:100'],

  // ---- Legumes and soy
  lentils_cooked: ['legumes', G, 116, 9, 'cup:200,plate:250,g100:100'],
  chickpeas_cooked: ['legumes', G, 164, 8.9, 'cup:160,g100:100'],
  kidney_beans_cooked: ['legumes', G, 127, 8.7, 'cup:180,g100:100'],
  white_beans_cooked: ['legumes', G, 139, 9.7, 'cup:180,g100:100'],
  black_eyed_peas_cooked: ['legumes', SN, 116, 7.7, 'cup:170,plate:250,g100:100'],
  green_peas: ['legumes', G, 81, 5.4, 'cup:150,g100:100'],
  hummus: ['legumes', ['generic', 'north_africa'], 250, 8, 'tablespoon:30,g100:100'],
  tofu: ['legumes', G, 130, 13, 'piece:100,g100:100'],
  soy_drink: ['drinks', G, 40, 3, 'glass:250,g100:100'],
  peanuts_roasted: ['nuts_seeds', SN, 590, 25, 'handful:30,g100:100'],
  peanut_butter: ['nuts_seeds', ['generic', 'west_africa'], 590, 25, 'tablespoon:16,g100:100'],
  bambara_groundnut_cooked: ['legumes', WA, 140, 8, 'cup:170,g100:100'],

  // ---- Vegetables
  tomato: ['vegetables', G, 18, 0.9, 'piece:120,g100:100'],
  onion: ['vegetables', G, 40, 1.1, 'piece:110,g100:100'],
  carrot: ['vegetables', G, 41, 0.9, 'piece:70,g100:100'],
  lettuce: ['vegetables', G, 15, 1.4, 'bowl:50,g100:100'],
  cucumber: ['vegetables', G, 15, 0.7, 'piece:150,slice:10,g100:100'],
  spinach_cooked: ['vegetables', G, 23, 3, 'bowl:150,g100:100'],
  broccoli_cooked: ['vegetables', G, 35, 2.4, 'bowl:150,g100:100'],
  cabbage_cooked: ['vegetables', G, 23, 1.3, 'bowl:150,g100:100'],
  green_beans_cooked: ['vegetables', G, 35, 1.9, 'bowl:150,g100:100'],
  courgette_cooked: ['vegetables', G, 17, 1.2, 'bowl:150,g100:100'],
  aubergine_cooked: ['vegetables', G, 35, 0.8, 'bowl:150,g100:100'],
  bitter_aubergine: ['vegetables', SN, 30, 1.2, 'piece:60,g100:100'],
  bell_pepper: ['vegetables', G, 26, 1, 'piece:120,g100:100'],
  okra_cooked: ['vegetables', WA, 22, 1.9, 'bowl:150,g100:100'],
  cassava_leaves_cooked: ['vegetables', ['central_africa', 'west_africa'], 60, 4, 'bowl:200,g100:100'],
  sweet_potato_cooked: ['vegetables', G, 86, 1.6, 'piece:150,g100:100'],
  potato_boiled: ['vegetables', G, 87, 1.9, 'piece:150,g100:100'],
  french_fries: ['vegetables', G, 312, 3.4, 'small_bowl:120,g100:100'],
  potato_mashed: ['vegetables', G, 106, 2, 'cup:210,g100:100'],
  cassava_boiled: ['vegetables', ['west_africa', 'central_africa'], 160, 1.4, 'piece:150,g100:100'],
  yam_boiled: ['vegetables', WA, 118, 1.5, 'piece:150,g100:100'],
  plantain_boiled: ['vegetables', ['west_africa', 'central_africa'], 122, 1.3, 'piece:150,g100:100'],
  plantain_fried: ['vegetables', WA, 250, 1.5, 'plate:150,g100:100'],
  mushrooms_cooked: ['vegetables', G, 28, 2.2, 'bowl:150,g100:100'],
  corn_on_the_cob: ['vegetables', G, 96, 3.4, 'piece:150,g100:100'],
  mixed_salad: ['vegetables', G, 20, 1.2, 'bowl:100,g100:100'],
  vegetable_soup: ['vegetables', G, 40, 1.5, 'bowl:300,g100:100'],
  beetroot: ['vegetables', G, 43, 1.6, 'small_bowl:80,g100:100'],
  cauliflower_cooked: ['vegetables', G, 23, 1.8, 'bowl:150,g100:100'],
  pumpkin_cooked: ['vegetables', G, 20, 0.7, 'bowl:150,g100:100'],
  leeks_cooked: ['vegetables', G, 31, 0.8, 'bowl:150,g100:100'],
  moringa_leaves_cooked: ['vegetables', SN, 60, 5, 'small_bowl:50,g100:100'],
  sorrel_leaves_cooked: ['vegetables', SN, 45, 2, 'small_bowl:80,g100:100'],

  // ---- Fruit
  apple: ['fruit', G, 52, 0.3, 'piece:150,g100:100'],
  banana: ['fruit', G, 89, 1.1, 'piece:120,g100:100'],
  orange: ['fruit', G, 47, 0.9, 'piece:140,g100:100'],
  mango: ['fruit', ['generic', 'west_africa'], 60, 0.8, 'piece:200,g100:100'],
  pineapple: ['fruit', G, 50, 0.5, 'slice:80,g100:100'],
  papaya: ['fruit', G, 43, 0.5, 'slice:150,g100:100'],
  watermelon: ['fruit', G, 30, 0.6, 'slice:250,g100:100'],
  grapes: ['fruit', G, 69, 0.7, 'handful:80,g100:100'],
  strawberries: ['fruit', G, 32, 0.7, 'bowl:150,g100:100'],
  pear: ['fruit', G, 57, 0.4, 'piece:160,g100:100'],
  peach: ['fruit', G, 39, 0.9, 'piece:150,g100:100'],
  dates_dried: ['fruit', ['generic', 'north_africa'], 282, 2.5, 'piece:8,handful:40,g100:100'],
  raisins: ['fruit', G, 299, 3, 'handful:30,g100:100'],
  avocado: ['fruit', G, 160, 2, 'piece:150,g100:100'],
  guava: ['fruit', G, 68, 2.6, 'piece:100,g100:100'],
  kiwi: ['fruit', G, 61, 1.1, 'piece:75,g100:100'],
  apricot: ['fruit', G, 48, 1.4, 'piece:40,g100:100'],
  fruit_salad: ['fruit', G, 55, 0.6, 'bowl:150,g100:100'],
  clementine: ['fruit', G, 47, 0.8, 'piece:70,g100:100'],
  baobab_pulp: ['fruit', SN, 250, 2.3, 'tablespoon:10,g100:100'],
  jujube_fruit: ['fruit', SN, 80, 1.2, 'handful:50,g100:100'],
  ditax_fruit: ['fruit', SN, 110, 1.5, 'piece:30,g100:100'],
  coconut_fresh: ['fruit', G, 354, 3.3, 'slice:45,g100:100'],
  lemon: ['fruit', G, 29, 1.1, 'piece:60,g100:100'],

  // ---- Dairy
  milk_whole: ['dairy', G, 64, 3.3, 'glass:250,cup:150,g100:100'],
  milk_semi_skimmed: ['dairy', G, 47, 3.4, 'glass:250,cup:150,g100:100'],
  milk_skimmed: ['dairy', G, 35, 3.4, 'glass:250,cup:150,g100:100'],
  milk_powder: ['dairy', ['generic', 'west_africa'], 495, 26, 'tablespoon:8,g100:100'],
  yoghurt_plain: ['dairy', G, 61, 3.5, 'pot:125,g100:100'],
  yoghurt_greek_style: ['dairy', G, 97, 9, 'pot:150,g100:100'],
  yoghurt_fruit: ['dairy', G, 95, 3.5, 'pot:125,g100:100'],
  fromage_blanc: ['dairy', FR, 75, 7.5, 'pot:100,g100:100'],
  hard_cheese: ['dairy', ['generic', 'france'], 400, 26, 'slice:25,g100:100'],
  soft_cheese: ['dairy', FR, 300, 20, 'slice:30,g100:100'],
  mozzarella: ['dairy', G, 250, 18, 'slice:30,g100:100'],
  goat_cheese: ['dairy', FR, 300, 19, 'slice:30,g100:100'],
  cottage_cheese: ['dairy', G, 98, 11, 'pot:150,g100:100'],
  cream: ['dairy', FR, 300, 2, 'tablespoon:15,g100:100'],
  curdled_milk: ['dairy', SN, 65, 3.3, 'bowl:250,glass:250,g100:100'],
  thiakry: ['dairy', SN, 130, 4, 'bowl:250,g100:100'],
  ice_cream: ['sweets', G, 207, 3.5, 'small_bowl:60,g100:100'],

  // ---- Eggs
  egg_boiled: ['eggs', G, 155, 13, 'piece:55,g100:100'],
  egg_fried: ['eggs', G, 196, 13.6, 'piece:50,g100:100'],
  omelette: ['eggs', G, 154, 10.6, 'piece:120,g100:100'],

  // ---- Meat
  chicken_breast_cooked: ['meat', G, 165, 31, 'piece:120,g100:100'],
  chicken_thigh_cooked: ['meat', G, 210, 26, 'piece:100,g100:100'],
  chicken_grilled: ['meat', ['west_africa', 'senegal', 'generic'], 215, 26, 'piece:180,g100:100'],
  beef_steak_cooked: ['meat', G, 250, 26, 'piece:150,g100:100'],
  beef_minced_cooked: ['meat', G, 250, 25, 'cup:120,g100:100'],
  lamb_cooked: ['meat', G, 280, 25, 'piece:120,g100:100'],
  goat_meat_cooked: ['meat', WA, 143, 27, 'piece:120,g100:100'],
  pork_chop_cooked: ['meat', G, 230, 27, 'piece:150,g100:100'],
  ham_cooked: ['meat', FR, 115, 18, 'slice:30,g100:100'],
  ham_air_dried: ['meat', FR, 250, 28, 'slice:20,g100:100'],
  sausage_cooked: ['meat', G, 300, 13, 'piece:50,g100:100'],
  merguez: ['meat', ['north_africa', 'france'], 300, 15, 'piece:50,g100:100'],
  turkey_cooked: ['meat', G, 150, 29, 'piece:120,g100:100'],
  liver_cooked: ['meat', G, 190, 27, 'piece:100,g100:100'],
  dibi: ['meat', SN, 250, 24, 'plate:150,g100:100'],
  suya: ['meat', WA, 220, 28, 'piece:100,g100:100'],
  kilishi: ['meat', WA, 400, 60, 'piece:30,g100:100'],

  // ---- Fish and seafood
  tuna_canned: ['fish', G, 116, 26, 'can:100,g100:100'],
  sardines_canned: ['fish', G, 210, 25, 'can:90,g100:100'],
  salmon_cooked: ['fish', G, 206, 22, 'piece:120,g100:100'],
  white_fish_cooked: ['fish', G, 105, 23, 'piece:130,g100:100'],
  mackerel_cooked: ['fish', G, 262, 24, 'piece:120,g100:100'],
  grouper_grilled: ['fish', SN, 120, 24, 'piece:200,g100:100'],
  fish_grilled_whole: ['fish', WA, 150, 22, 'piece:250,g100:100'],
  smoked_dried_fish: ['fish', SN, 300, 55, 'tablespoon:10,g100:100'],
  fermented_dried_fish: ['fish', SN, 280, 50, 'tablespoon:10,g100:100'],
  shrimp_cooked: ['fish', G, 99, 24, 'handful:80,g100:100'],
  sardinella_fried: ['fish', SN, 230, 22, 'piece:80,g100:100'],
  mussels_cooked: ['fish', FR, 170, 24, 'bowl:150,g100:100'],

  // ---- Nuts and seeds
  almonds: ['nuts_seeds', G, 580, 21, 'handful:30,g100:100'],
  cashews: ['nuts_seeds', ['generic', 'west_africa'], 553, 18, 'handful:30,g100:100'],
  walnuts: ['nuts_seeds', G, 654, 15, 'handful:30,g100:100'],
  sesame_seeds: ['nuts_seeds', G, 573, 18, 'tablespoon:9,g100:100'],
  sunflower_seeds: ['nuts_seeds', G, 584, 21, 'tablespoon:10,g100:100'],
  mixed_nuts: ['nuts_seeds', G, 600, 20, 'handful:30,g100:100'],

  // ---- Oils and spreads
  olive_oil: ['oils_fats', ['generic', 'north_africa', 'france'], 884, 0, 'tablespoon:14,teaspoon:5,g100:100'],
  vegetable_oil: ['oils_fats', G, 884, 0, 'tablespoon:14,teaspoon:5,g100:100'],
  palm_oil: ['oils_fats', ['west_africa', 'central_africa'], 884, 0, 'tablespoon:14,teaspoon:5,g100:100'],
  butter: ['oils_fats', G, 740, 0.6, 'teaspoon:5,tablespoon:14,g100:100'],
  margarine: ['oils_fats', G, 720, 0.2, 'teaspoon:5,tablespoon:14,g100:100'],
  shea_butter_cooking: ['oils_fats', WA, 884, 0, 'tablespoon:14,teaspoon:5,g100:100'],

  // ---- Drinks (per 100 ml)
  water: ['drinks', G, 0, 0, 'glass:250,g100:100'],
  coffee_black: ['drinks', G, 2, 0.3, 'cup:150,g100:100'],
  tea_unsweetened: ['drinks', G, 1, 0, 'cup:200,g100:100'],
  attaya: ['drinks', SN, 75, 0, 'glass:50,g100:100'],
  bissap_drink: ['drinks', SN, 50, 0.2, 'glass:250,g100:100'],
  bouye_drink: ['drinks', SN, 90, 1, 'glass:250,g100:100'],
  ginger_drink: ['drinks', SN, 55, 0.1, 'glass:250,g100:100'],
  orange_juice: ['drinks', G, 45, 0.7, 'glass:250,g100:100'],
  soft_drink: ['drinks', G, 42, 0, 'can:330,glass:250,g100:100'],
  soft_drink_sugar_free: ['drinks', G, 0.4, 0, 'can:330,glass:250,g100:100'],
  beer: ['drinks', G, 43, 0.5, 'glass:250,can:330,g100:100'],
  wine_red: ['drinks', ['generic', 'france'], 85, 0.1, 'glass:125,g100:100'],
  hot_chocolate: ['drinks', G, 77, 3.5, 'cup:250,g100:100'],
  fruit_smoothie: ['drinks', G, 55, 0.8, 'glass:250,g100:100'],
  cafe_touba: ['drinks', SN, 40, 0.2, 'cup:100,g100:100'],
  kinkeliba_infusion: ['drinks', SN, 1, 0, 'cup:200,g100:100'],
  mint_tea_sweet: ['drinks', NA, 40, 0, 'glass:100,g100:100'],
  coconut_water: ['drinks', G, 19, 0.7, 'glass:250,g100:100'],

  // ---- Sweet foods
  dark_chocolate: ['sweets', G, 550, 7, 'piece:10,g100:100'],
  milk_chocolate: ['sweets', G, 535, 7.6, 'piece:10,g100:100'],
  sugar: ['sweets', G, 400, 0, 'teaspoon:5,g100:100'],
  honey: ['sweets', G, 304, 0.3, 'teaspoon:7,g100:100'],
  jam: ['sweets', G, 250, 0.4, 'tablespoon:15,g100:100'],
  chocolate_spread: ['sweets', G, 540, 6, 'tablespoon:15,g100:100'],
  doughnut: ['sweets', G, 452, 5, 'piece:60,g100:100'],
  apple_tart: ['sweets', FR, 240, 3, 'slice:100,g100:100'],
  chocolate_mousse: ['sweets', FR, 225, 5, 'pot:100,g100:100'],
  baked_custard: ['sweets', FR, 120, 3.5, 'slice:100,g100:100'],
  rice_pudding: ['sweets', G, 130, 3.5, 'bowl:150,g100:100'],
  ngalakh: ['sweets', SN, 180, 5, 'bowl:250,g100:100'],
  sombi: ['sweets', SN, 150, 2.5, 'bowl:250,g100:100'],

  // ---- Snacks
  accara: ['snacks', SN, 250, 9, 'piece:25,handful:100,g100:100'],
  fataya: ['snacks', SN, 300, 9, 'piece:70,g100:100'],
  pastels: ['snacks', SN, 290, 9, 'piece:30,g100:100'],
  puff_puff: ['snacks', WA, 330, 6, 'piece:30,g100:100'],
  cereal_bar: ['snacks', G, 400, 6, 'piece:25,g100:100'],
  crisps: ['snacks', G, 536, 6.6, 'handful:30,g100:100'],
  popcorn: ['snacks', G, 380, 11, 'bowl:25,g100:100'],
  roasted_corn: ['snacks', WA, 180, 5, 'piece:150,g100:100'],
  boiled_peanuts: ['snacks', WA, 320, 14, 'handful:50,g100:100'],
  chin_chin: ['snacks', WA, 480, 8, 'handful:40,g100:100'],
  samosa: ['snacks', G, 260, 6, 'piece:50,g100:100'],

  // ---- Sauces and seasonings
  ketchup: ['sauces', G, 110, 1.2, 'tablespoon:15,g100:100'],
  mayonnaise: ['sauces', G, 680, 1, 'tablespoon:15,g100:100'],
  vinaigrette: ['sauces', ['generic', 'france'], 450, 0, 'tablespoon:15,g100:100'],
  tomato_sauce: ['sauces', G, 50, 1.5, 'ladle:100,tablespoon:15,g100:100'],
  onion_sauce: ['sauces', SN, 110, 1.2, 'ladle:100,g100:100'],
  peanut_sauce: ['sauces', WA, 190, 7, 'ladle:100,g100:100'],
  chilli_sauce: ['sauces', G, 60, 1.5, 'teaspoon:5,g100:100'],

  // ---- Dishes: Senegal and West Africa (per 100 g of the served plate, rice included)
  thieboudienne: ['dishes', SN, 160, 8, 'plate:400,g100:100'],
  thiebou_yapp: ['dishes', SN, 175, 9, 'plate:400,g100:100'],
  yassa_chicken: ['dishes', SN, 150, 10, 'plate:400,g100:100'],
  yassa_fish: ['dishes', SN, 140, 10, 'plate:400,g100:100'],
  mafe: ['dishes', SN, 170, 8, 'plate:400,g100:100'],
  domoda: ['dishes', SN, 150, 8, 'plate:350,g100:100'],
  soupou_kandja: ['dishes', SN, 150, 8, 'plate:400,g100:100'],
  ceere_sauce: ['dishes', SN, 150, 6, 'plate:400,g100:100'],
  lakh: ['dishes', SN, 110, 3.5, 'bowl:300,g100:100'],
  caldou: ['dishes', SN, 130, 9, 'plate:400,g100:100'],
  mbakhal: ['dishes', SN, 170, 7, 'plate:400,g100:100'],
  ndambe: ['dishes', SN, 220, 8, 'sandwich:250,g100:100'],
  thiou_poulet: ['dishes', SN, 150, 9, 'plate:400,g100:100'],
  jollof_rice: ['dishes', WA, 160, 4, 'plate:350,g100:100'],
  attieke: ['dishes', WA, 170, 1.2, 'plate:250,g100:100'],
  garba: ['dishes', WA, 250, 10, 'plate:400,g100:100'],
  kedjenou: ['dishes', WA, 120, 12, 'plate:350,g100:100'],
  palm_nut_soup: ['dishes', ['west_africa', 'central_africa'], 150, 8, 'plate:350,ladle:150,g100:100'],
  fufu: ['dishes', ['west_africa', 'central_africa'], 160, 1, 'bowl:250,g100:100'],
  riz_gras: ['dishes', WA, 180, 6, 'plate:400,g100:100'],
  to_sauce_gombo: ['dishes', WA, 100, 3, 'plate:400,g100:100'],
  alloco_poisson: ['dishes', WA, 200, 10, 'plate:350,g100:100'],

  // ---- Dishes: Central Africa
  ndole: ['dishes', CA, 180, 10, 'plate:350,g100:100'],
  poulet_dg: ['dishes', CA, 190, 12, 'plate:400,g100:100'],
  moambe: ['dishes', CA, 180, 12, 'plate:350,g100:100'],
  pondu: ['dishes', CA, 110, 4, 'plate:300,g100:100'],
  chikwangue: ['dishes', CA, 160, 1, 'piece:200,g100:100'],

  // ---- Dishes: North Africa
  couscous_royal: ['dishes', ['north_africa', 'france'], 160, 9, 'plate:450,g100:100'],
  chicken_tagine: ['dishes', NA, 130, 11, 'plate:350,g100:100'],
  harira: ['dishes', NA, 60, 3, 'bowl:300,g100:100'],
  shakshuka: ['dishes', NA, 110, 6, 'plate:250,g100:100'],
  lentil_soup: ['dishes', ['north_africa', 'generic'], 70, 4.5, 'bowl:300,g100:100'],

  // ---- Dishes: France
  bouillabaisse: ['dishes', FR, 90, 9, 'bowl:400,g100:100'],
  pot_au_feu: ['dishes', FR, 110, 10, 'plate:400,g100:100'],
  boeuf_bourguignon: ['dishes', FR, 160, 15, 'plate:350,g100:100'],
  blanquette_de_veau: ['dishes', FR, 140, 12, 'plate:350,g100:100'],
  ratatouille: ['dishes', FR, 60, 1.3, 'plate:250,g100:100'],
  quiche_lorraine: ['dishes', FR, 280, 10, 'slice:150,g100:100'],
  croque_monsieur: ['dishes', FR, 260, 14, 'sandwich:150,g100:100'],
  gratin_dauphinois: ['dishes', FR, 150, 4, 'plate:250,g100:100'],
  salade_nicoise: ['dishes', FR, 120, 8, 'plate:300,g100:100'],
  cassoulet: ['dishes', FR, 150, 9, 'plate:350,g100:100'],
  jambon_beurre: ['dishes', FR, 270, 12, 'sandwich:200,g100:100'],
  hachis_parmentier: ['dishes', FR, 140, 8, 'plate:300,g100:100'],

  // ---- Dishes: widely eaten
  pizza_margherita: ['dishes', G, 250, 11, 'slice:100,g100:100'],
  hamburger: ['dishes', G, 250, 13, 'sandwich:200,g100:100'],
  lasagne: ['dishes', G, 135, 8, 'plate:300,g100:100'],
  spaghetti_bolognese: ['dishes', G, 130, 7, 'plate:350,g100:100'],
  fried_rice: ['dishes', G, 165, 5, 'plate:300,g100:100'],
  chicken_curry_rice: ['dishes', G, 150, 9, 'plate:400,g100:100'],
  kebab_sandwich: ['dishes', ['generic', 'france'], 230, 12, 'sandwich:300,g100:100'],
  chicken_sandwich: ['dishes', G, 230, 13, 'sandwich:200,g100:100'],
  sushi: ['dishes', G, 150, 6, 'piece:30,g100:100'],
  beef_stew: ['dishes', G, 150, 15, 'plate:300,g100:100'],
  chicken_soup: ['dishes', G, 50, 4, 'bowl:300,g100:100'],
  bean_stew: ['dishes', G, 110, 6, 'plate:300,g100:100'],
};

function portionsOf(spec: string): { id: PortionId; grams: number }[] {
  return spec.split(',').map((p) => {
    const [id, grams] = p.split(':') as [PortionId, string];
    return { id, grams: Number(grams) };
  });
}

/** The seed as FoodItems: every one an estimate, licence Owned (original content), validated: false. */
export const FOOD_SEED: readonly FoodItem[] = Object.freeze(
  Object.entries(ROWS).map(([id, [category, regions, kcal, protein, portions]]): FoodItem => {
    const list = portionsOf(portions);
    return {
      id,
      category,
      regions: [...regions],
      hasLocalName: 'local' in (FOOD_TEXT as Record<string, object>)[id]!,
      energyKcalPer100g: kcal,
      proteinGPer100g: protein,
      portions: list,
      defaultPortion: list[0]!.id,
      source: { kind: 'estimate', note: FOOD_SEED_SOURCE_NOTE },
      licence: 'Owned',
      validated: false,
    };
  }),
);
