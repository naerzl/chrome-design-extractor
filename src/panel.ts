import './panel.css';
import { analyzeSnapshot, normalizeDesignColor, type DesignAnalysis } from './analyze.ts';
import { exportCapture, exportDesign } from './export.ts';
import { labels as t, language } from './labels.ts';
import type { CaptureReply, CaptureRequest, CaptureSnapshot } from './schema.ts';

document.documentElement.lang = language;
const app = document.querySelector<HTMLDivElement>('#app')!;
// Only our bundled labels are interpolated into this template. Capture data enters via textContent.
app.innerHTML = `
<div class="shell">
  <header class="topbar">
    <div class="brand"><img src="./icons/32.png" alt="">${t.product}</div>
    <span class="local">${t.local}</span>
  </header>
  <main>
    <section class="capture-card" id="capture-card" aria-labelledby="capture-title">
      <div class="capture-heading">
        <h1 id="capture-title">${t.emptyTitle}</h1>
        <span id="recording-timer" class="recording-timer" role="timer" hidden></span>
      </div>
      <p id="capture-description">${t.emptyBody}</p>
      <details class="context" id="context" hidden>
        <summary id="context-heading">${t.showContext}</summary>
        <ul id="context-details"></ul>
      </details>
      <div class="capture-actions">
        <button type="button" class="capture" id="capture">${t.capture}</button>
        <button type="button" class="capture-secondary" id="compare" hidden>${t.compare}</button>
        <button type="button" class="capture-secondary" id="record" hidden>${t.record}</button>
      </div>
    </section>
    <section id="results" class="results" hidden>
      <label class="document-name" for="document-name">${t.sourceLabel}
        <input id="document-name" maxlength="100" placeholder="${t.sourcePlaceholder}" autocomplete="off">
      </label>
      <div class="view-toggle" id="view-tabs" role="tablist" aria-label="${t.resultViews}">
        <button type="button" id="summary-tab" role="tab" aria-controls="summary-view" aria-selected="true">${t.summary}</button>
        <button type="button" id="markdown-tab" role="tab" aria-controls="markdown-view" aria-selected="false" tabindex="-1">${t.document}</button>
      </div>
      <div id="summary-view" role="tabpanel" aria-labelledby="summary-tab" tabindex="0"></div>
      <div id="markdown-view" class="preview" role="tabpanel" aria-labelledby="markdown-tab" hidden>
        <textarea id="preview" aria-label="${t.previewLabel}" readonly wrap="soft" spellcheck="false"></textarea>
      </div>
    </section>
  </main>
  <footer class="action-dock">
    <p class="status" id="status" role="status"></p>
    <div class="export-actions" id="export-actions" hidden>
      <button type="button" class="primary" id="download">${t.save}</button>
      <button type="button" id="copy">${t.copy}</button>
      <button type="button" id="json" title="${t.aboutData}" aria-label="${t.aboutData}">${t.data}</button>
    </div>
  </footer>
</div>`;

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const ui = {
  captureCard: element('capture-card'), title: element('capture-title'), description: element('capture-description'),
  capture: element<HTMLButtonElement>('capture'), compare: element<HTMLButtonElement>('compare'),
  record: element<HTMLButtonElement>('record'), timer: element('recording-timer'), status: element('status'),
  context: element<HTMLDetailsElement>('context'), contextHeading: element('context-heading'),
  contextDetails: element('context-details'), results: element('results'),
  name: element<HTMLInputElement>('document-name'), viewTabs: element('view-tabs'), summaryToggle: element<HTMLButtonElement>('summary-tab'),
  markdownToggle: element<HTMLButtonElement>('markdown-tab'), summary: element('summary-view'), markdown: element('markdown-view'),
  preview: element<HTMLTextAreaElement>('preview'), actions: element('export-actions'),
};

interface CapturedView {
  snapshot: CaptureSnapshot;
  target: PageTarget;
  analysis: DesignAnalysis;
}

interface PageTarget {
  tabId: number;
  documentId: string;
}

interface Recording {
  view: CapturedView;
  end: number;
  timer: number;
  finishing: boolean;
}

const maxViews = 5;
let views: CapturedView[] = [];
let overrides: Record<string, string> = {};
let currentTab: number | undefined;
let generation = 0;
let busy = false;
let mode: 'summary' | 'markdown' = 'summary';
let recording: Recording | undefined;

