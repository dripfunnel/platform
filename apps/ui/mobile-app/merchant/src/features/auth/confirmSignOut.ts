import { Alert } from 'react-native'
import { t } from '../../messages'
import { flowDeps } from './deps'
import { signOut } from './signInFlow'

// "Signs you out of every store on this device" (DESIGN.md §2): asked first, then the session ends everywhere.
export const confirmSignOut = (): void => {
  Alert.alert(t('auth.signOutTitle'), t('auth.signOutBody'), [
    { text: t('common.cancel'), style: 'cancel' },
    { text: t('auth.signOutConfirm'), style: 'destructive', onPress: () => void signOut(flowDeps()) },
  ])
}
