import type { PlanEditor, PlansPage } from '../../api/plans'
import type { PartnerRole } from '../shell/partnerRoles'

// Platform API answers for the screen tests: Northstar's catalogue, and the Growth plan's editor
// as each role is sent it (FIRST-RELEASE.md §7). Never imported by the app.
export const plansPages: Record<PartnerRole, PlansPage> = {
  "partner-owner": {
    "items": [
      {
        "id": "starter",
        "name": "Starter",
        "description": "Everything to open your first shop.",
        "status": "live",
        "trialDays": 14,
        "prices": [
          {
            "currency": "USD",
            "monthly": {
              "amount": 2900,
              "currency": "USD"
            },
            "yearly": {
              "amount": 29000,
              "currency": "USD"
            },
            "fee": {
              "amount": 1200,
              "currency": "USD"
            },
            "converted": false,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 1700,
                "currency": "USD"
              },
              "of": {
                "amount": 2900,
                "currency": "USD"
              }
            }
          },
          {
            "currency": "CAD",
            "monthly": {
              "amount": 3900,
              "currency": "CAD"
            },
            "yearly": {
              "amount": 39000,
              "currency": "CAD"
            },
            "fee": {
              "amount": 1622,
              "currency": "CAD"
            },
            "converted": true,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 2278,
                "currency": "CAD"
              },
              "of": {
                "amount": 3900,
                "currency": "CAD"
              }
            }
          }
        ],
        "stores": 31
      },
      {
        "id": "growth",
        "name": "Growth",
        "description": "For shops that sell every day.",
        "status": "live",
        "trialDays": 14,
        "prices": [
          {
            "currency": "USD",
            "monthly": {
              "amount": 4900,
              "currency": "USD"
            },
            "yearly": {
              "amount": 49000,
              "currency": "USD"
            },
            "fee": {
              "amount": 1800,
              "currency": "USD"
            },
            "converted": false,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 3100,
                "currency": "USD"
              },
              "of": {
                "amount": 4900,
                "currency": "USD"
              }
            }
          },
          {
            "currency": "CAD",
            "monthly": {
              "amount": 6500,
              "currency": "CAD"
            },
            "yearly": {
              "amount": 65000,
              "currency": "CAD"
            },
            "fee": {
              "amount": 2432,
              "currency": "CAD"
            },
            "converted": true,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 4068,
                "currency": "CAD"
              },
              "of": {
                "amount": 6500,
                "currency": "CAD"
              }
            }
          }
        ],
        "stores": 44
      },
      {
        "id": "pro",
        "name": "Pro",
        "description": "For established brands with a team.",
        "status": "live",
        "trialDays": 14,
        "prices": [
          {
            "currency": "USD",
            "monthly": {
              "amount": 9900,
              "currency": "USD"
            },
            "yearly": {
              "amount": 99000,
              "currency": "USD"
            },
            "fee": {
              "amount": 3500,
              "currency": "USD"
            },
            "converted": false,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 6400,
                "currency": "USD"
              },
              "of": {
                "amount": 9900,
                "currency": "USD"
              }
            }
          },
          {
            "currency": "CAD",
            "monthly": {
              "amount": 12900,
              "currency": "CAD"
            },
            "yearly": {
              "amount": 129000,
              "currency": "CAD"
            },
            "fee": {
              "amount": 4730,
              "currency": "CAD"
            },
            "converted": true,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 8170,
                "currency": "CAD"
              },
              "of": {
                "amount": 12900,
                "currency": "CAD"
              }
            }
          }
        ],
        "stores": 11
      },
      {
        "id": "basic24",
        "name": "Basic (2024)",
        "description": "Our first plan. Replaced by Starter.",
        "status": "retired",
        "trialDays": 0,
        "prices": [
          {
            "currency": "USD",
            "monthly": {
              "amount": 1900,
              "currency": "USD"
            },
            "yearly": {
              "amount": 19000,
              "currency": "USD"
            },
            "fee": {
              "amount": 1000,
              "currency": "USD"
            },
            "converted": false,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 900,
                "currency": "USD"
              },
              "of": {
                "amount": 1900,
                "currency": "USD"
              }
            }
          },
          {
            "currency": "CAD",
            "monthly": {
              "amount": 2500,
              "currency": "CAD"
            },
            "yearly": {
              "amount": 25000,
              "currency": "CAD"
            },
            "fee": {
              "amount": 1351,
              "currency": "CAD"
            },
            "converted": true,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 1149,
                "currency": "CAD"
              },
              "of": {
                "amount": 2500,
                "currency": "CAD"
              }
            }
          }
        ],
        "stores": 0
      }
    ],
    "chargedBy": "DripFunnel for Northstar",
    "actions": {
      "create": {
        "allowed": true
      }
    }
  },
  "partner-admin": {
    "items": [
      {
        "id": "starter",
        "name": "Starter",
        "description": "Everything to open your first shop.",
        "status": "live",
        "trialDays": 14,
        "prices": [
          {
            "currency": "USD",
            "monthly": {
              "amount": 2900,
              "currency": "USD"
            },
            "yearly": {
              "amount": 29000,
              "currency": "USD"
            },
            "fee": {
              "amount": 1200,
              "currency": "USD"
            },
            "converted": false,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 1700,
                "currency": "USD"
              },
              "of": {
                "amount": 2900,
                "currency": "USD"
              }
            }
          },
          {
            "currency": "CAD",
            "monthly": {
              "amount": 3900,
              "currency": "CAD"
            },
            "yearly": {
              "amount": 39000,
              "currency": "CAD"
            },
            "fee": {
              "amount": 1622,
              "currency": "CAD"
            },
            "converted": true,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 2278,
                "currency": "CAD"
              },
              "of": {
                "amount": 3900,
                "currency": "CAD"
              }
            }
          }
        ],
        "stores": 31
      },
      {
        "id": "growth",
        "name": "Growth",
        "description": "For shops that sell every day.",
        "status": "live",
        "trialDays": 14,
        "prices": [
          {
            "currency": "USD",
            "monthly": {
              "amount": 4900,
              "currency": "USD"
            },
            "yearly": {
              "amount": 49000,
              "currency": "USD"
            },
            "fee": {
              "amount": 1800,
              "currency": "USD"
            },
            "converted": false,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 3100,
                "currency": "USD"
              },
              "of": {
                "amount": 4900,
                "currency": "USD"
              }
            }
          },
          {
            "currency": "CAD",
            "monthly": {
              "amount": 6500,
              "currency": "CAD"
            },
            "yearly": {
              "amount": 65000,
              "currency": "CAD"
            },
            "fee": {
              "amount": 2432,
              "currency": "CAD"
            },
            "converted": true,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 4068,
                "currency": "CAD"
              },
              "of": {
                "amount": 6500,
                "currency": "CAD"
              }
            }
          }
        ],
        "stores": 44
      },
      {
        "id": "pro",
        "name": "Pro",
        "description": "For established brands with a team.",
        "status": "live",
        "trialDays": 14,
        "prices": [
          {
            "currency": "USD",
            "monthly": {
              "amount": 9900,
              "currency": "USD"
            },
            "yearly": {
              "amount": 99000,
              "currency": "USD"
            },
            "fee": {
              "amount": 3500,
              "currency": "USD"
            },
            "converted": false,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 6400,
                "currency": "USD"
              },
              "of": {
                "amount": 9900,
                "currency": "USD"
              }
            }
          },
          {
            "currency": "CAD",
            "monthly": {
              "amount": 12900,
              "currency": "CAD"
            },
            "yearly": {
              "amount": 129000,
              "currency": "CAD"
            },
            "fee": {
              "amount": 4730,
              "currency": "CAD"
            },
            "converted": true,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 8170,
                "currency": "CAD"
              },
              "of": {
                "amount": 12900,
                "currency": "CAD"
              }
            }
          }
        ],
        "stores": 11
      },
      {
        "id": "basic24",
        "name": "Basic (2024)",
        "description": "Our first plan. Replaced by Starter.",
        "status": "retired",
        "trialDays": 0,
        "prices": [
          {
            "currency": "USD",
            "monthly": {
              "amount": 1900,
              "currency": "USD"
            },
            "yearly": {
              "amount": 19000,
              "currency": "USD"
            },
            "fee": {
              "amount": 1000,
              "currency": "USD"
            },
            "converted": false,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 900,
                "currency": "USD"
              },
              "of": {
                "amount": 1900,
                "currency": "USD"
              }
            }
          },
          {
            "currency": "CAD",
            "monthly": {
              "amount": 2500,
              "currency": "CAD"
            },
            "yearly": {
              "amount": 25000,
              "currency": "CAD"
            },
            "fee": {
              "amount": 1351,
              "currency": "CAD"
            },
            "converted": true,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 1149,
                "currency": "CAD"
              },
              "of": {
                "amount": 2500,
                "currency": "CAD"
              }
            }
          }
        ],
        "stores": 0
      }
    ],
    "chargedBy": "DripFunnel for Northstar",
    "actions": {
      "create": {
        "allowed": true
      }
    }
  },
  "partner-finance": {
    "items": [
      {
        "id": "starter",
        "name": "Starter",
        "description": "Everything to open your first shop.",
        "status": "live",
        "trialDays": 14,
        "prices": [
          {
            "currency": "USD",
            "monthly": {
              "amount": 2900,
              "currency": "USD"
            },
            "yearly": {
              "amount": 29000,
              "currency": "USD"
            },
            "fee": {
              "amount": 1200,
              "currency": "USD"
            },
            "converted": false,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 1700,
                "currency": "USD"
              },
              "of": {
                "amount": 2900,
                "currency": "USD"
              }
            }
          },
          {
            "currency": "CAD",
            "monthly": {
              "amount": 3900,
              "currency": "CAD"
            },
            "yearly": {
              "amount": 39000,
              "currency": "CAD"
            },
            "fee": {
              "amount": 1622,
              "currency": "CAD"
            },
            "converted": true,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 2278,
                "currency": "CAD"
              },
              "of": {
                "amount": 3900,
                "currency": "CAD"
              }
            }
          }
        ],
        "stores": 31
      },
      {
        "id": "growth",
        "name": "Growth",
        "description": "For shops that sell every day.",
        "status": "live",
        "trialDays": 14,
        "prices": [
          {
            "currency": "USD",
            "monthly": {
              "amount": 4900,
              "currency": "USD"
            },
            "yearly": {
              "amount": 49000,
              "currency": "USD"
            },
            "fee": {
              "amount": 1800,
              "currency": "USD"
            },
            "converted": false,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 3100,
                "currency": "USD"
              },
              "of": {
                "amount": 4900,
                "currency": "USD"
              }
            }
          },
          {
            "currency": "CAD",
            "monthly": {
              "amount": 6500,
              "currency": "CAD"
            },
            "yearly": {
              "amount": 65000,
              "currency": "CAD"
            },
            "fee": {
              "amount": 2432,
              "currency": "CAD"
            },
            "converted": true,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 4068,
                "currency": "CAD"
              },
              "of": {
                "amount": 6500,
                "currency": "CAD"
              }
            }
          }
        ],
        "stores": 44
      },
      {
        "id": "pro",
        "name": "Pro",
        "description": "For established brands with a team.",
        "status": "live",
        "trialDays": 14,
        "prices": [
          {
            "currency": "USD",
            "monthly": {
              "amount": 9900,
              "currency": "USD"
            },
            "yearly": {
              "amount": 99000,
              "currency": "USD"
            },
            "fee": {
              "amount": 3500,
              "currency": "USD"
            },
            "converted": false,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 6400,
                "currency": "USD"
              },
              "of": {
                "amount": 9900,
                "currency": "USD"
              }
            }
          },
          {
            "currency": "CAD",
            "monthly": {
              "amount": 12900,
              "currency": "CAD"
            },
            "yearly": {
              "amount": 129000,
              "currency": "CAD"
            },
            "fee": {
              "amount": 4730,
              "currency": "CAD"
            },
            "converted": true,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 8170,
                "currency": "CAD"
              },
              "of": {
                "amount": 12900,
                "currency": "CAD"
              }
            }
          }
        ],
        "stores": 11
      },
      {
        "id": "basic24",
        "name": "Basic (2024)",
        "description": "Our first plan. Replaced by Starter.",
        "status": "retired",
        "trialDays": 0,
        "prices": [
          {
            "currency": "USD",
            "monthly": {
              "amount": 1900,
              "currency": "USD"
            },
            "yearly": {
              "amount": 19000,
              "currency": "USD"
            },
            "fee": {
              "amount": 1000,
              "currency": "USD"
            },
            "converted": false,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 900,
                "currency": "USD"
              },
              "of": {
                "amount": 1900,
                "currency": "USD"
              }
            }
          },
          {
            "currency": "CAD",
            "monthly": {
              "amount": 2500,
              "currency": "CAD"
            },
            "yearly": {
              "amount": 25000,
              "currency": "CAD"
            },
            "fee": {
              "amount": 1351,
              "currency": "CAD"
            },
            "converted": true,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 1149,
                "currency": "CAD"
              },
              "of": {
                "amount": 2500,
                "currency": "CAD"
              }
            }
          }
        ],
        "stores": 0
      }
    ],
    "chargedBy": "DripFunnel for Northstar",
    "actions": {
      "create": {
        "allowed": false,
        "reason": "OWNERS_AND_ADMINS_ONLY"
      }
    }
  },
  "partner-support": {
    "items": [
      {
        "id": "starter",
        "name": "Starter",
        "description": "Everything to open your first shop.",
        "status": "live",
        "trialDays": 14,
        "prices": [
          {
            "currency": "USD",
            "monthly": {
              "amount": 2900,
              "currency": "USD"
            },
            "yearly": {
              "amount": 29000,
              "currency": "USD"
            },
            "fee": {
              "amount": 1200,
              "currency": "USD"
            },
            "converted": false,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 1700,
                "currency": "USD"
              },
              "of": {
                "amount": 2900,
                "currency": "USD"
              }
            }
          },
          {
            "currency": "CAD",
            "monthly": {
              "amount": 3900,
              "currency": "CAD"
            },
            "yearly": {
              "amount": 39000,
              "currency": "CAD"
            },
            "fee": {
              "amount": 1622,
              "currency": "CAD"
            },
            "converted": true,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 2278,
                "currency": "CAD"
              },
              "of": {
                "amount": 3900,
                "currency": "CAD"
              }
            }
          }
        ],
        "stores": 31
      },
      {
        "id": "growth",
        "name": "Growth",
        "description": "For shops that sell every day.",
        "status": "live",
        "trialDays": 14,
        "prices": [
          {
            "currency": "USD",
            "monthly": {
              "amount": 4900,
              "currency": "USD"
            },
            "yearly": {
              "amount": 49000,
              "currency": "USD"
            },
            "fee": {
              "amount": 1800,
              "currency": "USD"
            },
            "converted": false,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 3100,
                "currency": "USD"
              },
              "of": {
                "amount": 4900,
                "currency": "USD"
              }
            }
          },
          {
            "currency": "CAD",
            "monthly": {
              "amount": 6500,
              "currency": "CAD"
            },
            "yearly": {
              "amount": 65000,
              "currency": "CAD"
            },
            "fee": {
              "amount": 2432,
              "currency": "CAD"
            },
            "converted": true,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 4068,
                "currency": "CAD"
              },
              "of": {
                "amount": 6500,
                "currency": "CAD"
              }
            }
          }
        ],
        "stores": 44
      },
      {
        "id": "pro",
        "name": "Pro",
        "description": "For established brands with a team.",
        "status": "live",
        "trialDays": 14,
        "prices": [
          {
            "currency": "USD",
            "monthly": {
              "amount": 9900,
              "currency": "USD"
            },
            "yearly": {
              "amount": 99000,
              "currency": "USD"
            },
            "fee": {
              "amount": 3500,
              "currency": "USD"
            },
            "converted": false,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 6400,
                "currency": "USD"
              },
              "of": {
                "amount": 9900,
                "currency": "USD"
              }
            }
          },
          {
            "currency": "CAD",
            "monthly": {
              "amount": 12900,
              "currency": "CAD"
            },
            "yearly": {
              "amount": 129000,
              "currency": "CAD"
            },
            "fee": {
              "amount": 4730,
              "currency": "CAD"
            },
            "converted": true,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 8170,
                "currency": "CAD"
              },
              "of": {
                "amount": 12900,
                "currency": "CAD"
              }
            }
          }
        ],
        "stores": 11
      },
      {
        "id": "basic24",
        "name": "Basic (2024)",
        "description": "Our first plan. Replaced by Starter.",
        "status": "retired",
        "trialDays": 0,
        "prices": [
          {
            "currency": "USD",
            "monthly": {
              "amount": 1900,
              "currency": "USD"
            },
            "yearly": {
              "amount": 19000,
              "currency": "USD"
            },
            "fee": {
              "amount": 1000,
              "currency": "USD"
            },
            "converted": false,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 900,
                "currency": "USD"
              },
              "of": {
                "amount": 1900,
                "currency": "USD"
              }
            }
          },
          {
            "currency": "CAD",
            "monthly": {
              "amount": 2500,
              "currency": "CAD"
            },
            "yearly": {
              "amount": 25000,
              "currency": "CAD"
            },
            "fee": {
              "amount": 1351,
              "currency": "CAD"
            },
            "converted": true,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 1149,
                "currency": "CAD"
              },
              "of": {
                "amount": 2500,
                "currency": "CAD"
              }
            }
          }
        ],
        "stores": 0
      }
    ],
    "chargedBy": "DripFunnel for Northstar",
    "actions": {
      "create": {
        "allowed": false,
        "reason": "OWNERS_AND_ADMINS_ONLY"
      }
    }
  },
  "partner-read-only": {
    "items": [
      {
        "id": "starter",
        "name": "Starter",
        "description": "Everything to open your first shop.",
        "status": "live",
        "trialDays": 14,
        "prices": [
          {
            "currency": "USD",
            "monthly": {
              "amount": 2900,
              "currency": "USD"
            },
            "yearly": {
              "amount": 29000,
              "currency": "USD"
            },
            "fee": {
              "amount": 1200,
              "currency": "USD"
            },
            "converted": false,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 1700,
                "currency": "USD"
              },
              "of": {
                "amount": 2900,
                "currency": "USD"
              }
            }
          },
          {
            "currency": "CAD",
            "monthly": {
              "amount": 3900,
              "currency": "CAD"
            },
            "yearly": {
              "amount": 39000,
              "currency": "CAD"
            },
            "fee": {
              "amount": 1622,
              "currency": "CAD"
            },
            "converted": true,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 2278,
                "currency": "CAD"
              },
              "of": {
                "amount": 3900,
                "currency": "CAD"
              }
            }
          }
        ],
        "stores": 31
      },
      {
        "id": "growth",
        "name": "Growth",
        "description": "For shops that sell every day.",
        "status": "live",
        "trialDays": 14,
        "prices": [
          {
            "currency": "USD",
            "monthly": {
              "amount": 4900,
              "currency": "USD"
            },
            "yearly": {
              "amount": 49000,
              "currency": "USD"
            },
            "fee": {
              "amount": 1800,
              "currency": "USD"
            },
            "converted": false,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 3100,
                "currency": "USD"
              },
              "of": {
                "amount": 4900,
                "currency": "USD"
              }
            }
          },
          {
            "currency": "CAD",
            "monthly": {
              "amount": 6500,
              "currency": "CAD"
            },
            "yearly": {
              "amount": 65000,
              "currency": "CAD"
            },
            "fee": {
              "amount": 2432,
              "currency": "CAD"
            },
            "converted": true,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 4068,
                "currency": "CAD"
              },
              "of": {
                "amount": 6500,
                "currency": "CAD"
              }
            }
          }
        ],
        "stores": 44
      },
      {
        "id": "pro",
        "name": "Pro",
        "description": "For established brands with a team.",
        "status": "live",
        "trialDays": 14,
        "prices": [
          {
            "currency": "USD",
            "monthly": {
              "amount": 9900,
              "currency": "USD"
            },
            "yearly": {
              "amount": 99000,
              "currency": "USD"
            },
            "fee": {
              "amount": 3500,
              "currency": "USD"
            },
            "converted": false,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 6400,
                "currency": "USD"
              },
              "of": {
                "amount": 9900,
                "currency": "USD"
              }
            }
          },
          {
            "currency": "CAD",
            "monthly": {
              "amount": 12900,
              "currency": "CAD"
            },
            "yearly": {
              "amount": 129000,
              "currency": "CAD"
            },
            "fee": {
              "amount": 4730,
              "currency": "CAD"
            },
            "converted": true,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 8170,
                "currency": "CAD"
              },
              "of": {
                "amount": 12900,
                "currency": "CAD"
              }
            }
          }
        ],
        "stores": 11
      },
      {
        "id": "basic24",
        "name": "Basic (2024)",
        "description": "Our first plan. Replaced by Starter.",
        "status": "retired",
        "trialDays": 0,
        "prices": [
          {
            "currency": "USD",
            "monthly": {
              "amount": 1900,
              "currency": "USD"
            },
            "yearly": {
              "amount": 19000,
              "currency": "USD"
            },
            "fee": {
              "amount": 1000,
              "currency": "USD"
            },
            "converted": false,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 900,
                "currency": "USD"
              },
              "of": {
                "amount": 1900,
                "currency": "USD"
              }
            }
          },
          {
            "currency": "CAD",
            "monthly": {
              "amount": 2500,
              "currency": "CAD"
            },
            "yearly": {
              "amount": 25000,
              "currency": "CAD"
            },
            "fee": {
              "amount": 1351,
              "currency": "CAD"
            },
            "converted": true,
            "margin": {
              "kind": "keep",
              "amount": {
                "amount": 1149,
                "currency": "CAD"
              },
              "of": {
                "amount": 2500,
                "currency": "CAD"
              }
            }
          }
        ],
        "stores": 0
      }
    ],
    "chargedBy": "DripFunnel for Northstar",
    "actions": {
      "create": {
        "allowed": false,
        "reason": "OWNERS_AND_ADMINS_ONLY"
      }
    }
  }
}