class PanelError extends Error {}

function notify(message = '', error = false) {
  ui.status.textContent = message;
  ui.status.dataset.error = String(error);
}

function displayError(error: unknown) {
  notify(error instanceof PanelError ? error.message : t.captureFailed, true);
}

function roleLabel(role: string) {
  return t.roleLabels[role] ?? role;
}

function viewDimensions(view: CapturedView) {
  return `${view.snapshot.context.width} × ${view.snapshot.context.height}`;
}

function markdown(): string {
  const primary = views[0];
  if (!primary) return '';
  return exportDesign(primary.analysis, {
    name: ui.name.value.trim() || t.sourcePlaceholder,
    additional: views.slice(1).map((view) => view.analysis),
    colorOverrides: overrides,
  });
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, content?: string, className?: string) {
  const node = document.createElement(tag);
  if (content) node.textContent = content;
  if (className) node.className = className;
  return node;
}

function presentList(title: string, empty: string, rows: [string, string][]) {
  const section = make('section');
  section.append(make('h2', title));
  if (rows.length === 0) {
    section.append(make('p', empty, 'hint'));
    return section;
  }
  const list = make('ul', undefined, 'list');
  for (const [label, details] of rows) {
    const item = make('li');
    item.append(make('strong', label), make('span', details));
    list.append(item);
  }
  section.append(list);
  return section;
}

function presentPalette(view: CapturedView) {
  const section = make('section');
  const heading = make('div', undefined, 'section-heading');
  heading.append(make('h2', t.palette));
  section.append(heading);
  const palette = view.analysis.palette;
  if (palette.length === 0) {
    section.append(make('p', t.noPalette, 'hint'));
    return section;
  }
  const colors = new Set(palette.map(({ value }) => value));
  for (const sample of view.snapshot.samples) {
    if (colors.size >= 30) break;
    for (const rawColor of [sample.backgroundColor, sample.color, sample.borderColor, sample.fill]) {
      const color = normalizeDesignColor(rawColor);
      if (color && colors.size < 30) colors.add(color);
    }
  }
  const reset = make('button', t.resetColors, 'reset-colors');
  reset.type = 'button';
  reset.id = 'reset-colors';
  heading.append(reset);
  const swatches = make('div', undefined, 'palette');
  const updateSwatches: Array<() => void> = [];
  const ordered = palette.filter(({ role }) => role === 'primary').concat(palette.filter(({ role }) => role !== 'primary'));
  for (const entry of ordered) {
    const colorRole = roleLabel(entry.role);
    const label = make('label', undefined, 'swatch-item');
    label.dataset.colorRole = entry.role;
    const swatch = make('span', undefined, 'swatch');
    const details = make('span', undefined, 'swatch-details');
    const basis = make('span', undefined, 'swatch-basis');
    basis.title = entry.basis;
    details.append(make('span', colorRole, 'swatch-role'), basis);
    const select = make('select');
    select.setAttribute('aria-label', t.swatchRole(colorRole));
    const current = overrides[entry.role] ?? entry.value;
    for (const value of new Set([current, entry.value, ...colors])) {
      const option = make('option', value);
      option.value = value;
      select.append(option);
    }
    const update = () => {
      const color = overrides[entry.role] ?? entry.value;
      const edited = color !== entry.value;
      select.value = color;
      swatch.style.backgroundColor = color;
      label.dataset.edited = String(edited);
      basis.textContent = edited ? t.editedColor : entry.evidence === 'declared' ? t.cssColor : t.sampledColor;
    };
    update();
    updateSwatches.push(update);
    select.addEventListener('change', () => {
      const color = normalizeDesignColor(select.value);
      if (!color) return;
      if (color === entry.value) delete overrides[entry.role];
      else overrides[entry.role] = color;
      update();
      reset.hidden = !swatches.querySelector('[data-edited="true"]');
      ui.preview.value = markdown();
    });
    label.append(swatch, details, select);
    swatches.append(label);
  }
  reset.hidden = !swatches.querySelector('[data-edited="true"]');
  reset.addEventListener('click', () => {
    const editedControl = swatches.querySelector<HTMLSelectElement>('[data-edited="true"] select');
    overrides = {};
    updateSwatches.forEach((update) => update());
    reset.hidden = true;
    ui.preview.value = markdown();
    editedControl?.focus();
  });
  section.append(swatches);
  return section;
}

