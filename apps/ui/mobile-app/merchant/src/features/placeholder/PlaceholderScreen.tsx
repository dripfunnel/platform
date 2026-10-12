import { StyleSheet, Text, View } from 'react-native'
import messages from '../../messages/en.json'

export function PlaceholderScreen({ title }: { title: string }) {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{title}</Text>
      <Text>{messages.placeholder.body}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 20, fontWeight: '700' },
})
