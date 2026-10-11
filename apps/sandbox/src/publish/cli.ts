import { runStep } from './main'

// `node dist/publish.js build|check …` inside the build image (storefront LIVE-SHOP §4 steps 6–7).
process.exitCode = await runStep(process.argv.slice(2), process.env).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'The step failed.')
  return 1
})
