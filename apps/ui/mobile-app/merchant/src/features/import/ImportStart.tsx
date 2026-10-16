import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { loadImportTemplate } from '../../api/imports'
import type { ApiClient } from '../../graphql'
import { t } from '../../messages'
import { useTheme } from '../../theme'
import { Button } from '../common/Button'
import { Notice } from '../common/Notice'
import { shareCsv } from '../common/shareCsv'
import { fileErrorWords, type FileError } from './importFile'
import type { ImportMode } from './useImportFlow'
import { ShopifyConnect } from './ShopifyConnect'

type SourceProps = { title: string; body: string; cta: string; selected?: boolean; disabled?: boolean; onSelect: () => void }

function Source({ title, body, cta, selected, disabled = false, onSelect }: SourceProps) {
  const { colors, radii } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${cta}`}
      accessibilityState={{ disabled, ...(selected === undefined ? {} : { selected }) }}
      disabled={disabled}
      onPress={onSelect}
      style={[styles.source, { backgroundColor: colors.surface, borderColor: selected ? colors.focus : colors.border, borderWidth: selected ? 2 : 1, borderRadius: radii.card, opacity: disabled ? 0.6 : 1 }]}
    >
      <Text style={[styles.sourceTitle, { color: colors.heading }]}>{title}</Text>
      <Text style={[styles.sourceBody, { color: colors.muted }]}>{body}</Text>
      <Text style={[styles.sourceCta, { color: colors.link }]}>{cta}</Text>
    </Pressable>
  )
}

type Props = {
  client: ApiClient
  mode: ImportMode
  readOnly: boolean
  checking: boolean
  fileError: FileError | null
  refusal: string | null
  onChoose: () => void
  onShopify: () => void
  onConnected: (shop: string) => void
}

/** Choose: a spreadsheet, a Shopify shop, or the template; a refused file is said in CatImport's words, with what to do next. */
export function ImportStart({ client, mode, readOnly, checking, fileError, refusal, onChoose, onShopify, onConnected }: Props) {
  const s = (key: 'file' | 'shopify' | 'template') => ({ title: t(`imports.sources.${key}.title`), body: t(`imports.sources.${key}.body`), cta: t(`imports.sources.${key}.cta`) })
  const [templateFailed, setTemplateFailed] = useState(false)
  const said = fileError && fileErrorWords(fileError)

  const template = async () => {
    setTemplateFailed(false)
    try {
      await shareCsv(t('imports.sources.template.title'), await loadImportTemplate(client))
    } catch {
      setTemplateFailed(true)
    }
  }

  return (
    <View style={styles.stack}>
      {checking ? <Notice text={mode === 'shopify' ? t('imports.checking.shopify') : t('imports.checking.file')} /> : null}
      {said && !checking ? (
        <View style={styles.stack}>
          <Notice kind="error" text={t('imports.fileErrors.notice', { title: said.title, body: refusal ?? said.body })} />
          <Button kind="secondary" label={t('imports.fileErrors.chooseAnother')} onPress={onChoose} disabled={readOnly} />
        </View>
      ) : null}
      {templateFailed ? <Notice kind="error" text={t('imports.export.shareFailed')} /> : null}
      {mode === 'shopify' && !checking ? <ShopifyConnect client={client} onConnected={onConnected} /> : null}
      <Source {...s('file')} selected={mode === 'file'} disabled={readOnly || checking} onSelect={onChoose} />
      <Source {...s('shopify')} selected={mode === 'shopify'} disabled={readOnly || checking} onSelect={onShopify} />
      <Source {...s('template')} onSelect={() => void template()} />
    </View>
  )
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  source: { padding: 16, gap: 4, minHeight: 44 },
  sourceTitle: { fontSize: 16, fontWeight: '800' },
  sourceBody: { fontSize: 14, lineHeight: 20 },
  sourceCta: { fontSize: 14, fontWeight: '700', paddingTop: 4 },
})
