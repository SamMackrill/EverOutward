# Ever Outward agent instructions

## Standing release instruction

The owner requires merged website changes to be published to the existing
here.now site. A merged PR is an intermediate step, not task completion.
This instruction authorizes publication after merge; do not ask for permission
again unless the owner explicitly pauses or excludes deployment for that task.

For any task that merges website changes:

1. Finish the relevant checks, push the PR, address review findings, and verify
   that the intended commit is merged into `origin/main`.
2. Update the canonical owner checkout to the merged `main` using a safe
   fast-forward. On the owner's Windows computer this checkout is
   `C:/Users/Sam/source/repos/EverOutward`; it holds the authoritative
   `.local/everoutward.sqlite` and `.herenow/state.json`.
3. Run `npm run deploy` from that checkout and monitor the persistent publish
   job until it succeeds. Use the existing site and the repository's publisher,
   which backs up the journal and protects against concurrent edits and live
   version conflicts. Never deploy a temporary preview, replace the journal
   with fixtures, create a second site, or overwrite live-version drift blindly.
4. Verify the live site and the changed behavior, including the public journal
   data where relevant. Confirm that the returned live version is the published
   version. A successful build or merge alone does not establish deployment.
5. Only then report completion, with the PR link and live site link. If a real
   deployment blocker remains, report it explicitly and do not call the release
   complete. Retry transient failures after checking whether they succeeded.

Read the README's publishing and journal-preservation instructions before
deployment. Preserve user edits and private data when updating checkouts.
