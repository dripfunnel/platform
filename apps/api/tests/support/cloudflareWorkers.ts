// `cloudflare:workers` under Node (vitest.config.ts): the Workflow base class, never run in a test.
export abstract class WorkflowEntrypoint<Env = unknown> {
  protected env: Env
  constructor(_ctx: unknown, env: Env) {
    this.env = env
  }
}