function renderResults() {
  const primary = views[0];
  ui.results.hidden = !primary;
  ui.actions.hidden = !primary;
  if (!primary) {
    ui.summary.replaceChildren();
    ui.preview.value = '';
    return;
  }
  const analysis = primary.analysis;
  const typography: [string, string][] = analysis.typography.slice(0, 4).map((item) => [
    roleLabel(item.role), `${item.fontSize} · ${item.fontFamily}`,
  ]);
  const layout: [string, string][] = analysis.layout.slice(0, 5).map((item) => [
    roleLabel(item.role),
    [
      item.display, `${Math.round(item.width)}px`, item.columns === null ? '' : t.layoutColumns(item.columns),
    ].filter(Boolean).join(' · '),
  ]);
  const allMotion = views.flatMap((view) => view.analysis.motion.map((item) => ({ item, view })));
  allMotion.sort((left, right) => Number(right.item.evidence === 'observed') - Number(left.item.evidence === 'observed'));
  const motion: [string, string][] = allMotion.slice(0, 6).map(({ item, view }) => [
    roleLabel(item.role),
    [item.evidence === 'observed' ? t.observed : t.declared, item.durationMs === null ? '' : `${item.durationMs}ms`, item.properties.join(', '), views.length > 1 ? viewDimensions(view) : ''].filter(Boolean).join(' · '),
  ]);
  const motionSection = presentList(t.motion, t.noMotion, motion);
  if (allMotion.length > motion.length) {
    motionSection.append(make('p', t.extraCount(allMotion.length - motion.length), 'hint'));
  }
  ui.summary.replaceChildren(
    presentPalette(primary),
    presentList(t.typography, t.noType, typography),
    presentList(t.layout, t.noLayout, layout),
    motionSection,
  );
  setMode(mode);
}

function setMode(next: typeof mode) {
  mode = next;
  ui.summary.hidden = next !== 'summary';
  ui.markdown.hidden = next !== 'markdown';
  ui.summaryToggle.setAttribute('aria-selected', String(next === 'summary'));
  ui.markdownToggle.setAttribute('aria-selected', String(next === 'markdown'));
  ui.summaryToggle.tabIndex = next === 'summary' ? 0 : -1;
  ui.markdownToggle.tabIndex = next === 'markdown' ? 0 : -1;
  if (next === 'markdown') ui.preview.value = markdown();
}

function renderControls() {
  const primary = views[0];
  ui.context.hidden = !primary;
  ui.capture.hidden = Boolean(recording);
  ui.compare.hidden = !primary || Boolean(recording);
  ui.record.hidden = !primary;
  ui.capture.disabled = busy;
  ui.capture.textContent = primary ? t.recapture : t.capture;
  ui.compare.disabled = busy;
  ui.record.disabled = busy || Boolean(recording?.finishing);
  ui.captureCard.dataset.recording = String(Boolean(recording));
  ui.record.classList.toggle('stop', Boolean(recording));
  ui.record.textContent = recording?.finishing ? t.finishing : recording ? t.stop : t.record;
  ui.title.textContent = recording ? t.recordingTitle : primary ? t.readyTitle : t.emptyTitle;
  ui.description.hidden = Boolean(primary);
  ui.timer.hidden = !recording || recording.finishing;
  updateTimer();
  if (!primary) return;
  ui.contextHeading.textContent = `${viewDimensions(primary)} • ${t.showContext}`;
  const coverage = primary.snapshot.coverage;
  const context = primary.snapshot.context;
  const details = [t.elementCount(coverage.sampled), context.preferredTheme === 'dark' ? t.dark : t.light];
  if (context.reducedMotion) details.push(t.reduced);
  if (coverage.partial) details.push(t.limited);
  if (coverage.omittedFrames > 0) details.push(t.frames(coverage.omittedFrames));
  if (views.length > 1) details.push(`${t.comparison(views.length - 1)} (${views.slice(1).map(viewDimensions).join(', ')})`);
  ui.contextDetails.replaceChildren(...details.map((item) => make('li', item)));
}

