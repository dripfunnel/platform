import { useRouter } from 'expo-router'
import { useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { useReloadOnFocus } from '../collections/useReloadOnFocus'
import { Button } from '../common/Button'
import { stateOfError } from '../common/useLoad'
import { ListMessage } from '../orders/ListMessage'
import { ShellScreen } from '../states/ShellScreen'
import { Skeleton } from '../states/StateView'
import type { CartsAccess } from './access'
import { CartCard, type CartAction } from './CartCard'
import { CartNotes } from './CartNotes'
import { CartSheets, type CartSheet } from './CartSheets'
import { CartTiles } from './CartTiles'
import { CartsFilters } from './CartsFilters'
import { CartsFirstRun } from './CartsFirstRun'
import { senderOf } from './cartText'
import { cartHref } from './routes'
import type { CartFacts } from './useCartFacts'
import { useCartList } from './useCartList'

type Props = { access: CartsAccess; client: ApiClient; facts: CartFacts; onSetUp: () => void }

// Abandoned carts (Carts; FIRST-RELEASE (store) §9): the last 14 days' tiles, the carts by where they stand with search and "Show more", and each
// cart's actions. Counts, tiles and the plan's level are hints: when one can't be read it is left out, and the list still shows.
export function CartsList({ access, client, facts, onSetUp }: Props) {
  const { colors } = useTheme()
  const router = useRouter()
  const list = useCartList(client)
  const [sheet, setSheet] = useState<CartSheet | null>(null)
  useReloadOnFocus(list.reload)

  const sender = senderOf(access.readOnly, facts.sending)
  const none = list.counts !== null && list.counts.open + list.counts.recovered + list.counts.lost === 0
  const now = new Date()

  return (
    <>
      <ShellScreen label={t('carts.screen')} onRetry={list.reload} {...(list.status === 'error' ? { state: stateOfError(list.error) } : {})}>
        <View style={styles.content}>
          <View style={styles.head}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
              {t('carts.title')}
            </Text>
            <Text style={[styles.sub, { color: colors.muted }]}>{t('carts.lede')}</Text>
          </View>
          <CartNotes access={access} sending={facts.sending} />
          {none ? (
            <CartsFirstRun sender={sender} onSetUp={access.canEdit ? onSetUp : null} />
          ) : (
            <>
              {list.summary ? <CartTiles summary={list.summary} /> : null}
              <CartsFilters tab={list.tab} onTab={list.setTab} counts={list.counts} search={list.search} onSearch={list.setSearch} />
              {list.status === 'loading' ? <Skeleton /> : null}
              {list.status === 'ready' && list.rows.length === 0 ? (
                list.search.trim() !== '' ? (
                  <Text style={[styles.sub, { color: colors.muted }]}>{t('carts.noMatch')}</Text>
                ) : (
                  <ListMessage title={t(`carts.empty.${list.tab}.title`)} body={t(`carts.empty.${list.tab}.body`)} />
                )
              ) : null}
              {list.status === 'ready'
                ? list.rows.map((cart) => (
                    <CartCard
                      key={cart.id}
                      cart={cart}
                      sender={sender}
                      country={facts.country}
                      now={now}
                      canEdit={access.canEdit}
                      onOpen={() => router.push(cartHref(cart.id) as never)}
                      onAct={(act: CartAction) => setSheet({ act, cart })}
                    />
                  ))
                : null}
              {list.hasMore && list.status === 'ready' ? list.loadingMore ? <ActivityIndicator color={colors.muted} /> : <Button kind="secondary" label={t('carts.showMore')} onPress={list.showMore} /> : null}
            </>
          )}
        </View>
      </ShellScreen>
      <CartSheets
        sheet={sheet}
        client={client}
        codes={facts.sending?.level === 'automatic'}
        scheduled={sender === 'schedule'}
        onClose={() => setSheet(null)}
        onDone={() => {
          list.reload()
          facts.reload()
        }}
      />
    </>
  )
}

const styles = StyleSheet.create({
  content: { padding: 14, gap: 14, paddingBottom: 32 },
  head: { gap: 4 },
  title: { fontSize: 22, fontWeight: '800' },
  sub: { fontSize: 13, lineHeight: 19 },
})
