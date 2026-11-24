import { esc, fmt, today, weekStart, addDays, prettyDate, alive, safeUrl } from './utils.js';
import { epley, weeklyLoads, loadComparison, strengthVolume, compliance } from './coaching.js';

// All charts use recorded observations. Missing observations remain null and
// interrupt a line; neither a scheduled workout nor a missing week becomes zero.
const state={range:8,lift:null,liftVariant:null,volumeWeek:null,testCode:'TS01',testMethod:null,testVersion:null,shotType:'all',handlingCode:'SK01',wellnessMetric:'bodyweightKg'};
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const mean=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
const sum=values=>values.reduce((a,b)=>a+(finite(b)?b:0),0);
const labelDate=date=>date?prettyDate(date,{day:'numeric',month:'short'}):'No date';
const EMPTY='<div class="empty-chart">Your first recorded result will appear here.</div>';
const colours=['#d5f478','#83d7de','#c6b6fa','#eebf7d'];
const shotTypes=['wrist','snap','backhand','slap','one-timer'];
const zones=['topLeft','topRight','bottomLeft','bottomRight','fiveHole'];
const zoneNames={topLeft:'Top left',topRight:'Top right',bottomLeft:'Bottom left',bottomRight:'Bottom right',fiveHole:'Five-hole'};
const wellnessFields={bodyweightKg:['Bodyweight','kg'],sleepHours:['Sleep','hours'],sleepQuality:['Sleep quality','/5'],soreness:['Soreness','/10'],energy:['Energy','/5'],mood:['Mood','/5'],wristPain:['Wrist symptoms','/10'],readinessScore:['Readiness','/100']};
const methodOf=row=>String(row.method||'Method not recorded');
const dateOf=(row,sessions)=>row.date||sessions.get(row.sessionId)?.date||null;
const inRange=(date,start,end)=>typeof date==='string'&&date>=start&&date<=end;
const empty=(title,body)=>'<div class="empty-state"><h3>'+esc(title)+'</h3><p>'+esc(body)+'</p></div>';
const metric=(label,value,caption,unit='')=>'<div class="metric"><div class="metric-label">'+esc(label)+'</div><div class="metric-value">'+esc(value)+(unit?' <span>'+esc(unit)+'</span>':'')+'</div><p class="metric-caption">'+esc(caption)+'</p></div>';
const option=(value,label,selected)=>'<option value="'+esc(value)+'"'+(String(value)===String(selected)?' selected':'')+'>'+esc(label)+'</option>';
const panel=(title,body,subtitle='')=>'<section class="panel progress-panel"><div class="section-header"><div><h2>'+esc(title)+'</h2>'+(subtitle?'<p class="small muted mt-8">'+esc(subtitle)+'</p>':'')+'</div></div>'+body+'</section>';
const field=(label,control)=>'<label>'+esc(label)+control+'</label>';

export function strengthSeries(data,exerciseId,start,end,variant='standard'){
  const sessions=new Map(alive(data.sessions).filter(s=>s.status==='completed').map(s=>[s.id,s]));
  const grouped=new Map();
  for(const row of alive(data.set_logs)){
    const date=dateOf(row,sessions);
    if(row.kind!=='strength'||row.exerciseId!==exerciseId||(row.variant||'standard')!==variant||!sessions.has(row.sessionId)||!inRange(date,start,end))continue;
    const value=epley(row.loadKg,row.reps);
    if(value===null)continue;
    if(!grouped.has(date)||value>grouped.get(date).value)grouped.set(date,{date,label:labelDate(date),value,source:row});
  }
  return [...grouped.values()].sort((a,b)=>a.date.localeCompare(b.date));
}

export function shootingSummary(rows){
  let shots=0,hits=0,accuracyShots=0,invalidAccuracy=0;
  const hitsByZone=Object.fromEntries(zones.map(z=>[z,0]));
  for(const row of rows){
    if(row.kind!=='shooting'||!finite(row.shots)||row.shots<0)continue;
    shots+=row.shots;
    const counts=row.hitsByZone;
    const valid=counts&&zones.every(z=>finite(counts[z])&&counts[z]>=0);
    const rowHits=valid?sum(zones.map(z=>counts[z])):null;
    if(!valid||rowHits>row.shots){invalidAccuracy++;continue;}
    accuracyShots+=row.shots;hits+=rowHits;
    for(const z of zones)hitsByZone[z]+=counts[z];
  }
  return {shots,hits,accuracyShots,accuracy:accuracyShots>0?100*hits/accuracyShots:null,hitsByZone,invalidAccuracy};
}