function updateTimer() {
  if (!recording || recording.finishing) return;
  const remaining = Math.max(0, Math.ceil((recording.end - Date.now()) / 1000));
  const time = t.recordingTime(remaining);
  if (ui.timer.textContent !== time) ui.timer.textContent = time;
}

async function queryActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function requireActiveTab(): Promise<number> {
  const tab = await queryActiveTab();
  if (tab?.id === undefined || !tab.url) throw new PanelError(t.needPermission);
  const url = new URL(tab.url);
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.hostname === 'chromewebstore.google.com') {
    throw new PanelError(t.restricted);
  }
  currentTab = tab.id;
  return tab.id;
}

async function inject(tabId: number): Promise<PageTarget> {
  try {
    const [frame] = await chrome.scripting.executeScript({
      target: { tabId },
      files: ['collector.js'],
    });
    if (!frame?.documentId) throw new Error('Missing document ID.');
    return { tabId, documentId: frame.documentId };
  } catch {
    throw new PanelError(t.needPermission);
  }
}

async function request<T extends CaptureRequest['type']>(
  target: PageTarget,
  message: CaptureRequest & { type: T },
): Promise<Extract<CaptureReply, { ok: true; type: T }>> {
  const reply = await chrome.tabs.sendMessage(target.tabId, message, { documentId: target.documentId }) as CaptureReply | undefined;
  if (!reply?.ok || reply.type !== message.type) throw new PanelError(t.captureFailed);
  return reply as Extract<CaptureReply, { ok: true; type: T }>;
}

function createView(snapshot: CaptureSnapshot, target: PageTarget): CapturedView {
  return { snapshot, target, analysis: analyzeSnapshot(snapshot) };
}

function sameViewport(left: CaptureSnapshot['context'], right: CaptureSnapshot['context']) {
  return left.width === right.width && left.height === right.height &&
    left.preferredTheme === right.preferredTheme && left.reducedMotion === right.reducedMotion;
}

async function capture(append: boolean) {
  if (busy || recording) return;
  const attempt = ++generation;
  busy = true;
  notify(t.capturePending);
  renderControls();
  try {
    const tabId = await requireActiveTab();
    const target = await inject(tabId);
    const { snapshot } = await request(target, { type: 'capture' });
    const active = await queryActiveTab();
    if (generation !== attempt) return;
    if (active?.id !== tabId) throw new PanelError(t.stale);
    if (snapshot.samples.length === 0) throw new PanelError(t.noSamples);
    const next = createView(snapshot, target);
    const primary = views[0];
    const canAppend = append && primary?.target.tabId === tabId &&
      primary.target.documentId === target.documentId && primary.snapshot.documentKey === snapshot.documentKey;
    if (canAppend) {
      const prior = views.findIndex((view) => sameViewport(view.snapshot.context, snapshot.context));
      if (prior >= 0) {
        next.snapshot.motion = [...views[prior].snapshot.motion, ...snapshot.motion];
        next.analysis = analyzeSnapshot(next.snapshot);
        next.snapshot.motion = next.analysis.motion;
        views[prior] = next;
        if (prior === 0) {
          for (const role of Object.keys(overrides)) {
            const color = next.analysis.palette.find((entry) => entry.role === role);
            if (!color || color.value === overrides[role]) delete overrides[role];
          }
        }
        notify(t.sameViewport);
      } else {
        const atLimit = views.length === maxViews;
        views = atLimit ? [primary, ...views.slice(2), next] : [...views, next];
        notify(atLimit ? t.replacedViewport : t.added);
      }
    } else {
      if (primary && primary.target.documentId !== target.documentId) ui.name.value = '';
      views = [next];
      overrides = {};
      notify(append ? t.captureChanged : t.captured(snapshot.coverage.sampled));
    }
    renderResults();
  } catch (error) {
    if (generation === attempt) displayError(error);
  } finally {
    if (generation === attempt) {
      busy = false;
      renderControls();
    }
  }
}

