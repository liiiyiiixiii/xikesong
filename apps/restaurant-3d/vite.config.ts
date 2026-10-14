import config from './public/data/config.json';
import { defineConfig, type ProxyOptions } from 'vite';
function sameOriginProxy(target:string):ProxyOptions {
 return {target,changeOrigin:true,configure(proxy){proxy.on('proxyReq',(req,incoming)=>{
  const origin=incoming.headers.origin;if(!origin)return;
  // Only translate a same-origin browser request through this local proxy.
  try{if(new URL(origin).host===incoming.headers.host)req.setHeader('origin',new URL(target).origin);}catch{/* Invalid origins remain unauthorised. */}
 });}};
}
const proxy={
 '/api/demo':sameOriginProxy(process.env.DEMO_API_TARGET??'http://127.0.0.1:5173'),
 '/api/restaurant':process.env.DEMO_API_TARGET??'http://127.0.0.1:5173',
 '/admin':process.env.DEMO_API_TARGET??'http://127.0.0.1:5173',
 '/kitchen':process.env.DEMO_API_TARGET??'http://127.0.0.1:5173',
 '/_next':process.env.DEMO_API_TARGET??'http://127.0.0.1:5173',
 '/_vinext':process.env.DEMO_API_TARGET??'http://127.0.0.1:5173',
 '/api/v2':sameOriginProxy(process.env.OPERATIONS_API_TARGET??'http://127.0.0.1:5173'),
};
export default defineConfig({
  define: { 'import.meta.env.OPERATIONS_WORKBENCH_URL': JSON.stringify(process.env.OPERATIONS_API_TARGET?new URL('/operations',process.env.OPERATIONS_API_TARGET).href:null) },
  plugins: [{name:'local-panel-links',
    configureServer(server) { configureLinks(server); },
    configurePreviewServer(server) { configureLinks(server); },
  }],
  base: "./",
  server: { proxy },
  preview: { proxy },
  build: { rollupOptions: { input: {main:"index.html",menu:"menu.html",plateDetail:"plate-detail.html"}, output: { manualChunks: { three: ["three"] } } } },
});

function configureLinks(server: {middlewares: {use: (handler: (req: {url?:string}, res: {setHeader: (name:string,value:string)=>void;end:(body:string)=>void}, next:()=>void)=>void)=>void}}) {
 server.middlewares.use((req,res,next)=>{
  if(req.url?.split('?')[0]!=='/data/config.json')return next();
  const target=process.env.DEMO_API_TARGET??'http://127.0.0.1:5173';
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({...config,kitchenPanelUrl:new URL('/kitchen',target).href,managementUrl:new URL('/admin',target).href}));
 });
}
