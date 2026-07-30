import type { OpenRouterClient } from '../../llm/openrouter.ts'
import {
  COMMUNICATION_CLAIM_CODES,
  COMMUNICATION_INTENT_VERSION,
  type CommunicationClaimCode,
  type PlannerCommunicationDirection,
} from '../policy/plan.ts'
import type {
  CandidatePlanner,
  PlanVoice,
  PlannerOutput,
  VoiceOutput,
} from '../composed.ts'
import { onlyAllowedKeys } from '../components/canonical-shape.ts'

export const BOUNDED_PLANNER_VERSION = 'bounded-llm-planner-v1'
export const BOUNDED_VOICE_VERSION = 'bounded-llm-voice-v1'
export const BOUNDED_PLANNER_PROMPT_VERSION =
  'bounded-planner-contract-v1'
export const BOUNDED_VOICE_PROMPT_VERSION = 'bounded-voice-contract-v1'

type CallClient = Pick<OpenRouterClient, 'call'>

export interface BoundedPlannerVoiceOptions {
  client: CallClient
  model: string
  tagPrefix?: string
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    && value.every((entry) => typeof entry === 'string')
    ? value
    : undefined
}

function parseObject(content: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(content.trim())
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

function communicationDirection(
  value: unknown,
): PlannerCommunicationDirection | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const raw = value as Record<string, unknown>
  const channel = raw.channel
  const targetSeats = raw.targetSeats
  const claimCodes = stringArray(raw.claimCodes)
  if (
    !onlyAllowedKeys(raw, [
      'version',
      'channel',
      'targetSeats',
      'claimCodes',
      'tone',
    ])
    || raw.version !== COMMUNICATION_INTENT_VERSION
    || (
      channel !== 'discussion'
      && channel !== 'proposal-pitch'
      && channel !== 'revision-reason'
    )
    || !Array.isArray(targetSeats)
    || !targetSeats.every(Number.isInteger)
    || new Set(targetSeats).size !== targetSeats.length
    || !claimCodes
    || new Set(claimCodes).size !== claimCodes.length
    || !claimCodes.every((code) =>
      COMMUNICATION_CLAIM_CODES.includes(code as CommunicationClaimCode))
    || raw.tone !== 'natural'
  ) {
    return undefined
  }
  return {
    version: COMMUNICATION_INTENT_VERSION,
    channel,
    targetSeats: targetSeats as number[],
    claimCodes: claimCodes as CommunicationClaimCode[],
    tone: 'natural',
  }
}

function plannerReply(content: string): PlannerOutput | undefined {
  const raw = parseObject(content)
  if (
    !raw
    || !onlyAllowedKeys(raw, ['candidateId', 'reasonCodes', 'communication'])
    || typeof raw.candidateId !== 'string'
  ) {
    return undefined
  }
  const reasonCodes = raw.reasonCodes === undefined
    ? undefined
    : stringArray(raw.reasonCodes)
  if (
    raw.reasonCodes !== undefined
    && (
      !reasonCodes
      || new Set(reasonCodes).size !== reasonCodes.length
    )
  ) {
    return undefined
  }
  const communication = raw.communication === undefined
    ? undefined
    : communicationDirection(raw.communication)
  if (raw.communication !== undefined && !communication) return undefined
  return {
    candidateId: raw.candidateId,
    ...(reasonCodes ? { reasonCodes } : {}),
    ...(communication ? { communication } : {}),
  }
}

function voiceReply(content: string): VoiceOutput | undefined {
  const raw = parseObject(content)
  if (
    !raw
    || !onlyAllowedKeys(raw, ['text', 'thinking'])
    || typeof raw.text !== 'string'
    || !raw.text.trim()
  ) {
    return undefined
  }
  if (raw.thinking !== undefined && typeof raw.thinking !== 'string') {
    return undefined
  }
  return {
    text: raw.text.trim(),
    ...(typeof raw.thinking === 'string' && raw.thinking.trim()
      ? { thinking: raw.thinking.trim() }
      : {}),
  }
}

export function createBoundedPlanner(
  options: BoundedPlannerVoiceOptions,
): CandidatePlanner {
  if (
    !options.client
    || typeof options.client.call !== 'function'
    || typeof options.model !== 'string'
    || !options.model.trim()
  ) {
    throw new Error('bounded planner requires a client and model')
  }
  const call = options.client.call.bind(options.client)
  const model = options.model
  const tagPrefix = options.tagPrefix ?? 'composed'
  return {
    version: BOUNDED_PLANNER_VERSION,
    async choose(input) {
      const content = await call(
        model,
        [
          {
            role: 'system',
            content:
              `${BOUNDED_PLANNER_PROMPT_VERSION}. Choose only a viable candidate ID from the supplied context. `
              + 'If you choose a candidate other than structuredCandidateId, include at least one reason code copied from that candidate. '
              + 'Communication may use only the supplied finite claim codes and seat numbers. Return one JSON object.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              structuredCandidateId: input.structuredCandidateId,
              context: JSON.parse(input.renderedContext),
              output: {
                candidateId: 'string',
                reasonCodes: ['permitted candidate reason code'],
                communication: {
                  version: COMMUNICATION_INTENT_VERSION,
                  channel: 'discussion | proposal-pitch | revision-reason',
                  targetSeats: ['seat number'],
                  claimCodes: COMMUNICATION_CLAIM_CODES,
                  tone: 'natural',
                },
              },
            }),
          },
        ],
        {
          tag: `${tagPrefix}/planner`,
          temperature: 0.3,
          max_tokens: 300,
          response_format: { type: 'json_object' },
        },
      )
      return plannerReply(content)
    },
  }
}

export function createBoundedVoice(
  options: BoundedPlannerVoiceOptions,
): PlanVoice {
  if (
    !options.client
    || typeof options.client.call !== 'function'
    || typeof options.model !== 'string'
    || !options.model.trim()
  ) {
    throw new Error('bounded voice requires a client and model')
  }
  const call = options.client.call.bind(options.client)
  const model = options.model
  const tagPrefix = options.tagPrefix ?? 'composed'
  return {
    version: BOUNDED_VOICE_VERSION,
    async speak(input) {
      const content = await call(
        model,
        [
          {
            role: 'system',
            content:
              `${BOUNDED_VOICE_PROMPT_VERSION}. Render natural Avalon table talk from the committed plan only. `
              + 'Do not add a new action, candidate, role fact, or exact numeric probability. '
              + 'Return one JSON object with text and optional thinking.',
          },
          { role: 'user', content: input.renderedPlan },
        ],
        {
          tag: `${tagPrefix}/voice`,
          temperature: 0.7,
          max_tokens: 250,
          response_format: { type: 'json_object' },
        },
      )
      return voiceReply(content)
    },
  }
}

export function createBoundedPlannerVoice(
  options: BoundedPlannerVoiceOptions,
): { planner: CandidatePlanner; voice: PlanVoice } {
  return {
    planner: createBoundedPlanner(options),
    voice: createBoundedVoice(options),
  }
}
