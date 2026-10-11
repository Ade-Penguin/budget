import {createClient} from '@supabase/supabase-js';
import {config} from './config.js';
import {LedgerSync,SyncConflict} from './cloud-core.js';
import {validate,blank} from './engine.js';
export function validateConfig(c){if(!c.supabaseUrl&&!c.publishableKey)return false;const url=new URL(c.supabaseUrl);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||!url.hostname.endsWith('.supabase.co'))throw Error('Supabase HTTPS 프로젝트 주소를 확인하세요.');if(!/^sb_publishable_[A-Za-z0-9_-]+$/.test(c.publishableKey))throw Error('프런트엔드에는 Supabase publishable key만 설정하세요.');return true;}
export const configured=validateConfig(config);
let client,sync,user=null,refreshTimer,epoch=0,callbacks,subscription,authUnsubscribe;
const keyPrefix='budget:'+new URL('.',import.meta.url).pathname+':';
export const signedIn=()=>!!user;
export function saveCloud(data){if(!sync||!user)throw Error('이메일로 로그인한 뒤 기록하세요.');sync.change(data);}
export async function startCloud(handlers){callbacks=handlers;if(!configured){handlers.status('로컬 모드 · Supabase 연결 설정 전');return;}
 client=createClient(config.supabaseUrl,config.publishableKey,{auth:{storage:sessionStorage,storageKey:keyPrefix+'auth',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
 const {data:{user:verified},error}=await client.auth.getUser();if(verified&&!error)await connect(verified);else handlers.data(blank());
 const {data}=client.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT')disconnect();else if(session?.user&&session.user.id!==user?.id)setTimeout(()=>connect(session.user),0);});authUnsubscribe=data.subscription;
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void sync?.refresh();});window.addEventListener('online',()=>void sync?.refresh());
}
async function connect(next){const gen=++epoch;sync?.stop();clearInterval(refreshTimer);if(subscription)await client.removeChannel(subscription);user=next;callbacks.auth(next.email||'로그인됨');callbacks.data(blank());const cacheKey=keyPrefix+'ledger:'+user.id;
 const backend={async load(){const {data,error}=await client.from('budget_ledgers').select('revision,data').eq('user_id',next.id).maybeSingle();if(error)throw error;return data?{revision:data.revision,data:validate(data.data)}:null;},async save(data,revision){const {data:saved,error}=await client.rpc('budget_save_ledger',{p_expected_revision:revision,p_data:data});if(error){if(error.message?.includes('BUDGET_CONFLICT'))throw new SyncConflict();throw error;}return saved;}};
 sync=new LedgerSync({backend,cache:{read(){try{const c=JSON.parse(localStorage.getItem(cacheKey));if(!c)return null;if(!Number.isSafeInteger(c.revision)||c.revision<0||typeof c.dirty!=='boolean')throw Error();if(c.data)validate(c.data);return c;}catch{callbacks.status('기기 저장값을 읽지 못했습니다. 서버 기록을 확인합니다.');return null;}},write(value){localStorage.setItem(cacheKey,JSON.stringify(value));}},onData:data=>{if(gen===epoch)callbacks.data(data||blank());},onStatus:(text,flags)=>{if(gen===epoch)callbacks.status(text,flags);}});
 await sync.start();if(gen!==epoch)return;subscription=client.channel('budget:'+next.id).on('postgres_changes',{event:'*',schema:'public',table:'budget_ledgers',filter:'user_id=eq.'+next.id},()=>void sync?.refresh()).subscribe();refreshTimer=setInterval(()=>{if(!document.hidden)void sync?.refresh();},120000);
}
export async function requestCode(email){if(!client)throw Error('Supabase 연결 설정이 필요합니다.');const {error}=await client.auth.signInWithOtp({email,options:{shouldCreateUser:false}});if(error)throw Error('코드를 보내지 못했습니다. 등록된 이메일과 전송 한도를 확인하세요.');}
export async function verifyCode(email,token){const {error}=await client.auth.verifyOtp({email,token,type:'email'});if(error)throw Error('인증번호가 올바르지 않거나 만료됐습니다.');}
function disconnect(){epoch++;sync?.stop();sync=null;clearInterval(refreshTimer);if(subscription)void client.removeChannel(subscription);subscription=null;user=null;callbacks.auth('');callbacks.data(blank());callbacks.status('로그아웃됨');}
export async function logout(){if(sync?.dirty)throw Error('아직 전송하지 못한 변경이 있습니다. 동기화하거나 백업한 뒤 로그아웃하세요.');const cacheKey=user?keyPrefix+'ledger:'+user.id:null;const {error}=await client.auth.signOut({scope:'local'});if(error)throw Error('로그아웃하지 못했습니다. 연결을 확인하세요.');if(cacheKey)localStorage.removeItem(cacheKey);disconnect();}
export async function resolveCloud(choice){if(!sync)throw Error('로그인이 필요합니다.');await sync.resolve(choice);}
export const conflictCopy=()=>sync?.data;
export const pendingCloud=()=>!!sync?.dirty;
export const refreshCloud=()=>sync?.refresh();
