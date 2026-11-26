import { demoParams, fillDemo, type DemoFillDeps } from '#saas/storefrontTemplates/demo'
import { GiveUp, type Deliverer } from '../outbox-relay'

/** `template.demo`: fills a category template's demo store once it is made (admin FIRST-RELEASE §11d). Longer than the
 *  relay's 10 s, as the catalog import's: it copies the template's preview, core's runtime with it. */
export const templateDemoDeliverer = (deps: DemoFillDeps): Deliverer => ({
  timeoutMs: 60_000,
  deliver: async (effect) => {
    const parsed = demoParams.safeParse(effect.payload)
    if (!parsed.success) throw new GiveUp('bad_payload')
    if ((await fillDemo(deps, parsed.data)) === 'gone') throw new GiveUp('no_demo_store')
  },
})
