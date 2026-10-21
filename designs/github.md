repo: SoftoboticsTechnologies/df-store
branch: main

## Last sync

date: 2026-09-13T05:51:14Z

### Updated in this project

- Read SAAS-PLAN.md for the provisioning sequence, plan/billing model and portal/BFF boundary
- Built flow A1 (sign up + store provisioning) and the role-aware app shell from the spec
- Provisioning banner shows four merchant-facing steps condensed from the six BFF steps in SAAS-PLAN §4
- Role navigation derived from the six fixed role templates in AUTH-PLAN §5.3

## Screen map

| Project screen | Built from |
|---|---|
| DripFunnel Portal A1 Signup.dc.html — create account, verify email | uploads/DESIGN-BRIEF.md §3 A1, AUTH-PLAN.md §7.2 (non-enumerable invite/signup), §2.11 (token TTL) |
| DripFunnel Portal A1 Signup.dc.html — provisioning banner, ready, failed | SAAS-PLAN.md §4 (provisioning steps), §8 (no transactional create-tenant → rollback/retry), §10 (trial) |
| DripFunnel Portal A1 Signup.dc.html — app shell, store switcher, locked nav | AUTH-PLAN.md §3.2 (acting channel always visible), §5.3 (role templates), §8.5 (vendors never see order totals) |
