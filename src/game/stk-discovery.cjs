'use strict';

const {isUtf8}=require('node:buffer');
const {allowedPort}=require('./ports.cjs');

// SuperTuxKart 1.3–1.5 use LAN protocol version 6. The BareNetworkString
// constructor prepends the byte length even to the fixed query string.
// https://github.com/supertuxkart/stk-code/blob/1.5/src/network/stk_host.cpp
const port=2757;
const query=Buffer.from('\x0astk-server','ascii');


function stkDiscoveryMessage(data,h){
  if(h.proto!=='UDP')return;
  if(h.dport===port&&h.dst===255&&allowedPort(h.sport)&&data.equals(query)){
    return {type:'query',key:'stk6/'+h.sport,discoveryPort:true};
  }
  // There is no wire nonce. Even a valid response is only useful as a
  // unicast reply to an observed query at the same seat and UDP port.
  if(h.sport!==port||h.dst===255||!allowedPort(h.dport)||data.length<15||data.length>524||data.readUInt32BE(0)!==6)return;
  const nameEnd=5+data[4];
  if(nameEnd===5||nameEnd+9>data.length)return;
  const name=data.subarray(5,nameEnd);
  const track=data.subarray(nameEnd+9);
  if(track.length!==data[nameEnd+8]||!isUtf8(name)||!isUtf8(track))return;
  const maxPlayers=data[nameEnd],players=data[nameEnd+1],gamePort=data.readUInt16BE(nameEnd+2);
  if(!maxPlayers||players>maxPlayers||!allowedPort(gamePort)||data[nameEnd+4]>3||
     data[nameEnd+5]>8||data[nameEnd+6]>1||data[nameEnd+7]>1)return;
  return {type:'answer',key:'stk6/'+h.dport,discoveryPort:true,session:{port:gamePort}};
}

module.exports={stkDiscoveryMessage};
