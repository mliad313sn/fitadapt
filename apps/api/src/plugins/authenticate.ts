import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthService } from '../auth/service.js';
import { authErrors } from '../auth/errors.js';
import type { AccessClaims } from '../auth/tokens.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AccessClaims;
  }
}

export function authenticate(auth: AuthService) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const header = request.headers.authorization;
    const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
    if (!match?.[1]) throw authErrors.unauthorized();
    request.auth = await auth.authenticate(match[1]);
  };
}

export function requireAuth(request: FastifyRequest): AccessClaims {
  if (!request.auth) throw authErrors.unauthorized();
  return request.auth;
}
