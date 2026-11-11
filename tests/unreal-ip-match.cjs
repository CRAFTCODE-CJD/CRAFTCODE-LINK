'use strict';

const { spawn } = require('node:child_process');
const { createWriteStream } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const assert = require('node:assert/strict');
const { connectGame } = require('./game-loopback-relay.cjs');

async function ipProject(dir) {
  const project = path.join(dir, 'LinkProbe.uproject');
  await fs.mkdir(path.join(dir, 'Config'), { recursive: true });
  await fs.writeFile(project, JSON.stringify({
    FileVersion: 3, DisableEnginePluginsByDefault: true,
    Plugins: ['OnlineSubsystemNull', 'OnlineSubsystemUtils'].map(Name => ({ Name, Enabled: true }))
  }));
  await fs.writeFile(path.join(dir, 'Config', 'DefaultEngine.ini'), [
    '[OnlineSubsystem]', 'DefaultPlatformService=Null',
    '[/Script/EngineSettings.GameMapsSettings]', 'GameDefaultMap=/Engine/Maps/Entry',
    'ServerDefaultMap=/Engine/Maps/Entry', 'GlobalDefaultGameMode=/Script/Engine.GameModeBase',
    '[/Script/Engine.GameEngine]', '!NetDriverDefinitions=ClearArray',
    '+NetDriverDefinitions=(DefName="GameNetDriver",DriverClassName="/Script/OnlineSubsystemUtils.IpNetDriver",DriverClassNameFallback="/Script/OnlineSubsystemUtils.IpNetDriver")', ''
  ].join('\n'));
  return project;
}