export const growthEditors: Record<PartnerRole, PlanEditor> = {
  "partner-owner": {
    "plan": {
      "id": "growth",
      "name": "Growth",
      "description": "For shops that sell every day.",
      "status": "live",
      "trialDays": 14,
      "prices": [
        {
          "currency": "USD",
          "monthly": {
            "amount": 4900,
            "currency": "USD"
          },
          "yearly": {
            "amount": 49000,
            "currency": "USD"
          },
          "fee": {
            "amount": 1800,
            "currency": "USD"
          },
          "converted": false,
          "margin": {
            "kind": "keep",
            "amount": {
              "amount": 3100,
              "currency": "USD"
            },
            "of": {
              "amount": 4900,
              "currency": "USD"
            }
          }
        },
        {
          "currency": "CAD",
          "monthly": {
            "amount": 6500,
            "currency": "CAD"
          },
          "yearly": {
            "amount": 65000,
            "currency": "CAD"
          },
          "fee": {
            "amount": 2432,
            "currency": "CAD"
          },
          "converted": true,
          "margin": {
            "kind": "keep",
            "amount": {
              "amount": 4068,
              "currency": "CAD"
            },
            "of": {
              "amount": 6500,
              "currency": "CAD"
            }
          }
        }
      ],
      "stores": 44,
      "entitlements": {
        "domain": true,
        "offers": true,
        "suppliersOn": true,
        "powered": false,
        "aplus": true,
        "size": true,
        "products": 5000,
        "staff": 5,
        "suppliers": 5,
        "languages": 2,
        "currencies": 2,
        "publish": 60,
        "ai": 200
      }
    },
    "ceilings": {
      "products": 20000,
      "staff": 25,
      "suppliers": 50,
      "languages": 5,
      "currencies": 5,
      "publish": 300,
      "ai": 1000,
      "powered": {
        "allowed": true,
        "note": "contract"
      }
    },
    "currencies": [
      "USD",
      "CAD"
    ],
    "trials": [
      0,
      7,
      14,
      30
    ],
    "chargedBy": "DripFunnel for Northstar",
    "permission": {
      "edit": {
        "allowed": true
      },
      "price": {
        "allowed": true
      }
    },
    "retireTargets": [
      {
        "id": "starter",
        "name": "Starter"
      },
      {
        "id": "pro",
        "name": "Pro"
      }
    ],
    "retireDates": [
      "2026-11-01T00:00:00Z",
      "2026-12-01T00:00:00Z",
      "2027-01-01T00:00:00Z"
    ]
  },
  "partner-admin": {
    "plan": {
      "id": "growth",
      "name": "Growth",
      "description": "For shops that sell every day.",
      "status": "live",
      "trialDays": 14,
      "prices": [
        {
          "currency": "USD",
          "monthly": {
            "amount": 4900,
            "currency": "USD"
          },
          "yearly": {
            "amount": 49000,
            "currency": "USD"
          },
          "fee": {
            "amount": 1800,
            "currency": "USD"
          },
          "converted": false,
          "margin": {
            "kind": "keep",
            "amount": {
              "amount": 3100,
              "currency": "USD"
            },
            "of": {
              "amount": 4900,
              "currency": "USD"
            }
          }
        },
        {
          "currency": "CAD",
          "monthly": {
            "amount": 6500,
            "currency": "CAD"
          },
          "yearly": {
            "amount": 65000,
            "currency": "CAD"
          },
          "fee": {
            "amount": 2432,
            "currency": "CAD"
          },
          "converted": true,
          "margin": {
            "kind": "keep",
            "amount": {
              "amount": 4068,
              "currency": "CAD"
            },
            "of": {
              "amount": 6500,
              "currency": "CAD"
            }
          }
        }
      ],
      "stores": 44,
      "entitlements": {
        "domain": true,
        "offers": true,
        "suppliersOn": true,
        "powered": false,
        "aplus": true,
        "size": true,
        "products": 5000,
        "staff": 5,
        "suppliers": 5,
        "languages": 2,
        "currencies": 2,
        "publish": 60,
        "ai": 200
      }
    },
    "ceilings": {
      "products": 20000,
      "staff": 25,
      "suppliers": 50,
      "languages": 5,
      "currencies": 5,
      "publish": 300,
      "ai": 1000,
      "powered": {
        "allowed": true,
        "note": "contract"
      }
    },
    "currencies": [
      "USD",
      "CAD"
    ],
    "trials": [
      0,
      7,
      14,
      30
    ],
    "chargedBy": "DripFunnel for Northstar",
    "permission": {
      "edit": {
        "allowed": true
      },
      "price": {
        "allowed": true
      }
    },
    "retireTargets": [
      {
        "id": "starter",
        "name": "Starter"
      },
      {
        "id": "pro",
        "name": "Pro"
      }
    ],
    "retireDates": [
      "2026-11-01T00:00:00Z",
      "2026-12-01T00:00:00Z",
      "2027-01-01T00:00:00Z"
    ]
  },
  "partner-finance": {
    "plan": {
      "id": "growth",
      "name": "Growth",
      "description": "For shops that sell every day.",
      "status": "live",
      "trialDays": 14,
      "prices": [
        {
          "currency": "USD",
          "monthly": {
            "amount": 4900,
            "currency": "USD"
          },
          "yearly": {
            "amount": 49000,
            "currency": "USD"
          },
          "fee": {
            "amount": 1800,
            "currency": "USD"
          },
          "converted": false,
          "margin": {
            "kind": "keep",
            "amount": {
              "amount": 3100,
              "currency": "USD"
            },
            "of": {
              "amount": 4900,
              "currency": "USD"
            }
          }
        },
        {
          "currency": "CAD",
          "monthly": {
            "amount": 6500,
            "currency": "CAD"
          },
          "yearly": {
            "amount": 65000,
            "currency": "CAD"
          },
          "fee": {
            "amount": 2432,
            "currency": "CAD"
          },
          "converted": true,
          "margin": {
            "kind": "keep",
            "amount": {
              "amount": 4068,
              "currency": "CAD"
            },
            "of": {
              "amount": 6500,
              "currency": "CAD"
            }
          }
        }
      ],
      "stores": 44,
      "entitlements": {
        "domain": true,
        "offers": true,
        "suppliersOn": true,
        "powered": false,
        "aplus": true,
        "size": true,
        "products": 5000,
        "staff": 5,
        "suppliers": 5,
        "languages": 2,
        "currencies": 2,
        "publish": 60,
        "ai": 200
      }
    },
    "ceilings": {
      "products": 20000,
      "staff": 25,
      "suppliers": 50,
      "languages": 5,
      "currencies": 5,
      "publish": 300,
      "ai": 1000,
      "powered": {
        "allowed": true,
        "note": "contract"
      }
    },
    "currencies": [
      "USD",
      "CAD"
    ],
    "trials": [
      0,
      7,
      14,
      30
    ],
    "chargedBy": "DripFunnel for Northstar",
    "permission": {
      "edit": {
        "allowed": false,
        "reason": "OWNERS_AND_ADMINS_ONLY"
      },
      "price": {
        "allowed": true
      }
    },
    "retireTargets": [
      {
        "id": "starter",
        "name": "Starter"
      },
      {
        "id": "pro",
        "name": "Pro"
      }
    ],
    "retireDates": [
      "2026-11-01T00:00:00Z",
      "2026-12-01T00:00:00Z",
      "2027-01-01T00:00:00Z"
    ]
  },
  "partner-support": {
    "plan": {
      "id": "growth",
      "name": "Growth",
      "description": "For shops that sell every day.",
      "status": "live",
      "trialDays": 14,
      "prices": [
        {
          "currency": "USD",
          "monthly": {
            "amount": 4900,
            "currency": "USD"
          },
          "yearly": {
            "amount": 49000,
            "currency": "USD"
          },
          "fee": {
            "amount": 1800,
            "currency": "USD"
          },
          "converted": false,
          "margin": {
            "kind": "keep",
            "amount": {
              "amount": 3100,
              "currency": "USD"
            },
            "of": {
              "amount": 4900,
              "currency": "USD"
            }
          }
        },
        {
          "currency": "CAD",
          "monthly": {
            "amount": 6500,
            "currency": "CAD"
          },
          "yearly": {
            "amount": 65000,
            "currency": "CAD"
          },
          "fee": {
            "amount": 2432,
            "currency": "CAD"
          },
          "converted": true,
          "margin": {
            "kind": "keep",
            "amount": {
              "amount": 4068,
              "currency": "CAD"
            },
            "of": {
              "amount": 6500,
              "currency": "CAD"
            }
          }
        }
      ],
      "stores": 44,
      "entitlements": {
        "domain": true,
        "offers": true,
        "suppliersOn": true,
        "powered": false,
        "aplus": true,
        "size": true,
        "products": 5000,
        "staff": 5,
        "suppliers": 5,
        "languages": 2,
        "currencies": 2,
        "publish": 60,
        "ai": 200
      }
    },
    "ceilings": {
      "products": 20000,
      "staff": 25,
      "suppliers": 50,
      "languages": 5,
      "currencies": 5,
      "publish": 300,
      "ai": 1000,
      "powered": {
        "allowed": true,
        "note": "contract"
      }
    },
    "currencies": [
      "USD",
      "CAD"
    ],
    "trials": [
      0,
      7,
      14,
      30
    ],
    "chargedBy": "DripFunnel for Northstar",
    "permission": {
      "edit": {
        "allowed": false,
        "reason": "OWNERS_AND_ADMINS_ONLY"
      },
      "price": {
        "allowed": false,
        "reason": "OWNERS_AND_ADMINS_ONLY"
      }
    },
    "retireTargets": [
      {
        "id": "starter",
        "name": "Starter"
      },
      {
        "id": "pro",
        "name": "Pro"
      }
    ],
    "retireDates": [
      "2026-11-01T00:00:00Z",
      "2026-12-01T00:00:00Z",
      "2027-01-01T00:00:00Z"
    ]
  },
  "partner-read-only": {
    "plan": {
      "id": "growth",
      "name": "Growth",
      "description": "For shops that sell every day.",
      "status": "live",
      "trialDays": 14,
      "prices": [
        {
          "currency": "USD",
          "monthly": {
            "amount": 4900,
            "currency": "USD"
          },
          "yearly": {
            "amount": 49000,
            "currency": "USD"
          },
          "fee": {
            "amount": 1800,
            "currency": "USD"
          },
          "converted": false,
          "margin": {
            "kind": "keep",
            "amount": {
              "amount": 3100,
              "currency": "USD"
            },
            "of": {
              "amount": 4900,
              "currency": "USD"
            }
          }
        },
        {
          "currency": "CAD",
          "monthly": {
            "amount": 6500,
            "currency": "CAD"
          },
          "yearly": {
            "amount": 65000,
            "currency": "CAD"
          },
          "fee": {
            "amount": 2432,
            "currency": "CAD"
          },
          "converted": true,
          "margin": {
            "kind": "keep",
            "amount": {
              "amount": 4068,
              "currency": "CAD"
            },
            "of": {
              "amount": 6500,
              "currency": "CAD"
            }
          }
        }
      ],
      "stores": 44,
      "entitlements": {
        "domain": true,
        "offers": true,
        "suppliersOn": true,
        "powered": false,
        "aplus": true,
        "size": true,
        "products": 5000,
        "staff": 5,
        "suppliers": 5,
        "languages": 2,
        "currencies": 2,
        "publish": 60,
        "ai": 200
      }
    },
    "ceilings": {
      "products": 20000,
      "staff": 25,
      "suppliers": 50,
      "languages": 5,
      "currencies": 5,
      "publish": 300,
      "ai": 1000,
      "powered": {
        "allowed": true,
        "note": "contract"
      }
    },
    "currencies": [
      "USD",
      "CAD"
    ],
    "trials": [
      0,
      7,
      14,
      30
    ],
    "chargedBy": "DripFunnel for Northstar",
    "permission": {
      "edit": {
        "allowed": false,
        "reason": "OWNERS_AND_ADMINS_ONLY"
      },
      "price": {
        "allowed": false,
        "reason": "OWNERS_AND_ADMINS_ONLY"
      }
    },
    "retireTargets": [
      {
        "id": "starter",
        "name": "Starter"
      },
      {
        "id": "pro",
        "name": "Pro"
      }
    ],
    "retireDates": [
      "2026-11-01T00:00:00Z",
      "2026-12-01T00:00:00Z",
      "2027-01-01T00:00:00Z"
    ]
  }
}

export const newPlanEditor: PlanEditor = {
  "plan": null,
  "ceilings": {
    "products": 20000,
    "staff": 25,
    "suppliers": 50,
    "languages": 5,
    "currencies": 5,
    "publish": 300,
    "ai": 1000,
    "powered": {
      "allowed": true,
      "note": "contract"
    }
  },
  "currencies": [
    "USD",
    "CAD"
  ],
  "trials": [
    0,
    7,
    14,
    30
  ],
  "chargedBy": "DripFunnel for Northstar",
  "permission": {
    "edit": {
      "allowed": true
    },
    "price": {
      "allowed": true
    }
  },
  "retireTargets": [
    {
      "id": "starter",
      "name": "Starter"
    },
    {
      "id": "growth",
      "name": "Growth"
    },
    {
      "id": "pro",
      "name": "Pro"
    }
  ],
  "retireDates": [
    "2026-11-01T00:00:00Z",
    "2026-12-01T00:00:00Z",
    "2027-01-01T00:00:00Z"
  ]
}
