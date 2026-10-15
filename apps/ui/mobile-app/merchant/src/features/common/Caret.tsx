import { Text } from 'react-native'
import { t } from '../../messages'

// The ▾ that marks a control as opening a choice. It is decoration: the control's own label says what it is, so a screen reader skips it.
export function Caret({ color }: { color: string }) {
  return (
    <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ color }}>
      {` ${t('shell.caret')}`}
    </Text>
  )
}
