# Contributing — Punjabi Beats

Chhota aur seedha project hai — contributions welcome! 🙌

## Pehle padho
- [`REQUIREMENTS.md`](./REQUIREMENTS.md) — FR-ids se features track hote hain
- [`CHECKLIST.md`](./CHECKLIST.md) — 18 phases ka live status (tick counts update rehte hain)
- [`QUICKSTART.md`](./QUICKSTART.md) — run/deploy steps

## Workflow
1. Fork/branch banao: `feat/<chhota-naam>` ya `fix/<bug>`
2. Code karte waqt:
   - **TypeScript strict** — `cd mobile && npx tsc --noEmit` → 0 errors
   - Existing conventions follow karo (Hinglish comments, Zustand selectors,
     `services/` me logic, screens sirf UI)
   - Naya feature = REQUIREMENTS ka FR id mention karo commit/PR me
3. Naya box tick karna ho to CHECKLIST ka **Progress Tracker** bhi recalculate karo
   (total/done/% actual checkbox counts se)
4. PR se pehle:
   - `node probe-publish.mjs` pass ho
   - Device/manual test jo kiya ho wo CHECKLIST me note karo

## 🔴 Secrets policy (strict)
- Server keys (`APINATOR_SECRET`, `APINATOR_APP_ID`, …) sirf `.env` / Vercel
  dashboard me — **kabhi** `mobile/` ya code me mat likho
- `EXPO_PUBLIC_*` = public keys only
- `.vercelignore` aur `.gitignore` ko mat hatao

## Code style
- TypeScript strict, `any` nahi
- Comments Hinglish me (codebase ka tone)
- Components dumb, logic stores/services me
- Har user-facing action pe toast/haptic feedback (existing helpers reuse karo:
  `utils/haptics.ts`, `react-native-toast-message`)
