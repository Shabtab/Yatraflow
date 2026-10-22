import { beforeEach, describe, expect, it, vi } from 'vitest'
const f=vi.hoisted(()=>({userId:'A' as string|null,online:true,writes:[] as any[],trips:[] as any[],slots:[] as any[],index:0,effects:[] as (()=>void)[],cleanups:[] as (()=>void)[],listeners:new Map<string,()=>void>(),downloads:[] as any[],resolve: null as null|(()=>Promise<boolean>),calls:[] as any[]}));
vi.mock('react',async load=>({...await load<typeof import('react')>(),
  useState:(initial:any)=>{const i=f.index++;if(!(i in f.slots))f.slots[i]=typeof initial==='function'?initial():initial;return[f.slots[i],(next:any)=>{f.slots[i]=typeof next==='function'?next(f.slots[i]):next}]},
  useRef:(initial:any)=>{const i=f.index++;if(!(i in f.slots))f.slots[i]={current:initial};return f.slots[i]},
  useMemo:(make:()=>any,deps:any[])=>{const i=f.index++;const old=f.slots[i];if(!old||deps.some((d,j)=>d!==old.deps[j]))f.slots[i]={deps,value:make()};return f.slots[i].value},
  useEffect:(fn:()=>any,deps:any[])=>{const i=f.index++;const old=f.slots[i];if(!old||deps.some((d,j)=>d!==old.deps[j])){f.effects.push(()=>{old?.cleanup?.();const cleanup=fn();f.slots[i]={deps,cleanup}})}},
}));
vi.mock('../src/store/store',()=>({
  useDb:()=>({sessionUserId:f.userId,trips:f.trips,cachedAt:null}),getSnapshot:()=>({sessionUserId:f.userId,trips:f.trips}),
  resolveQueuedTripWrite:async(tripId:string,choice:string)=>{f.calls.push({tripId,choice});return f.resolve?await f.resolve():true},resumeSync:async()=>{},
}));
vi.mock('../src/lib/timefmt',()=>({useTimeFormat:()=> '24h',formatHM:(v:string)=>v}));
vi.mock('../src/lib/writeQueue',()=>({pendingWrites:async()=>structuredClone(f.writes),subscribePendingWrites:()=>()=>{}}));
vi.mock('../src/lib/snapshot',()=>({downloadTripJson:(trip:any)=>f.downloads.push(structuredClone(trip))}));
import {OfflineBanner} from '../src/components/OfflineBanner';
function render(){f.index=0;return OfflineBanner()}
async function flush(){for(let i=0;i<10;i++)await Promise.resolve()}
async function mount(){let tree=render();for(const e of f.effects.splice(0))e();await flush();return render()}
function nodes(tree:any):any[]{if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=='object')return[];return[tree,...nodes(tree.props?.children)]}
function text(tree:any):string{if(Array.isArray(tree))return tree.map(text).join(' ');if(tree==null||tree===false)return'';if(typeof tree==='object')return text(tree.props?.children);return String(tree)}
function button(tree:any,label:string){const found=nodes(tree).find(n=>n.type==='button'&&text(n).trim()===label);expect(found,label).toBeDefined();return found}
const write=(overrides:any={})=>({ownerId:'A',tripId:'shared',capturedAt:1,attempts:0,state:'failed',reason:'access-revoked',trip:{id:'shared',name:'PRIVATE QUEUED NAME',days:[]},...overrides});
function deferred(){let release!:(value:boolean)=>void;return{promise:new Promise<boolean>(r=>release=r),get release(){return release}}}
beforeEach(()=>{f.userId='A';f.online=true;f.writes=[write()];f.trips=[];f.slots=[];f.index=0;f.effects=[];f.cleanups=[];f.listeners=new Map();f.downloads=[];f.calls=[];f.resolve=null;vi.stubGlobal('navigator',{onLine:true});vi.stubGlobal('addEventListener',(name:string,fn:()=>void)=>f.listeners.set(name,fn));vi.stubGlobal('removeEventListener',(name:string)=>f.listeners.delete(name))});
describe('actual OfflineBanner handlers with deterministic hooks',()=>{
  it('offline reasoned Remove executes discard and waits for its result',async()=>{
    vi.stubGlobal('navigator',{onLine:false});const gate=deferred();f.resolve=()=>gate.promise;
    let tree=await mount();const remove=button(tree,'Remove saved copy');expect(remove.props.disabled).toBeFalsy();remove.props.onClick();
    expect(f.calls).toEqual([{tripId:'shared',choice:'discard'}]);expect(text(render())).not.toContain('was removed from this device');
    f.writes=[];gate.release(true);await flush();expect(text(render())).toContain('The saved copy was removed from this device.');
  });
  it('online failed held discard names the actual failed shared read',async()=>{
    f.writes=[write({reason:undefined})];f.resolve=async()=>false;
    const tree=await mount();button(tree,'Discard saved edit').props.onClick();await flush();
    expect(f.calls).toEqual([{tripId:'shared',choice:'discard'}]);
    expect(text(render())).toContain('shared plan could not be read');
  });
  it('conflict Use shared plan also names a failed shared read',async()=>{
    f.writes=[write({state:'conflict',reason:undefined})];f.resolve=async()=>false;
    const tree=await mount();button(tree,'Use shared plan').props.onClick();await flush();
    expect(text(render())).toContain('shared plan could not be read');
  });
  it('removed owner can export a valid queued copy without revealing its private title',async()=>{
    const tree=await mount();expect(text(tree)).not.toContain('PRIVATE QUEUED NAME');button(tree,'Download my copy').props.onClick();expect(f.downloads[0].name).toBe('PRIVATE QUEUED NAME');
  });
  it('the stale download handler cannot export A under B before a new render',async()=>{
    const tree=await mount();f.userId='B';button(tree,'Download my copy').props.onClick();expect(f.downloads).toEqual([]);
  });
  it('the stale removal handler cannot start under B before a new render',async()=>{
    const tree=await mount();f.userId='B';button(tree,'Remove saved copy').props.onClick();expect(f.calls).toEqual([]);
  });
  it('a removal continuation cannot claim success under B',async()=>{
    const gate=deferred();f.resolve=()=>gate.promise;const tree=await mount();button(tree,'Remove saved copy').props.onClick();
    f.userId='B';await mount();gate.release(true);await flush();expect(text(render())).not.toContain('was removed from this device');expect(text(render())).not.toContain('PRIVATE QUEUED NAME');
  });
  it('a malformed reasoned copy offers removal without a download claim',async()=>{
    f.writes=[write({trip:{id:'shared'}})];const tree=await mount();expect(nodes(tree).some(n=>n.type==='button'&&text(n).includes('Download'))).toBe(false);expect(text(tree)).toContain('cannot be exported');
  });
  it('a malformed conflict copy never tells the owner to download it',async()=>{
    f.writes=[write({reason:undefined,state:'conflict',trip:{id:'shared'}})];const tree=await mount();expect(text(tree)).not.toContain('Download your copy before you choose.');
  });
});
