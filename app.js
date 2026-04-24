// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CLIENT_ID  = '1032987809909-jo6c8a1sgncp4si85dhavbm96idr08cc.apps.googleusercontent.com';
const SCOPES     = 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/tasks';
const SHEET_ID   = '1909BqpI0IUDqYbFKPFyh2TDc99f1nUMuAgpp8MhXhrg';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const DAYS   = ['mon','tue','wed','thu','fri','sat','sun'];
const DNAMES = {mon:'Monday',tue:'Tuesday',wed:'Wednesday',thu:'Thursday',fri:'Friday',sat:'Saturday',sun:'Sunday'};
const JS2IDX = {0:6,1:0,2:1,3:2,4:3,5:4,6:5};
const Q_START = new Date('2026-04-01');
const Q_END   = new Date('2026-06-30');

// ─── STATE ────────────────────────────────────────────────────────────────────
let activeDay     = null;
let accessToken   = null;
let tokenClient   = null;

// ─── STORAGE ──────────────────────────────────────────────────────────────────
const TK = 'gps_token';

// ── Goals storage keys ──
const GK_HEALTH  = 'gps_goals_health';
const GK_MONEY   = 'gps_goals_money';
const GK_FAITH   = 'gps_goals_faith';
const GK_TARGETS = 'gps_goals_targets';
const DEFAULT_TARGETS = {health:68, savings:2500, gold:300, faith:90};
const GK_CUSTOM_DEFS = 'gps_goals_custom';
const GK_CUSTOM_LOGS = 'gps_goals_custom_logs';
function getCustomGoals(){try{return JSON.parse(localStorage.getItem(GK_CUSTOM_DEFS)||'[]');}catch{return[];}}
function saveCustomGoals(g){localStorage.setItem(GK_CUSTOM_DEFS,JSON.stringify(g));}
function getCustomLogs(){try{return JSON.parse(localStorage.getItem(GK_CUSTOM_LOGS)||'{}');}catch{return{};}}
function saveCustomLogs(l){localStorage.setItem(GK_CUSTOM_LOGS,JSON.stringify(l));}

function getGoalsTargets(){try{return {...DEFAULT_TARGETS,...JSON.parse(localStorage.getItem(GK_TARGETS)||'{}')};}catch{return{...DEFAULT_TARGETS};}}
function saveGoalsTargets(t){localStorage.setItem(GK_TARGETS,JSON.stringify(t));}
function getGoalsHealth(){try{return JSON.parse(localStorage.getItem(GK_HEALTH)||'[]');}catch{return[];}}
function getGoalsMoney(){try{return JSON.parse(localStorage.getItem(GK_MONEY)||'[]');}catch{return[];}}
function getGoalsFaith(){try{return JSON.parse(localStorage.getItem(GK_FAITH)||'[]');}catch{return[];}}

async function goalsSheetAppend(sheetName,row){
  if(!accessToken)return;
  try{
    await apiWrite(
      `${SHEETS_BASE}/values/${encodeURIComponent(sheetName+'!A:Z')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      'POST',{values:[row]}
    );
  }catch(e){console.warn(sheetName+' write failed:',e);}
}
async function goalsTargetsSheetSave(t){
  if(!accessToken)return;
  const rows=[['quarter','goal','target'],
    ['Apr-Jun 2026','health',t.health],
    ['Apr-Jun 2026','savings',t.savings],
    ['Apr-Jun 2026','gold',t.gold],
    ['Apr-Jun 2026','faith',t.faith],
  ];
  try{
    await apiWrite(`${SHEETS_BASE}/values/${encodeURIComponent('Goals_Targets!A:C')}:clear`,'POST',{});
    await apiWrite(`${SHEETS_BASE}/values/${encodeURIComponent('Goals_Targets!A1')}?valueInputOption=RAW`,'PUT',{values:rows});
  }catch(e){console.warn('Goals_Targets write failed:',e);}
}

function dkey(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function getSavedToken(){
  try{
    const t=JSON.parse(localStorage.getItem(TK)||'null');
    if(t && t.expires > Date.now()+60000) return t.token; // valid for >1 min
    return null;
  }catch{return null}
}

function saveToken(token, expiresIn){
  localStorage.setItem(TK,JSON.stringify({token, expires: Date.now()+(expiresIn*1000)}));
}

function clearToken(){
  localStorage.removeItem(TK);
  accessToken=null;
}

function setSyncStatus(state){
  // state: 'off' | 'loading' | 'ok' | 'error'
  const dot=document.getElementById('syncDot');
  const btnC=document.getElementById('btnConnect');
  const btnD=document.getElementById('btnDisconnect');
  dot.className='sync-dot';
  if(state==='off'){dot.style.background='var(--text-dim)';btnC.style.display='';btnD.style.display='none'}
  else if(state==='loading'){dot.classList.add('loading');btnC.style.display='none';btnD.style.display=''}
  else if(state==='ok'){dot.style.background='var(--health)';btnC.style.display='none';btnD.style.display=''}
  else if(state==='error'){dot.style.background='rgba(239,68,68,0.7)';btnC.style.display='';btnD.style.display='none'}
}

function connectCalendar(){
  if(!tokenClient){
    alert('Google auth not ready yet — wait 2 seconds and try again.');
    return;
  }
  tokenClient.requestAccessToken();
}

function disconnectCalendar(){
  if(accessToken) google.accounts.oauth2.revoke(accessToken);
  clearToken();
  setSyncStatus('off');
  switchDay(activeDay);
}

// ─── CALENDAR FETCH ───────────────────────────────────────────────────────────
async function apiFetch(url){
  const res=await fetch(url,{headers:{Authorization:`Bearer ${accessToken}`}});
  if(res.status===401){clearToken();setSyncStatus('error');throw new Error('Token expired')}
  if(!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

async function apiWrite(url,method,body){
  const res=await fetch(url,{
    method,
    headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},
    body:JSON.stringify(body)
  });
  if(res.status===401){clearToken();setSyncStatus('error');throw new Error('Token expired')}
  if(!res.ok) throw new Error(`API write error ${res.status}`);
  return res.json();
}

// ─── SHEETS ───────────────────────────────────────────────────────────────────
const SHEETS_BASE=`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`;

function showToast(msg,type){
  let t=document.getElementById('toast');
  if(!t){
    t=document.createElement('div');t.id='toast';
    t.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:8px 16px;border-radius:6px;font-size:11px;font-family:"DM Mono",monospace;z-index:9999;opacity:0;transition:opacity .3s;white-space:nowrap;pointer-events:none';
    document.body.appendChild(t);
  }
  t.textContent=msg;
  t.style.background=type==='ok'?'rgba(51,182,121,0.9)':'rgba(239,68,68,0.9)';
  t.style.color='#fff';t.style.opacity='1';
  clearTimeout(t._h);t._h=setTimeout(()=>t.style.opacity='0',3000);
}

async function loadCalendarData(){
  setSyncStatus('loading');
  try{
    const list=await apiFetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=50');

    // Monday of current week
    const now=new Date();
    const mon=new Date(now);
    mon.setDate(now.getDate()-JS2IDX[now.getDay()]);
    mon.setHours(0,0,0,0);
    const sun=new Date(mon);
    sun.setDate(mon.getDate()+6);
    sun.setHours(23,59,59,999);

    // Load Habits calendar — overrides hardcoded HABITS array when populated
    const habitCal=list.items.find(c=>c.summary.toLowerCase().trim()==='habits');
    if(habitCal){
      const hSun2=new Date(sun);hSun2.setDate(sun.getDate()+7);
      const hData=await apiFetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(habitCal.id)}/events`+
        `?timeMin=${encodeURIComponent(mon.toISOString())}&timeMax=${encodeURIComponent(hSun2.toISOString())}`+
        `&singleEvents=true&orderBy=startTime&maxResults=500`
      );
      const hEvents=hData.items||[];
      if(hEvents.length>0){
        const habitMap={};
        hEvents.forEach(ev=>{
          if(!ev.start||!ev.summary)return;
          const isAllDay=!!ev.start.date;
          const startDT=isAllDay?new Date(ev.start.date+'T00:00:00'):new Date(ev.start.dateTime);
          const dayKey=DAYS[JS2IDX[startDT.getDay()]];
          if(!dayKey)return;
          const rawTime=isAllDay?'All day':startDT.toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit',hour12:true}).replace(/\s/g,'').toLowerCase();
          const label=ev.summary.trim();
          const group=label.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
          const key=group+'__'+rawTime;
          if(!habitMap[key])habitMap[key]={id:key,label,time:rawTime,days:new Set(),group};
          habitMap[key].days.add(dayKey);
        });
        const calHabits=Object.values(habitMap).map(h=>({
          id:h.id,label:h.label,time:h.time,group:h.group,
          days:h.days.size===7?'daily':[...h.days].sort((a,b)=>DAYS.indexOf(a)-DAYS.indexOf(b)),
        }));
        if(calHabits.length>0)HABITS=calHabits;
      }
    }

    setSyncStatus('ok');
    calendarEventsCache=null;
    await restoreGoalsFromSheet();
    await noPornSheetRestore();

    // refresh current view
    if(activeDay==='history') renderHistory();
    else if(activeDay==='goals') renderGoals();
    else if(activeDay==='habits') renderHabits();
    else if(activeDay==='habitdash') renderHabitDash();
    else if(activeDay==='tasks') renderTasks();
    else if(activeDay==='manage') renderManage();

  }catch(err){
    console.error('Calendar load failed:',err);
    setSyncStatus('error');
  }
}

// ── HabitsConfig Sheet helpers ──
function habitToRow(h){
  const days=Array.isArray(h.days)?h.days.join(','):h.days;
  const flags=h.lastSundayOnly?'lastSundayOnly':'';
  return [h.id,h.label,h.time,days,flags];
}
function rowToHabit(row){
  const [id,label,time,daysStr,flags]=[row[0],row[1],row[2],row[3]||'',row[4]||''];
  const days=daysStr==='daily'?'daily':daysStr.split(',').map(s=>s.trim()).filter(Boolean);
  const h={id,label,time,days};
  if(flags.includes('lastSundayOnly'))h.lastSundayOnly=true;
  return h;
}
function slugify(label){
  return label.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
}
const HABITS_CFG_TAB='HabitsConfig';
async function habitsConfigSaveAll(){
  const header=[['id','label','time','days','flags']];
  const dataRows=HABITS.map(habitToRow);
  await apiWrite(`${SHEETS_BASE}/values/${encodeURIComponent(HABITS_CFG_TAB+'!A:E')}:clear`,'POST',{});
  await apiWrite(`${SHEETS_BASE}/values/${encodeURIComponent(HABITS_CFG_TAB+'!A1')}?valueInputOption=RAW`,'PUT',{values:[...header,...dataRows]});
}

