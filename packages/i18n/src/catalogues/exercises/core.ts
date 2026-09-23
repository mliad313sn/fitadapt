import type { ExerciseText } from './types.js';

/** Core and carries. See types.ts for the review status. */
export const coreExercises = {
  dead_bug: {
    en: { name: 'Dead bug', cues: ['Lie on your back, arms up, knees above the hips.', 'Lower the opposite arm and leg slowly while the lower back stays in gentle contact with the floor.'], mistakes: ['Moving so fast that the lower back lifts off the floor.'] },
    fr: { name: 'Dead bug (insecte sur le dos)', cues: ['Allongé sur le dos, bras levés, genoux au-dessus des hanches.', 'Descendez lentement le bras et la jambe opposés en gardant le bas du dos en léger contact avec le sol.'], mistakes: ['Aller si vite que le bas du dos se décolle du sol.'] },
  },
  bird_dog: {
    en: { name: 'Bird dog', cues: ['On hands and knees, hands under shoulders and knees under hips.', 'Reach one arm forward and the opposite leg back without tilting the hips.'], mistakes: ['Lifting the leg so high that the lower back arches.'] },
    fr: { name: 'Quadrupédie bras-jambe opposés', cues: ['À quatre pattes, mains sous les épaules et genoux sous les hanches.', 'Allongez un bras devant et la jambe opposée derrière sans basculer les hanches.'], mistakes: ['Lever la jambe si haut que le bas du dos se creuse.'] },
  },
  knee_plank: {
    en: { name: 'Kneeling plank', cues: ['Forearms on the floor, elbows under the shoulders, knees down.', 'Tuck the pelvis slightly and keep a straight line from head to knees.'], mistakes: ['Pushing the hips up high.'] },
    fr: { name: 'Planche sur les genoux', cues: ['Avant-bras au sol, coudes sous les épaules, genoux posés.', 'Rentrez légèrement le bassin et gardez une ligne droite de la tête aux genoux.'], mistakes: ['Monter les hanches très haut.'] },
  },
  front_plank: {
    en: { name: 'Forearm plank', cues: ['Forearms down, elbows under the shoulders, legs straight.', 'Squeeze the glutes and breathe while holding the line.'], mistakes: ['Letting the lower back sag towards the floor.'] },
    fr: { name: 'Planche sur les avant-bras', cues: ['Avant-bras au sol, coudes sous les épaules, jambes tendues.', 'Serrez les fessiers et respirez en tenant l’alignement.'], mistakes: ['Laisser le bas du dos s’affaisser vers le sol.'] },
  },
  side_plank_knees: {
    en: { name: 'Kneeling side plank', cues: ['Lie on your side, elbow under the shoulder, knees bent behind you.', 'Lift the hips so the body forms a line from head to knees.'], mistakes: ['Letting the top shoulder roll forward.'] },
    fr: { name: 'Planche latérale sur les genoux', cues: ['Sur le côté, coude sous l’épaule, genoux pliés derrière vous.', 'Levez les hanches pour aligner la tête et les genoux.'], mistakes: ['Laisser l’épaule du dessus basculer vers l’avant.'] },
  },
  side_plank: {
    en: { name: 'Side plank', cues: ['Elbow under the shoulder, feet stacked or staggered, legs straight.', 'Push the hips up and hold them there without sinking.'], mistakes: ['Letting the hips sink down during the hold.'] },
    fr: { name: 'Planche latérale', cues: ['Coude sous l’épaule, pieds superposés ou décalés, jambes tendues.', 'Poussez les hanches vers le haut et maintenez-les sans descendre.'], mistakes: ['Laisser les hanches descendre pendant le maintien.'] },
  },
  hollow_body_tuck: {
    en: { name: 'Tucked hollow hold', cues: ['Lie on your back, knees pulled in, shoulders lifted slightly off the floor.', 'Press the lower back gently into the floor and hold.'], mistakes: ['Pulling on the neck with the hands.'] },
    fr: { name: 'Position creuse groupée', cues: ['Sur le dos, genoux ramenés, épaules légèrement décollées du sol.', 'Plaquez doucement le bas du dos au sol et tenez.'], mistakes: ['Tirer sur la nuque avec les mains.'] },
  },
  hollow_body_hold: {
    en: { name: 'Hollow hold', cues: ['Arms overhead, legs straight and lifted, lower back on the floor.', 'Raise the legs higher if the lower back starts to lift.'], mistakes: ['Holding the position after the lower back has come off the floor.'] },
    fr: { name: 'Position creuse', cues: ['Bras au-dessus de la tête, jambes tendues et levées, bas du dos au sol.', 'Montez les jambes plus haut si le bas du dos commence à se décoller.'], mistakes: ['Continuer à tenir alors que le bas du dos s’est décollé.'] },
  },
  ab_wheel_kneeling: {
    en: { name: 'Kneeling ab wheel rollout', cues: ['Kneel on a mat, hands on the wheel under your shoulders.', 'Roll forward only as far as you can keep the lower back from sagging, then pull back.'], mistakes: ['Rolling out further than you can return from.'] },
    fr: { name: 'Roulette abdominale à genoux', cues: ['À genoux sur un tapis, mains sur la roue sous les épaules.', 'Roulez vers l’avant tant que le bas du dos ne s’affaisse pas, puis revenez.'], mistakes: ['Aller plus loin que ce dont on peut revenir.'] },
  },
  hanging_knee_raise: {
    en: { name: 'Hanging knee raise', cues: ['Hang from the bar with the shoulders gently engaged.', 'Lift the knees towards the chest and lower them without swinging.'], mistakes: ['Using a swing to bring the knees up.'] },
    fr: { name: 'Relevé de genoux en suspension', cues: ['Suspendu à la barre, épaules légèrement engagées.', 'Montez les genoux vers la poitrine et redescendez sans balancer.'], mistakes: ['Prendre de l’élan pour monter les genoux.'] },
  },
  hanging_leg_raise: {
    en: { name: 'Hanging leg raise', cues: ['From a still hang, lift straight legs to hip height or higher.', 'Lower the legs slowly to stop the swing.'], mistakes: ['Arching the back to lift the legs.'] },
    fr: { name: 'Relevé de jambes en suspension', cues: ['Depuis une suspension immobile, montez les jambes tendues à hauteur de hanches ou plus.', 'Redescendez lentement pour éviter le balancement.'], mistakes: ['Cambrer le dos pour lever les jambes.'] },
  },
  toes_to_bar: {
    en: { name: 'Toes to bar', cues: ['Press the bar down with straight arms as you fold at the hips.', 'Touch the bar with your feet and lower under control.'], mistakes: ['Relying on a big swing and losing the grip.'] },
    fr: { name: 'Pieds à la barre', cues: ['Appuyez sur la barre bras tendus tout en pliant les hanches.', 'Touchez la barre avec les pieds et redescendez avec contrôle.'], mistakes: ['Compter sur un grand balancement et perdre la prise.'] },
  },
  tuck_l_sit: {
    en: { name: 'Tucked L-sit', cues: ['Hands beside your hips on the floor or on parallettes, arms straight.', 'Push down, lift the hips and hold the knees tucked in front of you.'], mistakes: ['Letting the shoulders shrug up to the ears.'] },
    fr: { name: 'L-sit groupé', cues: ['Mains à côté des hanches au sol ou sur des parallettes, bras tendus.', 'Poussez vers le bas, décollez les hanches et tenez les genoux groupés devant vous.'], mistakes: ['Laisser les épaules remonter vers les oreilles.'] },
  },
  l_sit: {
    en: { name: 'L-sit', cues: ['Support yourself on parallettes or bars with straight arms.', 'Lift straight legs to hip height and point the toes.'], mistakes: ['Bending the knees as the hold gets hard instead of ending the set.'] },
    fr: { name: 'L-sit (équerre)', cues: ['En appui sur des parallettes ou des barres, bras tendus.', 'Levez les jambes tendues à hauteur de hanches, pointes de pied tendues.'], mistakes: ['Plier les genoux quand le maintien devient dur au lieu d’arrêter la série.'] },
  },
  band_pallof_press: {
    en: { name: 'Band anti-rotation press', cues: ['Stand side-on to a band anchored at chest height, hands at your chest.', 'Press the hands straight out and resist the band turning you.'], mistakes: ['Letting the hips turn towards the anchor.'] },
    fr: { name: 'Presse anti-rotation à l’élastique', cues: ['De profil par rapport à un élastique fixé à hauteur de poitrine, mains à la poitrine.', 'Tendez les bras droit devant et résistez à la rotation.'], mistakes: ['Laisser les hanches tourner vers le point d’ancrage.'] },
  },
  farmer_carry: {
    en: { name: 'Farmer carry', cues: ['A heavy dumbbell or kettlebell in each hand, stand tall.', 'Walk with short, steady steps and relaxed shoulders.'], mistakes: ['Leaning forward or letting the shoulders round.'] },
    fr: { name: 'Marche du fermier', cues: ['Un haltère ou kettlebell lourd dans chaque main, tenez-vous droit.', 'Marchez à petits pas réguliers, épaules relâchées.'], mistakes: ['Se pencher en avant ou arrondir les épaules.'] },
  },
  suitcase_carry: {
    en: { name: 'Suitcase carry', cues: ['Hold one weight in one hand only, like a suitcase.', 'Walk without leaning towards or away from the weight.'], mistakes: ['Tilting the torso to the side of the weight.'] },
    fr: { name: 'Marche valise', cues: ['Tenez une seule charge dans une main, comme une valise.', 'Marchez sans vous pencher vers la charge ni à l’opposé.'], mistakes: ['Pencher le buste du côté de la charge.'] },
  },
} as const satisfies Record<string, ExerciseText>;
