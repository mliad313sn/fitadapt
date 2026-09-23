import type { ExerciseText } from './types.js';

/** Isolation, balance, mobility and locomotion. See types.ts for the review status. */
export const otherExercises = {
  dumbbell_curl: {
    en: { name: 'Dumbbell curl', cues: ['Stand tall, elbows close to your sides.', 'Curl the dumbbells up and lower them all the way down slowly.'], mistakes: ['Swinging the torso to lift the weight.'] },
    fr: { name: 'Flexion des bras aux haltères', cues: ['Debout bien droit, coudes près du corps.', 'Montez les haltères, puis redescendez lentement jusqu’en bas.'], mistakes: ['Balancer le buste pour monter la charge.'] },
  },
  band_curl: {
    en: { name: 'Band curl', cues: ['Stand on the band, one end in each hand, palms forward.', 'Curl up while keeping the elbows still.'], mistakes: ['Letting the elbows drift forward.'] },
    fr: { name: 'Flexion des bras à l’élastique', cues: ['Debout sur l’élastique, une extrémité dans chaque main, paumes vers l’avant.', 'Montez les mains en gardant les coudes immobiles.'], mistakes: ['Laisser les coudes avancer.'] },
  },
  band_triceps_pushdown: {
    en: { name: 'Band triceps pushdown', cues: ['Anchor the band above head height, elbows pinned to your sides.', 'Push the hands down until the arms are straight, then return slowly.'], mistakes: ['Letting the elbows move up and down with the hands.'] },
    fr: { name: 'Extension des triceps à l’élastique', cues: ['Élastique fixé au-dessus de la tête, coudes collés au corps.', 'Poussez les mains vers le bas jusqu’aux bras tendus, puis revenez lentement.'], mistakes: ['Laisser les coudes monter et descendre avec les mains.'] },
  },
  cable_triceps_pushdown: {
    en: { name: 'Cable triceps pushdown', cues: ['Stand close to the pulley, elbows by your sides.', 'Straighten the arms fully and let the handle rise slowly.'], mistakes: ['Leaning over the handle to push with body weight.'] },
    fr: { name: 'Extension des triceps à la poulie', cues: ['Debout près de la poulie, coudes le long du corps.', 'Tendez complètement les bras et laissez remonter la poignée lentement.'], mistakes: ['Se pencher sur la poignée pour pousser avec le poids du corps.'] },
  },
  dumbbell_overhead_triceps_extension: {
    en: { name: 'Overhead dumbbell triceps extension', cues: ['Hold one dumbbell with both hands above your head.', 'Lower it behind your head by bending only the elbows, then straighten.'], mistakes: ['Letting the elbows flare wide.'] },
    fr: { name: 'Extension des triceps au-dessus de la tête à l’haltère', cues: ['Tenez un haltère à deux mains au-dessus de la tête.', 'Descendez-le derrière la tête en pliant seulement les coudes, puis tendez.'], mistakes: ['Laisser les coudes s’écarter largement.'] },
  },
  wall_triceps_press: {
    en: { name: 'Wall triceps press', cues: ['Forearms on the wall at forehead height, feet a step back.', 'Press through the palms to straighten the arms, then bend back to the wall.'], mistakes: ['Pushing with the chest instead of the arms.'] },
    fr: { name: 'Poussée des triceps au mur', cues: ['Avant-bras au mur à hauteur du front, pieds un pas en arrière.', 'Poussez dans les paumes pour tendre les bras, puis revenez vers le mur.'], mistakes: ['Pousser avec la poitrine plutôt qu’avec les bras.'] },
  },
  dumbbell_lateral_raise: {
    en: { name: 'Dumbbell lateral raise', cues: ['Light dumbbells at your sides, a slight bend in the elbows.', 'Raise the arms out to the side up to shoulder height.'], mistakes: ['Shrugging the shoulders to lift the weights.'] },
    fr: { name: 'Élévations latérales aux haltères', cues: ['Haltères légers le long du corps, coudes légèrement fléchis.', 'Levez les bras sur les côtés jusqu’à hauteur d’épaules.'], mistakes: ['Hausser les épaules pour monter les charges.'] },
  },
  band_lateral_raise: {
    en: { name: 'Band lateral raise', cues: ['Stand on the band, ends in your hands at your sides.', 'Raise the arms sideways to shoulder height and lower slowly.'], mistakes: ['Raising the hands above shoulder height with a shrug.'] },
    fr: { name: 'Élévations latérales à l’élastique', cues: ['Debout sur l’élastique, extrémités dans les mains le long du corps.', 'Levez les bras sur les côtés jusqu’à hauteur d’épaules, puis redescendez lentement.'], mistakes: ['Monter les mains au-dessus des épaules en haussant les épaules.'] },
  },
  dumbbell_reverse_fly: {
    en: { name: 'Bent-over dumbbell reverse fly', cues: ['Hinge forward with a flat back, light dumbbells hanging under the chest.', 'Open the arms out to the side, leading with the elbows.'], mistakes: ['Using weights so heavy that the back swings.'] },
    fr: { name: 'Oiseau buste penché aux haltères', cues: ['Penché en avant dos plat, haltères légers sous la poitrine.', 'Ouvrez les bras sur les côtés en menant avec les coudes.'], mistakes: ['Prendre des charges si lourdes que le dos se balance.'] },
  },
  band_external_rotation: {
    en: { name: 'Band external rotation', cues: ['Elbows bent at 90 degrees and tucked to your sides, band between the hands.', 'Rotate the forearms outwards while the elbows stay put.'], mistakes: ['Letting the elbows leave the sides.'] },
    fr: { name: 'Rotation externe à l’élastique', cues: ['Coudes pliés à 90 degrés collés au corps, élastique entre les mains.', 'Tournez les avant-bras vers l’extérieur sans décoller les coudes.'], mistakes: ['Laisser les coudes s’écarter du corps.'] },
  },
  calf_raise: {
    en: { name: 'Calf raise', cues: ['Stand with a hand on a wall for balance, feet hip-width apart.', 'Rise onto the balls of your feet, pause, then lower slowly.'], mistakes: ['Bouncing quickly at the bottom.'] },
    fr: { name: 'Montée sur pointes', cues: ['Debout, une main au mur pour l’équilibre, pieds largeur de hanches.', 'Montez sur l’avant des pieds, marquez une pause, puis redescendez lentement.'], mistakes: ['Rebondir rapidement en bas.'] },
  },
  single_leg_calf_raise: {
    en: { name: 'Single-leg calf raise', cues: ['Stand on one foot, fingertips on a wall.', 'Rise as high as you can and lower over two to three seconds.'], mistakes: ['Rolling onto the outside of the foot.'] },
    fr: { name: 'Montée sur pointe sur une jambe', cues: ['Sur un pied, bout des doigts au mur.', 'Montez le plus haut possible et redescendez en deux à trois secondes.'], mistakes: ['Rouler sur le bord extérieur du pied.'] },
  },
  machine_leg_extension: {
    en: { name: 'Machine leg extension', cues: ['Line up your knees with the machine’s pivot, pad just above the ankles.', 'Straighten the legs and lower slowly.'], mistakes: ['Kicking the weight up with momentum.'] },
    fr: { name: 'Extension des jambes à la machine', cues: ['Alignez les genoux avec l’axe de la machine, boudin juste au-dessus des chevilles.', 'Tendez les jambes, puis redescendez lentement.'], mistakes: ['Lancer la charge avec de l’élan.'] },
  },
  mini_band_lateral_walk: {
    en: { name: 'Mini-band side walk', cues: ['Mini band around the legs just above the knees, knees slightly bent.', 'Take small side steps while keeping tension on the band.'], mistakes: ['Letting the feet come together between steps.'] },
    fr: { name: 'Marche latérale avec mini-bande', cues: ['Mini-bande autour des jambes juste au-dessus des genoux, genoux légèrement fléchis.', 'Faites de petits pas de côté en gardant la bande tendue.'], mistakes: ['Laisser les pieds se rejoindre entre les pas.'] },
  },
  side_lying_hip_abduction: {
    en: { name: 'Side-lying leg raise', cues: ['Lie on your side, bottom knee bent, top leg straight.', 'Lift the top leg slightly behind you, heel leading, and lower slowly.'], mistakes: ['Rolling the hips backwards to lift higher.'] },
    fr: { name: 'Élévation de jambe sur le côté', cues: ['Allongé sur le côté, genou du dessous plié, jambe du dessus tendue.', 'Levez la jambe du dessus légèrement en arrière, talon en premier, puis redescendez lentement.'], mistakes: ['Basculer les hanches en arrière pour monter plus haut.'] },
  },
  weight_shift: {
    en: { name: 'Side-to-side weight shift', cues: ['Stand with feet apart near a counter or chair back.', 'Slowly shift your weight onto one foot, then the other.'], mistakes: ['Moving so fast that you need to grab the support.'] },
    fr: { name: 'Transfert de poids d’un pied à l’autre', cues: ['Debout pieds écartés près d’un plan de travail ou d’un dossier de chaise.', 'Transférez lentement le poids sur un pied, puis sur l’autre.'], mistakes: ['Aller si vite qu’il faut se rattraper à l’appui.'] },
  },
  supported_single_leg_stand: {
    en: { name: 'Supported single-leg stand', cues: ['One hand on a sturdy chair back or counter.', 'Lift one foot a little and hold, standing tall; switch sides.'], mistakes: ['Leaning heavily on the support throughout.'] },
    fr: { name: 'Équilibre sur une jambe avec appui', cues: ['Une main sur un dossier de chaise solide ou un plan de travail.', 'Levez un peu un pied et tenez, bien grand ; changez de côté.'], mistakes: ['S’appuyer fortement sur le support tout du long.'] },
  },
  tandem_stance: {
    en: { name: 'Heel-to-toe stance', cues: ['Stand near a wall or counter, place one foot directly in front of the other.', 'Hold the position with your eyes on a fixed point.'], mistakes: ['Looking down at your feet the whole time.'] },
    fr: { name: 'Position talon-orteils', cues: ['Près d’un mur ou d’un plan de travail, placez un pied juste devant l’autre.', 'Tenez la position en fixant un point devant vous.'], mistakes: ['Regarder ses pieds pendant tout l’exercice.'] },
  },
  heel_to_toe_walk: {
    en: { name: 'Heel-to-toe walk', cues: ['Walk along a wall or counter, placing each heel right in front of the other toes.', 'Keep your gaze ahead and move slowly.'], mistakes: ['Hurrying and taking wide steps.'] },
    fr: { name: 'Marche talon-orteils', cues: ['Marchez le long d’un mur ou d’un plan de travail, chaque talon juste devant les orteils de l’autre pied.', 'Gardez le regard devant et avancez lentement.'], mistakes: ['Se presser et faire de grands pas.'] },
  },
  single_leg_stand: {
    en: { name: 'Single-leg stand', cues: ['Stand on one foot with a support within reach but not held.', 'Keep the standing knee soft and the hips level.'], mistakes: ['Locking the standing knee.'] },
    fr: { name: 'Équilibre sur une jambe', cues: ['Sur un pied, un appui à portée de main mais sans le tenir.', 'Gardez le genou d’appui souple et les hanches à niveau.'], mistakes: ['Verrouiller le genou d’appui.'] },
  },
  clock_reach: {
    en: { name: 'Single-leg clock reach', cues: ['Balance on one leg and imagine a clock face on the floor around you.', 'Tap the free foot lightly towards different hours and return to the centre each time.'], mistakes: ['Putting weight on the tapping foot.'] },
    fr: { name: 'Horloge sur une jambe', cues: ['En équilibre sur une jambe, imaginez un cadran d’horloge au sol autour de vous.', 'Touchez légèrement différentes heures avec le pied libre et revenez au centre à chaque fois.'], mistakes: ['Mettre du poids sur le pied qui touche le sol.'] },
  },
  supported_standing_march: {
    en: { name: 'Supported standing march', cues: ['Hold a chair back or counter with one hand.', 'Lift one knee to a comfortable height, lower it, then the other.'], mistakes: ['Leaning back as the knee comes up.'] },
    fr: { name: 'Marche sur place avec appui', cues: ['Tenez un dossier de chaise ou un plan de travail d’une main.', 'Levez un genou à une hauteur confortable, reposez-le, puis l’autre.'], mistakes: ['Se pencher en arrière quand le genou monte.'] },
  },
  cat_camel: {
    en: { name: 'Cat and camel', cues: ['On hands and knees, round your back slowly towards the ceiling.', 'Then let the chest sink and the tailbone lift; move within a comfortable range.'], mistakes: ['Moving quickly instead of vertebra by vertebra.'] },
    fr: { name: 'Dos rond, dos creux', cues: ['À quatre pattes, arrondissez lentement le dos vers le plafond.', 'Laissez ensuite la poitrine descendre et le coccyx monter, dans une amplitude confortable.'], mistakes: ['Aller vite au lieu de dérouler le dos progressivement.'] },
  },
  half_kneeling_hip_flexor_stretch: {
    en: { name: 'Half-kneeling hip flexor stretch', cues: ['One knee on a cushion, the other foot in front.', 'Tuck the pelvis under and shift forward gently until you feel a stretch at the front of the hip.'], mistakes: ['Arching the lower back to go further.'] },
    fr: { name: 'Étirement des fléchisseurs de hanche à genou', cues: ['Un genou sur un coussin, l’autre pied devant.', 'Rentrez le bassin et avancez doucement jusqu’à sentir l’étirement à l’avant de la hanche.'], mistakes: ['Creuser le bas du dos pour aller plus loin.'] },
  },
  open_book_rotation: {
    en: { name: 'Side-lying open book', cues: ['Lie on your side, knees bent in front, arms together.', 'Open the top arm across to the other side, following it with your eyes.'], mistakes: ['Letting the knees come apart as the arm opens.'] },
    fr: { name: 'Livre ouvert sur le côté', cues: ['Allongé sur le côté, genoux pliés devant, bras joints.', 'Ouvrez le bras du dessus de l’autre côté en le suivant du regard.'], mistakes: ['Laisser les genoux se séparer quand le bras s’ouvre.'] },
  },
  knee_to_wall_ankle_rock: {
    en: { name: 'Knee-to-wall ankle rock', cues: ['Face a wall in a split stance, front foot a hand’s width from the wall.', 'Rock the front knee towards the wall while the heel stays down.'], mistakes: ['Letting the heel lift off the floor.'] },
    fr: { name: 'Mobilité de cheville genou au mur', cues: ['Face à un mur, pieds décalés, pied avant à une largeur de main du mur.', 'Avancez le genou avant vers le mur en gardant le talon au sol.'], mistakes: ['Laisser le talon se décoller du sol.'] },
  },
  band_pass_through: {
    en: { name: 'Band shoulder pass-through', cues: ['Hold a light band wide in front of your hips, arms straight.', 'Lift it over your head and behind you only as far as is comfortable.'], mistakes: ['Holding the band so narrow that the arms have to bend.'] },
    fr: { name: 'Passage d’épaules à l’élastique', cues: ['Tenez un élastique léger en prise large devant les hanches, bras tendus.', 'Passez-le au-dessus de la tête et derrière vous seulement aussi loin que c’est confortable.'], mistakes: ['Tenir l’élastique si serré que les bras doivent se plier.'] },
  },
  lunge_with_rotation: {
    en: { name: 'Lunge with upper-back rotation', cues: ['Step into a long lunge and place both hands on the floor inside the front foot.', 'Lift the arm on the front-leg side towards the ceiling, then switch sides.'], mistakes: ['Letting the back knee drop hard onto the floor.'] },
    fr: { name: 'Fente avec rotation du haut du dos', cues: ['Faites une grande fente et posez les deux mains au sol à l’intérieur du pied avant.', 'Levez vers le plafond le bras du côté de la jambe avant, puis changez de côté.'], mistakes: ['Laisser le genou arrière tomber lourdement au sol.'] },
  },
  deep_squat_hold: {
    en: { name: 'Supported deep squat hold', cues: ['Hold a door frame or post and sit down into a deep squat.', 'Stay relaxed with the heels down, breathing slowly.'], mistakes: ['Forcing depth past what feels comfortable.'] },
    fr: { name: 'Maintien en squat profond avec appui', cues: ['Tenez un encadrement de porte ou un poteau et descendez en squat profond.', 'Restez détendu, talons au sol, en respirant lentement.'], mistakes: ['Forcer la profondeur au-delà du confortable.'] },
  },
  marching_in_place: {
    en: { name: 'Marching on the spot', cues: ['Lift the knees in turn with an easy arm swing.', 'Choose a pace where you can still talk.'], mistakes: ['Holding the breath while marching.'] },
    fr: { name: 'Marche sur place', cues: ['Levez les genoux en alternance avec un balancement de bras naturel.', 'Choisissez un rythme qui vous permet encore de parler.'], mistakes: ['Retenir sa respiration en marchant.'] },
  },
  step_jack: {
    en: { name: 'Step jack', cues: ['Step one foot out to the side as both arms rise.', 'Step back in and repeat on the other side; one foot is always on the floor.'], mistakes: ['Hunching the shoulders when the arms go up.'] },
    fr: { name: 'Jumping jack sans saut', cues: ['Écartez un pied sur le côté en levant les deux bras.', 'Revenez et recommencez de l’autre côté ; un pied reste toujours au sol.'], mistakes: ['Hausser les épaules quand les bras montent.'] },
  },
  jumping_jack: {
    en: { name: 'Jumping jack', cues: ['Jump the feet apart as the arms rise overhead, then jump back together.', 'Stay light on the balls of your feet.'], mistakes: ['Landing flat-footed and heavy.'] },
    fr: { name: 'Jumping jack (saut écart)', cues: ['Sautez pieds écartés en levant les bras, puis revenez pieds joints.', 'Restez léger sur l’avant des pieds.'], mistakes: ['Retomber lourdement à plat.'] },
  },
  burpee: {
    en: { name: 'Burpee', cues: ['Squat down, place the hands on the floor and jump the feet back to a plank.', 'Jump the feet back in, stand up and finish with a small jump.'], mistakes: ['Letting the hips sag in the plank position.'] },
    fr: { name: 'Burpee sauté', cues: ['Accroupissez-vous, posez les mains au sol et sautez les pieds en arrière en planche.', 'Ramenez les pieds, relevez-vous et finissez par un petit saut.'], mistakes: ['Laisser les hanches s’affaisser en position de planche.'] },
  },
  step_back_burpee: {
    en: { name: 'Step-back burpee', cues: ['Hands on the floor or a bench, then step the feet back one at a time.', 'Step them back in and stand up without jumping.'], mistakes: ['Rushing the steps and losing the plank shape.'] },
    fr: { name: 'Burpee sans saut', cues: ['Mains au sol ou sur un banc, puis reculez les pieds un par un.', 'Ramenez-les un par un et relevez-vous sans sauter.'], mistakes: ['Se précipiter et perdre la position de planche.'] },
  },
  jump_rope_basic: {
    en: { name: 'Jump rope', cues: ['Turn the rope with the wrists, elbows close to your sides.', 'Make small, quiet jumps just high enough to clear the rope.'], mistakes: ['Jumping high and landing hard.'] },
    fr: { name: 'Corde à sauter', cues: ['Faites tourner la corde avec les poignets, coudes près du corps.', 'Faites de petits sauts silencieux, juste assez hauts pour passer la corde.'], mistakes: ['Sauter haut et retomber lourdement.'] },
  },
  bear_crawl: {
    en: { name: 'Bear crawl', cues: ['On hands and feet, knees hovering a few centimetres off the floor.', 'Crawl forward moving the opposite hand and foot together, back flat.'], mistakes: ['Lifting the hips high to make it easier.'] },
    fr: { name: 'Marche de l’ours', cues: ['Sur les mains et les pieds, genoux à quelques centimètres du sol.', 'Avancez en déplaçant ensemble la main et le pied opposés, dos plat.'], mistakes: ['Monter les hanches pour se faciliter la tâche.'] },
  },
  mountain_climber: {
    en: { name: 'Mountain climber', cues: ['Start in a high plank, hands under the shoulders.', 'Drive one knee towards the chest at a time, keeping the hips low.'], mistakes: ['Bouncing the hips up and down.'] },
    fr: { name: 'Grimpeur', cues: ['Départ en planche bras tendus, mains sous les épaules.', 'Ramenez un genou après l’autre vers la poitrine en gardant les hanches basses.'], mistakes: ['Faire rebondir les hanches de haut en bas.'] },
  },
  stationary_bike_easy: {
    en: { name: 'Stationary bike', cues: ['Set the saddle so the knee stays slightly bent at the bottom of the pedal stroke.', 'Pedal at a steady, comfortable effort.'], mistakes: ['Setting the saddle so low that the knees come up high.'] },
    fr: { name: 'Vélo d’appartement', cues: ['Réglez la selle pour garder le genou légèrement fléchi en bas du coup de pédale.', 'Pédalez à un effort régulier et confortable.'], mistakes: ['Régler la selle si bas que les genoux montent haut.'] },
  },
  rowing_machine_steady: {
    en: { name: 'Rowing machine', cues: ['Push with the legs first, then lean back slightly and pull the handle to the ribs.', 'Return in reverse order: arms, body, then legs.'], mistakes: ['Pulling with the arms before the legs have pushed.'] },
    fr: { name: 'Rameur', cues: ['Poussez d’abord avec les jambes, puis basculez légèrement en arrière et tirez la poignée vers les côtes.', 'Revenez dans l’ordre inverse : bras, buste, puis jambes.'], mistakes: ['Tirer avec les bras avant que les jambes aient poussé.'] },
  },
} as const satisfies Record<string, ExerciseText>;
