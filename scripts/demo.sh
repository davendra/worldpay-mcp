#!/usr/bin/env bash
# Reproducible demo: start the stdio server with dummy credentials, list its
# tools over MCP, and classify each by its MCP annotation. No Worldpay call is made.
set -euo pipefail
export WORLDPAY_USERNAME=demo WORLDPAY_PASSWORD=demo \
       WORLDPAY_URL=https://try.access.worldpay.com MERCHANT_ENTITY=demo
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"demo","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
| timeout 15 node dist/server-stdio.js 2>/dev/null \
| node -e '
let buf="";
process.stdin.on("data",d=>buf+=d);
process.stdin.on("end",()=>{
  let info, tools;
  for (const line of buf.split("\n")) {
    if(!line.trim()) continue;
    let m; try{m=JSON.parse(line)}catch{continue}
    if(m.id===1) info=m.result?.serverInfo;
    if(m.id===2) tools=m.result?.tools;
  }
  if(!tools){console.error("no tools");process.exit(1)}
  console.log("");
  console.log("  \x1b[1m"+(info?info.name+" MCP  v"+info.version:"Worldpay MCP")+"\x1b[0m  ·  "+tools.length+" tools");
  console.log("  "+"─".repeat(56));
  for(const t of tools){
    const a=t.annotations||{};
    let tag="\x1b[33m● creates\x1b[0m";
    if(a.readOnlyHint) tag="\x1b[32m● read-only\x1b[0m";
    else if(a.destructiveHint) tag="\x1b[31m● moves money\x1b[0m";
    console.log("  "+t.name.padEnd(42)+tag);
  }
  console.log("");
});
'
