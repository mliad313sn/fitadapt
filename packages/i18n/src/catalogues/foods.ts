/**
 * M10 food names (FR/EN) and, where one is commonly used, a local name
 * (Wolof, or the name used across the region), returned by `foodLocalName`. ORIGINAL CONTENT written for
 * the company during the M10 run; no name list was copied from a food
 * database. Composition values live in packages/food-library (all
 * `validated: false`). Local names are the engineer's spelling of names in
 * common use; a native editor must check them (see docs/status/M10.md).
 * Names avoid judgement: no food is "good", "bad", "junk" or a "treat".
 */
export interface FoodText {
  readonly en: string;
  readonly fr: string;
  /** A local name, the same in both languages. */
  readonly local?: string;
}

export const FOOD_TEXT = {
  // ---- Grains and starchy foods
  rice_white_cooked: { en: 'White rice, cooked', fr: 'Riz blanc cuit' },
  rice_brown_cooked: { en: 'Brown rice, cooked', fr: 'Riz complet cuit' },
  broken_rice_cooked: { en: 'Broken rice, cooked', fr: 'Riz brisé cuit', local: 'Ceeb' },
  pasta_cooked: { en: 'Pasta, cooked', fr: 'Pâtes cuites' },
  noodles_cooked: { en: 'Noodles, cooked', fr: 'Nouilles cuites' },
  couscous_cooked: { en: 'Wheat couscous, cooked', fr: 'Couscous de blé cuit' },
  millet_couscous_cooked: { en: 'Millet couscous, cooked', fr: 'Couscous de mil cuit', local: 'Cere' },
  bulgur_cooked: { en: 'Bulgur, cooked', fr: 'Boulgour cuit' },
  quinoa_cooked: { en: 'Quinoa, cooked', fr: 'Quinoa cuit' },
  oats_dry: { en: 'Rolled oats', fr: 'Flocons d’avoine' },
  porridge_oats_milk: { en: 'Oat porridge made with milk', fr: 'Porridge d’avoine au lait' },
  millet_cooked: { en: 'Millet, cooked', fr: 'Mil cuit' },
  millet_porridge: { en: 'Millet porridge', fr: 'Bouillie de mil', local: 'Fondé' },
  maize_porridge_stiff: { en: 'Stiff maize porridge', fr: 'Pâte de maïs' },
  fonio_cooked: { en: 'Fonio, cooked', fr: 'Fonio cuit' },
  sorghum_cooked: { en: 'Sorghum, cooked', fr: 'Sorgho cuit' },
  cornflakes: { en: 'Cornflakes', fr: 'Pétales de maïs' },
  muesli: { en: 'Muesli (oat and fruit mix)', fr: 'Muesli' },
  semolina_cooked: { en: 'Semolina, cooked', fr: 'Semoule cuite' },
  gari: { en: 'Gari (cassava granules)', fr: 'Gari (semoule de manioc)', local: 'Gari' },

  // ---- Bread and bakery
  bread_white: { en: 'White bread', fr: 'Pain blanc' },
  bread_wholemeal: { en: 'Wholemeal bread', fr: 'Pain complet' },
  baguette: { en: 'Baguette (French bread)', fr: 'Baguette' },
  croissant: { en: 'Butter croissant', fr: 'Croissant' },
  pain_au_chocolat: { en: 'Chocolate pastry', fr: 'Pain au chocolat' },
  brioche: { en: 'Brioche bread', fr: 'Brioche' },
  pita_bread: { en: 'Pitta bread', fr: 'Pain pita' },
  tortilla_wheat: { en: 'Wheat tortilla', fr: 'Tortilla de blé' },
  crackers: { en: 'Crackers', fr: 'Crackers salés' },
  pancake: { en: 'Pancake', fr: 'Pancake (petite crêpe épaisse)' },
  crepe: { en: 'Thin pancake (crêpe)', fr: 'Crêpe' },
  sponge_cake: { en: 'Sponge cake', fr: 'Gâteau moelleux' },
  cookie: { en: 'Biscuit', fr: 'Biscuit sec' },
  msemen: { en: 'Msemen (layered flatbread)', fr: 'Msemen (crêpe feuilletée)', local: 'Msemen' },
  rusk: { en: 'Toasted bread slices', fr: 'Biscottes' },

  // ---- Legumes and soy
  lentils_cooked: { en: 'Lentils, cooked', fr: 'Lentilles cuites' },
  chickpeas_cooked: { en: 'Chickpeas, cooked', fr: 'Pois chiches cuits' },
  kidney_beans_cooked: { en: 'Kidney beans, cooked', fr: 'Haricots rouges cuits' },
  white_beans_cooked: { en: 'White beans, cooked', fr: 'Haricots blancs cuits' },
  black_eyed_peas_cooked: { en: 'Black-eyed peas, cooked', fr: 'Niébé cuit', local: 'Ñebbe' },
  green_peas: { en: 'Green peas', fr: 'Petits pois' },
  hummus: { en: 'Hummus', fr: 'Houmous' },
  tofu: { en: 'Tofu (bean curd)', fr: 'Tofu' },
  soy_drink: { en: 'Soy drink', fr: 'Boisson au soja' },
  peanuts_roasted: { en: 'Roasted peanuts', fr: 'Arachides grillées', local: 'Gerte' },
  peanut_butter: { en: 'Peanut butter', fr: 'Pâte d’arachide' },
  bambara_groundnut_cooked: { en: 'Bambara groundnut, cooked', fr: 'Voandzou cuit' },

  // ---- Vegetables
  tomato: { en: 'Tomato', fr: 'Tomate' },
  onion: { en: 'Onion', fr: 'Oignon' },
  carrot: { en: 'Carrot', fr: 'Carotte' },
  lettuce: { en: 'Lettuce', fr: 'Laitue' },
  cucumber: { en: 'Cucumber', fr: 'Concombre' },
  spinach_cooked: { en: 'Spinach, cooked', fr: 'Épinards cuits' },
  broccoli_cooked: { en: 'Broccoli, cooked', fr: 'Brocoli cuit' },
  cabbage_cooked: { en: 'Cabbage, cooked', fr: 'Chou cuit' },
  green_beans_cooked: { en: 'Green beans, cooked', fr: 'Haricots verts cuits' },
  courgette_cooked: { en: 'Courgette, cooked', fr: 'Courgette cuite' },
  aubergine_cooked: { en: 'Aubergine, cooked', fr: 'Aubergine cuite' },
  bitter_aubergine: { en: 'Bitter garden egg', fr: 'Diakhatou (aubergine amère)', local: 'Jaxatu' },
  bell_pepper: { en: 'Bell pepper', fr: 'Poivron' },
  okra_cooked: { en: 'Okra, cooked', fr: 'Gombo cuit', local: 'Kànja' },
  cassava_leaves_cooked: { en: 'Cassava leaves, cooked', fr: 'Feuilles de manioc cuites', local: 'Saka-saka' },
  sweet_potato_cooked: { en: 'Sweet potato, cooked', fr: 'Patate douce cuite' },
  potato_boiled: { en: 'Potato, boiled', fr: 'Pomme de terre à l’eau' },
  french_fries: { en: 'French fries', fr: 'Frites' },
  potato_mashed: { en: 'Mashed potato', fr: 'Purée de pommes de terre' },
  cassava_boiled: { en: 'Cassava, boiled', fr: 'Manioc bouilli' },
  yam_boiled: { en: 'Yam, boiled', fr: 'Igname bouillie' },
  plantain_boiled: { en: 'Plantain, boiled', fr: 'Banane plantain bouillie' },
  plantain_fried: { en: 'Fried plantain', fr: 'Banane plantain frite', local: 'Alloco' },
  mushrooms_cooked: { en: 'Mushrooms, cooked', fr: 'Champignons cuits' },
  corn_on_the_cob: { en: 'Corn on the cob', fr: 'Épi de maïs' },
  mixed_salad: { en: 'Mixed green salad', fr: 'Salade verte composée' },
  vegetable_soup: { en: 'Vegetable soup', fr: 'Soupe de légumes' },
  beetroot: { en: 'Beetroot', fr: 'Betterave' },
  cauliflower_cooked: { en: 'Cauliflower, cooked', fr: 'Chou-fleur cuit' },
  pumpkin_cooked: { en: 'Pumpkin, cooked', fr: 'Potiron cuit' },
  leeks_cooked: { en: 'Leeks, cooked', fr: 'Poireaux cuits' },
  moringa_leaves_cooked: { en: 'Moringa leaves, cooked', fr: 'Feuilles de moringa cuites', local: 'Nébéday' },
  sorrel_leaves_cooked: { en: 'Roselle leaves, cooked', fr: 'Feuilles d’oseille de Guinée cuites', local: 'Bissap' },

  // ---- Fruit
  apple: { en: 'Apple', fr: 'Pomme' },
  banana: { en: 'Banana', fr: 'Banane' },
  orange: { en: 'Sweet orange', fr: 'Orange' },
  mango: { en: 'Mango', fr: 'Mangue' },
  pineapple: { en: 'Pineapple', fr: 'Ananas' },
  papaya: { en: 'Papaya', fr: 'Papaye' },
  watermelon: { en: 'Watermelon', fr: 'Pastèque' },
  grapes: { en: 'Grapes', fr: 'Raisin' },
  strawberries: { en: 'Strawberries', fr: 'Fraises' },
  pear: { en: 'Pear', fr: 'Poire' },
  peach: { en: 'Peach', fr: 'Pêche' },
  dates_dried: { en: 'Dates', fr: 'Dattes' },
  raisins: { en: 'Raisins', fr: 'Raisins secs' },
  avocado: { en: 'Avocado', fr: 'Avocat' },
  guava: { en: 'Guava', fr: 'Goyave' },
  kiwi: { en: 'Kiwi fruit', fr: 'Kiwi' },
  apricot: { en: 'Apricot', fr: 'Abricot' },
  fruit_salad: { en: 'Fruit salad', fr: 'Salade de fruits' },
  clementine: { en: 'Clementine', fr: 'Clémentine' },
  baobab_pulp: { en: 'Baobab fruit pulp', fr: 'Pulpe de pain de singe', local: 'Bouye' },
  jujube_fruit: { en: 'Jujube fruit', fr: 'Jujube', local: 'Sidem' },
  ditax_fruit: { en: 'Ditax fruit', fr: 'Ditakh', local: 'Ditax' },
  coconut_fresh: { en: 'Fresh coconut', fr: 'Noix de coco fraîche' },
  lemon: { en: 'Lemon', fr: 'Citron' },

  // ---- Dairy
  milk_whole: { en: 'Whole milk', fr: 'Lait entier' },
  milk_semi_skimmed: { en: 'Semi-skimmed milk', fr: 'Lait demi-écrémé' },
  milk_skimmed: { en: 'Skimmed milk', fr: 'Lait écrémé' },
  milk_powder: { en: 'Milk powder', fr: 'Lait en poudre' },
  yoghurt_plain: { en: 'Plain yoghurt', fr: 'Yaourt nature' },
  yoghurt_greek_style: { en: 'Greek-style yoghurt', fr: 'Yaourt à la grecque' },
  yoghurt_fruit: { en: 'Fruit yoghurt', fr: 'Yaourt aux fruits' },
  fromage_blanc: { en: 'Fromage frais (quark)', fr: 'Fromage blanc' },
  hard_cheese: { en: 'Hard cheese', fr: 'Fromage à pâte pressée' },
  soft_cheese: { en: 'Soft ripened cheese', fr: 'Fromage à pâte molle' },
  mozzarella: { en: 'Mozzarella cheese', fr: 'Mozzarella' },
  goat_cheese: { en: 'Goat’s cheese', fr: 'Fromage de chèvre' },
  cottage_cheese: { en: 'Cottage cheese', fr: 'Fromage cottage' },
  cream: { en: 'Soured cream (crème fraîche)', fr: 'Crème fraîche' },
  curdled_milk: { en: 'Curdled milk', fr: 'Lait caillé', local: 'Soow' },
  thiakry: { en: 'Millet couscous with curdled milk', fr: 'Thiakry (couscous de mil au lait caillé)', local: 'Thiakry' },
  ice_cream: { en: 'Ice cream', fr: 'Glace' },

  // ---- Eggs
  egg_boiled: { en: 'Boiled egg', fr: 'Œuf dur' },
  egg_fried: { en: 'Fried egg', fr: 'Œuf au plat' },
  omelette: { en: 'Omelette (two eggs)', fr: 'Omelette (deux œufs)' },

  // ---- Meat
  chicken_breast_cooked: { en: 'Chicken breast, cooked', fr: 'Blanc de poulet cuit' },
  chicken_thigh_cooked: { en: 'Chicken thigh, cooked', fr: 'Cuisse de poulet cuite' },
  chicken_grilled: { en: 'Grilled chicken', fr: 'Poulet braisé' },
  beef_steak_cooked: { en: 'Beef steak, cooked', fr: 'Steak de bœuf cuit' },
  beef_minced_cooked: { en: 'Minced beef, cooked', fr: 'Bœuf haché cuit' },
  lamb_cooked: { en: 'Lamb, cooked', fr: 'Agneau cuit' },
  goat_meat_cooked: { en: 'Goat meat, cooked', fr: 'Viande de chèvre cuite' },
  pork_chop_cooked: { en: 'Pork chop, cooked', fr: 'Côte de porc cuite' },
  ham_cooked: { en: 'Cooked ham', fr: 'Jambon blanc' },
  ham_air_dried: { en: 'Air-dried ham', fr: 'Jambon sec' },
  sausage_cooked: { en: 'Sausage, cooked', fr: 'Saucisse cuite' },
  merguez: { en: 'Merguez sausage', fr: 'Merguez' },
  turkey_cooked: { en: 'Turkey, cooked', fr: 'Dinde cuite' },
  liver_cooked: { en: 'Liver, cooked', fr: 'Foie cuit' },
  dibi: { en: 'Grilled mutton', fr: 'Dibi (mouton grillé)', local: 'Dibi' },
  suya: { en: 'Spiced beef skewer', fr: 'Brochette de bœuf épicée', local: 'Suya' },
  kilishi: { en: 'Dried spiced beef', fr: 'Viande séchée épicée', local: 'Kilishi' },

  // ---- Fish and seafood
  tuna_canned: { en: 'Tuna, canned in water', fr: 'Thon au naturel' },
  sardines_canned: { en: 'Sardines, canned in oil', fr: 'Sardines à l’huile' },
  salmon_cooked: { en: 'Salmon, cooked', fr: 'Saumon cuit' },
  white_fish_cooked: { en: 'White fish, cooked', fr: 'Poisson blanc cuit' },
  mackerel_cooked: { en: 'Mackerel, cooked', fr: 'Maquereau cuit' },
  grouper_grilled: { en: 'Grilled white grouper', fr: 'Thiof grillé', local: 'Thiof' },
  fish_grilled_whole: { en: 'Whole grilled fish', fr: 'Poisson braisé' },
  smoked_dried_fish: { en: 'Smoked dried fish', fr: 'Poisson fumé séché', local: 'Kéthiakh' },
  fermented_dried_fish: { en: 'Fermented dried fish (seasoning)', fr: 'Poisson séché fermenté (assaisonnement)', local: 'Guedj' },
  shrimp_cooked: { en: 'Prawns, cooked', fr: 'Crevettes cuites' },
  sardinella_fried: { en: 'Fried sardinella', fr: 'Sardinelle frite', local: 'Yaboy' },
  mussels_cooked: { en: 'Mussels, cooked', fr: 'Moules cuites' },

  // ---- Nuts and seeds
  almonds: { en: 'Almonds', fr: 'Amandes' },
  cashews: { en: 'Cashew nuts', fr: 'Noix de cajou' },
  walnuts: { en: 'Walnuts', fr: 'Noix' },
  sesame_seeds: { en: 'Sesame seeds', fr: 'Graines de sésame' },
  sunflower_seeds: { en: 'Sunflower seeds', fr: 'Graines de tournesol' },
  mixed_nuts: { en: 'Mixed nuts', fr: 'Mélange de noix' },

  // ---- Oils and spreads
  olive_oil: { en: 'Olive oil', fr: 'Huile d’olive' },
  vegetable_oil: { en: 'Vegetable oil', fr: 'Huile végétale' },
  palm_oil: { en: 'Red palm oil', fr: 'Huile de palme rouge' },
  butter: { en: 'Butter', fr: 'Beurre' },
  margarine: { en: 'Margarine spread', fr: 'Margarine' },
  shea_butter_cooking: { en: 'Shea butter (for cooking)', fr: 'Beurre de karité (culinaire)' },

  // ---- Drinks
  water: { en: 'Water', fr: 'Eau' },
  coffee_black: { en: 'Black coffee', fr: 'Café noir' },
  tea_unsweetened: { en: 'Tea, unsweetened', fr: 'Thé sans sucre' },
  attaya: { en: 'Sweet green tea with mint (small glass)', fr: 'Thé à la menthe sucré (petit verre)', local: 'Ataaya' },
  bissap_drink: { en: 'Hibiscus drink, sweetened', fr: 'Jus de bissap sucré', local: 'Bissap' },
  bouye_drink: { en: 'Baobab drink, sweetened', fr: 'Jus de bouye sucré', local: 'Bouye' },
  ginger_drink: { en: 'Ginger drink, sweetened', fr: 'Jus de gingembre sucré' },
  orange_juice: { en: 'Orange juice', fr: 'Jus d’orange' },
  soft_drink: { en: 'Sweetened soft drink', fr: 'Soda sucré' },
  soft_drink_sugar_free: { en: 'Sugar-free soft drink', fr: 'Soda sans sucre' },
  beer: { en: 'Beer', fr: 'Bière' },
  wine_red: { en: 'Red wine', fr: 'Vin rouge' },
  hot_chocolate: { en: 'Hot chocolate', fr: 'Chocolat chaud' },
  fruit_smoothie: { en: 'Fruit smoothie', fr: 'Smoothie aux fruits' },
  cafe_touba: { en: 'Spiced coffee, sweetened', fr: 'Café Touba sucré', local: 'Café Touba' },
  kinkeliba_infusion: { en: 'Kinkeliba infusion, unsweetened', fr: 'Infusion de kinkéliba sans sucre', local: 'Kinkéliba' },
  mint_tea_sweet: { en: 'Sweet mint tea', fr: 'Thé à la menthe sucré' },
  coconut_water: { en: 'Coconut water', fr: 'Eau de coco' },

  // ---- Sweet foods
  dark_chocolate: { en: 'Dark chocolate', fr: 'Chocolat noir' },
  milk_chocolate: { en: 'Milk chocolate', fr: 'Chocolat au lait' },
  sugar: { en: 'Sugar', fr: 'Sucre' },
  honey: { en: 'Honey', fr: 'Miel' },
  jam: { en: 'Jam', fr: 'Confiture' },
  chocolate_spread: { en: 'Chocolate hazelnut spread', fr: 'Pâte à tartiner chocolat-noisette' },
  doughnut: { en: 'Doughnut', fr: 'Beignet sucré' },
  apple_tart: { en: 'Apple tart', fr: 'Tarte aux pommes' },
  chocolate_mousse: { en: 'Chocolate mousse', fr: 'Mousse au chocolat' },
  baked_custard: { en: 'Baked custard (flan)', fr: 'Flan pâtissier' },
  rice_pudding: { en: 'Rice pudding', fr: 'Riz au lait' },
  ngalakh: { en: 'Millet, peanut and baobab dessert', fr: 'Ngalakh (dessert de mil, arachide et bouye)', local: 'Ngalax' },
  sombi: { en: 'Rice pudding with coconut milk', fr: 'Sombi (riz au lait de coco)', local: 'Sombi' },

  // ---- Snacks
  accara: { en: 'Black-eyed pea fritters', fr: 'Accras de niébé', local: 'Akara' },
  fataya: { en: 'Fried turnover with fish or meat', fr: 'Fataya (chausson frit au poisson ou à la viande)', local: 'Fataya' },
  pastels: { en: 'Small fried fish pastries', fr: 'Pastels au poisson', local: 'Pastel' },
  puff_puff: { en: 'Fried dough balls', fr: 'Beignets de pâte', local: 'Puff-puff' },
  cereal_bar: { en: 'Cereal bar', fr: 'Barre de céréales' },
  crisps: { en: 'Crisps (potato chips)', fr: 'Chips' },
  popcorn: { en: 'Popcorn', fr: 'Pop-corn' },
  roasted_corn: { en: 'Roasted corn', fr: 'Maïs grillé' },
  boiled_peanuts: { en: 'Boiled peanuts', fr: 'Arachides bouillies' },
  chin_chin: { en: 'Crunchy fried dough bites', fr: 'Petits beignets croquants', local: 'Chin-chin' },
  samosa: { en: 'Samosa', fr: 'Samoussa' },

  // ---- Sauces and seasonings
  ketchup: { en: 'Tomato ketchup', fr: 'Ketchup' },
  mayonnaise: { en: 'Mayo (mayonnaise)', fr: 'Mayonnaise' },
  vinaigrette: { en: 'Oil and vinegar dressing', fr: 'Vinaigrette' },
  tomato_sauce: { en: 'Tomato sauce', fr: 'Sauce tomate' },
  onion_sauce: { en: 'Onion sauce', fr: 'Sauce aux oignons' },
  peanut_sauce: { en: 'Peanut sauce', fr: 'Sauce d’arachide' },
  chilli_sauce: { en: 'Chilli sauce', fr: 'Sauce pimentée' },

  // ---- Dishes: Senegal and West Africa
  thieboudienne: { en: 'Fish and rice with vegetables', fr: 'Thiéboudienne (riz au poisson)', local: 'Ceebu jën' },
  thiebou_yapp: { en: 'Meat and rice', fr: 'Thiébou yapp (riz à la viande)', local: 'Ceebu yàpp' },
  yassa_chicken: { en: 'Chicken yassa with rice', fr: 'Yassa au poulet avec riz', local: 'Yaasa' },
  yassa_fish: { en: 'Fish yassa with rice', fr: 'Yassa au poisson avec riz', local: 'Yaasa jën' },
  mafe: { en: 'Peanut stew with rice', fr: 'Mafé avec riz', local: 'Maafe' },
  domoda: { en: 'Tomato meat stew with rice', fr: 'Domoda avec riz', local: 'Domoda' },
  soupou_kandja: { en: 'Okra and palm oil stew with rice', fr: 'Soupou kandia avec riz', local: 'Supu kànja' },
  ceere_sauce: { en: 'Millet couscous with sauce', fr: 'Thiéré avec sauce', local: 'Cere' },
  lakh: { en: 'Millet porridge with curdled milk', fr: 'Lakh (bouillie de mil au lait caillé)', local: 'Lax' },
  caldou: { en: 'Fish in lemon broth with rice', fr: 'Caldou avec riz', local: 'Kaldu' },
  mbakhal: { en: 'Rice with peanuts and dried fish', fr: 'Mbakhal (riz à l’arachide et au poisson séché)', local: 'Mbaxal' },
  ndambe: { en: 'Black-eyed pea sandwich', fr: 'Sandwich au niébé', local: 'Ndambé' },
  thiou_poulet: { en: 'Chicken in tomato sauce with rice', fr: 'Thiou au poulet avec riz' },
  jollof_rice: { en: 'Jollof rice', fr: 'Riz jollof', local: 'Benachin' },
  attieke: { en: 'Fermented cassava couscous', fr: 'Attiéké', local: 'Attiéké' },
  garba: { en: 'Cassava couscous with fried tuna', fr: 'Garba (attiéké au thon frit)', local: 'Garba' },
  kedjenou: { en: 'Slow-cooked chicken stew', fr: 'Kédjénou de poulet', local: 'Kédjénou' },
  palm_nut_soup: { en: 'Palm nut soup with meat', fr: 'Sauce graine', local: 'Sauce graine' },
  fufu: { en: 'Pounded cassava or plantain', fr: 'Foutou', local: 'Foufou' },
  riz_gras: { en: 'Rice cooked in meat and tomato sauce', fr: 'Riz sauce tomate à la viande' },
  to_sauce_gombo: { en: 'Millet paste with okra sauce', fr: 'Tô sauce gombo', local: 'Tô' },
  alloco_poisson: { en: 'Fried plantain with grilled fish', fr: 'Alloco poisson', local: 'Alloco' },

  // ---- Dishes: Central Africa
  ndole: { en: 'Bitterleaf and peanut stew', fr: 'Ndolé', local: 'Ndolé' },
  poulet_dg: { en: 'Chicken with plantain and vegetables', fr: 'Poulet DG', local: 'Poulet DG' },
  moambe: { en: 'Chicken in palm nut sauce', fr: 'Poulet à la moambé', local: 'Moambé' },
  pondu: { en: 'Stewed cassava leaves', fr: 'Pondu (feuilles de manioc)', local: 'Pondu' },
  chikwangue: { en: 'Cassava bread', fr: 'Chikwangue', local: 'Kwanga' },

  // ---- Dishes: North Africa
  couscous_royal: { en: 'Couscous with meat and vegetables', fr: 'Couscous aux viandes et légumes' },
  chicken_tagine: { en: 'Chicken tagine', fr: 'Tajine de poulet' },
  harira: { en: 'Harira soup', fr: 'Harira', local: 'Harira' },
  shakshuka: { en: 'Eggs in tomato and pepper sauce', fr: 'Chakchouka', local: 'Chakchouka' },
  lentil_soup: { en: 'Lentil soup', fr: 'Soupe de lentilles' },

  // ---- Dishes: France
  bouillabaisse: { en: 'Fish soup (bouillabaisse)', fr: 'Bouillabaisse' },
  pot_au_feu: { en: 'Beef and vegetable stew (pot-au-feu)', fr: 'Pot-au-feu' },
  boeuf_bourguignon: { en: 'Beef stewed in red wine', fr: 'Bœuf bourguignon' },
  blanquette_de_veau: { en: 'Veal in white sauce', fr: 'Blanquette de veau' },
  ratatouille: { en: 'Ratatouille (vegetable stew)', fr: 'Ratatouille' },
  quiche_lorraine: { en: 'Bacon and cream quiche (quiche lorraine)', fr: 'Quiche lorraine' },
  croque_monsieur: { en: 'Toasted ham and cheese sandwich', fr: 'Croque-monsieur' },
  gratin_dauphinois: { en: 'Potato gratin', fr: 'Gratin dauphinois' },
  salade_nicoise: { en: 'Niçoise salad', fr: 'Salade niçoise' },
  cassoulet: { en: 'Bean and meat casserole (cassoulet)', fr: 'Cassoulet' },
  jambon_beurre: { en: 'Ham and butter baguette', fr: 'Jambon-beurre' },
  hachis_parmentier: { en: 'Cottage pie', fr: 'Hachis parmentier' },

  // ---- Dishes: widely eaten
  pizza_margherita: { en: 'Margherita pizza', fr: 'Pizza margherita' },
  hamburger: { en: 'Beef burger', fr: 'Hamburger' },
  lasagne: { en: 'Lasagne', fr: 'Lasagnes' },
  spaghetti_bolognese: { en: 'Spaghetti bolognese', fr: 'Spaghetti bolognaise' },
  fried_rice: { en: 'Fried rice', fr: 'Riz sauté' },
  chicken_curry_rice: { en: 'Chicken curry with rice', fr: 'Curry de poulet avec riz' },
  kebab_sandwich: { en: 'Kebab in bread', fr: 'Kebab (sandwich)' },
  chicken_sandwich: { en: 'Chicken sandwich', fr: 'Sandwich au poulet' },
  sushi: { en: 'Sushi', fr: 'Sushis' },
  beef_stew: { en: 'Beef stew', fr: 'Ragoût de bœuf' },
  chicken_soup: { en: 'Chicken soup', fr: 'Soupe de poulet' },
  bean_stew: { en: 'Bean stew', fr: 'Ragoût de haricots' },
} as const satisfies Record<string, FoodText>;

export type FoodTextId = keyof typeof FOOD_TEXT;
export const FOOD_TEXT_IDS = Object.freeze(Object.keys(FOOD_TEXT) as FoodTextId[]);
export type FoodMessageKey = `food.${FoodTextId}.name`;

/** FR or EN messages for every food: `food.<id>.name`. */
export function flattenFoodText(locale: 'en' | 'fr'): Record<FoodMessageKey, string> {
  const out: Record<string, string> = {};
  for (const [id, text] of Object.entries(FOOD_TEXT) as [FoodTextId, FoodText][]) out[`food.${id}.name`] = text[locale];
  return out as Record<FoodMessageKey, string>;
}

/**
 * The local name of a food (a proper name, the same in FR and EN), or null.
 * Kept out of the FR/EN catalogues, whose parity test requires the two
 * languages to differ; it is still wording of packages/i18n.
 */
export function foodLocalName(id: string): string | null {
  const text = (FOOD_TEXT as Record<string, FoodText>)[id];
  return text?.local ?? null;
}
