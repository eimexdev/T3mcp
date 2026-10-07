---
name: t3-code
description: Run and follow coding work in T3 Code. Use when asked to work in T3 or check its projects and threads.
---

# T3 Code

The user's instructions take precedence over this skill's guidelines. Carry out already-authorized work without asking again, staying within the user's requested scope.

You are an outside client of T3 on the owner's machine, with no current project or calling thread. Pass explicit IDs. For launches, select a project from `t3_project_list` or use `scratch: true`.

When a project has no default model, launch requires `modelSelection`. Resolve the provider instance and model through `orchestrator_capabilities`; honor any model the user specifies.

`t3_thread_launch` has no idempotency key. Keep the returned `threadId` and `runId`. After an ambiguous error or timeout, look for the thread with `t3_thread_list` using `titleContains`, or `t3_thread_search`, before launching again. Reuse an existing thread; retry only once you establish that none was created.

Keep `t3_thread_wait` calls to 1–2 minutes and repeat as needed; tunnel requests time out at about 10 minutes. `timedOut: true` means the run is still in progress. Waiting or ending a wait does not stop it.

For repeated reads, use `t3_thread_read` with `afterPosition` from the previous `nextPosition` to fetch only new output.

Reuse the same `clientRequestId` when retrying a `t3_thread_send` or `t3_thread_interrupt` action; use a new ID for a new action.

Tools requiring a calling T3 thread return `thread_credential_required` here: `delegate_task`, `task_status`, `task_cancel`, `create_threads`, `request_secret`, `preview_*`, `device_*`, and `html_*`. Have a launched thread do that work instead.

If the machine, T3, or tunnel is offline, calls fail and nothing queues. Report the outage without assuming an in-progress run stopped; check its state when connectivity returns.