export function handlingSeries(rows){
  const grouped=new Map();
  for(const row of rows){
    if(row.kind!=='stickhandling'||!row.date||!finite(row.durationSec)||row.durationSec<=0)continue;
    if(!grouped.has(row.date))grouped.set(row.date,{date:row.date,duration:0,touches:0,touchDuration:0,errors:0,errorDuration:0,eyes:[]});
    const g=grouped.get(row.date);g.duration+=row.durationSec;
    if(finite(row.touches)&&row.touches>=0){g.touches+=row.touches;g.touchDuration+=row.durationSec;}
    if(finite(row.errors)&&row.errors>=0){g.errors+=row.errors;g.errorDuration+=row.durationSec;}
    if(finite(row.eyesUpPercent))g.eyes.push(row.eyesUpPercent);
  }
  return [...grouped.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(g=>({...g,label:labelDate(g.date),touchesPerSec:g.touchDuration?g.touches/g.touchDuration:null,errorsPerMinute:g.errorDuration?g.errors/g.errorDuration*60:null,eyesUpPercent:mean(g.eyes)}));
}

function lineChart(series,{unit='',title='Recorded trend',zero=false,ceiling=null}={}){
  const all=series.flatMap(s=>s.points.map(p=>p.value)).filter(finite);
  if(!all.length)return EMPTY;
  const labels=series[0]?.points.map(p=>p.label)||[];
  const count=Math.max(...series.map(s=>s.points.length));
  const W=620,H=220,left=50,right=17,top=18,bottom=41;
  let lo=zero?0:Math.min(...all),hi=ceiling??Math.max(...all);
  const gap=Math.max((hi-lo)*.12,hi===lo?Math.max(1,Math.abs(hi)*.08):.05);
  if(!zero)lo-=gap;if(ceiling===null)hi+=gap;if(hi<=lo)hi=lo+1;
  const x=i=>count<2?(W+left-right)/2:left+i*(W-left-right)/(count-1);
  const y=value=>H-bottom-(value-lo)/(hi-lo)*(H-top-bottom);
  let svg='<svg class="chart-svg progress-line-chart" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(title)+'"><title>'+esc(title)+'</title>';
  for(let i=0;i<4;i++){
    const value=lo+(hi-lo)*i/3,cy=y(value);
    svg+='<line x1="'+left+'" y1="'+cy+'" x2="'+(W-right)+'" y2="'+cy+'" stroke="#2a3942" stroke-width="1"/><text x="'+(left-9)+'" y="'+(cy+4)+'" text-anchor="end" fill="#91a5b1" font-size="11">'+esc(fmt(value,Math.abs(hi-lo)<10?1:0))+'</text>';
  }
  series.forEach((s,si)=>{
    let segments=[],current=[];
    s.points.forEach((p,i)=>{if(finite(p.value))current.push(x(i)+','+y(p.value));else if(current.length){segments.push(current);current=[];}});if(current.length)segments.push(current);
    const colour=s.colour||colours[si%colours.length];
    for(const segment of segments)if(segment.length>1)svg+='<polyline points="'+segment.join(' ')+'" fill="none" stroke="'+colour+'" stroke-width="2.5" stroke-linejoin="round"'+(si?' stroke-dasharray="5 4"':'')+'/>';
    s.points.forEach((p,i)=>{if(finite(p.value))svg+='<circle cx="'+x(i)+'" cy="'+y(p.value)+'" r="3.5" fill="'+colour+'"><title>'+esc(p.label+': '+fmt(p.value,2)+' '+unit)+'</title></circle>';});
  });
  const ticks=[...new Set([0,Math.floor((count-1)/2),count-1])];
  for(const i of ticks)if(labels[i])svg+='<text x="'+x(i)+'" y="'+(H-15)+'" text-anchor="'+(i===0?'start':i===count-1?'end':'middle')+'" fill="#91a5b1" font-size="11">'+esc(labels[i])+'</text>';
  svg+='</svg><div class="progress-chart-key">'+series.map((s,i)=>'<span><i style="background:'+(s.colour||colours[i%colours.length])+'"></i>'+esc(s.name)+'</span>').join('')+'</div>';
  svg+='<details class="progress-chart-data"><summary>View recorded values</summary><div class="scroll-table"><table><thead><tr><th>Date / week</th>'+series.map(s=>'<th>'+esc(s.name)+(unit?' ('+esc(unit)+')':'')+'</th>').join('')+'</tr></thead><tbody>'+Array.from({length:count},(_,i)=>'<tr><td>'+esc(labels[i]||'')+'</td>'+series.map(s=>'<td>'+(finite(s.points[i]?.value)?esc(fmt(s.points[i].value,2)):'Not logged')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div></details>';
  return svg;
}

function movementBars(values){
  const entries=Object.entries(values).filter(([,v])=>finite(v)&&v>=0).sort((a,b)=>b[1]-a[1]);
  if(!entries.length)return empty('No completed strength volume yet','Log working sets and complete the session to see external volume by movement pattern.');
  const max=Math.max(...entries.map(([,v])=>v),1);
  return entries.map(([name,value])=>'<div class="movement-row"><span>'+esc(name)+'</span><div class="progress-track"><span style="width:'+(value/max*100)+'%"></span></div><span class="numeric">'+esc(fmt(value))+' kg</span></div>').join('');
}

function complianceTable(data,weekRows,anchor){
  return '<div class="scroll-table"><table><thead><tr><th>Week beginning</th><th>Completed</th><th>Planned</th><th>Skipped</th><th>Completion</th></tr></thead><tbody>'+weekRows.map(w=>{
    const c=compliance(data,w.date,w.end),future=w.date>anchor;
    return '<tr><td>'+esc(labelDate(w.date))+'</td><td>'+c.completed+'</td><td>'+c.planned+'</td><td>'+c.skipped+'</td><td>'+(c.planned&&!future?fmt(c.completed/c.planned*100)+'%':'No planned sessions')+'</td></tr>';
  }).join('')+'</tbody></table></div>';
}

function testPanel(ctx,start,end){
  const protocols=ctx.data.testProtocols||[];
  if(!protocols.length)return panel('Tests and personal benchmarks',empty('Protocols are not loaded','Reload the programme data before recording a test.'));
  if(!protocols.some(p=>p.code===state.testCode))state.testCode=protocols[0].code;
  const protocol=protocols.find(p=>p.code===state.testCode);
  const all=alive(ctx.data.test_results).filter(r=>r.testCode===state.testCode&&inRange(r.date,start,end)).sort((a,b)=>a.date.localeCompare(b.date));
  const versions=[...new Set(all.map(r=>String(r.protocolVersion||1)))].sort((a,b)=>Number(a)-Number(b));
  if(!versions.includes(state.testVersion))state.testVersion=versions.at(-1)||String(protocol.protocolVersion||1);
  const versionRows=all.filter(r=>String(r.protocolVersion||1)===state.testVersion);
  const methods=[...new Set(versionRows.map(methodOf))];
  if(!methods.includes(state.testMethod))state.testMethod=methods.at(-1)||null;
  const comparable=versionRows.filter(r=>methodOf(r)===state.testMethod&&r.unit===protocol.unit);
  const points=comparable.map(r=>({date:r.date,label:labelDate(r.date),value:finite(r.value)&&methodOf(r)!=='Method not recorded'?r.value:null}));
  const benchmarks=(protocol.benchmarks||[]).filter(b=>b.sourceUrl);
  const references=benchmarks.length?'<div class="progress-references">'+benchmarks.map(b=>'<div class="progress-reference"><strong>'+esc(b.label)+'</strong><p class="small">'+esc(b.value!=null?fmt(b.value,2)+' '+b.unit:b.min!=null?fmt(b.min,2)+' to '+fmt(b.max,2)+' '+b.unit:'See source')+'</p><p class="tiny muted">'+esc(b.note||'')+'</p><span class="badge">'+(b.protocolMatch===true?'Protocol-matched reference':'Context only: protocol differs')+'</span>'+(safeUrl(b.sourceUrl)?'<a class="tiny" href="'+esc(safeUrl(b.sourceUrl))+'" target="_blank" rel="noreferrer">Read source</a>':'')+'</div>').join('')+'</div>':'<p class="risk-note mt-16">Personal baseline only. No universal amateur-to-professional cutoff is assigned to this test.</p>';
  const rows=all.slice().reverse().slice(0,20);
  return panel('Tests and personal benchmarks','<div class="filters">'+field('Test','<select id="progress-test">'+protocols.map(p=>option(p.code,p.code+' · '+p.name,state.testCode)).join('')+'</select>')+(versions.length?field('Protocol version','<select id="progress-test-version">'+versions.map(v=>option(v,'Version '+v,state.testVersion)).join('')+'</select>'):'')+(methods.length?field('Measurement method','<select id="progress-test-method">'+methods.map(m=>option(m,m,state.testMethod)).join('')+'</select>'):'')+'<button class="btn btn-primary" data-add-test>Record a test</button></div>'+lineChart([{name:protocol.name,points}],{unit:protocol.unit,title:protocol.name+' history'})+'<p class="risk-note mt-16">Only results using the selected method, unit and protocol version share a line. A repeated label cannot verify that the setup was identical. Published cohorts below are contextual unless their full protocol matches yours.</p><details class="progress-detail"><summary>Exact test protocol and precautions</summary><ol>'+protocol.protocol.map(p=>'<li>'+esc(p)+'</li>').join('')+'</ol><ul>'+protocol.precautions.map(p=>'<li>'+esc(p)+'</li>').join('')+'</ul></details>'+references+(rows.length?'<div class="scroll-table mt-16"><table><thead><tr><th>Date</th><th>Result</th><th>Method</th><th></th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(labelDate(r.date))+'</td><td>'+(finite(r.value)?esc(fmt(r.value,2)+' '+r.unit):'Not measured')+'</td><td>'+esc(methodOf(r))+'<br><small>Protocol version '+esc(r.protocolVersion||1)+'</small>'+((r.protocolConfirmed||r.protocolMatched)?'':'<br><small>Protocol not confirmed</small>')+'</td><td><button class="btn btn-secondary progress-small-btn" data-edit-test="'+esc(r.id)+'">Edit</button></td></tr>').join('')+'</tbody></table></div>':''),'Repeatable protocols, with honest limits on comparisons.');
}

export function renderProgress(ctx){
  const data=ctx.data,anchor=ctx.date||today(),currentWeek=weekStart(anchor),start=addDays(currentWeek,-7*(state.range-1));
  const allExercises=alive(data.exercises),exMap=new Map(allExercises.map(e=>[e.id,e]));
  const sessions=new Map(alive(data.sessions).map(s=>[s.id,s]));
  const weekRows=weeklyLoads(data.sessions,anchor,state.range),comparison=loadComparison(weekRows);
  const currentCompliance=compliance(data,currentWeek,anchor);
  const currentLoad=weekRows.at(-1);
  const wellness=alive(data.wellness_logs).filter(w=>inRange(w.date,start,anchor)).sort((a,b)=>a.date.localeCompare(b.date));
  const latestWeight=wellness.filter(w=>finite(w.bodyweightKg)).at(-1);
  const latestReadiness=wellness.filter(w=>finite(w.readinessScore)).at(-1);
  const liftCodes=['ST01','ST02','ST03','ST04','ST05','ST07','ST09','ST10','ST11','ST12'];
  const lifts=allExercises.filter(e=>liftCodes.includes(e.code));
  if(!lifts.some(e=>e.id===state.lift))state.lift=lifts[0]?.id||null;
  const liftVariants=[...new Set(alive(data.set_logs).filter(r=>r.exerciseId===state.lift&&r.kind==='strength'&&sessions.get(r.sessionId)?.status==='completed').map(r=>r.variant||'standard'))].sort();
  if(!liftVariants.length)liftVariants.push('standard');
  if(!liftVariants.includes(state.liftVariant))state.liftVariant=liftVariants[0];
  const lift=exMap.get(state.lift),liftPoints=strengthSeries(data,state.lift,start,anchor,state.liftVariant);
  if(!weekRows.some(w=>w.date===state.volumeWeek))state.volumeWeek=currentWeek;
  const volume=strengthVolume(data,state.volumeWeek,addDays(state.volumeWeek,6)<anchor?addDays(state.volumeWeek,6):anchor);
  const volumeWeekly=weekRows.map(w=>{const v=strengthVolume(data,w.date,w.end<anchor?w.end:anchor);return {label:labelDate(w.date),value:Object.keys(v).length?sum(Object.values(v)):null};});
  const loadPoints=weekRows.map(w=>({label:labelDate(w.date),value:w.load}));
  const chronicPoints=weekRows.map((w,i)=>{const prior=weekRows.slice(i-4,i);return {label:labelDate(w.date),value:prior.length===4&&prior.every(p=>p.load!==null&&!p.incomplete)?mean(prior.map(p=>p.load)):null};});
  const skillRows=alive(data.skill_logs).map(r=>({...r,date:dateOf(r,sessions)})).filter(r=>inRange(r.date,start,anchor));
  const shots=skillRows.filter(r=>r.kind==='shooting'&&(state.shotType==='all'||r.shotType===state.shotType));
  const shotSummary=shootingSummary(shots);
  const shotWeeks=weekRows.map(w=>{const rows=shots.filter(r=>inRange(r.date,w.date,w.end));const s=shootingSummary(rows);return {label:labelDate(w.date),volume:rows.length?s.shots:null,accuracy:s.accuracy};});
  const handleExercises=allExercises.filter(e=>/^SK\d/.test(e.code));
  const handlingExercise=handleExercises.find(e=>e.code===state.handlingCode);
  const handling=handlingSeries(skillRows.filter(r=>r.exerciseId===handlingExercise?.id));
  const lastHandling=handling.at(-1);
  const [wellnessName,wellnessUnit]=wellnessFields[state.wellnessMetric];
  const records=alive(data.personal_records).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const phaseRows=alive(data.phases).sort((a,b)=>a.startWeek-b.startWeek).map(phase=>{
    const phaseWeeks=alive(data.weeks).filter(w=>w.phaseId===phase.id).sort((a,b)=>a.number-b.number);
    const first=phase.startDate||phaseWeeks[0]?.startDate,last=phase.endDate||phaseWeeks.at(-1)?.endDate;
    if(!first)return null;
    const c=first>anchor?null:compliance(data,first,last<anchor?last:anchor);
    return {phase,c,first,last};
  }).filter(Boolean);

  let html='<div class="progress-view"><style>.progress-view .progress-panel{margin-bottom:22px}.progress-view .filters label{min-width:160px;flex:1}.progress-view .filters select{max-width:none;width:100%}.progress-view .filters>.btn{align-self:end}.progress-line-chart{height:auto!important;min-height:150px;max-height:250px}.progress-chart-key{display:flex;gap:17px;flex-wrap:wrap;margin:9px 0;font-size:.75rem;color:var(--muted)}.progress-chart-key span{display:flex;gap:7px;align-items:center}.progress-chart-key i{display:inline-block;width:9px;height:9px;border-radius:50%}.progress-chart-data,.progress-detail{margin-top:15px;font-size:.8125rem;color:var(--muted)}.progress-chart-data summary,.progress-detail summary{cursor:pointer;min-height:44px;padding:10px 0}.progress-detail ol,.progress-detail ul{padding-left:22px;line-height:1.65}.progress-detail li{margin:7px 0}.progress-references{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin-top:15px}.progress-reference{border:1px solid var(--line);border-radius:10px;padding:14px;background:#101a21}.progress-reference strong{font-size:.8125rem}.progress-reference .badge{margin:10px 8px 0 0}.progress-reference p{margin-top:7px}.progress-small-btn{min-height:36px;padding:6px 10px;font-size:.75rem}.progress-submetrics{display:flex;gap:24px;flex-wrap:wrap;margin:18px 0}.progress-submetrics strong{font:1.4rem var(--mono);display:block;color:var(--text)}.progress-submetrics small{display:block;color:var(--muted);margin-top:4px}.progress-section-title{font-size:1rem;margin:23px 0 10px}.progress-view .grid-2{align-items:start}.progress-view td{vertical-align:top}.progress-view .movement-row{grid-template-columns:125px 1fr 82px}@media(max-width:760px){.progress-view .filters label{min-width:100%;}.progress-view .movement-row{grid-template-columns:100px 1fr 76px}.progress-view .progress-submetrics{gap:18px}.progress-line-chart{min-height:130px}}</style>';
  html+='<div class="page-heading"><div><p class="eyebrow">Your training, measured</p><h1>Progress</h1><p>Real sessions. Comparable tests. No invented history.</p></div>'+field('History window','<select id="progress-range">'+[8,12,26,52].map(v=>option(v,'Last '+v+' weeks',state.range)).join('')+'</select>')+'</div>';
  html+='<div class="grid-4 mb-24">'+metric('Completed this week',currentCompliance.completed+'/'+currentCompliance.planned,'Required entries scheduled through '+labelDate(anchor))+metric('Current week load',currentLoad.load===null?'Not logged':fmt(currentLoad.load),'Actual minutes × session RPE','AU')+metric('Latest bodyweight',latestWeight?fmt(latestWeight.bodyweightKg,1):'Not logged',latestWeight?labelDate(latestWeight.date):'Optional morning measurement','kg')+metric('Latest readiness',latestReadiness?fmt(latestReadiness.readinessScore):'Not logged',latestReadiness?labelDate(latestReadiness.date)+' · coaching heuristic':'Complete a wellness check-in','/100')+'</div>';
  html+='<div class="grid-2">'+panel('Estimated strength trend','<div class="filters">'+field('Main lift','<select id="progress-lift">'+lifts.map(e=>option(e.id,e.name,state.lift)).join('')+'</select>')+field('Equipment / variant','<select id="progress-lift-variant">'+liftVariants.map(v=>option(v,v==='standard'?'Standard recorded setup':v,state.liftVariant)).join('')+'</select>')+'</div>'+lineChart([{name:'Estimated 1RM',points:liftPoints}],{unit:'kg',title:(lift?.name||'Lift')+' estimated 1RM'})+'<p class="risk-note mt-16"><strong>Epley:</strong> kg × (1 + repetitions / 30), using sets of 1 to 10 repetitions. A submaximal set does not measure a true maximum. Only logged strength sets from completed sessions using the selected equipment variant are included.</p><p class="risk-note mt-8">'+esc(lift?.loadConvention||'Record the exercise variant and load convention consistently.')+'</p>')+panel('Weekly external strength volume',lineChart([{name:'Completed-session volume',points:volumeWeekly}],{unit:'kg',title:'Weekly external strength volume',zero:true})+'<div class="filters mt-16">'+field('Movement breakdown for week','<select id="progress-volume-week">'+weekRows.slice().reverse().map(w=>option(w.date,labelDate(w.date),state.volumeWeek)).join('')+'</select>')+'</div>'+movementBars(volume)+'<p class="risk-note mt-16">Sum of completed repetitions × external kg. Dumbbell floor press uses both dumbbells. Different machines and movements are not equivalent measures of force or training stress.</p>')+'</div>';
  html+=panel('Actual training load',lineChart([{name:'Weekly session-RPE load',points:loadPoints},{name:'Prior four-week mean',points:chronicPoints}],{unit:'AU',title:'Weekly training load and preceding four-week average',zero:true})+'<div class="progress-submetrics"><div><strong>'+esc(comparison.chronic===null?'Not available':fmt(comparison.chronic))+'</strong><small>Prior four-week mean</small></div><div><strong>'+esc(comparison.ratio===null?'Not available':fmt(comparison.ratio,2))+'</strong><small>Current partial week / prior mean</small></div><div><strong>'+weekRows.reduce((a,w)=>a+w.incomplete,0)+'</strong><small>Completed sessions missing load fields</small></div></div><p class="notice'+(comparison.ratio>1.3?' amber':'')+'">'+esc(comparison.message)+'</p><p class="risk-note mt-16">Log ice and roller hockey too. A week with no recorded duration and RPE is missing, not zero. This chart cannot establish that every training exposure was logged. No ratio is a proven safe zone or injury probability.</p>','The current week is partial and may still be accumulating.');
  html+=testPanel(ctx,start,anchor);
  html+=panel('Shooting: volume and accuracy','<div class="filters">'+field('Shot type','<select id="progress-shot-type">'+option('all','All actual shot types',state.shotType)+shotTypes.map(v=>option(v,v,state.shotType)).join('')+'</select>')+'</div><div class="progress-submetrics"><div><strong>'+fmt(shotSummary.shots)+'</strong><small>Actual shots recorded</small></div><div><strong>'+(shotSummary.accuracy===null?'Not logged':fmt(shotSummary.accuracy,1)+'%')+'</strong><small>Intended-target hits / valid attempts</small></div><div><strong>'+fmt(shotSummary.hits)+'</strong><small>Hits across five target zones</small></div></div><div class="grid-2"><div>'+lineChart([{name:'Actual shot volume',points:shotWeeks.map(w=>({label:w.label,value:w.volume}))}],{unit:'shots',title:'Weekly actual shot volume',zero:true})+'</div><div>'+lineChart([{name:'Target accuracy',points:shotWeeks.map(w=>({label:w.label,value:w.accuracy}))}],{unit:'%',title:'Weekly weighted shooting accuracy',zero:true,ceiling:100})+'</div></div><div class="scroll-table mt-16"><table><thead><tr><th>Shot type</th><th>Attempts</th><th>Accuracy</th><th>Best measured speed</th><th>Fastest recorded release</th></tr></thead><tbody>'+shotTypes.map(type=>{
    const r=skillRows.filter(r=>r.kind==='shooting'&&r.shotType===type),s=shootingSummary(r),speeds=r.map(r=>r.shotSpeedKmh).filter(finite),releases=r.map(r=>r.releaseTimeSec).filter(v=>finite(v)&&v>0);
    return '<tr><td>'+esc(type)+'</td><td>'+s.shots+'</td><td>'+(s.accuracy===null?'Not logged':fmt(s.accuracy,1)+'%')+'</td><td>'+(speeds.length?fmt(Math.max(...speeds),1)+' km/h':'Not measured')+'</td><td>'+(releases.length?fmt(Math.min(...releases),3)+' s':'Not measured')+'</td></tr>';
  }).join('')+'</tbody></table></div><div class="progress-submetrics">'+zones.map(z=>'<div><strong>'+shotSummary.hitsByZone[z]+'</strong><small>'+esc(zoneNames[z])+' hits</small></div>').join('')+'</div><p class="risk-note">Accuracy is weighted by actual attempts. Keep target dimensions, distance, shot type, puck, stick and surface consistent. Zone counts are hits, not zone-specific accuracy because attempts per zone are not recorded here. Dry rehearsals are excluded.</p>'+(shotSummary.invalidAccuracy?'<p class="notice amber mt-16">'+shotSummary.invalidAccuracy+' record(s) have missing or inconsistent hit counts. Their shot volume remains visible, but they are excluded from accuracy.</p>':''));
  html+=panel('Stickhandling quality','<div class="filters">'+field('Same drill comparison','<select id="progress-handling">'+handleExercises.map(e=>option(e.code,e.name,state.handlingCode)).join('')+'</select>')+'</div><div class="progress-submetrics"><div><strong>'+(finite(lastHandling?.touchesPerSec)?fmt(lastHandling.touchesPerSec,2):'Not logged')+'</strong><small>Latest contacts per second</small></div><div><strong>'+(finite(lastHandling?.errorsPerMinute)?fmt(lastHandling.errorsPerMinute,1):'Not logged')+'</strong><small>Latest errors per minute</small></div><div><strong>'+(finite(lastHandling?.eyesUpPercent)?fmt(lastHandling.eyesUpPercent)+'%':'Not logged')+'</strong><small>Latest estimated eyes-up / cue score</small></div></div><div class="grid-2"><div>'+lineChart([{name:'Contacts per second',points:handling.map(h=>({label:h.label,value:h.touchesPerSec}))}],{unit:'/s',title:'Duration-normalised handling rate',zero:true})+'</div><div>'+lineChart([{name:'Estimated eyes-up percentage',points:handling.map(h=>({label:h.label,value:h.eyesUpPercent}))}],{unit:'%',title:'Estimated eyes-up handling quality',zero:true,ceiling:100})+'</div></div><p class="risk-note">Duration-normalised rates allow 20-second and 30-second bouts to be described consistently; they do not make different drills, surfaces or effort levels equivalent. Use the same object and layout. Faster touches accompanied by more errors or wrist symptoms are not a successful progression. Eyes-up estimates are not eye-tracking measurements.</p>');
  html+=panel('Bodyweight and wellness','<div class="filters">'+field('Trend','<select id="progress-wellness">'+Object.entries(wellnessFields).map(([key,[label]])=>option(key,label,state.wellnessMetric)).join('')+'</select>')+'</div>'+lineChart([{name:wellnessName,points:wellness.map(w=>({label:labelDate(w.date),value:finite(w[state.wellnessMetric])?w[state.wellnessMetric]:null}))}],{unit:wellnessUnit,title:wellnessName+' trend',zero:!['bodyweightKg','sleepHours'].includes(state.wellnessMetric)})+(wellness.length?'<div class="scroll-table mt-16"><table><thead><tr><th>Date</th><th>Sleep</th><th>Energy /5</th><th>Soreness /10</th><th>Mood /5</th><th>Weight</th><th>Wrist /10</th></tr></thead><tbody>'+wellness.slice(-14).reverse().map(w=>'<tr><td>'+esc(labelDate(w.date))+'</td>'+[w.sleepHours,w.energy,w.soreness,w.mood,w.bodyweightKg,w.wristPain].map(v=>'<td>'+(finite(v)?fmt(v,1):'Not logged')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>':'')+'<p class="risk-note mt-16">Readiness is a coaching heuristic based on your check-in, not a medical assessment. Bodyweight is not used to penalise readiness. Persistent grip loss or worsening symptoms overrides a favourable score.</p>');
  html+='<div class="grid-2">'+panel('Personal records',records.length?records.map(r=>{
    const e=exMap.get(r.exerciseId),p=(data.testProtocols||[]).find(p=>p.code===r.testCode),name=r.title||p?.name||e?.name||r.type||'Recorded result';
    return '<div class="pr-item"><div><h3>'+esc(name)+'</h3><p>'+esc(labelDate(r.date))+(r.type==='e1rm'?' · estimated 1RM':'')+(r.variant?' · '+esc(r.variant):'')+(r.method?' · '+esc(r.method):'')+(r.type==='test'?' · protocol '+esc(r.protocolVersion||1):'')+'</p>'+(r.type==='e1rm'&&e?.loadConvention?'<p class="tiny muted mt-8">'+esc(e.loadConvention)+'</p>':'')+'</div><div class="value">'+esc(fmt(r.value,2))+' '+esc(r.unit||'')+'</div></div>';
  }).join(''):empty('Your first records are ahead','Completed strength sessions and recorded comparable tests create personal bests. No example records are seeded.'))+panel('Completion by phase','<div class="scroll-table"><table><thead><tr><th>Phase</th><th>Completed / due</th><th>Progress</th></tr></thead><tbody>'+phaseRows.map(({phase,c})=>'<tr><td>'+esc(phase.name)+'</td><td>'+(c?c.completed+' / '+c.planned:'Upcoming')+'</td><td>'+(c&&c.planned?fmt(c.completed/c.planned*100)+'%':c?'No entries due':'Not started')+'</td></tr>').join('')+'</tbody></table></div><p class="risk-note mt-16">Phase completion counts required planned entries due through the selected date. Future sessions, optional work and extra sessions do not lower this percentage.</p>')+'</div>';
  html+=panel('Weekly completion',complianceTable(data,weekRows,anchor)+'<p class="risk-note mt-16">Weekly rows show the whole planned week, including future days in the current week. Optional and extra sessions are excluded from the denominator. Skipping a session is recorded honestly and does not create a completed workout.</p>');
  return html+'</div>';
}

export async function updateTestRecord(ctx,result,oldResult=null){
  const saved=await ctx.save('test_results',result);
  const updated=alive(ctx.data.test_results).filter(r=>r.id!==saved.id);
  if(!saved.deleted)updated.push(saved);
  const groups=new Map();
  for(const row of [saved,oldResult].filter(Boolean))groups.set(row.testCode+'|'+methodOf(row)+'|'+(row.protocolVersion||1),row);
  for(const row of groups.values()){
    const protocol=(ctx.data.testProtocols||[]).find(p=>p.code===row.testCode);if(!protocol)continue;
    const existing=alive(ctx.data.personal_records).find(r=>r.type==='test'&&r.testCode===row.testCode&&methodOf(r)===methodOf(row)&&(r.protocolVersion||1)===(row.protocolVersion||1));
    const matches=updated.filter(r=>r.testCode===row.testCode&&methodOf(r)===methodOf(row)&&r.unit===protocol.unit&&(r.protocolVersion||1)===(row.protocolVersion||1)&&finite(r.value));
    if(!matches.length){if(existing)await ctx.save('personal_records',{...existing,deleted:true});continue;}
    const best=matches.reduce((a,b)=>protocol.better==='lower'?(b.value<a.value?b:a):(b.value>a.value?b:a));
    await ctx.save('personal_records',{...(existing||{}),type:'test',testCode:row.testCode,exerciseId:protocol.exerciseId,testResultId:best.id,value:best.value,unit:best.unit,date:best.date,method:methodOf(best),protocolVersion:best.protocolVersion||1,title:protocol.name,deleted:false});
  }
  return saved;
}

export function openTestModal(ctx,existing=null,testCode=null){
  const protocols=ctx.data.testProtocols||[];
  let selected=protocols.find(p=>p.code===(testCode||existing?.testCode||state.testCode))||protocols[0];if(!selected)return;
  const body='<form id="progress-test-form"><div class="form-grid">'+field('Test','<select name="testCode" id="test-code">'+protocols.map(p=>option(p.code,p.code+' · '+p.name,selected.code)).join('')+'</select>')+field('Date','<input name="date" type="date" required value="'+esc(existing?.date||ctx.date||today())+'">')+field('Measured result','<input name="value" type="number" inputmode="decimal" min="0" step="any" value="'+esc(existing?.value??'')+'" required>')+field('Attempts, optional','<input name="attempts" placeholder="For example: 224, 228, 226" value="'+esc(existing?.attempts?.join(', ')||'')+'">')+'<label class="full">Measurement method and setup<input name="method" required maxlength="300" placeholder="Device, start rule, surface, grip or equipment variant" value="'+esc(existing?.method||'')+'"></label><label class="full">Notes<textarea name="notes" rows="3" placeholder="Conditions, symptoms, target dimensions or changes to the protocol">'+esc(existing?.notes||'')+'</textarea></label><label class="check-row full"><input type="checkbox" name="protocolConfirmed"'+((existing?.protocolConfirmed||existing?.protocolMatched)?' checked':'')+'>I followed the displayed personal protocol.</label><label class="check-row full" id="test-clearance-row"><input type="checkbox" name="clearance"'+(existing?.clinicianCleared?' checked':'')+'>Clinician clearance was obtained for this wrist-sensitive assessment.</label></div><div id="test-protocol-detail" class="mt-16"></div><p class="form-help">Record only actual measurements. Different methods are shown as separate trend lines. This form does not compare a personal method with NHL results automatically.</p><div class="form-actions">'+(existing?'<button type="button" class="btn btn-secondary" id="delete-test-result">Delete this result</button>':'')+'<button class="btn btn-primary" type="submit">Save result</button></div></form>';
  ctx.modal(existing?'Edit test result':'Record a test',body,'Keep the protocol and measurement method consistent.');
  const form=document.getElementById('progress-test-form');
  function updateProtocol(){
    selected=protocols.find(p=>p.code===form.elements.testCode.value)||selected;
    const clearance=document.getElementById('test-clearance-row');
    clearance.hidden=!selected.requiresClinicianClearance;clearance.classList.toggle('hidden',!selected.requiresClinicianClearance);form.elements.clearance.required=!!selected.requiresClinicianClearance;
    const valueLabel=form.elements.value.closest('label');valueLabel.childNodes[0].textContent='Measured result ('+selected.unit+')';
    form.elements.value.max=selected.unit==='%'?'100':'';
    document.getElementById('test-protocol-detail').innerHTML='<details class="progress-detail" open><summary>'+esc(selected.name)+' protocol</summary><ol>'+selected.protocol.map(p=>'<li>'+esc(p)+'</li>').join('')+'</ol>'+((selected.requiresClinicianClearance)?'<p class="notice amber">'+esc(selected.precautions.find(p=>/wrist|ECU|clearance/i.test(p))||'This test requires individual review before assessment.')+'</p>':'')+'</details>';
  }
  form.elements.testCode.addEventListener('change',updateProtocol);updateProtocol();
  form.addEventListener('submit',async event=>{
    event.preventDefault();const submit=form.querySelector('[type="submit"]');submit.disabled=true;
    try{
      const f=new FormData(form),value=Number(f.get('value')),method=String(f.get('method')||'').trim();
      if(!Number.isFinite(value)||value<0||(selected.unit==='%'&&value>100))throw new Error('Enter a valid measured result.');
      if(!method)throw new Error('Record the measurement method so future results can be compared.');
      const attemptsText=String(f.get('attempts')||'').trim(),attempts=attemptsText?attemptsText.split(',').map(v=>Number(v.trim())):[];
      if(attempts.some(v=>!Number.isFinite(v)||v<0||(selected.unit==='%'&&v>100)))throw new Error('Separate valid attempt values with commas; percentages must be between 0 and 100.');
      if(selected.requiresClinicianClearance&&!f.has('clearance'))throw new Error('This assessment requires individual clinician clearance.');
      const result={...(existing||{}),testCode:selected.code,exerciseId:selected.exerciseId,date:String(f.get('date')),value,unit:selected.unit,method,notes:String(f.get('notes')||''),attempts,protocolVersion:selected.protocolVersion||1,protocolConfirmed:f.has('protocolConfirmed'),clinicianCleared:f.has('clearance'),deleted:false};
      if(ctx.sessionId)result.sessionId=ctx.sessionId;
      await updateTestRecord(ctx,result,existing);state.testCode=selected.code;state.testMethod=method;ctx.closeModal();ctx.toast('Test result saved on this device.');await ctx.refresh();
    }catch(error){ctx.toast(error.message||'Could not save the result.','error');submit.disabled=false;}
  });
  document.getElementById('delete-test-result')?.addEventListener('click',()=>{
    ctx.modal('Delete this test result?','<p>The result will be marked deleted and removed from its trend. Its personal record will be recalculated from the remaining results.</p><div class="form-actions"><button class="btn btn-secondary" id="keep-test-result">Keep result</button><button class="btn btn-primary" id="confirm-delete-test">Delete result</button></div>','This change is included in your next sync.');
    document.getElementById('keep-test-result').addEventListener('click',()=>openTestModal(ctx,existing));
    document.getElementById('confirm-delete-test').addEventListener('click',async event=>{event.currentTarget.disabled=true;try{await updateTestRecord(ctx,{...existing,deleted:true},existing);ctx.closeModal();ctx.toast('Test result deleted.');await ctx.refresh();}catch(error){ctx.toast(error.message,'error');event.currentTarget.disabled=false;}});
  });
}

export function bindProgress(ctx){
  const root=document.querySelector('.progress-view');if(!root)return;
  const mappings={'progress-range':['range',Number],'progress-lift':['lift',String],'progress-lift-variant':['liftVariant',String],'progress-volume-week':['volumeWeek',String],'progress-test':['testCode',String],'progress-test-method':['testMethod',String],'progress-test-version':['testVersion',String],'progress-shot-type':['shotType',String],'progress-handling':['handlingCode',String],'progress-wellness':['wellnessMetric',String]};
  for(const [id,[key,convert]] of Object.entries(mappings))root.querySelector('#'+id)?.addEventListener('change',async event=>{state[key]=convert(event.target.value);if(key==='testCode'){state.testMethod=null;state.testVersion=null;}if(key==='testVersion')state.testMethod=null;if(key==='lift')state.liftVariant=null;await ctx.refresh();});
  root.querySelectorAll('[data-add-test]').forEach(button=>button.addEventListener('click',()=>openTestModal(ctx)));
  root.querySelectorAll('[data-edit-test]').forEach(button=>button.addEventListener('click',()=>{const row=alive(ctx.data.test_results).find(r=>r.id===button.dataset.editTest);if(row)openTestModal(ctx,row);}));
}
