# Publication gate integration handoff

The gate modules are prepared but workflow edits are owned by the build slice.
Engine mode must be an explicit protected repository setting. Call the common
`assertPublicationGate` at EVERY write site after existing PR/tag/hotfix guards.
When enabled, unmanaged writes fail; missing runtime/OIDC configuration fails.
The HTTPS client uses the GitHub workflow OIDC token as its Bearer token. The
runtime must verify exact workflow identity; it must never accept a shared
unauthenticated assertion. The endpoint is not active in this commit.

| Path | Existing write sites | Required integration |
|---|---|---|
| `build-mac.yml` | `gh release create` and `upload` around 460–468 | managed-build reservation guard; numeric draft ID; disallow final promotion marker |
| `build-windows.yml` | `gh release create` and `upload` around 513–521 | same managed-build guard; numeric draft ID; disallow final promotion marker |
| `verify-unified-release.yml` | upload acceptance, `release edit --draft=false`, mirror dispatch around 239–241 | promote through Service same-byte publisher; guard before dispatch |
| `mirror-release.yml` | target release create/edit/upload around 253–255; generated install bundle upload around 264 | current intent/channel + exact mirrored byte IDs/hash/size; separately approved generated support bundle identity |
| `release-cut.yml` / `scripts/release/create.mjs` | tag push / managed cut | managed source exact-contract comparison and reserved tag-only executor |
| manual tags and hotfix tags | direct push reaches Mac/Windows builders | server OIDC guard cannot trust tag origin; controlled mode denies unmanaged builds/uploads |
| direct GitHub Release UI/API | account with contents write can edit releases | repository credential/rules restriction is required; a source-code gate cannot revoke external writer permissions |

`publicationPaths` enumerates these code paths for test coverage; enumeration is
not evidence that all workflows currently call the gate. Existing workflows are
unchanged in this slice because another active owner edits them.

Prepared hook shape:

```js
await assertPublicationGate({enabled,managed,path,identity,client,legacyGuard});
```

`identity` is `{repository:'hypeproof/hypeproof-studio',repositoryId:1239447574,
sourceSha,intentDigest,releaseId,channel}`. All are pinned, with numeric release ID.
The server returns `{status:'AUTHORIZED',path,identityDigest,fence}` after current
signed intent, manager, recovery, quota and claim checks. This authorization is a
preflight; the actual mutation executor rechecks independently immediately before
HTTP. Draft uploads cannot use a promotion intent before approval: their separate
build-authority route must remain blocked until connected.

Final stable tag `hps-same-byte-promotion/1` MUST cause both builders to exit before
build/draft/upload work. A stable release changes the existing draft's tag metadata
only after the exact final tag/source is verified. No artifact is rebuilt. Canary
is intentionally denied until an approved core channel contract supports it.

Synthetic tests exercise gate identity, all listed code path names, legacy guard
preservation, denied missing authority and HTTPS redirect refusal. They do not
prove live permission restrictions, publication or customer update success.
