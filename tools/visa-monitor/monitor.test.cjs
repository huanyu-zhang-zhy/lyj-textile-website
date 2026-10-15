'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {config,initialState,loadState,requestPolicy,report,persist,acquireLock,run}=require('./monitor.cjs');
const c=config({MONITOR_ENABLED:'true'});
const now=Date.parse('2026-10-15T14:00:00Z');
const sample=(minute,status,dates=[])=>({month:'2026-11',checkStartedAt:new Date(now+minute*60000).toISOString(),observedAt:new Date(now+minute*60000+4000).toISOString(),status,availableDates:dates});
test('configuration enforces minute minimum and 24h maximum; default is disabled',()=>{
  assert.equal(config({}).enabled,false);
  for(const e of [{INTERVAL_SECONDS:'59'},{DURATION_HOURS:'25'},{TARGET_MONTH:'2026-13'},{INTERVAL_SECONDS:'NaN'}])assert.throws(()=>config(e));
});
test('request policy blocks writes, third parties, unexpected navigation and heavy resources',()=>{
  const r={url:c.url,method:'GET',type:'document',navigation:true,mainFrame:true};
  assert.equal(requestPolicy(r,c.url),'continue');
  for(const change of [{method:'POST'},{method:'DELETE'},{url:'https://calendly.com.evil.test/foo'},{url:'http://calendly.com/a'},{mainFrame:false},{url:'https://calendly.com/conmel-mofa/visa?month=2026-12'},{type:'image'},{type:'eventsource'},{url:'https://127.0.0.1/'}])assert.equal(requestPolicy({...r,...change},c.url),'abort');
  assert.equal(requestPolicy({...r,url:'https://assets.calendly.com/app.js',navigation:false,type:'script'},c.url),'continue');
  assert.equal(requestPolicy({...r,url:'https://calendly.com/invitees',navigation:false,type:'fetch'},c.url),'abort');
});
test('initial availability is baseline, never a claimed release',()=>{
  const s=initialState(c,now);s.samples=[sample(0,'available_dates',['2026-11-03'])];s.attempts=1;
  const r=report(s,now+5000).summary;
  assert.equal(r.events.length,0);assert.deepEqual(r.initialAvailableDates,['2026-11-03']);assert.equal(r.plannedChecks,1440);
});
test('appearance window conservatively includes page loading and missing observations',()=>{
  const s=initialState(c,now);s.samples=[sample(0,'no_available_dates'),sample(1,'error'),sample(3,'available_dates',['2026-11-03'])];s.attempts=3;
  const r=report(s,now+200000).summary;
  assert.equal(r.events.length,1);assert.equal(r.events[0].windowSeconds,184);assert.equal(r.events[0].hasGap,true);assert.equal(r.validChecks,2);assert.equal(r.uncertain.length,1);
  assert.equal(r.hourly[1].discoveries,1); // Melbourne is UTC+11 on this date.
});
test('stable availability does not count repeatedly; disappearance then reappearance counts',()=>{
  const s=initialState(c,now);s.samples=[sample(0,'no_available_dates'),sample(1,'available_dates',['2026-11-03']),sample(2,'available_dates',['2026-11-03']),sample(3,'no_available_dates'),sample(4,'available_dates',['2026-11-03'])];s.attempts=5;
  assert.equal(report(s).summary.events.length,2);
});
test('no valid samples means no release-time inference and zero coverage',()=>{
  const s=initialState(c,now);s.samples=[sample(0,'blocked')];s.attempts=1;s.status='stopped_access_restriction';
  const r=report(s);assert.equal(r.summary.validCheckCoveragePercent,0);assert.match(r.summary.conclusion,/No valid/);assert.match(r.markdown,/不是完整 24 小时实测/);
});
test('persistent resume preserves original deadline, attempts, and terminal state',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'visa-monitor-'));const conf={...c,dataDir:dir};
  try{
    const s=initialState(conf,now);s.attempts=1;s.nextCheckAt=now+60000;s.status='stopped_access_restriction';persist(conf,s);
    const restored=loadState(conf,now+86400000);assert.equal(restored.endAt,s.endAt);assert.equal(restored.attempts,1);assert.equal(restored.status,s.status);
    assert.throws(()=>loadState({...conf,month:'2026-12'}));
    assert.ok(fs.existsSync(path.join(dir,'report.md')));assert.ok(fs.existsSync(path.join(dir,'summary.json')));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('one data directory cannot run two monitors',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'visa-lock-'));
  try{const release=acquireLock(dir);assert.throws(()=>acquireLock(dir));release();const again=acquireLock(dir);again();}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('disabled mode and resumed terminal mode do not load a browser',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'visa-disabled-'));const conf={...c,dataDir:dir};
  try{
    await run({...conf,enabled:false});assert.equal(fs.existsSync(path.join(dir,'state.json')),false);
    const s=initialState(conf,now);s.status='completed';persist(conf,s);
    await run(conf);assert.equal(loadState(conf).attempts,0);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
