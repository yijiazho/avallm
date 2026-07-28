const fixtureSelect = document.querySelector('#fixture-select')
const loadFixtureButton = document.querySelector('#load-fixture')
const statusNode = document.querySelector('#status')

function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = String(text)
  return node
}

function clear(node) {
  node.replaceChildren()
}

function setStatus(message, error = false) {
  statusNode.textContent = message
  statusNode.classList.toggle('error', error)
}

function datum(label, value) {
  const node = element('div', 'datum')
  node.append(element('span', '', label), element('strong', '', value))
  return node
}

function namedSeat(ref) {
  return ref ? `${ref.seat} · ${ref.name}` : 'none'
}

function detailText(detail) {
  return JSON.stringify(detail, null, 2)
}

function subhead(text) {
  return element('h3', 'subhead', text)
}

function renderDecision(data) {
  document.querySelector('#decision-heading').textContent =
    `${data.decisionPoint.kind} request`

  const coordinates = document.querySelector('#decision-coordinates')
  clear(coordinates)
  for (const [label, value] of [
    ['Quest', data.decisionPoint.round],
    ['Proposal', data.decisionPoint.proposalNum],
    ['Seat', data.decisionPoint.seat],
  ]) {
    const item = document.createElement('div')
    item.append(element('dt', '', label), element('dd', '', value))
    coordinates.append(item)
  }

  const identity = document.querySelector('#seat-identity')
  clear(identity)
  identity.append(element('span', 'seat-name', data.self.name))
  const role = element('span', `role-chip ${data.self.alignment}`,
    `${data.self.role} · ${data.self.alignment}`)
  identity.append(role)
}

function renderPublicBoard(data) {
  const board = data.publicBoard
  const root = document.querySelector('#public-board')
  clear(root)
  const meta = element('div', 'board-meta')
  meta.append(
    datum('Phase', board.phase),
    datum('Leader', namedSeat(board.leader)),
    datum('Round cursor', `Q${board.round}.${board.proposalNum}`),
    datum('Roles in play', board.rolesInPlay.join(', ')),
  )
  root.append(meta, subhead('Quest chart'))

  const questMap = element('div', 'quest-map')
  for (const quest of board.quests) {
    const classes = ['quest']
    if (quest.num === board.round) classes.push('current')
    if (quest.result) classes.push(quest.result)
    const card = element('div', classes.join(' '))
    card.append(
      element('span', 'quest-num', `Q${quest.num}`),
      element('strong', '', quest.result ?? 'unresolved'),
      element('small', '', `${quest.teamSize} seats · ${quest.failsRequired} fail${quest.failsRequired === 1 ? '' : 's'} needed`),
    )
    questMap.append(card)
  }
  root.append(questMap, subhead('Seats in this public view'))

  const seatMap = element('div', 'seat-map')
  const current = new Set((board.currentTeam ?? []).map(({ seat }) => seat))
  for (const player of board.players) {
    const classes = ['seat-token']
    if (player.seat === board.leader.seat) classes.push('leader')
    if (current.has(player.seat)) classes.push('team')
    const token = element('span', classes.join(' '))
    token.append(element('b', '', player.seat), document.createTextNode(player.name))
    seatMap.append(token)
  }
  root.append(seatMap, subhead('Proposal state'))

  const latest = board.proposals.at(-1)
  const proposal = element('div', 'datum')
  if (latest) {
    const team = latest.team.map((seat) => board.players[seat]?.name ?? `seat ${seat}`).join(', ')
    proposal.append(
      element('span', '', `Latest visible proposal · Q${latest.round}.${latest.proposalNum}`),
      element('strong', '', team || 'empty team'),
    )
  } else {
    proposal.append(element('span', '', 'Visible proposals'), element('strong', '', 'None yet'))
  }
  root.append(proposal)
}

