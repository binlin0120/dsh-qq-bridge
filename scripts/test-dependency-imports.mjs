import {fileURLToPath} from 'node:url';import test from 'node:test';import assert from 'node:assert/strict';import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
test('SnowLuma SDK imports and MCP docs mode handshakes without OneBot',async()=>{
 const sdk=await import('@snowluma/sdk');assert.equal(typeof sdk.SnowLumaWebSocketClient,'function');
 const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../node_modules/@snowluma/mcp/dist/server.js',import.meta.url))],env:{PATH:process.env.PATH||'',SYSTEMROOT:process.env.SYSTEMROOT||'',SNOWLUMA_MCP_MODE:'docs'},stderr:'pipe'});
 const client=new Client({name:'offline-compatibility',version:'1.0.0'});try{await client.connect(transport);const {tools}=await client.listTools();assert.ok(tools.length>0);assert.ok(!tools.some(t=>/execute_action/.test(t.name)));}finally{await client.close();}
});
