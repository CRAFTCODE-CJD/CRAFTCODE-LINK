# CRAFTCODE LINK implementation contract

In 0.3.0 the online contact flow uses XMPP rosters, mutual subscriptions, resource-bound call signaling and per-call STUN/TURN discovery. The host forwards media and chat to up to two guests. The manual room contract below covers the LAN/explicit address mode.

## Current audio and maintenance contract (0.3.4)

Display capture supplies video only. Native Windows process-loopback excludes the entire app process tree. An unavailable or interrupted protected source falls back to video only. Microphone, shared audio and individual local playback have independent gain controls. Maintenance uses graceful installation-scoped Windows Restart Manager shutdown.

## Manual rooms (0.1)

Desktop Electron application, Russian UI, Windows 11 preferred (Windows 10 voice/video with system-loopback limitations), maximum EIGHT participants; 4–8 EXPERIMENTAL, automated media QA covers2–3. No external signaling, STUN or TURN. Node built-ins + selfsigned only runtime dependency. Main process hosts TLS TCP 45831; WebRTC UDP range 45832–45863. IPv4 public host configured by user, same-number port mapping. LAN supported. No automatic router/firewall changes. No telemetry.

## Ownership

- Network agent: `src/core/*`, `tests/network.test.cjs`, `tests/invite.test.cjs`.
- Desktop agent: `src/main.cjs`, `src/preload.cjs`, `scripts/*`, `START.cmd`, `BUILD-WINDOWS.cmd`; consult root before dependency changes.
- UI agent: `src/renderer/index.html`, `src/renderer/styles.css`, optional local SVG assets. Root owns JS.
- Root: `src/renderer/app.mjs`, `src/renderer/peer.mjs`, `src/renderer/audio.mjs`, tests, docs, packaging/review.

## Main renderer bridge: window.craftlink

Promise-returning methods:

- `environment()` -> `{version,platform,arch,electron,osRelease,systemAudioSupported,ownAudioExclusionSupported,udpMin,udpMax}`
- `hostRoom({name,address,port:45831})` -> session info
- `joinRoom({name,invite})` -> session info
- `leaveRoom()`
- `sendSignal({peerId,data})` (data JSON object under128KiB)
- `sendChat({text})` (under4000 chars)
- `setPresence({micMuted,sharing,shareTitle})`
- `sources()` -> `[{id,name,type:'screen'|'window',thumbnail,appIcon}]`
- `selectSource({id,withAudio})` -> `{ok:true}`; authorize only one immediate getDisplayMedia call, expires after15s. Main uses setDisplayMediaRequestHandler, validates requesting frame.
- `copyText(text)`
- `onEvent(callback)` -> unsubscribe function; callback receives one plain object below. Never expose ipcRenderer.

Session info: `{role:'host'|'guest',selfId,hostId,invite?:string,address,publicAddress?:string,port,udpMin:45832,udpMax:45863,peers:[...]}`.

Peer: `{id,name,slot:0..7,micMuted:true,sharing:false,shareTitle:''}`. Host slot0. Fixed guest slots1..7; id changes on reconnect. Guest send only to host.

Events: `{type:'roster',peers}`, `{type:'signal',from,data}`, `{type:'chat',id,from,name,text,time}`, `{type:'closed',reason}`, `{type:'error',message}`. Main forwards over `craftlink:event`.

Core exports `startHost({name,address,port,udpMin,udpMax,onEvent})` and `joinHost({name,invite,onEvent})`, async -> session object with `getInfo()`, `sendSignal(peerId,data)`, `sendChat(text)`, `setPresence(presence)`, async `close()`. Host closes room; guest only its connection. Server authenticates invite token after client validates pinned TLS certificate; new ephemeral cert and token each room. Hosts keep no chat log on disk; reject ninth participant, bad input, excess frames/slow clients, invalid routing. All errors handled without process crash. Listen IPv4; no port forwarding done implicitly.

## Media topology

Host creates one PC to each guest. `iceServers:[]`, max-bundle. Each PC has24 transceivers: slots0..7 x voice(audio), screen(video), system(audio), in that order. Host adds all24 before offer: own and other guest slots `sendonly`, destination guest slot `recvonly`. Guest uses inverse directions after setRemoteDescription; do not precreate duplicate transceivers. Tracks attached/replaced without renegotiation. Host forwards raw remote tracks into other guest PC (NOT host WebAudio gain output); never feeds a participant's tracks back to them. Host trusts all guests. TLS control + DTLS-SRTP media are per link; this is not guest-to-guest E2EE.

Host signal first sends offer, guest answers. Trickle ICE buffered until remote description. Public host sends original candidates plus extra configured public IPv4/UDP candidate preserving port/mid/mline/ufrag. Do not mutate SDP. Public candidates are static mapping assumption, not STUN discovery. Renderer exports pure helper for tests.

Each received participant gets independent raw voice and system MediaStreams and local GainNodes. Voice sliders 0–400%, system sliders 0–200%, with peak limiting; mute separate; output device selection, master deafen. Mic mute, input device, input gain, echo cancellation/noise suppression/AGC options. Settings persist locally. Room invitations, session tokens and room and Game LAN conversation logs stay in memory. Confirmed LINK friends' private messages use a separate profile-local store.

## UI IDs

Root and UI agent agree IDs by follow-up message. UI Russian, dark graphite, cool lime accent, original clean typography, no external font/CDN requests, semantic buttons/labels/dialogs. Real initial empty state; no fake active participants/stats. Responsive down to1000x700 desktop.

## Постоянные правила интерфейса CRAFTCODE LINK

- Для каждого входа описывать цель и куда человек попадёт после создания профиля, подтверждения, отказа и отмены. Профиль, друзья, заявки и текущий звонок имеют свои точки входа.
- Использовать короткие глаголы, называть видимый результат. Второй способ подключения и технические подробности раскрываются по запросу. Одинаковые поля и кнопки используют общие отступы, подписи и фокус.
- При изменениях пройти сценарий на двух новых профилях, при входящем событии во время набора и на малой ширине. Снять фактические экраны на узком и широком окне. Проверить переход с клавиатуры, тихий режим и возврат из трея.
- Проверка звонка включает рост RTP и декодированных кадров на получателе. Для границ теста явно записывать PASS, BLOCKED и NOT TESTED. Результаты стенда и Windows проверяются раздельно.

## Правила проекта с 0.7.0

При каждом изменении применяются AGENTS.md и сценарии из QA_REPORT.md. Один подтверждённый контакт LINK используется для игровых и голосовых приглашений и передачи файлов внутри звонка. UI отображает независимо дружбу, членство в каждой комнате и фактическую готовность локального игрового адаптера. Лабораторный UDP-интерфейс и работающий чат не доказывают установку Windows-драйвера или обнаружение матча конкретной игрой.
