'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { analyze, compare, capture } = require('./calendar-probe.js');
function fixture() {
  return { url:'https://calendly.com/conmel-mofa/visa?month=2026-11', heading:'Visa Application Lodgement', months:['November 2026'], timezone:'Sydney, Melbourne Time', blocked:false,
    days:Array.from({length:30}, (_,i)=>({label:`${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][i%7]}, November ${i+1} - No times available`,disabled:true})) };
}
test('full calendar with no availability is recognized',()=>assert.equal(analyze(fixture(),'2026-11').status,'no_available_dates'));
test('positive date and diff are detected',()=>{
  const a=fixture(), before=analyze(a,'2026-11');
  a.days[2]={label:'Tuesday, November 3 - Times available',disabled:false};
  const after=analyze(a,'2026-11');
  assert.deepEqual(after.availableDates,['2026-11-03']);
  assert.deepEqual(compare(before,after).addedDates,['2026-11-03']);
});
test('incomplete calendar is unknown, never sold out',()=>{ const a=fixture();a.days.pop();assert.equal(analyze(a,'2026-11').status,'unknown'); });
test('hidden/preloaded or wrong month contamination fails closed',()=>{const a=fixture();a.days.push({label:'Tuesday, December 1 - Times available',disabled:false});assert.equal(analyze(a,'2026-11').status,'unknown');});
test('restrictions, wrong host, timezone, heading and date are rejected',()=>{
  for(const change of [{blocked:true},{url:'https://calendly.com.evil.example/conmel-mofa/visa?month=2026-11'},{timezone:'UTC'},{heading:'Login'},{months:['December 2026']},{url:'https://calendly.com/conmel-mofa/visa?month=2026-12'}]) {
    assert.ok(['unknown','blocked'].includes(analyze({...fixture(),...change},'2026-11').status));
  }
});
test('unexpected and contradictory labels are unknown',()=>{
  for(const row of [{label:'Tuesday, November 3 - Maybe available',disabled:false},{label:'Tuesday, November 3 - No times available',disabled:false}]){
    const a=fixture();a.days[2]=row;assert.equal(analyze(a,'2026-11').status,'unknown');
  }
});
test('different months and failed samples cannot produce release claims',()=>{
  assert.equal(compare(analyze(fixture(),'2026-11'),{status:'unknown',month:'2026-11'}).comparable,false);
  assert.equal(compare(analyze(fixture(),'2026-11'),{status:'available_dates',month:'2026-12',availableDates:['2026-12-01']}).comparable,false);
});
function fakeDocument() {
  const a=fixture();
  const el=(label,hidden=false)=>({textContent:label,disabled:true,parentElement:null,closest:()=>hidden?{}:null,getClientRects:()=>[{}],getAttribute:n=>n==='aria-label'?label:null});
  const rows=a.days.map(d=>el(d.label));
  rows.push(el('Tuesday, December 1 - Times available',true));
  return {body:{innerText:'November 2026'},defaultView:{getComputedStyle:()=>({display:'block',visibility:'visible'})},
    querySelector:()=>({textContent:'Sydney, Melbourne Time(1:15am)'}),
    querySelectorAll:s=>s==='h1'?[el(a.heading)]:s==='div'?[el('November 2026'),el('December 2026',true)]:rows};
}
test('capture excludes aria-hidden preloaded dates',()=>assert.equal(capture(fakeDocument(),fixture().url).days.length,30));
test('browser observer performs bounded local sampling without network or form APIs',()=>{
  let callback, cleared=0;
  const doc=fakeDocument();
  const denied=()=>{throw new Error('Forbidden I/O');};
  const win={document:doc,location:{href:fixture().url},fetch:denied,XMLHttpRequest:denied,WebSocket:denied,
    setInterval:fn=>{callback=fn;return 1;},clearInterval:()=>{cleared++;}};
  vm.runInNewContext(fs.readFileSync(__dirname+'/calendar-probe.js','utf8'),{window:win,URL,console:{log(){},info(){},error(){}}});
  assert.throws(()=>win.visaCalendarProbe.start({intervalSeconds:1}));
  win.visaCalendarProbe.start({samples:2});callback();
  assert.equal(cleared,1);
  assert.equal(JSON.parse(win.visaCalendarProbe.exportJSON()).length,3);
});
