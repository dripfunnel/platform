import { Redirect } from 'expo-router'
import { HermesCheckScreen } from '../features/hermesCheck/HermesCheckScreen'

export default function HermesCheck() {
  return __DEV__ ? <HermesCheckScreen /> : <Redirect href="/" />
}
