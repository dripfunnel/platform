import { z } from 'zod'
import { ignoreNotFound, request } from './http'

const api = 'https://console.neon.tech/api/v2'
const branches = z.object({ branches: z.array(z.looseObject({ id: z.string(), name: z.string(), default: z.boolean().optional() })) })

export type Neon = ReturnType<typeof neon>

export const neon = (token: string, projectId: string) => {
  const list = async () => branches.parse(await request(`${api}/projects/${projectId}/branches`, token)).branches

  return {
    branchNames: async () => (await list()).map((b) => b.name),

    deleteBranch: async (name: string) => {
      const branch = (await list()).find((b) => b.name === name)
      if (!branch) return
      if (branch.default) throw new Error(`Refusing to delete the default Neon branch "${name}".`)
      await ignoreNotFound(() => request(`${api}/projects/${projectId}/branches/${branch.id}`, token, { method: 'DELETE' }))
    },
  }
}
