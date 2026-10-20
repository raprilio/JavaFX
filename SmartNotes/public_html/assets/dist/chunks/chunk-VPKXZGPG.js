import{i as d}from"./chunk-UXGBN37F.js";import{a as v,b as m,d as p,e as h,n as b}from"./chunk-ZZYNPBK6.js";import{d as s,e as n,h as f,o as g}from"./chunk-S3X3PBGV.js";function I({status:y,onChange:$=()=>{},compact:x=!1}){let o=y,c=f('<div class="mail-settings col" style="gap:18px"></div>'),r=(l,a)=>{o=l,a&&v(a,"success"),u(),$(o)};function u(){let l=o.connections||[],a=e=>(o.mailboxes||[]).filter(t=>t.connection===e);c.innerHTML=String(s`
      <section>
        <div class="row between mb-2"><div class="section-title" style="margin:0">${n("plug","sm")} API connections <span class="subtle small">${l.length}</span></div>
          ${l.length?s`<button type="button" class="btn ghost sm" data-act="refresh">${n("refresh-cw","sm")} Check again</button>`:""}</div>
        ${l.length?s`<div class="col" style="gap:8px">${l.map(e=>s`<div class="conn-row ${e.error?"bad":"ok"}" data-id="${e.id}">
            <span class="conn-ic">${n(e.error?"unplug":"plug","sm")}</span>
            <div class="grow" style="min-width:0">
              <div class="row" style="gap:6px"><b class="truncate">${e.label}</b>${e.source==="config"?s`<span class="badge">config.php</span>`:""}</div>
              <div class="tiny subtle">Token <code>${e.token_hint}</code>${e.added_at?s` · added ${g(e.added_at)}`:""}</div>
              ${e.error?s`<div class="small conn-err">${n("alert-triangle","sm")} ${e.error}</div>`:s`<div class="conn-boxes">${e.mailboxes.length?e.mailboxes.map(t=>s`<span class="badge">${n("at-sign","xs")} ${t}</span>`):s`<span class="tiny subtle">No mailboxes in this order yet</span>`}</div>`}
            </div>
            ${e.source==="config"?s`<span class="tiny subtle" data-tip="Remove it from app/config.php">${n("lock","sm")}</span>`:s`
              <button type="button" class="btn ghost icon sm" data-act="rename" data-tip="Rename" aria-label="Rename ${e.label}">${n("pencil","sm")}</button>
              <button type="button" class="btn ghost icon sm danger" data-act="remove" data-tip="Delete API" aria-label="Delete ${e.label}">${n("trash-2","sm")}</button>`}
          </div>`)}</div>`:s`<p class="small subtle" style="margin:0">No API connected yet. Add the token of your Hostinger e-mail order below.</p>`}
      </section>

      <section>
        <div class="section-title">${n("plus","sm")} Add API</div>
        <form class="form-grid" data-form="add" autocomplete="off">
          <div class="field" style="margin:0"><label for="mc-label">Name <span class="subtle small">(optional)</span></label><input class="input" id="mc-label" name="label" maxlength="80" placeholder="e.g. contoh.co.id"></div>
          <div class="field" style="margin:0"><label for="mc-token">API token</label><input class="input" id="mc-token" name="token" type="password" autocomplete="new-password" placeholder="Paste the Hostinger Mail API token" required></div>
          <div class="field span-2" style="margin:0"><button class="btn primary" type="submit" style="width:max-content">${n("plug","sm")} Add API</button>
            <span class="hint">The token is checked with Hostinger before it is saved, then stored encrypted. Add one token per domain / e-mail order.</span></div>
        </form>
        ${x?"":s`<details class="mc-help mt-2"><summary class="small">Where do I find the token?</summary><ol class="small muted" style="margin:6px 0 0;padding-left:18px">
          <li>Open <b>hPanel → Emails</b> and choose the domain.</li>
          <li>Open the <b>email provisioning / Mail API</b> section and create an <b>API token</b>.</li>
          <li>A token can read every mailbox of that order — keep it secret.</li></ol></details>`}
      </section>

      ${(o.mailboxes||[]).length?s`<section>
        <div class="section-title">${n("settings-2","sm")} Defaults</div>
        <form class="form-grid" data-form="defaults">
          <div class="field" style="margin:0"><label>Default mailbox</label><select class="select" name="default_mailbox">
            ${l.filter(e=>a(e.id).length).map(e=>s`<optgroup label="${e.label}">${a(e.id).map(t=>s`<option value="${t.resourceId}" ${t.resourceId===o.default_mailbox?"selected":""}>${t.address}</option>`)}</optgroup>`)}
          </select></div>
          <div class="field" style="margin:0"><label>Sender display name</label><input class="input" name="display_name" value="${o.display_name||""}" maxlength="120" placeholder="e.g. PT Contoh Indonesia"></div>
          <div class="field span-2" style="margin:0"><button class="btn" type="submit" style="width:max-content">${n("save","sm")} Save defaults</button></div>
        </form>
      </section>`:""}
      ${l.length&&l.some(e=>e.source!=="config")?s`<div><button type="button" class="btn ghost sm danger" data-act="remove-all">${n("unplug","sm")} Delete all APIs</button></div>`:""}`)}return c.addEventListener("submit",async l=>{l.preventDefault();let a=l.target,e=a.querySelector("[type=submit]");a.dataset.form==="add"?await b(e,async()=>{try{let t=await d.post("mail/settings",{token:a.token.value.trim(),label:a.label.value.trim()}),i=t.connections[t.connections.length-1];r(t,`API added \u2014 ${i?.mailboxes.length??0} mailbox${i?.mailboxes.length===1?"":"es"} found`)}catch(t){m(t),a.token.focus()}}):a.dataset.form==="defaults"&&await b(e,async()=>{try{r(await d.post("mail/settings",{default_mailbox:a.default_mailbox.value,display_name:a.display_name.value}),"Mail defaults saved")}catch(t){m(t)}})}),c.addEventListener("click",async l=>{let a=l.target.closest("[data-act]");if(!a)return;let e=a.closest("[data-id]")?.dataset.id,t=(o.connections||[]).find(i=>i.id===e);try{if(a.dataset.act==="refresh")r(await d.get("mail/status",{refresh:1}),"Connections checked");else if(a.dataset.act==="remove"&&t)await p({title:`Delete API "${t.label}"?`,message:`${t.mailboxes.length?t.mailboxes.join(", ")+" will disappear from Mail. ":""}The token is removed from SmartNotes; your e-mails stay on Hostinger.`,confirmText:"Delete API"})&&r(await d.post("mail/settings",{remove:e}),"API deleted");else if(a.dataset.act==="rename"&&t){let i=await h({title:"Rename API connection",label:"Name",value:t.label});i&&i.trim()!==t.label&&r(await d.post("mail/settings",{rename:e,label:i.trim()}),"Renamed")}else a.dataset.act==="remove-all"&&await p({title:"Delete all APIs?",message:"Every saved Hostinger Mail token is removed and Mail is disconnected. Your e-mails stay on Hostinger.",confirmText:"Delete all"})&&r(await d.post("mail/settings",{disconnect:!0}),"All APIs deleted")}catch(i){m(i)}}),u(),c}export{I as a};
