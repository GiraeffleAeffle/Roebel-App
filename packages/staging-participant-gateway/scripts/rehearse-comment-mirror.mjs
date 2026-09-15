import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
// Optional local verification dependency: @electric-sql/pglite 0.3.14.
const { PGlite } = await import(process.env.PGLITE_MODULE ?? '@electric-sql/pglite');
const root=fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/,'');
const db=new PGlite();
await db.exec(`create role anon; create role authenticated; create schema staging_participant_private; create schema extensions; create schema vault;
create function extensions.digest(text,text) returns bytea language sql immutable strict as 'select sha256(convert_to($1,''UTF8''))';
create table vault.decrypted_secrets(name text, decrypted_secret text);
insert into vault.decrypted_secrets values ('roebel_staging_participant_environment_arm','staging-only'),('roebel_staging_participant_rpc_secret',repeat('k',32));
create table public.app_settings(key text,value text); insert into public.app_settings values('roebel_env','staging');
create table staging_participant_private.staging_participant_environment(singleton boolean,environment text); insert into staging_participant_private.staging_participant_environment values(true,'staging');
create table public.posts(id uuid primary key, status text, feed_type text);
create table public.post_comments(id uuid primary key, post_id uuid references public.posts(id), wallet_address text, account_id uuid, content text, status text, media_urls text[],video_url text);
create table staging_participant_private.staging_participant_write_audit(result_id uuid,source_post_id uuid,wallet_address text,action text,content_sha256 bytea);
create table staging_participant_private.admissions(wallet text primary key,active boolean);
create function staging_participant_private.ensure_active_staging_participant(wallet text) returns void language plpgsql security definer as $$ begin if not exists(select 1 from staging_participant_private.admissions a where a.wallet=$1 and active) then raise exception 'inactive'; end if; end $$;`);
const original=readFileSync(root+'/supabase/migrations/20260825_staging_participant_gateway.sql','utf8');
for(const name of ['staging_participant_rpc_secret','require_staging_participant_gateway']) {
 const start=original.indexOf('create or replace function staging_participant_private.'+name+'()');
 const end=original.indexOf('$$;',start)+3;
 await db.exec(original.slice(start,end));
}
await db.exec(readFileSync(root+'/supabase/migrations/20260915_staging_comment_mecky_mirror.sql','utf8'));
const wallet='0x'+'1'.repeat(40), other='0x'+'2'.repeat(40);
const post='10000000-0000-4000-8000-000000000001', secondPost='10000000-0000-4000-8000-000000000002';
const c1='20000000-0000-4000-8000-000000000001',c2='20000000-0000-4000-8000-000000000002',c3='20000000-0000-4000-8000-000000000003';
const request='30000000-0000-4000-8000-000000000001';
const content='@Mecky, was sagt der Fachbereich Verkehr?';
const digest=createHash('sha256').update(content).digest('hex');
await db.query('insert into staging_participant_private.admissions values ($1,true),($2,true)',[wallet,other]);
await db.query("insert into public.posts values ($1,'published','main'),($2,'published','main')",[post,secondPost]);
for(const [id,owner] of [[c1,wallet],[c2,other],[c3,wallet]]) {
 await db.query("insert into public.post_comments values ($1,$2,$3,null,$4,'published','{}',null)",[id,post,owner,content]);
 await db.query("insert into staging_participant_private.staging_participant_write_audit values ($1,$2,$3,'comment',decode($4,'hex'))",[id,post,owner,digest]);
}
await db.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-staging-participant-rpc-secret':'k'.repeat(32)})]);
const now=Math.floor(Date.now()/1000);
const args=[wallet,post,c1,request,'a'.repeat(64),now,digest];
const call=async(op,a=args)=>(await db.query(`select public.staging_participant_gateway_${op}_comment_mirror($1,$2,$3,$4,$5,$6,$7) as receipt`,a)).rows[0].receipt;
const passed=[];
const check=async(name,fn)=>{await fn();passed.push(name)};
await check('reserve exact saved comment',async()=>assert.equal((await call('reserve')).state,'reserved'));
await check('different wallet denied',()=>assert.rejects(call('reserve',[other,...args.slice(1)]),/CONFLICT/));
await check('different parent denied',()=>assert.rejects(call('reserve',[wallet,secondPost,...args.slice(2)]),/CONFLICT/));
await check('replacement event denied',()=>assert.rejects(call('reserve',[...args.slice(0,4),'b'.repeat(64),...args.slice(5)]),/CONFLICT/));
await check('changed content denied',()=>assert.rejects(call('reserve',[...args.slice(0,6),'b'.repeat(64)]),/CONFLICT/));
await check('completion requires reservation',()=>assert.rejects(call('complete',[wallet,post,c3,request,'c'.repeat(64),now,digest]),/CONFLICT/));
await check('complete and replay preserve receipt',async()=>{const completed=await call('complete');assert.equal(completed.state,'published');assert.deepEqual(await call('reserve'),completed);assert.deepEqual(await call('complete'),completed)});
await check('second citizen can reserve own comment in same feed',async()=>assert.equal((await call('reserve',[other,post,c2,'30000000-0000-4000-8000-000000000002','d'.repeat(64),now,digest])).wallet_address,other));
await check('unreserved stale event rejected',()=>assert.rejects(call('reserve',[wallet,post,c3,'30000000-0000-4000-8000-000000000003','e'.repeat(64),now-3600,digest]),/STALE/));
await check('existing receipt can be recovered after freshness window',async()=>{
 await db.query('update staging_participant_private.staging_participant_comment_mirrors set event_created_at=$1 where source_comment_id=$2',[now-3600,c1]);
 assert.equal((await call('reserve',[...args.slice(0,5),now-3600,digest])).state,'published');
});
await check('changed persisted source blocks even old receipt',async()=>{
 await db.query("update public.post_comments set content='changed' where id=$1",[c1]);
 await assert.rejects(call('reserve',[...args.slice(0,5),now-3600,digest]),/CONFLICT/);
});
await check('private table remains unreadable to anon',async()=>{
 await db.exec('set role anon');
 await assert.rejects(db.query('select * from staging_participant_private.staging_participant_comment_mirrors'),/permission denied/);
 await db.exec('reset role');
});
await check('browser anon cannot invoke RPC without gateway secret',async()=>{
 await db.query("select set_config('request.headers','{}',false)");
 await db.exec('set role anon');
 await assert.rejects(call('reserve'),/GATEWAY_REQUIRED/);
 await db.exec('reset role');
});
const count=(await db.query('select count(*)::int as count from public.post_comments')).rows[0].count;
assert.equal(count,3);
await db.close();
const result={status:'passed',engine:'PGlite PostgreSQL',checks:passed,count:passed.length,scope:'Real new migration SQL; existing admission helper is an explicit test fixture. No live network or database writes.'};
console.log(JSON.stringify(result));
