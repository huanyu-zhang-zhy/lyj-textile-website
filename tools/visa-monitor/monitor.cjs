'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { capture, analyze, compare } = require('./calendar-probe.js');
const VALID = new Set(['available_dates', 'no_available_dates']);
const ZONE = 'Australia/Melbourne';
const local = value => new Intl.DateTimeFormat('en-AU', { timeZone: ZONE, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23', timeZoneName:'short' }).format(new Date(value));

function config(env = process.env) {
  const month = env.TARGET_MONTH || '2026-11';
  const intervalMs = Number(env.INTERVAL_SECONDS || 60) * 1000;
  const durationMs = Number(env.DURATION_HOURS || 24) * 3600000;
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Invalid TARGET_MONTH');
  if (!Number.isInteger(intervalMs) || intervalMs < 60000 || intervalMs > 3600000) throw new Error('INTERVAL_SECONDS must be 60–3600');
  if (!Number.isFinite(durationMs) || durationMs < 60000 || durationMs > 86400000) throw new Error('DURATION_HOURS must be >0 and <=24');
  return { month, intervalMs, durationMs, enabled: env.MONITOR_ENABLED === 'true', dataDir:path.resolve(env.DATA_DIR || './data'), url:`https://calendly.com/conmel-mofa/visa?month=${month}` };
}

function initialState(c, now = Date.now()) {
  return { version:1, month:c.month, intervalMs:c.intervalMs, durationMs:c.durationMs,
    startedAt:new Date(now).toISOString(), endAt:new Date(now+c.durationMs).toISOString(),
    status:'running', nextCheckAt:now, attempts:0, skipped:0, consecutiveFailures:0, samples:[] };
}
function atomic(file, text) {
  fs.writeFileSync(file+'.tmp', text, { mode:0o600 });
  const fd=fs.openSync(file+'.tmp','r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(file+'.tmp',file);
}
function loadState(c, now = Date.now()) {
  const file=path.join(c.dataDir,'state.json');
  if (!fs.existsSync(file)) return initialState(c,now);
  const s=JSON.parse(fs.readFileSync(file,'utf8'));
  if (s.version!==1 || s.month!==c.month || s.intervalMs!==c.intervalMs || s.durationMs!==c.durationMs || !Array.isArray(s.samples) || !Number.isFinite(Date.parse(s.endAt)) || !Number.isFinite(s.nextCheckAt) || !Number.isInteger(s.attempts)) throw new Error('Persisted run differs from configuration or is invalid; refusing to reset the run');
  return s;
}
function acquireLock(dir) {
  const file=path.join(dir,'monitor.lock');
  let fd;
  try { fd=fs.openSync(file,'wx',0o600); }
  catch(e) {
    if(e.code!=='EEXIST') throw e;
    const pid=Number(fs.readFileSync(file,'utf8'));
    if(!Number.isSafeInteger(pid)||pid<1) throw new Error('Invalid lock; manual inspection required');
    try { process.kill(pid,0); throw new Error('Another monitor is running, or a stale lock PID was reused'); }
    catch(check) { if(check.code!=='ESRCH') throw check; }
    fs.unlinkSync(file); fd=fs.openSync(file,'wx',0o600);
  }
  fs.writeFileSync(fd,String(process.pid));fs.closeSync(fd);
  return ()=>{ if(fs.existsSync(file)&&fs.readFileSync(file,'utf8')===String(process.pid))fs.unlinkSync(file); };
}

function requestPolicy({url,method,type,navigation,mainFrame},target) {
  let u; try {u=new URL(url);} catch {return 'abort';}
  if (!['GET','HEAD'].includes(method)||u.protocol!=='https:') return 'abort';
  if (navigation && (!mainFrame || url!==target)) return 'abort';
  if (!['calendly.com','assets.calendly.com','cdn.cookielaw.org'].includes(u.hostname)) return 'abort';
  if (['image','media','font','websocket','eventsource'].includes(type)) return 'abort';
  if (u.hostname==='calendly.com' && /^\/(?:app|login|signup|invitees|scheduled_events)(?:\/|$)/.test(u.pathname)) return 'abort';
  return 'continue';
}

function report(s, now = Date.now()) {
  const samples=s.samples, events=[], uncertain=[], hourly=Array.from({length:24},(_,hour)=>({hour,checks:0,validChecks:0,discoveries:0}));
  let previousValid=null;
  for (const sample of samples) {
    const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:ZONE,hour:'2-digit',hourCycle:'h23'}).format(new Date(sample.observedAt)));
    hourly[hour].checks++;
    if (!VALID.has(sample.status)) { uncertain.push({startedAt:sample.checkStartedAt,observedAt:sample.observedAt,status:sample.status,reason:sample.reason}); continue; }
    hourly[hour].validChecks++;
    if (previousValid) {
      const delta=compare(previousValid,sample);
      if(delta.addedDates.length) {
        const span=Date.parse(sample.observedAt)-Date.parse(previousValid.checkStartedAt);
        const event={after:previousValid.checkStartedAt,by:sample.observedAt,windowSeconds:Math.ceil(span/1000),addedDates:delta.addedDates,
          hasGap:Date.parse(sample.checkStartedAt)-Date.parse(previousValid.checkStartedAt)>s.intervalMs*1.5};
        events.push(event);hourly[hour].discoveries++;
      }
    }
    previousValid=sample;
  }
  const good=samples.filter(x=>VALID.has(x.status));
  const expected=Math.ceil(s.durationMs/s.intervalMs);
  const finished=s.status==='completed';
  const summary={month:s.month,timezone:ZONE,status:s.status,startedAt:s.startedAt,scheduledEndAt:s.endAt,generatedAt:new Date(now).toISOString(),
    plannedChecks:expected,attempts:s.attempts,recordedChecks:samples.length,validChecks:good.length,validCheckCoveragePercent:Number((100*good.length/expected).toFixed(2)),
    unrecordedAttempts:s.attempts-samples.length,skippedScheduleSlots:s.skipped,initialAvailableDates:good[0]?.availableDates||[],events,uncertain,hourly,
    conclusion:events.length ? `Observed ${events.length} appearance event(s); this does not establish a recurring release schedule.` : good.length ? 'No new available dates observed in valid samples; this does not prove no slots were released.' : 'No valid calendar samples; no release-time inference is possible.'};
  const lines=[`# 韩国签证预约观察报告（${s.month}）`,'',`状态：${s.status}。时区：${ZONE}。`,
    `开始：${local(s.startedAt)}；计划结束：${local(s.endAt)}；生成：${local(now)}。`,
    `计划 ${expected} 次；已尝试 ${s.attempts} 次；已记录 ${samples.length} 次；有效 ${good.length} 次；全计划有效采样比例 ${summary.validCheckCoveragePercent}%。`,
    `跳过的过期计划点：${s.skipped}；未记录完成结果的尝试：${summary.unrecordedAttempts}。`,
    finished?'已到计划截止时间；是否存在中断需结合有效采样比例判断。':'本报告为进行中或提前停止的结果，不是完整 24 小时实测。','',
    '首次有效样本已有的可选日期：'+(summary.initialAvailableDates.join(', ')||'无')+'。这些日期不计为新放号。','',
    '## 新出现可选日期的观察窗口','',...events.map(e=>`- ${local(e.after)} 至 ${local(e.by)}（最多约 ${e.windowSeconds} 秒${e.hasGap?'，含采样间隔缺口':''}）：${e.addedDates.join(', ')}`),
    ...(events.length?[]:['没有观察到新出现的可选日期。']), '', '## 按首次发现小时统计','', '| 墨尔本小时 | 有效检查 | 全部记录 | 新出现事件 |','| --- | ---: | ---: | ---: |',
    ...hourly.map(h=>`| ${String(h.hour).padStart(2,'0')}:00–${String(h.hour).padStart(2,'0')}:59 | ${h.validChecks} | ${h.checks} | ${h.discoveries} |`), '',
    '## 错误与未知状态','',...uncertain.map(x=>`- ${local(x.startedAt)} 至 ${local(x.observedAt)}：${x.status}；${x.reason||'无详情'}`),...(uncertain.length?[]:['无已记录的错误。']), '',
    '## 解释范围','',
    '时间窗口使用上一次有效检查的请求开始时间至本次 DOM 读取时间，不能等同于精确放号时刻。',
    '只监测目标月份的可选日期，不点击日期或时间；同一天内部新增时间段可能漏检。',
    '两次检查间短暂出现又被预约的号源可能漏检。变化可能来自取消预约、人工调整或滚动窗口，无法仅凭页面判定。',
    '一天的数据不能证明固定放号规律；样本不完整或限流时，应明确报告观察缺口。',
    '浏览器标签可能变化；未知结构返回 unknown，不当作无号。',
    '停止采样不会自动暂停 Render 付费服务；需要在控制台暂停服务以停止计算资源费用。',''];
  return {summary,markdown:lines.join('\n')};
}
function persist(c,s) {
  atomic(path.join(c.dataDir,'state.json'),JSON.stringify(s));
  const r=report(s);
  atomic(path.join(c.dataDir,'summary.json'),JSON.stringify(r.summary,null,2));
  atomic(path.join(c.dataDir,'report.md'),r.markdown);
}

