// `cloudflare:workers` under Node (the alias in both vitest configs): the entrypoint base classes.
export class WorkerEntrypoint<Env = unknown> {
  protected ctx: ExecutionContext
  protected env: Env
  constructor(ctx: ExecutionContext, env: Env) {
    this.ctx = ctx
    this.env = env
  }
}

// The Durable Object base class, never run in a test: the studio's logic is tested through saas/studio's StudioRunner.
export class DurableObject<Env = unknown> {
  protected ctx: DurableObjectState
  protected env: Env
  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx
    this.env = env
  }
}

// The Workflow base class, never run in a test.
export abstract class WorkflowEntrypoint<Env = unknown> {
  protected env: Env
  constructor(_ctx: unknown, env: Env) {
    this.env = env
  }
}