// ── Manage Tab ──
let manageGoalForm=null; // {category, editId} or null

function renderManage(){
  if(!accessToken){
    document.getElementById('main').innerHTML=`<div class="connect-screen">
      <h2>Not Connected</h2>
      <p>Connect Google to manage your goals.</p>
      <button class="btn-connect-big" onclick="connectCalendar()">Connect</button>
    </div>`;
    return;
  }
  const t=getGoalsTargets();
  const customs=getCustomGoals();
  const CATS=[
    {key:'health',       label:'Health',       emoji:'💪', color:'var(--health)'},
    {key:'money',        label:'Money',        emoji:'💰', color:'var(--money)'},
    {key:'work',         label:'Work',         emoji:'💼', color:'var(--work)'},
    {key:'relationship', label:'Relationship', emoji:'🤝', color:'var(--rel)'},
    {key:'faith',        label:'Faith',        emoji:'🙏', color:'var(--spirit)'},
  ];
  let html=`<div class="section-title">Manage Goals</div>`;
  CATS.forEach(cat=>{
    html+=`<div class="manage-cat-section">
      <div class="manage-cat-header" style="color:${cat.color}">${cat.emoji} ${cat.label}</div>`;
    if(cat.key==='health'){
      html+=`<div class="manage-builtin-row">
        <div class="manage-builtin-label">WEIGHT — BUILT-IN</div>
        <div class="manage-target-row"><span>Target</span>
          <input id="tHealth" class="manage-target-input" type="number" step="0.1" value="${t.health}">
          <span>kg</span><button class="manage-btn" onclick="saveTargets()">Save</button>
        </div></div>`;
    }
    if(cat.key==='money'){
      html+=`<div class="manage-builtin-row">
        <div class="manage-builtin-label">SAVINGS — BUILT-IN</div>
        <div class="manage-target-row"><span>Target</span>
          <input id="tSavings" class="manage-target-input" type="number" step="1" value="${t.savings}">
          <span>$/qtr</span><button class="manage-btn" onclick="saveTargets()">Save</button>
        </div></div>
      <div class="manage-builtin-row" style="margin-top:6px">
        <div class="manage-builtin-label">GOLD — BUILT-IN</div>
        <div class="manage-target-row"><span>Target</span>
          <input id="tGold" class="manage-target-input" type="number" step="1" value="${t.gold}">
          <span>$/qtr</span><button class="manage-btn" onclick="saveTargets()">Save</button>
        </div></div>`;
    }
    if(cat.key==='faith'){
      html+=`<div class="manage-builtin-row">
        <div class="manage-builtin-label">SHLOKAS (LALITHA SAHASRANAMAM) — BUILT-IN</div>
        <div class="manage-target-row"><span>Target</span>
          <input id="tFaith" class="manage-target-input" type="number" step="1" value="${t.faith}">
          <button class="manage-btn" onclick="saveTargets()">Save</button>
        </div></div>`;
    }
    const catGoals=customs.filter(g=>g.category===cat.key);
    catGoals.forEach(g=>{
      const logs=getCustomLogs()[g.id]||[];
      const total=logs.reduce((s,e)=>s+e.value,0);
      html+=`<div class="manage-goal-row">
        <div style="flex:1;min-width:0">
          <div class="manage-goal-label">${g.name}</div>
          <div class="manage-goal-meta">Target: ${g.target} ${g.unit} · Progress: ${total} ${g.unit}</div>
        </div>
        <button class="manage-btn" onclick="openGoalForm('${cat.key}','${g.id}')">edit</button>
        <button class="manage-btn danger" onclick="deleteCustomGoal('${g.id}')">delete</button>
      </div>`;
    });
    if(manageGoalForm&&manageGoalForm.category===cat.key){
      const editing=manageGoalForm.editId?customs.find(g=>g.id===manageGoalForm.editId):null;
      html+=`<div class="manage-form" id="goalForm">
        <div class="manage-form-title">${editing?'Edit goal':'Add goal — '+cat.label}</div>
        <div class="manage-field"><label>Goal name</label>
          <input id="gfName" type="text" placeholder="e.g. Read 5 books" value="${editing?editing.name:''}">
        </div>
        <div class="manage-field"><label>Target (number)</label>
          <input id="gfTarget" type="number" step="any" min="0" placeholder="e.g. 5" value="${editing?editing.target:''}">
        </div>
        <div class="manage-field"><label>Unit</label>
          <input id="gfUnit" type="text" placeholder="e.g. books, hours, calls" value="${editing?editing.unit:''}">
        </div>
        <div class="manage-form-btns">
          <button class="manage-save-btn" onclick="saveCustomGoal()">Save</button>
          <button class="manage-cancel-btn" onclick="closeGoalForm()">Cancel</button>
        </div>
      </div>`;
    } else {
      html+=`<button class="manage-add-btn" onclick="openGoalForm('${cat.key}')">+ Add ${cat.label} goal</button>`;
    }
    html+=`</div>`;
  });
  document.getElementById('main').innerHTML=html;
  if(manageGoalForm){const f=document.getElementById('goalForm');if(f)f.scrollIntoView({behavior:'smooth'});}
}

function openGoalForm(category,editId=null){manageGoalForm={category,editId};renderManage();}
function closeGoalForm(){manageGoalForm=null;renderManage();}

function saveCustomGoal(){
  const name=document.getElementById('gfName').value.trim();
  const target=parseFloat(document.getElementById('gfTarget').value);
  const unit=document.getElementById('gfUnit').value.trim();
  if(!name){showToast('Goal name required','err');return;}
  if(isNaN(target)||target<=0){showToast('Enter a valid target','err');return;}
  if(!unit){showToast('Unit required','err');return;}
  const goals=getCustomGoals();
  if(manageGoalForm.editId){
    const idx=goals.findIndex(g=>g.id===manageGoalForm.editId);
    if(idx>-1)goals[idx]={...goals[idx],name,target,unit};
  } else {
    goals.push({id:manageGoalForm.category+'_'+Date.now().toString(36),category:manageGoalForm.category,name,target,unit});
  }
  saveCustomGoals(goals);
  manageGoalForm=null;
  showToast('Goal saved','ok');
  customGoalsSheetBackup().catch(e=>console.warn('Goals_Config backup:',e));
  renderManage();
}

function deleteCustomGoal(id){
  const goals=getCustomGoals();
  const g=goals.find(x=>x.id===id);
  if(!g)return;
  if(!confirm(`Delete "${g.name}"?\nProgress data will also be removed.`))return;
  saveCustomGoals(goals.filter(x=>x.id!==id));
  const logs=getCustomLogs();delete logs[id];saveCustomLogs(logs);
  customGoalsSheetBackup().catch(e=>console.warn('Goals_Config backup:',e));
  renderManage();
}

// ── Goal log functions ──
function logHealth(){
  const val=parseFloat(document.getElementById('healthInput').value);
  if(isNaN(val)||val<30||val>200){showToast('Enter a valid weight','err');return;}
  const today=dkey(new Date());
  const data=getGoalsHealth();
  const idx=data.findIndex(e=>e.date===today);
  const entry={date:today,weight:val};
  if(idx>-1)data[idx]=entry;else data.push(entry);
  localStorage.setItem(GK_HEALTH,JSON.stringify(data));
  goalsSheetAppend('Goals_Health',[today,val]);
  showToast('Weight logged','ok');
  renderGoals();
}
function logMoney(type){
  const inputId=type==='savings'?'savingsInput':'goldInput';
  const val=parseFloat(document.getElementById(inputId).value);
  if(isNaN(val)||val<=0){showToast('Enter a valid amount','err');return;}
  const entry={date:dkey(new Date()),type,amount:val};
  const data=getGoalsMoney();
  data.push(entry);
  localStorage.setItem(GK_MONEY,JSON.stringify(data));
  goalsSheetAppend('Goals_Money',[entry.date,type,val]);
  showToast(type==='savings'?'Savings logged':'Gold logged','ok');
  renderGoals();
}
function logFaith(){
  const val=parseInt(document.getElementById('faithInput').value);
  if(isNaN(val)||val<1||val>182){showToast('Enter a valid shloka count','err');return;}
  const today=dkey(new Date());
  const data=getGoalsFaith();
  const idx=data.findIndex(e=>e.date===today);
  const entry={date:today,shlokas:val};
  if(idx>-1){data[idx].shlokas+=val;}else data.push(entry);
  localStorage.setItem(GK_FAITH,JSON.stringify(data));
  goalsSheetAppend('Goals_Faith',[today,data.find(e=>e.date===today).shlokas]);
  showToast('Shlokas logged','ok');
  renderGoals();
}
function saveTargets(){
  const h=parseFloat(document.getElementById('tHealth').value);
  const s=parseFloat(document.getElementById('tSavings').value);
  const g=parseFloat(document.getElementById('tGold').value);
  const f=parseInt(document.getElementById('tFaith').value);
  if([h,s,g,f].some(v=>isNaN(v)||v<=0)){showToast('All targets must be positive numbers','err');return;}
  const t={health:h,savings:s,gold:g,faith:f};
  saveGoalsTargets(t);
  goalsTargetsSheetSave(t);
  showToast('Targets saved','ok');
  renderManage();
}

function logCustomGoal(id){
  const el=document.getElementById('cgl_'+id);
  if(!el)return;
  const val=parseFloat(el.value);
  if(isNaN(val)||val<=0){showToast('Enter a valid amount','err');return;}
  const logs=getCustomLogs();
  if(!logs[id])logs[id]=[];
  logs[id].push({date:dkey(new Date()),value:val});
  saveCustomLogs(logs);
  el.value='';
  const goal=getCustomGoals().find(g=>g.id===id);
  if(goal)goalsSheetAppend('Goals_Custom',[dkey(new Date()),id,goal.category,goal.name,val]);
  showToast('Progress logged','ok');
  renderGoals();
}