async function observe(browser,c,signal) {
  const checkStartedAt=new Date().toISOString();
  const context=await browser.newContext({locale:'en-AU',timezoneId:ZONE,serviceWorkers:'block',acceptDownloads:false});
  let sent=0,denied=0,fatal=null;
  const abort=()=>{void context.close().catch(()=>{});};
  signal.addEventListener('abort',abort,{once:true});
  try {
    await context.routeWebSocket('**/*',ws=>ws.close());
    await context.route('**/*',async route=>{
      const r=route.request();
      const decision=requestPolicy({url:r.url(),method:r.method(),type:r.resourceType(),navigation:r.isNavigationRequest(),mainFrame:r.frame()===r.frame().page().mainFrame()},c.url);
      if(fatal||signal.aborted||decision==='abort'){denied++;await route.abort();return;}
      if(++sent>120){fatal='Per-check request budget exceeded';await route.abort();return;}
      await route.continue();
    });
    context.on('response',r=>{if(new URL(r.url()).hostname==='calendly.com'&&[401,403,429].includes(r.status()))fatal=`First-party HTTP ${r.status()}; no retry`;});
    const page=await context.newPage();
    const res=await page.goto(c.url,{waitUntil:'domcontentloaded',timeout:20000});
    if(res&&res.status()>=400)throw new Error(`Document HTTP ${res.status()}`);
    const until=Math.min(Date.now()+15000,Date.parse(c.endAt||'')||Infinity);
    let raw,result;
    do {
      if(fatal)break;
      if(signal.aborted)throw new Error('Run interrupted or deadline reached');
      raw=await page.evaluate(`(${capture.toString()})(document, location.href)`);
      result=analyze(raw,c.month);
      if(result.status!=='unknown')break;
      await delay(500,undefined,{signal});
    }while(Date.now()<until);
    if(fatal)return {checkStartedAt,observedAt:new Date().toISOString(),month:c.month,status:'blocked',availableDates:[],reason:fatal,requestsSent:sent,requestsBlocked:denied};
    return {checkStartedAt,observedAt:raw?.observedAt||new Date().toISOString(),...result,requestsSent:sent,requestsBlocked:denied,
      ...(result?.status==='unknown'?{dateLabelSample:raw?.days?.slice(0,3),visibleDateCount:raw?.days?.length}:{} )};
  }catch(e){return {checkStartedAt,observedAt:new Date().toISOString(),month:c.month,status:fatal?'blocked':'error',reason:fatal||e.name+': '+e.message.split('\n')[0],availableDates:[],requestsSent:sent,requestsBlocked:denied};}
  finally{signal.removeEventListener('abort',abort);await context.close().catch(()=>{});}
}

