import { Fragment, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { useData } from '../data/store'
import type { Route } from '../routes'
import { Sheet } from '../ui/Sheet'
import { buildContext, buildPrompt, SUGGESTIONS, type AskTurn } from './context'
import { coworkReachable, CoworkUnavailable, streamCowork } from './cowork'

const COPILOT_URL = 'https://m365.cloud.microsoft/chat'

type Status = 'running' | 'done' | 'failed' | 'cancelled' | 'handoff'

interface Turn extends AskTurn {
  id: number
  status: Status
  prompt: string
  /** Live progress from Cowork, e.g. the tool it is using. */
  activity: string
  note: string
}

let nextId = 1

/** Ask-me-anything over what the app has loaded: Cowork answers in place when the player allows it, otherwise the question goes to Copilot Chat. */
export function AskPanel({ open, onClose, route }: { open: boolean; onClose: () => void; route: Route }) {
  const { ds, scope, filters } = useData()
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [coworkOff, setCoworkOff] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const viaCowork = coworkReachable() && !coworkOff
  const running = turns.some((t) => t.status === 'running')
  const view = route.tab.views.find((v) => v.id === route.view)
  const pageLabel = view && route.tab.views.length > 1 ? `${route.tab.label} › ${view.label}` : route.tab.label

  useEffect(() => {
    if (open) requestAnimationFrame(() => input.current?.focus())
  }, [open])
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' })
  }, [turns])
  useEffect(() => () => abort.current?.abort(), [])

  const patch = (id: number, p: Partial<Turn> | ((t: Turn) => Partial<Turn>)) =>
    setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, ...(typeof p === 'function' ? p(t) : p) } : t)))

  async function ask(question: string) {
    const q = question.trim()
    if (!q || running) return
    setDraft('')
    const prompt = buildPrompt(q, buildContext(ds, scope, filters, { label: pageLabel }), turns.filter((t) => t.status === 'done'))
    const id = nextId++
    setTurns((ts) => [...ts, { id, question: q, answer: '', status: viaCowork ? 'running' : 'handoff', prompt, activity: '', note: '' }])
    if (!viaCowork) return

    const ctrl = new AbortController()
    abort.current = ctrl
    try {
      for await (const c of streamCowork(prompt, ctrl.signal)) {
        if (c.type === 'started') patch(id, { activity: 'Thinking…' })
        else if (c.type === 'text') patch(id, (t) => ({ answer: t.answer + c.delta, activity: '' }))
        else if (c.type === 'status') patch(id, { activity: c.message })
        else if (c.type === 'tool') patch(id, { activity: `Using ${c.name}…` })
        else if (c.type === 'connectionRequired') patch(id, { note: c.message || 'Cowork needs a connection you have not approved yet.' })
        else if (c.type === 'error') patch(id, { status: 'failed', note: c.message, activity: '' })
        else if (c.type === 'done')
          patch(id, (t) => ({
            status: c.status === 'completed' ? 'done' : c.status === 'cancelled' ? 'cancelled' : 'failed',
            note: c.error || (c.status === 'disconnected' ? 'The connection to Cowork dropped before the answer finished.' : t.note),
            activity: '',
          }))
      }
      patch(id, (t) => (t.status === 'running' ? { status: ctrl.signal.aborted ? 'cancelled' : 'done', activity: '' } : {}))
    } catch (e) {
      if (e instanceof CoworkUnavailable) {
        setCoworkOff(true)
        patch(id, { status: 'handoff', activity: '', note: `Cowork didn't answer in the app (${e.message}).` })
      } else patch(id, { status: 'failed', activity: '', note: e instanceof Error ? e.message : String(e) })
    } finally {
      if (abort.current === ctrl) abort.current = null
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void ask(draft)
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void ask(draft)
    }
  }
  const reset = () => {
    abort.current?.abort()
    setTurns([])
    input.current?.focus()
  }

  const suggestions = SUGGESTIONS[route.tab.id] ?? SUGGESTIONS.overview

  return (
    <Sheet open={open} onClose={onClose} title="Ask Agent-Monitor" side className="sheet-ask">
      <div className="ask">
        <p className="ask-scope">
          Answers use a summary of what the app has loaded: <b>{pageLabel}</b>
          {scope.filtered ? `, ${scope.agents.length.toLocaleString()} filtered agents` : `, all ${scope.agents.length.toLocaleString()} agents`}
          {ds.mode === 'sample' ? ', sample data' : ''}.
        </p>
        <p className="ask-mode">
          {viaCowork
            ? 'Cowork answers here, under your account. Check key figures against the page.'
            : coworkReachable()
              ? "Cowork isn't switched on for this app, so each question opens in Copilot Chat with the summary attached."
              : 'Outside the player, each question opens in Copilot Chat with the summary attached. In the player, with Cowork switched on, answers appear here.'}
        </p>

        <div className="ask-thread" aria-live="polite">
          {turns.length === 0 ? (
            <div className="ask-start">
              <h3>Try asking</h3>
              <ul>
                {suggestions.map((s) => (
                  <li key={s}>
                    <button type="button" className="ask-chip" onClick={() => void ask(s)}>
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <ol>
              {turns.map((t) => (
                <li key={t.id} className="ask-turn" data-status={t.status}>
                  <p className="ask-q">{t.question}</p>
                  <div className="ask-a">
                    {t.answer && <Answer text={t.answer} />}
                    {t.status === 'running' && <p className="ask-activity">{t.activity || 'Sending…'}</p>}
                    {t.status === 'cancelled' && <p className="ask-note">Stopped.</p>}
                    {t.note && <p className={t.status === 'failed' ? 'ask-note ask-error' : 'ask-note'}>{t.note}</p>}
                    {t.status === 'handoff' && <Handoff prompt={t.prompt} />}
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div ref={end} />
        </div>

        <form className="ask-compose" onSubmit={submit}>
          <label htmlFor="ask-input" className="sr-only">
            Your question
          </label>
          <textarea
            id="ask-input"
            ref={input}
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            placeholder="Ask about agents, owners, risk or knowledge"
            maxLength={600}
          />
          <div className="ask-actions">
            {turns.length > 0 && !running && (
              <button type="button" className="link-btn" onClick={reset}>
                New conversation
              </button>
            )}
            {running ? (
              <button type="button" className="btn" onClick={() => abort.current?.abort()}>
                Stop
              </button>
            ) : (
              <button type="submit" className="btn btn-primary" disabled={!draft.trim()}>
                {viaCowork ? 'Ask' : 'Ask in Copilot'}
              </button>
            )}
          </div>
        </form>
      </div>
    </Sheet>
  )
}

/** Hands one question to Copilot Chat: copy the prompt with its summary, then open Chat to paste it. */
function Handoff({ prompt }: { prompt: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'blocked'>('idle')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setState('copied')
    } catch {
      setState('blocked')
    }
  }
  return (
    <div className="ask-handoff">
      <p>Copy the question with its summary, then paste it into Copilot Chat.</p>
      <div className="ask-handoff-actions">
        <button type="button" className="btn btn-primary" onClick={() => void copy()}>
          {state === 'copied' ? 'Copied' : 'Copy question and summary'}
        </button>
        <a className="btn" href={COPILOT_URL} target="_blank" rel="noopener noreferrer">
          Open Copilot Chat
        </a>
      </div>
      {state === 'blocked' && <p className="ask-note">The frame blocked the clipboard. Select the text below and copy it.</p>}
      <details open={state === 'blocked'}>
        <summary>What gets sent</summary>
        <textarea className="ask-prompt" readOnly value={prompt} rows={8} onFocus={(e) => e.currentTarget.select()} aria-label="Question and summary to paste into Copilot" />
      </details>
    </div>
  )
}

/** Renders the small subset of Markdown answers use: paragraphs, bullet and numbered lists, and bold. */
export function Answer({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const flush = () => {
    if (!list) return
    const items = list.items.map((s, i) => <li key={i}>{inline(s)}</li>)
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>)
    list = null
  }
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (bullet || numbered) {
      const ordered = !!numbered
      if (list && list.ordered !== ordered) flush()
      list ??= { ordered, items: [] }
      list.items.push((bullet ?? numbered)![1])
      continue
    }
    flush()
    if (!line.trim()) continue
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    blocks.push(heading ? <p key={blocks.length} className="ask-h">{inline(heading[1])}</p> : <p key={blocks.length}>{inline(line)}</p>)
  }
  flush()
  return <div className="ask-answer">{blocks}</div>
}

function inline(s: string): ReactNode {
  const parts = s.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) => (p.startsWith('**') && p.endsWith('**') && p.length > 4 ? <b key={i}>{p.slice(2, -2)}</b> : <Fragment key={i}>{p}</Fragment>))
}