async function finishRecording() {
  const session = recording;
  if (!session || session.finishing) return;
  session.finishing = true;
  window.clearInterval(session.timer);
  renderControls();
  try {
    const result = await request(session.view.target, { type: 'stop-recording' });
    if (recording !== session) return;
    if (result.documentKey !== session.view.snapshot.documentKey) throw new PanelError(t.newRecording);
    if (!sameViewport(session.view.snapshot.context, result.context)) throw new PanelError(t.recordingViewport);
    const recorded = result.motion.filter((item) => item.evidence === 'observed');
    session.view.snapshot.motion = [...session.view.snapshot.motion, ...recorded];
    session.view.analysis = analyzeSnapshot(session.view.snapshot);
    session.view.snapshot.motion = session.view.analysis.motion;
    notify(t.recorded(recorded.length));
    renderResults();
  } catch (error) {
    if (recording === session) displayError(error);
  } finally {
    if (recording === session) {
      recording = undefined;
      renderControls();
    }
  }
}

async function startRecording() {
  const primary = views[0];
  if (!primary || busy || recording) return;
  const attempt = ++generation;
  busy = true;
  notify();
  renderControls();
  try {
    const tabId = await requireActiveTab();
    const target = await inject(tabId);
    if (target.documentId !== primary.target.documentId) throw new PanelError(t.newRecording);
    const result = await request(target, { type: 'start-recording', durationMs: 8000 });
    if (generation !== attempt || result.documentKey !== primary.snapshot.documentKey) {
      void request(target, { type: 'stop-recording' }).catch(() => {});
      if (generation === attempt) throw new PanelError(t.newRecording);
      return;
    }
    const view = views.find((captured) => sameViewport(captured.snapshot.context, result.context));
    if (!view) {
      void request(target, { type: 'stop-recording' }).catch(() => {});
      throw new PanelError(t.recordingViewport);
    }
    recording = {
      view,
      end: Date.now() + result.durationMs,
      timer: window.setInterval(() => {
        if (recording && recording.end <= Date.now()) void finishRecording();
        else updateTimer();
      }, 250),
      finishing: false,
    };
    notify(t.recording);
  } catch (error) {
    if (generation === attempt) displayError(error);
  } finally {
    if (generation === attempt) {
      busy = false;
      renderControls();
    }
  }
}

function resetForNavigation() {
  generation++;
  busy = false;
  if (recording) {
    window.clearInterval(recording.timer);
    void request(recording.view.target, { type: 'stop-recording' }).catch(() => {});
  }
  recording = undefined;
  views = [];
  overrides = {};
  mode = 'summary';
  ui.name.value = '';
  ui.context.open = false;
  renderResults();
  renderControls();
  notify();
}

function download(filename: string, data: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = make('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify(t.downloaded);
}

ui.capture.addEventListener('click', () => void capture(false));
ui.compare.addEventListener('click', () => void capture(true));
ui.record.addEventListener('click', () => {
  if (recording) void finishRecording();
  else void startRecording();
});
ui.summaryToggle.addEventListener('click', () => setMode('summary'));
ui.markdownToggle.addEventListener('click', () => setMode('markdown'));
ui.viewTabs.addEventListener('keydown', (event) => {
  let next: typeof mode;
  if (event.key === 'Home') next = 'summary';
  else if (event.key === 'End') next = 'markdown';
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') next = mode === 'summary' ? 'markdown' : 'summary';
  else return;
  event.preventDefault();
  setMode(next);
  (next === 'summary' ? ui.summaryToggle : ui.markdownToggle).focus();
});
ui.name.addEventListener('input', () => { if (mode === 'markdown') ui.preview.value = markdown(); });
element('download').addEventListener('click', () => download('DESIGN.md', markdown(), 'text/markdown;charset=utf-8'));
element('json').addEventListener('click', () => {
  download('capture.json', exportCapture(views.map((view) => view.snapshot)), 'application/json');
});
element('copy').addEventListener('click', async () => {
  const attempt = generation;
  try {
    await navigator.clipboard.writeText(markdown());
    if (generation === attempt) notify(t.copied);
  } catch {
    if (generation !== attempt) return;
    setMode('markdown');
    ui.preview.focus();
    ui.preview.select();
    notify(t.copyFailed, true);
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (currentTab === undefined || currentTab === tabId) return;
  void queryActiveTab().then((tab) => {
    if (tab?.id !== tabId || tabId === currentTab) return;
    resetForNavigation();
    currentTab = tabId;
  }).catch(() => {});
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (tabId === currentTab && (change.status === 'loading' || change.url !== undefined)) resetForNavigation();
});
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === currentTab) {
    resetForNavigation();
    currentTab = undefined;
  }
});
