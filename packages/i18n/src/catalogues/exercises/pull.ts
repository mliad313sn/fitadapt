import type { ExerciseText } from './types.js';

/** Horizontal and vertical pulling, hangs and muscle-up steps. See types.ts for the review status. */
export const pullExercises = {
  seated_band_row: {
    en: { name: 'Seated band row', cues: ['Sit with legs straight, the band looped around your feet.', 'Pull the hands to your lower ribs and squeeze your shoulder blades together.'], mistakes: ['Rocking the torso back to pull.'] },
    fr: { name: 'Tirage assis à l’élastique', cues: ['Assis jambes tendues, l’élastique passé autour des pieds.', 'Tirez les mains vers le bas des côtes et serrez les omoplates.'], mistakes: ['Basculer le buste en arrière pour tirer.'] },
  },
  one_arm_dumbbell_row: {
    en: { name: 'One-arm dumbbell row', cues: ['One hand and knee on a bench or chair seat, back flat.', 'Pull the dumbbell towards your hip, elbow close to the body.'], mistakes: ['Twisting the torso open to lift the weight.'] },
    fr: { name: 'Rowing un bras à l’haltère', cues: ['Une main et un genou sur un banc ou une chaise, dos plat.', 'Tirez l’haltère vers la hanche, coude près du corps.'], mistakes: ['Ouvrir le buste en rotation pour monter la charge.'] },
  },
  bent_over_dumbbell_row: {
    en: { name: 'Bent-over dumbbell row', cues: ['Hinge at the hips until your torso is about 45 degrees, knees soft.', 'Row both dumbbells towards your lower ribs and lower them slowly.'], mistakes: ['Rounding the lower back as the set goes on.'] },
    fr: { name: 'Rowing buste penché aux haltères', cues: ['Penchez-vous depuis les hanches jusqu’à environ 45 degrés, genoux souples.', 'Tirez les haltères vers le bas des côtes, puis redescendez lentement.'], mistakes: ['Arrondir le bas du dos au fil de la série.'] },
  },
  barbell_row: {
    en: { name: 'Barbell row', cues: ['Grip just outside your knees, torso inclined and back flat.', 'Pull the bar to your lower chest or upper stomach.'], mistakes: ['Standing up more with every rep to move heavier loads.'] },
    fr: { name: 'Rowing à la barre', cues: ['Prise juste à l’extérieur des genoux, buste incliné, dos plat.', 'Tirez la barre vers le bas de la poitrine ou le haut du ventre.'], mistakes: ['Se redresser un peu plus à chaque répétition pour tirer plus lourd.'] },
  },
  seated_cable_row: {
    en: { name: 'Seated cable row', cues: ['Sit tall with a slight bend in the knees.', 'Pull the handle to your stomach and let the shoulders reach forward slowly on the return.'], mistakes: ['Leaning far back at the end of each pull.'] },
    fr: { name: 'Tirage horizontal à la poulie', cues: ['Assis bien droit, genoux légèrement fléchis.', 'Tirez la poignée vers le ventre et laissez les épaules revenir lentement vers l’avant.'], mistakes: ['Se pencher loin en arrière à la fin de chaque tirage.'] },
  },
  inverted_row_incline: {
    en: { name: 'Incline inverted row', cues: ['Bar, rings or straps at chest height; walk your feet forward until your body leans back.', 'Keep a straight body line and pull your chest to your hands.'], mistakes: ['Letting the hips drop towards the floor.'] },
    fr: { name: 'Tirage horizontal incliné', cues: ['Barre, anneaux ou sangles à hauteur de poitrine ; avancez les pieds jusqu’à être incliné en arrière.', 'Gardez le corps aligné et tirez la poitrine vers les mains.'], mistakes: ['Laisser les hanches descendre vers le sol.'] },
  },
  inverted_row: {
    en: { name: 'Inverted row', cues: ['Bar or rings at hip height, heels on the floor, body almost horizontal.', 'Pull until your chest reaches the bar, pause, then lower under control.'], mistakes: ['Pulling with the chin instead of the chest.'] },
    fr: { name: 'Tirage horizontal au poids du corps', cues: ['Barre ou anneaux à hauteur de hanches, talons au sol, corps presque horizontal.', 'Tirez jusqu’à amener la poitrine à la barre, marquez une pause, puis redescendez avec contrôle.'], mistakes: ['Tirer avec le menton plutôt qu’avec la poitrine.'] },
  },
  ring_row: {
    en: { name: 'Ring row', cues: ['Adjust the ring height to choose the difficulty; lower is harder.', 'Turn the palms to face each other at the top of the pull.'], mistakes: ['Letting the shoulders shrug towards the ears.'] },
    fr: { name: 'Tirage aux anneaux', cues: ['Réglez la hauteur des anneaux pour choisir la difficulté ; plus bas, c’est plus dur.', 'Tournez les paumes face à face en haut du tirage.'], mistakes: ['Hausser les épaules vers les oreilles.'] },
  },
  band_face_pull: {
    en: { name: 'Band face pull', cues: ['Anchor the band at head height and hold it with thumbs pointing back.', 'Pull towards your forehead, elbows high, and finish with the hands beside your ears.'], mistakes: ['Pulling the elbows down to the ribs, which turns it into a row.'] },
    fr: { name: 'Tirage visage à l’élastique', cues: ['Fixez l’élastique à hauteur de tête et tenez-le pouces vers l’arrière.', 'Tirez vers le front, coudes hauts, et finissez les mains près des oreilles.'], mistakes: ['Descendre les coudes vers les côtes, ce qui en fait un rowing.'] },
  },
  band_pull_apart: {
    en: { name: 'Band pull-apart', cues: ['Hold the band at shoulder height with straight arms.', 'Spread the arms until the band touches your chest, then return slowly.'], mistakes: ['Bending the elbows to make it easier.'] },
    fr: { name: 'Écarté à l’élastique', cues: ['Tenez l’élastique à hauteur d’épaules, bras tendus.', 'Écartez les bras jusqu’à ce que l’élastique touche la poitrine, puis revenez lentement.'], mistakes: ['Plier les coudes pour se faciliter la tâche.'] },
  },
  prone_y_t_raise: {
    en: { name: 'Lying Y and T raise', cues: ['Lie face down, forehead resting on a folded towel.', 'Lift the arms in a Y shape, then a T, thumbs pointing up.'], mistakes: ['Lifting the chest high by arching the lower back.'] },
    fr: { name: 'Élévations en Y et en T allongé', cues: ['Allongé sur le ventre, front posé sur une serviette pliée.', 'Levez les bras en Y puis en T, pouces vers le haut.'], mistakes: ['Soulever la poitrine en creusant le bas du dos.'] },
  },
  floor_w_raise: {
    en: { name: 'Lying W squeeze', cues: ['Lie face down, arms bent in a W shape beside your shoulders.', 'Lift the hands and elbows slightly and pull the elbows down towards your back pockets.'], mistakes: ['Lifting the head and chest instead of moving the arms.'] },
    fr: { name: 'Serrage en W allongé', cues: ['Allongé sur le ventre, bras pliés en W de chaque côté des épaules.', 'Décollez légèrement mains et coudes et tirez les coudes vers les poches arrière.'], mistakes: ['Soulever la tête et la poitrine au lieu de bouger les bras.'] },
  },
  prone_floor_pulldown: {
    en: { name: 'Lying floor pulldown', cues: ['Lie face down with the arms stretched overhead, hands just off the floor.', 'Pull the elbows down to your sides as if doing a pull-up, then reach back overhead.'], mistakes: ['Shrugging the shoulders up towards the ears.'] },
    fr: { name: 'Tirage vertical allongé au sol', cues: ['Allongé sur le ventre, bras tendus au-dessus de la tête, mains juste décollées du sol.', 'Ramenez les coudes le long du corps comme pour une traction, puis tendez à nouveau les bras.'], mistakes: ['Hausser les épaules vers les oreilles.'] },
  },
  dead_hang: {
    en: { name: 'Dead hang', cues: ['Grip the bar shoulder-width apart and hang with straight arms.', 'Keep your feet close to a box or the floor so you can step down at any time.'], mistakes: ['Letting go suddenly instead of stepping down.'] },
    fr: { name: 'Suspension passive', cues: ['Saisissez la barre à largeur d’épaules et suspendez-vous bras tendus.', 'Gardez les pieds près d’une caisse ou du sol pour pouvoir redescendre à tout moment.'], mistakes: ['Lâcher la barre brusquement au lieu de reposer les pieds.'] },
  },
  scapular_pull_up: {
    en: { name: 'Scapular pull-up', cues: ['From a dead hang, pull your shoulder blades down without bending the arms.', 'Hold one second at the top, then relax back into the hang slowly.'], mistakes: ['Bending the elbows to go higher.'] },
    fr: { name: 'Traction scapulaire', cues: ['Depuis la suspension, abaissez les omoplates sans plier les bras.', 'Tenez une seconde en haut, puis revenez lentement en suspension.'], mistakes: ['Plier les coudes pour monter plus haut.'] },
  },
  band_assisted_pull_up: {
    en: { name: 'Band-assisted pull-up', cues: ['Loop a band over the bar and place a knee or foot in it.', 'Pull your chest towards the bar; use a lighter band as you get stronger.'], mistakes: ['Letting the band throw you up at the bottom instead of pulling from a still hang.'] },
    fr: { name: 'Traction assistée à l’élastique', cues: ['Passez un élastique autour de la barre et placez-y un genou ou un pied.', 'Tirez la poitrine vers la barre ; prenez un élastique plus léger à mesure que vous progressez.'], mistakes: ['Laisser l’élastique vous propulser au lieu de tirer depuis une suspension immobile.'] },
  },
  negative_pull_up: {
    en: { name: 'Slow lowering pull-up', cues: ['Step up from a box or chair so your chin is above the bar.', 'Lower yourself over three to five seconds to a full hang.'], mistakes: ['Jumping up so hard that the start is uncontrolled.'] },
    fr: { name: 'Traction en descente lente', cues: ['Montez depuis une caisse ou une chaise pour avoir le menton au-dessus de la barre.', 'Descendez en trois à cinq secondes jusqu’à la suspension complète.'], mistakes: ['Sauter si fort que le départ n’est pas contrôlé.'] },
  },
  pull_up: {
    en: { name: 'Pull-up', cues: ['Overhand grip slightly wider than your shoulders, start from a still hang.', 'Pull until your chin clears the bar, then lower all the way.'], mistakes: ['Kicking the legs to get over the bar.'] },
    fr: { name: 'Traction pronation', cues: ['Prise en pronation un peu plus large que les épaules, départ d’une suspension immobile.', 'Tirez jusqu’à passer le menton au-dessus de la barre, puis redescendez complètement.'], mistakes: ['Donner des coups de jambes pour passer la barre.'] },
  },
  chin_up: {
    en: { name: 'Chin-up', cues: ['Palms facing you, hands shoulder-width apart.', 'Pull your chest towards the bar and lower until your arms are straight.'], mistakes: ['Stopping halfway down on every rep.'] },
    fr: { name: 'Traction supination', cues: ['Paumes vers vous, mains à largeur d’épaules.', 'Tirez la poitrine vers la barre et redescendez jusqu’aux bras tendus.'], mistakes: ['S’arrêter à mi-descente à chaque répétition.'] },
  },
  weighted_pull_up: {
    en: { name: 'Weighted pull-up', cues: ['Add load with a dumbbell between the feet or a plate on a belt.', 'Keep the same strict technique as your bodyweight pull-ups.'], mistakes: ['Adding load before strict bodyweight reps are consistent.'] },
    fr: { name: 'Traction lestée', cues: ['Ajoutez de la charge avec un haltère entre les pieds ou un disque sur une ceinture.', 'Gardez la même technique stricte qu’au poids du corps.'], mistakes: ['Ajouter de la charge avant d’être régulier au poids du corps.'] },
  },
  lat_pulldown: {
    en: { name: 'Lat pulldown', cues: ['Thighs under the pads, grip a little wider than your shoulders.', 'Pull the bar to your upper chest while keeping the torso almost upright.'], mistakes: ['Pulling the bar behind the neck.'] },
    fr: { name: 'Tirage vertical à la poulie', cues: ['Cuisses sous les boudins, prise un peu plus large que les épaules.', 'Tirez la barre vers le haut de la poitrine en gardant le buste presque droit.'], mistakes: ['Tirer la barre derrière la nuque.'] },
  },
  assisted_pull_up_machine: {
    en: { name: 'Machine-assisted pull-up', cues: ['Choose enough assistance to complete every rep with good form.', 'Pull your chest to the handles and lower slowly.'], mistakes: ['Reducing the assistance faster than your reps allow.'] },
    fr: { name: 'Traction assistée à la machine', cues: ['Choisissez assez d’assistance pour réussir chaque répétition proprement.', 'Tirez la poitrine vers les poignées et redescendez lentement.'], mistakes: ['Réduire l’assistance plus vite que vos répétitions ne le permettent.'] },
  },
  band_lat_pulldown: {
    en: { name: 'Kneeling band pulldown', cues: ['Anchor the band high, kneel facing it and hold one end in each hand.', 'Pull your elbows down towards your ribs and return slowly.'], mistakes: ['Leaning back to use body weight instead of the arms and back.'] },
    fr: { name: 'Tirage vertical à genoux à l’élastique', cues: ['Fixez l’élastique en hauteur, à genoux face à lui, une extrémité dans chaque main.', 'Tirez les coudes vers les côtes, puis revenez lentement.'], mistakes: ['Se pencher en arrière pour tirer avec le poids du corps.'] },
  },
  high_pull_up: {
    en: { name: 'Chest-to-bar pull-up', cues: ['Pull explosively until your chest touches the bar.', 'Lean back slightly at the top and keep the legs together.'], mistakes: ['Losing the still hang between reps.'] },
    fr: { name: 'Traction poitrine à la barre', cues: ['Tirez de façon explosive jusqu’à toucher la barre avec la poitrine.', 'Penchez-vous légèrement en arrière en haut et gardez les jambes serrées.'], mistakes: ['Perdre la suspension immobile entre les répétitions.'] },
  },
  ring_false_grip_hang: {
    en: { name: 'Ring false-grip hang', cues: ['Place the base of your palm on top of the ring, wrist bent over it.', 'Hang for short holds and build time gradually.'], mistakes: ['Holding for long sets before your wrists are used to the position.'] },
    fr: { name: 'Suspension en fausse prise aux anneaux', cues: ['Posez la base de la paume sur le dessus de l’anneau, poignet plié par-dessus.', 'Faites de courts maintiens et augmentez la durée progressivement.'], mistakes: ['Tenir longtemps avant que les poignets soient habitués à la position.'] },
  },
  low_ring_muscle_up_transition: {
    en: { name: 'Low-ring muscle-up transition', cues: ['Rings low enough that your feet stay on the floor to help.', 'Pull the rings to your ribs, then roll the chest over them into a dip position.'], mistakes: ['Letting go of the false grip during the turn.'] },
    fr: { name: 'Transition de muscle-up aux anneaux bas', cues: ['Anneaux assez bas pour que les pieds restent au sol et aident.', 'Tirez les anneaux vers les côtes, puis basculez la poitrine par-dessus en position de dips.'], mistakes: ['Perdre la fausse prise pendant la bascule.'] },
  },
  negative_muscle_up: {
    en: { name: 'Slow lowering muscle-up', cues: ['Start in the support position above the bar or rings.', 'Lower slowly through the transition into a hang.'], mistakes: ['Dropping quickly through the turn, where control matters most.'] },
    fr: { name: 'Muscle-up en descente lente', cues: ['Partez en appui au-dessus de la barre ou des anneaux.', 'Descendez lentement à travers la transition jusqu’à la suspension.'], mistakes: ['Tomber vite pendant la bascule, là où le contrôle compte le plus.'] },
  },
  bar_muscle_up: {
    en: { name: 'Bar muscle-up', cues: ['From a controlled swing, pull the bar towards your hips.', 'Lean the chest over the bar and press to straight arms.'], mistakes: ['Getting over one arm at a time.'] },
    fr: { name: 'Muscle-up à la barre', cues: ['Depuis un balancement contrôlé, tirez la barre vers les hanches.', 'Passez la poitrine au-dessus de la barre et poussez jusqu’aux bras tendus.'], mistakes: ['Passer un bras après l’autre.'] },
  },
  ring_muscle_up: {
    en: { name: 'Ring muscle-up', cues: ['Start from a false-grip hang with the rings close together.', 'Pull high, turn the chest over the rings and press out of the dip.'], mistakes: ['Letting the rings drift wide during the turn.'] },
    fr: { name: 'Muscle-up aux anneaux', cues: ['Partez d’une suspension en fausse prise, anneaux rapprochés.', 'Tirez haut, basculez la poitrine au-dessus des anneaux et poussez pour sortir du dip.'], mistakes: ['Laisser les anneaux s’écarter pendant la bascule.'] },
  },
} as const satisfies Record<string, ExerciseText>;
