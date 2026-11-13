# Безопасность CRAFTCODE LINK

## Защита переписки и сверка личности в 0.7.14

Личные сообщения LINK, их подтверждения и байты вложений идут между устройствами собеседников по аутентифицированному зашифрованному соединению. Интернет-транспорт HyperDHT использует Noise IK и библиотеку Secretstream из поставляемых зависимостей. По локальной сети устанавливается TLS с минимальной версией 1.3. Клиент сверяет SHA-256 сертификата из подписанного ответа обнаружения. Обе стороны проверяют сертификат устройства Ed25519 и подпись приветствия, привязанную к TLS exporter или хешу конкретного Noise handshake. После этого основной процесс проверяет подтверждённую дружбу, блокировку и допустимое устройство. Посредник обнаружения и ретранслятор зашифрованных байтов могут наблюдать адреса, размеры и время обмена. Содержимое доступно конечным устройствам собеседников. Транспорт соответствует назначению HyperDHT, описанному разработчиками библиотеки. [HyperDHT](https://github.com/holepunchto/hyperdht), [Secretstream](https://github.com/holepunchto/hyperswarm-secret-stream).

В меню личного диалога доступна сверка публичных идентичностей. Код версии 1 вычисляется SHA-256 от префикса версии и двух отсортированных публичных корневых ключей. У обоих участников он одинаковый. Пользователь сверяет полный код лично или по уже доверенному каналу и явно ставит локальную отметку. Само отображение кода оставляет статус несверенным. Отметка содержит время и известный на тот момент список сертифицированных устройств. Новое устройство отмечается отдельно. Смена имени сохраняет код. Изменение корневого ключа меняет код. Удаление или блокировка контакта удаляет отметку. На перенесённой установке сверка выполняется заново. IPC проверяет текущий профиль, друга, полный код и тип команды. Входящий сетевой пакет выполнить это действие не может.

Подтверждение сверки также содержит список устройств из показанного пользователю отчёта. Основной процесс сверяет его с текущим набором перед сохранением отметки. Если за время просмотра добавилось устройство, прежнее подтверждение отклоняется и требуется обновлённый отчёт.

Показатель защиты соединения вычисляется из фактического TLS socket или Noise stream и его привязки к проверенному приветствию. При отсутствии видимого действующего соединения интерфейс показывает офлайн. Состояние скрытого контакта учитывает настройку присутствия. Старые клиенты продолжают использовать согласованный защищённый транспорт, а локальная сверка доступна в обновлённом интерфейсе.

История личных сообщений, подписи, записи и сохранённые снимки исходящих файлов в офлайн-очереди защищены AES-256-GCM. Дополнительные аутентифицированные данные связывают запись с диалогом, направлением, сообщением или частью вложения. Ключ базы случайный, его оболочку защищает хранилище ОС. Исходящий снимок файла фиксируется до публикации предложения. При возобновлении связи получатель сначала получает предложение и самостоятельно начинает загрузку. В Windows защиту оболочки предоставляет DPAPI. Приложения, работающие с правами той же учётной записи Windows, могут получить доступ к её данным и ключам. Сохранённые получателем обычные файлы доступны приложениям с соответствующими правами доступа. [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).

У группы авторитетным сервером является устройство владельца, хранящее историю и зашифрованный локальный архив вложений. Этот участник имеет доступ к расшифрованному содержимому, включая обслуживаемые ограниченные каналы. В медиакомнате хост завершает TLS и DTLS-SRTP соединения и пересылает сообщения и медиа. В игровой LAN организатор завершает защищённые соединения участников и пересылает игровые пакеты и файлы. Администратор-получатель и любой другой получатель могут сохранить полученное содержимое. Модель группового шифрования должна учитывать эти права участников.

Дополнительный путь через Jabber использует доверие к выбранному поставщику учётных записей. Он управляет идентичностью и сигнализацией, включая обмен эфемерными ключами резервного чата. Активная подмена этого обмена самим поставщиком входит в его границу доверия. Сверка корневых ключей личных диалогов LINK относится к контактам CCF1.

### Изученные схемы и последующие этапы

Signal применяет обновление ключей сообщений Double Ratchet, а Sesame описывает управление асинхронными сеансами нескольких устройств, повторами доставки и изменениями списка устройств. Для будущей очереди на внешнем сервере потребуется библиотечная реализация такого управления ключами с атомарным сохранением состояния до подтверждения доставки. Текущий LINK хранит офлайн-очередь у отправителя и отправляет её по новому защищённому соединению после появления получателя. Восстановление после компрометации и удаление отдельных ключей сообщений Double Ratchet относятся к следующему этапу разработки. [Double Ratchet](https://signal.org/docs/specifications/doubleratchet/), [Sesame](https://signal.org/docs/specifications/sesame/).

MLS стандартизует групповое согласование ключей с эпохами, включением и исключением участников, forward secrecy и post-compromise security. Следующая реализация групповой E2EE требует проверенной библиотеки, отдельной версии протокола, удостоверений каждого устройства, подписанных изменений состава, восстановления после пропущенных эпох и атомарного хранения. Политика доступа к архиву и передачи владельца должна определять, какие ключи получает каждый участник. Старый клиент должен явно показывать недоступность защищённого режима. Автоматическое ослабление выбранного режима недопустимо. [RFC 9420](https://www.rfc-editor.org/rfc/rfc9420).

Matrix разделяет парные сеансы Olm и групповые Megolm, проверяет ключи устройств и индексы сообщений для защиты от повторов, обновляет сеансы при изменении состава. Этот опыт применим к проектированию отзыва устройства, выдачи ключей архивов и нескольких установок LINK. Сейчас сертифицированные устройства одной корневой личности получают права этой личности. Отдельный подписанный отзыв устройства и восстановление после утечки корневого ключа остаются этапом разработки. [Matrix E2EE](https://matrix.org/docs/matrix-concepts/end-to-end-encryption/).

Telegram отдельно описывает серверное шифрование облачных чатов и сквозное шифрование Secret Chats между двумя участниками. При выборе поведения интерфейса LINK указывает фактическую границу шифрования для каждого типа общения. [Telegram Secret Chats](https://core.telegram.org/api/end-to-end), [Telegram FAQ](https://telegram.org/faq#q-how-secure-is-telegram).

Проверены симметрия отпечатка, смена идентичности, чужой профиль, неподтверждённая дружба, поддельная команда, повторная сверка, перезапуск и появление нового устройства. Тест с посредником, разрывающим TLS на два соединения, отклоняет оба пересланных подписанных приветствия до допуска. Тест с установленной библиотекой Noise IK передаёт исходный текст только конечному получателю и проверяет отсутствие этого текста в скопированных байтах ретранслятора. История и вложения дополнительно проходят сценарии перезапуска, очистки, квот, модификации файлов и совместимости старой версии.

## Проверенные сценарии 0.7.13

Участник группы может предлагать файлы в пределах своей квоты. Входящие приглашения имеют отдельный лимит. Операции с группой привязаны к живому соединению и зарегистрированному устройству подтверждённого друга. При принятии приглашения в игровую LAN проверяется конкретное предложение. Диагностика использует порт, фактически открытый участником.

При выключении локального поиска LINK отзывает и незавершённую попытку подключения интерфейса. До выдачи подписанной карточки проверяется текущая политика приватности. Подробности повторных проверок и условия стенда приведены в QA_REPORT.md.

При получении вложения LINK проверяет содержимое на диске и идентичность файла при публикации. На NTFS сохраняется метка происхождения Windows. После сохранения приложение, имеющее право записи в каталог пользователя, по-прежнему может изменить его файлы.

## Hosted group boundaries

Each group pins a LINK identity, a certified device and an ownership epoch. The authoritative device validates friendship and group membership before granting channel access. Restricted channels require the appropriate role or a per-person grant. The owner assigns administrators. Moderation requires a higher rank than the target. Group signalling separately verifies the channel, epoch, member and recipient. A participant joins a voice channel explicitly and controls their own microphone and screen.

The Windows keystore protects group metadata and message contents in the local SQLite database. A joining device retains the server address and its permitted channel listing. It obtains shared text history from the authorized host on demand. The host stores accepted attachments in a private encrypted vault. The receiver explicitly saves a separate copy. Clearing history, withdrawing a file or deleting a group releases the affected hosted copies. Files saved separately remain under the recipient’s control.

Transfer requires a confirmed administrator, a chosen destination device and verified friendships with the remaining members. The source freezes changes. The destination verifies the complete snapshot and attachment digests, then durably stores its prepared copy. The source records its retirement before issuing a signed, epoch-bound activation grant. Only the designated device can use that grant. Delivery can resume after interruption or restart. If the necessary device is permanently lost during transfer, recovery may require restoring its intact profile. The contact card and local profile export omit the hosted group archive.

Windows x64 checks the stable release of the configured CRAFTCODE-CJD/CRAFTCODE-LINK repository over HTTPS. The main process checks the version, destination, exact asset name, size and SHA-256 from GitHub. Download and installation are separate user actions. The installer is rechecked during staging. Installation requires local confirmation. An active Game LAN can be left with explicit consent. LINK checks the room identity again and waits for its adapter to stop before starting the installer. Calls and file transfers must finish first. On clients from 0.7.21 onward the offline .linkupdate package authenticates its version, size and installer SHA-256 with the built-in publisher public key (RSA-PSS). The issuer keeps the private key outside the repository. The local installation dialog accepts only the signed package. Windows Authenticode signing is separate and the installer currently has no Authenticode signature.

Chat link cards are constructed from the message locally. In normal mode a reader can request a title from fixed GitHub or YouTube endpoints. For YouTube, LINK can also fetch a JPEG thumbnail of up to 128 KiB from the provider's image server using a validated video ID. Opening a link hands its HTTP or HTTPS address to the user's browser. Choosing playback inside LINK opens the YouTube embed in a separate sandboxed window and in-memory session with its own network allowlist. The player has no LINK preload, file access, download or device permissions. Enabling strict mode closes this player and cancels outstanding preview requests. Private message notifications omit message contents and recheck the active account, friendship and unread state before opening a conversation.


## Игровая сеть и файлы 0.7.1

Вход по LINK требует принятой дружбы, действительного приглашения и проверки устройства. Участники не получают права обращаться к адресам физической LAN. Обрабатываются датаграммы игровой подсети с проверкой отправителя, размера и портов. Хост пересылает трафик матча и видит его содержимое. Он должен быть доверенным участником. В групповых медиакомнатах хост также участвует в пересылке файлов и медиа. Для сетевого компонента Windows требуется отдельное подтверждение UAC. Монолит Electron остаётся в пользовательском контексте. Установщик и собственный сетевой помощник в данной сборке без подписи издателя. Драйвер поставляется в оригинальном виде. SHA-256 DLL закреплён в исходнике помощника. LINK не добавляет правило брандмауэра, DNS-сервер или маршрут по умолчанию.

С версии 0.7.1 помощник запрашивает у Wintun постоянный GUID. Одновременное создание ограничено именованным объектом Windows. При занятом имени или совпадении подсети помощник прекращает включение. Адрес назначается только на срок жизни адаптера. При обрыве связи с приложением помощник завершает сессию и закрывает собственный дескриптор адаптера. LINK оставляет системную историю и общий пакет драйвера под управлением Windows. Физическая проверка UAC, аварийного завершения и удаления описана в WINDOWS_TEST_RU.md.

Для отправки пользователь сам выбирает файл. Получатель явно запускает скачивание. Размер, позиция блока, итоговый SHA-256, путь назначения и отсутствие перезаписи проверяются в основном процессе. Контрольная сумма удостоверяет переданные байты. Ответственность за решение запустить присланный билд остаётся у получателя. Автоматической установки обновлений от контактов нет.

This is a small private-room prototype, not a security-audited public conferencing service. Do not expose it as an unrestricted public service or use it for highly sensitive communications without a separate review.

## Contacts and admission

Direct requests and blocked person IDs are stored in the OS-protected profile. Blocking also covers other devices signed by that identity. A Jabber block is scoped to the signed-in account on this installation. Room entry grants require user approval and bind to the authenticated party, device and room. A viewer can advertise a preference only for its own source. The host validates content, bitrate and FPS and keeps its per-recipient network and viewing limits.

## Encoder preference

The main process accepts only a Boolean encoder preference from the existing trusted frame. It stores this preference locally in graphics.json. CPU mode sets a fixed Chromium switch before readiness. This setting supplies no caller-defined process flags and leaves driver blocklists in force. Restart requests are rejected while a room is active. Studio measurements remain local, taken from the existing WebRTC stats collector.

## Local identity and network discovery

Each profile has an Ed25519 root. Each installation creates an independently certified device key. The application verifies the device certificate and a signature bound to the current TLS exporter or Noise handshake, including the display name. Local appearance, IP and XMPP nickname do not confer friendship. User confirmation and a non-expired call ticket bind the invited person, answering device and current room. The room control tunnel can reach only the active local room listener. Its network frames and socket counts are bounded.

On Windows, Electron safeStorage uses the current user's OS credential protection. The private seeds remain in the main process. A separately encrypted, user-selected .cclprofile export contains the root and a contacts snapshot. Random 16-byte salt, scrypt N=65536/r=8/p=1, fresh 96-bit IV and AES-256-GCM protect the export. Imports reject damaged files and create fresh device keys. Possession of the export and its password authorizes a new installation. This release has no per-device revocation, live backup sync or protection against malware running as the same OS user. Delete exported files separately if no longer needed. A public CCF1 card cannot sign in as the person.

Local discovery requires selecting an IPv4 interface. It sends short multicast/broadcast queries (UDP 45864), validates a fresh nonce, a certificate fingerprint and a device signature, and accepts candidate replies only from that subnet. Other app users on the selected subnet can discover the advertised name, device and profile identity. HyperDHT is optional. Public bootstrap/rendezvous and DHT lookup participants can observe network addresses and correlation metadata. Signed device handshakes authenticate devices returned by discovery. DHT facilitates signaling and does not make every WebRTC media path reachable. Direct internet calls may use the configured STUN and a TURN explicitly supplied for the session. Strict mode stops direct discovery and direct contact calls. The executable opens no router mapping and installs no VPN or firewall rule. An explicit IP room invitation is a bearer credential and conveying it grants access to that room.

Release verification includes npm audit against the registry, authenticated profile import, device substitution and replay rejection, expired/cross-device ticket rejection, and mixed-room admission. See QA_REPORT.md for scope and limitations. Production still requires real Windows hardware, field reliability tests and independent security review. Windows distributions are unsigned.

## Manual invitations: trust and transport

- The room creator runs the TLS signaling/chat server and forwards room media. Manual room signaling and media are independent of public identity, STUN and TURN services. Update checks follow the application-wide preference and network policy.
- Creating a room generates a fresh RSA-2048/SHA-256 certificate and 256-bit random room secret. The invitation contains the endpoint, pinned certificate SHA-256 fingerprint and secret. A guest checks the exact certificate pin before sending any application authentication data. Trust comes from exchanging the invitation with the correct friend, not from a public certificate authority.
- The narrowly scoped TLS client uses explicit certificate pinning for its self-signed room certificate. It does not disable certificate validation globally. Invitation secrecy is required; the invitation is not an encrypted container.
- TLS protects room control and text. WebRTC DTLS-SRTP protects each media link between a guest and the host. Browser forwarding terminates those links on the trusted host. **Group media is not guest-to-guest E2EE against the host.**
- Public-IP/UDP mapping is explicit configuration. No claim is made that CGNAT or all firewalls can be traversed without a relay. IPv4-only explicit invitation endpoints in this version.
- DNS resolution of a user-entered hostname uses the computer's configured DNS resolver. With an IP literal, no application public-IP discovery service is contacted.

## Implemented controls

- Maximum 8 participants and 16 simultaneous incoming TCP connections; room admission requires the secret.
- Fresh opaque guest IDs assigned by the server; host-stamped chat/signal identities; only host↔guest signaling routes.
- Bounded frame length, UTF-8 JSON validation, signal depth/size checks, per-connection/rate/byte limits, handshake/idle timeouts and bounded write queues.
- Electron renderer uses context isolation, sandboxing, no Node integration and a narrow preload bridge. IPC requires the application's own main frame. Remote navigation/new windows/webviews and renderer remote resource requests are denied.
- Capture follows a one-use, short-lived, explicit source selection. Video messages and live-camera previews use separate native confirmations bound to the current room and pending request. Each grant is consumed on the media request. A live-camera grant permits video capture only. The first call starts with the microphone off, and later calls follow the user's local microphone-memory preference. Camera and screen sharing require an explicit action in each call.
- Remote participant/chat text is inserted as text, not HTML. No remote arbitrary code or shell commands are accepted.
- Playback gains apply only to local audio graphs. They do not modify the raw remote tracks forwarded to other guests. Async attachment/replacement cleanup is covered by regression tests.
- Room shutdown, renderer failure and application quit tear down room networking. Capture is stopped on leave. A source replacement failure fails closed.

## Limitations and responsibilities

- An invitation holder can join without an additional approval prompt. No per-guest kick/block, account identity, permanent contact verification or invitation revocation within a live room. Close the room and recreate it to revoke a leaked invitation.
- The host sees participants' network addresses, text and media. A hostile host could record them. Other participants may record what they see/hear. The application cannot prevent recording outside itself.
- Capturing a desktop can reveal notifications, private windows and other applications' system audio. A window selection does not isolate that application's audio.
- The display-media request grants video only. Its audio tracks, if present, are discarded. The local Windows companion uses WASAPI EXCLUDE_TARGET_PROCESS_TREE with its actual parent PID. It accepts no device, PID or path from the renderer. PCM is consumed through bounded, session-scoped IPC. Closing capture or losing the protected source stops the audio companion. Unsupported systems continue with video only. Microphone and remote voices use separate graphs.
- Direct LINK friends keep separate local copies of their private conversations. LINK encrypts message contents with AES-256-GCM before writing to SQLite and protects the local database key with Electron safeStorage. The local conversation and storage menus clear this device’s history and pending sends. A delivery receipt confirms storage by a friend’s device. Room and Game LAN chat and invitations stay in memory. Files explicitly downloaded by a participant remain at their local destination. The OS controls paging, crash dumps and clipboard history.
- Dependencies include Electron/Chromium, Node.js, WebRTC, selfsigned and node-forge. Release checks use the configured GitHub repository. The current Windows package has no CRAFTCODE code-signing certificate.
- TLS and renderer tests passed locally, but real Windows capture, WAN media connectivity and media load at 4–8 participants remain unverified. Do not treat unit tests as a penetration test or complete security audit.

## Safe network setup

Forward only the documented TCP port and UDP range to the correct host. Keep Windows Firewall enabled. Do not use DMZ, broad inbound wildcard rules, or send router/provider credentials to anyone. Create rooms only when needed; closing the host removes the listening application but does not automatically remove router rules.

When reporting a bug, omit invitations, tokens, full SDP, personal messages, router passwords and unnecessary IP addresses. Include application/Windows versions, whether TCP chat works, whether media works, and relevant sanitized error text.


## Local diagnostics in 0.1.1

The room report uses an allowlist of OS/version fields, slot numbers, ICE states and measured RTP/decoder counters. It is copied to the OS clipboard only on request. The report never serializes a raw WebRTC stats object. It excludes names, endpoint addresses, invitation data, device identifiers, chat and SDP.

TEST-RTP.cmd selects a separate entry path with local QA windows, synthetic sources, an isolated profile and in-process signaling. It writes a measurements-only JSON file in the reports directory of the application profile. It does not start a room server or connect to a friend. Its media permissions and fake devices apply only to that process. The normal room still starts with microphone and sharing off.

## Online contacts (0.4.2)
User-selected XMPP provider over an exact WSS endpoint, local vendored Strophe.js and WebRTC with temporary ICE service discovery. The authenticated provider is trusted for account identity and signaling, including media fingerprints. Only mutually subscribed accounts can ring; calls bind a full device JID, room nonce and invitation token. XMPP call stanzas request no storage. An open WebRTC DataChannel is preferred for text. During ICE setup or media failure the application can send encrypted text over the same authenticated XMPP service. The host decrypts and forwards room messages. The backup negotiates fresh P-256 ECDH keys in memory per participant per room, uses AES-GCM with random 96-bit nonces and binds room, recipient and sender slot IDs as additional data. The account provider authenticates the key exchange. This design has no independently verified fingerprints and does not protect against an actively malicious signaling provider. On Windows, opt-in remembered credentials use Electron safeStorage. No telemetry, VPN driver, automatic firewall changes or paid relay. Strict mode requires TURN and fails closed if credentials are unavailable. It cannot replace OS-level VPN enforcement. The Windows publisher signature and independent public-service testing remain outstanding.

On Windows, hiding the window keeps the existing session and active captures alive. Exiting from the tray terminates the process. The optional stored login is unchecked on a fresh profile. Provider account management opens only fixed published web addresses after a user action. Repair operates on the packaged file catalog in the registered per-user directory and leaves the separate local profile intact.

A LINK1 room code identifies the specific host account, device resource and random active room. Only mutually approved contacts can redeem it. Pasting it does not connect automatically. Guest acceptance binds both the host invitation token and the outstanding user-initiated request. Closing the room invalidates the code. A CL1 manual invitation is a separate bearer secret.

Display names are labels. Verify the full login before approving a contact. A customized display name and the account it belongs to are stored locally, and the current name is announced in account presence. An exported TXT card contains only the public login and instructions. It is kept outside the profile and can be deleted separately. Purging the profile cannot reset or erase the remote account.

Installer maintenance requests a non-forced shutdown through Windows Restart Manager for roots identified by exact installed image path, session and process creation time. The installer waits for that installation to exit before replacing files.

Active calls may repeat ICE negotiation when interfaces change. An interface snapshot stays in main-process memory. Only a change notification is sent to the renderer. The strict relay policy is retained when refreshing provider-provided servers. The manual guest retries only its original in-memory invitation and checks the pinned certificate before authentication on each connection. Leaving cancels retries. The video report includes only allowlisted metrics and protocol/type labels.

The microphone preview records four seconds from the processed local input. The application keeps the clip in a temporary blob, revokes its URL on stop and never persists or uploads it. During this test the outgoing call microphone is gated independently of the mute setting. Standalone RTP diagnostics retain the newest five files matching the application report naming convention.

On the Create Account screen the client checks Jabber.ru by default. Other services require an explicit choice. Failed probes do not block the user from opening the provider’s registration form. It opens the registered WSS endpoint up to SASL discovery and makes bounded credential-free HTTPS requests in an in-memory session to the registration page and CAPTCHA resources. Jabber Club hosts its own CAPTCHA. The Jabber.ru path also contacts www.google.com for the reCAPTCHA loader. These endpoints see the source network address. No user ID or password is sent during the checks. The client never executes downloaded scripts and follows no redirects in these probes. Completing the CAPTCHA, confirming the account and signing in are separate steps. Existing accounts remain bound to their own service.

Once the room DataChannel is established, mutually approved participants can exchange room heartbeats and room state over the authenticated WebRTC link. ICE repairs requiring a fresh route can still require the account service. Closing the room releases the connections.

Jabber Club also publishes an HTTPS BOSH endpoint on the same host. If its WebSocket is unavailable, the registration probe can verify the BOSH service before authentication, then terminate its anonymous session. During sign-in, transport failures rotate between the two fixed endpoints of that provider. A wrong password ends the attempt. The renderer allows only BOSH POST/OPTIONS for that exact HTTPS URL. No other provider is sent the account password.

Signing out or switching clears the saved credentials for this installation. The client can request account cancellation on the authenticated connection for the displayed JID (XEP-0077). The action requires a separate confirmation and never retries automatically. Other providers use their fixed HTTPS account-deletion page. A timeout or interrupted connection gives an unknown result. Only a positive server response clears the local display name for a directly deleted account. Other local settings and exported address cards are independent.

Only mutually subscribed accounts receive directed call availability (an opaque door ID and occupancy). The host address and room code are sent only during an introduction. An unfamiliar host must approve mutual contact before the guest can join. A guest cannot unilaterally admit a stranger.

Normal Internet mode permits candidates on the default network route including private addresses. Participants and the signaling provider may learn these addresses. Strict relay mode keeps the media relay-only; if there is no usable TURN the encrypted room chat can still work. If the provider returns no STUN server, new profiles in normal Internet mode use stun.cloudflare.com:3478 to discover the external address. This exposes the network address to Cloudflare. Existing saved preferences, including false, are preserved on upgrade. Strict mode filters STUN. No public media relay credentials ship in the client. A user-supplied TURN is optional, held in memory, and cleared on logout/exit. Its address, user, secret, encrypted chat payloads and keys are omitted from the diagnostic report.

Account calls use OS-assigned local UDP ports. Manual IP rooms retain their fixed range. A route change first probes an established account data channel. A recovery attempt can select TCP/TLS URLs from the already authorized TURN services. Strict mode continues to require a relay. A receiver can report recent playout pressure for its own connection. Reports expire and carry no audio or screen content. The Windows diagnostics button reveals only the running packaged executable in Explorer. CRAFTCODE LINK does not edit VPN exclusions, routing tables, firewall rules or router configuration. An optional per-app VPN exclusion exposes the normal network path to this app, including its account signaling.


## Локальный профиль LINK и режим присутствия

Выход из LINK приостанавливает прямые соединения и обнаружение на этом устройстве. Возврат использует прежние ключи и контакты. Блокировка применяется к личности, включая другие её устройства. Личные сообщения, имена контактов и ключи не отправляются для перевода интерфейса. Словарь входит в приложение. Файл переноса содержит секреты профиля и требует пароль. Карточка друга и файл переноса выполняют разные задачи.

An in-call microphone check temporarily gates the outgoing voice track and taps the same processed source locally. It releases the tap, player and in-memory recording URL on completion or cancellation. The diagnostic report includes applied processing flags and manual gain. Acoustic echo through physical speakers and loudness set by the OS or an amplifier depend on the user's equipment.

## Game LAN

Additional UDP and TCP listening ports require local configuration for the active game room. Each participating endpoint and the host independently enforce their port list, current membership and the virtual IPv4 subnet. TCP requires a unicast SYN to an explicitly allowed listener and tracks the forward and return socket pair. Removing a port revokes existing flow entries and queued frames. Privileged ports, common Windows management services and LINK diagnostic ports are reserved. The permission applies to the chosen port on the game adapter, including any application listening there. Backup diagnostic ports are shared in authenticated rosters and accept only the fixed-size challenge or its reply. Windows configures a 1500-byte MTU on the LINK interface for the active session.

The native helper holds the product guard before inspecting a fixed PnP instance. Explicit recovery rechecks that exact instance and the Wintun device name immediately before targeted removal. An active owner, a different identity, ambiguous metadata or an unknown legacy device are never targets of removal. The command uses the Windows system directory and a fixed instance ID. The installer waits for this installation's companion before changing files.

The built-in game port policy includes the UDP 14001 discovery port under the same room membership, source seat, direction and response-flow checks as other game packets. Counters are kept in memory for the active adapter. The game launcher accepts the executable only from the local OS file picker, confirms its path, rechecks the room, and launches without shell or elevation with one locally derived argument. Game invitations cannot launch files or enable the adapter.

## Room messages and game discovery in 0.7.4

The source chooses a file in the OS picker. The main process maps an opaque room-scoped token to the selected file or a verified download before revealing it in Explorer. A contact cannot supply a local path. Audio and video message drafts are memory-only, limited to 600 seconds for voice and 60 seconds for round video, and 8 MiB each, with a 24 MiB limit for shared clips at the source. Receiving a notification or offer does not start a download, grant device access or play media. Raster and WebM previews check the recorded size, SHA-256 and file signature before creating a local blob URL. Leaving tears down the recorder, preview and file capabilities.

Game advertisements and admission requests travel over authenticated friend links. Only the hosting device can approve entry. First admission and voluntary return are scoped to the current network and device. Removing the contact clears return access. A diagnostic UDP socket is bound to the local virtual IPv4 address while the adapter is active. It accepts a fixed challenge format from current participants and replies only to their assigned addresses. Running the check does not change system routes, firewall settings or the game installation.

## Download and message recording lifecycle in 0.7.5

Windows records a generated download token, a fingerprint of the Downloads location and the validated room directory in the local profile before creating a partial file. Startup recovery only considers files associated with that profile in that location. It skips directory links and unregistered files. The final verified name is committed without overwriting a previous copy. Older partial files cannot be safely attributed and are left alone.

A video message gets a single-use camera approval bound to its pending request and room. Cancelling the recording or hiding the window invalidates pending approval. Incoming LAN withdrawals must match the requesting device, active room and outstanding ticket.

## Discovery routing hints and room introductions

With internet discovery enabled, the Windows client can keep up to six public IPv4 routing endpoints that answered its own HyperDHT announcement, limited to one per /24. These are routing nodes. The encrypted local profile holds their addresses for reuse for up to seven days. Disabling internet discovery clears the hints. Profile exports exclude them.

An ordinary LINK media room can introduce guests through the authenticated host. A guest signs its shareable contact card together with its current room scope and temporary participant ID. Other guests can use the verified card to send a friendship request while the participant is present. Turning off friend requests or going invisible withdraws the introduction. Previously shared cards may already have been copied. Friendship acceptance and per-action permissions still apply.
