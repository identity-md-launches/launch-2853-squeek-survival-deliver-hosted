Design review and documentation used the pinned Better Interface reference, adapted from Jakub Krehel's Better Interface (MIT, commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`) and Paul Bakaus's Impeccable documentation guidance (Apache-2.0, commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`). The provided notices and license text are preserved in `LICENSES/design-guidance.txt`.

- https://github.com/jakubkrehel/skills/tree/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-interface
- https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md

Runtime visuals, sprites, Canvas artwork, inline icons and sound are created in this project. No remote fonts, graphics or runtime libraries are loaded. TypeScript and Playwright are development tools, declared in the manifest and lockfile; their installed packages and browser runtimes are not part of the submission.

Wallet protocol references: https://eips.ethereum.org/EIPS/eip-6963 and https://eips.ethereum.org/EIPS/eip-20. The implementation follows the task's vanilla EIP-6963 / `window.ethereum` requirement instead of introducing the React / wagmi / Coinbase SDK stack in the general wallet reference.
