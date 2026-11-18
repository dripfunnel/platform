import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import type { DesignRunOutput, DesignRunParams } from '#saas/ai-designer/index'

// One step, never retried: the agent's clock (agentBuildMs) with the gate after it, and a step run again by the engine
// finds its request already taken (AI-STUDIO §4 "A design run").
const stepConfig = { retries: { limit: 0, delay: '1 second', backoff: 'constant' }, timeout: '20 minutes' } as const

/** askDesign's or buildDesignPlan's run; index.ts, which alone opens connections, passes the step's work. */
export const designRunWorkflow = <Env>(design: (env: Env, params: DesignRunParams) => Promise<DesignRunOutput>) =>
  class DesignRun extends WorkflowEntrypoint<Env, DesignRunParams> {
    override async run(event: Readonly<WorkflowEvent<DesignRunParams>>, step: WorkflowStep): Promise<DesignRunOutput> {
      return step.do('design', stepConfig, () => design(this.env, event.payload))
    }
  }
