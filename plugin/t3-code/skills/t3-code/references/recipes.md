# T3 Code recipes

## Fix something in a project, on a new branch

1. `t3_project_list` and pick the project by name. Confirm with the user if more than one matches.
2. `t3_thread_launch`:
   ```json
   {
     "projectId": "<projectId>",
     "title": "Fix login redirect loop",
     "workspaceStrategy": {"type": "worktree", "baseRef": "main", "branch": "fix/login-redirect", "startFromOrigin": false},
     "message": "The login page redirects forever after OAuth callback. Reproduce, fix, add a test, and summarize the change."
   }
   ```
3. Tell the user the `threadId` and `runId`.
4. `t3_thread_wait` `{ "threadId": "...", "runId": "...", "timeoutMs": 120000 }`, repeated a few times while the user waits.
5. `t3_thread_read` `{ "threadId": "...", "view": "messages", "limit": 20 }` and summarize the final assistant message.

## Check on earlier work

1. `t3_thread_search` `{ "query": "login redirect" }`, or `t3_thread_list` `{ "projectId": "...", "statuses": ["running", "waiting"] }`.
2. `t3_thread_read` with `view: "messages"`. For new output since the last read, pass `afterPosition` from the previous `nextPosition`.

## Follow-up after a run finished

`t3_thread_send` `{ "threadId": "...", "message": "Also update the changelog.", "mode": "queue", "clientRequestId": "<new unique id>" }`, then wait on the returned `runId`.

## Correct a run in progress

`t3_thread_send` with `mode: "steer"` and the correction. Use `mode: "restart"` only if the user wants the current turn abandoned.

## Stop a run

`t3_thread_interrupt` `{ "threadId": "...", "runId": "...", "reason": "User asked to stop", "clientRequestId": "<unique id>" }`, then `t3_thread_wait` on the same run until `interrupted`.

## Lost launch response

1. Do not call `t3_thread_launch` again.
2. `t3_thread_list` `{ "projectId": "...", "titleContains": "<the title you used>" }` or `t3_thread_search` with a distinctive phrase from the message.
3. Found: continue with that `threadId`. Not found: launch once more.