function renderCustomGoalCards(category){
  const goals=getCustomGoals().filter(g=>g.category===category);
  if(!goals.length)return`<div class="goal-card placeholder"><div class="goal-card-title" style="font-size:12px;color:var(--text-dim)">No goals yet — add in Manage tab</div></div>`;
  return goals.map(g=>{
    const logs=getCustomLogs()[g.id]||[];
    const total=logs.reduce((s,e)=>s+e.value,0);
    const pct=g.target>0?Math.min(100,Math.round(total/g.target*100)):0;
    const barCol=pct>=75?'rgba(51,182,121,0.8)':pct>=40?'rgba(245,158,11,0.8)':'rgba(239,68,68,0.7)';
    const trendCls=pct>=75?'good':pct>=40?'warn':'bad';
    const catCls=category==='work'?'goal-cat-work':category==='relationship'?'goal-cat-rel':category==='health'?'goal-cat-health':category==='money'?'goal-cat-money':'goal-cat-faith';
    return`<div class="goal-card ${catCls}">
      <div class="goal-card-header">
        <span class="goal-card-title">${g.name}</span>
        <span class="goal-trend ${trendCls}">${pct}%</span>
      </div>
      <div class="goal-metric-row"><span>Progress</span><span>${total} / ${g.target} ${g.unit}</span></div>
      <div class="goal-bar-outer"><div class="goal-bar-inner" style="width:${pct}%;background:${barCol}"></div></div>
      <div class="goal-input-row">
        <input id="cgl_${g.id}" class="goal-input" type="number" step="any" min="0" placeholder="Add progress (${g.unit})">
        <button class="goal-input-btn" onclick="logCustomGoal('${g.id}')">Log</button>
      </div>
    </div>`;
  }).join('');
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
function init(){
  const now=new Date();
  activeDay = 'goals';

  document.getElementById('hDate').textContent=
    now.toLocaleDateString('en-AU',{weekday:'long',day:'numeric',month:'long',year:'numeric'});

  document.querySelectorAll('.tab[data-day]').forEach(tab=>{
    tab.addEventListener('click',()=>switchDay(tab.dataset.day));
  });

  function setupGIS(){
    if(typeof google==='undefined'||!google.accounts){
      setTimeout(setupGIS,200); return;
    }
    tokenClient=google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback:async(response)=>{
        if(response.error){setSyncStatus('error');return}
        accessToken=response.access_token;
        saveToken(response.access_token, response.expires_in||3600);
        habitsSheetInit();
        tasksDoneSheetInit();
        loadCalendarData();
      }
    });

    const saved=getSavedToken();
    if(saved){
      accessToken=saved;
      setSyncStatus('ok');
      switchDay(activeDay);
      habitsSheetInit();
      tasksDoneSheetInit();
      loadCalendarData();
    } else {
      setSyncStatus('off');
      switchDay(activeDay);
    }
  }
  setupGIS();
}

function switchDay(day){
  activeDay=day;
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.day===day));
  const m=document.getElementById('main');m.classList.remove('enter');void m.offsetWidth;m.classList.add('enter');
  if(day==='history'){renderHistory();return}
  if(day==='goals'){renderGoals();return}
  if(day==='habits'){renderHabits();return}
  if(day==='habitdash'){renderHabitDash();return}
  if(day==='tasks'){renderTasks();return}
  if(day==='calories'){renderCalories();return}
  if(day==='manage'){manageGoalForm=null;renderManage();return}
}

// ── Render Goals Tab ──
function renderGoals(){
  if(!accessToken){
    document.getElementById('main').innerHTML=`<div class="connect-screen">
      <h2>Connect Google</h2>
      <p>Connect your Google account to access Goals.</p>
      <button class="btn-connect-big" onclick="connectCalendar()">Connect</button>
    </div>`;
    return;
  }
  const targets=getGoalsTargets();
  const healthData=getGoalsHealth().sort((a,b)=>a.date.localeCompare(b.date));
  const moneyData=getGoalsMoney().sort((a,b)=>a.date.localeCompare(b.date));
  const faithData=getGoalsFaith().sort((a,b)=>a.date.localeCompare(b.date));
  const now=new Date();
  const qTotalDays=Math.round((Q_END-Q_START)/864e5)+1;
  const qElapsed=Math.max(1,Math.min(qTotalDays,Math.round((now-Q_START)/864e5)+1));

  // ── Health ──
  const latestW=healthData.length?healthData[healthData.length-1].weight:null;
  const firstW=healthData.length?healthData[0].weight:null;
  const hTarget=targets.health;
  const hRange=firstW&&firstW!==hTarget?firstW-hTarget:10;
  const hPct=latestW?Math.min(100,Math.max(0,Math.round((firstW-latestW)/hRange*100))):0;
  const barG='linear-gradient(90deg,rgba(51,182,121,0.5),rgba(51,182,121,1))';
  const barW='linear-gradient(90deg,rgba(245,158,11,0.5),rgba(245,158,11,1))';
  const barB='linear-gradient(90deg,rgba(239,68,68,0.4),rgba(239,68,68,0.85))';
  const hBarCol=hPct>=75?barG:hPct>=40?barW:barB;
  // Trend: compare last 7 entries avg vs prev 7
  let hTrendCls='warn',hTrendTxt='No data yet';
  if(healthData.length>=2){
    const last7=healthData.slice(-7).map(e=>e.weight);
    const prev7=healthData.slice(-14,-7).map(e=>e.weight);
    const avgL=last7.reduce((s,v)=>s+v,0)/last7.length;
    const avgP=prev7.length?prev7.reduce((s,v)=>s+v,0)/prev7.length:avgL;
    const diff=avgL-avgP;
    if(diff<-0.05){hTrendCls='good';hTrendTxt=`↓ Losing ${Math.abs(diff).toFixed(1)}kg/week`;}
    else if(diff>0.05){hTrendCls='bad';hTrendTxt=`↑ Gaining ${diff.toFixed(1)}kg/week`;}
    else{hTrendCls='warn';hTrendTxt='→ Holding steady';}
  }
  const hLogs=''; // Log history shown in History tab only

  // ── Savings ──
  const savingsEntries=moneyData.filter(e=>e.type==='savings');
  const totalSavings=savingsEntries.reduce((s,e)=>s+e.amount,0);
  const sPct=Math.min(100,Math.round(totalSavings/targets.savings*100));
  const sExpected=Math.round(targets.savings*qElapsed/qTotalDays);
  const sTrendCls=totalSavings>=sExpected?'good':'bad';
  const sTrendTxt=totalSavings>=sExpected?`On track (+$${(totalSavings-sExpected).toFixed(0)} ahead)`:`Behind by $${(sExpected-totalSavings).toFixed(0)}`;
  const sLogs=''; // History tab only

  // ── Gold ──
  const goldEntries=moneyData.filter(e=>e.type==='gold');
  const totalGold=goldEntries.reduce((s,e)=>s+e.amount,0);
  const gPct=Math.min(100,Math.round(totalGold/targets.gold*100));
  const gExpected=Math.round(targets.gold*qElapsed/qTotalDays);
  const gTrendCls=totalGold>=gExpected?'good':'bad';
  const gTrendTxt=totalGold>=gExpected?`On track (+$${(totalGold-gExpected).toFixed(0)} ahead)`:`Behind by $${(gExpected-totalGold).toFixed(0)}`;
  const gLogs=''; // History tab only

  // ── Faith ──
  const totalShlokas=faithData.reduce((s,e)=>s+e.shlokas,0);
  const fPct=Math.min(100,Math.round(totalShlokas/targets.faith*100));
  const fExpected=Math.round(targets.faith*qElapsed/qTotalDays);
  const fDiff=totalShlokas-fExpected;
  const fTrendCls=fDiff>=0?'good':fDiff>=-5?'warn':'bad';
  const fTrendTxt=fDiff>=0?`Ahead by ${fDiff} shloka${fDiff!==1?'s':''}`:`Behind by ${Math.abs(fDiff)} shloka${Math.abs(fDiff)!==1?'s':''}`;
  const fLogs=''; // History tab only

  document.getElementById('main').innerHTML=`
    <div class="section-title">Goals — Apr → Jun 2026</div>

    <div class="goals-section-title">Health 💪</div>
    <div class="goal-card goal-cat-health">
      <div class="goal-card-header">
        <span class="goal-card-title">${latestW??'—'}kg</span>
        <span class="goal-trend ${hTrendCls}">${hTrendTxt}</span>
      </div>
      <div class="goal-metric-row"><span>Target</span><span>${hTarget}kg</span></div>
      <div class="goal-bar-outer"><div class="goal-bar-inner" style="width:${hPct}%;background:${hBarCol}"></div></div>
      <div class="goal-metric-row"><span>Progress</span><span>${hPct}%${firstW?' · started '+firstW+'kg':''}</span></div>
      <div class="goal-input-row">
        <input id="healthInput" class="goal-input" type="number" step="0.1" min="30" max="200" placeholder="Weight (kg)">
        <button class="goal-input-btn" onclick="logHealth()">Log</button>
      </div>
      ${hLogs?`<div class="goal-log-list">${hLogs}</div>`:''}
    </div>

    <div class="goals-section-title">Money 💰</div>
    <div class="goal-card goal-cat-money">
      <div class="goal-card-header">
        <span class="goal-card-title">Savings · $${totalSavings.toFixed(0)}</span>
        <span class="goal-trend ${sTrendCls}">${sTrendTxt}</span>
      </div>
      <div class="goal-metric-row"><span>Target</span><span>$${targets.savings}/quarter</span></div>
      <div class="goal-bar-outer"><div class="goal-bar-inner" style="width:${sPct}%;background:${sTrendCls==='good'?barG:barB}"></div></div>
      <div class="goal-metric-row"><span>Progress</span><span>$${totalSavings.toFixed(0)} / $${targets.savings} (${sPct}%)</span></div>
      <div class="goal-input-row">
        <input id="savingsInput" class="goal-input" type="number" step="1" min="1" placeholder="Amount saved ($)">
        <button class="goal-input-btn" onclick="logMoney('savings')">Log</button>
      </div>
      ${sLogs?`<div class="goal-log-list">${sLogs}</div>`:''}
    </div>
    <div class="goal-card goal-cat-money">
      <div class="goal-card-header">
        <span class="goal-card-title">Gold · $${totalGold.toFixed(0)}</span>
        <span class="goal-trend ${gTrendCls}">${gTrendTxt}</span>
      </div>
      <div class="goal-metric-row"><span>Target</span><span>$${targets.gold}/quarter</span></div>
      <div class="goal-bar-outer"><div class="goal-bar-inner" style="width:${gPct}%;background:${gTrendCls==='good'?barG:barB}"></div></div>
      <div class="goal-metric-row"><span>Progress</span><span>$${totalGold.toFixed(0)} / $${targets.gold} (${gPct}%)</span></div>
      <div class="goal-input-row">
        <input id="goldInput" class="goal-input" type="number" step="1" min="1" placeholder="Amount invested ($)">
        <button class="goal-input-btn" onclick="logMoney('gold')">Log</button>
      </div>
      ${gLogs?`<div class="goal-log-list">${gLogs}</div>`:''}
    </div>

    <div class="goals-section-title">Faith 🙏</div>
    <div class="goal-card goal-cat-faith">
      <div class="goal-card-header">
        <span class="goal-card-title">${totalShlokas} / ${targets.faith} shlokas</span>
        <span class="goal-trend ${fTrendCls}">${fTrendTxt}</span>
      </div>
      <div class="goal-metric-row"><span>Target</span><span>${targets.faith} shlokas by Jun 30</span></div>
      <div class="goal-bar-outer"><div class="goal-bar-inner" style="width:${fPct}%;background:${fTrendCls==='good'?barG:fTrendCls==='warn'?barW:barB}"></div></div>
      <div class="goal-metric-row"><span>Expected by today</span><span>${fExpected} shlokas</span></div>
      <div class="goal-input-row">
        <input id="faithInput" class="goal-input" type="number" step="1" min="1" placeholder="Shlokas read today">
        <button class="goal-input-btn" onclick="logFaith()">Log</button>
      </div>
      ${fLogs?`<div class="goal-log-list">${fLogs}</div>`:''}
    </div>

    <div class="goals-section-title">Work 💼</div>
    ${renderCustomGoalCards('work')}

    <div class="goals-section-title">Relationship 🤝</div>
    ${renderCustomGoalCards('relationship')}`;
}


