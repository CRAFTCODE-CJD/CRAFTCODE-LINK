extends Node
var peer := ENetMultiplayerPeer.new()
var server := false
var ticks := 0
var values := {}
var reported := false

func _ready() -> void:
    var args = OS.get_cmdline_user_args()
    server = args[0] == "host"
    var ret: Error
    peer.set_bind_ip("127.0.0.1")
    if server:
        ret = peer.create_server(int(args[1]), 16)
    else:
        ret = peer.create_client("127.0.0.1", int(args[1]), 0, 0, 0, int(args[2]))
    if ret != OK:
        print("ERR net ", ret)
        get_tree().quit(1)
        return
    multiplayer.multiplayer_peer = peer
    if server:
        print("HOST_READY")

func _physics_process(_dt: float) -> void:
    if server or reported or peer.get_connection_status() != MultiplayerPeer.CONNECTION_CONNECTED:
        return
    if ticks < 30:
        ticks += 1
        submit.rpc_id(1, ticks)

@rpc("any_peer", "call_remote", "reliable")
func submit(seq: int) -> void:
    if not server:
        return
    var who := multiplayer.get_remote_sender_id()
    if seq != int(values.get(who, 0)) + 1:
        print("ERR sequence")
        get_tree().quit(1)
        return
    values[who] = seq
    if values.size() == 16 and values.values().min() == 30:
        print("ALL_PLAYERS ", values)
        snapshot.rpc(values)

@rpc("authority", "call_remote", "reliable")
func snapshot(scores: Dictionary) -> void:
    if scores.size() == 16 and scores.has(multiplayer.get_unique_id()) and scores.values().min() == 30:
        if not reported:
            reported = true
            print("MATCH_OK ", multiplayer.get_unique_id(), " ", scores)