module.exports = async function unrealIpMatch(options) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'link-ue-'));
  const peers = [];
  const relay = await connectGame(options, await options.port());
  const capture = process.env.LINK_QA_UNREAL_LOG_DIR || folder;
  const eikProject = process.env.LINK_QA_EIK_PROBE_PROJECT;
  const game = process.env.LINK_QA_EIK_GAME;
  const eik = Boolean(eikProject || game);
  const stamp = 'LINK' + randomBytes(4).toString('hex');
  const property = new RegExp('PlayerState[^\\r\\n]*PlayerNamePrivate\\s*=\\s*"?'+stamp);
  await fs.mkdir(capture, { recursive: true });

  async function start(role, url, commands) {
    const dir = path.join(folder, role);
    await fs.mkdir(path.join(dir, 'User'), { recursive: true });
    const project = game ? [] : [eikProject || await ipProject(dir)];
    const log = path.resolve(capture, role + '.log');
    const args = [...project, url, role === 'server' ? '-server' : '-game',
      '-nullrhi', '-unattended', '-nosound', '-nosplash', '-NoLiveCoding', '-NoAnalytics',
      '-nomcp', '-NoSteam', '-NoCrashDialog', '-DDC-ForceMemoryCache', '-NoShaderCompile',
      '-MULTIHOME=' + relay.address, '-abslog=' + log, '-UserDir=' + path.join(dir, 'User'),
      '-stdout', '-FullStdOutLogOutput', '-LogCmds=LogRepTraffic Log,LogPlayerController Verbose'];
    if (eik) {
      args.push('-Multiprocess', '-SaveToUserDir');
      if (game && role === 'server') {
        // Give the remote game a chance to receive its reply before the host quits.
        args.push('-ExecCmds=t.MaxFPS 30,csvprofile frames=1500', '-csvExecCmds=1200:quit');
      } else {
        args.push('-ExecCmds=t.MaxFPS 30');
        if (game) args.push('-testexit=EIK_PROBE client verified=');
      }
    } else {
      // Starting CSV before the RHI has initialized crashes UE 5.6 on Windows.
      args.push('-ExecCmds=t.MaxFPS 30,csvprofile frames=7200', '-csvExecCmds=' + commands.join(','));
    }
    if (role === 'server') args.push('-port=' + relay.gamePort);
    const program = game || process.env.LINK_QA_UNREAL_EDITOR;
    const child = spawn(program, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, cwd: path.dirname(program) });
    const endpoint = { child, role, tail: '' };
    peers.push(endpoint);
    const output = createWriteStream(path.resolve(capture, role + '-stdout.log'));
    child.on('error', e => { endpoint.error = e; });
    output.on('error', e => { endpoint.error = e; });
    endpoint.closed = new Promise(resolve => child.once('close', code => { endpoint.exit = code; output.end(resolve); }));
    for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => {
      output.write(bytes);
      const text = endpoint.tail + bytes.toString();
      endpoint.tail = text.slice(-6000);
      if (/LogNet: [^\r\n]*NetDriver[^\r\n]*listening on port/i.test(text)) endpoint.ready = true;
      if (/Join succeeded:/.test(text)) endpoint.joined = true;
      if (/Received RPC: ServerChangeName/.test(text)) endpoint.rpc = true;
      if (property.test(text)) endpoint.verified = true;
      if (eik) {
        if (/EIK_PROBE plugin=1 sockets=1/.test(text)) endpoint.plugin = true;
        const proof = /EIK_PROBE (?:server challenge|client verified)=([a-f0-9]{32}) driver=(\w+)/i.exec(text);
        if (proof) { endpoint.nonce = proof[1]; endpoint.driver = proof[2]; }
      }
    });
    return endpoint;
  }
  async function wait(predicate, label) {
    const end = Date.now() + 180000;
    while (!predicate()) {
      for (const peer of peers) {
        if (peer.error) throw peer.error;
        if (peer.exit !== undefined) throw Error(peer.role + ' exited ' + peer.exit + ' ' + peer.tail.slice(-1000));
      }
      if (Date.now() > end) throw Error(label + ' timed out; ' + JSON.stringify(relay.counts) + '; logs: ' + capture);
      await delay(100);
    }
  }
  try {
    const query = 'GetAll PlayerState PlayerNamePrivate';
    const map = '/Engine/Maps/Entry?listen' + (eik ? '?bIsLanMatch?game=/Script/EIKProbe.EikProbeMode' : '');
    const server = await start('server', map, Array.from({ length: 65 }, (_, i) => ((i + 1) * 90) + ':' + query));
    await wait(() => server.ready, 'Unreal game listener');
    const client = await start('client', relay.address + ':' + relay.clientPort + '?Name=LINKGuest',
      [90, 210, 390, 720, 1200, 2200].flatMap(n => [n + ':SetName ' + stamp, (n + 45) + ':' + query]));
    if (eik) {
      await wait(() => server.joined && server.nonce && client.nonce, 'EIK probe gameplay RPC and receipt');
      assert.equal(client.nonce, server.nonce);
      assert(server.plugin && client.plugin, 'Both game processes must report loading EIK and its sockets module');
      console.log('PASS EIK-enabled Unreal processes: join, server challenge and matching client receipt', server.nonce,
        'drivers:', server.driver, client.driver, relay.counts);
      if (game) {
        const deadline = Date.now() + 65000;
        while (peers.some(peer => peer.exit === undefined) && Date.now() < deadline) await delay(100);
        assert.equal(client.exit, 0, 'Packaged client exit');
        assert.equal(server.exit, 0, 'Packaged host exit');
        console.log('PASS packaged Win64 game target, engine-requested host exit', server.exit, 'client exit', client.exit);
      }
    } else {
      await wait(() => server.joined && server.rpc && server.verified && client.verified, 'Server RPC and replicated PlayerState');
      console.log('PASS two independent Unreal processes, UDP IpNetDriver join, SetName RPC, matching replicated PlayerState on server and client:', stamp, relay.counts);
    }
    assert(relay.counts.toServer > 5 && relay.counts.toClient > 5);
  } finally {
    relay.close();
    for (const { child } of peers) if (child.exitCode === null) child.kill();
    await Promise.all(peers.map(peer => peer.closed));
    if (path.dirname(folder) !== os.tmpdir() || !path.basename(folder).startsWith('link-ue-')) throw Error('Unexpected test directory');
    await fs.rm(folder, { recursive: true, force: true });
  }
};
