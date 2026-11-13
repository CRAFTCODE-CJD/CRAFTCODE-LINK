# Contributing to CRAFTCODE LINK

LINK is a messenger for friends with local profiles, calls, screen sharing and a separate game network. The source license is MIT. Third-party components retain the notices and terms described in THIRD_PARTY_NOTICES.md.

Start with an issue describing the user's scenario and expected behavior. A small reproducible example helps with connection, media and file bugs. Report security vulnerabilities through the repository's private Security form. Include the affected version, reproduction and impact. Personal profiles, messages, passwords and keys belong in the user's local storage.

Use Node.js 24 and Go 1.22 or newer on Windows. The current check workflow uses Node.js 24.22.1 and Go 1.27.3. Install dependencies with `npm ci`, then run `npm run check` and `npm test`. Run `go test ./...` in `native/loopback`, `native/game-lan` and `installer/care` when changing native code. Build steps are in BUILD-WINDOWS.cmd and the release guide.

Preserve the separation between a media room and Game LAN. Validate peer input and session permissions at the receiver. Every resource owner releases its files, sockets, devices and timers on cancellation, exit and profile change. Preserve existing profiles and supported older peers. Keep Russian and English strings, keyboard actions and error recovery together with each feature.

Whenever a screen, control label or user flow changes, check the affected Help articles, first steps and embedded examples in the same change. Update both languages, captions and hints. Re-record any affected tutorial and its poster using demonstration profiles when the shown screen or action sequence changes. Verify the instructions through the application and play each updated video. Describe the updated materials in the pull request, or explain why the existing materials remain accurate. [Help maintenance and verification](docs/HELP_AND_FIRST_RUN_RU.md)

Test network changes with temporary profiles and test peers. State whether a result used actual received bytes, decoded media or a completed game match. Mark unavailable checks as BLOCKED or NOT TESTED. The local Windows integration scenarios are described in WINDOWS_TEST_RU.md and QA_REPORT.md.

The `Check Windows source` workflow runs syntax, contract and native-helper tests on pull requests. Packaged installation, physical media devices and a multi-PC game session have additional checks in the release guide. [Release guide](docs/GITHUB_RELEASE_RU.md)

To catch personal data before committing or pushing, install the local checks with `python scripts/git-privacy.py install` (Git 2.55+). Contributors keep their own Git identity. Existing hooks, including Git LFS, remain installed. [Publication privacy and release checks](docs/PUBLICATION_PRIVACY.md)
