import {
  generateServantProposeCases, scoreProposalPicker,
  baseProposalPicker, SERVANT_PROPOSE_HYPOTHESES,
} from '../server/eval/runs/servant-propose-calibration.ts'
const cases = await generateServantProposeCases(60)
const base = await scoreProposalPicker(cases, baseProposalPicker)
const vw = await scoreProposalPicker(cases, SERVANT_PROPOSE_HYPOTHESES['vote-weighted'])
const pc = (k: number, n: number) => `${(100*k/n).toFixed(1)}%`
console.log('dirty rate by round:')
console.log('  round   n     base   vote-weighted')
for (const [i, r] of base.metrics.byRound.entries()) {
  const v = vw.metrics.byRound[i]
  console.log(`  ${r.label}   ${String(r.decisions).padStart(3)}   ${pc(r.dirtyTeams, r.decisions).padStart(6)}   ${pc(v.dirtyTeams, v.decisions).padStart(12)}`)
}
