// Global "create" actions used by the sidebar, dashboard, palette and shortcuts.
import { api } from './api.js';
import { navigate } from './router.js';
import { toast, toastError, prompt } from './ui.js';
import { emit } from './store.js';

export async function newNote(fields = {}) {
  try {
    const n = await api.post('notes', fields);
    navigate(`/notes/${n.id}?new=1`);
    return n;
  } catch (e) { toastError(e); }
}

export async function newTask(defaults = {}) {
  const { openTaskForm } = await import('../components/forms.js');
  return openTaskForm(null, defaults);
}

export async function newEvent(defaults = {}) {
  const { openEventForm } = await import('../components/forms.js');
  return openEventForm(null, defaults);
}

export async function newMeeting(defaults = {}) {
  const { openMeetingForm } = await import('../components/forms.js');
  const m = await openMeetingForm(null, defaults);
  if (m?.id) navigate(`/meetings/${m.id}`);
  return m;
}

export async function newMindmap() {
  const title = await prompt({ title: 'New mind map', label: 'Central topic', placeholder: 'e.g. Product launch plan', confirmText: 'Create' });
  if (!title) return;
  try {
    const m = await api.post('mindmaps', { title });
    navigate(`/mindmaps/${m.id}`);
  } catch (e) { toastError(e); }
}

export async function newFlowchart() {
  const title = await prompt({ title: 'New flowchart', label: 'Title', placeholder: 'e.g. Approval process', confirmText: 'Create' });
  if (!title) return;
  try {
    const f = await api.post('flowcharts', { title });
    navigate(`/flowcharts/${f.id}`);
  } catch (e) { toastError(e); }
}

export async function newRecording(opts = {}) {
  const { openRecorder } = await import('../components/audio.js');
  const saved = await openRecorder(opts);
  if (saved) {
    emit('audio:changed', saved);
    if (!opts.noteId) toast('Find it under Audio Notes', 'info', { action: 'Open', onAction: () => navigate('/audio') });
  }
  return saved;
}

export const CREATE_ITEMS = [
  { key: 'note', label: 'New note', icon: 'notebook-pen', color: '#6366f1', sub: 'Text, checklist, images', run: () => newNote() },
  { key: 'task', label: 'Task', icon: 'square-check-big', color: '#10b981', sub: 'With due date & reminder', run: () => newTask() },
  { key: 'mindmap', label: 'Mind map', icon: 'network', color: '#f59e0b', sub: 'Visual brainstorming', run: () => newMindmap() },
  { key: 'flowchart', label: 'Flowchart', icon: 'workflow', color: '#0ea5e9', sub: 'Process diagrams', run: () => newFlowchart() },
  { key: 'audio', label: 'Audio note', icon: 'mic', color: '#ec4899', sub: 'Record your voice', run: () => newRecording() },
  { key: 'schedule', label: 'Schedule', icon: 'calendar-plus', color: '#8b5cf6', sub: 'Event or meeting', run: () => newEvent({ event_type: 'schedule' }) },
];
