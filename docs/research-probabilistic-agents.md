# Heuristic and probabilistic agents for The Resistance: Avalon

Research compiled for AvaLLM: an evidence-based review of rule-based, probabilistic,
game-theoretic, learned, and LLM-hybrid agents for Avalon. The practical question is how to
combine reliable machine reasoning over the public record with the linguistic and social
capabilities of an LLM.

Companion: [research-strategy.md](research-strategy.md) covers human strategy and prompt-ready role
heuristics; this brief focuses on the machinery agents use to represent uncertainty and choose
actions.

**Scope.** This is a research brief, not an implementation specification. It records what the
published systems do, what their experiments support, where their claims stop, and the design
directions that transfer to an LLM-plus-heuristics agent. Exact prompt placement, code ownership,
and rollout plans belong in the design documents.

---

## 1. Executive conclusion

The strongest near-term architecture for an LLM Avalon agent is a **hybrid belief engine**:

1. Deterministic code maintains a constrained distribution over possible hidden-role assignments.
2. A probabilistic model weights those assignments from proposals, votes, and quest outcomes.
3. An LLM interprets dialogue and contributes small, bounded belief adjustments.
4. The LLM receives the resulting structured beliefs and decides how to act and speak.
5. Logically forced moves remain separate from probabilistic policy.

This conclusion recurs across otherwise different systems. AvalonBench's Naive Servant gets useful
play from exact hypothesis elimination. DeepRole adds joint beliefs, strategic search, and learned
values. GRAIL externalizes belief tracking to a graphical model while retaining an LLM for language.
DeepBayes combines explicit online identity beliefs with CFR+. Even work focused on language finds
that explicit per-opponent models improve LLM decisions.

The first useful step is not CFR, MCTS, or a neural network. Avalon has so few alignment assignments
that an agent can enumerate them exactly. After fixing the viewing player's alignment, a ten-player
game has at most `C(9, 4) = 126` candidate evil sets. Exact enumeration preserves correlations that
a scalar suspicion score loses:

> "Exactly one of Alice and Bob is evil" is not equivalent to "Alice and Bob are each moderately
> suspicious."

The research therefore supports a progression from exact hypothesis tracking, to calibrated soft
likelihoods, to bounded language evidence, and only later to strategic search or learned value
functions.

---

## 2. The main families of agents

### 2.1 Rule-based heuristics

These agents map recognizable board conditions directly to actions: approve a team containing evil,
exclude players from failed quests, slow-play an early quest, or fail when evil is at match point.
They are cheap, deterministic, interpretable, and useful as fallbacks.

Their weakness is interaction. A collection of individually reasonable rules can be inconsistent,
double-count evidence, or miss joint constraints. Fixed thresholds also adapt poorly when the
opponent population changes.

### 2.2 Exact hypothesis elimination

An exact tracker enumerates every hidden-role or alignment assignment consistent with the viewer's
knowledge and removes impossible assignments as evidence arrives. This is the core of AvalonBench's
Naive Servant.

Fail counts provide hard negative evidence: if a quest produced `k` Fail cards, every assignment
with fewer than `k` evil players on that team is impossible. A zero-Fail quest does not prove its
members good because evil can play Success.

The remaining assignments support useful derived quantities:

- how often each seat is evil among viable assignments;
- correlations such as "at least one of these two is evil";
- the share of viable assignments in which a proposed team is all-good;
- the minimum and maximum number of evil players a team can contain;
- which proposed teams can distinguish among the remaining hypotheses.

These values are exact summaries of a defined hypothesis set. They should be described as
**hypothesis shares**, not automatically as calibrated real-world probabilities.

### 2.3 Bayesian or likelihood-weighted beliefs

Hard elimination treats every surviving assignment equally. A Bayesian agent instead assigns each
hypothesis a weight:

\[
P(h \mid e_{1:t}) \propto P(h)\prod_t P(e_t \mid h,\text{context}_t)
\]

