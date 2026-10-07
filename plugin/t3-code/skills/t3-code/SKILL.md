---
name: t3-code
description: Use when the user wants to start, check on, continue, steer, or stop coding work in T3 Code on their main machine, or asks about their T3 projects, threads, runs, worktrees, or pull requests. Covers choosing targets, launching threads safely, bounded waiting, reading results, and follow-ups through the native T3 Code tools.
---

# T3 Code

The T3 Code tools act on the owner's main machine. T3 runs the coding agents there and keeps every thread; you start and follow that work. You are an **outside client**: you have no "current thread" or "current project", so always pass explicit IDs.

## Orient first

- `t3_project_list` for projects and their IDs. `t3_project_read` for details.
- `orchestrator_capabilities` for provider instances and model IDs. Pass `modelSelection` (`{"instanceId": "...", "model": "..."}`) when the project has no default model or the user names a model.
- `t3_thread_list` with `projectId` (filter by `statuses`, `titleContains`) and `t3_thread_search` (omit `projectId` to search every project) to find existing work before starting new work.

## Start work

`t3_thread_launch` creates a top-level thread and starts its agent:

- `projectId` with no `workspaceStrategy` runs in the project checkout.
- New branch and worktree: `workspaceStrategy: {"type":"worktree","baseRef":"main","branch":"feature/x","startFromOrigin":false}` (`startFromOrigin: true` to start from upstream).
- `scratch: true` (no `projectId`) for throwaway work outside any repository.
- Give a short descriptive `title` and a complete, self-contained `message`. The agent sees only what you send.

**Launch has no retry key.** Record the returned `threadId` and `runId` and tell the user. If a launch errors ambiguously or times out, do **not** launch again: first look for it with `t3_thread_list` (`titleContains`) or `t3_thread_search`. Retry only when nothing was created. A clear validation error (for example, a missing `modelSelection`) means nothing was created.

## Follow work

- `t3_thread_wait` with `threadId` and `runId` and a bounded `timeoutMs` (30000–120000). `timedOut: true` means it is still running, not that it failed. Wait again or come back later.
- `t3_thread_read` with `view: "messages"` for the result, or `view: "activity"` for what the agent did. Continue long transcripts with `afterPosition: nextPosition`; recover truncated text with `itemId` + `textOffset`.
- `recentRuns` and the thread `status` show `running`, `waiting`, `completed`, `failed`, or `interrupted`. `waiting` usually means the agent asked something. Check `t3_pending_request_list` / `t3_pending_request_read` and answer with `t3_pending_request_respond` when the user has given you the answer.

## Continue, steer, stop

- `t3_thread_send` with a stable `clientRequestId` per message, so a retry cannot send it twice. Modes: `queue` for a follow-up turn, `steer` to adjust the running turn, `restart` to interrupt and restart, `auto` to let T3 choose.
- `t3_thread_interrupt` with `threadId` and `runId` plus a `clientRequestId`. Interrupting stops the turn; the thread remains and can continue.
- Destructive or broad actions (deleting projects, archiving, merging worktrees, force-restarting someone's run) need the user's explicit go-ahead.

## Limits to expect

- Tools that act *as* a calling T3 thread (`delegate_task`, `task_status`, `task_cancel`, `create_threads`, `request_secret`, preview, device, and HTML tools) return `thread_credential_required` for you. Ask a launched thread to do that work instead.
- If the machine, T3, or its tunnel is offline, calls fail (for example, connector unreachable or `502`). Nothing is queued; report it and suggest trying later. A failed call during an outage says nothing about whether a run already in progress stopped.
- Threads you start are capped by the plugin's approved access level; T3 refuses broader runtime modes.

See [references/recipes.md](references/recipes.md) for worked call sequences.
