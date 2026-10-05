import { resolveTheme, useTheme } from '@dripfunnel/shared/ui'
import { updateProfile, type Profile } from '../../api/profile'
import { messages } from '../../messages'
import { Card } from './parts'

const words = messages.profile.appearance

// "Appearance": this device follows at once (df-store-theme, ui/README.md §4) and the account keeps it
// too (DATA-MODEL §3.3 user.theme). It never changes the shop.
export const Appearance = ({ profile, onSaved, onFailed }: { profile: Profile; onSaved: (profile: Profile) => void; onFailed: () => void }) => {
  const { choice, setChoice } = useTheme('df-store-theme')
  const shown = resolveTheme(choice, typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches)
  const pick = (theme: 'light' | 'dark') => {
    setChoice(theme)
    void updateProfile({ name: profile.name, phone: profile.phone, theme }).then(onSaved, onFailed)
  }
  return (
    <Card title={words.title} sub={words.sub}>
      <div role="radiogroup" aria-label={words.label} className="df-profile-toggle">
        {(['light', 'dark'] as const).map((theme) => (
          <button key={theme} type="button" role="radio" aria-checked={shown === theme} onClick={() => pick(theme)}>
            {words[theme]}
          </button>
        ))}
      </div>
    </Card>
  )
}