The event model may use quest fail counts, team composition, proposal history, votes, board score,
hammer proximity, and observed player tendencies. A successful quest then becomes positive but
non-conclusive evidence: it raises the weight of all-good assignments while preserving evil
slow-play hypotheses.

This is more expressive but introduces assumptions. The posterior is only as well calibrated as the
likelihood model, and a model trained against one agent population can become wrong when prompts,
models, or table conventions change.

### 2.4 Search and equilibrium methods

CFR and related search methods reason about actions across information sets rather than greedily
selecting the locally safest team. They can capture bluffing, future information, cover, and the
effect of an action on other players' beliefs.

They are substantially harder to apply to full conversational Avalon:

- the game is multi-player and team-based rather than a simple two-player zero-sum game;
- secret simultaneous quest actions require correlated belief handling;
- natural-language actions have no tractable fixed action space;
- the value of a public action depends on how other agents interpret it;
- special roles introduce asymmetric private knowledge and a second endgame objective.

The practical transfer is to use exact beliefs and shallow value estimates first. Full CFR is a
later research program, not a prerequisite for a strong hybrid bot.

### 2.5 LLM-hybrid agents

Hybrid agents give symbolic or probabilistic machinery the bookkeeping problem and give the LLM the
language problem. The LLM can interpret contradiction, persuasion, hedging, alliance claims, and
role-signaling, while the belief engine preserves role-count constraints and long-horizon
consistency.

The strongest published result in this family is GRAIL. Its key lesson is architectural:
externalizing constrained belief inference can make a smaller, cheaper language model more effective
than a much larger reasoning model asked to do everything in tokens.

---

## 3. What the research says

| Approach | Core mechanism | Reported evidence | Transfer to an LLM-plus-heuristics agent |
|---|---|---|---|
| **AvalonBench Naive Servant** | Enumerates candidate evil teams, eliminates assignments inconsistent with Fail counts, and prefers teams most likely all-good | A deliberately simple but competitive rule-based baseline; out-of-the-box LLM agents often lost to the benchmark's naive agents | Start with exact joint hypotheses rather than independent suspicion scores |
| **DeepRole** | Vector-form CFR over joint beliefs, deductive updates for partially observed actions, and deep value networks trained by self-play | Outperformed hand-crafted and learned baselines in five-player Avalon and performed strongly with human players | Joint beliefs and second-order belief effects matter; full CFR is optional and expensive |
| **GRAIL** | Factor graph, max-product belief propagation, learned event factors, bounded LLM-derived language priors, and heuristic actions | Authors report the best average good-side win rate among their agent baselines, much lower token use than reasoning-only agents, and a 67% good-side win rate in their controlled human study | Closest published analogue: structured inference plus LLM language, with important scope limits |
| **DeepBayes** | History-driven role prediction, Bayesian Identity Recognition, and CFR+ | Reported consistent five-player win-rate gains over strong baselines; ablations weakened performance when either inference component was removed | Supports combining explicit online beliefs with strategic values, but is not a minimal first implementation |
| **Explicit Models of Opponents (EMO)** | A separate natural-language opponent model for each player, refined with local and global feedback | Improved multiple Avalon role metrics across reasoning methods, including Assassin identification, at the cost of many more model calls | Track players separately; avoid using free-form opponent prose as the authoritative belief state |
| **Assassin linear classifier** | Engineered vote- and proposal-history features with a linear SVM | Slightly exceeded average human assassination accuracy; larger neural models overfit | Merlin identification is well suited to small, interpretable numerical models |
| **Strategist** | LLM proposes value heuristics; MCTS simulations score and iteratively improve them | Improved decision heuristics more efficiently than the compared learning baselines in its Avalon experiments | A promising later optimizer once beliefs, replay, and evaluation metrics are stable |

---

## 4. System-by-system findings

### 4.1 AvalonBench: the minimum useful probabilistic agent

AvalonBench introduced rule-based agents alongside ReAct-style LLM agents. Its Naive Servant
maintains every possible good/evil assignment and initially weights them uniformly. After a quest
with `k` Fail cards, it sets to zero every assignment in which fewer than `k` quest members are evil.
To compare teams, it sums the surviving weight of assignments in which every proposed member is
good. A prior successful team is used as a secondary preference.

