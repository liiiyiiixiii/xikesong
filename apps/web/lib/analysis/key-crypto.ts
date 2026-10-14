const encoder=new TextEncoder();
const aad=encoder.encode("red-koala:intelligence:v1");
async function encryptionKey(secret:string){if(secret.length<32)throw new Error("本地加密配置未就绪，请重启服务后重试");const digest=await crypto.subtle.digest("SHA-256",encoder.encode(secret));return crypto.subtle.importKey("raw",digest,{name:"AES-GCM"},false,["encrypt","decrypt"]);}
const encode=(v:Uint8Array)=>btoa(String.fromCharCode(...v));
const decode=(v:string)=>Uint8Array.from(atob(v),c=>c.charCodeAt(0));
export async function encryptModelKey(value:string,secret:string){const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:aad},await encryptionKey(secret),encoder.encode(value));return JSON.stringify({v:1,iv:encode(iv),data:encode(new Uint8Array(encrypted))});}
export async function decryptModelKey(value:string,secret:string){try{const item=JSON.parse(value);if(item.v!==1)throw new Error("version");const bytes=await crypto.subtle.decrypt({name:"AES-GCM",iv:decode(item.iv),additionalData:aad},await encryptionKey(secret),decode(item.data));return new TextDecoder().decode(bytes);}catch{throw new Error("保存的密钥无法解密，请重新填写并连接");}}
