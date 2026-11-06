# Remaining competition plan

Updated 2026-11-06. Implementation and feature documentation are complete for the v0.3 competition scope. This plan distinguishes local verification from live deployment evidence.

## 1. Prepare the dedicated Vultr demo environment

Owner: operator, with implementation support.

- Provision the VM, DNS and private access-token file using docs/OPERATIONS.md.
- Install Docker/runsc, pinned runtime images, bounded scratch tmpfs and receipt signing configuration.
- Configure live Vultr Serverless Inference and the exact HTTPS origin. Enable output sharing only for the synthetic-data repair demonstration.
- Confirm anonymous requests are rejected and the UI reports the actual runtime/provider/signing state.

Done when: the deployed service is healthy, configuration is checked and no secrets appear in the repository or public demo materials.

## 2. Validate real execution and resolve failures

Owner: engineering/operator on the prepared Linux host.

- Run lint, portable tests and build, then `npm run test:integration`.
- Run `npm run demo -- --competition` against the dedicated demo service with the private token file and a separately trusted receipt public key.
- Inspect every scenario, saved receipt and `data/demo-evidence/report.json`; repair failures before recording.
- Check timeout/cancellation cleanup, missing-runtime refusal, budget exhaustion, privacy switches, deletion and elapsed-time retention.
- Record the tested commit, runtime/image identity, inference model and results in docs/VALIDATION.md.

Done when: actual Linux/runtime evidence exists and all claimed demonstrations pass. Current local evidence is 14 passing portable tests, syntax/build checks; Linux execution remains unverified.

## 3. Record and assemble the competition submission

Owner: presenter/operator.

- Follow docs/DEMO.md for the main video and docs/FEATURES.md for supplementary demonstrations.
- Capture fresh v0.3 screenshots; existing screenshots are historical v0.2 evidence.
- Prepare slides and cover assets using HACKATHON.md; explain exactly what signatures and containment observations establish.
- Confirm current eligibility, registration, submission fields and exact cutoff in the organizer dashboard.
- Submit repository, actual public demo URL, video and required assets; retain the submission receipt. Provide evaluator access privately where needed.

Done when: the organizer confirms a complete submission. Publishing source alone does not complete this step.

## 4. Complete real-customer release gates

Owner: engineering, operator and independent assessor.

- Commission independent adversarial assessment of API, controller/host, runtime, artifacts, signing and cleanup; remediate/retest critical findings.
- Add and verify crash/orphan recovery, operational alert routing, incident ownership and patch procedures.
- Approve data handling/retention and verify realistic workload limits and support economics.
- Keep customer deployments separate. Tenant identities, ownership enforcement and independent shared-tenant isolation validation are required before any multitenant SaaS expansion.

Done when: the intended customer deployment has appropriate assessment evidence and operational ownership. The competition prototype is not a certified secure platform.
