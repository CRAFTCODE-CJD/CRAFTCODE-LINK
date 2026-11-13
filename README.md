# CRAFTCODE LINK

CRAFTCODE LINK is a free, open-source messenger for Windows. Create a profile on your PC, exchange LINK cards with a friend and confirm the connection. You can then message each other, share files, make video calls or share your screen. Create a group for your friends to meet in text and voice channels. Direct chat history stays on the participants’ devices, and the group runs on its owner’s computer.

For Game LAN, everyone joins the same room and enables the Windows game network. One player hosts in the game and the others refresh its LAN list. See the [tested games and connection troubleshooting (in Russian)](docs/LAN_COMPATIBILITY_RU.md).

In a wide window, opening a group keeps your friends and direct messages on the left and places the group’s channels beside them. In Settings, preview your personal theme and chat wallpaper. Each local profile remembers its own choices. The animated wallpaper respects reduced motion in LINK and Windows.

Download the Windows x64 installer or portable ZIP from [Releases](https://github.com/CRAFTCODE-CJD/CRAFTCODE-LINK/releases/latest). Each release includes its source archive and SHA-256 checksums. The application code uses the MIT license. Bundled dependencies have their own [licenses and notices](THIRD_PARTY_NOTICES.md).

Read the [Russian guide](README_RU.md), [contribution guide](CONTRIBUTING.md) and [security model](SECURITY.md). Android and synchronization across your devices are described in the [development plan](docs/MULTI_DEVICE_RU.md).

On first use, Home offers a theme and a shortcut to edit the local profile. Owners and administrators can choose a group picture and theme. Opening a group or its voice channel applies that theme. Home and private chats restore the personal theme.

The optional **Show first steps** card introduces friends, messages and calls. Choose Later to dismiss it for this profile. Open **? → Help** at any time to search the guide or watch four short examples with subtitles: direct messages, calls, Game LAN and group navigation. The videos are included in the application and play on request.

In **Settings → Storage**, choose a drive or folder for your profile and chat history, or change the folder for new downloads. Profile data moves after an explicit restart; existing downloads stay where they are. The move may take some time and LINK opens when it finishes. You can inspect used/free space and clear cache without removing your history or attachments. Uninstalling clears temporary cache in both modes; deleting the profile requires the checkbox, and user-saved downloads remain.

Fresh Windows installations store data in a dedicated **CRAFTCODE LINK Data** folder beside the application, with only small location and process-control records in the Windows profile. Updating an existing installation keeps its previous data location. If you use the portable ZIP, extract it to a writable folder before launching LINK.

In Windows **Settings → Apps → Installed apps**, open **CRAFTCODE LINK → Uninstall** and choose **Repair application**. This restores the installed version’s program files and keeps your profile and chats. If the original installer has moved, select another copy of the same version. The wizard checks its SHA-256 before opening it.

After uninstalling while keeping the profile, you can reinstall into the same folder. The installer accepts its verified preserved data folder and installs program files beside it without moving the profile. Other occupied folders remain protected.

Drag a file into a private chat, media room chat, Game LAN chat or group text channel. Paste a screenshot with Ctrl+V. Review the image and caption, then choose Send. For multiple files, the caption goes on the first one. Group members offer files to the owner for publication. The Game LAN chat and its attachments work while the game adapter is off.

Open a private conversation's menu and choose **Conversation security** to compare its identity code with your friend through an independent channel. The dialog shows the current encrypted transport and the devices known at your last comparison. Details of the different chat transports and local storage are described in [SECURITY.md](SECURITY.md).

Play a saved video note and click or drag its outer ring to seek. Voice messages also support seeking and playback speed. Right-click a message or focus it and press Shift+F10 for available actions. Search the emoji picker by English or Russian name. A YouTube card can load details on request and open the video in a separate LINK window.

When you watch a screen share with sound in Auto mode, LINK uses the viewer’s audio output latency to align the picture. The room’s technical report shows the output device’s latency estimate when available. Switching audio devices updates the estimate.

The profile button in a private conversation shows when you added the contact and which groups you share. Select a group there to open it. Sound settings let you preview the notification sounds, enable messages and calls separately, and set their volume.

Use Settings → Accessibility to choose a chat font size from 12 to 24 px, compact messages or reduced motion. In My profile, choose a cover and fill in About me. Preview the card and save it to share with confirmed friends on supported versions of LINK.

Choose a group in the left rail, then open a text channel or click a voice channel to join. Connected participants appear below the voice channel. The member list in a text channel groups people by role. Home opens friends and private messages during a call.

LINK profile settings let you set this device's availability and control new friend requests, calls and invitations separately. Compatible contacts can see Away and Busy. Invisible pauses discovery and direct delivery. Outgoing messages stay queued until you return. People in an existing call or match can still see the participants. Older versions may also show those participants online for the duration of the shared session. Other devices on the same profile use their own status.

## Host a group on your PC

Sign into your LINK profile and open **Groups → Create group**. The creator’s running LINK device serves the group. Members can read shared history, post messages, download files and join voice channels while the host is reachable. Invite a confirmed LINK friend and have them accept on their PC.

Owners appoint administrators. Both roles manage channels and invitations. Administrators can moderate ordinary members. A restricted channel can admit administrators and individually selected members. Participants join voice channels explicitly and choose their own microphone and screen. The group supports 32 members and 24 channels. Text history persists on the host, up to 500 messages per channel and 2 MiB across channels. Clearing a channel removes its shared history. Private conversations retain separate local histories. Ordinary room and Game LAN chats last for the session.

When a member offers a file, the owner accepts it onto the server. Recipients choose whether to download it. The host retains up to 64 files, up to 32 MiB each and 256 MiB in total. Copies saved separately to Downloads remain with their recipients.

To move the server, appoint the recipient as an administrator and choose **Transfer group ownership** in their member actions. Select the destination device. The recipient must have confirmed friendships with the remaining members and accept the handoff. Group changes pause while LINK copies the history and verifies the files. After activation the recipient hosts the group, and the previous owner becomes an administrator. After an interruption, reopen the original profiles on both devices.

The help screen includes a voluntary way to buy the author a coffee. [Support the author on Boosty](https://boosty.to/channel-jonathan-developer/donate)

Use the speaker button on a participant's tile to mute their voice on your PC. Right-click the tile or open its sound menu for separate voice and stream levels. LINK remembers the mix for a verified friend on this profile across calls and hosts. Guests joining by code or IP have per-room settings.

After an unexpected guest shutdown, open the same profile on the same device and choose **Return to room**. The host must still have that room open and allow the return. The host can revoke return access under room management.

Microphone memory is on by default. In your first call, turn on the microphone when you want to speak. LINK remembers both manual unmute and mute for subsequent calls. Your voice and stream volume for each confirmed friend are saved separately. You can turn microphone memory off in voice settings.

For a video call, choose **Camera**, select a device and open the preview. Choose **Turn video on** when ready. The microphone has its own control. In a two-person call, your friend fills the main stage and your video appears in a small movable window. Drag it within the stage or move it with the arrow keys. Click it to swap the videos. Its position is saved on this device. Each participant chooses either a camera or screen sharing.

Open another friend's private conversation during a call to message them while room audio continues. Decline an incoming personal call to stay, or confirm a switch to the caller's room. When a guest switches, the existing host stays with the other participants. A host who switches confirms that their current room will close.

You can send pictures, files, voice notes and round video messages while your friend is offline. The message arrives when both apps reconnect. The recipient can choose **Download** while the sender’s device is online. The phone button starts a call. When the friend accepts, both enter the same media room. A ring around each avatar responds to speech. Use **Private chat** to return to the conversation during the call.

Direct chats, media rooms and Game LAN accept files from disk up to 64 GiB. For files over 256 MiB in direct chats and Game LAN, update LINK on both devices. You can offer a large file to an offline friend in a direct chat. Keep the original file unchanged at the same location until your friend downloads it. LINK checks its contents before sending and after saving. Files up to 256 MiB queued while disconnected have a separate 512 MiB allowance for encrypted copies. Clearing a conversation releases its copies. Select the checkbox in the confirmation dialog to remove downloaded files too.

Voice messages can run for up to 10 minutes and video notes for up to 60 seconds, with an 8 MiB limit each. Inline previews and clipboard attachments support files up to 8 MiB. The profile holds up to 128 MiB of outgoing recordings and clipboard attachments.

Profile settings include a photo, interface themes and chat backgrounds. A Windows notification can open the relevant conversation from the tray. Web links show a local preview with the destination domain. A reader can request the video title from YouTube or a repository description from GitHub. Strict mode keeps previews local.

Only confirmed LINK friends with photo support receive your profile photo. In a LINK room, friends see photos for verified LINK participants. Guests joining by code, IP or Jabber appear to others with initials. Interface themes and chat backgrounds stay on this device.

The Windows x64 app checks the stable releases of CRAFTCODE-CJD/CRAFTCODE-LINK daily in normal mode. When a new version is available, choose Open updates above the Help icon. Help also contains an Open updates button at all times. The manager lets you turn daily checks off, check now, download or install. In a Game LAN, Leave and install asks for confirmation. If you host the room, it closes for everyone. Active calls and transfers show instructions before installation. A current client checks the public latest-release link with one request. For a new version, LINK shows download progress and speed. An interrupted download keeps its progress and resumes automatically, including after an app restart. Resume now retries immediately. Cancel download removes the partial file. LINK verifies the complete installer against the SHA-256 published with the release.

Click a confirmed LINK friend’s name to open **Chats**. Pending messages and attachments stay in the local encrypted queue until both apps are online. A clock indicates a queued message. One check means the recipient’s device has saved the message. Two checks mean the message was visible in the conversation on a recipient device and that device confirmed it. Both apps must support read receipts. Each PC keeps its own private conversation history. In the conversation menu, **Clear chat history** removes that conversation locally. **Chat storage → Clear all private chats** clears all conversations for the active profile on this PC.

Select **Also delete files downloaded in this chat** to free space in Downloads. You can leave the box unchecked and clear the downloaded copies later. LINK verifies each copy before deleting it. If you cleared the history in 0.7.11 or earlier, you can find its remaining files manually under Downloads → CRAFTCODE LINK.

Room and Game LAN chats last for the current session. Open a participant’s card for voice, stream volume and mute. The chat button in the room header opens the conversation beside the call. Each attachment has a separate line for its filename and actions. The viewing buffer adjusts the picture to follow the stream audio when changing shows or buffer settings.

Withdrawing an attachment clears its queued blocks while other downloads continue. When fresh values are available for both tracks, the room's technical report shows WebRTC's estimated audio-minus-video offset for the active broadcast.

After a brief disconnection, Game LAN members receive the current roster and adapter status. Game LAN attachment downloads can be cancelled and restarted while the source remains admitted to the current network. In a media room, compatible peers exchange their file lists on reconnection and cancel an unfinished download if its source withdrew the attachment.

File downloads can resume after a brief connection interruption in the same room. If the sender stops responding for a minute, you can start the download again. You can withdraw a pending game LAN join request. Hiding the app stops an in-progress message recording. A finished draft remains available until you dismiss it or leave the room.

Under **Game LAN**, mutual online friends can see published networks, request access and rejoin a network they voluntarily left. The organizer can turn off new requests. Each player enables their adapter separately. Use **Test game connection** on both PCs to distinguish virtual UDP connectivity from the game’s session service.

In room chat, use **＋** for files, photos, voice and video messages. Review or discard recordings before sharing. Download attachments directly from their message, play supported media inline, and use **Show in folder** for saved files. The sender stays online during downloads. The emoji picker inserts into the current draft.

Choose the game's LAN or direct IPv4 mode. LINK forwards supported LAN discovery and game packets between admitted players. Recognized Epic FLAN v11/v12 responses (Null and Steam LAN layouts) and RakNet/Bedrock pongs can identify the server's UDP port automatically. The response must match the querying player and request nonce. Any learned access belongs to that pair in the current session. LINK also forwards UDP on the built-in ports 7000, 7777–7779, 8086–8087, 14001, 16000 and 27000–27050. For other protocols or TCP listeners, the connection panel offers additional game ports, for example `TCP 25565`. Those explicit rules must be enabled on the players' and organizer's PCs and expire when leaving the LAN. Games using a platform lobby follow the game's sign-in and matchmaking requirements. [Steamworks](https://partner.steamgames.com/doc/api/ISteamNetworkingSockets) · [Epic Online Services](https://dev.epicgames.com/docs/epic-online-services/multiplayer/nat-p2p-interface/p2p-guide/p2p-intro).

Games with a direct IPv4 transport can also use port ranges, for example `UDP 7777-7876`, with up to eight rules and 128 ports. **Fill in the EOS port range** fills the field with the EOS SDK defaults. **Apply** enables those ports for the current LAN. LINK checks membership and port permissions on each packet. EOS cloud lobbies use the game’s own sign-in. EIK 4.x also requires authentication for its LAN session creation and search. [Epic port settings](https://dev.epicgames.com/docs/api-ref/structs/eos-p-2-p-set-port-range-options) · [EIK LAN sessions](https://eikv4.betide.studio/multiplayer/lan).

If Windows retains the previous LINK adapter, the connection panel can offer an explicit restore after verifying its identity. Background notifications for calls, requests and invitations can be toggled in settings.

In fullscreen, move the pointer to the bottom edge to see the received resolution and decoded FPS. The presenter sees local capture settings. Room files negotiate binary transfers between the host and a participant on 0.7.2. Names and avatars appear on the left while participants speak in fullscreen. To update an offline PC, transfer the official .linkupdate file and choose Open updates → Open update package. LINK verifies the publisher signature before asking to install. Download and install are separate actions. Versions 0.7.0 and 0.7.1 require one manual installer run.

## Game LAN and room files

Exchange a LINK card once and accept the friend request. Use the same contact for calls, game invitations and sharing files in a call. Game LAN has its own membership and chat. Players enable the optional Windows game adapter with a separate UAC prompt. Every activation requests the same Windows adapter identity. You can cancel activation or leave the LAN while approval is pending. Game LAN chat is available with the adapter off. One participant hosts in the game. Others use its LAN browser or connect to the game host's virtual IP. Switching or leaving a voice call preserves the match. The network organizer leaving ends the game LAN.

If both friends appear offline after an update, check the active profile on both PCs. For LINK cards across different networks, check internet discovery under Settings → My profile. The Friends view shows whether discovery is disabled, connecting, retrying, or has received a response. Retry connection uses the routes you already permitted. Jabber contacts require the corresponding Jabber account.

In voice rooms the host can choose who may request entry. Commentator mode reserves screen sharing for the host and allows the host to grant or revoke speaking rights. Guests activate their own microphones. Room files stay available while their source is present. Downloads use SHA-256 verification and exclusive publication under Downloads/CRAFTCODE LINK/<host name>/. Files are never executed or redistributed automatically.

## Friends’ rooms and player controls · 0.6.4

Mutual LINK contacts can see a host’s open room, request entry, and continue their current call until the other host approves and they confirm the move. Leaving as host closes the room. Manual IP rooms remain invitation-only. Favorites are available in the wide sidebar even when offline. Move the pointer to the bottom edge of the video to reveal the player controls, or pin them. Windows capture border settings are available on supported builds. LINK peers can report their version; a newer peer version is informational and cannot install software.

Windows x64 desktop calls, chat and screen sharing for friends. Use a local LINK profile and share a contact card. A friend accepts a request once, then you can call one another from the contact list. The interface supports English and Russian. Select a language on the welcome screen or in Settings → My profile.

## First call

1. Open **Create a LINK profile** on both computers. Choose a name. Leave internet discovery enabled if calling from separate networks.
2. Open **Friends**, copy your card, and send it privately. Your friend chooses **Add friend**, pastes it and sends a request.
3. Accept from the notification or open **Requests** in the left sidebar. Once your friend appears online, start a call and choose a screen or window to share. The receiver's actual resolution and frame rate appear above the video.

On the same LAN, you can choose **Local network or Radmin VPN** under **Other connection methods** at first launch. Enter your name and select the same network on both computers. Internet discovery stays off for new profiles created this way.

Internet discovery uses the public HyperDHT network. Direct media depends on the peers' network paths. LAN, manual IP and Jabber options are available under the alternative connection methods. Relay-only calls require a reachable compatible TURN service. No service is installed on Windows. Closing the window keeps LINK in the system tray. Right-click its icon to quit.

Go to **Friends** or **Requests** during a call and choose **Return to call** to reopen the room. **Cinema mode** hides the sidebars while keeping the call controls available. Press Esc or **Show sidebars** to restore them.

## Viewing buffer

When watching a friend, use the **Viewing buffer** below the video. Auto is the default. Try 0.5 s or 1 s if a film stutters. The 2 s option adds more headroom. Your choice applies to the selected screen and its shared audio during this call. Voice continues at its usual latency. Give the player a few seconds to adjust. The host temporarily uses Auto when forwarding a guest’s screen to a third person. This feature uses the native in-memory WebRTC jitter buffer.

## Connection diagnostics

After a network path change, the sender tests higher limits gradually. Open **? → Connection and diagnostics** on the viewer and look for the received video. Recent packet loss and completed freezes cover up to the last minute of reception. Each stream also shows its current resolution, FPS and lifetime counters.

## Development and verification

From SOURCE, use Node.js 22.12+ and run `npm ci`, `npm run check` and `npm test`. Desktop integration tests use Playwright and Electron. See QA_REPORT.md for measurements and platform limitations, SECURITY.md for the trust model, and WORK_HANDOFF_RU.md for the build procedure. The Windows installer and its maintenance wizard use Russian.

## Voice levels

Start at 100%. In **Settings → Voice and devices**, check the microphone with a four-second phrase. During a call the test uses the active voice processing and pauses your outgoing voice for the recording and playback. Voice gain ranges from 0 to 400% and shared audio from 0 to 200%. Your own card changes what friends receive. A friend's card changes what you hear. Loud voice peaks are limited. Echo cancellation, noise suppression and automatic gain are enabled for new profiles. Existing choices are retained. If a friend hears their own voice through your speakers, check echo cancellation and try headphones.