This algorithm is intentionally naive:

- it ignores dialogue;
- it ignores proposal and vote history;
- it does not distinguish likely from merely possible slow-play;
- surviving assignments retain their original equal weights rather than being renormalized from a
  behavioral model.

Its value is that it gets the representation right. It reasons over **whole role assignments**.
That makes its conclusions internally coherent and prevents the impossible marginal combinations
that arise when each player receives an independent trust score.

AvalonBench also found a deduction-action gap: LLM agents could infer roles reasonably well in
analysis and still select actions inconsistent with those beliefs. A structured belief state is
therefore useful only if the action prompt or policy consumes it directly.

### 4.2 DeepRole: beliefs as part of strategic play

DeepRole combines counterfactual regret minimization with learned value functions and a vector
representation of joint beliefs. Its deductive machinery handles information revealed indirectly by
secret actions, and its value representation exposes interpretable win probabilities. It was
evaluated in five-player Avalon without natural-language communication.

Three lessons transfer:

1. **Preserve joint uncertainty.** A probability distribution over complete hidden states is more
   strategically useful than unrelated per-player scores.
2. **Actions change beliefs.** The agent should consider not only what it learns, but what its
   proposal, vote, or quest behavior causes other players to infer.
3. **Urgency still needs representation.** Strong search systems can make obvious late-game errors
   if their state or value model does not express hammer rules, match point, or the absence of a
   future round.

DeepRole does not establish that AvaLLM needs online CFR. It establishes that belief state and
strategic value should be separate concepts, and that other players' interpretations are part of the
state.

### 4.3 GRAIL: the closest hybrid architecture

GRAIL, the Graph Reasoning Agent Informed through Language, separates three components:

- a factor graph over hidden player alignments and observed game events;
- a learned conditional-probability function trained on non-language game histories;
- an LLM that interprets dialogue and generates messages.

The graph enforces the fixed number of evil players and uses max-product belief propagation to
estimate a most-likely role assignment and per-seat max-marginals. Its learned factor consumes party
composition, public approval, and quest outcome history. The LLM does not emit unrestricted numeric
probabilities. For each player it says whether suspicion should move **higher**, **lower**, or remain
the **same**; a bounded, round-dependent parameter converts that judgment into a prior. The paper
explicitly prefers this qualitative interface because LLMs manipulate numeric probabilities
unreliably.

The action policy is simple: propose or approve a party only when every member is more likely Good
than Evil. This demonstrates the benefit of the beliefs, but it is not a general optimal policy:
fixed `0.5` member thresholds ignore board score, hammer position, alternative teams, and the joint
probability that the whole party is clean.

#### Scope correction: Minion support versus GRAIL Minion play

The released Bayesian-Avalon game harness **does support Minion seats**. Its configuration allows a
Minion to be controlled by ReCon, a random agent, an OpenAI or DeepSeek reasoning agent, or a human.
The repository includes Minion configuration and can run complete good-versus-evil games.

However, the README exposes the three GRAIL variants (`ours`, `ours_graph_only`, and
`ours_llm_only`) **only for Servant seats**. The paper likewise says the developed agent plays
exclusively as Good and excludes special roles to focus on detecting deception. Therefore:

- it is too broad to say the repository has no Minion play;
- it is accurate to say the published Bayesian GRAIL policy is a good-side, no-special-role agent;
- the repository's Minions are opponents supplied by other agent types, not a demonstrated
  Bayesian evil-side extension of GRAIL.

The distinction matters because evil reasoning is not merely the inverse of good-side role
inference. Evil already knows some teammates and instead needs to estimate public suspicion,
coordinate secret Fail cards, choose when to slow-play, and identify Merlin.

#### Results and limitations

The paper reports:

- a 75% average good-side win rate across its homogeneous agent matchup matrix;
- more than ten times fewer output tokens per round than the compared reasoning baselines;
- beliefs that move toward the true roles over successive rounds;
- a 67% good-side win rate in a controlled study against human evil players, compared with 27% for
  the reasoning-agent condition.