// ─── RENDER HISTORY ───────────────────────────────────────────────────────────
function renderHistory(){
  if(!accessToken){
    document.getElementById('main').innerHTML=`<div class="connect-screen">
      <h2>Connect Google</h2>
      <p>Connect your Google account to access History.</p>
      <button class="btn-connect-big" onclick="connectCalendar()">Connect</button>
    </div>`;
    return;
  }
  const now=new Date();
  const qTotalDays=Math.round((Q_END-Q_START)/864e5)+1;
  const qElapsed=Math.max(1,Math.min(qTotalDays,Math.round((now-Q_START)/864e5)+1));
  const qPct=Math.round(qElapsed/qTotalDays*100);
  const daysLeft=qTotalDays-qElapsed;
  const cA='rgba(245,158,11,0.8)';

  let h=`<div class="section-title">History — Apr → Jun 2026</div>`;

  // Quarter progress bar
  h+=`<div class="goal-card" style="margin-bottom:20px">
    <div class="goal-card-header">
      <span class="goal-card-title">Q2 2026 progress</span>
      <span class="goal-trend warn">${daysLeft} days left</span>
    </div>
    <div class="goal-bar-outer"><div class="goal-bar-inner" style="width:${qPct}%;background:${cA}"></div></div>
    <div class="goal-metric-row"><span>Week ${Math.ceil(qElapsed/7)} of ${Math.ceil(qTotalDays/7)}</span><span>${qPct}% elapsed · Apr 1 → Jun 30</span></div>
  </div>`;

  // Build unified goal entry log (all types, sorted by date desc)
  const healthData=getGoalsHealth().map(e=>({date:e.date,type:'Weight',val:`${e.weight}kg`,col:'var(--health)'}));
  const moneyData=getGoalsMoney().map(e=>({date:e.date,type:e.type==='savings'?'Savings':'Gold',val:`+$${e.amount}`,col:'var(--money)'}));
  const faithData=getGoalsFaith().map(e=>({date:e.date,type:'Shlokas',val:`+${e.shlokas}`,col:'var(--spirit)'}));
  const allEntries=[...healthData,...moneyData,...faithData].sort((a,b)=>b.date.localeCompare(a.date));

  h+=`<div class="section-title">Goal entry log</div>`;
  if(!allEntries.length){
    h+=`<div class="no-data">No entries yet. Log your goals in the Goals tab.</div>`;
  } else {
    // Group by date
    const byDate={};
    allEntries.forEach(e=>{if(!byDate[e.date])byDate[e.date]=[];byDate[e.date].push(e);});
    h+=`<div style="display:flex;flex-direction:column;gap:10px;margin-bottom:24px">`;
    Object.keys(byDate).sort((a,b)=>b.localeCompare(a)).forEach(date=>{
      const entries=byDate[date];
      const d=new Date(date+'T00:00:00');
      const label=d.toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'short'});
      h+=`<div class="goal-card" style="padding:12px">
        <div style="font-size:10px;color:var(--text-dim);margin-bottom:8px;font-weight:600">${label}</div>
        <div style="display:flex;flex-direction:column;gap:5px">`;
      entries.forEach(e=>{
        h+=`<div style="display:flex;justify-content:space-between;font-size:11px">
          <span style="color:${e.col};font-weight:600;text-transform:uppercase;letter-spacing:.5px;font-size:9px">${e.type}</span>
          <span style="color:var(--text);font-family:'Barlow Condensed',sans-serif;font-size:15px;font-weight:700">${e.val}</span>
        </div>`;
      });
      h+=`</div></div>`;
    });
    h+=`</div>`;
  }

  document.getElementById('main').innerHTML=h;
}
function showTT(e,text){const t=document.getElementById('tt');t.textContent=text;t.classList.add('show');t.style.left=(e.clientX+12)+'px';t.style.top=(e.clientY-32)+'px'}
function hideTT(){document.getElementById('tt').classList.remove('show')}

if('serviceWorker' in navigator){
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('./sw.js').catch(err=>console.error('SW:',err));
  });
}

// ─── HABITS SYSTEM ─────────────────────────────────────────────────────────
let HABITS = [
  { id:'wake_up',         label:'Wake up',                      time:'5:30am',  days:'daily' },
  { id:'get_ready',       label:'Get ready',                    time:'6:15am',  days:'daily' },
  { id:'thyroxine',       label:'Take Thyroxine',               time:'6:15am',  days:'daily' },
  { id:'wash_clothes',    label:'Wash clothes',                 time:'6:30am',  days:['mon'] },
  { id:'deepam_tt',       label:'Deepam',                       time:'6:45am',  days:['tue','thu'],                         group:'deepam' },
  { id:'deepam_main',     label:'Deepam',                       time:'7:00am',  days:['mon','wed','fri','sat'],              group:'deepam' },
  { id:'wash_pooja',      label:'Wash pooja samagri',           time:'7:00am',  days:['sun'] },
  { id:'soak_nuts_tt',    label:'Soak nuts & sprouts',          time:'7:15am',  days:['tue','thu'],                         group:'soak_nuts' },
  { id:'recite_main',     label:'Recite Lalitha Sahasranamam',  time:'7:15am',  days:['mon','tue','wed','thu','fri','sat'],  group:'recite' },
  { id:'deepam_sun',      label:'Deepam',                       time:'7:30am',  days:['sun'],                               group:'deepam' },
  { id:'gita_main',       label:'Read Bhagawad Gita',           time:'7:45am',  days:['mon','tue','wed','thu','fri','sat'],  group:'gita' },
  { id:'recite_sun',      label:'Recite Lalitha Sahasranamam',  time:'7:45am',  days:['sun'],                               group:'recite' },
  { id:'learn_main',      label:'Learn Lalitha Sahasranamam',   time:'8:00am',  days:['mon','tue','wed','thu','fri','sat'],  group:'learn' },
  { id:'send_snap',       label:'Send snap',                    time:'8:30am',  days:'daily' },
  { id:'gita_sun',        label:'Read Bhagawad Gita',           time:'8:15am',  days:['sun'],                               group:'gita' },
  { id:'learn_sun',       label:'Learn Lalitha Sahasranamam',   time:'8:30am',  days:['sun'],                               group:'learn' },
  { id:'soak_nuts_main',  label:'Soak nuts & sprouts',          time:'10:30am', days:['mon','wed','fri','sat','sun'],        group:'soak_nuts' },
  { id:'lunch',           label:'Lunch',                        time:'11:00am', days:'daily' },
  { id:'haircut',         label:'Haircut',                      time:'12:15pm', days:['sun'], lastSundayOnly:true },
  { id:'buy_groceries',   label:'Buy Indian groceries',         time:'1:00pm',  days:['sun'] },
  { id:'clean_house',     label:'Clean house',                  time:'3:00pm',  days:['wed'] },
  { id:'wash_kitchen',    label:'Wash kitchen cloth',           time:'4:00pm',  days:['mon'] },
  { id:'dinner',          label:'Dinner',                       time:'6:00pm',  days:'daily' },
  { id:'wash_veg',        label:'Wash vegetables & fruits',     time:'7:00pm',  days:['sun'] },
  { id:'order_groceries', label:'Order groceries',              time:'8:00pm',  days:['fri'] },
  { id:'fold_clothes',    label:'Fold clothes',                 time:'8:30pm',  days:['tue'] },
  { id:'iron_shirt',      label:'Iron shirt',                   time:'9:00pm',  days:['mon','wed'] },
  { id:'prep_next_day',   label:'Prep for next day',            time:'9:00pm',  days:'daily' },
  { id:'veg_fridge',      label:'Put veg back in fridge',       time:'9:00pm',  days:['sun'] },
  { id:'peel_nuts',       label:'Peel nuts',                    time:'9:15pm',  days:'daily' },
  { id:'pack_lunch',      label:'Pack lunch',                   time:'9:20pm',  days:['mon','wed'] },
  { id:'sleep',           label:'Sleep',                        time:'10:30pm', days:'daily' },
];

const HK='gps_habits_v1';
const HABITS_TAB='Habits';
let habitsSheetRowMap={};
let habitActiveDay=null;
let habitActiveDateStr=null;

function getHabitStore(){try{return JSON.parse(localStorage.getItem(HK)||'{}')}catch{return{}}}
function saveHabitStore(s){localStorage.setItem(HK,JSON.stringify(s))}

