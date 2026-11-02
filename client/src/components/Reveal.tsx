import { useState } from 'react'
import type {
  PlayerView,
  PostgameRecord,
  PostgameSeat,
  RevealPayload,
  ReviewPayload,
  Seat,
} from '../types.ts'
import { agentConfigText, tokenEstimate } from '../agentConfig.ts'
import { ROLE_INFO, winReasonText } from '../setup.ts'
import type { Role } from '../setup.ts'
import { ARCANA, Emblem } from './Arcana.tsx'

// The reveal takes over the stage: every identity dealt face-down in seat
// order, then flipped one by one. The flip is the arcana's core animation.
export function Reveal({ view, reveal, review, noteSaving, onSaveNote, onNewGame, onCopyLog, copyLabel, reviewOpen = false }: {
  view: PlayerView
  reveal: RevealPayload | null
  review: ReviewPayload | null
  noteSaving: boolean
  onSaveNote: (text: string) => Promise<void>
  onNewGame: () => void
  onCopyLog: () => void
  copyLabel: string
  /** Gallery-only: shoot the expanded review without changing the app default. */
  reviewOpen?: boolean
}) {
  const [showThinking, setShowThinking] = useState(false)
  const winnerCls = view.outcome?.winner === 'good' ? 'ok' : 'bad'
  // If the game ended on the Knife, name who the Assassin marked. The feed does
  // narrate this now (client/src/revealPacing.ts holds this screen back until
  // that line has been on screen long enough to read), but it scrolls away with
  // the rest of the transcript, and the mark belongs on the record of the game.
  const shotEvent = reveal?.log.find((ev) => ev.type === 'assassination')
  const shot = shotEvent?.type === 'assassination' ? shotEvent.payload : undefined
  const shotName = (s: Seat) => reveal?.players.find((p) => p.seat === s)?.name ?? `seat ${s}`
  return (
    <div className="reveal">
      <div className={`winner-banner ${winnerCls}`}>
        {view.outcome?.winner.toUpperCase()} WINS
        <span className="reason">: {winReasonText(view.outcome?.reason ?? '')}</span>
      </div>
      {shot && (
        <div className="assassin-mark">
          <Emblem id="dagger" className="am-em" />
          {shotName(shot.assassin)} marked {shot.target === view.seat ? 'you' : shotName(shot.target)} as Merlin.
          {' '}{shot.wasMerlin ? 'The blade found its mark.' : 'A wrong guess.'}
        </div>
      )}
      {reveal ? (
        <div className="reveal-deal">
          {reveal.players.map((p, i) => {
            const arcana = ARCANA[p.role as Role]
            const you = p.seat === view.seat
            const struck = shot?.target === p.seat
            return (
              <div key={p.seat} className="flip" style={{ animationDelay: `${0.3 + i * 0.35}s` }}>
                <div className={`flip-face tarot-mini ${p.alignment}${you ? ' you' : ''}${struck ? ' struck' : ''}`}>
                  {struck && <Emblem id="dagger" className="tm-struck" />}
                  <span className="tm-num">{arcana?.numeral ?? '·'}</span>
                  {arcana && <Emblem id={arcana.emblem} className="tm-em" />}
                  <span className="tm-title">{arcana?.title ?? p.role}</span>
                  <span className="tm-plate">
                    <span className="tm-name">{you ? 'You' : p.name}</span>
                    <span className="tm-role">{ROLE_INFO[p.role as Role]?.name ?? p.role}</span>
                  </span>
                </div>
                <div className="flip-back">
                  <span className="fb-ring">✦</span>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="reveal-waiting">Turning the cards…</p>
      )}
      <div className="row reveal-actions">
        <button onClick={() => setShowThinking(!showThinking)}>
          {showThinking ? 'Hide' : 'Show'} what they were really thinking
        </button>
        <button className="secondary" onClick={onCopyLog} title="Copy a full debug transcript of this game to the clipboard">{copyLabel}</button>
        <button className="secondary" onClick={onNewGame}>New game</button>
      </div>
      {showThinking && reveal && <ThinkingTimeline reveal={reveal} />}
      <PostgameReview
        view={view}
        reveal={reveal}
        review={review}
        noteSaving={noteSaving}
        onSaveNote={onSaveNote}
        defaultOpen={reviewOpen}
      />
      {reveal && <AgentCards reveal={reveal} />}
    </div>
  )
}

// The review is deliberately collapsed: the role flip and the thinking
// timeline are the primary reveal, and the analysis is a second pass. Every
// field is rendered as a text node, so user-authored notes and model prose can
// never become markup.
function PostgameReview({ view, reveal, review, noteSaving, onSaveNote, defaultOpen }: {
  view: PlayerView
  reveal: RevealPayload | null
  review: ReviewPayload | null
  noteSaving: boolean
  onSaveNote: (text: string) => Promise<void>
  defaultOpen: boolean
}) {
  const canReview = review?.canReview ?? reveal?.canReview ?? false
  const record = review?.postgame
  if (!record && !canReview) return null
  const cap = reveal?.reviewNoteCap ?? 2000
  const name = (seat: Seat) => reveal?.players.find((p) => p.seat === seat)?.name ?? `seat ${seat}`
  const seats = record
    ? Object.values(record.seats).slice().sort((a, b) => a.seat - b.seat)
    : []
  const myHumanSeat = seats.find((seat) => seat.kind === 'human' && seat.seat === view.seat)

  return (
    <details className="postgame-review" {...(defaultOpen ? { open: true } : {})}>
      <summary>
        <span>Post-game review</span>
        {record && <StatusChip status={record.status} />}
        {!record && canReview && <span className="pg-status pg-none">not run</span>}
      </summary>
      {!record && (
        <p className="pg-optional">
          Reviews are optional and cost a model call. This game has no generated
          review, but you can still write your own note.
        </p>
      )}
      {record?.status === 'running' && (
        <p className="pg-running">The table is still writing its reviews. Your note is saved separately.</p>
      )}
      {record?.status === 'failed' && (
        <p className="pg-running pg-failed">
          No seat review could be completed. The per-seat errors are below.
        </p>
      )}
      {record && <PostgameTableTalk record={record} name={name} />}
      {record && (
        <div className="pg-grid">
          {seats.map((seat) => (
            <PostgameCard
              key={seat.seat}
              seat={seat}
              name={name(seat.seat)}
              canEdit={canReview && seat.seat === view.seat && seat.kind === 'human'}
              noteSaving={noteSaving}
              noteCap={cap}
              onSaveNote={onSaveNote}
            />
          ))}
        </div>
      )}
      {!record && canReview && (
        <div className="pg-grid">
          <PostgameCard
            seat={myHumanSeat ?? { seat: view.seat, kind: 'human', status: 'pending' }}
            name={name(view.seat)}
            canEdit
            noteSaving={noteSaving}
            noteCap={cap}
            onSaveNote={onSaveNote}
          />
        </div>
      )}
    </details>
  )
}

// The spoken turns, in the order they happened. The detailed cards below keep
// the evidence; this block is the conversation a human actually wants to read.
function PostgameTableTalk({ record, name }: {
  record: PostgameRecord
  name: (seat: Seat) => string
}) {
  const turns = (record.turnOrder ?? [])
    .map((seat) => record.seats[seat])
    .filter((seat): seat is PostgameSeat => seat?.review !== undefined)
  if (!turns.length) return null
  return (
    <div className="pg-talk">
      <h4>Table talk</h4>
      <ol>
        {turns.map((seat) => (
          <li key={seat.seat}>
            <span className="pg-talk-name">{name(seat.seat)}</span>
            <span className="pg-talk-seat">seat {seat.seat}</span>
            <p>{seat.review?.statement ?? seat.review?.summary}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}

function StatusChip({ status }: { status: string }) {
  return <span className={`pg-status pg-${status}`}>{status}</span>
}

function PostgameCard({ seat, name, canEdit, noteSaving, noteCap, onSaveNote }: {
  seat: PostgameSeat
  name: string
  canEdit: boolean
  noteSaving: boolean
  noteCap: number
  onSaveNote: (text: string) => Promise<void>
}) {
  const identity = seat.kind === 'human' ? 'human' : (seat.model ?? 'agent')
  return (
    <article className={`pg-card pg-card-${seat.status}`}>
      <header className="pg-head">
        <span className="pg-name">{name}</span>
        <span className="pg-seat">seat {seat.seat} · {identity}</span>
        <StatusChip status={seat.status} />
      </header>
      {seat.error && (
        <p className={seat.status === 'failed' ? 'pg-error' : 'pg-empty'}>{seat.error}</p>
      )}
      {seat.note && (
        <div className="pg-block">
          <h4>Note</h4>
          <p className="pg-note">{seat.note}</p>
        </div>
      )}
      {seat.review && (
        <>
          <p className="pg-summary">{seat.review.summary}</p>
          {seat.review.decisions.length > 0 && (
            <div className="pg-block">
              <h4>Decisions reviewed</h4>
              <ul className="pg-decisions">
                {seat.review.decisions.map((decision) => (
                  <li key={`${decision.seq}-${decision.kind}`}>
                    <span className="pg-seq">#{decision.seq}</span>
                    {' '}<span className="pg-kind">{decision.kind}</span>
                    {' '}{decision.assessment}
                    {decision.alternative && (
                      <span className="pg-alt"> Alternative: {decision.alternative}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {seat.review.commentary.length > 0 && (
            <div className="pg-block">
              <h4>Comments on the table</h4>
              <ul className="pg-comments">
                {seat.review.commentary.map((comment, index) => (
                  <li key={`${comment.seat}-${index}`}>
                    <b>seat {comment.seat}</b>: {comment.note}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="pg-lesson"><b>Lesson:</b> {seat.review.lesson}</p>
        </>
      )}
      {seat.cost && (
        <p className="pg-cost">
          ${seat.cost.usd.toFixed(4)} · {seat.cost.promptTokens} prompt / {seat.cost.completionTokens} completion tokens
        </p>
      )}
      {seat.kind === 'human' && !seat.note && !canEdit && (
        <p className="pg-empty">No note written.</p>
      )}
      {canEdit && (
        <ReviewNoteEditor
          key={seat.note ?? 'new'}
          initial={seat.note ?? ''}
          cap={noteCap}
          saving={noteSaving}
          onSave={onSaveNote}
        />
      )}
    </article>
  )
}

function ReviewNoteEditor({ initial, cap, saving, onSave }: {
  initial: string
  cap: number
  saving: boolean
  onSave: (text: string) => Promise<void>
}) {
  const [text, setText] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const trimmed = text.trim()
  const disabled = saving || trimmed.length === 0 || text.length > cap
  const submit = async () => {
    setError(null)
    try {
      await onSave(trimmed)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not save the note')
    }
  }
  return (
    <div className="pg-editor">
      <label>
        <span className="visually-hidden">Your review note</span>
        <textarea
          value={text}
          maxLength={cap}
          rows={3}
          placeholder="What would you do differently next time?"
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <div className="pg-editor-row">
        <span className={text.length > cap ? 'pg-over' : 'pg-count'}>{text.length}/{cap}</span>
        <button className="secondary" disabled={disabled} onClick={() => void submit()}>
          {saving ? 'Saving…' : 'Save note'}
        </button>
      </div>
      {error && <p className="pg-error">{error}</p>}
    </div>
  )
}

// The identities that actually played (def snapshots from game start), with
// expandable prompt details for custom agents.
function AgentCards({ reveal }: { reveal: RevealPayload }) {
  const agents = Object.entries(reveal.agents ?? {})
  if (!agents.length) return null
  return (
    <div className="reveal-agent-configs">
      <p className="roles-preview">Agents at the table:</p>
      {agents.map(([seat, a]) => {
        const player = reveal.players.find((p) => p.seat === Number(seat))
        const label = `${player?.name ?? `seat ${seat}`} · ${a.name} · ${a.model}`
        if (!a.custom && a.tunedChars === 0) {
          return <div key={seat} className="roles-preview">{label}</div>
        }
        return (
          <details key={seat} className="prompt-details">
            <summary>
              {label}{a.version ? ` · v${a.version}` : ''} ·
              {' '}~{tokenEstimate(a.tunedChars)} tokens of custom prompt
            </summary>
            <pre>{agentConfigText(a)}</pre>
          </details>
        )
      })}
    </div>
  )
}

function ThinkingTimeline({ reveal }: { reveal: RevealPayload }) {
  const name = (s: number) => reveal.players.find((p) => p.seat === s)?.name ?? `seat ${s}`
  const rows = reveal.log.filter((ev) =>
    ev.type === 'thinking' || ev.type === 'scratchpad' || ev.type === 'questCard' ||
    ev.type === 'proposal' || ev.type === 'questResult')
  return (
    <div className="thinking-timeline">
      {rows.map((ev) => {
        if (ev.type === 'scratchpad') {
          return (
            <div key={ev.seq} className="think-row notes-row">
              <span className="feed-speaker">{name(ev.payload.seat)}</span>
              <span className="think-kind">[notes]</span>
              <em>{ev.payload.text}</em>
            </div>
          )
        }
        if (ev.type === 'thinking') {
          return (
            <div key={ev.seq} className="think-row">
              <span className="feed-speaker">{name(ev.payload.seat)}</span>
              <span className="think-kind">[{ev.payload.kind}]</span>
              <em>{ev.payload.text}</em>
            </div>
          )
        }
        if (ev.type === 'questCard') {
          return (
            <div key={ev.seq} className={`think-row card-${ev.payload.card}`}>
              <span className="feed-speaker">{name(ev.payload.seat)}</span>
              <span>secretly played <b>{String(ev.payload.card).toUpperCase()}</b></span>
            </div>
          )
        }
        if (ev.type === 'proposal') {
          return <div key={ev.seq} className="think-row marker">· {name(ev.payload.leader)} proposes (Q{ev.payload.round}.{ev.payload.proposalNum}) ·</div>
        }
        if (ev.type === 'questResult') {
          return <div key={ev.seq} className="think-row marker big">═ Quest {ev.payload.round}: {String(ev.payload.result).toUpperCase()} ═</div>
        }
        return null
      })}
    </div>
  )
}