These results are strong evidence for the hybrid pattern, with qualifications:

- the experiments use a fixed six-player setup with four generic Good and two generic Evil roles;
- GRAIL itself is evaluated only as Good;
- learned factors come from a large external human-game dataset;
- the policy uses a coarse action threshold;
- human evil players remained harder to classify confidently than LLM evil agents;
- the architecture does not address Merlin concealment, Percival ambiguity, Mordred invisibility,
  Oberon isolation, two-Fail coordination, or assassination.

### 4.4 DeepBayes: learned identity recognition plus CFR+

DeepBayes combines two inference mechanisms with CFR+:

1. a history-driven network generates likely role assignments for counterfactual value estimates;
2. Bayesian Identity Recognition maintains explicit online posterior beliefs about opposing
   identities.

The reported ablations support both components: removing either role prediction or Bayesian
identity recognition reduced performance. This reinforces the separation between **hypothesis
generation**, **online belief updating**, and **action value**.

For AvaLLM, the useful concept is modularity. A small exact enumerator can initially replace the
role-prediction network, while a calibrated event model supplies online weights. CFR+ should be
considered only after the belief model can be evaluated independently.

### 4.5 Explicit Models of Opponents: language-side player models

EMO builds an individual natural-language model for each opponent and coordinates those models with
a two-level feedback and refinement process. In Avalon experiments it improved mission win rates and
Assassin identification across several prompting methods, while Merlin evasion stayed roughly
unchanged.

Its useful result is that modeling every opponent separately works better than collapsing the table
into one generic adversary. Its drawbacks are equally relevant:

- substantially more API calls;
- dependence on the underlying LLM's reasoning;
- vague free-form models that are difficult to calibrate or simulate;
- no guarantee that separate player descriptions satisfy the fixed role counts jointly.

A structured joint posterior should therefore remain authoritative. Per-player language models can
contribute evidence or explain beliefs, but should not replace the constrained state.

### 4.6 Assassin classification: simple features can be enough

Chuchro trained several classifiers to predict Merlin from completed five-player games. The best
result was a linear support-vector classifier over engineered features, reaching 45.9% test accuracy
against a recorded human baseline of 44.8%. Neural and nonlinear alternatives overfit and performed
worse on held-out games.

The absolute improvement is small, but the model comparison is instructive. Assassination has a
compact target and a short list of meaningful signals:

- agreement of votes with hidden truth;
- all-good proposals;
- early accurate suspicion;
- accuracy trajectory over the game;
- how closely a player mirrors an apparent Merlin or Morgana;
- speech frequency and confidence.

This is a good place for an interpretable, separately evaluated classifier. General good/evil belief
and Merlin probability should remain separate outputs.

### 4.7 Strategist: improving the value model

Strategist asks an LLM to propose strategy improvements, evaluates them with MCTS simulations, and
stores successful ideas in a growing strategy tree. Avalon is one of its evaluation domains, with a
focus on Merlin dialogue and generated value heuristics.

The transferable idea is a closed improvement loop around an executable value function. This becomes
useful only after:

- the state and belief representation are stable;
- decisions can be replayed reproducibly;
- behavioral and outcome metrics resist Goodharting;
- simulations approximate the opponents that matter.

Without those prerequisites, tree search optimizes noise or artifacts in the evaluator.

---

## 5. A transferable belief model

### 5.1 Layer 1: hard feasibility

Maintain a set of alignment assignments, plus role-candidate constraints where a special-role
posterior is required, consistent with:

- the public role multiset and evil count;
- the viewer's own role and alignment;
- the viewer's exact private knowledge;
- special-role visibility rules;
- public quest teams and Fail counts.

Hard constraints may delete a hypothesis but never merely downweight it. Soft evidence may reweight
a feasible hypothesis but never revive an impossible one.

### 5.2 Layer 2: public-action likelihoods

Weight feasible assignments using context-sensitive likelihoods for:

