# 🧹 Strategic Code Cleaner Program — Master Plan

> **Goal:** fizul lamba code → short & concise, **functionality 100% same**. Har module ke saath security + functionality recheck (NABH/NABL standards barkarar). Har change per-module log me — taaki agle module pe kaam karte waqt cross-module connections ki info ready ho.

## Kanoon (har part pe lagoo — koi exception nahi)
1. **Zero behavior change** — sirf: dead code removal, duplication → shared helper, verbose → concise, unused imports/vars, copy-paste blocks → ek function. Logic/output/API shapes bilkul same.
2. **Har part ke baad:** `node -c` (backend) / `npm run build` (frontend) green + us module ka smoke E2E (jo pattern is repo me established hai — ZZ fixtures, cleanup).
3. **Money / clinical / compliance code (billing math, GST, stock, NABL/NABH gates):** simplify sirf tab jab test pehle likha ho jo before/after same output prove kare. Shak ho to CHHODO — log me "left as-is (risk)" likho.
4. **Commit-per-part** (`cleanup(M<n><part>): ...`), TASK-LOG nahi — module log update hota hai.
5. Security issue mile to **turant fix** (standing directive) — cleanup se alag commit.
6. Skills: `/simplify` (quality cleanups), `/code-review` (verify pass), `/security-review` (module complete hone pe).

## Module List + Parts (LOC-based division)

| # | Module | Scope | Parts | Status |
|---|--------|-------|-------|--------|
| M1 | **Pharmacy** (fresh 20/20 E2E — safest start) | BE 12.5k + FE 8.7k | A: BE models+services · B: pharmacyController+routes · C: FE pages | ✅ 2026-07-10 (61 LOC removed; layer already tight — R7 cycles) |
| M2 | **Accounts/Finance/Tax** (20/20 E2E) | BE ~4.5k + FE 1.8k | A: BE reports/tax/cashier · B: FE console+pages | ✅ 2026-07-10 (3 LOC; dono layers already tight) |
| M3 | **Billing** (NABH-audited) | BE 14.7k + FE 3.6k | A: models+money/counter utils · B: controllers+services · C: FE + autoBilling | ⬜ |
| M4 | **Lab/Investigation** | BE ~3.2k + FE lab | A: BE · B: FE + printables | ⬜ |
| M5 | **TPA/Claims** | BE 1.5k + FE | A: BE · B: FE + claim printables | ⬜ |
| M6 | **Clinical** | BE 16.6k + FE 13.4k | A: BE models · B: BE ctrl/services · C: FE pages | ⬜ |
| M7 | **Doctor** | BE 7.7k + FE 11.6k | A: BE · B: FE assessment pages · C: FE panels/notes | ⬜ |
| M8 | **Nursing** | FE 11.5k + nurse 4.4k | A: nursing pages · B: nurse panels · C: shared clinical components | ⬜ |
| M9 | **Patient/Reception** | BE 9.5k + FE 10.9k | A: BE · B: ReceptionConsole · C: patient pages | ⬜ |
| M10 | **Prints** | 24.2k | A: shell/infra/openPrint · B: printables ½ · C: printables ½ + themes | ⬜ |
| M11 | **Auth/User/RBAC/HR** | BE ~2.5k | A: auth/middleware · B: user/HR/credentials | ⬜ |
| M12 | **Admin/Compliance/ER/DC/misc FE** | FE ~20k | A: compliance · B: admin · C: emergency+services+quality | ⬜ |

**Order:** M1→M12 seedha. Ek baar me EK part (1A → 1B → 1C → 2A …). Part complete = build green + smoke green + commit + module-log updated.

## Per-module log format (`cleanup-logs/M<n>-<name>.md`)
- **Connections:** is module ke dusre modules se joints (kaun kise call karta hai, shared models/utils) — agle module ke kaam ki foundation
- **Changes:** har cleanup entry: file, kya tha → kya hua, LOC saved, verify kaise hua
- **Security/NABH notes:** jo mila/fix hua
- **Left as-is:** risky cheezein jaanbूझkar nahi chhedi + wajah

## Status board yahin update hota rahega
Current: **M3-A pending** (Billing — models + money/counter utils; RULE 3 STRICT: money math bina before/after test ke NAHI chhedna)
