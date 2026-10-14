import { diningPlacement, chairFootprint, polygonDistance } from './dining';
/** Geometry authority. Ratios are confirmed; all metre dimensions are demo parameters. */
export type Point = { x: number; z: number; y?: number };
export type Sample = Point & { sM: number };
export type Track = { trackId: string; enabled: boolean; direction: 1 | -1; speedMps: number; lengthM: number; svgPath: string; path: Point[]; arcLengthLut: Sample[] };
export type Window = { windowId: string; trackId: string; centerSM: number; halfWidthM: number; staffPosition?: Point; position: Point };
export type Seat = { seatId: string; trackId: string; zoneId: string; position: Point; angle: number; grill: Point; usable: boolean; takeWindow: Window; approachPath: Point[] };
export type Wall = { wallId: string; from: Point; to: Point; thicknessM: number };
// Legacy kitchen: 42 plates on a 2×8.7m straight + R1.58m capsule, ~0.65065m pitch.
export const legacyPlatePitchM = (2 * 8.7 + 2 * Math.PI * 1.58) / 42;
export const defaults = { leftGapPercent: 65, sauceLengthPercent: 180, metresPerDrawingUnit: .02, plateDiameterM: .32, plateGapM: legacyPlatePitchM - .32, seatPitchM: 1.12, seatOffsetM: 1.10, grillOffsetM: .46, chairRadiusM: .27, counterWidthM: 1.24, walkingRadiusM: .25, speedMps: .32, backupFrontShiftM:.80, mainRightExtensionM:.80, mainReturnExtensionM:.50 };
/** The marked seating areas, rather than a global capacity target, define the revision. */
export const seatingZones = [
  {zoneId:'main-upper-inside',trackId:'track-main',label:'主供餐口下方内侧两席',minimumSeats:2},
  {zoneId:'main-north-row',trackId:'track-main',label:'主轨中部横段北侧及左转角',minimumSeats:8},
  {zoneId:'main-left-inner-elbow',trackId:'track-main',label:'主轨左内侧下转角',minimumSeats:1},
  {zoneId:'main-left-u-shoulders',trackId:'track-main',label:'主轨左下U形两侧弯肩',minimumSeats:2},
  {zoneId:'main-right-inner',trackId:'track-main',label:'主轨右侧折返内侧',minimumSeats:2},
  {zoneId:'main-inner-upper-corner',trackId:'track-main',label:'主轨中部横排右端内角补位',minimumSeats:1},
  {zoneId:'main-inner-lower-corner',trackId:'track-main',label:'主轨短横排右端内角补位',minimumSeats:1},
  {zoneId:'main-right-outer',trackId:'track-main',label:'主轨右侧折返外侧及下弯头',minimumSeats:4},
  {zoneId:'main-right-upper',trackId:'track-main',label:'主轨右上转角前的整齐末席',minimumSeats:1},
  {zoneId:'main-right-upper-arc',trackId:'track-main',label:'主轨右上弯头弧段餐位',minimumSeats:2},
  {zoneId:'main-return-end',trackId:'track-main',label:'短折返左端',minimumSeats:1},
  {zoneId:'main-return-upper',trackId:'track-main',label:'短折返上侧直排',minimumSeats:2},
  {zoneId:'main-return-lower',trackId:'track-main',label:'短折返下侧直排',minimumSeats:3},
  {zoneId:'main-return-lower-right',trackId:'track-main',label:'最下外横排右端弯肩补位',minimumSeats:1},
  {zoneId:'backup-upper-corner',trackId:'track-backup',label:'备用轨右上转角',minimumSeats:1},
  {zoneId:'backup-top-row',trackId:'track-backup',label:'备用轨顶部外侧整排',minimumSeats:9},
  {zoneId:'backup-front-inner',trackId:'track-backup',label:'备用轨前厅横段内侧直排',minimumSeats:7},
  {zoneId:'backup-side-pairs',trackId:'track-backup',label:'备用轨右侧两边对齐直排',minimumSeats:16},
] as const;
export type LayoutParameters = typeof defaults;
export const wrap = (s: number, length: number) => ((s % length) + length) % length;
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
export const round = (n: number) => Math.round(n * 1e6) / 1e6;
export function pointAt(track: Track, s: number): Point & { angle: number } {
  s = wrap(s, track.lengthM);
  const lut = track.arcLengthLut;
  let low = 0, high = lut.length - 1;
  while (high - low > 1) { const mid = (high + low) >> 1; if (lut[mid].sM <= s) low = mid; else high = mid; }
  const a = lut[low], b = lut[high], t = (s - a.sM) / (b.sM - a.sM);
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, angle: Math.atan2(b.x - a.x, b.z - a.z) };
}
export function positionAt(track: Track, s0: number, simTimeMs: number) {
  return pointAt(track, s0 + (track.enabled ? track.direction * track.speedMps * simTimeMs / 1000 : 0));
}
export function inWindow(track: Track, s: number, window: Pick<Window,'trackId'|'centerSM'|'halfWidthM'>) {
  return Math.abs(wrap(s - window.centerSM + track.lengthM / 2, track.lengthM) - track.lengthM / 2) <= window.halfWidthM + 1e-6;
}
/** Supports exactly the absolute SVG commands in the confirmed editable source; rejects others. */
export function sampleSvg(path: string, scale: number): Sample[] {
  const tokens = path.match(/[A-Za-z]|-?\d+(?:\.\d+)?/g)!;
  let i = 0, x = 0, y = 0, first = {x:0,y:0};
  const points: Point[] = [];
  const emit = (px:number,py:number) => { const p={x:round((px-65)*scale),y:0,z:round((py-100)*scale)}; if (!points.length || distance(points.at(-1)!,p)>1e-8) points.push(p); };
  const num = () => Number(tokens[i++]);
  const line = (tx:number,ty:number) => { const ox=x,oy=y,n=Math.max(1,Math.ceil(Math.hypot(tx-x,ty-y))); for(let k=1;k<=n;k++)emit(ox+(tx-ox)*k/n,oy+(ty-oy)*k/n);x=tx;y=ty; };
  while(i<tokens.length) {
    const cmd=tokens[i++];
    if(cmd==='M'){x=num();y=num();first={x,y};emit(x,y);}
    else if(cmd==='H')line(num(),y);
    else if(cmd==='V')line(x,num());
    else if(cmd==='Z')line(first.x,first.y);
    else if(cmd==='C') {
      const ox=x,oy=y,x1=num(),y1=num(),x2=num(),y2=num(),tx=num(),ty=num();
      const n=Math.ceil(Math.hypot(x1-x,y1-y)+Math.hypot(x2-x1,y2-y1)+Math.hypot(tx-x2,ty-y2));
      for(let k=1;k<=n;k++){const t=k/n,u=1-t;emit(u*u*u*ox+3*u*u*t*x1+3*u*t*t*x2+t*t*t*tx,u*u*u*oy+3*u*u*t*y1+3*u*t*t*y2+t*t*t*ty);} x=tx;y=ty;
    } else if(cmd==='A') {
      const rx=num(),ry=num(),rotation=num(),large=num(),sweep=num(),tx=num(),ty=num();
      if(rx!==ry||rotation!==0)throw Error('Only confirmed circular arcs supported');
      const dx=(x-tx)/2,dy=(y-ty)/2,r=Math.max(rx,Math.hypot(dx,dy));
      const factor=(large===sweep?-1:1)*Math.sqrt(Math.max(0,(r*r-dx*dx-dy*dy)/(dx*dx+dy*dy)));
      const cx=(x+tx)/2+factor*dy,cy=(y+ty)/2-factor*dx;
      const a=Math.atan2(y-cy,x-cx);let delta=Math.atan2(ty-cy,tx-cx)-a;
      if(sweep&&delta<0)delta+=Math.PI*2;if(!sweep&&delta>0)delta-=Math.PI*2;
      const n=Math.ceil(Math.abs(delta*r));for(let k=1;k<=n;k++)emit(cx+r*Math.cos(a+delta*k/n),cy+r*Math.sin(a+delta*k/n));x=tx;y=ty;
    } else throw Error(`Unsupported SVG command ${cmd}`);
  }
  let s=0;return points.map((p,j)=>{if(j)s+=distance(points[j-1],p);return {...p,sM:round(s)};});
}
export function segmentDistance(p: Point, a: Point, b: Point) {
  const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz||1)));
  return distance(p,{x:a.x+t*dx,z:a.z+t*dz});
}
export function nearest(track: Track, p: Point) { let best=track.arcLengthLut[0],d=Infinity;for(const q of track.arcLengthLut){const v=distance(p,q);if(v<d){d=v;best=q;}}return {s:best.sM,d}; }
/** Project authored seating anchors onto LUT segments so straight-run spacing stays exact. */
function anchorArcLength(track:Track,q:Point){
  let best=0,bestDistance=Infinity;
  for(let i=1;i<track.arcLengthLut.length;i++){
    const a=track.arcLengthLut[i-1],b=track.arcLengthLut[i],dx=b.x-a.x,dz=b.z-a.z;
    const ratio=Math.max(0,Math.min(1,((q.x-a.x)*dx+(q.z-a.z)*dz)/(dx*dx+dz*dz)));
    const d=distance(q,{x:a.x+dx*ratio,z:a.z+dz*ratio});
    if(d<bestDistance){bestDistance=d;best=a.sM+(b.sM-a.sM)*ratio;}
  }
  return best;
}
export function buildGeometry(overrides: Partial<LayoutParameters> = {}) {
  const config={...defaults,...overrides},scale=config.metresPerDrawingUnit;
  if(config.leftGapPercent!==65||config.sauceLengthPercent!==180)throw Error('Confirmed layout v1 requires ratios 65/180');
  for(const [k,v] of Object.entries(config))if(!Number.isFinite(v)||v<=0)throw Error(`Invalid geometry parameter ${k}`);
  const p=(x:number,z:number):Point=>({x:round((x-65)*scale),y:0,z:round((z-100)*scale)});
  const x=74+136*config.leftGapPercent/100+15.5,xi=x+32;
  const right=config.mainRightExtensionM/scale,returnEnd=625-config.mainReturnExtensionM/scale,frontShift=config.backupFrontShiftM/scale;
  const paths=[`M ${x} 340 V 770 A 16 16 0 0 0 ${xi} 770 V 578 A 48 48 0 0 1 ${xi+48} 530 H ${770+right} A 16 16 0 0 1 ${786+right} 546 V 694 A 10 10 0 0 1 ${776+right} 704 H ${returnEnd} A 16 16 0 0 0 ${returnEnd} 736 H ${776+right} A 42 42 0 0 0 ${818+right} 694 V 546 A 48 48 0 0 0 ${770+right} 498 H ${xi+48} A 48 48 0 0 1 ${xi} 450 V 340 C ${xi} 310 ${xi-12} 291 ${x} 291 A 16 16 0 0 0 ${x} 323 C ${x+14} 323 ${x} 330 ${x} 340 Z`, `M 650 184 H 746 C 784 184 812 ${184+frontShift} 850 ${184+frontShift} H 1330 A 48 48 0 0 1 1378 ${232+frontShift} V 760 A 16 16 0 0 1 1346 760 V ${232+frontShift} A 16 16 0 0 0 1330 ${216+frontShift} H 850 C 812 ${216+frontShift} 784 216 746 216 H 650 A 16 16 0 0 1 650 184 Z`];
  const tracks:Track[]=paths.map((svgPath,i)=>{const arcLengthLut=sampleSvg(svgPath,scale);return {trackId:i?'track-backup':'track-main',enabled:!i,direction:1,speedMps:config.speedMps,lengthM:arcLengthLut.at(-1)!.sM,svgPath,path:arcLengthLut.map(({x,y,z})=>({x,y,z})),arcLengthLut};});
  const wallCoords=[[65,850,65,100],[65,100,1515,100],[1515,100,1515,850],[720,100,720,166],[720,234,720,345],[720,345,704,345],[65,345,x-17,345],[xi+17,345,444,345]];
  const walls:Wall[]=wallCoords.map(([a,b,c,d],i)=>({wallId:`wall-${i+1}`,from:p(a,b),to:p(c,d),thicknessM:18*scale}));
  const kitchen={min:p(65,100),max:p(720,345),boundary:[p(65,100),p(720,100),p(720,345),p(65,345)]},sauce={min:p(975,820-240*config.sauceLengthPercent/100),max:p(1087,820)},drinks={min:p(445,329),max:p(704,359)};
  const rectDistance=(q:Point,r:{min:Point;max:Point})=>Math.hypot(Math.max(r.min.x-q.x,0,q.x-r.max.x),Math.max(r.min.z-q.z,0,q.z-r.max.z));
  const servingWindows:Window[]=tracks.map((t,i)=>{const s=nearest(t,i?p(680,184):p(xi,315)).s;return {windowId:i?'supply-backup':'supply-main',trackId:t.trackId,centerSM:s,halfWidthM:.18,position:{...pointAt(t,s),y:.98},staffPosition:{x:round(pointAt(t,s).x+(i?0:.75)),y:0,z:round(pointAt(t,s).z+(i?-.75:0))}};});
  const slots=tracks.flatMap(t=>{const count=Math.floor(t.lengthM/(config.plateDiameterM+config.plateGapM));return Array.from({length:count},(_,i)=>({slotId:`${t.trackId}-slot-${String(i+1).padStart(3,'0')}`,trackId:t.trackId,s0M:round(i*t.lengthM/count),usable:true}));});
  const seats:Seat[]=[];
  const footprints=new Map<string,Point[]>();
  const clearOfChairs=(q:Point,r:number,ignoreSeatId?:string)=>seats.every(s=>s.seatId===ignoreSeatId||(distance(s.position,q)>config.chairRadiusM+r+.06&&polygonDistance(q,footprints.get(s.seatId)!)>r+.02));
  const clear=(q:Point,r:number,includeSeats=true)=> q.x>r+.18&&q.x<1450*scale-r-.18&&q.z>r+.18&&q.z<750*scale-r&&rectDistance(q,kitchen)>r+.30&&rectDistance(q,sauce)>r+.30&&rectDistance(q,drinks)>r+.35&&walls.every(w=>segmentDistance(q,w.from,w.to)>r+w.thicknessM/2)&&tracks.every(t=>nearest(t,q).d>config.counterWidthM/2+r+.04)&&(!includeSeats||clearOfChairs(q,r));
  const addSeat=(t:Track,s:number,side:number,seatId:string,zoneId:string)=>{
    const at=pointAt(t,s),normal={x:Math.cos(at.angle)*side,z:-Math.sin(at.angle)*side};
    const position={x:round(at.x+normal.x*config.seatOffsetM),y:0,z:round(at.z+normal.z*config.seatOffsetM)};
    const angle=Math.atan2(-normal.x,-normal.z);
    const perpendicularCorner=(other:Seat)=>zoneId.startsWith('main-inner-')&&other.zoneId==='main-right-inner'&&Math.abs(Math.cos(angle-other.angle))<.1;
    // Row pitch measures along one counter edge; the two authored perpendicular corners
    // retain the full footprint/capsule checks rather than using row pitch across the bend.
    if(!clear(position,config.chairRadiusM)||seats.some(o=>distance(o.position,position)<config.seatPitchM*.9&&!perpendicularCorner(o))||servingWindows.some(w=>distance(w.position,position)<1.6))return;
    const seat:Seat={seatId,zoneId,usable:true,trackId:t.trackId,position,angle,grill:diningPlacement(t,s,normal,config.grillOffsetM),takeWindow:{windowId:`pickup-${seatId}`,trackId:t.trackId,centerSM:round(s),halfWidthM:.25,position:{x:at.x,z:at.z}},approachPath:[]};
    seats.push(seat);footprints.set(seatId,chairFootprint(seat));return seat;
  };
  // Keep the original straight-run phase and IDs outside the user's marked areas.
  // Competing candidates in the three marked runs are replaced by their local layout below.
  for(const t of tracks)for(let s=.7;s<t.lengthM-.7;s+=config.seatPitchM) {
    if(t.trackId==='track-backup')continue;
    const at=pointAt(t,s),a=pointAt(t,s-.5),b=pointAt(t,s+.5);
    if(Math.abs(Math.sin(a.angle-b.angle))>.05||Math.cos(a.angle-b.angle)<.99)continue;
    for(const side of [-1,1]) {
      const normal={x:Math.cos(at.angle)*side,z:-Math.sin(at.angle)*side};
      const position={x:round(at.x+normal.x*config.seatOffsetM),y:0,z:round(at.z+normal.z*config.seatOffsetM)};
      const behind={x:position.x+normal.x*.65,z:position.z+normal.z*.65};
      if(!clear(behind,config.walkingRadiusM,false))continue;
      if(t.trackId==='track-main'){
        if(normal.z<-.9&&Math.abs(at.z-p(65,498).z)<1e-6)continue;
        if(normal.x>.9&&Math.abs(at.x-p(xi,100).x)<1e-6&&at.z<p(65,455).z)continue;
        if(at.x>=p(786+right,100).x-1e-6)continue;
        if(Math.abs(at.z-p(65,704).z)<1e-6||Math.abs(at.z-p(65,736).z)<1e-6)continue;
        if(normal.z>.9&&Math.abs(at.z-p(65,530).z)<1e-6&&position.x>p(786+right,100).x-config.seatOffsetM-config.seatPitchM*.9)continue;
        if(config.seatPitchM!==defaults.seatPitchM&&normal.z>.9&&Math.abs(at.z-p(65,530).z)<1e-6)continue;
      }
      const seatId=`${t.trackId}-seat-${Math.round(s*1000)}-${side<0?'L':'R'}`;
      const zoneId=t.trackId==='track-main'&&normal.x>.9&&at.x>p(800,100).x?'main-right-outer':'retained';
      addSeat(t,s,side,seatId,zoneId);
    }
  }
  const [main,backup]=tracks;
  const anchor=(t:Track,q:Point,side:number,zoneId:string,index:number,oldId?:string)=>{
    const s=anchorArcLength(t,q);
    if(addSeat(t,s,side,oldId??`${t.trackId}-seat-${zoneId}-${index}`,zoneId))return;
    // A wider pitch may already place an unchanged straight-run seat at this shoulder.
    // Count that existing seat as coverage rather than piling another chair beside it.
    const at=pointAt(t,s),target={x:at.x+Math.cos(at.angle)*side*config.seatOffsetM,z:at.z-Math.sin(at.angle)*side*config.seatOffsetM};
    const existing=seats.filter(seat=>seat.trackId===t.trackId&&seat.zoneId==='retained'&&distance(seat.position,target)<config.seatPitchM*.9).sort((a,b)=>distance(a.position,target)-distance(b.position,target))[0];
    if(existing)existing.zoneId=zoneId;
  };
  const innerX=p(xi,100).x,upperZ=kitchen.max.z+.8;
  const upperInsideSeats=Math.floor((defaults.seatPitchM+1e-6)/config.seatPitchM)+1;
  anchor(main,{x:innerX,z:upperZ},-1,'main-upper-inside',1,'track-main-seat-54460-L');
  for(let i=1;i<upperInsideSeats;i++)anchor(main,{x:innerX,z:upperZ+i*config.seatPitchM},-1,'main-upper-inside',i+1);
  const northStart=innerX+config.seatOffsetM+config.seatPitchM,northEnd=p(770+right,100).x-.5;
  const northCount=Math.max(1,Math.ceil((northEnd-northStart)/config.seatPitchM));
  for(let i=0;i<northCount;i++)anchor(main,{x:northStart+i*config.seatPitchM,z:p(65,498).z},-1,i===northCount-1?'main-right-upper':'main-north-row',i+1);
  anchor(main,p(xi,600),-1,'main-left-inner-elbow',1);
  anchor(main,p(x,767),-1,'main-left-u-shoulders',1);
  anchor(main,p(xi,767),-1,'main-left-u-shoulders',2);
  // The inside vertical pair replaces the conflicting old top/inside candidate pair.
  const rightInnerZ=p(65,546).z+.8;
  for(let i=0;i<2;i++)anchor(main,{x:p(786+right,100).x,z:rightInnerZ+i*config.seatPitchM},-1,'main-right-inner',i+1);
  const rightInnerX=p(786+right,100).x-config.seatOffsetM,upperCornerX=rightInnerX-1.02;
  if(config.seatPitchM!==defaults.seatPitchM){
    for(let qx=upperCornerX-config.seatPitchM,i=1;qx>p(xi+48,100).x+.55;qx-=config.seatPitchM,i++)anchor(main,{x:qx,z:p(65,530).z},-1,'retained',i);
  }
  anchor(main,{x:upperCornerX,z:p(65,530).z},-1,'main-inner-upper-corner',1);
  const outerCount=Math.floor((p(65,694).z-p(65,546).z-.6)/config.seatPitchM)+1;
  const outerStart=(p(65,546).z+p(65,694).z-(outerCount-1)*config.seatPitchM)/2;
  for(let i=0;i<outerCount;i++)anchor(main,{x:p(818+right,100).x,z:outerStart+i*config.seatPitchM},-1,'main-right-outer',i+1);
  anchor(main,p(776+right+42/Math.sqrt(2),694+42/Math.sqrt(2)),-1,'main-right-outer',outerCount+1);
  // Two authored arc positions bridge the horizontal and vertical rows without moving either.
  for(const [i,angle] of [Math.PI*3/8,Math.PI/8].entries())anchor(main,p(770+right+48*Math.cos(angle),546-48*Math.sin(angle)),-1,'main-right-upper-arc',i+1);
  const returnStart=p(returnEnd,100).x+.55,returnEndX=p(776+right,100).x-.35;
  const returnUpperEnd=rightInnerX-1.00,returnUpperStart=p(returnEnd,100).x+.18;
  const returnUpperCount=Math.max(1,Math.floor((returnUpperEnd-returnUpperStart+1e-6)/config.seatPitchM)+1);
  const returnLowerRight=returnStart+Math.floor((returnEndX-returnStart)/defaults.seatPitchM)*defaults.seatPitchM;
  const returnLowerCount=Math.max(1,Math.floor((returnLowerRight-returnStart+1e-6)/config.seatPitchM)+1);
  for(let i=0;i<returnUpperCount;i++)anchor(main,{x:returnUpperEnd-(returnUpperCount-1-i)*config.seatPitchM,z:p(65,704).z},-1,i===returnUpperCount-1?'main-inner-lower-corner':'main-return-upper',i===returnUpperCount-1?1:i+1);
  for(let i=0;i<returnLowerCount;i++)anchor(main,{x:returnLowerRight-(returnLowerCount-1-i)*config.seatPitchM,z:p(65,736).z},-1,i===returnLowerCount-1?'main-return-lower-right':'main-return-lower',i===returnLowerCount-1?1:i+1);
  anchor(main,p(returnEnd-16,720),-1,'main-return-end',1);
  const backupRowStart=p(850,100).x+.55,backupTopEnd=p(1330,100).x-.05,backupInnerEnd=p(1346,100).x-config.seatOffsetM-config.seatPitchM*.9;
  const backupTopCount=Math.ceil((backupTopEnd-backupRowStart)/config.seatPitchM),backupInnerCount=Math.ceil((backupInnerEnd-backupRowStart)/config.seatPitchM);
  for(let i=0;i<backupTopCount;i++)anchor(backup,{x:backupRowStart+i*config.seatPitchM,z:p(65,184+frontShift).z},1,'backup-top-row',i+1);
  for(let i=0;i<backupInnerCount;i++)anchor(backup,{x:backupRowStart+i*config.seatPitchM,z:p(65,216+frontShift).z},1,'backup-front-inner',i+1);
  const backupSideMin=p(65,232+frontShift).z+.65,backupSideMax=p(65,760).z-.55;
  const backupSideCount=Math.floor((backupSideMax-backupSideMin)/config.seatPitchM)+1,backupSideStart=(backupSideMin+backupSideMax-(backupSideCount-1)*config.seatPitchM)/2;
  for(let i=0;i<backupSideCount;i++)for(const [sideIndex,trackX] of [1378,1346].entries())anchor(backup,{x:p(trackX,100).x,z:backupSideStart+i*config.seatPitchM},1,'backup-side-pairs',i*2+sideIndex+1);
  anchor(backup,p(1330+48*Math.cos(Math.PI/6),232+frontShift-48*Math.sin(Math.PI/6)),1,'backup-upper-corner',1);
  // 0.10m cells preserve the narrow but valid aisle behind the new northern row.
  const grid=.10,width=Math.ceil(1450*scale/grid),height=Math.ceil(750*scale/grid);
  const entry={x:round(725*scale),z:round(735*scale)};
  const cells=new Int32Array(width*height).fill(-2);
  const atCell=(id:number)=>({x:(id%width+.5)*grid,z:(Math.floor(id/width)+.5)*grid});
  const cellId=(q:Point)=>Math.floor(q.z/grid)*width+Math.floor(q.x/grid);
  for(let id=0;id<cells.length;id++)if(clear(atCell(id),config.walkingRadiusM))cells[id]=-1;
  const start=cellId(entry);if(cells[start]!==-1)throw Error('Entrance blocked');cells[start]=start;
  const queue=[start];for(let k=0;k<queue.length;k++){const id=queue[k];for(const n of [id-1,id+1,id-width,id+width])if(n>=0&&n<cells.length&&Math.abs(n%width-id%width)<=1&&cells[n]===-1){cells[n]=id;queue.push(n);}}
  const accepted:Seat[]=[];
  const segmentClear=(a:Point,b:Point,ignoreSeatId?:string)=>{
    const count=Math.max(1,Math.ceil(distance(a,b)/.025));
    for(let i=0;i<=count;i++){const q={x:a.x+(b.x-a.x)*i/count,z:a.z+(b.z-a.z)*i/count};if(!clear(q,config.walkingRadiusM,false)||!clearOfChairs(q,config.walkingRadiusM,ignoreSeatId))return false;}return true;
  };
  for(const seat of seats){
    const outward={x:-Math.sin(seat.angle),z:-Math.cos(seat.angle)},tangent={x:Math.cos(seat.angle),z:-Math.sin(seat.angle)};
    const candidates=[0,.35,-.35,.50,-.50,.70,-.70].map(v=>({x:seat.position.x+outward.x*.65+tangent.x*v,z:seat.position.z+outward.z*.65+tangent.z*v}));
    let connection:{behind:Point;id:number;length:number}|undefined;
    for(const behind of candidates){
      if(!segmentClear(behind,seat.position,seat.seatId))continue;
      const cx=Math.floor(behind.x/grid),cz=Math.floor(behind.z/grid);
      const connections:{behind:Point;id:number;length:number}[]=[];
      for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
        const nx=cx+dx,nz=cz+dz;if(nx<0||nx>=width||nz<0||nz>=height)continue;
        const id=nz*width+nx;
        if(cells[id]>=0&&segmentClear(atCell(id),behind))connections.push({behind,id,length:distance(atCell(id),behind)+distance(behind,seat.position)});
      }
      connection=connections.sort((a,b)=>a.length-b.length||a.id-b.id)[0];
      if(connection)break;
    }
    // A valid world point may lie inside a blocked raster cell. Connect through the
    // closest safe neighbouring cell only after checking that entire short segment.
    if(!connection)continue;
    const behind=connection.behind;let id=connection.id;const route:Point[]=[];
    while(id!==start){route.push(atCell(id));id=cells[id];}route.push(atCell(start));route.reverse();route.push(behind,seat.position);
    seat.approachPath=route.filter((q,i)=>i===0||i===route.length-1||i>=route.length-3||Math.abs((q.x-route[i-1].x)*(route[i+1].z-q.z)-(q.z-route[i-1].z)*(route[i+1].x-q.x))>1e-8);accepted.push(seat);
  }
  const zoneTargets:Record<string,number>={'main-upper-inside':upperInsideSeats,'main-north-row':northCount-1,'main-right-outer':outerCount+1,'main-return-upper':returnUpperCount-1,'main-return-lower':returnLowerCount-1,'backup-top-row':backupTopCount,'backup-front-inner':backupInnerCount,'backup-side-pairs':backupSideCount*2};
  const configuredSeatingZones=seatingZones.map(zone=>({...zone,minimumSeats:zoneTargets[zone.zoneId]??zone.minimumSeats,actualSeats:accepted.filter(seat=>seat.zoneId===zone.zoneId).length}));
  return {contractVersion:'1.0.0' as const,layoutParameters:{leftGapPercent:65 as const,sauceLengthPercent:180 as const},layoutVersion:'hongkaola-confirmed-65-180-v6',schemaVersion:'scene-manifest.v1',coordinateSystem:{unit:'m',origin:'confirmed SVG (65,100), floor y=0',axes:{x:'right',y:'up',z:'towards street entrance'},drawingScaleM:scale,measured:false as const},config,provenance:{confirmed:'Vector topology and ratios 65/180, not measured dimensions',parameters:'All metre sizes, speeds, chair pitch and clearances are adjustable demo assumptions',source:'restaurant-layout.html / hongkaola-layout-vectors-v1'},floor:{min:p(65,100),max:p(1515,850)},kitchen,walls,drinks,sauce,entry,tracks,slots,seats:accepted,seatingZones:configuredSeatingZones,servingWindows,plateDimensions:{diameterM:config.plateDiameterM,heightM:.08},navigation:{radiusM:config.walkingRadiusM,gridM:grid,reachableCells:queue.length,rejectedUnreachableSeats:seats.length-accepted.length,rejectedUnreachableSeatIds:seats.filter(seat=>!accepted.includes(seat)).map(seat=>seat.seatId)},plates:[] as {plateId:string;slotId:string;dishId:string;diameterM:number;heightM:number}[],dishCatalog:[] as import('@zhishan/contracts/demo-v1').Dish[],bindingSource:'awaiting-main-system-catalog',contentDigest:''};
}
export type SceneManifest = ReturnType<typeof buildGeometry>;