- the leader's proposed team;
- each player's approval or rejection;
- quest Fail count;
- repeated inclusion or exclusion patterns;
- score and match point;
- proposal number and hammer proximity;
- quest size and number of Fails required;
- known player or agent tendencies, when enough data exists.

Start with smoothed lookup tables or logistic regression. They are easier to inspect, calibrate, and
version than a neural factor network. More expressive models are justified only when held-out
calibration shows a meaningful gap.

### 5.3 Layer 3: bounded language evidence

Dialogue evidence should be:

- attributed to a specific seat;
- directional rather than an LLM-invented precise percentage;
- tied to a visible quotation or public event;
- bounded so it cannot overwhelm role constraints and strong quest evidence;
- weaker early, when the transcript contains little information;
- versioned with the model and prompt that produced it.

Suitable outputs include `higher`, `lower`, `same`, and perhaps a small fixed evidence class such as
`contradiction`, `unsupported certainty`, `coalition defense`, or `role-knowledge tell`.

### 5.4 Layer 4: derived decision quantities

The posterior should expose decision-relevant summaries, not merely a suspect ranking:

- probability or hypothesis share that the entire proposed team is clean;
- distribution over the number of evil players aboard;
- best alternative team's clean probability;
- expected quest success under a stated slow-play model;
- expected information gain from each candidate team;
- probability that a seat is Merlin, distinct from probability that the seat is Good;
- public-observer suspicion of the viewing player.

The final policy may disagree with the highest-probability action for strategic reasons. Merlin may
vote against private truth to remain hidden; evil may approve a clean team for cover; good may choose
a slightly riskier team because it is the last useful test before match point. The belief engine
informs policy but does not replace it.

---

## 6. Role-specific implications

### 6.1 Loyal Servant

The direct beneficiary of joint alignment beliefs. Proposals and votes should use whole-team clean
probability, correlations among suspects, and the availability of safer alternatives. Information
gain matters only while future quests remain.

### 6.2 Merlin

Merlin already knows most evil identities, so private alignment inference is not the main problem.
Merlin needs a **public-observer model**: how truth-aligned do its proposals, votes, and statements
look to an Assassin? Its objective is a frontier between influence and concealment, not maximum
deduction accuracy.

### 6.3 Percival

Percival needs a small posterior over the Merlin/Morgana pair, updated from truth-tracking,
intentional inaccuracies, defense patterns, and how each candidate's advice affects quests. It also
needs to manage its own Merlin-likeness as protective cover.

### 6.4 Generic Evil, Mordred, and Oberon

Known evil players need less private alignment inference and more recursive modeling:

- which good players currently trust each evil seat;
- which teammate is already burned;
- how a vote or Fail card changes public suspicion;
- whether the team contains enough **known** evil to meet the Fail requirement;
- how unseen Oberon changes coordination uncertainty;
- which good seat is most likely Merlin.

Mordred benefits from measuring how warmly an apparent Merlin treats it. Oberon needs a separate
belief over possible teammates because neither side of the evil partnership has normal knowledge.

### 6.5 Assassin

Use a separate Merlin posterior rather than selecting the "most good" seat. Features should capture
early truth alignment, unexplained accuracy, proposal quality, deliberate noise, Percival mirroring,
and dialogue behavior. Teammate observations can enter as bounded evidence.

---

## 7. Evaluation requirements

Belief quality and game quality must be measured separately.

### 7.1 Belief metrics

- **Log loss:** rewards assigning high probability to the true complete assignment.
- **Brier score:** measures per-seat alignment calibration.
- **Calibration curves:** among seats assigned 70% evil probability, roughly 70% should be evil.
- **Top-hypothesis accuracy:** how often the maximum-weight assignment is correct.
- **Team-clean calibration:** whether predicted clean-team probabilities match outcomes after
  accounting for slow-play.
- **Permutation invariance:** rotating seat labels must rotate beliefs without changing values.

Ground-truth roles are available only to offline evaluation. Runtime belief code must remain strictly
seat-viewed.