function isLastSundayOfMonth(dateStr){
  const d=new Date(dateStr+'T00:00:00'),next=new Date(d);
  next.setDate(d.getDate()+7);
  return next.getMonth()!==d.getMonth();
}

function getHabitsForDay(dayKey,dateStr){
  return HABITS.filter(h=>{
    const days=h.days==='daily'?DAYS:h.days;
    if(!days.includes(dayKey)) return false;
    if(h.lastSundayOnly&&!isLastSundayOfMonth(dateStr)) return false;
    return true;
  });
}

function parseTime12(t){
  const m=t.match(/(\d+):(\d+)(am|pm)/i);if(!m)return 0;
  let h=parseInt(m[1]),min=parseInt(m[2]),pm=m[3].toLowerCase()==='pm';
  if(pm&&h!==12)h+=12;if(!pm&&h===12)h=0;
  return h*60+min;
}

function getHabitStatus(ds,hid){return getHabitStore()[ds]?.[hid]||''}

function setHabitStatus(ds,hid,status){
  const s=getHabitStore();
  if(!s[ds])s[ds]={};
  if(status==='')delete s[ds][hid];else s[ds][hid]=status;
  saveHabitStore(s);
  habitsSheetWrite(ds,s[ds]||{}).catch(e=>console.warn('Habits sheet:',e));
}

function cycleHabitState(ds,hid){
  const cur=getHabitStatus(ds,hid);
  const next=cur===''?'did':cur==='did'?'delayed':cur==='delayed'?'didnot':'';
  setHabitStatus(ds,hid,next);
  renderHabits();
}

// ── Sheets for Habits ──
async function habitsSheetInit(){
  if(!accessToken)return;
  try{
    const data=await apiFetch(`${SHEETS_BASE}/values/${encodeURIComponent(HABITS_TAB+'!A:C')}`);
    const rows=data.values||[];
    if(rows.length===0){
      await apiWrite(
        `${SHEETS_BASE}/values/${encodeURIComponent(HABITS_TAB+'!A1:C1')}?valueInputOption=RAW`,
        'PUT',{values:[['Date','Day','HabitStatuses']]}
      );
    }else{
      habitsSheetRowMap={};
      const store=getHabitStore();
      let changed=false;
      rows.forEach((row,i)=>{
        if(i===0||!row[0])return;
        habitsSheetRowMap[row[0]]=i+1;
        if(!store[row[0]]&&row[2]){
          try{store[row[0]]=JSON.parse(row[2]);changed=true;}catch{}
        }
      });
      if(changed){saveHabitStore(store);showToast('Habit data restored from Sheets','ok');}
    }
  }catch(err){console.warn('Habits sheet init:',err);}
}

