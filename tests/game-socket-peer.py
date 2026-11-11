"""One endpoint of the optional Linux kernel-socket check in game-match.cjs."""
import base64
import fcntl
import hashlib
import json
import os
import selectors
import socket
import struct
import subprocess
import sys
import threading

if len(sys.argv) == 4:
    original = str(os.stat('/proc/self/ns/net').st_ino)
    os.execvp('unshare', ['unshare', '-Urn', sys.executable, '-I', __file__, *sys.argv[1:], original])
local, remote, role, original = sys.argv[1:]
# Refuse to configure anything outside a newly created network namespace.
assert str(os.stat('/proc/self/ns/net').st_ino) != original
assert socket.if_nameindex() == [(1, 'lo')]
fd = os.open('/dev/net/tun', os.O_RDWR)
fcntl.ioctl(fd, 0x400454ca, struct.pack('16sH', b'link-qa', 0x1001))
subprocess.run(['ip', 'addr', 'add', local + '/24', 'dev', 'link-qa'], check=True)
subprocess.run(['ip', 'link', 'set', 'dev', 'link-qa', 'mtu', '1500', 'up'], check=True)

write_lock = threading.Lock()
def report(**fields):
    with write_lock:
        print(json.dumps(fields), flush=True)

payload = hashlib.shake_256(b'CRAFTCODE LINK kernel TCP and UDP').digest(65536)
discovery = b'find my test game'
response = b'join this test host'

def read_exact(sock, size):
    result = bytearray()
    while len(result) < size:
        data = sock.recv(size - len(result))
        if not data:
            raise EOFError('Incomplete game data')
        result.extend(data)
    return bytes(result)

def play():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as udp, socket.socket() as tcp:
            udp.settimeout(15)
            tcp.settimeout(15)
            if role == 'host':
                udp.bind(('', 19132))
                tcp.bind((local, 25565))
                tcp.listen(1)
                report(ready=True)
                data, source = udp.recvfrom(200)
                assert source[0] == remote and data == discovery
                guest_port = source[1]
                udp.sendto(response, source)
                client, source = tcp.accept()
                with client:
                    client.settimeout(15)
                    assert source[0] == remote
                    received = read_exact(client, len(payload))
                    assert received == payload
                    client.sendall(received[::-1])
            else:
                udp.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
                udp.bind((local, 0))
                udp.sendto(discovery, (local.rsplit('.', 1)[0] + '.255', 19132))
                data, source = udp.recvfrom(200)
                assert source == (remote, 19132) and data == response
                tcp.bind((local, 0))
                tcp.connect((remote, 25565))
                tcp.sendall(payload)
                received = read_exact(tcp, len(payload))
                assert received == payload[::-1]
            checked = []
            for port in [7777, 7831, 7876]:
                # Use the discovery socket to signal when each listener is bound.
                check = payload[port:port + 256]
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as game:
                    game.settimeout(10)
                    if role == 'host':
                        game.bind((local, port))
                        udp.sendto(b'ready', (remote, guest_port))
                        packet, address = game.recvfrom(512)
                        assert packet == check and address[0] == remote
                        game.sendto(packet[::-1], address)
                    else:
                        assert udp.recvfrom(16) == (b'ready', (remote, 19132))
                        game.bind((local, 0))
                        game.sendto(check, (remote, port))
                        assert game.recvfrom(512) == (check[::-1], (remote, port))
                checked.append(port)
            report(verified=hashlib.sha256(received).hexdigest(), size=len(received), udpPorts=checked)
    except Exception as error:
        report(error=repr(error))

selector = selectors.DefaultSelector()
selector.register(fd, selectors.EVENT_READ)
selector.register(sys.stdin.fileno(), selectors.EVENT_READ)
threading.Thread(target=play, daemon=True).start()
incoming = bytearray()
while True:
    for key, _ in selector.select():
        if key.fd == fd:
            report(frame=base64.b64encode(os.read(fd, 65535)).decode('ascii'))
        else:
            part = os.read(key.fd, 32768)
            if not part:
                sys.exit(0)
            incoming.extend(part)
            while b'\n' in incoming:
                line, _, rest = incoming.partition(b'\n')
                incoming = bytearray(rest)
                os.write(fd, base64.b64decode(line, validate=True))
