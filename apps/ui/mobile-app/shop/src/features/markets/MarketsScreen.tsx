import { useRouter } from 'expo-router'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { useBrand } from '../../brand/BrandContext'
import { locale, t } from '../../messages'
import { Choice } from '../checkout/Choice'
import { ScreenHeader, StateMessage } from '../common/ui'
import { currencyLabel, languageLabel } from './labels'
import { useMarkets } from './MarketsContext'

/** The store's languages and currencies as two lists, as the website offers them; a pick is kept on the phone and every later request carries it. */
export function MarketsScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const { offers, choice, choose } = useMarkets()
  const { brand } = useBrand()
  const shop = brand?.name ?? t('markets.thisShop')
  const header = <ScreenHeader title={t('markets.title')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/account'))} />

  if (!offers) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.page }]}>
        {header}
        <StateMessage title={t('markets.unavailable.title')} body={t('markets.unavailable.body')} />
      </View>
    )
  }

  const language = choice.language ?? offers.languages[0]
  const currency = choice.currency ?? offers.currencies[0]
  const only = offers.currencies.length === 1 ? offers.currencies[0] : null
  return (
    <View style={[styles.screen, { backgroundColor: colors.page }]}>
      {header}
      <ScrollView contentContainerStyle={styles.body}>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('markets.language')} style={styles.group}>
          <Text accessibilityRole="header" style={[styles.heading, { color: colors.textStrong }]}>
            {t('markets.language')}
          </Text>
          {offers.languages.map((code) => (
            <Choice key={code} selected={code === language} label={languageLabel(code)} onPress={() => choose({ language: code })} />
          ))}
          <Text style={{ color: colors.muted, fontSize: 13 }}>{t('markets.languageNote', { shop })}</Text>
        </View>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('markets.currency')} style={styles.group}>
          <Text accessibilityRole="header" style={[styles.heading, { color: colors.textStrong }]}>
            {t('markets.currency')}
          </Text>
          {offers.currencies.map((code) => (
            <Choice key={code} selected={code === currency} label={currencyLabel(code, locale)} onPress={() => choose({ currency: code })} />
          ))}
          {only ? <Text style={{ color: colors.muted, fontSize: 13 }}>{t('markets.oneCurrency', { shop, currency: only })}</Text> : null}
          <Text style={{ color: colors.muted, fontSize: 13 }}>{t('markets.currencyNote')}</Text>
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { gap: 20, padding: 16, paddingBottom: 40 },
  group: { gap: 8 },
  heading: { fontSize: 14, fontWeight: '800' },
})
