import { runStep } from '../publish/main'

// Runs the build step in this process, then tries the network as the theme's code would: it must find none.
if ((await runStep(['build', ...process.argv.slice(2)], process.env)) !== 0) process.exit(1)
try {
  await fetch('http://127.0.0.1:9/')
  console.log('reached')
} catch (error) {
  console.log(error instanceof Error ? error.name : 'failed')
}
