import { GuardrailEventSchema, type GuardrailEvent } from '@fitadapt/shared';
import { z } from 'zod';
import type { KeyValueStore } from '../storage/app-state';

/**
 * M04 → M10 hand-off (docs/specs/M04 Rules: "Sustained loss > 1% BW/week for
 * 3 weeks triggers a supportive notice and hands off to M10 guardrails").
 * M10 (nutrition and energy balance) is not built yet: this port is its
 * stub. Events are kept in an inbox in the encrypted device database, in
 * order, for M10 to consume; M10 decides what follows (for example pausing
 * any calorie-deficit suggestion, S4). Nothing leaves the device and nothing
 * reaches analytics.
 */
export interface NutritionGuardrailPort {
  receive(event: GuardrailEvent): void;
}

const INBOX_KEY = 'm10_guardrail_inbox';
const InboxSchema = z.array(GuardrailEventSchema);

export interface GuardrailInbox extends NutritionGuardrailPort {
  /** Events handed off and not yet consumed by M10, oldest first. */
  pending(): GuardrailEvent[];
  /** M10: takes the pending events (the inbox is emptied). */
  consume(): GuardrailEvent[];
}

export function createGuardrailInbox(kv: KeyValueStore): GuardrailInbox {
  const load = (): GuardrailEvent[] => {
    try {
      return InboxSchema.parse(JSON.parse(kv.get(INBOX_KEY) ?? '[]'));
    } catch {
      return [];
    }
  };
  return {
    receive(event) {
      kv.set(INBOX_KEY, JSON.stringify([...load(), GuardrailEventSchema.parse(event)]));
    },
    pending: load,
    consume() {
      const events = load();
      kv.remove(INBOX_KEY);
      return events;
    },
  };
}
