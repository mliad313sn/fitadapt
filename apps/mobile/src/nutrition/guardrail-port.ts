import { GuardrailEventSchema, type GuardrailEvent } from '@fitadapt/shared';
import { z } from 'zod';
import type { KeyValueStore } from '../storage/app-state';

/**
 * M04 → M10 hand-off (docs/specs/M04 Rules: "Sustained loss > 1% BW/week for
 * 3 weeks triggers a supportive notice and hands off to M10 guardrails").
 * Events are kept in an inbox in the encrypted device database, in order.
 * M10 handles each one as it arrives (`onReceive`: the nutrition store
 * remembers it, and the engine pauses and then reduces any planned deficit,
 * S4 — see NutritionProvider); the inbox holds it until the user has seen
 * the supportive notice on the nutrition screen, which then consumes it.
 * Nothing leaves the device and nothing reaches analytics.
 */
export interface NutritionGuardrailPort {
  receive(event: GuardrailEvent): void;
}

const INBOX_KEY = 'm10_guardrail_inbox';
const InboxSchema = z.array(GuardrailEventSchema);

export interface GuardrailInbox extends NutritionGuardrailPort {
  /** Events handed off and not yet consumed by M10, oldest first. */
  pending(): GuardrailEvent[];
  /** M10: takes the pending events once their notice was seen (the inbox is emptied). */
  consume(): GuardrailEvent[];
}

export function createGuardrailInbox(kv: KeyValueStore, onReceive?: (event: GuardrailEvent) => void): GuardrailInbox {
  const load = (): GuardrailEvent[] => {
    try {
      return InboxSchema.parse(JSON.parse(kv.get(INBOX_KEY) ?? '[]'));
    } catch {
      return [];
    }
  };
  return {
    receive(event) {
      const parsed = GuardrailEventSchema.parse(event);
      kv.set(INBOX_KEY, JSON.stringify([...load(), parsed]));
      onReceive?.(parsed);
    },
    pending: load,
    consume() {
      const events = load();
      kv.remove(INBOX_KEY);
      return events;
    },
  };
}