async function run(c,{once=false}={}) {
  fs.mkdirSync(c.dataDir,{recursive:true,mode:0o700});
  if(!c.enabled){console.log('MONITOR_DISABLED: no browser launched and no sampling performed');return;}
  const unlock=acquireLock(c.dataDir);
  const controller=new AbortController();
  const onSignal=()=>controller.abort();
  process.once('SIGTERM',onSignal);process.once('SIGINT',onSignal);
  let browser,deadlineTimer,s;
  try{
    s=loadState(c);persist(c,s);
    if(s.status!=='running'){console.log('RUN_ALREADY_TERMINAL',JSON.stringify(report(s).summary));return;}
    if(Date.now()>=Date.parse(s.endAt)){s.status='completed';persist(c,s);return;}
    deadlineTimer=setTimeout(()=>controller.abort(),Math.max(1,Date.parse(s.endAt)-Date.now()));
    const {chromium}=require('playwright');
    // Keep the Chromium sandbox enabled; fail rather than adding --no-sandbox.
    browser=await chromium.launch({headless:true,chromiumSandbox:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined});
    while(!controller.signal.aborted && Date.now()<Date.parse(s.endAt)){
      if(s.attempts>=Math.ceil(s.durationMs/s.intervalMs)){
        await delay(Math.max(1,Date.parse(s.endAt)-Date.now()),undefined,{signal:controller.signal});
        break;
      }
      if(s.nextCheckAt>Date.now())await delay(s.nextCheckAt-Date.now(),undefined,{signal:controller.signal});
      if(controller.signal.aborted||Date.now()>=Date.parse(s.endAt))break;
      const now=Date.now();
      s.skipped+=Math.max(0,Math.floor((now-s.nextCheckAt)/s.intervalMs));
      s.nextCheckAt=now+s.intervalMs;s.attempts++;persist(c,s);
      const sample=await observe(browser,{...c,endAt:s.endAt},controller.signal);
      s.samples.push(sample);
      s.consecutiveFailures=VALID.has(sample.status)?0:s.consecutiveFailures+1;
      if(sample.status==='blocked')s.status='stopped_access_restriction';
      else if(s.consecutiveFailures>=3)s.status='stopped_repeated_failure';
      persist(c,s);console.log('SAMPLE',JSON.stringify(sample));
      if(s.status!=='running'||once)break;
    }
    if(s.status==='running' && Date.now()>=Date.parse(s.endAt))s.status='completed';
    else if(s.status==='running' && !once && controller.signal.aborted)s.lastInterruptionAt=new Date().toISOString();
    persist(c,s);console.log('REPORT',JSON.stringify(report(s).summary));
  }catch(e){
    if(s){
      if(controller.signal.aborted){
        if(Date.now()>=Date.parse(s.endAt))s.status='completed';
        else s.lastInterruptionAt=new Date().toISOString();
      }else{s.lastProcessError=e.name+': '+e.message.split('\n')[0];s.status='stopped_runtime_error';}
      persist(c,s);console.log('REPORT',JSON.stringify(report(s).summary));
    }
    if(!controller.signal.aborted)throw e;
  }finally{
    clearTimeout(deadlineTimer);await browser?.close().catch(()=>{});unlock();
    process.removeListener('SIGTERM',onSignal);process.removeListener('SIGINT',onSignal);
  }
}
module.exports={config,initialState,loadState,requestPolicy,report,persist,run,acquireLock};
if(require.main===module){
  const c=config();
  if(process.argv.includes('--report')){
    const file=path.join(c.dataDir,'state.json');
    if(!fs.existsSync(file))throw new Error('No run state exists');
    console.log(report(loadState(c)).markdown);
  }else{
    run(c,{once:process.argv.includes('--once')}).then(()=>{
      if(process.env.RENDER==='true'&&!process.argv.includes('--once')){
        console.log('IDLE: sampling is disabled or finished. Suspend the Render service to stop compute billing.');
        setInterval(()=>{},3600000);
      }
    }).catch(e=>{console.error(e.name+': '+e.message.split('\n')[0]);process.exitCode=1;});
  }
}