async function habitsSheetWrite(ds,statuses){
  if(!accessToken)return;
  const d=new Date(ds+'T00:00:00');
  const dayKey=DAYS[JS2IDX[d.getDay()]]||'';
  const row=[ds,dayKey,JSON.stringify(statuses)];
  try{
    if(habitsSheetRowMap[ds]){
      const r=habitsSheetRowMap[ds];
      await apiWrite(
        `${SHEETS_BASE}/values/${encodeURIComponent(HABITS_TAB+'!A'+r+':C'+r)}?valueInputOption=RAW`,
        'PUT',{values:[row]}
      );
    }else{
      const res=await apiWrite(
        `${SHEETS_BASE}/values/${encodeURIComponent(HABITS_TAB+'!A:C')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        'POST',{values:[row]}
      );
      const match=(res.updates?.updatedRange||'').match(/(\d+):/);
      if(match)habitsSheetRowMap[ds]=parseInt(match[1]);
    }
    showToast('Habits saved','ok');
  }catch(err){showToast('Habits sheet: '+err.message,'err');}
}

// ── Render Habits Tab ──
function renderHabits(){
  if(!accessToken){
    document.getElementById('main').innerHTML=`<div class="connect-screen">
      <h2>Connect Google</h2>
      <p>Connect your Google account to access Habits.</p>
      <button class="btn-connect-big" onclick="connectCalendar()">Connect</button>
    </div>`;
    return;
  }
  const now=new Date();
  if(!habitActiveDay){
    habitActiveDay=DAYS[JS2IDX[now.getDay()]];
    habitActiveDateStr=dkey(now);
  }
  const todayStr=dkey(now);
  const habits=getHabitsForDay(habitActiveDay,habitActiveDateStr);
  const store=getHabitStore();
  const statuses=store[habitActiveDateStr]||{};

  const cntDid=habits.filter(h=>statuses[h.id]==='did').length;
  const cntDelay=habits.filter(h=>statuses[h.id]==='delayed').length;
  const cntNot=habits.filter(h=>statuses[h.id]==='didnot').length;
  const total=habits.length;
  const pct=total?Math.round((cntDid+cntDelay)/total*100):0;

  // Week day nav
  const wkMon=new Date(now);
  wkMon.setDate(now.getDate()-JS2IDX[now.getDay()]);
  wkMon.setHours(0,0,0,0);
  let dayNavH='<div class="habit-day-nav">';
  DAYS.forEach((dk,i)=>{
    const d=new Date(wkMon);d.setDate(wkMon.getDate()+i);
    const ds=dkey(d);
    const isToday=ds===todayStr,isActive=ds===habitActiveDateStr;
    dayNavH+=`<button class="hday-btn${isActive?' active':''}${isToday&&!isActive?' today':''}" onclick="switchHabitDay('${dk}','${ds}')">${DNAMES[dk].slice(0,3).toUpperCase()} ${d.getDate()}</button>`;
  });
  dayNavH+='</div>';

  const summH=`<div class="habit-summary">
    <div class="habit-summary-item"><div class="habit-summary-num" style="color:#33b679">${cntDid}</div><div class="habit-summary-lbl">Done</div></div>
    <div class="habit-summary-item"><div class="habit-summary-num" style="color:#f59e0b">${cntDelay}</div><div class="habit-summary-lbl">Delayed</div></div>
    <div class="habit-summary-item"><div class="habit-summary-num" style="color:rgba(239,68,68,0.85)">${cntNot}</div><div class="habit-summary-lbl">Skipped</div></div>
    <div class="habit-summary-item"><div class="habit-summary-num" style="color:var(--accent)">${pct}%</div><div class="habit-summary-lbl">Score</div></div>
  </div>`;

  // Group by time of day
  const groups={Morning:[],Afternoon:[],Evening:[],Night:[]};
  habits.forEach(h=>{
    const m=parseTime12(h.time);
    if(m<720)groups.Morning.push(h);
    else if(m<1020)groups.Afternoon.push(h);
    else if(m<1260)groups.Evening.push(h);
    else groups.Night.push(h);
  });

  let listH='<div style="font-size:9px;color:var(--text-dim);margin-bottom:14px;line-height:1.8">Tap once → ✓ Done &nbsp;·&nbsp; Tap again → ⏰ Delayed &nbsp;·&nbsp; Tap again → ✗ Skipped &nbsp;·&nbsp; Tap again → clear</div>';
  Object.entries(groups).forEach(([grp,hs])=>{
    if(!hs.length)return;
    listH+=`<div class="habit-group-title">${grp}</div>`;
    hs.forEach(h=>{
      const st=statuses[h.id]||'';
      const icon=st==='did'?'✓':st==='delayed'?'⏰':st==='didnot'?'✗':'·';
      const badge=st==='did'?'<span class="habit-state-badge">Done</span>':
                  st==='delayed'?'<span class="habit-state-badge">Delayed</span>':
                  st==='didnot'?'<span class="habit-state-badge">Skipped</span>':'';
      listH+=`<div class="habit-row${st?' state-'+st:''}" onclick="cycleHabitState('${habitActiveDateStr}','${h.id}')">
        <div class="habit-state-icon">${icon}</div>
        <div class="habit-info">
          <div class="habit-label">${h.label}</div>
          <div class="habit-time-lbl">${h.time}</div>
        </div>
        ${badge}
      </div>`;
    });
  });

  const dateLabel=new Date(habitActiveDateStr+'T00:00:00').toLocaleDateString('en-AU',{weekday:'long',day:'numeric',month:'long'});
  document.getElementById('main').innerHTML=
    dayNavH+
    `<div style="font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:700;letter-spacing:1px;margin-bottom:12px;color:var(--text-mid)">${dateLabel}</div>`+
    summH+listH;
}

function switchHabitDay(dk,ds){
  habitActiveDay=dk;habitActiveDateStr=ds;renderHabits();
}

// ── Render Habit Dashboard ──
function renderHabitDash(){
  if(!accessToken){
    document.getElementById('main').innerHTML=`<div class="connect-screen">
      <h2>Connect Google</h2>
      <p>Connect your Google account to access the Dashboard.</p>
      <button class="btn-connect-big" onclick="connectCalendar()">Connect</button>
    </div>`;
    return;
  }
  const store=getHabitStore(),now=new Date();

  // Build groups: habits sharing a group field are merged; ungrouped use their own id as key
  const groups={};
  HABITS.forEach(h=>{
    const key=h.group||h.id;
    if(!groups[key])groups[key]={key,label:h.label,members:[]};
    groups[key].members.push(h);
  });

  // Streaks — per group, skip days where no member is scheduled, break on scheduled+unmarked past days
  const streaks={};
  Object.values(groups).forEach(g=>{
    let streak=0,didCount=0;
    for(let i=0;i<90;i++){
      const d=new Date(now);d.setDate(now.getDate()-i);
      const ds=dkey(d),dk=DAYS[JS2IDX[d.getDay()]];
      const scheduled=g.members.filter(h=>getHabitsForDay(dk,ds).find(x=>x.id===h.id));
      if(!scheduled.length)continue;
      const sts=scheduled.map(h=>(store[ds]||{})[h.id]);
      const did=sts.some(s=>s==='did'),delayed=sts.some(s=>s==='delayed');
      if(did||delayed){streak++;if(did)didCount++;}
      else if(i===0){continue;} // today not yet marked — don't break
      else{break;}
    }
    streaks[g.key]={id:g.key,label:g.label,streak,didCount};
  });
  // Only include groups scheduled at least once since Apr 1
  const qStart=new Date('2026-04-01T00:00:00');
  const scheduledSinceQ=Object.values(groups).filter(g=>
    Array.from({length:Math.ceil((now-qStart)/864e5)+1},(_,i)=>{const d=new Date(qStart);d.setDate(qStart.getDate()+i);return d;})
    .some(d=>g.members.some(h=>getHabitsForDay(DAYS[JS2IDX[d.getDay()]],dkey(d)).find(x=>x.id===h.id)))
  ).map(g=>g.key);
  const allSorted=Object.values(streaks).filter(x=>scheduledSinceQ.includes(x.id));
  // Top: highest streak, tiebreak by most 'did' (done beats delayed)
  const top5=[...allSorted].sort((a,b)=>b.streak-a.streak||b.didCount-a.didCount).slice(0,5);
  // Needs work: habits with recent skips (didnot), sorted by skip count in last 30 days
  const skipCounts={};
  Object.values(groups).forEach(g=>{
    let skips=0;
    for(let i=0;i<30;i++){
      const d=new Date(now);d.setDate(now.getDate()-i);
      const ds=dkey(d),dk=DAYS[JS2IDX[d.getDay()]];
      const scheduled=g.members.filter(h=>getHabitsForDay(dk,ds).find(x=>x.id===h.id));
      if(!scheduled.length)continue;
      if(scheduled.some(h=>(store[ds]||{})[h.id]==='didnot'))skips++;
    }
    skipCounts[g.key]=skips;
  });
  const bottom5=allSorted.filter(x=>skipCounts[x.id]>0).sort((a,b)=>skipCounts[b.id]-skipCounts[a.id]).slice(0,5);

  // Quarter grid: Apr 1 → today (capped at Aug 31)
  const gridStart=new Date("2026-04-01T00:00:00");
  const gridEnd=now<Q_END?now:Q_END;
  const days90=[];
  for(let d=new Date(gridStart);d<=gridEnd;d.setDate(d.getDate()+1)){days90.push(new Date(d));}

  // Only show groups scheduled at least once in quarter
  const visGroups=Object.values(groups).filter(g=>
    days90.some(d=>g.members.some(h=>getHabitsForDay(DAYS[JS2IDX[d.getDay()]],dkey(d)).find(x=>x.id===h.id)))
  );

  // Month label blocks for header
  const CELL_W=10; // cell width + gap
  let headerH='<div class="hdash-header-row">';
  let lastMo='',blockLen=0;
  const blocks=[];
  days90.forEach((d,i)=>{
    const mo=d.toLocaleDateString('en-AU',{month:'short'});
    if(mo!==lastMo){
      if(lastMo)blocks.push({label:lastMo,len:blockLen});
      lastMo=mo;blockLen=1;
    }else{blockLen++;}
    if(i===days90.length-1)blocks.push({label:lastMo,len:blockLen});
  });
  blocks.forEach(b=>{
    headerH+=`<div class="hdash-month-block" style="width:${b.len*CELL_W}px">${b.label}</div>`;
  });
  headerH+='</div>';

  let gridH='';
  visGroups.forEach(g=>{
    gridH+=`<div class="hdash-grid-row"><div class="hdash-habit-name" title="${g.label}">${g.label}</div>`;
    days90.forEach(d=>{
      const ds=dkey(d),dk=DAYS[JS2IDX[d.getDay()]];
      const scheduledMembers=g.members.filter(h=>getHabitsForDay(dk,ds).find(x=>x.id===h.id));
      if(!scheduledMembers.length){gridH+='<div class="hdash-cell hc-skip"></div>';return;}
      // Use status of the first marked member, or blank
      let st='';
      for(const h of scheduledMembers){const s=(store[ds]||{})[h.id];if(s){st=s;break;}}
      const cls=st==='did'?'hc-did':st==='delayed'?'hc-delayed':st==='didnot'?'hc-didnot':'hc-blank';
      const tipDate=d.toLocaleDateString('en-AU',{day:'numeric',month:'short'});
      gridH+=`<div class="hdash-cell ${cls}" onmouseenter="showTT(event,'${tipDate}: ${st||'not marked'}')" onmouseleave="hideTT()"></div>`;
    });
    gridH+='</div>';
  });

  // Habit consistency table (same data as old History tab)
  const qTotalDays=Math.round((Q_END-Q_START)/864e5)+1;
  const qElapsed=Math.max(1,Math.min(qTotalDays,Math.round((now-Q_START)/864e5)+1));
  const cG='rgba(51,182,121,0.8)',cR='rgba(239,68,68,0.7)',cA='rgba(245,158,11,0.8)';
  const consistGroups={};
  HABITS.forEach(h=>{const key=h.group||h.id;if(!consistGroups[key])consistGroups[key]={key,label:h.label,members:[]};consistGroups[key].members.push(h);});
  const habitStats=Object.values(consistGroups).map(g=>{
    let sched=0,done=0,delayed=0,skipped=0;
    for(let i=0;i<qElapsed;i++){
      const d=new Date(Q_START);d.setDate(Q_START.getDate()+i);
      const ds=dkey(d),dk=DAYS[JS2IDX[d.getDay()]];
      const members=g.members.filter(h=>getHabitsForDay(dk,ds).find(x=>x.id===h.id));
      if(!members.length)continue;
      sched++;
      const sts=members.map(h=>(store[ds]||{})[h.id]);
      if(sts.some(s=>s==='did'))done++;
      else if(sts.some(s=>s==='delayed'))delayed++;
      else if(sts.some(s=>s==='didnot'))skipped++;
    }
    const pct=sched?Math.round((done+delayed)/sched*100):0;
    return {label:g.label,sched,done,delayed,skipped,pct};
  }).filter(x=>x.sched>0).sort((a,b)=>b.pct-a.pct);

  let consistTableH='';
  if(habitStats.length){
    consistTableH=`<table class="monthly-table"><thead><tr>
      <th>Habit</th><th>Sched</th><th style="color:#33b679">Done</th><th style="color:#f59e0b">Delayed</th><th style="color:rgba(239,68,68,0.8)">Skipped</th><th class="pct-c">Rate</th>
    </tr></thead><tbody>`;
    habitStats.forEach(x=>{
      const barCol=x.pct>=80?cG:x.pct>=50?cA:cR;
      consistTableH+=`<tr>
        <td>${x.label}</td><td>${x.sched}</td>
        <td style="color:#33b679">${x.done}</td>
        <td style="color:#f59e0b">${x.delayed}</td>
        <td style="color:rgba(239,68,68,0.8)">${x.skipped}</td>
        <td><div style="display:flex;align-items:center;gap:6px">
          <div style="flex:1;height:4px;background:var(--surface2);border-radius:2px;min-width:40px"><div style="height:4px;border-radius:2px;background:${barCol};width:${x.pct}%"></div></div>
          <span class="pct-c">${x.pct}%</span>
        </div></td>
      </tr>`;
    });
    consistTableH+=`</tbody></table>`;
  } else {
    consistTableH=`<div class="no-data">No habit data yet.</div>`;
  }

  // No-porn streak
  const npInfo=getNoPornInfo();
  const npStreakCol=npInfo.streak>=30?'#33b679':npInfo.streak>=7?'#f59e0b':'rgba(239,68,68,0.8)';

  document.getElementById('main').innerHTML=`
    <div class="section-title">Habit Dashboard — Apr → Jun 2026</div>
    <div class="hdash-top">
      <div class="hdash-card">
        <div class="hdash-card-title">Top streaks 🔥</div>
        <div class="streak-list">
          ${top5.map(x=>`<div class="streak-item">
            <div class="streak-label">${x.label}</div>
            <div class="streak-num">${x.streak}</div>
            <div class="streak-badge">${x.streak>=7?'🔥':x.streak>=3?'⚡':'·'}</div>
          </div>`).join('')}
        </div>
      </div>
      <div class="hdash-card">
        <div class="hdash-card-title">Needs work ⚠️</div>
        <div class="streak-list">
          ${bottom5.length?bottom5.map(x=>`<div class="streak-item">
            <div class="streak-label">${x.label}</div>
            <div class="streak-num" style="color:rgba(239,68,68,0.8)">${skipCounts[x.id]}</div>
            <div class="streak-badge">✗</div>
          </div>`).join(''):'<div style="font-size:10px;color:var(--text-dim);padding:6px 0">No skipped habits 🎉</div>'}
        </div>
      </div>
    </div>

    <div class="hdash-card" style="margin-bottom:22px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <div class="hdash-card-title">No-Porn Streak 🧘</div>
          <div style="font-family:'Barlow Condensed',sans-serif;font-size:52px;font-weight:800;color:${npStreakCol};line-height:1">${npInfo.streak}</div>
          <div style="font-size:10px;color:var(--text-dim);margin-top:4px">days clean · best: ${npInfo.best} days</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">
          <button onclick="noPornReset()" style="padding:8px 16px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.35);color:rgba(239,68,68,0.85);border-radius:6px;font-family:'DM Mono',monospace;font-size:10px;cursor:pointer">I broke it today</button>
          ${npInfo.resetDate?`<div style="font-size:9px;color:var(--text-dim)">Last reset: ${npInfo.resetDate}</div>`:'<div style="font-size:9px;color:var(--text-dim)">Tracking since Apr 1</div>'}
        </div>
      </div>
    </div>

    <div class="section-title">Apr → Jun 2026 heat map</div>
    <div class="hdash-legend">
      <div class="hdash-legend-item"><div class="hdash-legend-dot" style="background:rgba(51,182,121,0.8)"></div><span class="hdash-legend-lbl">Done</span></div>
      <div class="hdash-legend-item"><div class="hdash-legend-dot" style="background:rgba(245,158,11,0.7)"></div><span class="hdash-legend-lbl">Delayed</span></div>
      <div class="hdash-legend-item"><div class="hdash-legend-dot" style="background:rgba(239,68,68,0.55)"></div><span class="hdash-legend-lbl">Skipped</span></div>
      <div class="hdash-legend-item"><div class="hdash-legend-dot" style="background:var(--surface2)"></div><span class="hdash-legend-lbl">Not marked</span></div>
    </div>
    <div class="hdash-grid-outer"><div class="hdash-grid-inner">${headerH}${gridH}</div></div>

    <div class="section-title" style="margin-top:8px">Consistency since Apr 1</div>
    ${consistTableH}
  `;
}

// ─── RESTORE GOALS FROM SHEETS ───────────────────────────────────────────────
// Always merges Sheets → localStorage. Sheets wins for any date that exists there.
// This means data is never lost just because localStorage was cleared or app reinstalled.
function isValidDateStr(s){return s&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(new Date(s).getTime());}

async function restoreGoalsFromSheet(){
  let restored=0;
  try{
    // HEALTH: merge Sheets into localStorage (Sheets wins per date)
    try{
      const h=await apiFetch(`${SHEETS_BASE}/values/${encodeURIComponent('Goals_Health!A:B')}`);
      const rows=(h.values||[]).filter(r=>isValidDateStr(r[0])&&r[1]);
      if(rows.length){
        const byDate={};
        getGoalsHealth().forEach(e=>{if(isValidDateStr(e.date))byDate[e.date]=e;});
        rows.forEach(r=>{byDate[r[0]]={date:r[0],weight:parseFloat(r[1])};});
        localStorage.setItem(GK_HEALTH,JSON.stringify(Object.values(byDate).sort((a,b)=>a.date.localeCompare(b.date))));
        restored++;
      }
    }catch(e){console.warn('Health restore:',e);}

    // MONEY (savings + gold): merge by date+type composite key
    try{
      const m=await apiFetch(`${SHEETS_BASE}/values/${encodeURIComponent('Goals_Money!A:C')}`);
      const rows=(m.values||[]).filter(r=>isValidDateStr(r[0])&&r[1]&&r[2]);
      if(rows.length){
        const byKey={};
        getGoalsMoney().forEach(e=>{if(isValidDateStr(e.date))byKey[e.date+'_'+e.type]=e;});
        rows.forEach(r=>{byKey[r[0]+'_'+r[1]]={date:r[0],type:r[1],amount:parseFloat(r[2])};});
        localStorage.setItem(GK_MONEY,JSON.stringify(Object.values(byKey).sort((a,b)=>a.date.localeCompare(b.date))));
        restored++;
      }
    }catch(e){console.warn('Money restore:',e);}

    // FAITH: merge Sheets into localStorage
    try{
      const f=await apiFetch(`${SHEETS_BASE}/values/${encodeURIComponent('Goals_Faith!A:B')}`);
      const rows=(f.values||[]).filter(r=>isValidDateStr(r[0])&&r[1]);
      if(rows.length){
        const byDate={};
        getGoalsFaith().forEach(e=>{if(isValidDateStr(e.date))byDate[e.date]=e;});
        rows.forEach(r=>{byDate[r[0]]={date:r[0],shlokas:parseInt(r[1])};});
        localStorage.setItem(GK_FAITH,JSON.stringify(Object.values(byDate).sort((a,b)=>a.date.localeCompare(b.date))));
        restored++;
      }
    }catch(e){console.warn('Faith restore:',e);}

    if(restored>0)showToast('Goals restored from Sheets ✓','ok');

    // Also restore custom goal definitions and logs
    await customGoalsSheetRestore();
    await customLogsSheetRestore();
  }catch(e){console.warn('Restore goals failed:',e);}
}

// ─── NO-PORN STREAK ──────────────────────────────────────────────────────────
const NK='gps_noporn';
const SETTINGS_TAB='Settings';

function getNoPornInfo(){
  try{
    const d=JSON.parse(localStorage.getItem(NK)||'{}');
    const resetDate=d.resetDate||null;
    const best=d.best||0;
    const startDate=resetDate?new Date(resetDate+'T00:00:00'):Q_START;
    const now=new Date();
    const streak=Math.max(0,Math.floor((now-startDate)/864e5));
    return {streak,best:Math.max(best,streak),resetDate};
  }catch{return{streak:0,best:0,resetDate:null};}
}

async function noPornSheetSave(){
  if(!accessToken)return;
  const d=JSON.parse(localStorage.getItem(NK)||'{}');
  try{
    // Upsert two rows in Settings tab: noporn_reset and noporn_best
    await apiWrite(`${SHEETS_BASE}/values/${encodeURIComponent(SETTINGS_TAB+'!A:B')}:clear`,'POST',{});
    await apiWrite(
      `${SHEETS_BASE}/values/${encodeURIComponent(SETTINGS_TAB+'!A1')}?valueInputOption=RAW`,
      'PUT',
      {values:[
        ['key','value'],
        ['noporn_reset', d.resetDate||''],
        ['noporn_best',  d.best||0]
      ]}
    );
  }catch(e){console.warn('NoPorn sheet save failed:',e);}
}

async function noPornSheetRestore(){
  if(!accessToken)return;
  try{
    const data=await apiFetch(`${SHEETS_BASE}/values/${encodeURIComponent(SETTINGS_TAB+'!A:B')}`);
    const rows=data.values||[];
    const map={};
    rows.slice(1).forEach(r=>{if(r[0]&&r[1]!==undefined)map[r[0]]=r[1];});
    if(!map['noporn_reset']&&!map['noporn_best'])return; // nothing saved yet
    const local=JSON.parse(localStorage.getItem(NK)||'{}');
    const sheetReset=map['noporn_reset']||null;
    const sheetBest=parseInt(map['noporn_best'])||0;
    // Restore resetDate only if localStorage is empty (reinstall scenario)
    const merged={
      resetDate: local.resetDate || sheetReset,
      best: Math.max(local.best||0, sheetBest)
    };
    localStorage.setItem(NK,JSON.stringify(merged));
  }catch(e){console.warn('NoPorn sheet restore failed:',e);}
}

function noPornReset(){
  if(!confirm('Reset your streak? This will record today as a reset date.'))return;
  const today=dkey(new Date());
  const cur=getNoPornInfo();
  const data={resetDate:today,best:Math.max(cur.best,cur.streak)};
  localStorage.setItem(NK,JSON.stringify(data));
  noPornSheetSave().catch(e=>console.warn('NoPorn save:',e));
  renderHabitDash();
}

// ─── TASKS TAB ───────────────────────────────────────────────────────────────
const TDK='gps_tasks_done';
const TASKS_DONE_TAB='Tasks_Done';
let calendarEventsCache=null;
let tasksDoneRowMap={};  // dateStr → sheet row number

function getTasksDone(){try{return JSON.parse(localStorage.getItem(TDK)||'{}')}catch{return{}}}
function saveTasksDone(d){localStorage.setItem(TDK,JSON.stringify(d))}

async function toggleTaskDone(dateStr,eventId){
  const d=getTasksDone();
  if(!d[dateStr])d[dateStr]=[];
  const idx=d[dateStr].indexOf(eventId);
  const nowDone=idx<0;
  if(idx>=0)d[dateStr].splice(idx,1);else d[dateStr].push(eventId);
  saveTasksDone(d);
  tasksDoneSheetWrite(dateStr,d[dateStr]).catch(e=>console.warn('Tasks_Done sheet:',e));

  // If it's a Google Task, mark complete/incomplete in Google Tasks
  if(eventId.startsWith('gtask_')&&accessToken&&calendarEventsCache){
    const ev=calendarEventsCache.find(e=>e.id===eventId);
    if(ev&&ev._listId&&ev._taskId){
      try{
        await apiWrite(
          `https://tasks.googleapis.com/tasks/v1/lists/${ev._listId}/tasks/${ev._taskId}`,
          'PATCH',
          nowDone
            ?{status:'completed',completed:new Date().toISOString()}
            :{status:'needsAction',completed:null}
        );
        showToast(nowDone?'Task completed ✓':'Task reopened','ok');
        // Wipe cache so the completed task disappears on next refresh
        if(nowDone)calendarEventsCache=null;
      }catch(e){
        showToast('Google Tasks sync failed','err');
        console.warn('Task sync failed:',e);
      }
    }
  }

  renderTasks();
}

