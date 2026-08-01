export interface PlaytestFinding {
  signature: string
  priority: 'P0' | 'P1' | 'P2' | 'P3'
  confidence: 'confirmed' | 'review'
  scope: string
  seat: number
  title: string
  evidence: string
}

export interface PlaytestAudit {
  gameId: string
  seed: string
  createdAt: string
  winner: string
  seats: readonly Record<string, unknown>[]
  findings: PlaytestFinding[]
}

export function auditArtifact(artifact: any): PlaytestAudit
export function aggregateAudits(audits: readonly PlaytestAudit[]): readonly Record<string, unknown>[]
