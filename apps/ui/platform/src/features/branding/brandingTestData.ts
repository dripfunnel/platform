import type { Branding, ContrastReport } from '../../api/branding'
import type { PartnerRole } from '../shell/partnerRoles'

// Platform API answers for the screen tests: Northstar's branding as each role is sent it,
// Kaufladen's (Powered by fixed, Impressum required), and the report for a low-contrast primary.
export const northstarBranding: Record<PartnerRole, Branding> = {
  "partner-owner": {
    "look": {
      "productName": "Northstar Shops",
      "primary": "#0F5E63",
      "accent": "#E8C9A0",
      "font": "Nunito",
      "corner": "rounded",
      "background": "sand",
      "files": {
        "logoLight": "northstar-shops-logo.svg",
        "logoDark": "northstar-shops-logo-white.svg",
        "mark": "northstar-mark.svg",
        "favicon": "favicon-64.png",
        "appIcon": "",
        "appIconForeground": "",
        "splash": ""
      }
    },
    "words": {
      "supportEmail": "help@northstar.com",
      "supportUrl": "https://help.northstar.com",
      "helpUrl": "https://help.northstar.com/shops",
      "termsUrl": "https://northstar.com/shops/terms",
      "privacyUrl": "https://northstar.com/shops/privacy",
      "dpaUrl": "https://northstar.com/shops/dpa",
      "impressum": "",
      "poweredBy": false
    },
    "affects": 84,
    "contrast": {
      "pairs": [
        {
          "key": "primaryOnWhite",
          "ratio": "7.5:1",
          "passes": true
        },
        {
          "key": "accentOnDark",
          "ratio": "11.3:1",
          "passes": true
        }
      ],
      "passes": true,
      "fix": null
    },
    "poweredBy": {
      "kind": "choice"
    },
    "impressumRequired": false,
    "dpaRequired": false,
    "permission": {
      "allowed": true
    }
  },
  "partner-admin": {
    "look": {
      "productName": "Northstar Shops",
      "primary": "#0F5E63",
      "accent": "#E8C9A0",
      "font": "Nunito",
      "corner": "rounded",
      "background": "sand",
      "files": {
        "logoLight": "northstar-shops-logo.svg",
        "logoDark": "northstar-shops-logo-white.svg",
        "mark": "northstar-mark.svg",
        "favicon": "favicon-64.png",
        "appIcon": "",
        "appIconForeground": "",
        "splash": ""
      }
    },
    "words": {
      "supportEmail": "help@northstar.com",
      "supportUrl": "https://help.northstar.com",
      "helpUrl": "https://help.northstar.com/shops",
      "termsUrl": "https://northstar.com/shops/terms",
      "privacyUrl": "https://northstar.com/shops/privacy",
      "dpaUrl": "https://northstar.com/shops/dpa",
      "impressum": "",
      "poweredBy": false
    },
    "affects": 84,
    "contrast": {
      "pairs": [
        {
          "key": "primaryOnWhite",
          "ratio": "7.5:1",
          "passes": true
        },
        {
          "key": "accentOnDark",
          "ratio": "11.3:1",
          "passes": true
        }
      ],
      "passes": true,
      "fix": null
    },
    "poweredBy": {
      "kind": "choice"
    },
    "impressumRequired": false,
    "dpaRequired": false,
    "permission": {
      "allowed": true
    }
  },
  "partner-finance": {
    "look": {
      "productName": "Northstar Shops",
      "primary": "#0F5E63",
      "accent": "#E8C9A0",
      "font": "Nunito",
      "corner": "rounded",
      "background": "sand",
      "files": {
        "logoLight": "northstar-shops-logo.svg",
        "logoDark": "northstar-shops-logo-white.svg",
        "mark": "northstar-mark.svg",
        "favicon": "favicon-64.png",
        "appIcon": "",
        "appIconForeground": "",
        "splash": ""
      }
    },
    "words": {
      "supportEmail": "help@northstar.com",
      "supportUrl": "https://help.northstar.com",
      "helpUrl": "https://help.northstar.com/shops",
      "termsUrl": "https://northstar.com/shops/terms",
      "privacyUrl": "https://northstar.com/shops/privacy",
      "dpaUrl": "https://northstar.com/shops/dpa",
      "impressum": "",
      "poweredBy": false
    },
    "affects": 84,
    "contrast": {
      "pairs": [
        {
          "key": "primaryOnWhite",
          "ratio": "7.5:1",
          "passes": true
        },
        {
          "key": "accentOnDark",
          "ratio": "11.3:1",
          "passes": true
        }
      ],
      "passes": true,
      "fix": null
    },
    "poweredBy": {
      "kind": "choice"
    },
    "impressumRequired": false,
    "dpaRequired": false,
    "permission": {
      "allowed": false,
      "reason": "OWNERS_AND_ADMINS_ONLY"
    }
  },
  "partner-support": {
    "look": {
      "productName": "Northstar Shops",
      "primary": "#0F5E63",
      "accent": "#E8C9A0",
      "font": "Nunito",
      "corner": "rounded",
      "background": "sand",
      "files": {
        "logoLight": "northstar-shops-logo.svg",
        "logoDark": "northstar-shops-logo-white.svg",
        "mark": "northstar-mark.svg",
        "favicon": "favicon-64.png",
        "appIcon": "",
        "appIconForeground": "",
        "splash": ""
      }
    },
    "words": {
      "supportEmail": "help@northstar.com",
      "supportUrl": "https://help.northstar.com",
      "helpUrl": "https://help.northstar.com/shops",
      "termsUrl": "https://northstar.com/shops/terms",
      "privacyUrl": "https://northstar.com/shops/privacy",
      "dpaUrl": "https://northstar.com/shops/dpa",
      "impressum": "",
      "poweredBy": false
    },
    "affects": 84,
    "contrast": {
      "pairs": [
        {
          "key": "primaryOnWhite",
          "ratio": "7.5:1",
          "passes": true
        },
        {
          "key": "accentOnDark",
          "ratio": "11.3:1",
          "passes": true
        }
      ],
      "passes": true,
      "fix": null
    },
    "poweredBy": {
      "kind": "choice"
    },
    "impressumRequired": false,
    "dpaRequired": false,
    "permission": {
      "allowed": false,
      "reason": "OWNERS_AND_ADMINS_ONLY"
    }
  },
  "partner-read-only": {
    "look": {
      "productName": "Northstar Shops",
      "primary": "#0F5E63",
      "accent": "#E8C9A0",
      "font": "Nunito",
      "corner": "rounded",
      "background": "sand",
      "files": {
        "logoLight": "northstar-shops-logo.svg",
        "logoDark": "northstar-shops-logo-white.svg",
        "mark": "northstar-mark.svg",
        "favicon": "favicon-64.png",
        "appIcon": "",
        "appIconForeground": "",
        "splash": ""
      }
    },
    "words": {
      "supportEmail": "help@northstar.com",
      "supportUrl": "https://help.northstar.com",
      "helpUrl": "https://help.northstar.com/shops",
      "termsUrl": "https://northstar.com/shops/terms",
      "privacyUrl": "https://northstar.com/shops/privacy",
      "dpaUrl": "https://northstar.com/shops/dpa",
      "impressum": "",
      "poweredBy": false
    },
    "affects": 84,
    "contrast": {
      "pairs": [
        {
          "key": "primaryOnWhite",
          "ratio": "7.5:1",
          "passes": true
        },
        {
          "key": "accentOnDark",
          "ratio": "11.3:1",
          "passes": true
        }
      ],
      "passes": true,
      "fix": null
    },
    "poweredBy": {
      "kind": "choice"
    },
    "impressumRequired": false,
    "dpaRequired": false,
    "permission": {
      "allowed": false,
      "reason": "OWNERS_AND_ADMINS_ONLY"
    }
  }
}

