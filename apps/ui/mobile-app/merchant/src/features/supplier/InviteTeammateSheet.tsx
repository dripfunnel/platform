import { useState } from 'react'
import { inviteTeammate, teamRoles, type TeamRole } from '../../api/supplier'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import type { SupplierTier } from '../../nav'
import { TextField } from '../common/TextField'
import { ChoiceRows } from '../settings/ChoiceRows'
import { looksLikeEmail } from '../settings/email'
import { FormSheet } from '../settings/FormSheet'

type Props = { supplier: string; tier: SupplierTier; client: ApiClient; onClose: () => void; onDone: () => Promise<void> }

// Invite someone from the supplier: an email and a role. A member's choice is worded with the supplier's access level, as the web's is (FIRST-RELEASE (store) §17).
// The invitation email is sent by the server, and the answer is the same for any address (ACCESS.md §7.5), so this says "sent" either way.
export function InviteTeammateSheet({ supplier, tier, client, onClose, onDone }: Props) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<TeamRole>('supplier-member')
  const [tried, setTried] = useState(false)
  const valid = looksLikeEmail(email)
  const options = teamRoles.map((value) => ({
    value,
    label: value === 'supplier-member' ? t('supplier.team.memberAccess', { access: t(`settings.suppliers.access.${tier}`) }) : t('supplier.team.adminAccess'),
  }))
  return (
    <FormSheet
      title={t('supplier.team.inviteTitle', { supplier })}
      body={t('supplier.team.inviteBody', { supplier })}
      confirm={t('supplier.team.send')}
      context="supplierTeam"
      onClose={onClose}
      check={() => {
        setTried(true)
        return valid ? null : t('supplier.team.emailInvalid')
      }}
      onSubmit={async () => {
        await inviteTeammate(client, email.trim(), role)
        await onDone()
        return t('supplier.team.sent', { email: email.trim() })
      }}
    >
      <TextField label={t('supplier.team.email')} value={email} onChangeText={setEmail} placeholder={t('supplier.team.emailPlaceholder')} keyboardType="email-address" autoComplete="email" invalid={tried && !valid} />
      <ChoiceRows label={t('supplier.team.roleLabel')} value={role} options={options} onChange={setRole} />
    </FormSheet>
  )
}
