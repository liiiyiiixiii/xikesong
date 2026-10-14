export class LunchClock {
 start:number; elapsed=0; paused=false; generation=0; revision=0;
 constructor(now=Date.now()){this.start=now;}
 read(now=Date.now()) {const total=this.elapsed+(this.paused?0:now-this.start);return {second:Math.min(600,Math.floor(total/1000)%600),cycle:this.generation+Math.floor(total/600000),paused:this.paused};}
 control(action:string,now=Date.now()) {
  if(action==='restart'){this.generation=this.read(now).cycle+1;this.elapsed=0;this.start=now;this.paused=false;}
  else if(action==='pause'&&!this.paused){this.elapsed+=now-this.start;this.paused=true;}
  else if(action==='resume'&&this.paused){this.start=now;this.paused=false;}
 }
}
