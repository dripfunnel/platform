import { Pager as SharedPager, type PagerProps as SharedPagerProps } from '@dripfunnel/shared/ui'
import { messages } from '../../messages'

export type PagerProps = Omit<SharedPagerProps, 'words'>

// The shared pager in this console's words (decided on #19).
export const Pager = (props: PagerProps) => <SharedPager {...props} words={messages.common.pager} />
