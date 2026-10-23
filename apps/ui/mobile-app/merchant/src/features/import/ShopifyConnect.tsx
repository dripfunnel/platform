import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, Linking, StyleSheet, Text, View } from 'react-native'
import { connectShopify, loadShopifyConnection, type ShopifyConnection } from '../../api/imports'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { errorMessage } from '../../messages/errorMessage'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../common/Button'
import { Notice } from '../common/Notice'
import { SectionCard } from '../common/SectionCard'
import { TextField } from '../common/TextField'

type Props = { client: ApiClient; onConnected: (shop: string) => void }

// Shopify's approval ends on the portal's page in the phone's browser (the app takes no links back, DESIGN.md §5), so the
// connection is read again when the app comes to the front, and the picker opens once it says connected (K7).
export function ShopifyConnect({ client, onConnected }: Props) {
  const { colors } = useTheme()
  const [connection, setConnection] = useState<ShopifyConnection | null>(null)
  const [shop, setShop] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [opened, setOpened] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const live = useRef(true)

  const read = useCallback(
    (afterReturn: boolean) =>
      loadShopifyConnection(client).then(
        (found) => {
          if (!live.current) return
          if (found.status === 'connected' && found.shop) return onConnected(found.shop)
          setConnection(found)
          setProblem(found.status === 'expired' ? t('imports.shopify.expired') : afterReturn ? t('imports.shopify.notYet') : null)
        },
        () => live.current && setProblem(t('imports.shopify.away')),
      ),
    [client, onConnected],
  )

  useEffect(() => {
    live.current = true
    void read(false)
    return () => {
      live.current = false
    }
  }, [read])

  useEffect(() => {
    if (!opened) return
    const subscription = AppState.addEventListener('change', (next) => next === 'active' && void read(true))
    return () => subscription.remove()
  }, [opened, read])

  const connect = async () => {
    const name = shop.trim().replace(/\.myshopify\.com$/i, '')
    if (name === '') return setProblem(t('imports.shopify.required'))
    setConnecting(true)
    setProblem(null)
    try {
      const address = await connectShopify(client, `${name}.myshopify.com`)
      if (new URL(address).protocol !== 'https:') throw new Error('Shopify’s address is not https')
      await Linking.openURL(address)
      setOpened(true)
    } catch (error) {
      setProblem(errorMessage(error, 'imports'))
    }
    setConnecting(false)
  }

  if (connection && !connection.available) return <Notice text={t('imports.shopify.unavailable')} />
  return (
    <SectionCard title={t('imports.shopify.title')}>
      {problem ? <Notice kind="error" text={problem} /> : null}
      {opened && !problem ? <Notice text={t('imports.shopify.waiting')} /> : null}
      <View style={styles.row}>
        <View style={styles.field}>
          <TextField label={t('imports.shopify.address')} value={shop} onChangeText={setShop} placeholder={t('imports.shopify.placeholder')} keyboardType="url" returnKeyType="go" onSubmitEditing={() => void connect()} editable={!connecting} />
        </View>
        <Text style={[styles.suffix, { color: colors.muted }]}>{t('imports.shopify.suffix')}</Text>
      </View>
      <Button label={connecting ? t('imports.shopify.connecting') : connection?.status === 'expired' ? t('imports.shopify.again') : t('imports.shopify.connect')} onPress={() => void connect()} busy={connecting} saves />
      {opened ? <Button kind="secondary" label={t('imports.shopify.checkAgain')} onPress={() => void read(true)} /> : null}
      <Text style={[styles.note, { color: colors.muted }]}>{t('imports.shopify.note')}</Text>
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  field: { flex: 1 },
  suffix: { fontSize: 13, paddingBottom: 16 },
  note: { fontSize: 13, lineHeight: 19 },
})
