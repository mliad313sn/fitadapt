import { describe, expect, it } from 'vitest';
import { gymContext } from './__fixtures__/context.js';
import { aboutTraining, jointIn, parseIntents } from './intents.js';

const ctx = gymContext();
const tools = (t: string, previous: string | null = null) => parseIntents(t, ctx, previous).map((i) => (i.kind === 'tool' ? [i.tool, i.input] : [i.kind]));

describe('deterministic intents (offline coach, routing, eval mock)', () => {
  it.each([
    ['I only have 30 minutes', [['adjustSessionTime', { minutes: 30 }]]],
    ['Je n’ai que 20 min', [['adjustSessionTime', { minutes: 20 }]]],
    ['I have an hour today', [['adjustSessionTime', { minutes: 60 }]]],
    ['Can we make it shorter?', [['adjustSessionTime', { minutes: 30 }]]],
    ['je suis crevé, plus léger aujourd’hui', [['requestDeload', {}]]],
    ['I’m tired, go easy', [['requestDeload', {}]]],
    ['I can’t train today', [['reschedule', {}]]],
    ['je ne peux pas m’entraîner aujourd’hui', [['reschedule', {}]]],
    ['My shoulder hurts 6/10', [['logPain', { joint: 'shoulder', score: 6 }]]],
    ['j’ai mal au genou, 5 sur 10', [['logPain', { joint: 'knee', score: 5 }]]],
    ['my lower back is sore', [['ask_pain_score']]],
    ['Swap the second exercise, no bench', [['swapExercise', { exerciseIndex: 1, reason: 'equipment' }]]],
    ['Replace the back squat with goblet squat', [['swapExercise', { exerciseIndex: 0, reason: 'user', preferredExerciseId: 'goblet_squat' }]]],
    ['remplace le dernier exercice', [['swapExercise', { exerciseIndex: 5, reason: 'user' }]]],
    ['Why 3 sets on the squat?', [['explainPrescription', { exerciseIndex: 0 }]]],
    ['pourquoi ce plan ?', [['explainPrescription', {}]]],
    ['hello', [['greeting']]],
    ['merci !', [['thanks']]],
  ])('%s', (text, expected) => {
    expect(tools(text)).toEqual(expected);
  });

  it('a bare score answers the pain question of the previous message', () => {
    expect(tools('7', 'my knee hurts')).toEqual([['logPain', { joint: 'knee', score: 7 }]]);
    expect(tools('7', 'hello')).toEqual([]);
    expect(tools('7')).toEqual([]);
  });

  it('knows joints and training topics', () => {
    expect(jointIn('mon poignet')).toBe('wrist');
    expect(jointIn('the weather')).toBeNull();
    expect(aboutTraining('best shoes for running?')).toBe(true);
    expect(aboutTraining('capital of Peru')).toBe(false);
    // No plan: nothing to swap or shorten by default.
    expect(parseIntents('swap the first exercise', gymContext({ withPlan: false }))).toEqual([]);
  });
});