function renderPrivateKnowledge(data) {
  const knowledge = data.privateKnowledge
  const root = document.querySelector('#private-knowledge')
  clear(root)
  const card = element('div', 'private-card')
  card.append(
    datum('Viewing seat', namedSeat(data.self)),
    datum('Alignment', data.self.alignment),
  )
  root.append(card, subhead('Role-derived knowledge'))
  root.append(element('p', 'knowledge-kind', knowledge.kind.replaceAll('-', ' ')))

  const copy = {
    'known-evil': 'These seats are known as evil from this role’s private information. This is not a probability or an inference.',
    'merlin-candidates': 'These seats are unordered Merlin candidates visible to this role. The inspector does not rank them.',
    'evil-partners': 'These are the evil partners visible to this seat. Hidden partners remain absent.',
    'none': 'This seat receives no named private seats. The empty folio is meaningful.',
  }
  root.append(element('p', 'knowledge-note', copy[knowledge.kind] ?? 'No private detail is projected.'))

  const known = element('div', 'known-seats')
  for (const ref of knowledge.seats) {
    const row = element('div', 'known-seat')
    row.append(element('span', '', ref.name), element('b', '', `seat ${ref.seat}`))
    known.append(row)
  }
  root.append(known)
}

function renderHistory(data) {
  const ledger = document.querySelector('#event-ledger')
  clear(ledger)
  if (data.visibleHistory.events.length === 0) {
    ledger.append(element('li', 'empty', 'No events are visible at this cursor.'))
  }
  for (const event of data.visibleHistory.events) {
    const item = element('li', `event ${event.scope === 'private-to-viewer' ? 'private' : 'public'}`)
    item.append(
      element('span', 'event-seq', `#${event.seq}`),
      element('span', 'event-type', event.type),
      element('pre', 'event-detail', detailText(event.detail)),
    )
    ledger.append(item)
  }

  const transcript = document.querySelector('#transcript')
  clear(transcript)
  if (data.visibleHistory.transcript.length === 0) {
    transcript.append(element('p', 'empty', 'No table speech is visible yet.'))
  }
  for (const entry of data.visibleHistory.transcript) {
    const utterance = element('div', 'utterance')
    utterance.append(
      element('b', '', `${entry.seat} · ${entry.name}${entry.lean ? ` · ${entry.lean}` : ''}`),
      element('p', '', entry.text),
    )
    transcript.append(utterance)
  }
}

function renderOmissions(data) {
  const omissions = document.querySelector('#omissions')
  clear(omissions)
  for (const text of data.omissions) omissions.append(element('li', '', text))
}

function renderInspection(data) {
  renderDecision(data)
  renderPublicBoard(data)
  renderPrivateKnowledge(data)
  renderHistory(data)
  renderOmissions(data)
  document.querySelector('#evidence-summary').textContent =
    `${data.visibleHistory.events.length} events · ${data.visibleHistory.transcript.length} utterances · ${data.privateKnowledge.seats.length} named private seats`
}

async function jsonRequest(url, options) {
  const response = await fetch(url, options)
  const value = await response.json()
  if (!response.ok) throw new Error(value.error ?? `request failed (${response.status})`)
  return value
}

async function loadFixture() {
  const id = fixtureSelect.value
  if (!id) return
  loadFixtureButton.disabled = true
  setStatus(`Validating frozen fixture “${id}”…`)
  try {
    const data = await jsonRequest(`/api/fixture?id=${encodeURIComponent(id)}`)
    renderInspection(data)
    setStatus(`Showing “${id}”. Only the allow-listed SeatViewInspection projection crossed from server to browser.`)
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true)
  } finally {
    loadFixtureButton.disabled = false
  }
}

async function initialize() {
  try {
    const metadata = await jsonRequest('/api/fixtures')
    for (const fixture of metadata.fixtures) {
      const option = document.createElement('option')
      option.value = fixture.id
      option.textContent = `${fixture.id} · seat ${fixture.self.seat} ${fixture.self.role} · ${fixture.decision.kind}`
      fixtureSelect.append(option)
    }
    fixtureSelect.value = metadata.selectedId
    await loadFixture()
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true)
  }
}

loadFixtureButton.addEventListener('click', loadFixture)
fixtureSelect.addEventListener('change', loadFixture)
initialize()
