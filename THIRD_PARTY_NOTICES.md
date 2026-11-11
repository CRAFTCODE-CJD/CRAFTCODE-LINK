# Open-source foundation

CRAFTCODE LINK's room control, interface, audio controls and application integration are project source code. The app uses maintained open-source components instead of copying an unrelated Discord clone.

| Component | Pinned/resolved version | Purpose | License / source |
|---|---|---|---|
| Unicode Emoji and CLDR | Emoji 17.0 and CLDR 48 | Offline emoji sequences and English/Russian names | Unicode License v3 in `licenses/Unicode-LICENSE.txt`. [Emoji data](https://www.unicode.org/Public/17.0.0/emoji/emoji-test.txt) · [CLDR annotations](https://github.com/unicode-org/cldr/tree/release-48/common/annotations) |
| Electron | 45.2.3 | Desktop shell, Chromium capture, WebRTC, sandboxed UI | MIT; https://github.com/electron/electron |
| Chromium / WebRTC / Node.js | As shipped in Electron 45.2.3 | Rendering, media codecs/transport, OS/network integration | Multiple licenses; official runtime LICENSE and LICENSES.chromium.html |
| HyperDHT | 6.36.0 | Optional peer discovery, rendezvous and authenticated Noise streams | MIT, https://github.com/holepunchto/hyperdht |
| udx-native, sodium-native and transitive dependencies | Versions in package-lock.json | UDP transport and cryptography | Licenses in each bundled package |
| selfsigned | 3.0.1 | Ephemeral room TLS certificate | MIT; https://github.com/jfromaniello/selfsigned |
| node-forge | Exact lockfile resolution | Certificate implementation used by selfsigned | BSD-3-Clause or GPL-2.0; https://github.com/digitalbazaar/forge |
| @electron/get and extractor | Exact lockfile resolution; build only | Retrieve/check/extract official desktop runtime | Respective package licenses shipped with development dependencies |
| Playwright | QA tool only; not included in app runtime | Automated actual Electron interaction | Apache-2.0; https://github.com/microsoft/playwright |

The portable distribution retains the original Electron runtime license notices and production dependency license files. The CRAFTCODE LINK project license is `CRAFTCODE-LINK-LICENSE.txt` in the portable folder and `LICENSE` in the source archive. Do not delete upstream notices when repackaging.

## Primary technical references used

- https://www.electronjs.org/docs/latest/api/desktop-capturer
- https://www.electronjs.org/docs/latest/api/session
- https://www.electronjs.org/docs/latest/api/web-contents
- https://www.electronjs.org/blog/electron-45-0
- https://github.com/electron/electron/pull/52455/files
- https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/base/media_switches.cc
- https://webrtc.org/
- https://www.rfc-editor.org/rfc/rfc8445.html

The manually advertised mapped ICE candidate is an implementation relying on explicit same-port NAT forwarding and ICE's peer-reflexive checks. It has not been validated across the user's real ISP/router combination.

Strophe.js 6.0.0, MIT. The browser ESM build is included locally in src/renderer/vendor from the npm release strophe.js@6.0.0. The complete notice is in STROPHE-LICENSE.txt next to the module. No CDN is used.

The optional Windows game network uses the official WireGuard Wintun 0.14.1 binary (wintun.net), distributed with its original license in bin/Wintun-LICENSE.txt. The companion verifies the vendor DLL SHA-256 before loading it.

## Where to find the notices and corresponding source

LINK displays emoji with the offline Noto Color Emoji COLRv1 font. The original font is distributed under the SIL Open Font License 1.1, included in `licenses/Noto-Emoji-OFL.txt`. [Exact upstream font and license](https://github.com/googlefonts/noto-emoji/tree/99701e07d3d1fe1bdbcdb14964547f0fd592966f/2D/fonts)

| Distributed material | License notices and source |
|---|---|
| Windows desktop runtime | The binary package preserves `LICENSE` and `LICENSES.chromium.html` from the authenticated Electron 45.2.3 Windows ZIP. The source ZIP contains both under `licenses/`, with the former named `Electron-LICENSE.txt`. The build records the SHA-256 of the official runtime ZIP in `BUILD-INFO.json`. [Electron 45.2.3 release](https://github.com/electron/electron/releases/tag/v45.2.3) · [Pinned upstream DEPS](https://github.com/electron/electron/blob/v45.2.3/DEPS) · [Node.js v24.22.2 source and licenses](https://github.com/nodejs/node/tree/v24.22.2) |
| Chromium and FFmpeg | Electron pins Chromium 156.0.8078.80. Its DEPS pins FFmpeg commit `9db86ce5b5b454dfc96c435f9f0723012980c37f`. The separate `ffmpeg.dll` is the unmodified Electron release library. Its corresponding source tree, build definitions, license files and four Electron patches in application order are supplied in the source ZIP under `third-party-sources/ffmpeg/`, with SHA-256 checksums. [Chromium DEPS](https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.80/DEPS) · [FFmpeg source tree](https://chromium.googlesource.com/chromium/third_party/ffmpeg/+/9db86ce5b5b454dfc96c435f9f0723012980c37f) · [Electron patch order](https://github.com/electron/electron/blob/v45.2.3/patches/ffmpeg/.patches) · [Electron build instructions](https://www.electronjs.org/docs/latest/development/build-instructions-gn) |
| Production npm modules | `THIRD-PARTY-NPM.txt` in both distributions lists every npm module in the actual Windows payload, exact version, source tarball, license declaration and upstream license/notice texts. The source ZIP contains integrity digests in `package-lock.json`. The upstream `noise-curve-ed@2.1.0` release declares ISC and supplies no separate license file or copyright holder in its metadata. `licenses/ISC-template.txt` is the SPDX reference copy of ISC terms. The Windows distribution uses the BSD-3-Clause option for node-forge. [noise-curve-ed declaration](https://github.com/holepunchto/noise-curve-ed/blob/v2.1.0/package.json) · [ISC reference](https://spdx.org/licenses/ISC.html) |
| Windows Node native addons | The sodium-native prebuild uses libsodium at `79a59b7` (ISC). The udx-native prebuild uses libudx at `9c9a0e7` (Apache-2.0) and its libuv headers (v1.51.0, MIT). Both addons use libjstl (sodium at `1890183`, udx at `7e31e67`) and bare-compat-napi headers (Apache-2.0). `licenses/` contains the corresponding notices and license texts. [libsodium](https://github.com/jedisct1/libsodium/tree/79a59b7) · [libudx](https://github.com/holepunchto/libudx/tree/9c9a0e7) · [libuv](https://github.com/libuv/libuv/tree/v1.51.0) · [libjstl](https://github.com/holepunchto/libjstl/tree/7e31e67) · [bare-compat-napi](https://github.com/holepunchto/bare-compat-napi/tree/v1.4.1) |
| Go Windows helpers | `native/loopback`, `native/game-lan` and `installer/care` hold the application helper sources. The distributors' copies of the Go BSD license, patent grant and vendored x/net BSD license are in `licenses/Go-*.txt`. [Go source distribution](https://go.dev/dl/) · [Go license](https://go.dev/LICENSE) |
| Windows installer | The NSIS 3.11 installer embeds the NSIS runtime, its plug-ins and the LZMA decompressor. `licenses/NSIS-3.11-COPYING.txt` includes the applicable notices, zlib and Common Public License 1.0. The application installer script is in `installer/setup.nsi`. [NSIS license](https://nsis.sourceforge.io/License) · [NSIS 3.11 source distribution](https://sourceforge.net/projects/nsis/files/NSIS%203/3.11/) |
| Wintun and Strophe | The Wintun DLL is distributed with LINK, uses its published API and retains the vendor's separate Prebuilt Binaries License in `resources/app/bin/Wintun-LICENSE.txt`. The source archive preserves this license and the original binaries in `native/game-lan/vendor/`. For Strophe.js the original MIT notice is beside the vendored ESM module in `src/renderer/vendor/`. [Wintun distribution](https://www.wintun.net/) · [Strophe.js](https://github.com/strophe/strophejs) |

The FFmpeg archive contains the Chromium fork before Electron's patches. Extract it into an empty directory, then apply the four adjacent patch files in the order in `SHA256SUMS.txt`, skipping the archive itself. For a full Electron build, the versioned Electron DEPS and patch configuration select the surrounding Chromium, Node and toolchain sources. The source ZIP includes LINK's own build and packaging scripts.

## Release and support configuration

The Windows x64 update checker requests the latest public GitHub release of `CRAFTCODE-CJD/CRAFTCODE-LINK`. Its repository and optional donation URL are fixed at build time in `src/project-links.json`. A null donation URL hides the support button. To enable it in a future build, set `donationURL` to the owner's confirmed HTTPS page. Only an explicit click opens the external browser.

For a future public release, attach `CRAFTCODE-LINK-X.Y.Z-Setup-x64.exe`, `CRAFTCODE-LINK-X.Y.Z-Portable-x64.zip`, `CRAFTCODE-LINK-X.Y.Z-Source.zip`, the generated checksum list and update code to the same stable tag (`vX.Y.Z` or `X.Y.Z`). The Source ZIP provides the matching code and notices alongside the binaries. Verify that the published installer asset's GitHub API `digest` equals `sha256:` followed by the local SHA-256 in the checksum list. LINK accepts the exact installer name for its platform, filters drafts and pre-releases and rejects missing or inconsistent digests. GitHub's digest binds the download to the published asset. This verification relies on the repository owner's GitHub account and HTTPS. The current distribution does not carry a CRAFTCODE Authenticode signature. [GitHub release metadata](https://docs.github.com/en/rest/releases/releases#get-the-latest-release) · [GitHub release asset download](https://docs.github.com/en/rest/releases/assets#get-a-release-asset)
