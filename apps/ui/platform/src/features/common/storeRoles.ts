import { messages } from '../../messages'

// A store role by its key ("supplier-admin"), with the supplier's name when it has one.
export const roleOf = (role: string, supplier: string | null = null): string => {
  const words = messages.store.roles
  const name = Object.hasOwn(words, role) ? words[role as keyof typeof words] : role
  return supplier ? `${name} · ${supplier}` : name
}
