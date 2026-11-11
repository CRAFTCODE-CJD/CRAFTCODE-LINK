import {tr} from './locale.mjs';
export function routeProblem(samples, { publicStun, proxyOnly }) {
  const stalled = samples.filter(sample => sample.remoteSdp && !sample.candidateType &&
    sample.state !== 'connected' && sample.routeAge >= 12000 &&
    (sample.gatheringState === 'complete' || sample.routeAge >= 25000));
  const hostOnly = stalled.some(({ localTypes, remoteTypes }) => localTypes.length && remoteTypes.length &&
    [...localTypes, ...remoteTypes].every(type => type === 'host'));
  const offerStun = !proxyOnly && !publicStun && stalled.some(sample => !sample.servers.length);
  return { stalled: stalled.length > 0, hostOnly, offerStun };
}

export function roomReport({ media, selectedPeerId, graphics, environment, session, peers, stats, screenStream, protectedSound, audioLost, micMuted, deafened, micInput, micGain, outputLatency }) {
  const audio = protectedSound?.track?.readyState === 'live';
  const localSlot = peers.find(p => p.id === session?.selfId)?.slot;
  const lines = [
    'CRAFTCODE LINK ' + environment.version + ' · ' + new Date().toISOString(),
    [environment.platform, environment.osRelease, environment.arch, 'Electron', environment.electron].join(' '),
    session ? tr('Мой слот ') + localSlot + (session.role === 'host' ? tr(' (создатель)') : tr(' (гость)')) : tr('Вне комнаты'),
    tr('Микрофон ') + (micMuted ? tr('выключен') : tr('включён')) + tr(' · входящий звук ') + (deafened ? tr('выключен') : tr('включён')),
    tr('Мой экран ') + (screenStream ? tr('включён') : tr('выключен')) + tr(' · системный звук ') +
      (audio ? tr('WASAPI, процессы звонка исключены') : audioLost ? tr('недоступен, только изображение') : tr('выключен')),
  ];
  const timing=protectedSound?.timing;
  if(audio && Number.isFinite(timing?.peakQueueMs)){
    lines.push(tr('Очередь звука перед отправкой, пик за секунду')+' · '+timing.peakQueueMs+tr(' мс'));
    lines.push(tr('Опустошения очереди за трансляцию')+' · '+timing.underruns+' · '+tr('пропущено при переполнении')+' '+timing.droppedMs+tr(' мс'));
  }
  if (micInput) {
    const flag = v => typeof v === 'boolean' ? (v ? tr('включён') : tr('выключен')) : tr('нет данных');
    lines.push(tr('Обработка микрофона') + ' · AEC ' + flag(micInput.echoCancellation) + ' · NS ' + flag(micInput.noiseSuppression) +
      ' · AGC ' + flag(micInput.autoGainControl) + ' · ' + tr('Громкость вашего голоса') + ' ' + micGain + '%');
  }
  const watched=peers.find(p=>p.id===selectedPeerId && p.sharing && p.slot!==localSlot);
  if (watched && Number.isFinite(outputLatency) && outputLatency >= 0) {
    lines.push(tr('Устройство вывода · оценка задержки звука ')+Math.round(outputLatency*1000)+tr(' мс'));
  }
  if(watched && media?.watchBuffer){
    const requested=media.watchBuffer.preferences.get(watched.id)||0;
    const forwarding=media.isHost && peers.length>2;
    lines.push(tr('Буфер просмотра')+' · '+tr('слот ')+watched.slot+' · '+(!forwarding && requested?requested+tr(' мс'):tr('Авто')));
  }
  if(graphics){
    const g=graphics;
    lines.push(tr('Кодирование экрана · ')+(g.applied?tr('GPU при доступности'):'CPU')+tr(' · аппаратный кодировщик Chromium: ')+(g.encode||tr('нет данных')));
  }
  const capture=screenStream?.getVideoTracks()[0]?.getSettings();
  if(capture)lines.push(tr('Настройки захвата ')+(capture.width??'—')+'×'+(capture.height??'—')+' · '+(capture.frameRate??'—')+' FPS');
  const metric=(v,digits=1)=>Number.isFinite(v)?v.toFixed(digits):'—';
  const reasons={cpu:tr('процессор'),bandwidth:tr('сеть'),none:tr('нет'),other:tr('другое')};
  const remotes = peers.filter(p => p.slot !== localSlot);
  const endpoints = session?.role === 'host' ? remotes : remotes.filter(p => p.id === session?.hostId);
  for (const ep of endpoints) {
    const sample = stats.get(ep.id);
    lines.push('', tr('Соединение со слотом ') + ep.slot + ' · ' + (sample?.state ?? tr('ожидание статистики')));
    if (!sample) continue;
    lines.push(tr('Замер ') + sample.sampledAt + ' · ICE ' + sample.iceState + ' / ' + sample.gatheringState +
      tr(' · локальных кандидатов ') + sample.localCandidates + (sample.rttMs === null ? '' : ' · RTT ' + sample.rttMs + tr(' мс')));
    if(sample.localTypes)lines.push(tr('Сервисы ICE: ')+([...new Set(sample.servers)].join(', ') || tr('не выданы'))+tr(' · локальные типы: ')+(sample.localTypes.join(', ')||tr('нет'))+tr(' · удалённые: ')+(sample.remoteTypes.join(', ')||tr('нет')),
      tr('Согласование ')+sample.sdpState+tr(' · удалённое описание ')+(sample.remoteSdp?tr('получено'):tr('ожидается'))+tr(' · канал данных ')+sample.chatState+tr(' · попыток восстановления ')+sample.attempts);
    if(sample.tcpFallback)lines.push(tr('Резервный режим: TURN по TCP/TLS'));
    if(sample.iceErrors?.length)lines.push(tr('Коды ошибок сбора ICE: ')+sample.iceErrors.join(', '));
    lines.push(tr('Маршрут ')+(sample.candidateType==='relay'?'TURN':sample.candidateType?tr('прямой'):'—')+
      tr(' · транспорт ')+(sample.protocol || '—')+(sample.relayProtocol?tr(' · до TURN ')+sample.relayProtocol:'')+
      tr(' · оценка доступной отдачи ')+metric(sample.available>0?sample.available/1e6:null,2)+tr(' Мбит/с'));
    if(sample.adaptiveHeight)lines.push(tr('Защита звука при перегрузке · предел своего показа ')+sample.adaptiveHeight+'p / '+sample.adaptiveFps+' FPS / '+metric(sample.adaptiveRate/1e6,2)+tr(' Мбит/с'));
    for(const a of sample.audio || []){
      const role=Number(a.mid)%3===0?tr('Голос'):tr('Звук экрана');
      lines.push(role+tr(' · слот ')+Math.floor(Number(a.mid)/3)+tr(' · маскирование потерь ')+metric(a.concealedPct)+tr('% · джиттер ')+metric(a.jitterMs)+tr(' мс · буфер ')+metric(a.bufferMs)+tr(' мс'));
    }
    for(const v of sample.video || []){
      const out=v.direction==='out';
      lines.push((out?tr('Отправка'):tr('Приём'))+tr(' видео · слот ')+Math.floor(Number(v.mid)/3)+' · '+(v.codec || '—')+
        ' · '+(v.width || '—')+'×'+(v.height || '—')+' · '+metric(v.fps)+' FPS · '+metric(v.mbps,2)+tr(' Мбит/с'));
      if(out && v.encoder)lines.push(tr('  Кодировщик WebRTC · ')+v.encoder);
      const forwarded=out && Math.floor(Number(v.mid)/3)!==localSlot;
      if(out)lines.push(tr('  Источник ')+metric(v.sourceFps)+tr(' FPS · настройки до адаптации ')+(forwarded?60:sample.fpsLimit)+' FPS / '+metric(forwarded?32:sample.bitrateLimit/1e6)+tr(' Мбит/с · ограничение ')+(reasons[v.reason] || '—'));
      else if(v.recent){
        const w=v.recent;
        lines.push(tr('  За последние ')+metric(w.seconds,0)+tr(' с · потеряно пакетов ')+metric(w.lost,0)+' ('+metric(w.lossPct)+'%)'+
          tr(' · замираний ')+metric(w.freezes,0)+tr(' · время замираний ')+metric(w.freezeSeconds)+tr(' с'));
      }
      if(!out)lines.push(tr('  За весь поток · пропущено кадров ')+metric(v.dropped,0)+tr(' · замираний ')+metric(v.freezes,0));
      if(!out && Number.isFinite(v.bufferMs))lines.push(tr('  Видео в буфере · ')+metric(v.bufferMs,0)+tr(' мс'));
      lines.push('  '+(out?tr('Кодирование'):tr('Декодирование'))+' '+metric(v.workMs)+tr(' мс/кадр'));
      lines.push(tr('  За весь поток · потери пакетов ')+metric(v.lost,0)+tr(' · джиттер ')+metric(v.jitterMs)+tr(' мс'));
    }
    for (const peer of session.role === 'host' ? [ep] : remotes) {
      const row = sample.inbound.find(r => r.slot === peer.slot);
      if (peer.sharing && Number.isFinite(row?.estimatedScreenSkewMs)) {
        lines.push(tr('Оценка WebRTC · звук минус видео · слот ')+peer.slot+' · '+row.estimatedScreenSkewMs+tr(' мс'));
      }
      lines.push(tr('Источник ') + peer.slot + tr(' · голос ') + (row?.voiceBytes ?? 0) + tr(' Б · экран ') + (row?.screenBytes ?? 0) +
        tr(' Б · звук стрима ') + (row?.systemBytes ?? 0) + tr(' Б · кадров декодировано ') + (row?.framesDecoded ?? 0));
    }
  }
  return lines.join('\n');
}
