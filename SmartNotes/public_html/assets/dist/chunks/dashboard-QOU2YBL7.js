import{h as b}from"./chunk-7KRCQL4F.js";import{c as C}from"./chunk-CDZVSKFK.js";import{a as w,b as p,i as $}from"./chunk-OBJ2GABS.js";import{D as u,M as T,d as t,e as n,k as g,n as y,p as m,q as h,r as _,u as x}from"./chunk-J465JRE2.js";var E={event:"#8b5cf6",meeting:"#0ea5e9",task:"#10b981"},S={event:"calendar-days",meeting:"users",task:"square-check-big"};function o(s,a,d,i,r="",l=""){return t`<a class="card stat hoverable" style="--c:${i};color:inherit;text-decoration:none" href="${l||"#/"}">
    <div class="row between"><span class="stat-icon">${n(d)}</span>${r?t`<span class="stat-foot">${r}</span>`:""}</div>
    <div class="stat-value" data-count="${a}">0</div><div class="stat-label">${s}</div></a>`}function M(s){let a=g(s.start),d=s.all_day?"All day":m(s.start),i=s.type==="meeting"?`#/meetings/${s.id}`:s.type==="task"?`#/tasks?open=${s.id}`:`#/calendar?event=${s.id}&date=${s.start.slice(0,10)}`;return t`<a class="agenda-item" href="${i}" style="color:inherit;text-decoration:none">
    <div class="agenda-time">${d}</div><span class="agenda-bar" style="--c:${s.color||E[s.type]}"></span>
    <div class="grow" style="min-width:0"><div class="truncate" style="font-weight:580;${s.status==="completed"?"text-decoration:line-through;color:var(--text-3)":""}">${s.title}</div>
      <div class="small subtle row" style="gap:6px">${n(S[s.type],"sm")} ${s.type==="task"?"Task":s.type==="meeting"?"Meeting":s.event_type||"Event"}${s.location?t` · ${s.location}`:""}${a&&s.type!=="task"&&!s.all_day?t` · until ${m(s.end)}`:""}</div></div></a>`}function q(s,a){let d=a.counts,i=a.progress,r=(w.user.name||"").split(" ")[0],l=Math.max(1,...a.notes_series.map(e=>e.count)),c=[...a.today];s.innerHTML=String(t`
  <div class="hero"><div><h1>${x()}, ${r}</h1><p>${new Date().toLocaleDateString(void 0,{weekday:"long",day:"numeric",month:"long",year:"numeric"})} · ${c.length?`${c.length} item${c.length>1?"s":""} on your agenda today`:"Your agenda is clear today"}</p></div>
    <div class="row"><a class="btn" href="#/calendar">${n("calendar-days","sm")} Calendar</a><button class="btn primary" data-qc="note">${n("plus","sm")} New note</button></div></div>

  <div class="quick-create">${b.map(e=>t`<button class="qc" style="--c:${e.color}" data-qc="${e.key}"><span class="qc-icon">${n(e.icon)}</span><span>${e.key==="note"?"New Note":e.label}<small>${e.sub}</small></span></button>`)}</div>

  <div class="stats-grid">
    ${o("Total notes",d.notes,"notebook-pen","#6366f1",d.notes_today?`+${d.notes_today} today`:"","#/notes")}
    ${o("Notes today",d.notes_today,"sparkles","#ec4899","","#/notes?sort=created")}
    ${o("Active tasks",d.tasks_active,"circle-dot","#f59e0b",d.tasks_overdue?`${d.tasks_overdue} overdue`:"","#/tasks")}
    ${o("Completed tasks",d.tasks_completed,"circle-check","#10b981","","#/tasks?status=completed")}
    ${o("Upcoming meetings",d.meetings_upcoming,"users","#0ea5e9","","#/meetings")}
    ${o("Upcoming schedule",d.events_upcoming,"calendar-clock","#8b5cf6","30 days","#/calendar")}
    ${o("Audio notes",d.audio,"mic","#db2777","","#/audio")}
    ${o("Mind maps",d.mindmaps,"network","#eab308","","#/mindmaps")}
    ${o("Flowcharts",d.flowcharts,"workflow","#14b8a6","","#/flowcharts")}
    ${o("Drive files",d.drive_files,"hard-drive","#0891b2","","#/drive")}
    ${o("Shared with me",d.shared_with_me,"users","#7c3aed","","#/notes?filter=shared")}
  </div>

  <div class="dash-grid">
    <div class="col" style="gap:var(--gap)">
      <div class="card"><div class="card-head"><h3>${n("sun","sm")} Today</h3><a class="btn ghost sm" href="#/calendar?view=day">Open day ${n("chevron-right","sm")}</a></div>
        <div class="card-body">
          <div class="grid grid-2" style="gap:24px">
            <div><div class="label mb-1">Agenda & meetings</div>
              ${c.filter(e=>e.type!=="task").length?c.filter(e=>e.type!=="task").map(M):t`<p class="small subtle" style="padding:10px 0">No meetings or events today.</p>`}</div>
            <div><div class="label mb-1">Tasks due</div>
              ${a.today_tasks.length?a.today_tasks.map(e=>t`<div class="row" style="padding:7px 0;border-bottom:1px dashed var(--border)">
                <button class="t-check prio-${e.priority}" data-done="${e.id}" aria-label="Complete">${n("check")}</button>
                <a class="grow truncate" href="#/tasks?open=${e.id}" style="color:inherit">${e.title}</a>
                <span class="tiny ${e.due_date<y()?"overdue":"subtle"}">${e.due_date<y()?h(e.due_date):e.due_time||"Today"}</span></div>`):t`<p class="small subtle" style="padding:10px 0">Nothing due. Nice work!</p>`}</div>
          </div>
        </div></div>
      ${a.shared_notes.length?t`<div class="card"><div class="card-head"><h3>${n("users","sm")} Shared with me</h3><a class="btn ghost sm" href="#/notes?filter=shared">View all ${n("chevron-right","sm")}</a></div>
        <div class="card-body"><div class="grid grid-3" style="gap:12px">${a.shared_notes.map(e=>t`
          <a class="note-card" data-nc="${e.color||""}" href="#/notes/${e.id}" style="margin:0">
            ${e.is_pinned?t`<span class="nc-pin">${n("pin","sm")}</span>`:""}
            <h3>${e.title||"Untitled"}</h3><div class="nc-body" style="-webkit-line-clamp:3">${e.excerpt||""}</div>
            <div class="nc-meta"><span class="badge info">${n("user","sm")} ${e.owner_name}</span><span>${e.permission==="edit"?"can edit":"view"}</span></div></a>`)}</div></div></div>`:""}
      <div class="card"><div class="card-head"><h3>${n("history","sm")} Recent notes</h3><a class="btn ghost sm" href="#/notes">View all ${n("chevron-right","sm")}</a></div>
        <div class="card-body">${a.recent_notes.length?t`<div class="grid grid-3" style="gap:12px">${a.recent_notes.map(e=>t`
          <a class="note-card" data-nc="${e.color||""}" href="#/notes/${e.id}" style="margin:0">
            ${e.is_pinned?t`<span class="nc-pin">${n("pin","sm")}</span>`:""}
            <h3>${e.title||"Untitled"}</h3><div class="nc-body" style="-webkit-line-clamp:3">${e.excerpt||""}</div>
            <div class="nc-meta">${n("clock","sm")} ${_(e.last_opened_at||e.updated_at)}</div></a>`)}</div>`:T({icon:"notebook-pen",title:"No notes yet",text:"Create your first note to see it here.",action:'<button class="btn primary" data-qc="note">New note</button>'})}</div></div>
    </div>
    <div class="col" style="gap:var(--gap)">
      <div class="card"><div class="card-head"><h3>${n("chart-pie","sm")} Task progress</h3><a class="btn ghost sm" href="#/tasks?view=board">Board</a></div>
        <div class="card-body"><div class="row" style="gap:22px">
          <div class="ring" style="--v:${i.percent}"><span>${i.percent}%</span></div>
          <div class="col" style="gap:8px;flex:1">
            <div class="row between small"><span class="muted">Completed</span><b>${i.completed}</b></div>
            <div class="row between small"><span class="muted">In progress</span><b>${i.in_progress}</b></div>
            <div class="row between small"><span class="muted">Total</span><b>${i.total}</b></div>
            ${d.tasks_overdue?t`<div class="badge danger">${n("alert-triangle","sm")} ${d.tasks_overdue} overdue</div>`:""}
          </div></div>
          <div class="progress mt-3"><span style="width:${i.percent}%"></span></div></div></div>
      <div class="card"><div class="card-head"><h3>${n("calendar-clock","sm")} Upcoming</h3><a class="btn ghost sm" href="#/calendar">Calendar</a></div>
        <div class="card-body">${a.upcoming.length?a.upcoming.map(e=>{let v=g(e.start);return t`<a class="row" href="${e.type==="meeting"?`#/meetings/${e.id}`:`#/calendar?event=${e.id}&date=${e.start.slice(0,10)}`}" style="padding:8px 0;color:inherit;text-decoration:none;border-bottom:1px dashed var(--border)">
            <div class="date-block"><span>${v.toLocaleDateString(void 0,{month:"short"})}</span><b>${v.getDate()}</b></div>
            <div class="grow" style="min-width:0"><div class="truncate" style="font-weight:580">${e.title}</div><div class="small subtle">${h(e.start)} · ${e.all_day?"All day":m(e.start)} · ${e.type==="meeting"?"Meeting":e.event_type||"Event"}</div></div></a>`}):t`<p class="small subtle">Nothing scheduled in the next two weeks.</p>`}</div></div>
      <div class="card"><div class="card-head"><h3>${n("activity","sm")} Notes this week</h3></div>
        <div class="card-body"><div class="spark">${a.notes_series.map((e,v)=>t`<span class="${v===6?"today":""}" style="height:${Math.max(6,e.count/l*100)}%" data-tip="${e.count} on ${e.date}"></span>`)}</div>
          <div class="row between tiny subtle mt-1"><span>${h(a.notes_series[0].date)}</span><span>Today</span></div></div></div>
    </div>
  </div>`),s.querySelectorAll("[data-count]").forEach(e=>{let v=+e.dataset.count,A=performance.now(),k=N=>{let f=Math.min(1,(N-A)/600);e.textContent=Math.round(v*(1-(1-f)**3)).toLocaleString(),f<1&&requestAnimationFrame(k)};requestAnimationFrame(k)})}var F={title:"Dashboard",async render(s){s.innerHTML=String(t`<div class="hero"><div><div class="skeleton" style="width:260px;height:30px"></div><div class="skeleton sk-line" style="width:340px"></div></div></div>
      <div class="quick-create">${Array.from({length:6},()=>t`<div class="skeleton" style="height:96px;border-radius:16px"></div>`)}</div>
      <div class="stats-grid">${Array.from({length:6},()=>t`<div class="skeleton" style="height:118px;border-radius:18px"></div>`)}</div>`);let a=async()=>{try{q(s,await $.get("dashboard"))}catch(i){u(i)}};await a(),s.addEventListener("click",async i=>{let r=i.target.closest("[data-qc]");if(r)return b.find(c=>c.key===r.dataset.qc)?.run();let l=i.target.closest("[data-done]");if(l){l.classList.add("on");try{await $.post(`tasks/${l.dataset.done}/status`,{status:"completed"}),setTimeout(a,400)}catch(c){u(c)}}});let d=[p("tasks:changed",a),p("calendar:changed",a),p("audio:changed",a),p("meetings:changed",a)];return()=>d.forEach(i=>i())}};export{F as default,C as navigate};
