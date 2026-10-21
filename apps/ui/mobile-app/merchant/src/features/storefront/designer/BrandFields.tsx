import { StyleSheet, Text, View } from 'react-native'
import { brandLimits, socialNetworks } from '../../../api/storefrontSettings'
import { t } from '../../../messages'
import { useTheme } from '../../../theme'
import { Chip } from '../../common/Chip'
import { SectionCard } from '../../common/SectionCard'
import { TextArea } from '../../common/TextArea'
import { TextField } from '../../common/TextField'
import type { BrandForm, FormProblem } from './brandDraft'
import { ImageField } from './ImageField'

type Props = { form: BrandForm; onChange: (change: Partial<BrandForm>) => void; editable: boolean; problem: FormProblem | null }

const voices = ['warm', 'calm', 'bold', 'elegant', 'expert'] as const

// The brand's fields (FIRST-RELEASE (store) §14), for the first-visit step and Site settings › Brand: name and logo, favicon and colours, the words about the shop, social links and public contact.
export function BrandFields({ form, onChange, editable, problem }: Props) {
  const { colors } = useTheme()
  const at = (field: string) => (problem?.field === field ? problem.text : undefined)
  const setAddress = (key: keyof BrandForm['contactAddress'], value: string) => onChange({ contactAddress: { ...form.contactAddress, [key]: value } })
  return (
    <>
      <SectionCard title={t('storefront.brand.sections.identity')}>
        <TextField label={t('storefront.brand.shopName')} value={form.shopName} onChangeText={(shopName) => onChange({ shopName })} editable={editable} maxLength={brandLimits.shopName} autoCapitalize="words" invalid={at('shopName') !== undefined} help={at('shopName') ?? t('storefront.brand.required')} />
        <ImageField label={t('storefront.brand.logo')} help={at('logo') ?? t('storefront.brand.logoHelp')} empty={t('storefront.brand.noLogo')} assetId={form.logoAssetId} onChange={(logoAssetId) => onChange({ logoAssetId })} editable={editable} removable={false} required />
      </SectionCard>
      <SectionCard title={t('storefront.brand.sections.look')} sub={t('storefront.brand.sections.lookHelp')}>
        <ImageField label={t('storefront.brand.favicon')} help={at('favicon') ?? t('storefront.brand.faviconHelp')} empty={t('storefront.brand.noFavicon')} assetId={form.faviconAssetId} onChange={(faviconAssetId) => onChange({ faviconAssetId })} editable={editable} removable />
        <TextField label={t('storefront.brand.primaryColour')} value={form.primaryColour ?? ''} onChangeText={(primaryColour) => onChange({ primaryColour })} editable={editable} maxLength={7} invalid={at('primaryColour') !== undefined} help={at('primaryColour') ?? t('storefront.brand.colourHelp')} />
        <TextField label={t('storefront.brand.secondaryColour')} value={form.secondaryColour ?? ''} onChangeText={(secondaryColour) => onChange({ secondaryColour })} editable={editable} maxLength={7} invalid={at('secondaryColour') !== undefined} help={at('secondaryColour') ?? t('storefront.brand.colourHelp')} />
      </SectionCard>
      <SectionCard title={t('storefront.brand.sections.about')}>
        <TextField label={t('storefront.brand.tagline')} value={form.tagline} onChangeText={(tagline) => onChange({ tagline })} editable={editable} maxLength={brandLimits.tagline} autoCapitalize="sentences" help={t('storefront.brand.taglineHelp')} />
        <TextArea label={t('storefront.brand.description')} value={form.description} onChangeText={(description) => onChange({ description })} editable={editable} lines={4} />
        <Text style={[styles.hint, { color: colors.muted }]}>{t('storefront.brand.descriptionHelp', { count: form.description.length, limit: brandLimits.description })}</Text>
        <View style={styles.group}>
          <Text style={[styles.label, { color: colors.text }]}>{t('storefront.brand.voice')}</Text>
          <Text style={[styles.hint, { color: colors.muted }]}>{t('storefront.brand.voiceHelp')}</Text>
          <View style={styles.chips}>
            {voices.map((voice) => (
              <Chip key={voice} label={t(`storefront.brand.voices.${voice}`)} selected={form.voice === t(`storefront.brand.voices.${voice}`)} disabled={!editable} onPress={() => onChange({ voice: form.voice === t(`storefront.brand.voices.${voice}`) ? '' : t(`storefront.brand.voices.${voice}`) })} />
            ))}
          </View>
          <TextField label={t('storefront.brand.voiceOwn')} value={form.voice} onChangeText={(voice) => onChange({ voice })} editable={editable} maxLength={brandLimits.voice} autoCapitalize="sentences" invalid={at('voice') !== undefined} help={at('voice')} />
        </View>
      </SectionCard>
      <SectionCard title={t('storefront.brand.sections.social')} sub={t('storefront.brand.sections.socialHelp')}>
        {socialNetworks.map((network) => (
          <TextField
            key={network}
            label={t(`storefront.brand.social.${network}`)}
            value={form.social[network]}
            onChangeText={(value) => onChange({ social: { ...form.social, [network]: value } })}
            editable={editable}
            maxLength={brandLimits.social}
            placeholder={network === 'whatsapp' ? t('storefront.brand.whatsappPlaceholder') : t('storefront.brand.socialPlaceholder')}
            invalid={at(`social.${network}`) !== undefined}
            help={at(`social.${network}`)}
          />
        ))}
      </SectionCard>
      <SectionCard title={t('storefront.brand.sections.contact')} sub={t('storefront.brand.sections.contactHelp')}>
        <TextField label={t('storefront.brand.email')} value={form.contactEmail} onChangeText={(contactEmail) => onChange({ contactEmail })} editable={editable} maxLength={brandLimits.email} keyboardType="email-address" autoComplete="email" invalid={at('contactEmail') !== undefined} help={at('contactEmail')} />
        <TextField label={t('storefront.brand.phone')} value={form.contactPhone} onChangeText={(contactPhone) => onChange({ contactPhone })} editable={editable} maxLength={brandLimits.phone} keyboardType="phone-pad" autoComplete="tel" />
        <TextField label={t('storefront.brand.street')} value={form.contactAddress.street} onChangeText={(value) => setAddress('street', value)} editable={editable} maxLength={brandLimits.street} autoCapitalize="words" invalid={at('contactAddress') !== undefined} help={at('contactAddress')} />
        <TextField label={t('storefront.brand.city')} value={form.contactAddress.city} onChangeText={(value) => setAddress('city', value)} editable={editable} maxLength={brandLimits.city} autoCapitalize="words" />
        <TextField label={t('storefront.brand.postal')} value={form.contactAddress.postal} onChangeText={(value) => setAddress('postal', value)} editable={editable} maxLength={brandLimits.postal} />
        <TextField label={t('storefront.brand.region')} value={form.contactAddress.region} onChangeText={(value) => setAddress('region', value)} editable={editable} maxLength={brandLimits.region} autoCapitalize="words" />
      </SectionCard>
    </>
  )
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  label: { fontSize: 14, fontWeight: '700' },
  hint: { fontSize: 13, lineHeight: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
})
