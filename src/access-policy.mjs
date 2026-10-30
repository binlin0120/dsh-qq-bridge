// One authorization policy shared by inbound, wake and delivery paths.
export function assertAccessConfig(file){
 if(file.allowAllWhenEmpty!==undefined&&file.allowAllWhenEmpty!==false)throw Error('allowAllWhenEmpty 已停用：请显式配置允许名单，不支持空名单全开放');
 const valid=id=>(typeof id==='number'&&Number.isSafeInteger(id)&&id>0)||(typeof id==='string'&&/^\d+$/.test(id.trim())&&Number.isSafeInteger(Number(id))&&Number(id)>0);
 for(const root of ['allow','deny'])if(file[root]!==undefined){if(!file[root]||typeof file[root]!=='object'||Array.isArray(file[root]))throw Error(root+' 必须是名单对象');for(const field of ['private','privates','group','groups'])if(file[root][field]!==undefined&&(!Array.isArray(file[root][field])||file[root][field].some(x=>!valid(x))))throw Error(root+'.'+field+' 必须是有效ID数组');}
 if(file.admins!==undefined&&(!Array.isArray(file.admins)||file.admins.some(x=>!valid(x))))throw Error('admins 必须是有效ID数组');return true;
}
const ids=(cfg,root,kind)=>{const value=cfg[root]?.[kind]??cfg[root]?.[kind+'s']??[];return Array.isArray(value)?value.map(String):[];};
export function denied(kind,id,cfg){return ids(cfg,'deny',kind).includes(String(id));}
export function allowed(kind,id,cfg){if(!['private','group'].includes(kind)||denied(kind,id,cfg))return false;return ids(cfg,'allow',kind).includes(String(id));}
export function isAdminQQ(id,cfg){return !denied('private',id,cfg)&&Array.isArray(cfg.admins)&&cfg.admins.map(String).includes(String(id));}
export function rosterRoleOf(kind,id,cfg){if(denied(kind,id,cfg))return null;if(kind==='private'){if(String(id)===String(cfg.ownerQQ??''))return 'owner';if(isAdminQQ(id,cfg))return 'admin';return allowed(kind,id,cfg)?'user':null;}return allowed('group',id,cfg)?'group':null;}
