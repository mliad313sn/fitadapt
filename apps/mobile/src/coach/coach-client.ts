import {
  CoachMessageResponseSchema,
  StartConversationResponseSchema,
  type CoachContext,
  type CoachMessageResponse,
  type Locale,
  type StartConversationResponse,
} from '@fitadapt/shared';

/**
 * The API's AI-coach endpoints (M11). The model runs behind the API only:
 * this client sends the user's text and the minimal context, never a
 * provider key (the app holds none).
 */
export interface CoachClient {
  start(locale: Locale, jurisdiction: string): Promise<StartConversationResponse>;
  send(conversationId: string, text: string, context: CoachContext): Promise<CoachMessageResponse>;
}

export class CoachRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`coach request failed with status ${status}`);
    this.name = 'CoachRequestError';
  }
}

export function createHttpCoachClient(deps: { baseUrl: string; getAccessToken: () => string | Promise<string>; fetch?: typeof fetch }): CoachClient {
  const doFetch = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const post = async (path: string, body: unknown) => {
    const res = await doFetch(`${deps.baseUrl}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await deps.getAccessToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    if (!res.ok) throw new CoachRequestError(res.status, json?.error?.code ?? null);
    return json;
  };
  return {
    async start(locale, jurisdiction) {
      return StartConversationResponseSchema.parse(await post('/v1/coach/conversations', { locale, jurisdiction }));
    },
    async send(conversationId, text, context) {
      return CoachMessageResponseSchema.parse(await post(`/v1/coach/conversations/${conversationId}/messages`, { text, context }));
    },
  };
}
