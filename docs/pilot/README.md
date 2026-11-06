# SafeCode: path to a paid private pilot

Status: proposed commercial direction, grounded in a source review on 2026-11-05. The competition implementation now adds several controls; see [current features](../FEATURES.md) and [remaining security work](../SECURITY.md). This is not a security assessment or a claim of deployment readiness.

## Decision

Target AI product teams adding Python analysis of customer CSV files. Sell one controlled execution workflow with reviewable evidence, delivered as a dedicated private pilot. Keep the existing hackathon demonstration; use this narrower positioning for customer discovery.

Positioning: “Ship AI-generated customer-file analysis with enforced execution limits and evidence your reviewers can inspect.”

Buyer: CTO or engineering lead with a working agent, an upcoming customer deployment, and unresolved execution or data-handling questions. A team merely exploring agents is a lower-priority prospect.

## Why this could win

The initial advantage is an integrated outcome: a useful file-analysis workflow, explicit permissions, bounded execution, understandable failure reports, and a review package. The hypothesis is that this saves integration and review work. Measure those savings; do not assume receipts alone create willingness to pay.

The existing product already provides CSV input, output charts, retries, receipts and dashboard events. Adding another general dashboard is lower priority than making those capabilities trustworthy and easy to adopt.

Longer-term differentiation: repeatable workflow integrations, a maintained adversarial regression corpus, and evidence customers actually use in their approval process. Isolation technology itself is not a unique advantage.

## Deliverables

- [Pilot offer and discovery script](offer.md): a bounded commercial experiment.
- [Implementation backlog and release gates](backlog.md): source-grounded gaps with acceptance criteria.
- [Demonstration script](demo.md): useful execution, prohibited actions, then evidence and its limits.

## Thirty-day execution plan

1. Week 1: interview five qualified prospects; demonstrate synthetic CSV analysis; record current alternatives, blockers, budget owner and deployment date. Scope the first three backlog items. Use no sensitive prospect data in the current demo.
2. Week 2: complete pilot safety gates and a thin Python integration example; interview five more prospects; seek a signed, fixed-scope paid pilot. Security validation scope may extend beyond this week; do not bypass gates to hit a date.
3. Week 3: integrate one workflow in the dedicated environment after the required gates pass; measure onboarding effort, expected output accuracy, latency and per-workflow cost. Obtain reviewer feedback.
4. Week 4: deliver evidence, document shortcomings and ask for recurring conversion. Seek a second customer with the same core workflow.

Founder owns sales and scoping; engineering owns release evidence; an independent assessor owns independent findings. Book external assessment early; this plan does not assume availability or completion within thirty days.

## Decision criteria

Continue investing when two unrelated customers pay for substantially the same workflow, one converts to recurring use, and delivery fits the support budget. These are internal targets, not forecasts.

If ten qualified interviews yield no urgent problem or nobody will pay a deposit, revise the buyer/use case before expanding features. If deals require materially different products, narrow scope. Record rejection reasons, not just interview counts.

Defer general-purpose SaaS, public anonymous execution, multiple languages in the pilot, marketplaces, multi-cloud orchestration and broad compliance promises.
