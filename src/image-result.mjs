const MAX=20*1024*1024;
export async function readImageJson(response){
 const limit=32*1024*1024;if(Number(response.headers?.get('content-length'))>limit)throw Error('图片结果JSON超过32MB');
 if(!response.body)return response.json();
 let size=0;const chunks=[];for await(const b of response.body){size+=b.length;if(size>limit)throw Error('图片结果JSON超过32MB');chunks.push(b);}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function imageResult(response,{validate}={}){
 const candidates=[response?.result,...(Array.isArray(response?.result)?response.result:[]),...(Array.isArray(response?.data)?response.data:[]),...(Array.isArray(response?.outputs)?response.outputs:[])];
 for(const c of [...candidates])if(c&&typeof c==='object'&&Array.isArray(c.data))candidates.push(...c.data);
 let url='';
 for(const c of candidates){
  const raw=typeof c==='object'&&c?c.b64_json:typeof c==='string'&&c.startsWith('data:image/')?c:undefined;
  if(raw!==undefined){
   if(typeof raw!=='string')throw Error('图片Base64结果不是字符串');
   const b64=raw.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
   if(!b64||b64.length>4*Math.ceil(MAX/3)||b64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(b64))throw Error('图片Base64格式无效或超过20MB');
   const buffer=Buffer.from(b64,'base64');if(buffer.toString('base64')!==b64||buffer.length>MAX)throw Error('图片Base64编码无效');
   validate?.(buffer);return {buffer,format:'b64_json'};
  }
  const candidate=typeof c==='string'?c:c?.url;
  if(typeof candidate==='string'&&/^https:\/\//.test(candidate)&&!url)url=candidate;
 }
 return url?{url,format:'url'}:null;
}
