import type { ExerciseText } from './types.js';

/** Squat, lunge and hinge patterns. See types.ts for the review status. */
export const legExercises = {
  box_squat: {
    en: { name: 'Box squat', cues: ['Stand in front of a sturdy chair, box or bench, feet hip-width apart.', 'Sit back until you lightly touch the seat, then stand up without rocking.'], mistakes: ['Dropping onto the seat instead of lowering with control.'] },
    fr: { name: 'Squat sur caisse', cues: ['Debout devant une chaise solide, une caisse ou un banc, pieds largeur de hanches.', 'Asseyez-vous jusqu’à effleurer l’assise, puis relevez-vous sans élan.'], mistakes: ['Se laisser tomber sur l’assise au lieu de descendre avec contrôle.'] },
  },
  air_squat: {
    en: { name: 'Bodyweight squat', cues: ['Feet about shoulder-width apart, toes turned slightly out.', 'Push the knees out in line with the toes as you sit down between your heels.'], mistakes: ['Letting the heels lift off the floor.'] },
    fr: { name: 'Squat au poids du corps', cues: ['Pieds à peu près largeur d’épaules, pointes légèrement ouvertes.', 'Poussez les genoux dans l’axe des pieds en descendant entre les talons.'], mistakes: ['Laisser les talons se décoller du sol.'] },
  },
  goblet_squat: {
    en: { name: 'Goblet squat', cues: ['Hold a dumbbell or kettlebell against your chest with both hands.', 'Keep the chest up and the elbows inside the knees at the bottom.'], mistakes: ['Letting the weight pull the upper back into a rounded position.'] },
    fr: { name: 'Squat gobelet', cues: ['Tenez un haltère ou un kettlebell contre la poitrine à deux mains.', 'Gardez la poitrine haute et les coudes à l’intérieur des genoux en bas.'], mistakes: ['Laisser la charge arrondir le haut du dos.'] },
  },
  barbell_back_squat: {
    en: { name: 'Barbell back squat', cues: ['Bar on your upper back, safety pins set just below your lowest point.', 'Brace, sit down between your hips and stand up with the chest and hips rising together.'], mistakes: ['Squatting heavy without the safety pins set.'] },
    fr: { name: 'Squat arrière à la barre', cues: ['Barre sur le haut du dos, sécurités réglées juste sous votre point le plus bas.', 'Gainez, descendez entre les hanches et remontez poitrine et hanches ensemble.'], mistakes: ['Faire des squats lourds sans régler les sécurités.'] },
  },
  leg_press: {
    en: { name: 'Leg press', cues: ['Feet flat on the platform, hip-width apart, back against the pad.', 'Lower until your knees are bent to about 90 degrees without the lower back lifting from the pad.'], mistakes: ['Locking the knees hard at the top.'] },
    fr: { name: 'Presse à cuisses', cues: ['Pieds à plat sur la plateforme, largeur de hanches, dos contre le dossier.', 'Descendez jusqu’à environ 90 degrés aux genoux sans décoller le bas du dos.'], mistakes: ['Verrouiller brutalement les genoux en haut.'] },
  },
  wall_sit: {
    en: { name: 'Wall sit', cues: ['Back against a wall, slide down until your knees are bent to a comfortable angle.', 'Keep your weight in your heels and breathe steadily.'], mistakes: ['Sliding lower than is comfortable for your knees.'] },
    fr: { name: 'Chaise contre le mur', cues: ['Dos contre un mur, glissez vers le bas jusqu’à un angle confortable pour les genoux.', 'Gardez le poids sur les talons et respirez régulièrement.'], mistakes: ['Descendre plus bas que ce qui est confortable pour les genoux.'] },
  },
  cossack_squat: {
    en: { name: 'Side-to-side squat', cues: ['Very wide stance; sit down over one leg while the other stays straight, toes up.', 'Keep the heel of the bent leg on the floor.'], mistakes: ['Going deeper than your hips allow and losing balance.'] },
    fr: { name: 'Squat latéral alterné', cues: ['Écart très large ; descendez sur une jambe pendant que l’autre reste tendue, pointe vers le haut.', 'Gardez le talon de la jambe pliée au sol.'], mistakes: ['Descendre plus bas que les hanches ne le permettent et perdre l’équilibre.'] },
  },
  assisted_pistol_squat: {
    en: { name: 'Assisted single-leg squat', cues: ['Hold a door frame, post or strap in front of you for balance.', 'Lower on one leg while the other leg reaches forward, using the hands as little as you can.'], mistakes: ['Pulling hard with the arms to stand up.'] },
    fr: { name: 'Squat sur une jambe assisté', cues: ['Tenez un encadrement de porte, un poteau ou une sangle devant vous pour l’équilibre.', 'Descendez sur une jambe pendant que l’autre s’allonge devant, en utilisant le moins possible les mains.'], mistakes: ['Tirer fort avec les bras pour se relever.'] },
  },
  box_pistol_squat: {
    en: { name: 'Single-leg squat to box', cues: ['Stand on one leg in front of a box or bench, the other leg held forward.', 'Sit down to the box under control and stand up on the same leg.'], mistakes: ['Falling onto the box for the last few centimetres.'] },
    fr: { name: 'Squat sur une jambe jusqu’à la caisse', cues: ['Sur une jambe devant une caisse ou un banc, l’autre jambe tendue devant.', 'Asseyez-vous avec contrôle, puis relevez-vous sur la même jambe.'], mistakes: ['Tomber sur la caisse dans les derniers centimètres.'] },
  },
  pistol_squat: {
    en: { name: 'Pistol squat', cues: ['Balance on one foot, the other leg straight in front at hip height.', 'Reach the arms forward as a counterweight and sit all the way down.'], mistakes: ['Letting the knee of the standing leg collapse inwards.'] },
    fr: { name: 'Squat pistol', cues: ['En équilibre sur un pied, l’autre jambe tendue devant à hauteur de hanche.', 'Tendez les bras devant comme contrepoids et descendez complètement.'], mistakes: ['Laisser le genou de la jambe d’appui rentrer vers l’intérieur.'] },
  },
  squat_jump: {
    en: { name: 'Jump squat', cues: ['Squat to a comfortable depth, then jump straight up.', 'Land softly on the balls of your feet and sink back into the next squat.'], mistakes: ['Landing with straight, stiff legs.'] },
    fr: { name: 'Squat sauté', cues: ['Descendez à une profondeur confortable, puis sautez droit vers le haut.', 'Réceptionnez-vous en douceur sur l’avant des pieds et enchaînez le squat suivant.'], mistakes: ['Se réceptionner jambes tendues et raides.'] },
  },
  split_squat: {
    en: { name: 'Split squat', cues: ['Stagger your feet one long step apart, back heel lifted.', 'Lower the back knee straight down towards the floor, then push through the front foot.'], mistakes: ['Standing with the feet in one line, like on a tightrope.'] },
    fr: { name: 'Fente statique', cues: ['Pieds décalés d’un grand pas, talon arrière décollé.', 'Descendez le genou arrière vers le sol, puis poussez sur le pied avant.'], mistakes: ['Placer les pieds sur une même ligne, comme sur un fil.'] },
  },
  reverse_lunge: {
    en: { name: 'Reverse lunge', cues: ['Step one foot back and lower the back knee towards the floor.', 'Push through the front heel to return to standing.'], mistakes: ['Taking a step so short that the front heel lifts.'] },
    fr: { name: 'Fente arrière', cues: ['Reculez un pied et descendez le genou arrière vers le sol.', 'Poussez sur le talon avant pour revenir debout.'], mistakes: ['Faire un pas si court que le talon avant se soulève.'] },
  },
  supported_reverse_lunge: {
    en: { name: 'Supported reverse lunge', cues: ['Stand beside a sturdy chair back or counter and keep one hand on it.', 'Step back only as far and as low as feels steady.'], mistakes: ['Letting go of the support before you feel steady.'] },
    fr: { name: 'Fente arrière avec appui', cues: ['Debout à côté d’un dossier de chaise solide ou d’un plan de travail, une main posée dessus.', 'Reculez seulement aussi loin et aussi bas que vous vous sentez stable.'], mistakes: ['Lâcher l’appui avant de se sentir stable.'] },
  },
  dumbbell_reverse_lunge: {
    en: { name: 'Dumbbell reverse lunge', cues: ['A dumbbell in each hand at your sides, shoulders relaxed.', 'Step back, lower with control and drive back up through the front foot.'], mistakes: ['Leaning the torso far forward over the front knee.'] },
    fr: { name: 'Fente arrière aux haltères', cues: ['Un haltère dans chaque main le long du corps, épaules relâchées.', 'Reculez, descendez avec contrôle et remontez en poussant sur le pied avant.'], mistakes: ['Pencher le buste loin au-dessus du genou avant.'] },
  },
  walking_lunge: {
    en: { name: 'Walking lunge', cues: ['Step forward into a lunge, then bring the back foot through into the next step.', 'Keep your hips square and your steps the same length.'], mistakes: ['Rushing so the knee hits the floor.'] },
    fr: { name: 'Fentes marchées', cues: ['Faites un pas en avant en fente, puis passez le pied arrière pour enchaîner.', 'Gardez les hanches de face et des pas de même longueur.'], mistakes: ['Aller trop vite et cogner le genou au sol.'] },
  },
  bulgarian_split_squat: {
    en: { name: 'Rear-foot-elevated split squat', cues: ['Rear foot on a bench or chair seat, front foot far enough forward.', 'Lower the back knee straight down and keep most of the weight on the front leg.'], mistakes: ['Placing the front foot so close that the heel lifts.'] },
    fr: { name: 'Fente pied arrière surélevé', cues: ['Pied arrière sur un banc ou une chaise, pied avant assez loin devant.', 'Descendez le genou arrière à la verticale et gardez l’essentiel du poids sur la jambe avant.'], mistakes: ['Placer le pied avant si près que le talon se soulève.'] },
  },
  step_up: {
    en: { name: 'Step-up', cues: ['Place one whole foot on a box, bench or sturdy chair.', 'Stand up by pushing through that foot, then step down slowly.'], mistakes: ['Pushing off hard with the back foot.'] },
    fr: { name: 'Montée sur marche', cues: ['Posez tout le pied sur une caisse, un banc ou une chaise solide.', 'Montez en poussant sur ce pied, puis redescendez lentement.'], mistakes: ['Pousser fort avec le pied arrière.'] },
  },
  low_step_up: {
    en: { name: 'Low step-up', cues: ['Use the bottom stair or a low step, with a rail or wall within reach.', 'Step up with one foot, bring the other beside it and step down the same way.'], mistakes: ['Choosing a step so high that you need to swing up.'] },
    fr: { name: 'Montée sur marche basse', cues: ['Utilisez la première marche d’un escalier ou une marche basse, rampe ou mur à portée de main.', 'Montez un pied, ramenez l’autre à côté, puis redescendez de la même manière.'], mistakes: ['Choisir une marche si haute qu’il faut prendre de l’élan.'] },
  },
  lateral_lunge: {
    en: { name: 'Side lunge', cues: ['Step wide to one side and sit back into that hip.', 'Keep the other leg straight and both feet pointing forward.'], mistakes: ['Letting the bent knee move past the toes and inwards.'] },
    fr: { name: 'Fente latérale', cues: ['Faites un grand pas sur le côté et asseyez-vous dans cette hanche.', 'Gardez l’autre jambe tendue et les deux pieds orientés vers l’avant.'], mistakes: ['Laisser le genou plié partir devant les orteils et vers l’intérieur.'] },
  },
  glute_bridge: {
    en: { name: 'Glute bridge', cues: ['Lie on your back, knees bent, feet flat and close to your hips.', 'Press through the heels and lift the hips until knees, hips and shoulders line up.'], mistakes: ['Arching the lower back at the top instead of squeezing the glutes.'] },
    fr: { name: 'Pont fessier', cues: ['Allongé sur le dos, genoux pliés, pieds à plat près des hanches.', 'Poussez sur les talons et levez les hanches jusqu’à aligner genoux, hanches et épaules.'], mistakes: ['Creuser le bas du dos en haut au lieu de serrer les fessiers.'] },
  },
  single_leg_glute_bridge: {
    en: { name: 'Single-leg glute bridge', cues: ['One foot on the floor, the other knee pulled towards your chest.', 'Lift the hips level, without letting one side drop.'], mistakes: ['Pushing with the shoulders and neck.'] },
    fr: { name: 'Pont fessier sur une jambe', cues: ['Un pied au sol, l’autre genou ramené vers la poitrine.', 'Levez les hanches à niveau, sans laisser un côté tomber.'], mistakes: ['Pousser avec les épaules et la nuque.'] },
  },
  hip_thrust_bodyweight: {
    en: { name: 'Bench hip thrust', cues: ['Upper back against a bench or sofa edge, feet flat, knees bent.', 'Drive the hips up until your torso is level, chin slightly tucked.'], mistakes: ['Letting the bench slide backwards.'] },
    fr: { name: 'Hip thrust au poids du corps', cues: ['Haut du dos contre un banc ou le bord d’un canapé, pieds à plat, genoux pliés.', 'Montez les hanches jusqu’à avoir le buste à l’horizontale, menton légèrement rentré.'], mistakes: ['Laisser le banc glisser vers l’arrière.'] },
  },
  dumbbell_hip_thrust: {
    en: { name: 'Dumbbell hip thrust', cues: ['Hold a dumbbell on your hip crease with both hands.', 'Pause for a second at the top with the glutes squeezed.'], mistakes: ['Pushing the knees out wide or letting them fall in.'] },
    fr: { name: 'Hip thrust à l’haltère', cues: ['Tenez un haltère au pli des hanches à deux mains.', 'Marquez une seconde de pause en haut, fessiers serrés.'], mistakes: ['Écarter fortement les genoux ou les laisser rentrer.'] },
  },
  hip_hinge_drill: {
    en: { name: 'Hip hinge drill', cues: ['Hands on your hips, knees soft, push the hips back as if closing a drawer behind you.', 'Keep your back flat and stop when you feel the back of the thighs stretch.'], mistakes: ['Bending the knees into a squat instead of moving the hips back.'] },
    fr: { name: 'Apprentissage de la charnière de hanche', cues: ['Mains sur les hanches, genoux souples, poussez les hanches en arrière comme pour fermer un tiroir.', 'Gardez le dos plat et arrêtez-vous quand l’arrière des cuisses s’étire.'], mistakes: ['Plier les genoux en squat au lieu de reculer les hanches.'] },
  },
  kettlebell_deadlift: {
    en: { name: 'Kettlebell deadlift', cues: ['Kettlebell between your feet, hinge down and grip the handle with a flat back.', 'Stand up by pushing the floor away and squeezing the glutes.'], mistakes: ['Lifting with the arms instead of the legs and hips.'] },
    fr: { name: 'Soulevé de terre au kettlebell', cues: ['Kettlebell entre les pieds, penchez-vous dos plat et saisissez la poignée.', 'Relevez-vous en repoussant le sol et en serrant les fessiers.'], mistakes: ['Soulever avec les bras au lieu des jambes et des hanches.'] },
  },
  dumbbell_romanian_deadlift: {
    en: { name: 'Dumbbell Romanian deadlift', cues: ['Dumbbells in front of your thighs, knees soft.', 'Slide the weights down the legs by pushing the hips back, then stand tall.'], mistakes: ['Letting the dumbbells drift away from the legs.'] },
    fr: { name: 'Soulevé de terre jambes semi-tendues aux haltères', cues: ['Haltères devant les cuisses, genoux souples.', 'Faites glisser les charges le long des jambes en reculant les hanches, puis redressez-vous.'], mistakes: ['Laisser les haltères s’éloigner des jambes.'] },
  },
  barbell_romanian_deadlift: {
    en: { name: 'Barbell Romanian deadlift', cues: ['Start standing with the bar at hip height.', 'Lower the bar along your thighs to just below the knees, keeping the back flat.'], mistakes: ['Rounding the back to reach lower.'] },
    fr: { name: 'Soulevé de terre jambes semi-tendues à la barre', cues: ['Départ debout, barre à hauteur de hanches.', 'Descendez la barre le long des cuisses jusque sous les genoux, dos plat.'], mistakes: ['Arrondir le dos pour descendre plus bas.'] },
  },
  conventional_deadlift: {
    en: { name: 'Barbell deadlift', cues: ['Bar over the middle of your feet, shins close, grip just outside the legs.', 'Brace, push the floor away and keep the bar in contact with your legs.'], mistakes: ['Jerking the bar off the floor.'] },
    fr: { name: 'Soulevé de terre à la barre', cues: ['Barre au-dessus du milieu des pieds, tibias proches, prise juste à l’extérieur des jambes.', 'Gainez, repoussez le sol et gardez la barre au contact des jambes.'], mistakes: ['Arracher la barre du sol d’un coup sec.'] },
  },
  kettlebell_swing: {
    en: { name: 'Kettlebell swing', cues: ['Hike the kettlebell back between your legs like a long pass.', 'Snap the hips forward so the bell floats to chest height; the arms only guide it.'], mistakes: ['Lifting the bell with the shoulders.'] },
    fr: { name: 'Swing au kettlebell', cues: ['Lancez le kettlebell en arrière entre les jambes, comme une longue passe.', 'Projetez les hanches vers l’avant pour que la charge monte à hauteur de poitrine ; les bras ne font que guider.'], mistakes: ['Monter le kettlebell avec les épaules.'] },
  },
  single_leg_rdl_bodyweight: {
    en: { name: 'Single-leg hip hinge', cues: ['Stand on one leg, knee soft, a wall or chair within reach.', 'Tip forward while the free leg reaches back, hips level.'], mistakes: ['Opening the hip of the free leg towards the ceiling.'] },
    fr: { name: 'Charnière de hanche sur une jambe', cues: ['Sur une jambe, genou souple, un mur ou une chaise à portée de main.', 'Basculez vers l’avant pendant que la jambe libre part en arrière, hanches à niveau.'], mistakes: ['Ouvrir la hanche de la jambe libre vers le plafond.'] },
  },
  single_leg_rdl_dumbbell: {
    en: { name: 'Single-leg dumbbell Romanian deadlift', cues: ['Hold the dumbbell in the hand opposite the standing leg.', 'Lower it towards the floor along the standing leg and return tall.'], mistakes: ['Rushing and losing balance at the bottom.'] },
    fr: { name: 'Soulevé de terre sur une jambe à l’haltère', cues: ['Tenez l’haltère dans la main opposée à la jambe d’appui.', 'Descendez-le vers le sol le long de la jambe d’appui, puis redressez-vous.'], mistakes: ['Aller trop vite et perdre l’équilibre en bas.'] },
  },
  nordic_curl_eccentric: {
    en: { name: 'Slow lowering hamstring curl', cues: ['Kneel on a mat with your heels held under something very stable.', 'Lean forward slowly from the knees as one straight line, and catch yourself with your hands.'], mistakes: ['Bending at the hips to shorten the lever.'] },
    fr: { name: 'Descente lente ischio-jambiers à genoux', cues: ['À genoux sur un tapis, talons bloqués sous un support très stable.', 'Penchez-vous lentement depuis les genoux, corps aligné, et rattrapez-vous avec les mains.'], mistakes: ['Plier les hanches pour raccourcir le levier.'] },
  },
  sliding_leg_curl: {
    en: { name: 'Sliding leg curl', cues: ['Lie on your back, heels on a towel on a smooth floor, hips lifted.', 'Pull the heels towards you, then slide them away slowly with the hips up.'], mistakes: ['Letting the hips drop as the legs straighten.'] },
    fr: { name: 'Flexion de jambes glissée', cues: ['Allongé sur le dos, talons sur une serviette sur un sol lisse, hanches levées.', 'Ramenez les talons vers vous, puis éloignez-les lentement en gardant les hanches hautes.'], mistakes: ['Laisser tomber les hanches quand les jambes s’allongent.'] },
  },
  machine_leg_curl: {
    en: { name: 'Machine leg curl', cues: ['Line your knees up with the machine’s pivot point.', 'Curl the pad towards you and return slowly.'], mistakes: ['Lifting the hips off the seat or bench.'] },
    fr: { name: 'Leg curl à la machine', cues: ['Alignez les genoux avec l’axe de la machine.', 'Ramenez le boudin vers vous, puis revenez lentement.'], mistakes: ['Décoller les hanches du siège ou du banc.'] },
  },
  prone_back_extension: {
    en: { name: 'Lying back extension', cues: ['Lie face down, hands by your ears or beside your hips.', 'Lift the chest a few centimetres, keeping the neck long.'], mistakes: ['Throwing the head back to lift higher.'] },
    fr: { name: 'Extension du dos allongé', cues: ['Allongé sur le ventre, mains près des oreilles ou le long des hanches.', 'Soulevez la poitrine de quelques centimètres en gardant la nuque longue.'], mistakes: ['Rejeter la tête en arrière pour monter plus haut.'] },
  },
} as const satisfies Record<string, ExerciseText>;
