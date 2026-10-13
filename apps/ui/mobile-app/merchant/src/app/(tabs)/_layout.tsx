import { Tabs } from 'expo-router'
import messages from '../../messages/en.json'

export default function TabsLayout() {
  return (
    <Tabs>
      <Tabs.Screen name="home" options={{ title: messages.tabs.home }} />
      <Tabs.Screen name="orders" options={{ title: messages.tabs.orders }} />
      <Tabs.Screen name="catalogue" options={{ title: messages.tabs.catalogue }} />
      <Tabs.Screen name="offers" options={{ title: messages.tabs.offers }} />
      <Tabs.Screen name="more" options={{ title: messages.tabs.more }} />
    </Tabs>
  )
}
