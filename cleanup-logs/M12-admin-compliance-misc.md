# M12-admin-compliance-misc — Cleanup Log

## Connections (dusre modules se joints)
- **Compliance:** nabhRegisterController 14 registers (sentinel/handhygiene/...) — sab modules ke quality events yahan aate hain.

## Changes
| Part | File | Kya tha → kya hua | LOC saved | Verified |
|---|---|---|---|---|
| A | nabhRegisterController | 14 raw catches → shared sendErr | ~11 | node -c + handhygiene/sentinel-events registers 200 |
| B | NABHSignagePage | dead HospitalBadge (19 lines — M5 pre-note confirm hua) | 19 | build green |
| C | EmergencyAssessmentPage | dead PRIORITIES const (3) | 3 | build green |

## Pre-noted findings (M5 scan se mila)
- `pages/admin/NABHSignagePage.jsx` → `HospitalBadge` component possibly dead (1 ref) — M12-B me verify + remove.

## Security / NABH-NABL notes

## Left as-is (jaanbujhkar, wajah ke saath)
