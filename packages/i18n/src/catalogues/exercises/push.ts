import type { ExerciseText } from './types.js';

/** Horizontal and vertical pushing, dips. See types.ts for the review status. */
export const pushExercises = {
  wall_push_up: {
    en: { name: 'Wall push-up', cues: ['Hands on the wall at shoulder height, a little wider than your shoulders.', 'Keep a straight line from head to heels as your chest moves towards the wall.'], mistakes: ['Letting the hips sag or stick out instead of moving as one piece.'] },
    fr: { name: 'Pompe au mur', cues: ['Mains au mur à hauteur d’épaules, un peu plus écartées que les épaules.', 'Gardez une ligne droite de la tête aux talons pendant que la poitrine approche du mur.'], mistakes: ['Laisser les hanches s’affaisser ou ressortir au lieu de bouger d’un seul bloc.'] },
  },
  incline_push_up_high: {
    en: { name: 'High incline push-up', cues: ['Hands on a stable surface at hip height, such as a sturdy table or counter.', 'Lower your chest to the edge with elbows angled back, then push the surface away.'], mistakes: ['Using a surface that can slide or tip.'] },
    fr: { name: 'Pompe inclinée haute', cues: ['Mains sur une surface stable à hauteur de hanches, comme une table solide ou un plan de travail.', 'Descendez la poitrine vers le bord, coudes orientés vers l’arrière, puis repoussez la surface.'], mistakes: ['Utiliser une surface qui peut glisser ou basculer.'] },
  },
  incline_push_up_low: {
    en: { name: 'Low incline push-up', cues: ['Hands on a bench, box or sturdy chair seat, body in one straight line.', 'Touch the edge with your chest and press back up without shrugging.'], mistakes: ['Dropping the head towards the bench before the chest.'] },
    fr: { name: 'Pompe inclinée basse', cues: ['Mains sur un banc, une caisse ou l’assise d’une chaise solide, corps aligné.', 'Touchez le bord avec la poitrine et remontez sans hausser les épaules.'], mistakes: ['Avancer la tête vers le banc avant la poitrine.'] },
  },
  knee_push_up: {
    en: { name: 'Knee push-up', cues: ['Knees on the floor, hips pushed forward so shoulders, hips and knees line up.', 'Lower until your chest is a fist’s height from the floor, then press up.'], mistakes: ['Bending at the hips so only the upper body moves.'] },
    fr: { name: 'Pompe sur les genoux', cues: ['Genoux au sol, hanches poussées vers l’avant pour aligner épaules, hanches et genoux.', 'Descendez jusqu’à un poing du sol avec la poitrine, puis poussez.'], mistakes: ['Plier les hanches pour ne faire bouger que le haut du corps.'] },
  },
  push_up: {
    en: { name: 'Push-up', cues: ['Hands under your shoulders, squeeze your glutes and brace your stomach.', 'Lower as one plank until your chest nearly touches the floor, elbows at about 45 degrees.'], mistakes: ['Flaring the elbows straight out to the sides.'] },
    fr: { name: 'Pompe', cues: ['Mains sous les épaules, serrez les fessiers et gainez le ventre.', 'Descendez en planche jusqu’à frôler le sol avec la poitrine, coudes à environ 45 degrés.'], mistakes: ['Écarter les coudes à l’horizontale sur les côtés.'] },
  },
  decline_push_up: {
    en: { name: 'Feet-elevated push-up', cues: ['Feet on a bench, box or chair seat, hands on the floor under your shoulders.', 'Keep the lower back neutral as you lower your chest.'], mistakes: ['Letting the lower back arch as the feet go higher.'] },
    fr: { name: 'Pompe pieds surélevés', cues: ['Pieds sur un banc, une caisse ou une chaise, mains au sol sous les épaules.', 'Gardez le bas du dos neutre pendant la descente.'], mistakes: ['Laisser le bas du dos se creuser quand les pieds montent.'] },
  },
  diamond_push_up: {
    en: { name: 'Close-hands push-up', cues: ['Hands close together under your chest, thumbs and index fingers almost touching.', 'Keep the elbows close to your ribs on the way down.'], mistakes: ['Letting the shoulders roll forward at the bottom.'] },
    fr: { name: 'Pompe mains rapprochées', cues: ['Mains rapprochées sous la poitrine, pouces et index presque en contact.', 'Gardez les coudes près des côtes pendant la descente.'], mistakes: ['Laisser les épaules s’enrouler vers l’avant en bas.'] },
  },
  deficit_push_up: {
    en: { name: 'Deficit push-up', cues: ['Hands on parallettes or dumbbell handles so the chest can go lower than the hands.', 'Go only as deep as your shoulders stay comfortable.'], mistakes: ['Forcing extra depth by letting the shoulders drop forward.'] },
    fr: { name: 'Pompe en amplitude augmentée', cues: ['Mains sur des parallettes ou des haltères pour que la poitrine descende plus bas que les mains.', 'Ne descendez que tant que les épaules restent à l’aise.'], mistakes: ['Chercher plus d’amplitude en laissant tomber les épaules vers l’avant.'] },
  },
  archer_push_up: {
    en: { name: 'Archer push-up', cues: ['Hands very wide; shift your weight onto one arm while the other stays almost straight.', 'Alternate sides or finish all reps on one side before switching.'], mistakes: ['Twisting the hips to make the working arm’s job easier.'] },
    fr: { name: 'Pompe archer', cues: ['Mains très écartées ; transférez le poids sur un bras pendant que l’autre reste presque tendu.', 'Alternez les côtés ou finissez toutes les répétitions d’un côté avant de changer.'], mistakes: ['Tourner les hanches pour soulager le bras qui travaille.'] },
  },
  pseudo_planche_push_up: {
    en: { name: 'Leaning planche push-up', cues: ['Hands turned slightly out, lean your shoulders forward past your hands.', 'Keep that forward lean during the whole rep.'], mistakes: ['Leaning further than your wrists tolerate on the first sessions.'] },
    fr: { name: 'Pompe penchée (préparation planche)', cues: ['Mains légèrement tournées vers l’extérieur, penchez les épaules en avant des mains.', 'Gardez cette inclinaison pendant toute la répétition.'], mistakes: ['Se pencher plus loin que les poignets ne le tolèrent dès les premières séances.'] },
  },
  ring_push_up: {
    en: { name: 'Ring push-up', cues: ['Rings or suspension handles a few centimetres above the floor, arms straight to start.', 'Keep the rings close to your body and steady as you lower.'], mistakes: ['Letting the rings drift apart at the bottom.'] },
    fr: { name: 'Pompe aux anneaux', cues: ['Anneaux ou poignées de sangle à quelques centimètres du sol, bras tendus au départ.', 'Gardez les anneaux près du corps et stables pendant la descente.'], mistakes: ['Laisser les anneaux s’écarter en bas du mouvement.'] },
  },
  dumbbell_floor_press: {
    en: { name: 'Dumbbell floor press', cues: ['Lie on your back, knees bent, a dumbbell in each hand above your chest.', 'Lower until your upper arms rest on the floor, pause, then press up.'], mistakes: ['Bouncing the elbows off the floor.'] },
    fr: { name: 'Développé au sol aux haltères', cues: ['Allongé sur le dos, genoux pliés, un haltère dans chaque main au-dessus de la poitrine.', 'Descendez jusqu’à poser les bras au sol, marquez une pause, puis poussez.'], mistakes: ['Faire rebondir les coudes sur le sol.'] },
  },
  dumbbell_bench_press: {
    en: { name: 'Dumbbell bench press', cues: ['Feet flat, shoulder blades pulled back and down against the bench.', 'Lower the dumbbells to the sides of your chest, forearms vertical.'], mistakes: ['Lifting the hips off the bench to press.'] },
    fr: { name: 'Développé couché aux haltères', cues: ['Pieds à plat, omoplates serrées et abaissées contre le banc.', 'Descendez les haltères sur les côtés de la poitrine, avant-bras verticaux.'], mistakes: ['Décoller les hanches du banc pour pousser.'] },
  },
  barbell_bench_press: {
    en: { name: 'Barbell bench press', cues: ['Grip slightly wider than your shoulders, eyes under the bar, safety arms set.', 'Lower the bar to your lower chest under control and press back over your shoulders.'], mistakes: ['Training heavy sets without safety arms or a spotter.'] },
    fr: { name: 'Développé couché à la barre', cues: ['Prise un peu plus large que les épaules, yeux sous la barre, sécurités réglées.', 'Descendez la barre sur le bas de la poitrine avec contrôle, puis repoussez au-dessus des épaules.'], mistakes: ['Faire des séries lourdes sans sécurités ni partenaire.'] },
  },
  band_chest_press: {
    en: { name: 'Band chest press', cues: ['Band around your upper back, one end in each hand at chest height.', 'Press both hands straight forward and return slowly.'], mistakes: ['Letting the band snap the hands back.'] },
    fr: { name: 'Développé poitrine à l’élastique', cues: ['Élastique autour du haut du dos, une extrémité dans chaque main à hauteur de poitrine.', 'Poussez les deux mains droit devant, puis revenez lentement.'], mistakes: ['Laisser l’élastique ramener les mains d’un coup.'] },
  },
  machine_chest_press: {
    en: { name: 'Machine chest press', cues: ['Set the seat so the handles line up with the middle of your chest.', 'Press forward without locking the elbows hard, then return with control.'], mistakes: ['Setting the seat so low that the shoulders roll forward.'] },
    fr: { name: 'Presse pectoraux à la machine', cues: ['Réglez le siège pour que les poignées soient au niveau du milieu de la poitrine.', 'Poussez sans verrouiller brutalement les coudes, puis revenez avec contrôle.'], mistakes: ['Régler le siège si bas que les épaules s’enroulent.'] },
  },
  hands_elevated_pike_push_up: {
    en: { name: 'Hands-elevated pike push-up', cues: ['Hands on a stable surface at hip height, walk the feet in until the hips are high.', 'Bend the elbows to bring the top of your head towards the edge, then press away.'], mistakes: ['Letting the hips drop so it turns into an incline push-up.'] },
    fr: { name: 'Pompe en V mains surélevées', cues: ['Mains sur une surface stable à hauteur de hanches, rapprochez les pieds jusqu’à avoir les hanches hautes.', 'Pliez les coudes pour amener le sommet de la tête vers le bord, puis repoussez.'], mistakes: ['Laisser descendre les hanches, ce qui en fait une pompe inclinée.'] },
  },
  pike_push_up: {
    en: { name: 'Pike push-up', cues: ['Hips high in an upside-down V, hands shoulder-width apart.', 'Lower the top of your head towards a point just in front of your hands.'], mistakes: ['Lowering the face straight down between the hands.'] },
    fr: { name: 'Pompe en V inversé', cues: ['Hanches hautes en V inversé, mains écartées de la largeur des épaules.', 'Descendez le sommet de la tête vers un point juste devant les mains.'], mistakes: ['Descendre le visage tout droit entre les mains.'] },
  },
  elevated_pike_push_up: {
    en: { name: 'Feet-elevated pike push-up', cues: ['Feet on a box or bench, hips stacked as close to above the shoulders as you can.', 'Lower slowly and keep the elbows in front of the body.'], mistakes: ['Rushing the lowering phase.'] },
    fr: { name: 'Pompe en V pieds surélevés', cues: ['Pieds sur une caisse ou un banc, hanches le plus possible au-dessus des épaules.', 'Descendez lentement en gardant les coudes devant le corps.'], mistakes: ['Descendre trop vite.'] },
  },
  wall_handstand_hold: {
    en: { name: 'Wall handstand hold', cues: ['Walk your feet up the wall with your chest facing it, hands a short distance from the wall.', 'Push the floor away and keep your ribs tucked.'], mistakes: ['Holding the breath through the whole hold.'] },
    fr: { name: 'Équilibre sur les mains au mur', cues: ['Montez les pieds le long du mur, ventre face au mur, mains à courte distance du mur.', 'Repoussez le sol et gardez les côtes rentrées.'], mistakes: ['Bloquer la respiration pendant tout le maintien.'] },
  },
  seated_dumbbell_shoulder_press: {
    en: { name: 'Seated dumbbell shoulder press', cues: ['Sit tall with the backrest upright, dumbbells at shoulder height.', 'Press up and slightly in, finishing with the arms beside your ears.'], mistakes: ['Arching the lower back away from the backrest.'] },
    fr: { name: 'Développé épaules assis aux haltères', cues: ['Assis bien droit, dossier vertical, haltères à hauteur d’épaules.', 'Poussez vers le haut et légèrement vers l’intérieur, bras près des oreilles en fin de mouvement.'], mistakes: ['Creuser le bas du dos en s’écartant du dossier.'] },
  },
  half_kneeling_dumbbell_press: {
    en: { name: 'Half-kneeling one-arm dumbbell press', cues: ['One knee down, the dumbbell on the same side as the knee on the floor.', 'Squeeze the glute of the down leg and press without leaning away.'], mistakes: ['Leaning the torso sideways to finish the press.'] },
    fr: { name: 'Développé un bras à genou, haltère', cues: ['Un genou au sol, l’haltère du même côté que ce genou.', 'Serrez le fessier de la jambe au sol et poussez sans vous pencher.'], mistakes: ['Pencher le buste sur le côté pour finir la poussée.'] },
  },
  standing_dumbbell_press: {
    en: { name: 'Standing dumbbell press', cues: ['Feet hip-width apart, glutes and stomach braced.', 'Press straight up and bring the dumbbells back to your shoulders slowly.'], mistakes: ['Leaning back to push the weight up.'] },
    fr: { name: 'Développé debout aux haltères', cues: ['Pieds largeur de hanches, fessiers et ventre gainés.', 'Poussez tout droit, puis ramenez les haltères aux épaules lentement.'], mistakes: ['Se pencher en arrière pour monter la charge.'] },
  },
  barbell_overhead_press: {
    en: { name: 'Barbell overhead press', cues: ['Bar on the front of your shoulders, grip just outside them.', 'Move your head back slightly as the bar passes your face, then under the bar at the top.'], mistakes: ['Pushing the bar forward instead of straight up.'] },
    fr: { name: 'Développé militaire à la barre', cues: ['Barre posée à l’avant des épaules, prise juste à l’extérieur.', 'Reculez légèrement la tête au passage de la barre, puis revenez sous la barre en haut.'], mistakes: ['Pousser la barre vers l’avant au lieu de la monter droit.'] },
  },
  band_overhead_press: {
    en: { name: 'Band overhead press', cues: ['Stand on the middle of the band, ends at shoulder height.', 'Press up without arching your back, then lower slowly.'], mistakes: ['Standing on the band with too little of the foot, so it can slip.'] },
    fr: { name: 'Développé épaules à l’élastique', cues: ['Debout sur le milieu de l’élastique, extrémités à hauteur d’épaules.', 'Poussez vers le haut sans creuser le dos, puis redescendez lentement.'], mistakes: ['Ne poser qu’une petite partie du pied sur l’élastique, qui peut glisser.'] },
  },
  bench_dip: {
    en: { name: 'Bench dip', cues: ['Hands on the edge of a stable bench or chair, fingers forward, hips close to the edge.', 'Bend the elbows only until the upper arms are level with the floor.'], mistakes: ['Dipping so deep that the shoulders roll forward.'] },
    fr: { name: 'Dips sur banc', cues: ['Mains au bord d’un banc ou d’une chaise stable, doigts vers l’avant, hanches près du bord.', 'Pliez les coudes seulement jusqu’à ce que les bras soient à l’horizontale.'], mistakes: ['Descendre si bas que les épaules s’enroulent vers l’avant.'] },
  },
  parallel_bar_support_hold: {
    en: { name: 'Parallel bar support hold', cues: ['Arms straight, shoulders pushed down away from your ears.', 'Keep your legs together and your body still.'], mistakes: ['Letting the shoulders shrug up towards the ears.'] },
    fr: { name: 'Maintien en appui aux barres parallèles', cues: ['Bras tendus, épaules poussées vers le bas, loin des oreilles.', 'Gardez les jambes serrées et le corps immobile.'], mistakes: ['Laisser les épaules remonter vers les oreilles.'] },
  },
  negative_dip: {
    en: { name: 'Slow lowering dip', cues: ['Start at the top of the bars and lower yourself over three to five seconds.', 'Step back up to the top instead of pressing.'], mistakes: ['Dropping quickly through the bottom half.'] },
    fr: { name: 'Dips en descente lente', cues: ['Partez en haut des barres et descendez en trois à cinq secondes.', 'Remontez en vous aidant des pieds plutôt qu’en poussant.'], mistakes: ['Tomber rapidement dans la seconde moitié de la descente.'] },
  },
  parallel_bar_dip: {
    en: { name: 'Parallel bar dip', cues: ['Lean slightly forward and lower until your shoulders are just below your elbows.', 'Press back to straight arms without swinging the legs.'], mistakes: ['Going deeper than your shoulders tolerate.'] },
    fr: { name: 'Dips aux barres parallèles', cues: ['Penchez-vous légèrement et descendez jusqu’à ce que les épaules passent juste sous les coudes.', 'Remontez bras tendus sans balancer les jambes.'], mistakes: ['Descendre plus bas que les épaules ne le tolèrent.'] },
  },
  ring_support_hold: {
    en: { name: 'Ring support hold', cues: ['Arms straight, rings held close to your hips.', 'Turn the rings slightly out if you can and keep them from shaking.'], mistakes: ['Letting the arms bend while holding.'] },
    fr: { name: 'Maintien en appui aux anneaux', cues: ['Bras tendus, anneaux près des hanches.', 'Tournez légèrement les anneaux vers l’extérieur si possible et limitez les tremblements.'], mistakes: ['Laisser les bras se plier pendant le maintien.'] },
  },
  ring_dip: {
    en: { name: 'Ring dip', cues: ['From the support hold, lower with the rings close to your ribs.', 'Press back up and finish with straight arms and steady rings.'], mistakes: ['Letting the rings drift away from the body at the bottom.'] },
    fr: { name: 'Dips aux anneaux', cues: ['Depuis l’appui, descendez en gardant les anneaux près des côtes.', 'Remontez et finissez bras tendus, anneaux stables.'], mistakes: ['Laisser les anneaux s’éloigner du corps en bas.'] },
  },
} as const satisfies Record<string, ExerciseText>;
