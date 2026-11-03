// Action items linked to a Product progress item or a Team progress task (v1.31): the follow-ups from meetings,
// with who owns them and the meeting they came from.
import { html, icon, fmtDay, todayStr } from '../core/dom.js';
import { state } from '../core/store.js';

export function actionItemsCard(items = []) {
  return html`<div class="card card-pad" data-action-items><h3>${icon('square-check-big', 'sm')} Action items <span class="subtle">${items.length || ''}</span></h3>
    ${items.length ? html`<div class="ai-list">${items.map((t) => html`<div class="ai-row ${t.status === 'completed' ? 'done' : ''}">
        <span class="ai-dot">${icon(t.status === 'completed' ? 'circle-check' : 'circle', 'sm')}</span>
        <div class="grow" style="min-width:0">${t.owner.id === state.user.id ? html`<a class="ai-title truncate block" href="#/tasks/mine?open=${t.id}">${t.title}</a>` : html`<span class="ai-title truncate block">${t.title}</span>`}
          <span class="tiny subtle block">${t.owner.name}${t.meeting ? html` · from <a href="#/meetings/${t.meeting.id}">${t.meeting.title}</a>` : ''}${t.due_date ? html` · <span class="${t.due_date < todayStr() && t.status !== 'completed' ? 'overdue' : ''}">${fmtDay(t.due_date)}</span>` : ''}</span></div></div>`)}</div>`
      : html`<p class="small subtle" style="margin:0">Link a task (e.g. an action item of a meeting) to this item and it shows up here.</p>`}</div>`;
}
