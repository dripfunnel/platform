import { resolveTheme, useTheme } from '@dripfunnel/shared/ui'
import { useRef } from 'react'
import { setTheme, type Profile } from '../../api/profile'
import { messages } from '../../messages'
import { Card } from './parts'

const words = messages.profile.appearance

// "Appearance": this device follows at once (df-store-theme, ui/README.md §4) and the account keeps it
// too (DATA-MODEL §3.3 user.theme). It never changes the shop.
export const Appearance = ({ saved, onSaved, onFailed }: { saved: Profile['theme']; onSaved: (profile: Profile) => void; onFailed: () => void }) => {
  const { choice, setChoice } = useTheme('df-store-theme')
  const shown = resolveTheme(choice, typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches)
  const latest = useRef(0)
  // Only the latest pick answers: a refusal puts the device back to what the account holds, so they agree.
  const pick = (theme: 'light' | 'dark') => {
    const mine = ++latest.current
    setChoice(theme)
    void setTheme(theme).then(
      (profile) => mine === latest.current && onSaved(profile),
      () => {
        if (mine !== latest.current) return
        setChoice(saved ?? 'system')
        onFailed()
      },
    )
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
