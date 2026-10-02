import microsoftLogo from '../../assets/microsoft-logo.svg'
import '@dripfunnel/shared/ui/auth.css'
import './signIn.css'

export const MicrosoftButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button type="button" className="df-microsoft-button" onClick={onClick}>
    <img src={microsoftLogo} alt="" width={21} height={21} />
    {label}
  </button>
)