// ── Sheets for Tasks Done ──
async function tasksDoneSheetInit(){
  if(!accessToken)return;
  try{
    const data=await apiFetch(`${SHEETS_BASE}/values/${encodeURIComponent(TASKS_DONE_TAB+'!A:C')}`);
    const rows=data.values||[];
    if(rows.length===0){
      // Create header row
      await apiWrite(
        `${SHEETS_BASE}/values/${encodeURIComponent(TASKS_DONE_TAB+'!A1:C1')}?valueInputOption=RAW`,
        'PUT',{values:[['Date','Day','DoneIds']]}
      );
    }else{
      tasksDoneRowMap={};
      const store=getTasksDone();
      let changed=false;
      rows.forEach((row,i)=>{
        if(i===0||!isValidDateStr(row[0]))return;
        tasksDoneRowMap[row[0]]=i+1;
        // Restore from Sheets if local has nothing for that date
        if(!store[row[0]]&&row[2]){
          try{store[row[0]]=JSON.parse(row[2]);changed=true;}catch{}
        }
      });
      if(changed){saveTasksDone(store);showToast('Task ticks restored from Sheets','ok');}
    }
  }catch(err){console.warn('Tasks_Done sheet init:',err);}
}

async function tasksDoneSheetWrite(ds,ids){
  if(!accessToken)return;
  const d=new Date(ds+'T00:00:00');
  const dayKey=DAYS[JS2IDX[d.getDay()]]||'';
  const row=[ds,dayKey,JSON.stringify(ids)];
  try{
    if(tasksDoneRowMap[ds]){
      const r=tasksDoneRowMap[ds];
      await apiWrite(
        `${SHEETS_BASE}/values/${encodeURIComponent(TASKS_DONE_TAB+'!A'+r+':C'+r)}?valueInputOption=RAW`,
        'PUT',{values:[row]}
      );
    }else{
      const res=await apiWrite(
        `${SHEETS_BASE}/values/${encodeURIComponent(TASKS_DONE_TAB+'!A:C')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        'POST',{values:[row]}
      );
      const match=(res.updates?.updatedRange||'').match(/(\d+):/);
      if(match)tasksDoneRowMap[ds]=parseInt(match[1]);
    }
  }catch(err){console.warn('Tasks_Done write failed:',err);}
}

// ─── GOOGLE TASKS FETCH ───────────────────────────────────────────────────────
async function fetchGoogleTasks(){
  if(!accessToken)return[];
  try{
    const lists=await apiFetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=20');
    const allTasks=[];
    await Promise.all((lists.items||[]).map(async list=>{
      try{
        const data=await apiFetch(
          `https://tasks.googleapis.com/tasks/v1/lists/${list.id}/tasks`+
          `?showCompleted=false&showHidden=false&maxResults=100`
        );
        (data.items||[]).forEach(t=>{
          if(!t.title||t.status==='completed')return;
          // due comes as RFC3339 UTC e.g. "2026-04-22T00:00:00.000Z"
          const dueDate=t.due?t.due.slice(0,10):null;
          allTasks.push({
            id:'gtask_'+t.id,
            summary:t.title,
            start:{date:dueDate},
            _calName:'📋 '+list.title,
            _isGTask:true,
            _listId:list.id,
            _taskId:t.id,
            notes:t.notes||''
          });
        });
      }catch(e){console.warn('Task list fetch failed:',list.title,e);}
    }));
    return allTasks;
  }catch(e){console.warn('Google Tasks fetch failed:',e);return[];}
}