### 7.2 Behavioral metrics

- rate of proposing and approving all-good teams;
- probability assigned to the chosen team versus the best legal alternative;
- information gained per quest before match point;
- vote and proposal consistency with the agent's own stated beliefs;
- evil cover, coordination, and wasted-Fail behavior;
- Merlin influence and conspicuousness as a paired outcome;
- real and virtual Assassin accuracy.

### 7.3 Outcome and operational guards

- role-forced, paired win-rate deltas;
- forced-play violations;
- degraded or illegal decisions;
- token and dollar cost;
- latency;
- speech volume and factual hallucinations.

Win rate alone cannot diagnose whether a belief model improved. It also invites overfitting to one
opponent population, especially when evil behavior determines the likelihood model's calibration.

---

## 8. Recommended research progression

1. **Exact alignment hypotheses.** Uniformly weight every feasible evil set and derive joint team
   summaries.
2. **Belief-driven heuristic policy.** Use the same belief output for proposals, votes, discussion
   context, and offline evaluation.
3. **Empirical event likelihoods.** Learn smoothed proposal, vote, and quest models from versioned
   game artifacts.
4. **Bounded language updates.** Let the LLM contribute directional, evidence-citing adjustments.
5. **Second-order observer beliefs.** Model how the table reads Merlin and evil behavior.
6. **Role-specific posteriors.** Add Merlin/Morgana and Assassin targets without conflating them
   with alignment.
7. **Shallow counterfactual values.** Simulate candidate actions from sampled hypotheses using cheap
   agents.
8. **Learned values or CFR.** Pursue only if the earlier stages plateau and evaluation can isolate
   the gain.

Each stage should remain independently ablatable. The system should be able to compare:

- facts only;
- hard hypotheses;
- hypotheses plus event likelihoods;
- hypotheses plus event and language evidence;
- beliefs plus search.

That decomposition is necessary to know whether a stronger result came from better inference,
better policy, more compute, or an opponent-specific exploit.

---

## 9. Sources

- Light et al., [AvalonBench: Evaluating LLMs Playing the Game of Avalon](https://arxiv.org/abs/2310.05036)
  · [project](https://avalonbench.github.io/)
  · [code](https://github.com/jonathanmli/Avalon-LLM)
- Serrino et al.,
  [Finding Friend and Foe in Multi-Agent Games (DeepRole)](https://papers.nips.cc/paper/8408-finding-friend-and-foe-in-multi-agent-games)
  · [arXiv](https://arxiv.org/abs/1906.02330)
- Rahimirad et al.,
  [Bayesian Social Deduction with Graph-Informed Language Models (GRAIL)](https://aclanthology.org/2026.acl-long.1497/)
  · [project](https://camp-lab-purdue.github.io/bayesian-social-deduction/)
  · [MIT-licensed code](https://github.com/shahabrrad/Bayesian-Avalon)
  · [agent configuration README](https://github.com/shahabrrad/Bayesian-Avalon/blob/main/code/README.md)
- Xu et al.,
  [Optimizing strategy selection in hidden role games (DeepBayes)](https://doi.org/10.1016/j.engappai.2025.112464)
- Yu et al.,
  [LLM-Based Explicit Models of Opponents for Multi-Agent Games](https://aclanthology.org/2025.naacl-long.41/)
- Chuchro,
  [Training an Assassin AI for The Resistance: Avalon](https://arxiv.org/abs/2209.09331)
- Light et al.,
  [Strategist: Self-improvement of LLM Decision Making via Bi-Level Tree Search](https://llm-strategist.github.io/)
  · [ICLR 2025 paper](https://openreview.net/forum?id=gfI9v7AbFg)
- Wang et al.,
  [Avalon's Game of Thoughts: Battle Against Deception through Recursive Contemplation](https://aclanthology.org/2024.findings-acl.591/)
- Carminati et al.,
  [Hidden-Role Games: Equilibrium Concepts and Computation](https://www.mit.edu/~gfarina/2024/hidden_role_games_ec24/)
