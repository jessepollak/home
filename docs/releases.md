# Releases

Home publishes tagged releases so an operator can run a known version and move to the next one deliberately. What changed in each release is in the [changelog](../CHANGELOG.md).

## Version names

Versions follow [semantic versioning](https://semver.org/) and are tagged `vMAJOR.MINOR.PATCH`, for example `v0.1.0`.

While Home is pre-1.0, versions stay at `v0.x`:

- a **minor** bump (`v0.1.0` → `v0.2.0`) may change behavior, settings, or required environment variables;
- a **patch** bump (`v0.1.0` → `v0.1.1`) carries fixes only, including security fixes, with no new required configuration.

`v1.0.0` will mark the first release with a stable upgrade promise.

## What a tag promises

A release tag points at one commit on `main` that passed the repository's required checks. Its changelog entry describes what an operator gets and lists anything they must do to upgrade: new migrations, new environment variables, or changed settings.

A tag does not authorize production or real-money use. Each deployment still needs its own provider setup and live, funded confirmation; see [provider readiness](provider-readiness.md).

## Moving from one tag to the next

Upgrade one tag at a time, reading each changelog entry's **Upgrading** notes. To move to a tag, follow [Update, backup and recovery](vercel-deploy.md#update-backup-and-recovery), merging the tag (for example `v0.2.0`) instead of `upstream/main`. Fetch tags with `git fetch upstream --tags`.

## Security fixes

Report a suspected vulnerability privately as described in the [security policy](../SECURITY.md). The public channel for announcing security fixes is to be named. Until it is, fixes ship in a patch release and are listed in the changelog.
