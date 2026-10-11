// Vitest's stand-in for the runtime's `cloudflare:workers` (the alias in both vitest configs).
export class WorkerEntrypoint<Env = unknown> {
  protected ctx: ExecutionContext
  protected env: Env
  constructor(ctx: ExecutionContext, env: Env) {
    this.ctx = ctx
    this.env = env
  }
}
