import{h as b}from"./chunk-JDBS4NQN.js";import{c as C}from"./chunk-CDZVSKFK.js";import{a as w,b as p,i as h}from"./chunk-GYVY4MO2.js";import{D as u,M as T,d,e as o,k as $,n as y,p as m,q as g,r as _,u as x}from"./chunk-UHEN6QX4.js";var E={event:"#8b5cf6",meeting:"#0ea5e9",task:"#10b981"},M={event:"calendar-days",meeting:"users",task:"square-check-big"};function c(s,a,t,n,l="",r=""){return d`<a class="card stat hoverable" style="--c:${n};color:inherit;text-decoration:none" href="${r||"#/"}">
    <div class="row between"><span class="stat-icon">${o(t)}</span>${l?d`<span class="stat-foot">${l}</span>`:""}</div>
    <div class="stat-value" data-count="${a}">0</div><div class="stat-label">${s}</div></a>`}function q(s){let a=$(s.start),t=s.all_day?"All day":m(s.start),n=s.type==="meeting"?`#/meetings/${s.id}`:s.type==="task"?`#/tasks?open=${s.id}`:`#/calendar?event=${s.id}&date=${s.start.slice(0,10)}`;return d`<a class="agenda-item" href="${n}" style="color:inherit;text-decoration:none">
    <div class="agenda-time">${t}</div><span class="agenda-bar" style="--c:${s.color||E[s.type]}"></span>
    <div class="grow" style="min-width:0"><div class="truncate" style="font-weight:580;${s.status==="completed"?"text-decoration:line-through;color:var(--text-3)":""}">${s.title}</div>
      <div class="small subtle row" style="gap:6px">${o(M[s.type],"sm")} ${s.type==="task"?"Task":s.type==="meeting"?"Meeting":s.event_type||"Event"}${s.location?d` · ${s.location}`:""}${a&&s.type!=="task"&&!s.all_day?d` · until ${m(s.end)}`:""}</div></div></a>`}function S(s,a){let t=a.counts,n=a.progress,l=(w.user.name||"").split(" ")[0],r=Math.max(1,...a.notes_series.map(e=>e.count)),i=[...a.today];s.innerHTML=String(d`
  <div class="hero"><div><h1>${x()}, ${l}</h1><p>${new Date().toLocaleDateString(void 0,{weekday:"long",day:"numeric",month:"long",year:"numeric"})} · ${i.length?`${i.length} item${i.length>1?"s":""} on your agenda today`:"Your agenda is clear today"}</p></div>
    <div class="row"><a class="btn" href="#/calendar">${o("calendar-days","sm")} Calendar</a><button class="btn primary" data-qc="note">${o("plus","sm")} New note</button></div></div>

  <div class="quick-create">${b.map(e=>d`<button class="qc" style="--c:${e.color}" data-qc="${e.key}"><span class="qc-icon">${o(e.icon)}</span><span>${e.key==="note"?"New Note":e.label}<small>${e.sub}</small></span></button>`)}</div>

  <div class="stats-grid">
    ${c("Total notes",t.notes,"notebook-pen","#6366f1",t.notes_today?`+${t.notes_today} today`:"","#/notes")}
    ${c("Notes today",t.notes_today,"sparkles","#ec4899","","#/notes?sort=created")}
    ${c("Active tasks",t.tasks_active,"circle-dot","#f59e0b",t.tasks_overdue?`${t.tasks_overdue} overdue`:"","#/tasks")}
    ${c("Completed tasks",t.tasks_completed,"circle-check","#10b981","","#/tasks?status=completed")}
    ${c("Upcoming meetings",t.meetings_upcoming,"users","#0ea5e9","","#/meetings")}
    ${c("Upcoming schedule",t.events_upcoming,"calendar-clock","#8b5cf6","30 days","#/calendar")}
    ${c("Audio notes",t.audio,"mic","#db2777","","#/audio")}
    ${c("Mind maps",t.mindmaps,"network","#eab308","","#/mindmaps")}
    ${c("Flowcharts",t.flowcharts,"workflow","#14b8a6","","#/flowcharts")}
  </div>

  <div class="dash-grid">
    <div class="col" style="gap:var(--gap)">
      <div class="card"><div class="card-head"><h3>${o("sun","sm")} Today</h3><a class="btn ghost sm" href="#/calendar?view=day">Open day ${o("chevron-right","sm")}</a></div>
        <div class="card-body">
          <div class="grid grid-2" style="gap:24px">
            <div><div class="label mb-1">Agenda & meetings</div>
              ${i.filter(e=>e.type!=="task").length?i.filter(e=>e.type!=="task").map(q):d`<p class="small subtle" style="padding:10px 0">No meetings or events today.</p>`}</div>
            <div><div class="label mb-1">Tasks due</div>
              ${a.today_tasks.length?a.today_tasks.map(e=>d`<div class="row" style="padding:7px 0;border-bottom:1px dashed var(--border)">
                <button class="t-check prio-${e.priority}" data-done="${e.id}" aria-label="Complete">${o("check")}</button>
                <a class="grow truncate" href="#/tasks?open=${e.id}" style="color:inherit">${e.title}</a>
                <span class="tiny ${e.due_date<y()?"overdue":"subtle"}">${e.due_date<y()?g(e.due_date):e.due_time||"Today"}</span></div>`):d`<p class="small subtle" style="padding:10px 0">Nothing due. Nice work!</p>`}</div>
          </div>
        </div></div>
      <div class="card"><div class="card-head"><h3>${o("history","sm")} Recent notes</h3><a class="btn ghost sm" href="#/notes">View all ${o("chevron-right","sm")}</a></div>
        <div class="card-body">${a.recent_notes.length?d`<div class="grid grid-3" style="gap:12px">${a.recent_notes.map(e=>d`
          <a class="note-card" data-nc="${e.color||""}" href="#/notes/${e.id}" style="margin:0">
            ${e.is_pinned?d`<span class="nc-pin">${o("pin","sm")}</span>`:""}
            <h3>${e.title||"Untitled"}</h3><div class="nc-body" style="-webkit-line-clamp:3">${e.excerpt||""}</div>
            <div class="nc-meta">${o("clock","sm")} ${_(e.last_opened_at||e.updated_at)}</div></a>`)}</div>`:T({icon:"notebook-pen",title:"No notes yet",text:"Create your first note to see it here.",action:'<button class="btn primary" data-qc="note">New note</button>'})}</div></div>
    </div>
    <div class="col" style="gap:var(--gap)">
      <div class="card"><div class="card-head"><h3>${o("chart-pie","sm")} Task progress</h3><a class="btn ghost sm" href="#/tasks?view=board">Board</a></div>
        <div class="card-body"><div class="row" style="gap:22px">
          <div class="ring" style="--v:${n.percent}"><span>${n.percent}%</span></div>
          <div class="col" style="gap:8px;flex:1">
            <div class="row between small"><span class="muted">Completed</span><b>${n.completed}</b></div>
            <div class="row between small"><span class="muted">In progress</span><b>${n.in_progress}</b></div>
            <div class="row between small"><span class="muted">Total</span><b>${n.total}</b></div>
            ${t.tasks_overdue?d`<div class="badge danger">${o("alert-triangle","sm")} ${t.tasks_overdue} overdue</div>`:""}
          </div></div>
          <div class="progress mt-3"><span style="width:${n.percent}%"></span></div></div></div>
      <div class="card"><div class="card-head"><h3>${o("calendar-clock","sm")} Upcoming</h3><a class="btn ghost sm" href="#/calendar">Calendar</a></div>
        <div class="card-body">${a.upcoming.length?a.upcoming.map(e=>{let v=$(e.start);return d`<a class="row" href="${e.type==="meeting"?`#/meetings/${e.id}`:`#/calendar?event=${e.id}&date=${e.start.slice(0,10)}`}" style="padding:8px 0;color:inherit;text-decoration:none;border-bottom:1px dashed var(--border)">
            <div class="date-block"><span>${v.toLocaleDateString(void 0,{month:"short"})}</span><b>${v.getDate()}</b></div>
            <div class="grow" style="min-width:0"><div class="truncate" style="font-weight:580">${e.title}</div><div class="small subtle">${g(e.start)} · ${e.all_day?"All day":m(e.start)} · ${e.type==="meeting"?"Meeting":e.event_type||"Event"}</div></div></a>`}):d`<p class="small subtle">Nothing scheduled in the next two weeks.</p>`}</div></div>
      <div class="card"><div class="card-head"><h3>${o("activity","sm")} Notes this week</h3></div>
        <div class="card-body"><div class="spark">${a.notes_series.map((e,v)=>d`<span class="${v===6?"today":""}" style="height:${Math.max(6,e.count/r*100)}%" data-tip="${e.count} on ${e.date}"></span>`)}</div>
          <div class="row between tiny subtle mt-1"><span>${g(a.notes_series[0].date)}</span><span>Today</span></div></div></div>
    </div>
  </div>`),s.querySelectorAll("[data-count]").forEach(e=>{let v=+e.dataset.count,A=performance.now(),k=N=>{let f=Math.min(1,(N-A)/600);e.textContent=Math.round(v*(1-(1-f)**3)).toLocaleString(),f<1&&requestAnimationFrame(k)};requestAnimationFrame(k)})}var F={title:"Dashboard",async render(s){s.innerHTML=String(d`<div class="hero"><div><div class="skeleton" style="width:260px;height:30px"></div><div class="skeleton sk-line" style="width:340px"></div></div></div>
      <div class="quick-create">${Array.from({length:6},()=>d`<div class="skeleton" style="height:96px;border-radius:16px"></div>`)}</div>
      <div class="stats-grid">${Array.from({length:6},()=>d`<div class="skeleton" style="height:118px;border-radius:18px"></div>`)}</div>`);let a=async()=>{try{S(s,await h.get("dashboard"))}catch(n){u(n)}};await a(),s.addEventListener("click",async n=>{let l=n.target.closest("[data-qc]");if(l)return b.find(i=>i.key===l.dataset.qc)?.run();let r=n.target.closest("[data-done]");if(r){r.classList.add("on");try{await h.post(`tasks/${r.dataset.done}/status`,{status:"completed"}),setTimeout(a,400)}catch(i){u(i)}}});let t=[p("tasks:changed",a),p("calendar:changed",a),p("audio:changed",a),p("meetings:changed",a)];return()=>t.forEach(n=>n())}};export{F as default,C as navigate};