async function fetchCalendarEvents(){
  // Google Tasks only — no calendar events
  if(!accessToken)return null;
  try{
    return await fetchGoogleTasks();
  }catch(e){console.warn('Tasks fetch failed:',e);return[];}
}

async function renderTasks(){
  const now=new Date();
  const todayStr=dkey(now);

  if(!accessToken){
    document.getElementById('main').innerHTML=`<div class="connect-screen">
      <h2>Connect Google</h2>
      <p>Connect your Google account to pull tasks from Google Tasks.</p>
      <button class="btn-connect-big" onclick="connectCalendar()">Connect</button>
    </div>`;
    return;
  }

  document.getElementById('main').innerHTML=`
    <div class="section-title">Tasks</div>
    <div id="tasks-body"><div class="no-data" style="opacity:.5">Loading…</div></div>`;

  if(!calendarEventsCache){
    calendarEventsCache=await fetchCalendarEvents();
  }

  const done=getTasksDone();
  const all=calendarEventsCache||[];

  // Bucket tasks
  const overdue=[],today=[],upcoming=[],noDate=[];
  all.forEach(ev=>{
    const dueStr=ev.start?.date||ev.start?.dateTime?.slice(0,10)||null;
    if(!dueStr){noDate.push(ev);return;}
    if(dueStr<todayStr)overdue.push({...ev,_dueStr:dueStr});
    else if(dueStr===todayStr)today.push({...ev,_dueStr:dueStr});
    else upcoming.push({...ev,_dueStr:dueStr});
  });
  overdue.sort((a,b)=>a._dueStr.localeCompare(b._dueStr));
  upcoming.sort((a,b)=>a._dueStr.localeCompare(b._dueStr));

  const totalDone=Object.values(done).flat().length;
  const totalAll=overdue.length+today.length+upcoming.length+noDate.length;

  function fmtDue(dueStr){
    const d=new Date(dueStr+'T00:00:00');
    return d.toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'short'});
  }
  function daysDiff(dueStr){
    const d=new Date(dueStr+'T00:00:00'),t=new Date(todayStr+'T00:00:00');
    return Math.round((t-d)/864e5);
  }

  function taskRow(ev,bucketDateStr,isOverdue){
    const isDone=(done[bucketDateStr]||[]).includes(ev.id);
    const startDT=ev.start?.dateTime?new Date(ev.start.dateTime):null;
    const timeStr=startDT?startDT.toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit',hour12:true}):null;
    const dueLine=ev._dueStr
      ?(isOverdue
          ?`<span style="color:rgba(239,68,68,0.85);font-weight:600">${daysDiff(ev._dueStr)}d overdue · ${fmtDue(ev._dueStr)}</span>`
          :`<span style="color:var(--text-dim)">${fmtDue(ev._dueStr)}${timeStr?' · '+timeStr:''}</span>`)
      :`<span style="color:var(--text-dim)">No due date</span>`;
    const leftBorder=isOverdue?'rgba(239,68,68,0.7)':'var(--border)';
    const bgRow=isOverdue&&!isDone?'rgba(239,68,68,0.05)':'';
    return`<div class="task-row${isDone?' done':''}" style="${bgRow?'background:'+bgRow+';':''} border-left-color:${leftBorder}"
        onclick="toggleTaskDone('${bucketDateStr}','${ev.id.replace(/'/g,"\\'")}')">
      <div class="task-check">${isDone?'✓':''}</div>
      <div style="flex:1;min-width:0">
        <div class="task-label" style="white-space:normal;word-break:break-word">${ev.summary}</div>
        <div style="font-size:9px;margin-top:3px">${dueLine}</div>
      </div>
      <div style="font-size:8px;color:var(--text-dim);flex-shrink:0;max-width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right">${ev._calName||''}</div>
    </div>`;
  }

  function sectionHdr(label,count,col){
    return`<div style="font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:20px 0 8px;color:${col||'var(--text-mid)'};">${label} <span style="font-size:10px;opacity:.6">(${count})</span></div>`;
  }

  let bodyHtml='';

  if(!totalAll){
    bodyHtml=`<div class="no-data">No tasks or events found.<br><span style="font-size:9px;color:var(--text-dim);line-height:2">Pulls from Google Calendar (excluding Habits) and Google Tasks.<br>Make sure Tasks API is enabled in Google Cloud Console.</span></div>`;
  } else {
    // Summary
    const doneToday=(done[todayStr]||[]).length;
    const totalToday=today.length;
    bodyHtml+=`<div style="font-size:10px;color:var(--text-dim);margin-bottom:4px">${overdue.length} overdue · ${totalToday} today · ${upcoming.length} upcoming · ${noDate.length} no date</div>`;

    if(overdue.length){
      bodyHtml+=sectionHdr('⚠ Overdue',overdue.length,'rgba(239,68,68,0.85)');
      bodyHtml+=`<div style="display:flex;flex-direction:column;gap:4px">`;
      overdue.forEach(ev=>bodyHtml+=taskRow(ev,ev._dueStr,true));
      bodyHtml+=`</div>`;
    }
    if(today.length){
      bodyHtml+=sectionHdr('Today',today.length,'var(--accent)');
      bodyHtml+=`<div style="display:flex;flex-direction:column;gap:4px">`;
      today.forEach(ev=>bodyHtml+=taskRow(ev,todayStr,false));
      bodyHtml+=`</div>`;
    }
    if(upcoming.length){
      bodyHtml+=sectionHdr('Upcoming',upcoming.length,'var(--text-mid)');
      bodyHtml+=`<div style="display:flex;flex-direction:column;gap:4px">`;
      upcoming.forEach(ev=>bodyHtml+=taskRow(ev,ev._dueStr,false));
      bodyHtml+=`</div>`;
    }
    if(noDate.length){
      bodyHtml+=sectionHdr('No due date',noDate.length,'var(--text-dim)');
      bodyHtml+=`<div style="display:flex;flex-direction:column;gap:4px">`;
      noDate.forEach(ev=>bodyHtml+=taskRow(ev,todayStr,false));
      bodyHtml+=`</div>`;
    }
  }

  bodyHtml+=`<button onclick="calendarEventsCache=null;renderTasks()" style="margin-top:20px;padding:7px 14px;background:var(--accent-dim);border:1px solid rgba(245,158,11,0.3);color:var(--accent);border-radius:5px;font-family:'DM Mono',monospace;font-size:9px;cursor:pointer">↻ Refresh tasks</button>`;

  const tb=document.getElementById('tasks-body');
  if(tb)tb.innerHTML=bodyHtml;
}

// ─── CUSTOM GOALS SHEET BACKUP ───────────────────────────────────────────────
// Backs up goal definitions (name/target/unit) to Goals_Config tab so they
// survive localStorage clears. Called on every save/delete.
const GOALS_CFG_TAB='Goals_Config';

async function customGoalsSheetBackup(){
  if(!accessToken)return;
  const goals=getCustomGoals();
  const rows=[['id','category','name','target','unit'],...goals.map(g=>[g.id,g.category,g.name,g.target,g.unit])];
  try{
    await apiWrite(`${SHEETS_BASE}/values/${encodeURIComponent(GOALS_CFG_TAB+'!A:E')}:clear`,'POST',{});
    await apiWrite(`${SHEETS_BASE}/values/${encodeURIComponent(GOALS_CFG_TAB+'!A1')}?valueInputOption=RAW`,'PUT',{values:rows});
  }catch(e){console.warn('Goals_Config backup failed:',e);}
}

async function customGoalsSheetRestore(){
  if(!accessToken)return;
  try{
    const data=await apiFetch(`${SHEETS_BASE}/values/${encodeURIComponent(GOALS_CFG_TAB+'!A:E')}`);
    const rows=(data.values||[]).slice(1).filter(r=>r[0]&&r[1]&&r[2]);
    if(!rows.length)return;
    const existing=getCustomGoals();
    const existingIds=new Set(existing.map(g=>g.id));
    let added=0;
    rows.forEach(r=>{
      if(!existingIds.has(r[0])){
        existing.push({id:r[0],category:r[1],name:r[2],target:parseFloat(r[3])||0,unit:r[4]||''});
        added++;
      }
    });
    if(added>0){saveCustomGoals(existing);showToast(`${added} goal def${added!==1?'s':''} restored from Sheets ✓`,'ok');}
  }catch(e){console.warn('Goals_Config restore failed:',e);}
}

// Also restore custom logs from Goals_Custom sheet
async function customLogsSheetRestore(){
  if(!accessToken)return;
  try{
    const data=await apiFetch(`${SHEETS_BASE}/values/${encodeURIComponent('Goals_Custom!A:E')}`);
    const rows=(data.values||[]).filter(r=>isValidDateStr(r[0])&&r[1]&&r[4]);
    if(!rows.length)return;
    const logs=getCustomLogs();
    let added=0;
    rows.forEach(r=>{
      const id=r[1],val=parseFloat(r[4]);
      if(!id||isNaN(val))return;
      if(!logs[id])logs[id]=[];
      const exists=logs[id].some(e=>e.date===r[0]&&e.value===val);
      if(!exists){logs[id].push({date:r[0],value:val});added++;}
    });
    if(added>0){saveCustomLogs(logs);showToast(`${added} custom log entries restored`,'ok');}
  }catch(e){console.warn('Goals_Custom restore failed:',e);}
}

// ─── BOOTSTRAP ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

// ─── CALORIE TRACKER (STUB) ───────────────────────────────────────────────────
function renderCalories(){
  document.getElementById('main').innerHTML=`
    <div class="section-title">Calorie Tracker</div>
    <div class="no-data" style="padding:48px 20px;text-align:center">
      <strong style="display:block;font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:700;letter-spacing:1px;color:var(--text-mid);margin-bottom:12px">Coming Soon</strong>
      <span style="font-size:11px;color:var(--text-dim);line-height:2">
        This tab will track daily calorie intake.<br>
        Tap a food item → calories auto-added.<br>
        See daily total vs. your target.
      </span>
    </div>`;
}