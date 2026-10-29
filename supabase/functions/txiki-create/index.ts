import { createRpc, createTurnstileVerifier } from '../_shared/deps.ts'
import { requireEnv } from '../_shared/env.ts'
import { handleCreate } from '../_shared/handlers.ts'

const deps = {
  rpc: createRpc(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY')),
  verifyTurnstile: createTurnstileVerifier(requireEnv('TURNSTILE_SECRET')),
}

Deno.serve((req: Request) => handleCreate(req, deps))
