# Historical pilot demo draft

Superseded for competition by [current demonstration guide](../DEMO.md), which covers optional/production-required signing and current evidence labels. The unsigned-receipt statements below describe the pre-v0.3 baseline.

# Five-minute customer demonstration

Use synthetic docs/sample-sales.csv. Preflight the selected backend, limits, inference provider and access restrictions. State the actual runtime; do not imply gVisor if runc or bubblewrap is in use. Existing UI labels may overstate evidence; explain the limitations until backlog item 5 is implemented.

1. Problem (30 seconds): “Your agent needs to analyse a customer file. You need useful output, restricted execution and a record a reviewer can understand.”
2. Useful run (90 seconds): upload the sample, request revenue by region and a chart, review code, execute. Compare the result with a separately calculated fixture answer. A successful exit and RESULTS_JSON alone do not establish correctness.
3. Prohibited actions (60 seconds): use the fixed exfiltration and read-only write presets with synthetic data. Show configured restrictions and observed errors. Explain that current labels infer categories from output and are not trusted syscall telemetry.
4. Runaway execution (30 seconds): run the fixed infinite-loop preset, show controller timeout and check actual cleanup. Run the normal fixture again to demonstrate continued service operation.
5. Receipt (60 seconds): show code/input/output hashes, backend, limits and attempt history. State: “This current receipt is an unsigned service record. Its hashes allow consistency checks against retained bytes; anyone able to rewrite the record can recompute them. It does not prove no escape occurred, that logging is complete, or that the answer is correct.”
6. Close (30 seconds): offer to scope one paid workflow with written acceptance criteria. Ask what their technical reviewer still needs.

Do not demonstrate hostile code on an unapproved shared host. Do not call these presets sandbox-escape testing. Capture actual results and failures; never replace a failed control demonstration with a success claim.

After signing is implemented, explain that signature verification establishes the record’s issuer and integrity relative to a trusted public key. It still does not independently establish runtime truth or universal containment.
