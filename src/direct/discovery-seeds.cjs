'use strict';
const {BlockList,isIPv4}=require('node:net');

// Only remember internet routing nodes that answered our own announcement.
// Never replay a cached address against a private network after moving this PC.
const reserved=new BlockList();
for(const [network,bits] of [
  ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],
  ['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],
  ['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],
  ['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]
])reserved.addSubnet(network,bits);

const refreshAfter=6*60*60*1000;
const expiresAfter=7*24*60*60*1000;
function routingSeeds(replies){
  const nodes=[],networks=new Set();
  if(!Array.isArray(replies))return nodes;
  for(const reply of replies.slice(0,32)){
    const {host,port}=reply||{};
    if(!isIPv4(host)||reserved.check(host)||!Number.isInteger(port)||port<1024||port>65535)continue;
    const network=host.slice(0,host.lastIndexOf('.'));
    if(networks.has(network))continue;
    networks.add(network);nodes.push({host,port});
    if(nodes.length===6)break;
  }
  return nodes;
}
function readSeeds(record,now=Date.now()){
  if(!Number.isSafeInteger(record?.time)||record.time>now||now-record.time>=expiresAfter)return;
  const nodes=routingSeeds(record.nodes);
  if(nodes.length)return {time:record.time,nodes};
}
module.exports={routingSeeds,readSeeds,refreshAfter};