export const kaufladenBranding: Branding = {
  "look": {
    "productName": "Kaufladen Shops",
    "primary": "#1F3A5F",
    "accent": "#F2B134",
    "font": "Source Sans 3",
    "corner": "soft",
    "background": "plain",
    "files": {
      "logoLight": "kaufladen-shops-logo.svg",
      "logoDark": "kaufladen-shops-logo-white.svg",
      "mark": "kaufladen-mark.svg",
      "favicon": "favicon-64.png",
      "appIcon": "",
      "appIconForeground": "",
      "splash": ""
    }
  },
  "words": {
    "supportEmail": "hilfe@kaufladen.de",
    "supportUrl": "",
    "helpUrl": "",
    "termsUrl": "https://kaufladen.de/agb",
    "privacyUrl": "https://kaufladen.de/datenschutz",
    "dpaUrl": "",
    "impressum": "",
    "poweredBy": true
  },
  "affects": 0,
  "contrast": {
    "pairs": [
      {
        "key": "primaryOnWhite",
        "ratio": "11.5:1",
        "passes": true
      },
      {
        "key": "accentOnDark",
        "ratio": "9.4:1",
        "passes": true
      }
    ],
    "passes": true,
    "fix": null
  },
  "poweredBy": {
    "kind": "fixedOn"
  },
  "impressumRequired": true,
  "dpaRequired": true,
  "permission": {
    "allowed": true
  }
}

export const lowContrastReport: ContrastReport = {
  "pairs": [
    {
      "key": "primaryOnWhite",
      "ratio": "1.7:1",
      "passes": false
    },
    {
      "key": "accentOnDark",
      "ratio": "11.3:1",
      "passes": true
    }
  ],
  "passes": false,
  "fix": "White button text on #9ACDD6 is 1.7:1. It needs 4.5:1 to be readable; try a darker primary."
}
