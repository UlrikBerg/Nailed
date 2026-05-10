# Nailed — memory index

- [Product concept](product_concept.md) — peer-to-peer marketplace for beauty services, nails first, web+iOS+Android
- [Platform targets](platform_targets.md) — three clients share one API; auth must be token-based; PKCE for OIDC
- [Hosting preference](hosting_preference.md) — Hostinger preferred, but plan must support Node.js (Cloud/VPS)
- [/partner/ mocks](partner_mocks.md) — kept as design inspiration; real salon panel is /salong-panel.html
- [Deploy runbook](deploy_runbook.md) — Hostinger deploy steps live in docs/HOSTINGER_DEPLOY.md; read before deploy talks
- [Hostinger DB](hostinger_db_setup.md) — MySQL DB+user already created (u403813188_nailed); uses Unix socket; password sync was the open issue
- [Hostinger deploy state](hostinger_deploy_state.md) — site is LIVE, SSH-key auth set up; deploy with `ssh nailed-host '...'`; gotchas around hPanel env-var source of truth
- [Never guess](feedback_never_guess.md) — verify project/deploy/hosting facts before stating; if unsure, ask or check first
