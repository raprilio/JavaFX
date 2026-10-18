// Tasks (v1.23): two tabs — Team progress (shared tasks split into parts, the default when you open Tasks) and
// My tasks (your own to-do list). Old links with to-do parameters (?open=, ?status=, ?view=…) open My tasks.
import { html, icon } from '../core/dom.js';
import { navigate } from '../core/router.js';

const MINE_KEYS = ['open', 'status', 'view', 'priority', 'category', 'tag', 'due', 'filter'];

export default {
  title: 'Tasks',
  async render(el, ctx) {
    const mine = ctx.meta.tab === 'mine';
    if (!mine && (MINE_KEYS.some((k) => k in ctx.query) || ctx.query.scope === 'assigned')) {
      navigate('/tasks/mine?' + new URLSearchParams(ctx.query).toString(), { replace: true });
      return;
    }
    el.innerHTML = String(html`<div class="task-tabs" role="tablist" aria-label="Tasks">
        <a class="task-tab ${mine ? '' : 'active'}" role="tab" aria-selected="${mine ? 'false' : 'true'}" href="#/tasks">${icon('users-round', 'sm')}<span>Team progress</span></a>
        <a class="task-tab ${mine ? 'active' : ''}" role="tab" aria-selected="${mine ? 'true' : 'false'}" href="#/tasks/mine">${icon('square-check-big', 'sm')}<span>My tasks</span></a>
      </div><div data-tab-body></div>`);
    const mod = mine ? await import('./tasks.js') : await import('./ptasks.js');
    ctx.setTitle(mine ? 'My tasks' : 'Team progress');
    return mod.default.render(el.querySelector('[data-tab-body]'), ctx);
  },
};
