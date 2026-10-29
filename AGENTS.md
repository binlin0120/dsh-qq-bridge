# Project maintenance

- Preserve the upstream copyright and license notices.
- Keep credentials, runtime state, private media and deployment configuration out of Git.
- Run `npm test` before preparing a public release. The default tests use isolated fixtures; never send real QQ messages or invoke paid generation from tests.
- DSH integration checks require an explicit opt-in and a matching local DSH installation. Report optional test skips accurately.
- Do not replace a running deployment with this portable example without migrating its configuration and checking the deployment-specific paths.
