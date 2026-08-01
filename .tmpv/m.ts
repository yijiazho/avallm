import {
  generateServantProposeCases, scoreProposalPicker, pairProposalPickers,
  baseProposalPicker, SERVANT_PROPOSE_HYPOTHESES,
} from '../server/eval/runs/servant-propose-calibration.ts'
const cases = await generateServantProposeCases(60)
const base = await scoreProposalPicker(cases, baseProposalPicker)
const pc = (k: number, n: number) => `${(100*k/n).toFixed(1)}%`
console.log(`${cases.length} held-out servant proposals\n`)
console.log(`${'policy'.padEnd(26)}dirty    evil/team   for/against   p`)
console.log(`${'constraints-only base'.padEnd(26)}${pc(base.metrics.dirtyTeams, base.metrics.decisions)}    ${base.metrics.meanEvilOnTeam.toFixed(3)}`)
for (const name of ['quest-weighted', 'vote-weighted', 'compatibility']) {
  const s = await scoreProposalPicker(cases, SERVANT_PROPOSE_HYPOTHESES[name])
  const p = pairProposalPickers(cases, base.picks, s.picks)
  console.log(`${name.padEnd(26)}${pc(s.metrics.dirtyTeams, s.metrics.decisions)}    ${s.metrics.meanEvilOnTeam.toFixed(3)}      `
    + `${String(p.candidateCleanBaseDirty).padStart(3)}/${String(p.baseCleanCandidateDirty).padEnd(3)}   p=${p.discordantPValue.toExponential(2)}`)
}
